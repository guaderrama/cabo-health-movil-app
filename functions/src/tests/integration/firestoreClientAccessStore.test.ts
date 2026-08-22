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
    slot: 1,
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
    slot: 1,
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
    slot: 1,
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

test('admin list exposes only slot and suffix, and revoking frees that production slot', async () => {
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
    slot: 1,
  });

  assert.deepEqual(await store.listAccessCodes(nowMs), [{
    codeId: issued.summary.codeId,
    createdAtMs: nowMs,
    displaySuffix: issued.summary.displaySuffix,
    expiresAtMs: issued.summary.expiresAtMs,
    slot: 1,
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
    slot: 1,
  });
  assert.notEqual(replacement.summary.codeId, issued.summary.codeId);
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

test('expired codes are reconciled transactionally so they cannot lock all four slots', async () => {
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
  for (const slot of [1, 2, 3, 4] as const) {
    await issuer.issue({
      expiresAtMs: clock + 1_000,
      resourceIds: [resource.id],
      slot,
    });
  }

  clock += 2_000;
  const replacement = await issuer.issue({
    expiresAtMs: clock + 86_400_000,
    resourceIds: [resource.id],
    slot: 1,
  });
  const active = (await store.listAccessCodes(clock)).filter(({ status }) => status === 'active');
  assert.deepEqual(active.map(({ codeId, slot }) => ({ codeId, slot })), [{
    codeId: replacement.summary.codeId,
    slot: 1,
  }]);
});

test('admin list itself reconciles expired slots and counter before another create', async () => {
  const database = new InMemoryDocumentDatabase({ [clientResourcePath(resource.id)]: resource });
  const store = new FirestoreClientAccessStore(database);
  let sequence = 60;
  const issuer = new AccessCodeIssuer({
    codeHasher: hasher('code'), nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, sequence++), store,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 1_000, resourceIds: [resource.id], slot: 1,
  });

  assert.deepEqual(await store.listAccessCodes(nowMs + 2_000), [{
    codeId: issued.summary.codeId,
    createdAtMs: nowMs,
    displaySuffix: issued.summary.displaySuffix,
    expiresAtMs: issued.summary.expiresAtMs,
    slot: 1,
    status: 'revoked',
  }]);
  const state = JSON.parse(database.serializedState()) as Record<string, Record<string, unknown>>;
  assert.equal(state['_private_admin_counters/active_client_codes']?.activeCount, 0);
  assert.equal(state['_private_client_slots/1'], undefined);
});

test('admin revoke reconciles every other expired slot in the same transaction', async () => {
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
    expiresAtMs: nowMs + 86_400_000, resourceIds: [resource.id], slot: 1,
  });
  for (const slot of [2, 3, 4] as const) {
    await issuer.issue({
      expiresAtMs: nowMs + 1_000, resourceIds: [resource.id], slot,
    });
  }

  assert.deepEqual(await store.revokeAccessCode(retained.summary.codeId, nowMs + 2_000), {
    kind: 'revoked', subjectUid: null,
  });
  const state = JSON.parse(database.serializedState()) as Record<string, Record<string, unknown>>;
  assert.equal(state['_private_admin_counters/active_client_codes']?.activeCount, 0);
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
    expiresAtMs: clock + 86_400_000, resourceIds: [resource.id], slot: 1,
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
