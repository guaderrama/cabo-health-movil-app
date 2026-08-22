import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { URL as NodeUrl, fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyFirebaseBootstrapPlan,
  createFirebaseBootstrapPlan,
  parseFirebaseBootstrapPlan,
  sanitizeFirebaseBootstrapEvidence,
  type FirebaseActivationEnvironment,
  type FirebaseBootstrapAdminBoundary,
} from '../domain/firebaseActivationBootstrap.js';
import { createFirebaseBootstrapAdminBoundary } from '../infrastructure/firebaseBootstrapAdminSdk.js';

export type FirebaseBootstrapCommand = Readonly<{
  apply: false;
  environment: FirebaseActivationEnvironment;
  ownerUidFile: string;
  planOut: string;
  projectId: string;
  reviewDatabaseId: string;
}> | Readonly<{
  apply: true;
  environment: FirebaseActivationEnvironment;
  planFile: string;
  projectId: string;
  reviewDatabaseId: string;
  reviewedPlanSha256: string;
}>;

export async function executeFirebaseBootstrapCommand(input: Readonly<{
  boundary: (projectId: string) => Promise<FirebaseBootstrapAdminBoundary>;
  command: FirebaseBootstrapCommand;
  repositoryRoot: string;
}>): Promise<ReturnType<typeof sanitizeFirebaseBootstrapEvidence>> {
  const { command } = input;
  if (!command.apply) {
    await assertPrivateInputFile(command.ownerUidFile, input.repositoryRoot, 256);
    await assertPrivateOutputPath(command.planOut, input.repositoryRoot);
    const ownerUid = normalizeOwnerUid(await readFile(command.ownerUidFile, 'utf8'));
    const plan = createFirebaseBootstrapPlan({
      environment: command.environment,
      ownerUid,
      projectId: command.projectId,
      reviewDatabaseId: command.reviewDatabaseId,
    });
    await writeFile(command.planOut, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return sanitizeFirebaseBootstrapEvidence(plan, 'dry-run');
  }

  await assertPrivateInputFile(command.planFile, input.repositoryRoot, 32_768);
  const plan = parseFirebaseBootstrapPlan(
    JSON.parse(await readFile(command.planFile, 'utf8')) as unknown,
  );
  return applyFirebaseBootstrapPlan({
    apply: true,
    boundary: input.boundary,
    expectedEnvironment: command.environment,
    expectedProjectId: command.projectId,
    expectedReviewDatabaseId: command.reviewDatabaseId,
    plan,
    reviewedPlanSha256: command.reviewedPlanSha256,
  });
}

export function parseFirebaseBootstrapArguments(argv: readonly string[]): FirebaseBootstrapCommand {
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

  const environment = values.get('--environment');
  const projectId = values.get('--project-id');
  const reviewDatabaseId = values.get('--review-database-id');
  if (
    (environment !== 'production' && environment !== 'staging')
    || !projectId
    || !reviewDatabaseId
  ) throw invalidArguments();

  if (apply) {
    const planFile = values.get('--plan-file');
    const reviewedPlanSha256 = values.get('--reviewed-plan-sha256');
    if (
      values.size !== 5
      || !planFile
      || !reviewedPlanSha256
      || !/^[a-f0-9]{64}$/u.test(reviewedPlanSha256)
    ) throw invalidArguments();
    return Object.freeze({
      apply: true as const,
      environment,
      planFile,
      projectId,
      reviewDatabaseId,
      reviewedPlanSha256,
    });
  }

  const ownerUidFile = values.get('--owner-uid-file');
  const planOut = values.get('--plan-out');
  if (values.size !== 5 || !ownerUidFile || !planOut) throw invalidArguments();
  return Object.freeze({
    apply: false as const,
    environment,
    ownerUidFile,
    planOut,
    projectId,
    reviewDatabaseId,
  });
}

const KNOWN_VALUE_FLAGS = new Set([
  '--environment',
  '--owner-uid-file',
  '--plan-file',
  '--plan-out',
  '--project-id',
  '--review-database-id',
  '--reviewed-plan-sha256',
]);

function invalidArguments(): Error {
  return new Error('firebase_bootstrap_arguments_invalid');
}

async function assertPrivateInputFile(
  path: string,
  repositoryRoot: string,
  maximumBytes: number,
): Promise<void> {
  if (!isAbsolute(path)) throw new Error('firebase_bootstrap_private_file_invalid');
  const privateRoot = await realpath(resolve(repositoryRoot, 'release', 'private'));
  const resolvedPath = await realpath(path);
  if (!isWithin(privateRoot, resolvedPath)) {
    throw new Error('firebase_bootstrap_private_file_invalid');
  }
  const metadata = await stat(resolvedPath);
  if (
    !metadata.isFile()
    || metadata.size > maximumBytes
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
  ) throw new Error('firebase_bootstrap_private_file_invalid');
}

async function assertPrivateOutputPath(path: string, repositoryRoot: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('firebase_bootstrap_private_file_invalid');
  const privateRoot = await realpath(resolve(repositoryRoot, 'release', 'private'));
  const outputParent = await realpath(dirname(path));
  const parentMetadata = await stat(outputParent);
  if (!isWithin(privateRoot, outputParent) || (parentMetadata.mode & 0o077) !== 0) {
    throw new Error('firebase_bootstrap_private_file_invalid');
  }
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
  if (!normalized || normalized.includes('\n') || normalized.includes('\r')) {
    throw new Error('firebase_bootstrap_owner_file_invalid');
  }
  return normalized;
}

async function main(): Promise<void> {
  const repositoryRoot = fileURLToPath(new NodeUrl('../../../', import.meta.url));
  const command = parseFirebaseBootstrapArguments(process.argv.slice(2));
  const evidence = await executeFirebaseBootstrapCommand({
    boundary: createFirebaseBootstrapAdminBoundary,
    command,
    repositoryRoot,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  void main().catch(() => {
    process.stderr.write('firebase_bootstrap_failed\n');
    process.exitCode = 1;
  });
}
