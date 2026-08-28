import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import {
  ClientAccessRedeemer,
  type CustomTokenIssuer,
  type RedeemCommand,
  type RedemptionStore,
} from '../../domain/clientAccessRedeemer.js';
import {
  ClientSessionManager,
  type ClientSessionStore,
} from '../../domain/clientSessionManager.js';
import { VersionedHmac } from '../../security/versionedHmac.js';

const grant = Object.freeze({
  schemaVersion: 1 as const,
  status: 'active' as const,
  expiresAtMs: Date.UTC(2027, 0, 1),
  resources: Object.freeze([Object.freeze({
    access: 'client' as const,
    iconKey: 'nutrition',
    id: 'healthy-recipes-client',
    summary: Object.freeze({ en: 'Client nutrition guide.', es: 'Guía de nutrición para clientes.' }),
    title: Object.freeze({ en: 'Nutrition Guide', es: 'Guía de Nutrición' }),
  })]),
});

const testHasherKey = createSecretKey(
  Buffer.from('test-only-pepper-key-with-at-least-32-bytes', 'utf8'),
);

function compileTimeExplicitModeContract(
  redemptionStore: RedemptionStore,
  sessionStore: ClientSessionStore,
  tokenIssuer: CustomTokenIssuer,
): void {
  const redeemerDependenciesWithoutMode = {
    codeHasher: testHasher('code'),
    installationHasher: testHasher('installation'),
    rateLimitHasher: testHasher('rate-limit'),
    store: redemptionStore,
    tokenIssuer,
  };
  // @ts-expect-error resourceResolutionMode must be selected explicitly.
  new ClientAccessRedeemer(redeemerDependenciesWithoutMode);

  const sessionDependenciesWithoutMode = {
    installationHasher: testHasher('installation'),
    store: sessionStore,
  };
  // @ts-expect-error resourceResolutionMode must be selected explicitly.
  new ClientSessionManager(sessionDependenciesWithoutMode);
}
void compileTimeExplicitModeContract;

test('redeeming sends only digests to persistence and returns a token plus sanitized grant', async () => {
  let capturedCommand: RedeemCommand | undefined;
  const store: RedemptionStore = {
    async redeem(command) {
      capturedCommand = command;
      return { kind: 'granted', grant, subjectUid: 'client_opaque_subject' };
    },
  };
  const tokenIssuer = {
    async createCustomToken(subjectUid: string) {
      assert.equal(subjectUid, 'client_opaque_subject');
      return 'test-custom-token';
    },
  };
  const dependencies = {
    codeHasher: testHasher('code'),
    installationHasher: testHasher('installation'),
    nowMs: () => Date.UTC(2026, 7, 21),
    rateLimitHasher: testHasher('rate-limit'),
    resourceResolutionMode: 'legacy_cabohealth' as const,
    store,
    tokenIssuer,
  };
  const redeemer = new ClientAccessRedeemer(dependencies);

  const result = await redeemer.redeem({
    code: 'CH-00112233-44556677-8899AABB-CCDDEEFF',
    installationId: '3b8d6f01-9215-4da6-9ec2-97aa938f7358',
    requestId: '83044b11-bdd6-4df8-aa63-83b3b9243767',
    sourceAddress: '203.0.113.42',
  });

  assert.deepEqual(result, { customToken: 'test-custom-token', grant });
  assert.ok(capturedCommand);
  const persistencePayload = JSON.stringify(capturedCommand);
  assert.equal(persistencePayload.includes('00112233'), false);
  assert.equal(persistencePayload.includes('3b8d6f01'), false);
  assert.equal(persistencePayload.includes('203.0.113.42'), false);
  assert.equal(persistencePayload.includes('83044b11'), false);
  assert.equal(
    (capturedCommand as RedeemCommand & { resourceResolutionMode?: string })
      .resourceResolutionMode,
    'legacy_cabohealth',
  );
});

function testHasher(namespace: string): VersionedHmac {
  return new VersionedHmac(
    {
      currentVersion: '2026-08',
      acceptedVersions: () => ['2026-08'],
      keyFor: () => testHasherKey,
    },
    `cabohealth/${namespace}/test`,
  );
}
