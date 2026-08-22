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

test('delete removes the pseudonymous grant and rejects all later refreshes', async () => {
  const harness = await createRedeemedHarness(2, '22222222222222222222222222222222');

  assert.deepEqual(await harness.sessions.deleteAccount({
    installationId: harness.installationId,
    subjectUid: harness.subjectUid,
  }), { deleted: true });
  await assert.rejects(
    harness.sessions.refresh({
      installationId: harness.installationId,
      subjectUid: harness.subjectUid,
    }),
    isInvalidAccess,
  );
});

async function createRedeemedHarness(slot: 1 | 2 | 3 | 4, installationId: string) {
  const database = new InMemoryDocumentDatabase({ [clientResourcePath(resourceId)]: resource });
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, slot),
    store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
    resourceIds: [resourceId],
    slot,
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
