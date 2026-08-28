import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import { AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import { ClientAccessPublicError, ClientAccessRedeemer } from '../../domain/clientAccessRedeemer.js';
import { ClientSessionManager } from '../../domain/clientSessionManager.js';
import { clientResourcePath, FirestoreClientAccessStore } from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = Date.UTC(2026, 7, 21);
const resourceId = 'healthy-recipes-client';
const externalId = 'external-abcdef0123456789abcdef0123456789';
const resource = {
  access: 'client',
  iconKey: 'nutrition',
  id: resourceId,
  schemaVersion: 1,
  status: 'active',
  summary: { en: 'Client nutrition guide.', es: 'Guía de nutrición para clientes.' },
  title: { en: 'Nutrition Guide', es: 'Guía de Nutrición' },
};

test('refresh revalidates the live grant and remove revokes that code and session', async () => {
  const harness = await createRedeemedHarness(1, '11111111111111111111111111111111');

  const refreshed = await harness.sessions.refresh({
    installationId: harness.installationId,
    subjectUid: harness.subjectUid,
  });
  assert.equal(refreshed.resources[0]?.id, resourceId);
  await assert.rejects(
    harness.sessions.refresh({
      installationId: '99999999999999999999999999999999',
      subjectUid: harness.subjectUid,
    }),
    isInvalidAccess,
  );

  assert.deepEqual(await harness.sessions.remove({
    installationId: harness.installationId,
    subjectUid: harness.subjectUid,
  }), { removed: true });
  await assert.rejects(
    harness.sessions.refresh({
      installationId: harness.installationId,
      subjectUid: harness.subjectUid,
    }),
    isInvalidAccess,
  );
});

test('V1 and V2 refresh project the same live authorization through their own compatibility modes', async () => {
  for (const scenario of ['activated', 'deactivated', 'expired', 'revoked', 'wrong-installation'] as const) {
    const state = await createVersionedHarness(scenario);
    const input = {
      installationId: scenario === 'wrong-installation'
        ? '99999999999999999999999999999999'
        : state.installationId,
      subjectUid: state.subjectUid,
    };
    if (scenario === 'activated') {
      const legacy = await state.legacySessions.refresh(input);
      const v2 = await state.v2Sessions.refresh(input);
      assert.equal(legacy.schemaVersion, 1);
      assert.equal(legacy.resources.some(({ id }) => id === externalId), false);
      assert.equal(v2.schemaVersion, 2);
      assert.equal(v2.resources.some(({ id }) => id === externalId), true);
      assert.equal(JSON.stringify(v2).includes('https://'), false);
    } else {
      await assert.rejects(() => state.legacySessions.refresh(input), isInvalidAccess, scenario);
      await assert.rejects(() => state.v2Sessions.refresh(input), isInvalidAccess, scenario);
    }
  }
});

async function createVersionedHarness(
  scenario: 'activated' | 'deactivated' | 'expired' | 'revoked' | 'wrong-installation',
) {
  const expiresAtMs = nowMs + 60_000;
  const external = {
    access: 'clients',
    active: true,
    createdAtMs: nowMs,
    icon: 'wellness',
    id: externalId,
    revision: 1,
    summary: { en: 'External VIP summary.', 'es-MX': 'Resumen VIP externo.' },
    title: { en: 'External VIP', 'es-MX': 'VIP Externo' },
    updatedAtMs: nowMs,
    url: 'https://wellness.example.org/private/',
  } as const;
  const externalResource = {
    access: 'client',
    iconKey: 'heart-outline',
    id: externalId,
    schemaVersion: 1,
    status: 'active',
    summary: { en: external.summary.en, es: external.summary['es-MX'] },
    title: { en: external.title.en, es: external.title['es-MX'] },
  } as const;
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': {
      items: [external],
      revision: 1,
      schemaVersion: 1,
      updatedAtMs: nowMs,
    },
    [clientResourcePath(externalId)]: externalResource,
  });
  const store = new FirestoreClientAccessStore(database);
  const issued = await new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 8),
    store,
  }).issue({ expiresAtMs, resourceIds: [externalId] });
  let subjectUid = '';
  const redeemDependencies = {
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    resourceResolutionMode: 'v2_all' as const,
    store,
    tokenIssuer: {
      async createCustomToken(uid: string) {
        subjectUid = uid;
        return 'test-custom-token';
      },
    },
  };
  await new ClientAccessRedeemer(redeemDependencies).redeem({
    code: issued.oneTimeCode,
    installationId: '22222222222222222222222222222222',
    requestId: `versioned-refresh-${scenario}-request`,
    sourceAddress: '203.0.113.43',
  });

  if (scenario === 'deactivated') {
    await database.runTransaction(async (transaction) => {
      transaction.set('_private_catalog/current', {
        items: [{ ...external, active: false, revision: 2, updatedAtMs: nowMs + 1 }],
        revision: 2,
        schemaVersion: 1,
        updatedAtMs: nowMs + 1,
      });
    });
  } else if (scenario === 'revoked') {
    await store.revokeAccessCode(issued.summary.codeId, nowMs + 1);
  }

  const refreshNowMs = scenario === 'expired' ? expiresAtMs : nowMs + 2;
  const legacyDependencies = {
    installationHasher: hasher('installation'),
    nowMs: () => refreshNowMs,
    resourceResolutionMode: 'legacy_cabohealth' as const,
    store,
  };
  const v2Dependencies = {
    installationHasher: hasher('installation'),
    nowMs: () => refreshNowMs,
    resourceResolutionMode: 'v2_all' as const,
    store,
  };
  return {
    installationId: '22222222222222222222222222222222',
    legacySessions: new ClientSessionManager(legacyDependencies),
    subjectUid,
    v2Sessions: new ClientSessionManager(v2Dependencies),
  };
}

async function createRedeemedHarness(seed: 1 | 2 | 3 | 4, installationId: string) {
  const database = new InMemoryDocumentDatabase({ [clientResourcePath(resourceId)]: resource });
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, seed),
    store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
    resourceIds: [resourceId],
  });
  let subjectUid = '';
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    resourceResolutionMode: 'legacy_cabohealth',
    store,
    tokenIssuer: {
      async createCustomToken(uid) {
        subjectUid = uid;
        return 'test-custom-token';
      },
    },
  });
  await redeemer.redeem({
    code: issued.oneTimeCode,
    installationId,
    requestId: `request-${installationId.slice(0, 16)}`,
    sourceAddress: '203.0.113.42',
  });
  return {
    installationId,
    sessions: new ClientSessionManager({
      installationHasher: hasher('installation'),
      nowMs: () => nowMs,
      resourceResolutionMode: 'legacy_cabohealth',
      store,
    }),
    subjectUid,
  };
}

function hasher(namespace: string): VersionedHmac {
  const key = createSecretKey(Buffer.from('test-only-pepper-key-with-at-least-32-bytes', 'utf8'));
  return new VersionedHmac({
    currentVersion: '2026-08',
    acceptedVersions: () => ['2026-08'],
    keyFor: () => key,
  }, `cabohealth/${namespace}/test`);
}

function isInvalidAccess(error: unknown): boolean {
  return error instanceof ClientAccessPublicError && error.code === 'invalid_access';
}
