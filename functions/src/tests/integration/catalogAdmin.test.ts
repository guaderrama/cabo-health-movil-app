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

test('published showcase returns public items plus sanitized previews without changing the legacy catalog', async () => {
  const service = new CatalogAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const clientToolkit: CatalogItemInput = Object.freeze({
    ...activeClientMiniapp,
    icon: 'guide',
    summary: Object.freeze({
      en: 'Private guidance for active CaboHealth clients.',
      'es-MX': 'Orientación privada para clientes activos de CaboHealth.',
    }),
    title: Object.freeze({ en: 'Client Toolkit', 'es-MX': 'Kit para clientes' }),
    url: 'https://cabohealth.org/apps/client-toolkit/',
  });
  const inactiveClient: CatalogItemInput = Object.freeze({
    ...activeClientMiniapp,
    active: false,
    title: Object.freeze({ en: 'Inactive Client App', 'es-MX': 'App inactiva para clientes' }),
    url: 'https://cabohealth.org/apps/inactive-client-app/',
  });

  const publicItem = await service.create(activePublicMiniapp, mutation(111));
  await service.create(activeClientMiniapp, mutation(112));
  await service.create(clientToolkit, mutation(113));
  await service.create(inactiveClient, mutation(114));

  assert.deepEqual(await service.publishedCatalog(), {
    items: [publicItem],
    revision: 4,
    updatedAtMs: 1_800_000_000_003,
  });
  assert.deepEqual(await service.publishedShowcaseCatalog(), {
    clientPreviews: [
      {
        access: 'clients',
        icon: 'featured',
        id: 'vip-library',
        summary: {
          en: 'Practical recipes for everyday wellbeing.',
          'es-MX': 'Recetas prácticas para el bienestar diario.',
        },
        title: { en: 'VIP Library', 'es-MX': 'Biblioteca VIP' },
      },
      {
        access: 'clients',
        icon: 'guide',
        id: 'client-toolkit',
        summary: {
          en: 'Private guidance for active CaboHealth clients.',
          'es-MX': 'Orientación privada para clientes activos de CaboHealth.',
        },
        title: { en: 'Client Toolkit', 'es-MX': 'Kit para clientes' },
      },
    ],
    items: [publicItem],
    revision: 4,
    updatedAtMs: 1_800_000_000_003,
  });
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
      en: 'Educational resources for eligible existing CaboHealth clients.',
      'es-MX': 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
    }),
    title: Object.freeze({ en: 'Client Resources', 'es-MX': 'Recursos para clientes' }),
    url: 'https://cabohealth.org/apps/client-resources/',
  });
  const legacy = {
    ...clientProjection({
      ...clientResources,
      summary: Object.freeze({
        en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
        'es-MX': 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
      }),
    }),
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

test('client preview copy rejects operational details before any catalog write', async () => {
  const unsafeCopy = [
    ['title', 'en', 'Visit https://cabohealth.org/apps/vip-library/'],
    ['summary', 'es-MX', 'Contacto mailto:vip@cabohealth.org'],
    ['summary', 'en', 'Call tel:+526241234567 for access.'],
    ['summary', 'en', 'Run javascript:alert(1) after sign-in.'],
    ['summary', 'en', 'Open api/client/session after access.'],
    ['summary', 'en', 'Continue at broker/session after access.'],
    ['summary', 'en', 'Open client-resources/launch after access.'],
    ['summary', 'en', 'Open launch/session after access.'],
    ['summary', 'en', 'Open vip-library/launch after access.'],
    ['summary', 'en', 'Open app-review/launch after access.'],
    ['summary', 'en', 'Continue at client-resources?token=abc.'],
    ['summary', 'en', 'Continue at app-review?token=abc.'],
    ['summary', 'en', 'Open x:private-token after sign-in.'],
    ['summary', 'en', 'Learn more at www.cabohealth.org.'],
    ['summary', 'en', 'Connect to [::1].'],
    ['summary', 'en', 'Connect to ::1.'],
    ['summary', 'en', 'Connect to [::].'],
    ['summary', 'en', 'Connect to 0:0:0:0:0:0:0:1.'],
    ['summary', 'en', 'Connect to [0:0:0:0:0:0:0:0].'],
    ['summary', 'en', 'Connect to fd00::1.'],
    ['summary', 'en', 'Connect to fe80::1.'],
    ['summary', 'es-MX', 'Consulta cabohealth.org para continuar.'],
    ['summary', 'en', 'Open /apps/vip-library/launch/ after access.'],
    ['summary', 'es-MX', 'Carga private/production/vip-library/content.json.'],
    ['summary', 'en', 'Load \\private\\production\\vip-library\\content.json.'],
    ['summary', 'en', 'Load C:\\deploy\\vip.json.'],
    ['summary', 'es-MX', 'Carga /secrets/client.json.'],
    ['summary', 'en', 'Load /Volumes/Private/client.json.'],
    ['summary', 'es-MX', 'Carga /root/private/catalog.json.'],
    ['summary', 'en', 'Load /usr/local/private/catalog.json.'],
    ['summary', 'es-MX', 'Carga /Library/Application Support/private.json.'],
    ['summary', 'en', 'Use CH-ABCDEF01-23456789-A1B2C3D4-E5F60718.'],
    ['summary', 'es-MX', 'Usa ar\u201001234567\u201189ABCDEF\u201201234567\u221289ABCDEF.'],
    ['summary', 'en', 'Available for $99.'],
    ['summary', 'en', 'Available for 99 pounds.'],
    ['summary', 'en', 'Available for 99 dinars.'],
    ['summary', 'en', 'Available for 99 rials.'],
    ['summary', 'en', 'Available for 99 krone.'],
    ['summary', 'en', 'Available for 99 quetzal.'],
    ['summary', 'en', 'Available for 99 soles.'],
    ['summary', 'en', 'Available for 99 shillings.'],
    ['summary', 'en', 'Available for 99 naira.'],
    ['summary', 'en', 'Available for 99 cedis.'],
    ['summary', 'es-MX', 'Disponible por 99 bolivianos.'],
    ['summary', 'es-MX', 'Disponible por 99 colones.'],
    ['summary', 'en', 'Available for 99 BRL.'],
    ['summary', 'en', 'Available for 99 QAR.'],
    ['summary', 'en', 'Membership 99 qar.'],
    ['summary', 'en', 'Membership 99 xof.'],
    ['summary', 'en', 'Membership currency: XOF.'],
    ['summary', 'en', 'Membership 99 KWD.'],
    ['summary', 'en', 'BHD 20 membership.'],
    ['summary', 'es-MX', 'Disponible por MXN 1,500.'],
    ['summary', 'es-MX', 'Disponible por 99 libras.'],
    ['summary', 'es-MX', 'Disponible por 99 quetzales.'],
    ['summary', 'es-MX', 'Disponible por 1,500 reales.'],
    ['summary', 'en', 'Price: 99 per month.'],
    ['summary', 'es-MX', 'Precio 999 por mes.'],
    ['summary', 'en', 'Monthly membership.'],
    ['summary', 'es-MX', 'Membresía mensual.'],
    ['summary', 'es-MX', 'Beneficios mensuales.'],
    ['summary', 'en', 'Membership available.'],
    ['summary', 'en', 'Subscribe for access.'],
    ['summary', 'en', 'Purchase access.'],
    ['summary', 'en', 'Buy access.'],
    ['summary', 'en', 'Payment required.'],
    ['summary', 'en', 'Paid membership.'],
    ['summary', 'es-MX', 'Suscripción disponible.'],
    ['summary', 'es-MX', 'Comprar acceso.'],
    ['summary', 'es-MX', 'Pago requerido.'],
    ['summary', 'es-MX', 'Pagar para acceder.'],
    ['summary', 'en', 'Checkout available.'],
    ['summary', 'en', 'Billing available.'],
    ['summary', 'en', 'Billed annually.'],
    ['summary', 'en', 'No charge for access.'],
    ['summary', 'en', 'Sale available.'],
    ['summary', 'en', 'Sales available.'],
    ['summary', 'en', 'Free VIP access.'],
    ['summary', 'en', 'Free resource access.'],
    ['summary', 'en', 'Access is free.'],
    ['summary', 'en', 'Complimentary client access.'],
    ['summary', 'en', 'IAP available.'],
    ['summary', 'en', 'IAP enabled.'],
    ['summary', 'es-MX', 'Acceso gratis.'],
    ['summary', 'es-MX', 'Cobro anual.'],
    ['summary', 'es-MX', 'Venta disponible.'],
    ['summary', 'es-MX', 'Ventas disponibles.'],
    ['summary', 'es-MX', 'Facturación disponible.'],
    ['title', 'en', 'VIP\u200B Library'],
    ['title', 'es-MX', 'Biblioteca\u00ad VIP'],
    ['summary', 'en', 'VIP\u061C resources.'],
  ] as const;

  for (const [field, locale, text] of unsafeCopy) {
    const database = new InMemoryDocumentDatabase();
    const service = new CatalogAdminService({
      store: new FirestoreCatalogStore(database),
    });

    await assert.rejects(service.create({
      ...activeClientMiniapp,
      [field]: { ...activeClientMiniapp[field], [locale]: text },
    }, mutation(600)), CatalogInputError, `${field}.${locale}: ${text}`);
    assert.deepEqual(await service.list(), [], `${field}.${locale}: ${text}`);
  }
});

test('updating client preview copy rejects operational details atomically', async () => {
  const database = new InMemoryDocumentDatabase();
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(database),
  });
  const created = await service.create(activeClientMiniapp, mutation(601));

  await assert.rejects(service.update(created.id, created.revision, {
    access: created.access,
    icon: created.icon,
    summary: { ...created.summary, en: 'Open /api/client/session after access.' },
    title: created.title,
    url: created.url,
  }, mutation(602)), CatalogInputError);

  assert.deepEqual(await service.list(), [created]);
});

test('legacy unsafe inactive client copy remains visible and repairable without changing V1', async () => {
  const publicItem = Object.freeze({
    ...activePublicMiniapp,
    createdAtMs: 1_800_000_000_000,
    id: 'healthy-recipes',
    revision: 1,
    updatedAtMs: 1_800_000_000_000,
  });
  const unsafeClient = Object.freeze({
    ...activeClientMiniapp,
    active: false,
    createdAtMs: 1_800_000_000_000,
    id: 'vip-library',
    revision: 1,
    summary: Object.freeze({
      ...activeClientMiniapp.summary,
      en: 'Open /apps/vip-library/launch/ after access.',
    }),
    updatedAtMs: 1_800_000_000_000,
  });
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': {
      items: [publicItem, unsafeClient],
      revision: 2,
      schemaVersion: 1,
      updatedAtMs: 1_800_000_000_000,
    },
  });
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_001,
    store: new FirestoreCatalogStore(database),
  });

  assert.deepEqual(await service.list(), [publicItem, unsafeClient]);
  assert.deepEqual(await service.publishedCatalog(), {
    items: [publicItem],
    revision: 2,
    updatedAtMs: 1_800_000_000_000,
  });
  assert.deepEqual(await service.publishedShowcaseCatalog(), {
    clientPreviews: [],
    items: [publicItem],
    revision: 2,
    updatedAtMs: 1_800_000_000_000,
  });
  await assert.rejects(
    service.setActive(unsafeClient.id, unsafeClient.revision, true, mutation(603)),
    CatalogInputError,
  );

  const repaired = await service.update(unsafeClient.id, unsafeClient.revision, {
    access: unsafeClient.access,
    icon: unsafeClient.icon,
    summary: activeClientMiniapp.summary,
    title: unsafeClient.title,
    url: unsafeClient.url,
  }, mutation(606));
  const activated = await service.setActive(repaired.id, repaired.revision, true, mutation(607));

  assert.equal(activated.active, true);
  assert.deepEqual((await service.publishedShowcaseCatalog()).clientPreviews, [{
    access: 'clients',
    icon: 'featured',
    id: 'vip-library',
    summary: activeClientMiniapp.summary,
    title: unsafeClient.title,
  }]);
});

test('legacy unsafe active client copy fails V2 closed but remains deactivatable and deletable', async () => {
  const publicItem = Object.freeze({
    ...activePublicMiniapp,
    createdAtMs: 1_800_000_000_000,
    id: 'healthy-recipes',
    revision: 1,
    updatedAtMs: 1_800_000_000_000,
  });
  const unsafeClient = Object.freeze({
    ...activeClientMiniapp,
    createdAtMs: 1_800_000_000_000,
    id: 'vip-library',
    revision: 1,
    summary: Object.freeze({
      ...activeClientMiniapp.summary,
      en: 'Open /apps/vip-library/launch/ after access.',
    }),
    updatedAtMs: 1_800_000_000_000,
  });
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': {
      items: [publicItem, unsafeClient],
      revision: 2,
      schemaVersion: 1,
      updatedAtMs: 1_800_000_000_000,
    },
    '_private_client_resources/vip-library': {
      access: 'client',
      iconKey: 'sparkles-outline',
      id: 'vip-library',
      schemaVersion: 1,
      status: 'active',
      summary: {
        en: unsafeClient.summary.en,
        es: unsafeClient.summary['es-MX'],
      },
      title: {
        en: unsafeClient.title.en,
        es: unsafeClient.title['es-MX'],
      },
    },
  });
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_001,
    store: new FirestoreCatalogStore(database),
  });

  assert.deepEqual((await service.publishedCatalog()).items, [publicItem]);
  await assert.rejects(service.publishedShowcaseCatalog(), CatalogInputError);
  const deactivated = await service.setActive(unsafeClient.id, unsafeClient.revision, false, mutation(608));
  await service.delete(deactivated.id, deactivated.revision, mutation(609));

  assert.deepEqual(await service.list(), [publicItem]);
});

test('the exact active client-resources legacy record publishes a neutral V2 teaser without mutating storage', async () => {
  const publicItem = Object.freeze({
    ...activePublicMiniapp,
    createdAtMs: 1_800_000_000_000,
    id: 'healthy-recipes',
    revision: 1,
    updatedAtMs: 1_800_000_000_000,
  });
  const legacySummary = Object.freeze({
    en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
    'es-MX': 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
  });
  const neutralSummary = Object.freeze({
    en: 'Educational resources for eligible existing CaboHealth clients.',
    'es-MX': 'Recursos educativos para clientes actuales elegibles de CaboHealth.',
  });
  const legacyClientResources = Object.freeze({
    access: 'clients' as const,
    active: true,
    createdAtMs: 1_800_000_000_000,
    icon: 'featured' as const,
    id: 'client-resources',
    revision: 1,
    summary: legacySummary,
    title: Object.freeze({ en: 'Client Resources', 'es-MX': 'Recursos para clientes' }),
    updatedAtMs: 1_800_000_000_000,
    url: 'https://cabohealth.org/apps/client-resources/',
  });
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': {
      items: [publicItem, legacyClientResources],
      revision: 2,
      schemaVersion: 1,
      updatedAtMs: 1_800_000_000_000,
    },
    '_private_client_resources/client-resources': {
      access: 'client',
      iconKey: 'featured',
      id: 'client-resources',
      schemaVersion: 1,
      status: 'active',
      summary: {
        en: legacySummary.en,
        es: legacySummary['es-MX'],
      },
      title: { en: 'Client Resources', es: 'Recursos para clientes' },
    },
  });
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_001,
    store: new FirestoreCatalogStore(database),
  });
  const beforePublish = database.serializedState();

  assert.deepEqual(await service.list(), [publicItem, legacyClientResources]);
  assert.deepEqual((await service.publishedCatalog()).items, [publicItem]);
  assert.deepEqual(await service.publishedShowcaseCatalog(), {
    clientPreviews: [{
      access: 'clients',
      icon: 'featured',
      id: 'client-resources',
      summary: neutralSummary,
      title: legacyClientResources.title,
    }],
    items: [publicItem],
    revision: 2,
    updatedAtMs: 1_800_000_000_000,
  });
  assert.equal(database.serializedState(), beforePublish);

  const deactivated = await service.setActive(
    legacyClientResources.id,
    legacyClientResources.revision,
    false,
    mutation(630),
  );
  const repaired = await service.update(deactivated.id, deactivated.revision, {
    access: deactivated.access,
    icon: deactivated.icon,
    summary: neutralSummary,
    title: deactivated.title,
    url: deactivated.url,
  }, mutation(631));
  const reactivated = await service.setActive(repaired.id, repaired.revision, true, mutation(632));

  assert.equal(reactivated.active, true);
  assert.deepEqual((await service.publishedShowcaseCatalog()).clientPreviews[0]?.summary, neutralSummary);
});

test('an exact legacy projection cannot mask drift in the active client-resources catalog item', async () => {
  const driftedClientResources = Object.freeze({
    access: 'clients' as const,
    active: true,
    createdAtMs: 1_800_000_000_000,
    icon: 'featured' as const,
    id: 'client-resources',
    revision: 1,
    summary: Object.freeze({
      en: 'Complimentary educational resources for eligible existing CaboHealth client.',
      'es-MX': 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
    }),
    title: Object.freeze({ en: 'Client Resources', 'es-MX': 'Recursos para clientes' }),
    updatedAtMs: 1_800_000_000_000,
    url: 'https://cabohealth.org/apps/client-resources/',
  });
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': {
      items: [driftedClientResources],
      revision: 1,
      schemaVersion: 1,
      updatedAtMs: 1_800_000_000_000,
    },
    '_private_client_resources/client-resources': {
      access: 'client',
      iconKey: 'featured',
      id: 'client-resources',
      schemaVersion: 1,
      status: 'active',
      summary: {
        en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
        es: 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
      },
      title: { en: 'Client Resources', es: 'Recursos para clientes' },
    },
  });
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_001,
    store: new FirestoreCatalogStore(database),
  });
  const before = database.serializedState();

  await assert.rejects(service.publishedShowcaseCatalog(), CatalogInputError);
  await assert.rejects(
    service.setActive('client-resources', 1, false, mutation(633)),
    /invalid_client_resource_projection/u,
  );
  assert.equal(database.serializedState(), before);
  assert.deepEqual(await service.list(), [driftedClientResources]);
});

test('legacy sensitive client id remains visible to V1 and deletable while activation fails closed', async () => {
  const publicItem = Object.freeze({
    ...activePublicMiniapp,
    createdAtMs: 1_800_000_000_000,
    id: 'healthy-recipes',
    revision: 1,
    updatedAtMs: 1_800_000_000_000,
  });
  const sensitiveId = 'ch-abcdef01-23456789-a1b2c3d4-e5f60718';
  const legacyClient = Object.freeze({
    ...activeClientMiniapp,
    active: false,
    createdAtMs: 1_800_000_000_000,
    id: sensitiveId,
    revision: 1,
    updatedAtMs: 1_800_000_000_000,
    url: `https://cabohealth.org/apps/${sensitiveId}/`,
  });
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': {
      items: [publicItem, legacyClient],
      revision: 2,
      schemaVersion: 1,
      updatedAtMs: 1_800_000_000_000,
    },
  });
  const service = new CatalogAdminService({
    nowMs: () => 1_800_000_000_001,
    store: new FirestoreCatalogStore(database),
  });

  assert.deepEqual(await service.list(), [publicItem, legacyClient]);
  assert.deepEqual((await service.publishedCatalog()).items, [publicItem]);
  assert.deepEqual((await service.publishedShowcaseCatalog()).clientPreviews, []);
  await assert.rejects(
    service.setActive(legacyClient.id, legacyClient.revision, true, mutation(623)),
    CatalogInputError,
  );
  await service.delete(legacyClient.id, legacyClient.revision, mutation(624));

  assert.deepEqual(await service.list(), [publicItem]);
});

test('client preview copy allows benign private language without operational syntax', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const safeClient = Object.freeze({
    ...activeClientMiniapp,
    summary: Object.freeze({
      en: 'CHF Guide for CAD prevention, CRC screening, INR monitoring, and care related to SLE, SLL, or STD. GHS reference. Available for 10 minutes per day; use 10 min at 100 bpm for up to 10 hrs and lose 10 pounds safely. Client access is VIP.',
      'es-MX': 'Disponible por 10 minutos al día; entrena con pesos libres una vez por semana.',
    }),
    title: Object.freeze({ en: 'Private VIP Test: AED Training', 'es-MX': 'Prueba VIP privada' }),
  });

  const created = await service.create(safeClient, mutation(604));

  assert.deepEqual(created.summary, safeClient.summary);
  assert.deepEqual(created.title, safeClient.title);

  const safeFreeLanguage = Object.freeze({
    ...activeClientMiniapp,
    summary: Object.freeze({
      en: 'Free weights for VIP clients and sugar-free nutrition support clinical care.',
      'es-MX': 'Consejos para cuando sales a caminar. Pesos libres para clientes VIP apoyan el cuidado clínico.',
    }),
    title: Object.freeze({ en: 'Free weights guide', 'es-MX': 'Guía de pesos libres' }),
    url: 'https://cabohealth.org/apps/free-weights-guide/',
  });
  const createdFreeLanguage = await service.create(safeFreeLanguage, mutation(605));

  assert.deepEqual(createdFreeLanguage.summary, safeFreeLanguage.summary);
  assert.deepEqual(createdFreeLanguage.title, safeFreeLanguage.title);

  const safeFreeWeightResource = Object.freeze({
    ...activeClientMiniapp,
    summary: Object.freeze({
      en: 'A resource about free weights. Try 10 minutes of 10 real-world exercises. Ratios 1:2 and times 10:30 or 10:30:00 support clinical guidance.',
      'es-MX': 'Un recurso sobre ejercicios con pesos libres.',
    }),
    title: Object.freeze({ en: 'Free weights resource', 'es-MX': 'Recurso de fuerza' }),
    url: 'https://cabohealth.org/apps/strength-training-guide/',
  });
  const createdFreeWeightResource = await service.create(safeFreeWeightResource, mutation(606));

  assert.deepEqual(createdFreeWeightResource.summary, safeFreeWeightResource.summary);
  assert.deepEqual(createdFreeWeightResource.title, safeFreeWeightResource.title);

  const safeIapCopy = Object.freeze({
    ...activeClientMiniapp,
    summary: Object.freeze({
      en: 'IAP monitoring guide for intra-abdominal pressure.',
      'es-MX': 'Guía de monitoreo de presión intraabdominal.',
    }),
    title: Object.freeze({ en: 'IAP Monitoring', 'es-MX': 'Monitoreo de presión' }),
    url: 'https://cabohealth.org/apps/pressure-monitoring/',
  });
  const createdIapCopy = await service.create(safeIapCopy, mutation(607));

  assert.deepEqual(createdIapCopy.summary, safeIapCopy.summary);
  assert.deepEqual(createdIapCopy.title, safeIapCopy.title);
});

test('client preview ids reject credential and pricing side channels only for client access', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const unsafeIds = [
    'ch-abcdef01-23456789-a1b2c3d4-e5f60718',
    `ar${'0123456789abcdef'.repeat(2)}`,
    'ch-abcd-ef01-2345-6789-a1b2-c3d4-e5f6-0718',
    'vip-99-usd',
    'vip-mxn-1500',
    'vip-99-brl',
    'vip-inr-1500',
    'vip-99-qar',
    'vip-kwd-1500',
    'vip-bhd-20',
    'vip-omr-9',
    'vip-99-xof',
    'vip-99-dollars',
    'vip-dollars-99',
    'vip-99-pesos',
    'vip-99-euros',
    'vip-99-rials',
    'vip-99-krone',
    'vip-99-quetzal',
    'vip-99-soles',
    'vip-99-shillings',
    'vip-99-naira',
    'vip-99-cedis',
    'vip-99-bolivianos',
    'vip-99-colones',
    'vip-99usd',
    'vip-usd99',
    'vip-99dollars',
    'vip-dollars99',
    'vip-price99',
    'vip-99price',
    'vip-monthly99',
    'vip-checkout99',
    'vip-99-pen',
    'vip-try-1500',
    'vip-currency-xof',
    'vip-moneda-mxn',
    'vip-ngn-membership',
    'vip-subscription',
    'vip-subscribed',
    'vip-purchasing',
    'vip-buy-access',
    'vip-buys',
    'vip-buying',
    'vip-payment',
    'membresia-vip',
    'vip-suscripcion',
    'vip-pago',
    'vip-checkout',
    'vip-billing',
    'vip-billed',
    'vip-charge',
    'vip-charging',
    'vip-sale',
    'vip-sales',
    'vip-cobro',
    'vip-venta',
    'vip-facturacion',
    'iap-purchase',
    'iap-payment',
    'iap-checkout',
    'iap-available',
    'iap-enabled',
    'available-iap',
    'enabled-iap',
    'vip-free-access',
    'resource-free',
    'vip-price-99',
    'vip-precio-99',
    'vip-cost-monthly',
    'vip-costo-mensual',
    'vip-fee-tarifa',
  ];
  let request = 610;

  for (const id of unsafeIds) {
    await assert.rejects(service.create({
      ...activeClientMiniapp,
      url: `https://cabohealth.org/apps/${id}/`,
    }, mutation(request++)), CatalogInputError, id);
  }

  for (const id of [
    'try-this-guide',
    'pen-and-paper',
    'inr-guide',
    'aed-training',
    'vip-usd',
    'free-weights-guide',
    'sugar-free-guide',
    'vip-free-weights-guide',
    'client-free-weights-guide',
    'vip-gratis',
    'client-complimentary',
    'iap-monitoring',
    'vip-iap',
    'lose-10-pounds',
    '10-pesos-libres',
    '10pesos-libres',
    'priceless99-guide',
    'costume99-guide',
    '10min-guide',
    '100bpm-guide',
    '10hrs-guide',
    'colon-care-guide',
    'sol-care-guide',
    'real-world-guide',
    '10-real-world-exercises',
  ]) {
    const safeService = new CatalogAdminService({
      store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
    });
    const created = await safeService.create({
      ...activeClientMiniapp,
      url: `https://cabohealth.org/apps/${id}/`,
    }, mutation(request++));
    assert.equal(created.id, id);
  }

  const publicItem = await service.create({
    ...activePublicMiniapp,
    url: 'https://cabohealth.org/apps/vip-99-usd/',
  }, mutation(request));
  assert.equal(publicItem.id, 'vip-99-usd');
});

test('public catalog copy retains its existing editorial text policy', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const publicCopy = Object.freeze({
    ...activePublicMiniapp,
    summary: Object.freeze({
      en: 'Visit https://cabohealth.org/apps/healthy-recipes/; price: $99 per month.',
      'es-MX': 'Visita cabohealth.org; precio MXN 1,500 por mes.',
    }),
    title: Object.freeze({ en: 'Private VIP Test', 'es-MX': 'Prueba VIP privada' }),
  });

  const created = await service.create(publicCopy, mutation(605));

  assert.deepEqual(created.summary, publicCopy.summary);
  assert.deepEqual(created.title, publicCopy.title);
});

test('catalog input reserves infrastructure slugs and keeps the broker root client-only', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });

  for (const url of [
    'https://cabohealth.org/apps/app-review/',
    'https://cabohealth.org/apps/review-sandbox-app-review-sample-v1/',
    'https://cabohealth.org/apps/review-sandbox-future-sample/',
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

test('catalog input permanently rejects historical App Review slugs for every access class', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });

  let request = 230;
  for (const access of ['public', 'clients'] as const) {
    for (const id of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
      await assert.rejects(service.create({
        ...activePublicMiniapp,
        access,
        url: `https://cabohealth.org/apps/${id}/`,
      }, mutation(request++)), CatalogInputError, `${access}:${id}`);
    }
  }
});

test('catalog mutations permanently reject historical App Review ids before storage access', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });

  let request = 240;
  for (const id of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    await assert.rejects(
      service.setActive(id, 1, true, mutation(request++)),
      CatalogInputError,
      id,
    );
  }
});

test('catalog mutations reject every review-sandbox id before storage access', async () => {
  const service = new CatalogAdminService({
    store: new FirestoreCatalogStore(new InMemoryDocumentDatabase()),
  });
  const id = 'review-sandbox-future-sample';
  const details = {
    access: activePublicMiniapp.access,
    icon: activePublicMiniapp.icon,
    summary: activePublicMiniapp.summary,
    title: activePublicMiniapp.title,
    url: `https://cabohealth.org/apps/${id}/`,
  } as const;

  await assert.rejects(service.setActive(id, 1, true, mutation(620)), CatalogInputError);
  await assert.rejects(service.update(id, 1, details, mutation(621)), CatalogInputError);
  await assert.rejects(service.delete(id, 1, mutation(622)), CatalogInputError);
});

test('Functions fails closed on stored catalog data containing a retired id', async () => {
  for (const id of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    const stored = Object.freeze({
      ...activePublicMiniapp,
      id,
      url: `https://cabohealth.org/apps/${id}/`,
      revision: 1,
      createdAtMs: 1_800_000_000_000,
      updatedAtMs: 1_800_000_000_000,
    });
    const service = new CatalogAdminService({
      store: new FirestoreCatalogStore(new InMemoryDocumentDatabase({
        '_private_catalog/current': {
          items: [stored],
          revision: 1,
          schemaVersion: 1,
          updatedAtMs: 1_800_000_000_000,
        },
      })),
    });

    await assert.rejects(service.publishedCatalog(), /invalid_catalog_record/u, id);
  }
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
