import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import { AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import { ClientAccessPublicError, ClientAccessRedeemer } from '../../domain/clientAccessRedeemer.js';
import { ClientLaunchService } from '../../domain/clientLaunchService.js';
import { clientResourcePath, FirestoreClientAccessStore } from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = Date.UTC(2026, 7, 21);
const installationId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const resourceId = 'healthy-recipes-client';

test('a 60-second launch nonce reveals no target, is stored hashed, and can be consumed once', async () => {
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
    randomSource: () => Buffer.alloc(16, 7), store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 86_400_000, resourceIds: [resourceId], slot: 1,
  });
  let subjectUid = '';
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'), installationHasher: hasher('installation'),
    nowMs: () => nowMs, rateLimitHasher: hasher('rate'), store,
    tokenIssuer: { async createCustomToken(uid) { subjectUid = uid; return 'test-token'; } },
  });
  await redeemer.redeem({
    code: issued.oneTimeCode, installationId,
    requestId: 'launch-request-0000000000000001', sourceAddress: '203.0.113.42',
  });
  const launches = new ClientLaunchService({
    installationHasher: hasher('installation'),
    nonceHasher: hasher('launch-nonce'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(24, 9),
    store,
  });

  const launch = await launches.create({ installationId, resourceId, subjectUid });
  assert.deepEqual(launch, {
    expiresAtMs: nowMs + 60_000,
    launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
    method: 'POST',
    nonce: Buffer.alloc(24, 9).toString('base64url'),
  });
  assert.equal(database.serializedState().includes(launch.nonce), false);
  assert.deepEqual(await launches.consume({ nonce: launch.nonce }), { resourceId });
  await assert.rejects(
    launches.consume({ nonce: launch.nonce }),
    (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'invalid_access',
  );
});

function hasher(namespace: string): VersionedHmac {
  const key = createSecretKey(Buffer.from('test-only-pepper-key-with-at-least-32-bytes', 'utf8'));
  return new VersionedHmac({
    currentVersion: '2026-08', acceptedVersions: () => ['2026-08'], keyFor: () => key,
  }, `cabohealth/${namespace}/test`);
}
