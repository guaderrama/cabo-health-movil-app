import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import { AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import { ClientAccessPublicError, ClientAccessRedeemer } from '../../domain/clientAccessRedeemer.js';
import { ClientLaunchService } from '../../domain/clientLaunchService.js';
import { ClientSessionManager } from '../../domain/clientSessionManager.js';
import {
  clientResourcePath,
  FirestoreClientAccessStore,
} from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = Date.UTC(2026, 7, 28);
const installationId = 'fefefefefefefefefefefefefefefefe';
const externalId = 'external-89abcdef0123456789abcdef01234567';
const externalUrl = 'https://www.eightsleep.com/mx/';
const internalId = 'client-resources';
const auditRetentionMs = 30 * 24 * 60 * 60 * 1_000;
const maximumFirestoreEpochMs = 253_402_300_799_999;

for (const [label, invalidNowMs] of [
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['negative integer', -1],
  ['signed negative zero', -0],
  ['fractional time', 1.5],
  ['maximum safe integer', Number.MAX_SAFE_INTEGER],
  ['safe-integer audit-headroom boundary', Number.MAX_SAFE_INTEGER - auditRetentionMs],
] as const) {
  test(`V2 launch rejects ${label} server time before randomness or store access`, async () => {
    let clockCalls = 0;
    let randomCalls = 0;
    let storeCalls = 0;
    const launches = new ClientLaunchService({
      installationHasher: hasher('installation'),
      nonceHasher: hasher('launch-nonce'),
      nowMs: () => {
        clockCalls += 1;
        return invalidNowMs;
      },
      randomSource: () => {
        randomCalls += 1;
        return Buffer.alloc(24, 53);
      },
      store: {
        createLaunch: async () => 'invalid',
        createLaunchV2: async () => {
          storeCalls += 1;
          return { kind: 'external_https', expiresAtMs: 1, url: externalUrl };
        },
        consumeLaunch: async () => ({ kind: 'invalid' }),
      },
    });

    await assert.rejects(
      launches.createV2({
        installationId,
        resourceId: externalId,
        subjectUid: `client_${'s'.repeat(32)}`,
      }),
      invalidAccessWithoutUrl,
    );
    assert.equal(clockCalls, 1);
    assert.equal(randomCalls, 0);
    assert.equal(storeCalls, 0);
  });
}

test('V2 launch accepts the exact representable audit-headroom boundary', async () => {
  const boundaryNowMs = maximumFirestoreEpochMs - auditRetentionMs;
  let command: Record<string, unknown> | undefined;
  const launches = new ClientLaunchService({
    installationHasher: hasher('installation'),
    nonceHasher: hasher('launch-nonce'),
    nowMs: () => boundaryNowMs,
    randomSource: () => Buffer.alloc(24, 59),
    store: {
      createLaunch: async () => 'invalid',
      createLaunchV2: async (value) => {
        command = value as unknown as Record<string, unknown>;
        return {
          kind: 'external_https',
          expiresAtMs: boundaryNowMs + 60_000,
          url: externalUrl,
        };
      },
      consumeLaunch: async () => ({ kind: 'invalid' }),
    },
  });

  assert.deepEqual(await launches.createV2({
    installationId,
    resourceId: externalId,
    subjectUid: `client_${'s'.repeat(32)}`,
  }), {
    kind: 'external_https',
    expiresAtMs: boundaryNowMs + 60_000,
    url: externalUrl,
  });
  assert.equal(command?.nowMs, boundaryNowMs);
  assert.equal(command?.maxExpiresAtMs, boundaryNowMs + 60_000);
  assert.equal(Object.hasOwn(command ?? {}, 'expiresAtMs'), false);
});

test('V2 external launch resolves the exact server-side URL after one live authorization transaction', async () => {
  const fixture = await launchFixture();
  const transactionsBeforeLaunch = fixture.database.transactionCount;

  const launch = await fixture.launches.createV2({
    installationId,
    resourceId: externalId,
    subjectUid: fixture.subjectUid,
  });

  assert.deepEqual(launch, {
    kind: 'external_https',
    expiresAtMs: nowMs + 60_000,
    url: externalUrl,
  });
  assert.equal(fixture.database.transactionCount, transactionsBeforeLaunch + 1);
});

test('V2 internal launch preserves the exact broker POST nonce contract', async () => {
  const fixture = await launchFixture();

  const launch = await fixture.launches.createV2({
    installationId,
    resourceId: internalId,
    subjectUid: fixture.subjectUid,
  });

  assert.deepEqual(launch, {
    kind: 'broker',
    expiresAtMs: nowMs + 60_000,
    launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
    method: 'POST',
    nonce: Buffer.alloc(24, 37).toString('base64url'),
  });
  assert.deepEqual(await fixture.launches.consume({ nonce: launch.nonce }), {
    resourceId: internalId,
  });
});

test('the legacy launch surface rejects external IDs even for a live V2 grant', async () => {
  const fixture = await launchFixture();

  await assert.rejects(
    fixture.launches.create({
      installationId,
      resourceId: externalId,
      subjectUid: fixture.subjectUid,
    }),
    invalidAccessWithoutUrl,
  );
});

test('deactivation between V2 refresh and launch fails closed', async () => {
  const fixture = await launchFixture();
  await fixture.sessions.refresh({ installationId, subjectUid: fixture.subjectUid });
  await fixture.mutateCatalog((items) => items.map((item) => (
    item.id === externalId
      ? { ...item, active: false, revision: 2, updatedAtMs: nowMs + 1 }
      : item
  )));

  await assert.rejects(
    fixture.launches.createV2({ installationId, resourceId: externalId, subjectUid: fixture.subjectUid }),
    invalidAccessWithoutUrl,
  );
});

test('external launch expiry cannot outlive the grant or access code', async () => {
  const fixture = await launchFixture({ expiresAtMs: nowMs + 30_000 });
  await fixture.mutateGrant({ expiresAtMs: nowMs + 20_000 });

  const launch = await fixture.launches.createV2({
    installationId,
    resourceId: externalId,
    subjectUid: fixture.subjectUid,
  });

  assert.equal(launch.kind, 'external_https');
  assert.equal(launch.expiresAtMs, nowMs + 20_000);
});

test('wrong installation, expired grant or code, and revoked or replaced code never disclose the external URL', async () => {
  for (const scenario of [
    'wrong-installation',
    'expired-grant',
    'expired-code',
    'revoked-code',
    'replaced-code',
  ] as const) {
    const fixture = await launchFixture();
    if (scenario === 'expired-grant') await fixture.mutateGrant({ expiresAtMs: nowMs });
    if (scenario === 'expired-code') await fixture.mutateCode({ expiresAtMs: nowMs });
    if (scenario === 'revoked-code') await fixture.mutateCode({ status: 'revoked' });
    if (scenario === 'replaced-code') await fixture.mutateGrant({ codeId: 'ac_replaced000000000000000000000000' });

    await assert.rejects(
      fixture.launches.createV2({
        installationId: scenario === 'wrong-installation' ? 'abababababababababababababababab' : installationId,
        resourceId: externalId,
        subjectUid: fixture.subjectUid,
      }),
      invalidAccessWithoutUrl,
      scenario,
    );
  }
});

test('wrong subject, wrong resource, projection mismatch, and noncanonical URL fail without disclosure', async () => {
  for (const scenario of ['wrong-subject', 'wrong-resource', 'projection-mismatch', 'noncanonical-url'] as const) {
    const fixture = await launchFixture();
    if (scenario === 'projection-mismatch') {
      await fixture.database.runTransaction(async (transaction) => {
        transaction.set(clientResourcePath(externalId), {
          ...clientResource(externalCatalogItem()),
          title: { en: 'Drifted', es: 'VIP Externo' },
        });
      });
    }
    if (scenario === 'noncanonical-url') {
      await fixture.mutateCatalog((items) => items.map((item) => (
        item.id === externalId ? { ...item, url: 'https://WWW.EIGHTSLEEP.COM/mx/' } : item
      )));
    }

    await assert.rejects(
      fixture.launches.createV2({
        installationId,
        resourceId: scenario === 'wrong-resource' ? 'not-granted' : externalId,
        subjectUid: scenario === 'wrong-subject'
          ? `client_${'x'.repeat(32)}`
          : fixture.subjectUid,
      }),
      invalidAccessWithoutUrl,
      scenario,
    );
  }
});

test('external launch persists neither its URL nor a launch nonce outside catalog authority', async () => {
  const fixture = await launchFixture();

  const launch = await fixture.launches.createV2({
    installationId,
    resourceId: externalId,
    subjectUid: fixture.subjectUid,
  });

  assert.equal(launch.kind, 'external_https');
  const state = JSON.parse(fixture.database.serializedState()) as Record<string, unknown>;
  for (const [path, value] of Object.entries(state)) {
    if (path === '_private_catalog/current') continue;
    assert.equal(JSON.stringify(value).includes(externalUrl), false, path);
    assert.equal(path.startsWith('_private_launch_nonces/'), false, path);
  }
  const audit = Object.entries(state).filter(([path]) => path.startsWith('_private_audit_events/'));
  assert.equal(audit.some(([, value]) => (
    (value as { eventType?: unknown }).eventType === 'client_external_launch_created'
  )), true);
});

for (const [label, malformed] of [
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['negative integer', -1],
  ['signed negative zero', -0],
  ['fractional value', 1.5],
  ['maximum safe integer', Number.MAX_SAFE_INTEGER],
] as const) {
  test(`direct V2 store command rejects malformed ${label} time before reads, writes, or URL return`, async () => {
    const fixture = await launchFixture();
    const before = fixture.database.serializedState();
    const transactionsBefore = fixture.database.transactionCount;

    const result = await fixture.store.createLaunchV2(directLaunchCommand({
      maxExpiresAtMs: nowMs + 60_000,
      nowMs: malformed,
    }, fixture.subjectUid) as never);

    assert.deepEqual(result, { kind: 'invalid' });
    assert.equal(fixture.database.transactionCount, transactionsBefore);
    assert.equal(fixture.database.serializedState(), before);
    assert.equal(JSON.stringify(result).includes(externalUrl), false);
  });
}

for (const [label, malformed] of [
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['negative integer', -1],
  ['signed negative zero', -0],
  ['fractional value', nowMs + 60_000.5],
  ['nonfuture value', nowMs],
  ['short lifetime', nowMs + 59_999],
  ['long lifetime', nowMs + 60_001],
  ['maximum safe integer', Number.MAX_SAFE_INTEGER],
  ['beyond Firestore range', maximumFirestoreEpochMs + 1],
] as const) {
  test(`direct V2 store command rejects malformed ${label} max deadline before durable effects`, async () => {
    const fixture = await launchFixture();
    const before = fixture.database.serializedState();
    const transactionsBefore = fixture.database.transactionCount;

    const result = await fixture.store.createLaunchV2(directLaunchCommand({
      maxExpiresAtMs: malformed,
      nowMs,
    }, fixture.subjectUid) as never);

    assert.deepEqual(result, { kind: 'invalid' });
    assert.equal(fixture.database.transactionCount, transactionsBefore);
    assert.equal(fixture.database.serializedState(), before);
    assert.equal(JSON.stringify(result).includes(externalUrl), false);
  });
}

type CatalogItem = ReturnType<typeof internalCatalogItem>;

async function launchFixture(options: { expiresAtMs?: number } = {}) {
  const internal = internalCatalogItem();
  const external = externalCatalogItem();
  const database = new CountingDatabase({
    '_private_catalog/current': catalogSnapshot([internal, external]),
    [clientResourcePath(internal.id)]: clientResource(internal),
    [clientResourcePath(external.id)]: clientResource(external),
  }, {
    rejectDuplicateWrites: true,
    rejectReadsAfterWrites: true,
  });
  const store = new FirestoreClientAccessStore(database);
  const issued = await new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 41),
    store,
  }).issue({
    expiresAtMs: options.expiresAtMs ?? nowMs + 86_400_000,
    resourceIds: [internalId],
  });
  let subjectUid = '';
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    resourceResolutionMode: 'v2_all',
    store,
    tokenIssuer: {
      async createCustomToken(uid) {
        subjectUid = uid;
        return 'test-token';
      },
    },
  });
  await redeemer.redeem({
    code: issued.oneTimeCode,
    installationId,
    requestId: 'external-launch-request-0001',
    sourceAddress: '203.0.113.42',
  });
  const launches = new ClientLaunchService({
    installationHasher: hasher('installation'),
    nonceHasher: hasher('launch-nonce'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(24, 37),
    store,
  });
  const sessions = new ClientSessionManager({
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    resourceResolutionMode: 'v2_all',
    store,
  });

  async function mutateDocument(prefix: string, patch: Record<string, unknown>) {
    const state = JSON.parse(database.serializedState()) as Record<string, Record<string, unknown>>;
    const entry = Object.entries(state).find(([path]) => path.startsWith(`${prefix}/`));
    assert.ok(entry, prefix);
    await database.runTransaction(async (transaction) => {
      transaction.set(entry[0], { ...entry[1], ...patch });
    });
  }

  return {
    database,
    launches,
    mutateCatalog: async (mutate: (items: readonly CatalogItem[]) => readonly CatalogItem[]) => {
      const state = JSON.parse(database.serializedState()) as Record<string, { items: CatalogItem[] }>;
      const current = state['_private_catalog/current']!;
      await database.runTransaction(async (transaction) => {
        transaction.set('_private_catalog/current', catalogSnapshot(mutate(current.items), 2, nowMs + 1));
      });
    },
    mutateCode: (patch: Record<string, unknown>) => mutateDocument('_private_access_codes', patch),
    mutateGrant: (patch: Record<string, unknown>) => mutateDocument('_private_client_grants', patch),
    sessions,
    store,
    subjectUid,
  };
}

function directLaunchCommand(
  overrides: { maxExpiresAtMs: number; nowMs: number },
  subjectUid: string,
) {
  const installationHashes = hasher('installation').lookupCandidates(installationId);
  return {
    currentInstallationHash: installationHashes[0]!,
    installationHashes,
    maxExpiresAtMs: overrides.maxExpiresAtMs,
    nonceLookup: hasher('launch-nonce').currentDigest('n'.repeat(32)),
    nowMs: overrides.nowMs,
    resourceId: externalId,
    subjectUid,
  };
}

class CountingDatabase extends InMemoryDocumentDatabase {
  transactionCount = 0;

  override runTransaction<T>(operation: Parameters<InMemoryDocumentDatabase['runTransaction']>[0]): Promise<T> {
    this.transactionCount += 1;
    return super.runTransaction(operation) as Promise<T>;
  }
}

function internalCatalogItem() {
  return catalogItem(
    internalId,
    'guide',
    'Client Resources',
    'Recursos para Clientes',
    `https://cabohealth.org/apps/${internalId}/`,
  );
}

function externalCatalogItem() {
  return catalogItem(externalId, 'wellness', 'Eight Sleep', 'VIP Externo', externalUrl);
}

function catalogItem(id: string, icon: string, en: string, esMx: string, url: string) {
  return {
    access: 'clients' as const,
    active: true,
    createdAtMs: nowMs,
    icon,
    id,
    revision: 1,
    summary: { en: `${en} private summary.`, 'es-MX': `Resumen privado de ${esMx}.` },
    title: { en, 'es-MX': esMx },
    updatedAtMs: nowMs,
    url,
  };
}

function catalogSnapshot(items: readonly unknown[], revision = 1, updatedAtMs = nowMs) {
  return { items, revision, schemaVersion: 1, updatedAtMs };
}

function clientResource(item: CatalogItem) {
  return {
    access: 'client',
    iconKey: item.icon === 'guide' ? 'book-outline' : 'heart-outline',
    id: item.id,
    schemaVersion: 1,
    status: 'active',
    summary: { en: item.summary.en, es: item.summary['es-MX'] },
    title: { en: item.title.en, es: item.title['es-MX'] },
  };
}

function invalidAccessWithoutUrl(error: unknown): boolean {
  return error instanceof ClientAccessPublicError
    && error.code === 'invalid_access'
    && !JSON.stringify(error).includes(externalUrl);
}

function hasher(namespace: string): VersionedHmac {
  const key = createSecretKey(Buffer.from('test-only-pepper-key-with-at-least-32-bytes', 'utf8'));
  return new VersionedHmac({
    acceptedVersions: () => ['2026-08'],
    currentVersion: '2026-08',
    keyFor: () => key,
  }, `cabohealth/${namespace}/test`);
}
