import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import { AccessCodeInputError, AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import {
  ClientAccessPublicError,
  ClientAccessRedeemer,
} from '../../domain/clientAccessRedeemer.js';
import {
  clientResourcePath,
  FirestoreClientAccessStore,
} from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = Date.UTC(2026, 7, 21);
const resource = Object.freeze({
  access: 'client',
  iconKey: 'nutrition',
  id: 'healthy-recipes-client',
  schemaVersion: 1,
  status: 'active',
  summary: { en: 'Client nutrition guide.', es: 'Guía de nutrición para clientes.' },
  title: { en: 'Nutrition Guide', es: 'Guía de Nutrición' },
});

test('the first successful redemption binds a code to one installation and mismatches stay generic', async () => {
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(resource.id)]: resource,
  });
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.from('00112233445566778899aabbccddeeff', 'hex'),
    store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
    resourceIds: [resource.id],
  });
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: { createCustomToken: async () => 'test-custom-token' },
  });

  const first = await redeemer.redeem(redemptionInput(issued.oneTimeCode, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  assert.equal(first.grant.resources[0]?.id, resource.id);

  await assert.rejects(
    redeemer.redeem(redemptionInput(issued.oneTimeCode, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
    (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'invalid_access',
  );

  const state = database.serializedState();
  assert.equal(state.includes(issued.oneTimeCode), false);
  assert.equal(state.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), false);
  assert.equal(state.includes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), false);
});

test('code creation fails closed when a requested client resource is not in the fixed live catalog', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'), nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 5), store,
  });

  await assert.rejects(issuer.issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds: ['not-reviewed-resource'],
  }), (error: unknown) => error instanceof AccessCodeInputError);
  assert.equal(database.serializedState().includes('_private_access_codes/'), false);
});

test('five malformed attempts lock only their hashed source-and-installation bucket', async () => {
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(resource.id)]: resource,
  });
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.from('ffeeddccbbaa99887766554433221100', 'hex'),
    store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
    resourceIds: [resource.id],
  });
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: { createCustomToken: async () => 'test-custom-token' },
  });
  const attackedInstallation = 'cccccccccccccccccccccccccccccccc';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      redeemer.redeem(redemptionInput('not-a-client-code', attackedInstallation)),
      (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'invalid_access',
    );
  }
  await assert.rejects(
    redeemer.redeem(redemptionInput('not-a-client-code', attackedInstallation)),
    (error: unknown) => error instanceof ClientAccessPublicError
      && error.code === 'rate_limited'
      && error.retryAfterSeconds === 900,
  );

  const legitimateInstallation = 'dddddddddddddddddddddddddddddddd';
  const legitimate = await redeemer.redeem(redemptionInput(issued.oneTimeCode, legitimateInstallation));
  assert.equal(legitimate.grant.status, 'active');
  await assert.rejects(
    redeemer.redeem(redemptionInput('not-a-client-code', attackedInstallation)),
    (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'rate_limited',
  );
});

test('admin list exposes only active code summaries and revocation removes one chosen access', async () => {
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(resource.id)]: resource,
  });
  const store = new FirestoreClientAccessStore(database);
  let sequence = 10;
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, sequence++),
    store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
    resourceIds: [resource.id],
  });

  assert.deepEqual(await store.listAccessCodes(nowMs), [{
    codeId: issued.summary.codeId,
    createdAtMs: nowMs,
    displaySuffix: issued.summary.displaySuffix,
    expiresAtMs: issued.summary.expiresAtMs,
    status: 'active',
  }]);
  const listed = JSON.stringify(await store.listAccessCodes(nowMs));
  assert.equal(listed.includes(issued.oneTimeCode), false);
  assert.equal(listed.includes(resource.summary.en), false);

  assert.deepEqual(await store.revokeAccessCode(issued.summary.codeId, nowMs + 1), {
    kind: 'revoked',
    subjectUid: null,
  });
  const replacement = await issuer.issue({
    expiresAtMs: nowMs + 60 * 24 * 60 * 60 * 1_000,
    resourceIds: [resource.id],
  });
  assert.notEqual(replacement.summary.codeId, issued.summary.codeId);
});

test('bridge reader accepts legacy and transitional schema v1 while new slotless codes use schema v2', async () => {
  const legacyCodeId = `ac_${'a'.repeat(32)}`;
  const legacyCode = {
    boundInstallationLookupId: null,
    codeId: legacyCodeId,
    createdAtMs: nowMs - 1,
    displaySuffix: 'AAAA',
    expiresAtMs: nowMs + 86_400_000,
    hashVersion: '2026-08',
    lookupId: 'legacy-lookup',
    purpose: 'cabohealth_client',
    redeemedAtMs: null,
    resourceIds: [resource.id],
    schemaVersion: 1,
    scope: 'production_client',
    slot: 1,
    status: 'active',
    subjectUid: null,
    updatedAtMs: nowMs - 1,
  };
  const transitionalCodeId = `ac_${'c'.repeat(32)}`;
  const transitionalCode = {
    ...legacyCode,
    codeId: transitionalCodeId,
    displaySuffix: 'CCCC',
    lookupId: 'transitional-lookup',
  };
  delete (transitionalCode as Partial<typeof legacyCode>).slot;
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(resource.id)]: resource,
    [`_private_access_codes/${legacyCodeId}`]: legacyCode,
    [`_private_access_codes/${transitionalCodeId}`]: transitionalCode,
  });
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 99),
    store,
  });

  const issued = await issuer.issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds: [resource.id],
  });
  const state = JSON.parse(database.serializedState()) as Record<string, Record<string, unknown>>;
  assert.equal(state[`_private_access_codes/${issued.summary.codeId}`]?.schemaVersion, 2);
  assert.equal('slot' in state[`_private_access_codes/${issued.summary.codeId}`]!, false);
  assert.deepEqual(
    (await store.listAccessCodes(nowMs)).map(({ codeId }) => codeId).sort(),
    [issued.summary.codeId, legacyCodeId, transitionalCodeId].sort(),
  );
});

test('access-code schema versions reject ambiguous slot shapes', async (t) => {
  const baseCode = {
    boundInstallationLookupId: null,
    codeId: `ac_${'b'.repeat(32)}`,
    createdAtMs: nowMs,
    displaySuffix: 'BBBB',
    expiresAtMs: nowMs + 86_400_000,
    hashVersion: '2026-08',
    lookupId: 'ambiguous-lookup',
    purpose: 'cabohealth_client',
    redeemedAtMs: null,
    resourceIds: [resource.id],
    scope: 'production_client',
    status: 'active',
    subjectUid: null,
    updatedAtMs: nowMs,
  };
  for (const [name, malformed] of [
    ['schema v1 with an explicit undefined slot', { ...baseCode, schemaVersion: 1, slot: undefined }],
    ['schema v1 with an invalid slot', { ...baseCode, schemaVersion: 1, slot: 5 }],
    ['schema v2 with a legacy slot', { ...baseCode, schemaVersion: 2, slot: 1 }],
    ['schema v2 with an explicit undefined slot', {
      ...baseCode,
      schemaVersion: 2,
      slot: undefined,
    }],
  ] as const) {
    await t.test(name, async () => {
      const database = new InMemoryDocumentDatabase({
        [`_private_access_codes/${baseCode.codeId}`]: malformed,
      });
      await assert.rejects(
        new FirestoreClientAccessStore(database).listAccessCodes(nowMs),
        /invalid_access_code_record/u,
      );
    });
  }
});

test('an IP-only bucket stops callers that rotate installation identifiers', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreClientAccessStore(database);
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: { createCustomToken: async () => 'unreachable' },
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await assert.rejects(
      redeemer.redeem(redemptionInput(
        'not-a-client-code',
        attempt.toString(16).padStart(32, '0'),
      )),
      (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'invalid_access',
    );
  }
  await assert.rejects(
    redeemer.redeem(redemptionInput('not-a-client-code', 'ffffffffffffffffffffffffffffffff')),
    (error: unknown) => error instanceof ClientAccessPublicError && error.code === 'rate_limited',
  );
});

test('more than four active codes are supported and expired codes are reconciled independently', async () => {
  const database = new InMemoryDocumentDatabase(
    { [clientResourcePath(resource.id)]: resource },
    { rejectDuplicateWrites: true },
  );
  const store = new FirestoreClientAccessStore(database);
  let clock = nowMs;
  let sequence = 20;
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => clock,
    randomSource: () => Buffer.alloc(16, sequence++),
    store,
  });
  for (let index = 0; index < 12; index += 1) {
    await issuer.issue({
      expiresAtMs: clock + 1_000,
      resourceIds: [resource.id],
    });
  }

  clock += 2_000;
  const replacement = await issuer.issue({
    expiresAtMs: clock + 86_400_000,
    resourceIds: [resource.id],
  });
  const active = await store.listAccessCodes(clock);
  assert.deepEqual(active.map(({ codeId }) => codeId), [replacement.summary.codeId]);
});

test('admin list reconciles expired codes and hides revoked history from active access', async () => {
  const database = new InMemoryDocumentDatabase({ [clientResourcePath(resource.id)]: resource });
  const store = new FirestoreClientAccessStore(database);
  let sequence = 60;
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'), nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, sequence++), store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 1_000, resourceIds: [resource.id],
  });

  assert.deepEqual(await store.listAccessCodes(nowMs + 2_000), []);
  const state = JSON.parse(database.serializedState()) as Record<string, Record<string, unknown>>;
  assert.equal(state[`_private_access_codes/${issued.summary.codeId}`]?.status, 'revoked');
  assert.equal(Object.keys(state).some((path) => path.startsWith('_private_client_slots/')), false);
});

test('scheduled reconciliation expires every selected client code without a fixed slot ledger', async () => {
  const database = new InMemoryDocumentDatabase(
    { [clientResourcePath(resource.id)]: resource },
    { rejectDuplicateWrites: true },
  );
  const store = new FirestoreClientAccessStore(database);
  let sequence = 70;
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'), nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, sequence++), store,
  });
  const retained = await issuer.issue({
    expiresAtMs: nowMs + 86_400_000, resourceIds: [resource.id],
  });
  for (let index = 0; index < 6; index += 1) {
    await issuer.issue({
      expiresAtMs: nowMs + 1_000, resourceIds: [resource.id],
    });
  }

  await store.reconcileExpiredClientAccess(nowMs + 2_000);
  assert.deepEqual(await store.revokeAccessCode(retained.summary.codeId, nowMs + 2_000), {
    kind: 'revoked', subjectUid: null,
  });
  const state = JSON.parse(database.serializedState()) as Record<string, Record<string, unknown>>;
  assert.equal(Object.entries(state).filter(([path, value]) => (
    path.startsWith('_private_access_codes/') && value.status === 'active'
  )).length, 0);
  assert.equal(Object.keys(state).some((path) => path.startsWith('_private_client_slots/')), false);
});

test('retrying the same request id reuses one subject without repeating redemption writes', async () => {
  const database = new InMemoryDocumentDatabase({ [clientResourcePath(resource.id)]: resource });
  const store = new FirestoreClientAccessStore(database);
  let clock = nowMs;
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'), nowMs: () => clock,
    randomSource: () => Buffer.alloc(16, 31), store,
  });
  const issued = await issuer.issue({
    expiresAtMs: clock + 86_400_000, resourceIds: [resource.id],
  });
  const subjects: string[] = [];
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasher('code'), installationHasher: hasher('installation'),
    nowMs: () => clock, rateLimitHasher: hasher('rate-limit'), store,
    tokenIssuer: { async createCustomToken(uid) { subjects.push(uid); return `token-${subjects.length}`; } },
  });
  const input = {
    code: issued.oneTimeCode,
    installationId: 'abababababababababababababababab',
    requestId: 'fixed-idempotency-request-0001',
    sourceAddress: '203.0.113.42',
  };
  await redeemer.redeem(input);
  clock += 10_000;
  await redeemer.redeem(input);

  assert.deepEqual(subjects, [subjects[0], subjects[0]]);
  const state = JSON.parse(database.serializedState()) as Record<string, Record<string, unknown>>;
  const code = state[`_private_access_codes/${issued.summary.codeId}`]!;
  assert.equal(code.updatedAtMs, nowMs);
  assert.equal(Object.keys(state).filter((path) => path.startsWith('_private_redemption_requests/')).length, 1);
});

function redemptionInput(code: string, installationId: string) {
  return {
    code,
    installationId,
    requestId: `request-${installationId.slice(0, 16)}`,
    sourceAddress: '203.0.113.42',
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
