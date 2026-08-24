import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import { AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import { ClientAccessPublicError, ClientAccessRedeemer } from '../../domain/clientAccessRedeemer.js';
import { ClientLaunchService } from '../../domain/clientLaunchService.js';
import { WebSessionBroker } from '../../domain/webSessionBroker.js';
import { clientResourcePath, FirestoreClientAccessStore } from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = Date.UTC(2026, 7, 21);
const installationId = '12121212121212121212121212121212';
const resourceId = 'healthy-recipes-client';

test('broker exchanges one launch nonce for a hashed one-hour web session with live introspection and CSRF revoke', async () => {
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(resourceId)]: {
      access: 'client', iconKey: 'nutrition', id: resourceId, schemaVersion: 1, status: 'active',
      summary: { en: 'Client guide.', es: 'Guía para clientes.' },
      title: { en: 'Nutrition Guide', es: 'Guía de Nutrición' },
    },
  });
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'), nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 41), store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 2 * 60 * 60 * 1_000, resourceIds: [resourceId],
  });
  let subjectUid = '';
  await new ClientAccessRedeemer({
    codeHasher: hasher('code'), installationHasher: hasher('installation'),
    nowMs: () => nowMs, rateLimitHasher: hasher('rate'), store,
    tokenIssuer: { async createCustomToken(uid) { subjectUid = uid; return 'test-token'; } },
  }).redeem({
    code: issued.oneTimeCode, installationId,
    requestId: 'broker-request-00000000000001', sourceAddress: '203.0.113.42',
  });
  const launch = await new ClientLaunchService({
    installationHasher: hasher('installation'), nonceHasher: hasher('nonce'),
    nowMs: () => nowMs, randomSource: () => Buffer.alloc(24, 42), store,
  }).create({ installationId, resourceId, subjectUid });
  const broker = new WebSessionBroker({
    csrfHasher: hasher('csrf'), nonceHasher: hasher('nonce'),
    nowMs: () => nowMs, randomSource: () => Buffer.alloc(32, 43),
    sessionHasher: hasher('web-session'), store,
  });

  const redeemed = await broker.redeemLaunch({
    brokerRequestHash: 'broker_hash_redeem_00000000000000000001',
    nonce: launch.nonce,
  });
  assert.deepEqual(redeemed, {
    expiresAtMs: nowMs + 60 * 60 * 1_000,
    sessionId: Buffer.alloc(32, 43).toString('base64url'),
  });
  const persisted = database.serializedState();
  assert.equal(persisted.includes(launch.nonce), false);
  assert.equal(persisted.includes(redeemed.sessionId), false);

  const session = await broker.introspect({
    brokerRequestHash: 'broker_hash_introspect_0000000000001',
    sessionId: redeemed.sessionId,
  });
  assert.equal(session.active, true);
  assert.deepEqual(session.entitlements, [resourceId]);
  assert.equal(typeof session.csrfToken, 'string');
  assert.equal(JSON.stringify(session).includes('https://'), false);

  await assert.rejects(
    broker.revoke({
      brokerRequestHash: 'broker_hash_revoke_bad_000000000001',
      csrfToken: 'invalid-csrf-token',
      sessionId: redeemed.sessionId,
    }),
    (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'invalid_access',
  );
  await assert.rejects(
    broker.revoke({
      brokerRequestHash: 'broker_hash_revoke_padded_0000000001',
      csrfToken: `${session.csrfToken}=`,
      sessionId: redeemed.sessionId,
    }),
    (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'invalid_access',
  );
  assert.deepEqual(await broker.revoke({
    brokerRequestHash: 'broker_hash_revoke_good_00000000001',
    csrfToken: session.csrfToken,
    sessionId: redeemed.sessionId,
  }), { revoked: true });
  await assert.rejects(
    broker.introspect({
      brokerRequestHash: 'broker_hash_introspect_after_0001',
      sessionId: redeemed.sessionId,
    }),
    (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'invalid_access',
  );
});

test('a live web session fails closed as soon as its production code is revoked', async () => {
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(resourceId)]: {
      access: 'client', iconKey: 'nutrition', id: resourceId, schemaVersion: 1, status: 'active',
      summary: { en: 'Client guide.', es: 'Guía para clientes.' },
      title: { en: 'Nutrition Guide', es: 'Guía de Nutrición' },
    },
  });
  const store = new FirestoreClientAccessStore(database);
  const issued = await new AccessCodeIssuer({
    codeHasher: hasher('code'), nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 51), store,
  }).issue({ expiresAtMs: nowMs + 7_200_000, resourceIds: [resourceId] });
  let subjectUid = '';
  await new ClientAccessRedeemer({
    codeHasher: hasher('code'), installationHasher: hasher('installation'),
    nowMs: () => nowMs, rateLimitHasher: hasher('rate'), store,
    tokenIssuer: { async createCustomToken(uid) { subjectUid = uid; return 'test-token'; } },
  }).redeem({
    code: issued.oneTimeCode, installationId,
    requestId: 'broker-revoke-request-00000001', sourceAddress: '203.0.113.43',
  });
  const launch = await new ClientLaunchService({
    installationHasher: hasher('installation'), nonceHasher: hasher('nonce'),
    nowMs: () => nowMs, randomSource: () => Buffer.alloc(24, 52), store,
  }).create({ installationId, resourceId, subjectUid });
  const broker = new WebSessionBroker({
    csrfHasher: hasher('csrf'), nonceHasher: hasher('nonce'),
    nowMs: () => nowMs, randomSource: () => Buffer.alloc(32, 53),
    sessionHasher: hasher('web-session'), store,
  });
  const session = await broker.redeemLaunch({
    brokerRequestHash: 'broker_hash_live_redeem_00000000000001', nonce: launch.nonce,
  });

  await store.revokeAccessCode(issued.summary.codeId, nowMs + 1);
  await assert.rejects(broker.introspect({
    brokerRequestHash: 'broker_hash_live_introspect_0000000001',
    sessionId: session.sessionId,
  }), (error: unknown) => (
    error instanceof ClientAccessPublicError && error.code === 'invalid_access'
  ));
});

function hasher(namespace: string): VersionedHmac {
  const key = createSecretKey(Buffer.from('test-only-pepper-key-with-at-least-32-bytes', 'utf8'));
  return new VersionedHmac({
    currentVersion: '2026-08', acceptedVersions: () => ['2026-08'], keyFor: () => key,
  }, `cabohealth/${namespace}/test`);
}
