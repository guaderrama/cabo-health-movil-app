import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CatalogAdminService } from '../../domain/catalogAdmin.js';
import {
  applyCatalogMigrationPlan,
  createCatalogMigrationPlan,
  hashCatalogMigrationPlan,
  parseCatalogMigrationPlan,
} from '../../domain/catalogMigration.js';
import { FirestoreCatalogStore } from '../../repositories/firestoreCatalogStore.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

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

test('dry-run plans the three canonical active miniapps and exact owner permission migration', async () => {
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
  });
  const catalog = new CatalogAdminService({
    store: new FirestoreCatalogStore(database),
  });

  const plan = await createCatalogMigrationPlan({
    catalog,
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });

  assert.equal(plan.adminDocumentState, 'legacy');
  assert.deepEqual(plan.operations.map(({ item, source }) => ({
    access: item.access,
    active: item.active,
    icon: item.icon,
    id: new URL(item.url).pathname.split('/').filter(Boolean).at(-1),
    source,
  })), [
    { access: 'public', active: true, icon: 'recipes', id: 'healthy-recipes', source: 'seed' },
    { access: 'public', active: true, icon: 'guide', id: 'clinic-guide', source: 'seed' },
    { access: 'clients', active: true, icon: 'featured', id: 'client-resources', source: 'seed' },
  ]);
  assert.match(hashCatalogMigrationPlan(plan), /^[a-f0-9]{64}$/u);
  assert.equal(hashCatalogMigrationPlan(plan), hashCatalogMigrationPlan(plan));
});

test('legacy drafts import only compatible CaboHealth miniapps as inactive and report every skip', async () => {
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
    '_private_catalog_drafts/dr_00000000000000000000000000000000': legacyDraft({
      draftId: 'dr_00000000000000000000000000000000',
      url: 'https://cabohealth.org/apps/sleep-guide/',
    }),
    '_private_catalog_drafts/dr_11111111111111111111111111111111': legacyDraft({
      draftId: 'dr_11111111111111111111111111111111',
      url: 'https://cabohealth.org/apps/sleep-guide/',
    }),
    '_private_catalog_drafts/dr_22222222222222222222222222222222': legacyDraft({
      draftId: 'dr_22222222222222222222222222222222',
      url: 'https://example.com/apps/external/',
    }),
    '_private_catalog_drafts/dr_33333333333333333333333333333333': legacyDraft({
      draftId: 'dr_33333333333333333333333333333333',
      status: 'archived',
      url: 'https://cabohealth.org/apps/archived/',
    }),
    '_private_catalog_drafts/dr_44444444444444444444444444444444': {
      malformed: true,
    },
    '_private_catalog_drafts/dr_55555555555555555555555555555555': legacyDraft({
      draftId: 'dr_55555555555555555555555555555555',
      url: 'https://cabohealth.org/apps/healthy-recipes/',
    }),
    '_private_catalog_drafts/dr_66666666666666666666666666666666': {
      ...legacyDraft({
        draftId: 'dr_66666666666666666666666666666666',
        url: 'https://cabohealth.org/apps/control-copy/',
      }),
      title: { en: '\nSleep Guide', 'es-MX': 'Guía del sueño' },
    },
    '_private_catalog_drafts/dr_77777777777777777777777777777777': legacyDraft({
      draftId: 'dr_77777777777777777777777777777777',
      url: `https://cabohealth.org/apps/${'a'.repeat(65)}/`,
    }),
    '_private_catalog_drafts/dr_88888888888888888888888888888888': legacyDraft({
      draftId: 'dr_88888888888888888888888888888888',
      url: 'https://cabohealth.org/apps/app-review/',
    }),
    '_private_catalog_drafts/dr_99999999999999999999999999999999': legacyDraft({
      draftId: 'dr_99999999999999999999999999999999',
      url: 'https://cabohealth.org/apps/shared/',
    }),
    '_private_catalog_drafts/dr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': legacyDraft({
      draftId: 'dr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      url: 'https://cabohealth.org/apps/client-resources/',
    }),
  });
  const plan = await createCatalogMigrationPlan({
    catalog: new CatalogAdminService({ store: new FirestoreCatalogStore(database) }),
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });

  const imported = plan.operations.find(({ source }) => source === 'legacy-draft');
  assert.equal(imported?.item.url, 'https://cabohealth.org/apps/sleep-guide/');
  assert.equal(imported?.item.active, false);
  assert.equal(imported?.sourceDraftId, 'dr_00000000000000000000000000000000');
  assert.deepEqual(plan.skips, [
    { draftId: 'dr_11111111111111111111111111111111', reason: 'duplicate-draft-id' },
    { draftId: 'dr_22222222222222222222222222222222', reason: 'external-url' },
    { draftId: 'dr_33333333333333333333333333333333', reason: 'archived' },
    { draftId: 'dr_44444444444444444444444444444444', reason: 'incompatible' },
    { draftId: 'dr_55555555555555555555555555555555', reason: 'seed-id' },
    { draftId: 'dr_66666666666666666666666666666666', reason: 'incompatible' },
    { draftId: 'dr_77777777777777777777777777777777', reason: 'incompatible' },
    { draftId: 'dr_88888888888888888888888888888888', reason: 'incompatible' },
    { draftId: 'dr_99999999999999999999999999999999', reason: 'incompatible' },
    { draftId: 'dr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', reason: 'incompatible' },
  ]);
});

test('apply verifies the owner, seeds through audited idempotent catalog mutations, then promotes permission atomically', async () => {
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
  }, { rejectDuplicateWrites: true });
  const catalog = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });
  const plan = await createCatalogMigrationPlan({
    catalog,
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });
  const owner = async () => Object.freeze({
    disabled: false,
    emailVerified: true,
    factorCount: 0,
    providerIds: Object.freeze(['password']),
  });

  const evidence = await applyCatalogMigrationPlan({
    catalog,
    database,
    loadOwner: owner,
    plan,
    projectId: 'cabohealth-owner-prod',
    reviewedPlanSha256: hashCatalogMigrationPlan(plan),
  });
  await assert.doesNotReject(applyCatalogMigrationPlan({
    catalog,
    database,
    loadOwner: owner,
    plan,
    projectId: 'cabohealth-owner-prod',
    reviewedPlanSha256: hashCatalogMigrationPlan(plan),
  }));

  assert.equal(evidence.status, 'applied');
  assert.equal(JSON.stringify(evidence).includes(OWNER_UID), false);
  assert.equal(JSON.stringify(evidence).includes('Healthy Recipes'), false);
  assert.equal((await catalog.list()).length, 3);
  assert.equal((await database.listCollection('_private_audit_events')).length, 3);
  assert.deepEqual(
    JSON.parse(database.serializedState())[`_private_admins/${OWNER_UID}`],
    {
      active: true,
      permissions: [
        'client_codes',
        'client_resource_drafts',
        'client_resource_publish',
        'app_review_credential',
      ],
      schemaVersion: 1,
      scope: 'production',
    },
  );
});

test('apply rejects hash, owner, admin, or source drift before any catalog write', async () => {
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
  });
  const catalog = new CatalogAdminService({ store: new FirestoreCatalogStore(database) });
  const plan = await createCatalogMigrationPlan({
    catalog,
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });
  const initialState = database.serializedState();
  const validOwner = async () => ({
    disabled: false,
    emailVerified: true,
    factorCount: 0,
    providerIds: ['password'],
  });

  await assert.rejects(applyCatalogMigrationPlan({
    catalog,
    database,
    loadOwner: validOwner,
    plan,
    projectId: 'cabohealth-owner-prod',
    reviewedPlanSha256: '0'.repeat(64),
  }), /catalog_migration_apply_not_authorized/u);
  await assert.rejects(applyCatalogMigrationPlan({
    catalog,
    database,
    loadOwner: async () => ({
      disabled: false,
      emailVerified: true,
      factorCount: 1,
      providerIds: ['password'],
    }),
    plan,
    projectId: 'cabohealth-owner-prod',
    reviewedPlanSha256: hashCatalogMigrationPlan(plan),
  }), /catalog_migration_owner_not_ready/u);
  assert.equal(database.serializedState(), initialState);

  await database.runTransaction(async (transaction) => {
    transaction.create('_private_catalog_drafts/dr_99999999999999999999999999999999', legacyDraft({
      draftId: 'dr_99999999999999999999999999999999',
      url: 'https://cabohealth.org/apps/late-draft/',
    }));
  });
  const driftedState = database.serializedState();
  await assert.rejects(applyCatalogMigrationPlan({
    catalog,
    database,
    loadOwner: validOwner,
    plan,
    projectId: 'cabohealth-owner-prod',
    reviewedPlanSha256: hashCatalogMigrationPlan(plan),
  }), /catalog_migration_source_drift/u);
  assert.equal(database.serializedState(), driftedState);
});

test('reviewed plan parser accepts only the exact canonical schema and rejects shaped mutations', async () => {
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
  });
  const plan = await createCatalogMigrationPlan({
    catalog: new CatalogAdminService({ store: new FirestoreCatalogStore(database) }),
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });

  assert.deepEqual(parseCatalogMigrationPlan(JSON.parse(JSON.stringify(plan))), plan);
  for (const candidate of [
    { ...plan, extra: true },
    { ...plan, projectId: 'cabohealth-owner-staging' },
    { ...plan, preexistingCatalogSha256: '0'.repeat(64) },
    { ...plan, operations: [...plan.operations].reverse() },
    {
      ...plan,
      operations: plan.operations.map((operation, index) => index === 0
        ? { ...operation, requestId: '00000000-0000-4000-8000-000000000000' }
        : operation),
    },
    {
      ...plan,
      operations: plan.operations.map((operation, index) => index === 0
        ? {
          ...operation,
          item: {
            ...operation.item,
            title: { ...operation.item.title, en: ` ${operation.item.title.en}` },
          },
        }
        : operation),
    },
  ]) {
    assert.throws(
      () => parseCatalogMigrationPlan(candidate),
      /catalog_migration_plan_invalid/u,
    );
  }
});

test('migration never overwrites exact preexisting seed or unrelated catalog IDs', async () => {
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
  });
  const catalog = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });
  const emptyPlan = await createCatalogMigrationPlan({
    catalog,
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });
  const healthySeed = emptyPlan.operations[0]!.item;
  const healthy = await catalog.create(healthySeed, mutation(1));
  const existing = await catalog.create({
    access: 'public',
    active: false,
    icon: 'wellness',
    summary: { en: 'Existing copy.', 'es-MX': 'Contenido existente.' },
    title: { en: 'Existing', 'es-MX': 'Existente' },
    url: 'https://cabohealth.org/apps/existing/',
  }, mutation(2));
  await database.runTransaction(async (transaction) => {
    transaction.create('_private_catalog_drafts/dr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', legacyDraft({
      draftId: 'dr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      url: existing.url,
    }));
  });

  const plan = await createCatalogMigrationPlan({
    catalog,
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });
  assert.deepEqual(plan.skips, [{
    draftId: 'dr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    reason: 'existing-id',
  }]);
  await applyCatalogMigrationPlan({
    catalog,
    database,
    loadOwner: async () => ({
      disabled: false,
      emailVerified: true,
      factorCount: 0,
      providerIds: ['password'],
    }),
    plan,
    projectId: 'cabohealth-owner-prod',
    reviewedPlanSha256: hashCatalogMigrationPlan(plan),
  });
  assert.deepEqual((await catalog.list()).find(({ id }) => id === healthy.id), healthy);
  assert.deepEqual((await catalog.list()).find(({ id }) => id === existing.id), existing);
});

test('migration enforces the twelve-item total while reporting overflow drafts', async () => {
  const database = new InMemoryDocumentDatabase({
    [`_private_admins/${OWNER_UID}`]: LEGACY_ADMIN,
  });
  const catalog = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });
  for (let index = 0; index < 9; index += 1) {
    await catalog.create({
      access: 'public',
      active: false,
      icon: 'wellness',
      summary: { en: `Existing ${index}.`, 'es-MX': `Existente ${index}.` },
      title: { en: `Existing ${index}`, 'es-MX': `Existente ${index}` },
      url: `https://cabohealth.org/apps/existing-${index}/`,
    }, mutation(10 + index));
  }
  await database.runTransaction(async (transaction) => {
    transaction.create('_private_catalog_drafts/dr_cccccccccccccccccccccccccccccccc', legacyDraft({
      draftId: 'dr_cccccccccccccccccccccccccccccccc',
      url: 'https://cabohealth.org/apps/overflow/',
    }));
  });

  const plan = await createCatalogMigrationPlan({
    catalog,
    database,
    ownerUid: OWNER_UID,
    projectId: 'cabohealth-owner-prod',
  });
  assert.equal(new Set([
    ...plan.preexistingCatalog.map(({ id }) => id),
    ...plan.operations.map(({ item }) => new URL(item.url).pathname.split('/').filter(Boolean).at(-1)),
  ]).size, 12);
  assert.deepEqual(plan.skips, [{
    draftId: 'dr_cccccccccccccccccccccccccccccccc',
    reason: 'catalog-limit',
  }]);
});

function mutation(suffix: number): Readonly<{ actorUid: string; requestId: string }> {
  return Object.freeze({
    actorUid: OWNER_UID,
    requestId: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
  });
}

function legacyDraft(input: Readonly<{
  draftId: string;
  status?: 'draft' | 'archived';
  url: string;
}>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    access: 'public',
    createdAtMs: 1_700_000_000_000,
    draftId: input.draftId,
    icon: 'wellness',
    revision: 1,
    schemaVersion: 1,
    status: input.status ?? 'draft',
    summary: Object.freeze({ en: 'Sleep support.', 'es-MX': 'Apoyo para dormir.' }),
    title: Object.freeze({ en: 'Sleep Guide', 'es-MX': 'Guía del sueño' }),
    updatedAtMs: 1_700_000_000_000,
    url: input.url,
  });
}
