import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import { AccessCodeInputError, AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import { ClientAccessPublicError, ClientAccessRedeemer } from '../../domain/clientAccessRedeemer.js';
import { ClientLaunchService } from '../../domain/clientLaunchService.js';
import { ClientSessionManager } from '../../domain/clientSessionManager.js';
import {
  clientResourcePath,
  FirestoreClientAccessStore,
} from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = Date.UTC(2026, 7, 25);
const installationId = 'dededededededededededededededede';
const groupMarker = 'client-resources';
const retiredCatalogIds = Object.freeze([
  'health-advisor',
  'ai-cosmetic-scan',
  'service-hub',
  'sleep-lab',
]);

test('a group-marker code follows active client catalog changes on refresh and launch', async () => {
  const first = catalogItem('vip-nutrition', 'nutrition', 'VIP Nutrition', 'Nutrición VIP');
  const second = catalogItem('vip-wellness', 'wellness', 'VIP Wellness', 'Bienestar VIP');
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': catalogSnapshot([first, second]),
    [clientResourcePath(first.id)]: clientResource(first),
    [clientResourcePath(second.id)]: clientResource(second),
  });
  const fixture = await redeemedFixture(database);

  assert.deepEqual(
    fixture.redeemed.grant.resources.map(({ id }) => id),
    [first.id, second.id],
  );
  const launch = await fixture.launches.create({
    installationId,
    resourceId: second.id,
    subjectUid: fixture.subjectUid,
  });

  await database.runTransaction(async (transaction) => {
    transaction.set('_private_catalog/current', catalogSnapshot([
      first,
      { ...second, active: false, revision: 2, updatedAtMs: nowMs + 1 },
    ], 2, nowMs + 1));
  });

  const refreshed = await fixture.sessions.refresh({ installationId, subjectUid: fixture.subjectUid });
  assert.deepEqual(refreshed.resources.map(({ id }) => id), [first.id]);
  await assert.rejects(
    fixture.launches.create({
      installationId,
      resourceId: second.id,
      subjectUid: fixture.subjectUid,
    }),
    invalidAccess,
  );
  await assert.rejects(fixture.launches.consume({ nonce: launch.nonce }), invalidAccess);
});

test('a group-marker code cannot grant a persisted permanently retired client catalog item', async () => {
  for (const id of retiredCatalogIds) {
    const retired = catalogItem(id, 'guide', 'Retired resource', 'Recurso retirado');
    const database = new InMemoryDocumentDatabase({
      '_private_catalog/current': catalogSnapshot([retired]),
      [clientResourcePath(retired.id)]: clientResource(retired),
    });

    await assert.rejects(issuer(new FirestoreClientAccessStore(database)).issue({
      expiresAtMs: nowMs + 86_400_000,
      resourceIds: [groupMarker],
    }), (error: unknown) => error instanceof AccessCodeInputError, id);
  }
});

test('a direct fallback resource cannot issue access for a permanently retired id without a catalog', async () => {
  for (const id of retiredCatalogIds) {
    const retired = catalogItem(id, 'guide', 'Retired resource', 'Recurso retirado');
    const database = new InMemoryDocumentDatabase({
      [clientResourcePath(retired.id)]: clientResource(retired),
    });

    await assert.rejects(issuer(new FirestoreClientAccessStore(database)).issue({
      expiresAtMs: nowMs + 86_400_000,
      resourceIds: [id],
    }), (error: unknown) => error instanceof AccessCodeInputError, id);
  }
});

test('redemption revalidates an existing group-marker code against persisted retired catalog data', async () => {
  for (const id of retiredCatalogIds) {
    const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
    const retired = catalogItem(id, 'guide', 'Retired resource', 'Recurso retirado');
    const database = new InMemoryDocumentDatabase({
      [clientResourcePath(marker.id)]: clientResource(marker),
    });
    const store = new FirestoreClientAccessStore(database);
    const issued = await issuer(store).issue({
      expiresAtMs: nowMs + 86_400_000,
      resourceIds: [groupMarker],
    });
    await database.runTransaction(async (transaction) => {
      transaction.create('_private_catalog/current', catalogSnapshot([retired]));
      transaction.create(clientResourcePath(retired.id), clientResource(retired));
    });
    const redeemer = new ClientAccessRedeemer({
      codeHasher: hasher('code'),
      installationHasher: hasher('installation'),
      nowMs: () => nowMs,
      rateLimitHasher: hasher('rate-limit'),
      store,
      tokenIssuer: { createCustomToken: async () => 'unreachable' },
    });

    await assert.rejects(redeemer.redeem(redemptionInput(issued.oneTimeCode)), invalidAccess, id);
  }
});

test('refresh and launch revalidate an existing group entitlement after a retired id is persisted', async () => {
  for (const id of retiredCatalogIds) {
    const current = catalogItem('vip-current', 'wellness', 'Current VIP', 'VIP vigente');
    const retired = catalogItem(id, 'guide', 'Retired resource', 'Recurso retirado');
    const database = new InMemoryDocumentDatabase({
      '_private_catalog/current': catalogSnapshot([current]),
      [clientResourcePath(current.id)]: clientResource(current),
    });
    const fixture = await redeemedFixture(database);
    await database.runTransaction(async (transaction) => {
      transaction.set('_private_catalog/current', catalogSnapshot([retired], 2, nowMs + 1));
      transaction.create(clientResourcePath(retired.id), clientResource(retired));
    });

    await assert.rejects(
      fixture.sessions.refresh({ installationId, subjectUid: fixture.subjectUid }),
      invalidAccess,
      `refresh:${id}`,
    );
    await assert.rejects(fixture.launches.create({
      installationId,
      resourceId: id,
      subjectUid: fixture.subjectUid,
    }), invalidAccess, `launch:${id}`);
  }
});

test('a malformed catalog snapshot fails closed even when the legacy marker resource exists', async () => {
  const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(groupMarker)]: clientResource(marker),
  });
  const store = new FirestoreClientAccessStore(database);
  const issued = await issuer(store).issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds: [groupMarker],
  });
  await database.runTransaction(async (transaction) => {
    transaction.create('_private_catalog/current', {
      ...catalogSnapshot([marker]),
      unexpected: true,
    });
  });
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: { createCustomToken: async () => 'unreachable' },
  });

  await assert.rejects(redeemer.redeem(redemptionInput(issued.oneTimeCode)), invalidAccess);
});

test('a catalog-to-client-resource mismatch fails closed', async () => {
  const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(groupMarker)]: clientResource(marker),
  });
  const store = new FirestoreClientAccessStore(database);
  const issued = await issuer(store).issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds: [groupMarker],
  });
  await database.runTransaction(async (transaction) => {
    transaction.create('_private_catalog/current', catalogSnapshot([marker]));
    transaction.set(clientResourcePath(groupMarker), {
      ...clientResource(marker),
      title: { en: 'Stale title', es: marker.title['es-MX'] },
    });
  });
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: { createCustomToken: async () => 'unreachable' },
  });

  await assert.rejects(redeemer.redeem(redemptionInput(issued.oneTimeCode)), invalidAccess);
});

test('a client-resource projection with an unexpected field fails closed', async () => {
  const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': catalogSnapshot([marker]),
    [clientResourcePath(groupMarker)]: clientResource(marker),
  });
  const store = new FirestoreClientAccessStore(database);
  const issued = await issuer(store).issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds: [groupMarker],
  });
  await database.runTransaction(async (transaction) => {
    transaction.set(clientResourcePath(groupMarker), {
      ...clientResource(marker),
      unreviewed: true,
    });
  });
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: { createCustomToken: async () => 'unreachable' },
  });

  await assert.rejects(redeemer.redeem(redemptionInput(issued.oneTimeCode)), invalidAccess);
});

test('client authorization rejects control text and reserved infrastructure catalog records', async () => {
  const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
  const malformedItems = [
    { ...marker, title: { ...marker.title, en: 'Client\nResources' } },
    catalogItem('app-review', 'guide', 'Review', 'Revisión'),
    catalogItem('shared', 'guide', 'Shared', 'Compartido'),
    { ...marker, access: 'public' },
  ];

  for (const malformed of malformedItems) {
    const database = new InMemoryDocumentDatabase({
      [clientResourcePath(groupMarker)]: clientResource(marker),
    });
    const store = new FirestoreClientAccessStore(database);
    const issued = await issuer(store).issue({
      expiresAtMs: nowMs + 86_400_000,
      resourceIds: [groupMarker],
    });
    await database.runTransaction(async (transaction) => {
      transaction.create('_private_catalog/current', catalogSnapshot([malformed]));
    });
    const redeemer = new ClientAccessRedeemer({
      codeHasher: hasher('code'),
      installationHasher: hasher('installation'),
      nowMs: () => nowMs,
      rateLimitHasher: hasher('rate-limit'),
      store,
      tokenIssuer: { createCustomToken: async () => 'unreachable' },
    });
    await assert.rejects(redeemer.redeem(redemptionInput(issued.oneTimeCode)), invalidAccess);
  }
});

test('the group marker preserves the fixed legacy resource while no catalog snapshot exists', async () => {
  const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(groupMarker)]: clientResource(marker),
  });
  const fixture = await redeemedFixture(database);

  assert.deepEqual(fixture.redeemed.grant.resources.map(({ id }) => id), [groupMarker]);
});

test('an active client-resources catalog item is expanded once without duplication', async () => {
  const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
  const other = catalogItem('vip-wellness', 'wellness', 'VIP Wellness', 'Bienestar VIP');
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': catalogSnapshot([marker, other]),
    [clientResourcePath(marker.id)]: clientResource(marker),
    [clientResourcePath(other.id)]: clientResource(other),
  });
  const fixture = await redeemedFixture(database);

  assert.deepEqual(
    fixture.redeemed.grant.resources.map(({ id }) => id),
    [marker.id, other.id],
  );
});

test('a legacy explicit entitlement cannot bypass withdrawal when a group marker is present', async () => {
  const marker = catalogItem(groupMarker, 'guide', 'Client Resources', 'Recursos para Clientes');
  const withdrawn = catalogItem('legacy-vip', 'wellness', 'Legacy VIP', 'VIP Anterior');
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': catalogSnapshot([marker, withdrawn]),
    [clientResourcePath(marker.id)]: clientResource(marker),
    [clientResourcePath(withdrawn.id)]: clientResource(withdrawn),
  });
  const fixture = await redeemedFixture(database, [groupMarker, withdrawn.id]);

  await database.runTransaction(async (transaction) => {
    transaction.set('_private_catalog/current', catalogSnapshot([
      marker,
      { ...withdrawn, active: false, revision: 2, updatedAtMs: nowMs + 1 },
    ], 2, nowMs + 1));
  });

  await assert.rejects(
    fixture.sessions.refresh({ installationId, subjectUid: fixture.subjectUid }),
    invalidAccess,
  );
});

test('a direct legacy entitlement also obeys the active catalog once the catalog exists', async () => {
  const direct = catalogItem('legacy-direct', 'wellness', 'Legacy Direct', 'Directo Anterior');
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': catalogSnapshot([direct]),
    [clientResourcePath(direct.id)]: clientResource(direct),
  });
  const fixture = await redeemedFixture(database, [direct.id]);

  await database.runTransaction(async (transaction) => {
    transaction.set('_private_catalog/current', catalogSnapshot([
      { ...direct, active: false, revision: 2, updatedAtMs: nowMs + 1 },
    ], 2, nowMs + 1));
  });

  await assert.rejects(
    fixture.sessions.refresh({ installationId, subjectUid: fixture.subjectUid }),
    invalidAccess,
  );
});

async function redeemedFixture(
  database: InMemoryDocumentDatabase,
  resourceIds: readonly string[] = [groupMarker],
) {
  const store = new FirestoreClientAccessStore(database);
  const issued = await issuer(store).issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds,
  });
  let subjectUid = '';
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: {
      async createCustomToken(uid) {
        subjectUid = uid;
        return 'test-token';
      },
    },
  });
  const redeemed = await redeemer.redeem(redemptionInput(issued.oneTimeCode));
  return {
    launches: new ClientLaunchService({
      installationHasher: hasher('installation'),
      nonceHasher: hasher('launch-nonce'),
      nowMs: () => nowMs + 2,
      randomSource: () => Buffer.alloc(24, 7),
      store,
    }),
    redeemed,
    sessions: new ClientSessionManager({
      installationHasher: hasher('installation'),
      nowMs: () => nowMs + 2,
      store,
    }),
    subjectUid,
  };
}

function issuer(store: FirestoreClientAccessStore): AccessCodeIssuer {
  return new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 91),
    store,
  });
}

function redemptionInput(code: string) {
  return {
    code,
    installationId,
    requestId: 'dynamic-entitlements-request-01',
    sourceAddress: '203.0.113.42',
  };
}

function invalidAccess(error: unknown): boolean {
  return error instanceof ClientAccessPublicError && error.code === 'invalid_access';
}

function catalogItem(id: string, icon: string, en: string, esMx: string) {
  return {
    access: 'clients',
    active: true,
    createdAtMs: nowMs,
    icon,
    id,
    revision: 1,
    summary: { en: `${en} private summary.`, 'es-MX': `Resumen privado de ${esMx}.` },
    title: { en, 'es-MX': esMx },
    updatedAtMs: nowMs,
    url: `https://cabohealth.org/apps/${id}/`,
  } as const;
}

function catalogSnapshot(items: readonly unknown[], revision = 1, updatedAtMs = nowMs) {
  return {
    items,
    revision,
    schemaVersion: 1,
    updatedAtMs,
  } as const;
}

function clientResource(item: ReturnType<typeof catalogItem>) {
  return {
    access: 'client',
    iconKey: catalogIconKey(item.icon),
    id: item.id,
    schemaVersion: 1,
    status: 'active',
    summary: { en: item.summary.en, es: item.summary['es-MX'] },
    title: { en: item.title.en, es: item.title['es-MX'] },
  } as const;
}

function catalogIconKey(icon: string): string {
  const value: Record<string, string> = {
    guide: 'book-outline',
    nutrition: 'leaf-outline',
    wellness: 'heart-outline',
  };
  return value[icon]!;
}

function hasher(namespace: string): VersionedHmac {
  const key = createSecretKey(Buffer.from('test-only-pepper-key-with-at-least-32-bytes', 'utf8'));
  return new VersionedHmac({
    acceptedVersions: () => ['2026-08'],
    currentVersion: '2026-08',
    keyFor: () => key,
  }, `cabohealth/${namespace}/test`);
}
