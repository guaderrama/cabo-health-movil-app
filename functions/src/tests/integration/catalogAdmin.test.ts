import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CatalogAdminService,
  CatalogConflictError,
  CatalogInputError,
  type CatalogItemInput,
} from '../../domain/catalogAdmin.js';
import { CatalogDraftAdminService } from '../../domain/catalogDraftAdmin.js';
import { FirestoreCatalogDraftStore } from '../../repositories/firestoreCatalogDraftStore.js';
import { FirestoreCatalogStore } from '../../repositories/firestoreCatalogStore.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const mutation = (suffix: number) => Object.freeze({
  actorUid: 'owner_1234567890',
  requestId: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
});

const activePublicMiniapp: CatalogItemInput = Object.freeze({
  access: 'public',
  active: true,
  icon: 'recipes',
  summary: Object.freeze({
    en: 'Practical recipes for everyday wellbeing.',
    'es-MX': 'Recetas prácticas para el bienestar diario.',
  }),
  title: Object.freeze({ en: 'Healthy Recipes', 'es-MX': 'Recetas saludables' }),
  url: 'https://cabohealth.org/apps/healthy-recipes/',
});

const activeClientMiniapp: CatalogItemInput = Object.freeze({
  ...activePublicMiniapp,
  access: 'clients',
  icon: 'featured',
  title: Object.freeze({ en: 'VIP Library', 'es-MX': 'Biblioteca VIP' }),
  url: 'https://cabohealth.org/apps/vip-library/',
});

test('owner creates an active miniapp and it is immediately present in the runtime catalog', async () => {
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });

  const created = await service.create(activePublicMiniapp, mutation(1));

  assert.deepEqual(created, {
    ...activePublicMiniapp,
    id: 'healthy-recipes',
    revision: 1,
    createdAtMs: 1_800_000_000_000,
    updatedAtMs: 1_800_000_000_000,
  });
  assert.deepEqual(await service.listActive(), [created]);
});

test('owner deactivates a miniapp and it disappears from the runtime catalog immediately', async () => {
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const created = await service.create(activePublicMiniapp, mutation(2));

  const deactivated = await service.setActive(created.id, created.revision, false, mutation(3));

  assert.equal(deactivated.active, false);
  assert.equal(deactivated.revision, 2);
  assert.deepEqual(await service.listActive(), []);
});

test('owner still sees inactive miniapps in the management catalog', async () => {
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const created = await service.create(activePublicMiniapp, mutation(4));

  const deactivated = await service.setActive(created.id, created.revision, false, mutation(5));

  assert.deepEqual(await service.list(), [deactivated]);
});

test('owner permanently deletes a miniapp from management and runtime catalogs', async () => {
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const created = await service.create(activePublicMiniapp, mutation(6));

  await service.delete(created.id, created.revision, mutation(7));

  assert.deepEqual(await service.list(), []);
  assert.deepEqual(await service.listActive(), []);
});

test('owner edits an active miniapp and the runtime catalog reflects the new bilingual copy', async () => {
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const created = await service.create(activePublicMiniapp, mutation(8));

  const updated = await service.update(created.id, created.revision, {
    access: created.access,
    icon: 'nutrition',
    summary: created.summary,
    title: { en: 'Everyday Recipes', 'es-MX': 'Recetas para cada día' },
    url: created.url,
  }, mutation(9));

  assert.equal(updated.revision, 2);
  assert.equal(updated.active, true);
  assert.deepEqual((await service.listActive())[0]?.title, {
    en: 'Everyday Recipes',
    'es-MX': 'Recetas para cada día',
  });
});

test('retrying an owner mutation reuses its exact committed result without duplicate writes', async () => {
  const database = new InMemoryDocumentDatabase({}, { rejectDuplicateWrites: true });
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(database),
  });
  const context = mutation(10);

  const first = await service.create(activePublicMiniapp, context);
  const retry = await service.create(activePublicMiniapp, context);

  assert.deepEqual(retry, first);
  assert.deepEqual(await service.list(), [first]);
  const state = database.serializedState();
  assert.equal((await database.listCollection('_private_audit_events')).length, 1);
  assert.match(state, /_private_catalog_requests\/00000000-0000-4000-8000-000000000010/u);
});

test('client miniapps are materialized for secure grants but excluded from the public catalog', async () => {
  const database = new InMemoryDocumentDatabase({}, { rejectReadsAfterWrites: true });
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(database),
  });
  const clientInput: CatalogItemInput = Object.freeze({
    ...activePublicMiniapp,
    access: 'clients',
    icon: 'featured',
    title: Object.freeze({ en: 'VIP Library', 'es-MX': 'Biblioteca VIP' }),
    url: 'https://cabohealth.org/apps/vip-library/',
  });

  const created = await service.create(clientInput, mutation(11));

  assert.deepEqual((await service.publishedCatalog()).items, []);
  const resource = await database.listCollection('_private_client_resources');
  assert.deepEqual(resource, [{
    id: 'vip-library',
    value: {
      access: 'client',
      iconKey: 'sparkles-outline',
      id: 'vip-library',
      schemaVersion: 1,
      status: 'active',
      summary: {
        en: clientInput.summary.en,
        es: clientInput.summary['es-MX'],
      },
      title: { en: 'VIP Library', es: 'Biblioteca VIP' },
    },
  }]);

  await service.setActive(created.id, created.revision, false, mutation(12));
  assert.deepEqual(await database.listCollection('_private_client_resources'), []);
});

test('creating a client miniapp rejects a drifted preexisting projection atomically', async () => {
  const database = new InMemoryDocumentDatabase({
    '_private_client_resources/vip-library': {
      ...clientProjection(activeClientMiniapp),
      iconKey: 'malicious-drift',
    },
  });
  const before = database.serializedState();
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });

  await assert.rejects(
    service.create(activeClientMiniapp, mutation(25)),
    /invalid_client_resource_projection/u,
  );

  assert.equal(database.serializedState(), before);
  assert.deepEqual(await service.list(), []);
  assert.deepEqual(await database.listCollection('_private_audit_events'), []);
});

test('creating an inactive client miniapp rejects even an exact preexisting projection atomically', async () => {
  const inactiveClient = Object.freeze({ ...activeClientMiniapp, active: false });
  const database = new InMemoryDocumentDatabase({
    '_private_client_resources/vip-library': clientProjection(inactiveClient),
  });
  const before = database.serializedState();
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });

  await assert.rejects(
    service.create(inactiveClient, mutation(251)),
    /invalid_client_resource_projection/u,
  );

  assert.equal(database.serializedState(), before);
  assert.deepEqual(await service.list(), []);
  assert.deepEqual(await database.listCollection('_private_audit_events'), []);
});

test('client-resources migrates only the exact bootstrap featured projection to sparkles', async () => {
  const clientResources: CatalogItemInput = Object.freeze({
    access: 'clients',
    active: true,
    icon: 'featured',
    summary: Object.freeze({
      en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
      'es-MX': 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
    }),
    title: Object.freeze({ en: 'Client Resources', 'es-MX': 'Recursos para clientes' }),
    url: 'https://cabohealth.org/apps/client-resources/',
  });
  const legacy = {
    ...clientProjection(clientResources),
    iconKey: 'featured',
  };
  const database = new InMemoryDocumentDatabase({
    '_private_client_resources/client-resources': legacy,
  });
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });

  await service.create(clientResources, mutation(26));

  assert.deepEqual(await database.listCollection('_private_client_resources'), [{
    id: 'client-resources',
    value: clientProjection(clientResources),
  }]);
});

test('updating or deleting an active client miniapp rejects projection drift atomically', async () => {
  for (const action of ['update', 'delete'] as const) {
    const database = new InMemoryDocumentDatabase();
    const service = new CatalogAdminService({
      nowMs: () => 1_800_000_000_000,
      store: new FirestoreCatalogStore(database),
    });
    const created = await service.create(activeClientMiniapp, mutation(action === 'update' ? 27 : 29));
    await database.runTransaction(async (transaction) => {
      transaction.set('_private_client_resources/vip-library', {
        ...clientProjection(activeClientMiniapp),
        title: { en: 'Drifted', es: 'Alterado' },
      });
    });
    const before = database.serializedState();

    const operation = action === 'update'
      ? service.update(created.id, created.revision, {
        access: created.access,
        icon: created.icon,
        summary: created.summary,
        title: { en: 'Updated Library', 'es-MX': 'Biblioteca actualizada' },
        url: created.url,
      }, mutation(28))
      : service.delete(created.id, created.revision, mutation(30));
    await assert.rejects(operation, /invalid_client_resource_projection/u);

    assert.equal(database.serializedState(), before);
    assert.deepEqual(await service.list(), [created]);
  }
});

test('deleting an inactive legacy client item removes its exact orphaned projection', async () => {
  const inactiveClient = Object.freeze({ ...activeClientMiniapp, active: false });
  const orphan = clientProjection(inactiveClient);
  const database = new InMemoryDocumentDatabase();
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });
  const created = await service.create(inactiveClient, mutation(31));
  await database.runTransaction(async (transaction) => {
    transaction.set('_private_client_resources/vip-library', orphan);
  });

  await service.delete(created.id, created.revision, mutation(32));

  assert.deepEqual(await service.list(), []);
  assert.deepEqual(await database.listCollection('_private_client_resources'), []);
});

test('deleting an inactive client item rejects a drifted orphan atomically', async () => {
  const inactiveClient = Object.freeze({ ...activeClientMiniapp, active: false });
  const database = new InMemoryDocumentDatabase();
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });
  const created = await service.create(inactiveClient, mutation(321));
  await database.runTransaction(async (transaction) => {
    transaction.set('_private_client_resources/vip-library', {
      ...clientProjection(inactiveClient),
      iconKey: 'malicious-drift',
    });
  });
  const before = database.serializedState();

  await assert.rejects(
    service.delete(created.id, created.revision, mutation(322)),
    /invalid_client_resource_projection/u,
  );

  assert.equal(database.serializedState(), before);
  assert.deepEqual(await service.list(), [created]);
});

test('activation and deactivation both reject a drifted client projection atomically', async () => {
  for (const action of ['activate', 'deactivate'] as const) {
    const database = new InMemoryDocumentDatabase();
    const service = new CatalogAdminService({
      nowMs: () => 1_800_000_000_000,
      store: new FirestoreCatalogStore(database),
    });
    const input = action === 'activate'
      ? Object.freeze({ ...activeClientMiniapp, active: false })
      : activeClientMiniapp;
    const created = await service.create(input, mutation(action === 'activate' ? 33 : 35));
    await database.runTransaction(async (transaction) => {
      transaction.set('_private_client_resources/vip-library', {
        ...clientProjection(activeClientMiniapp),
        summary: { en: 'Drifted', es: 'Alterado' },
      });
    });
    const before = database.serializedState();

    await assert.rejects(
      service.setActive(
        created.id,
        created.revision,
        action === 'activate',
        mutation(action === 'activate' ? 34 : 36),
      ),
      /invalid_client_resource_projection/u,
    );
    assert.equal(database.serializedState(), before);
    assert.deepEqual(await service.list(), [created]);
  }
});

test('stale revisions and request-id reuse with different payloads are rejected atomically', async () => {
  const database = new InMemoryDocumentDatabase();
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(database),
  });
  const created = await service.create(activePublicMiniapp, mutation(13));
  const deactivated = await service.setActive(created.id, created.revision, false, mutation(14));

  await assert.rejects(
    service.setActive(created.id, created.revision, true, mutation(15)),
    CatalogConflictError,
  );
  await assert.rejects(
    service.setActive(deactivated.id, deactivated.revision, true, mutation(14)),
    CatalogConflictError,
  );
  assert.equal((await service.list())[0]?.active, false);
});

test('catalog input rejects external, ambiguous, non-canonical, and id-changing URLs', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  for (const url of [
    'http://cabohealth.org/apps/healthy-recipes/',
    'https://www.cabohealth.org/apps/healthy-recipes/',
    'https://cabohealth.org/apps/healthy-recipes',
    'https://cabohealth.org/apps/healthy-recipes/?preview=1',
    'https://cabohealth.org/apps/%68ealthy-recipes/',
    'https://cabohealth.org/apps/healthy-recipes//',
  ]) {
    await assert.rejects(
      service.create({ ...activePublicMiniapp, url }, mutation(16)),
      CatalogInputError,
    );
  }
  const created = await service.create(activePublicMiniapp, mutation(17));
  await assert.rejects(service.update(created.id, created.revision, {
    access: created.access,
    icon: created.icon,
    summary: created.summary,
    title: created.title,
    url: 'https://cabohealth.org/apps/renamed/',
  }, mutation(18)), CatalogInputError);
});

test('catalog input rejects control characters that would invalidate the native snapshot', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });

  for (const invalidCopy of ['Line one\nLine two', 'Tabbed\tcopy', `Hidden${String.fromCharCode(0x7f)}copy`]) {
    await assert.rejects(service.create({
      ...activePublicMiniapp,
      summary: { ...activePublicMiniapp.summary, en: invalidCopy },
    }, mutation(20)), CatalogInputError);
  }
});

test('catalog input reserves infrastructure slugs and keeps the broker root client-only', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });

  for (const url of [
    'https://cabohealth.org/apps/app-review/',
    'https://cabohealth.org/apps/shared/',
  ]) {
    await assert.rejects(
      service.create({ ...activePublicMiniapp, url }, mutation(22)),
      CatalogInputError,
    );
  }
  await assert.rejects(service.create({
    ...activePublicMiniapp,
    url: 'https://cabohealth.org/apps/client-resources/',
  }, mutation(23)), CatalogInputError);
});

test('catalog mutations retain internal actor attribution but expose only sanitized Staff audit', async () => {
  const database = new InMemoryDocumentDatabase();
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_000,
    store: new FirestoreCatalogStore(database),
  });
  await service.create(activePublicMiniapp, mutation(24));

  const events = await new CatalogDraftAdminService({
    store: new FirestoreCatalogDraftStore(database),
  }).listAudit();

  assert.deepEqual(events, [{
    action: 'miniapp.created',
    actorLabel: 'Staff',
    eventId: 'evt_00000000000040008000000000000024',
    occurredAtMs: 1_800_000_000_000,
    outcome: 'success',
    targetSuffix: 'lthy-recipes',
  }]);
  assert.equal(JSON.stringify(events).includes('owner_1234567890'), false);
  assert.match(database.serializedState(), /owner_1234567890/u);
});

function clientProjection(input: CatalogItemInput): Readonly<Record<string, unknown>> {
  const id = new URL(input.url).pathname.split('/').filter(Boolean).at(-1);
  return Object.freeze({
    access: 'client',
    iconKey: 'sparkles-outline',
    id,
    schemaVersion: 1,
    status: 'active',
    summary: Object.freeze({ en: input.summary.en, es: input.summary['es-MX'] }),
    title: Object.freeze({ en: input.title.en, es: input.title['es-MX'] }),
  });
}
