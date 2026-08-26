import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { URL as NodeUrl, fileURLToPath, pathToFileURL } from 'node:url';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import { CatalogAdminService } from '../domain/catalogAdmin.js';
import {
  applyCatalogMigrationPlan,
  assertCatalogMigrationOwnerReady,
  createCatalogMigrationPlan,
  parseCatalogMigrationPlan,
  sanitizeCatalogMigrationEvidence,
  type CatalogMigrationEvidence,
  type CatalogMigrationOwner,
} from '../domain/catalogMigration.js';
import { AdminFirestoreDocumentDatabase } from '../infrastructure/adminFirestoreDocumentDatabase.js';
import { FirestoreCatalogStore } from '../repositories/firestoreCatalogStore.js';
import type { DocumentDatabase } from '../repositories/firestoreClientAccessStore.js';

const PRODUCTION_PROJECT_ID = 'cabohealth-owner-prod';

export type CatalogMigrationCommand = Readonly<{
  apply: false;
  ownerUidFile: string;
  planOut: string;
  projectId: 'cabohealth-owner-prod';
}> | Readonly<{
  apply: true;
  planFile: string;
  projectId: 'cabohealth-owner-prod';
  reviewedPlanSha256: string;
}>;

export interface CatalogMigrationRuntime {
  readonly catalog: CatalogAdminService;
  readonly database: DocumentDatabase;
  readonly loadOwner: (uid: string) => Promise<CatalogMigrationOwner | undefined>;
  readonly projectId: string;
}

export async function executeCatalogMigrationCommand(input: Readonly<{
  command: CatalogMigrationCommand;
  repositoryRoot: string;
  runtime: (projectId: string) => Promise<CatalogMigrationRuntime>;
}>): Promise<CatalogMigrationEvidence> {
  const { command } = input;
  if (!command.apply) {
    await assertPrivateInputFile(command.ownerUidFile, input.repositoryRoot, 256);
    await assertPrivateOutputPath(command.planOut, input.repositoryRoot);
    const ownerUid = normalizeOwnerUid(await readFile(command.ownerUidFile, 'utf8'));
    const runtime = await input.runtime(command.projectId);
    if (runtime.projectId !== command.projectId) throw applyNotAuthorized();
    assertCatalogMigrationOwnerReady(await runtime.loadOwner(ownerUid));
    const plan = await createCatalogMigrationPlan({
      catalog: runtime.catalog,
      database: runtime.database,
      ownerUid,
      projectId: runtime.projectId,
    });
    await writeFile(command.planOut, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return sanitizeCatalogMigrationEvidence(plan, 'dry-run');
  }

  await assertPrivateInputFile(command.planFile, input.repositoryRoot, 131_072);
  const plan = parseCatalogMigrationPlan(
    JSON.parse(await readFile(command.planFile, 'utf8')) as unknown,
  );
  const runtime = await input.runtime(command.projectId);
  if (runtime.projectId !== command.projectId) throw applyNotAuthorized();
  return applyCatalogMigrationPlan({
    catalog: runtime.catalog,
    database: runtime.database,
    loadOwner: runtime.loadOwner,
    plan,
    projectId: command.projectId,
    reviewedPlanSha256: command.reviewedPlanSha256,
  });
}

export function parseCatalogMigrationArguments(argv: readonly string[]): CatalogMigrationCommand {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') {
      if (apply) throw invalidArguments();
      apply = true;
      continue;
    }
    if (!flag || !KNOWN_VALUE_FLAGS.has(flag) || values.has(flag)) throw invalidArguments();
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw invalidArguments();
    values.set(flag, value);
    index += 1;
  }

  if (values.get('--project-id') !== PRODUCTION_PROJECT_ID) throw invalidArguments();
  if (apply) {
    const planFile = values.get('--plan-file');
    const reviewedPlanSha256 = values.get('--reviewed-plan-sha256');
    if (values.size !== 3
      || !planFile
      || !reviewedPlanSha256
      || !/^[a-f0-9]{64}$/u.test(reviewedPlanSha256)) throw invalidArguments();
    return Object.freeze({
      apply: true as const,
      planFile,
      projectId: PRODUCTION_PROJECT_ID,
      reviewedPlanSha256,
    });
  }

  const ownerUidFile = values.get('--owner-uid-file');
  const planOut = values.get('--plan-out');
  if (values.size !== 3 || !ownerUidFile || !planOut) throw invalidArguments();
  return Object.freeze({
    apply: false as const,
    ownerUidFile,
    planOut,
    projectId: PRODUCTION_PROJECT_ID,
  });
}

const KNOWN_VALUE_FLAGS = new Set([
  '--owner-uid-file',
  '--plan-file',
  '--plan-out',
  '--project-id',
  '--reviewed-plan-sha256',
]);

export function assertCatalogMigrationAdminEnvironment(
  projectId: string,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (projectId !== PRODUCTION_PROJECT_ID) throw invalidEnvironment();
  if (Object.entries(environment).some(([variable, value]) => (
    Boolean(value)
    && (variable.endsWith('_EMULATOR_HOST')
      || variable === 'FIREBASE_EMULATOR_HUB'
      || variable === 'FUNCTIONS_EMULATOR')
  ))) throw invalidEnvironment();
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'] as const) {
    const ambientProject = environment[variable];
    if (ambientProject && ambientProject !== projectId) throw invalidEnvironment();
  }
  const firebaseConfig = environment.FIREBASE_CONFIG;
  if (firebaseConfig) {
    try {
      const parsed = JSON.parse(firebaseConfig) as unknown;
      if (!isRecord(parsed) || parsed.projectId !== projectId) throw invalidEnvironment();
    } catch {
      throw invalidEnvironment();
    }
  }
}

export async function createCatalogMigrationRuntime(
  projectId: string,
): Promise<CatalogMigrationRuntime> {
  assertCatalogMigrationAdminEnvironment(projectId, process.env);
  const appName = `cabohealth-catalog-migration-${projectId}`;
  const app = getApps().find((candidate) => candidate.name === appName)
    ?? initializeApp({ projectId }, appName);
  const database = new AdminFirestoreDocumentDatabase(getFirestore(app));
  const auth = getAuth(app);
  return Object.freeze({
    catalog: new CatalogAdminService({ store: new FirestoreCatalogStore(database) }),
    database,
    loadOwner: async (uid: string) => {
      try {
        const user = await auth.getUser(uid);
        return Object.freeze({
          disabled: user.disabled,
          emailVerified: user.emailVerified,
          factorCount: user.multiFactor?.enrolledFactors.length ?? 0,
          providerIds: Object.freeze(user.providerData.map(({ providerId }) => providerId)),
        });
      } catch (error) {
        if (isRecord(error) && error.code === 'auth/user-not-found') return undefined;
        throw error;
      }
    },
    projectId,
  });
}

function invalidArguments(): Error {
  return new Error('catalog_migration_arguments_invalid');
}

function invalidEnvironment(): Error {
  return new Error('catalog_migration_admin_environment_invalid');
}

function applyNotAuthorized(): Error {
  return new Error('catalog_migration_apply_not_authorized');
}

async function assertPrivateInputFile(
  path: string,
  repositoryRoot: string,
  maximumBytes: number,
): Promise<void> {
  if (!isAbsolute(path)) throw privateFileInvalid();
  const privateRoot = await realpath(resolve(repositoryRoot, 'release', 'private'));
  const resolvedPath = await realpath(path);
  if (!isWithin(privateRoot, resolvedPath)) throw privateFileInvalid();
  const metadata = await stat(resolvedPath);
  if (!metadata.isFile()
    || metadata.size > maximumBytes
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
    throw privateFileInvalid();
  }
}

async function assertPrivateOutputPath(path: string, repositoryRoot: string): Promise<void> {
  if (!isAbsolute(path)) throw privateFileInvalid();
  const privateRoot = await realpath(resolve(repositoryRoot, 'release', 'private'));
  const outputParent = await realpath(dirname(path));
  const parentMetadata = await stat(outputParent);
  if (!isWithin(privateRoot, outputParent) || (parentMetadata.mode & 0o077) !== 0) {
    throw privateFileInvalid();
  }
}

function privateFileInvalid(): Error {
  return new Error('catalog_migration_private_file_invalid');
}

function isWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

function normalizeOwnerUid(value: string): string {
  const normalized = value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n')
      ? value.slice(0, -1)
      : value;
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(normalized)) {
    throw new Error('catalog_migration_owner_file_invalid');
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function main(): Promise<void> {
  const repositoryRoot = fileURLToPath(new NodeUrl('../../../', import.meta.url));
  const evidence = await executeCatalogMigrationCommand({
    command: parseCatalogMigrationArguments(process.argv.slice(2)),
    repositoryRoot,
    runtime: createCatalogMigrationRuntime,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(() => {
    process.stderr.write('catalog_migration_failed\n');
    process.exitCode = 1;
  });
}
