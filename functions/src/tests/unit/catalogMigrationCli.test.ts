import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CatalogAdminService } from '../../domain/catalogAdmin.js';
import { FirestoreCatalogStore } from '../../repositories/firestoreCatalogStore.js';
import {
  assertCatalogMigrationAdminEnvironment,
  executeCatalogMigrationCommand,
  parseCatalogMigrationArguments,
} from '../../tools/migrateCatalog.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

test('catalog migration CLI is dry-run by default and apply requires the exact reviewed hash', () => {
  assert.deepEqual(parseCatalogMigrationArguments([
    '--owner-uid-file', '/private/owner.uid',
    '--plan-out', '/private/catalog-plan.json',
    '--project-id', 'cabohealth-owner-prod',
  ]), {
    apply: false,
    ownerUidFile: '/private/owner.uid',
    planOut: '/private/catalog-plan.json',
    projectId: 'cabohealth-owner-prod',
  });
  assert.deepEqual(parseCatalogMigrationArguments([
    '--apply',
    '--plan-file', '/private/catalog-plan.json',
    '--project-id', 'cabohealth-owner-prod',
    '--reviewed-plan-sha256', 'a'.repeat(64),
  ]), {
    apply: true,
    planFile: '/private/catalog-plan.json',
    projectId: 'cabohealth-owner-prod',
    reviewedPlanSha256: 'a'.repeat(64),
  });

  for (const argv of [
    ['--apply', '--project-id', 'cabohealth-owner-prod'],
    ['--project-id', 'cabohealth-owner-staging', '--owner-uid-file', '/x', '--plan-out', '/y'],
    ['--project-id', 'cabohealth-owner-prod', '--owner-uid-file', '/x', '--plan-out', '/y', '--extra', '1'],
    ['--project-id', 'cabohealth-owner-prod', '--owner-uid-file', '/x', '--plan-out', '/y', '--plan-file', '/z'],
  ]) {
    assert.throws(() => parseCatalogMigrationArguments(argv), /catalog_migration_arguments_invalid/u);
  }
});

test('catalog migration Admin SDK rejects every emulator and ambient project mismatch', () => {
  assert.doesNotThrow(() => assertCatalogMigrationAdminEnvironment(
    'cabohealth-owner-prod',
    {},
  ));
  for (const environment of [
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { FIREBASE_EMULATOR_HUB: '127.0.0.1:4400' },
    { FUNCTIONS_EMULATOR: 'true' },
    { GCLOUD_PROJECT: 'different-prod' },
    { GOOGLE_CLOUD_PROJECT: 'different-prod' },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: 'different-prod' }) },
  ]) {
    assert.throws(
      () => assertCatalogMigrationAdminEnvironment('cabohealth-owner-prod', environment),
      /catalog_migration_admin_environment_invalid/u,
    );
  }
});

test('CLI writes one private reviewable plan, applies it idempotently, and emits no UID or content', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'cabohealth-catalog-migration-'));
  const privateRoot = join(repositoryRoot, 'release', 'private');
  const ownerUidFile = join(privateRoot, 'owner.uid');
  const planOut = join(privateRoot, 'catalog-migration-plan.json');
  await mkdir(privateRoot, { mode: 0o700, recursive: true });
  await writeFile(ownerUidFile, `${OWNER_UID}\n`, { mode: 0o600 });
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
  });
  const catalog = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });
  const runtime = async () => ({
    catalog,
    database,
    loadOwner: async () => ({
      disabled: false,
      emailVerified: true,
      factorCount: 0,
      providerIds: ['password'],
    }),
    projectId: 'cabohealth-owner-prod',
  });

  try {
    const dryRun = await executeCatalogMigrationCommand({
      command: {
        apply: false,
        ownerUidFile,
        planOut,
        projectId: 'cabohealth-owner-prod',
      },
      repositoryRoot,
      runtime,
    });
    const privatePlan = JSON.parse(await readFile(planOut, 'utf8')) as unknown;
    assert.equal(dryRun.status, 'dry-run');
    assert.equal(JSON.stringify(dryRun).includes(OWNER_UID), false);
    assert.equal(JSON.stringify(dryRun).includes('Healthy Recipes'), false);
    assert.equal(JSON.stringify(privatePlan).includes(OWNER_UID), true);

    const applied = await executeCatalogMigrationCommand({
      command: {
        apply: true,
        planFile: planOut,
        projectId: 'cabohealth-owner-prod',
        reviewedPlanSha256: dryRun.planSha256,
      },
      repositoryRoot,
      runtime,
    });
    assert.equal(applied.status, 'applied');
    assert.equal((await catalog.list()).length, 3);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

const OWNER_UID = 'owner_uid_0123456789';
const LEGACY_ADMIN = Object.freeze({
  active: true,
  permissions: Object.freeze([
    'client_codes',
    'client_resource_drafts',
    'app_review_credential',
  ]),
  schemaVersion: 1,
  scope: 'production',
});
