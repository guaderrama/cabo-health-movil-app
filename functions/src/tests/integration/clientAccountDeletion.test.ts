import assert from 'node:assert/strict';
import { createSecretKey } from 'node:crypto';
import { test } from 'node:test';

import { AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import { AdminClientAccessRevocationService } from '../../domain/adminClientAccessRevocation.js';
import { ClientAccessRemovalService } from '../../domain/clientAccessRemoval.js';
import {
  AccountDeletionMaintenanceBatchError,
  AccountDeletionRetryBatchError,
  type ClientAccountDeletionStore,
  ClientAccountDeletionMaintenanceService,
  ClientAccountDeletionService,
} from '../../domain/clientAccountDeletion.js';
import { ClientAccessRedeemer } from '../../domain/clientAccessRedeemer.js';
import { ClientLaunchService } from '../../domain/clientLaunchService.js';
import { ClientSessionManager } from '../../domain/clientSessionManager.js';
import { WebSessionBroker } from '../../domain/webSessionBroker.js';
import {
  clientResourcePath,
  type DocumentDatabase,
  FirestoreClientAccessStore,
} from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = Date.UTC(2026, 7, 21);
const installationId = '11111111111111111111111111111111';
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

test('an Auth failure leaves a durable revoked deletion job that the client can retry idempotently', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  let authAttempts = 0;
  let authUnavailable = true;
  const deletion = new ClientAccountDeletionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        assert.equal(subjectUid, harness.subjectUid);
        authAttempts += 1;
        if (authUnavailable) throw new Error('temporary_auth_failure');
      },
    },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store: harness.store,
  });

  assert.deepEqual(await deletion.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'pending' });
  const pendingState = harness.database.serializedState();
  assert.match(pendingState, /_private_account_deletions/u);
  assert.match(pendingState, /"status":"revoked"/u);

  assert.deepEqual(await deletion.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'pending' });
  authUnavailable = false;
  assert.deepEqual(await deletion.retryPending(), { completed: 1, pending: 0 });
  const completedState = harness.database.serializedState();
  assert.doesNotMatch(completedState, /_private_account_deletions/u);
  assert.equal(completedState.includes(harness.subjectUid), false);
  assert.equal(completedState.includes(harness.codeId), false);
  assert.equal(authAttempts, 3);
});

test('completed deletion removes linked launch, web-session, and redemption artifacts', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  await assert.rejects(harness.redeemer.redeem({
    code: 'CH-00000000-00000000-00000000-00000000',
    installationId,
    requestId: 'request-account-delete-failure',
    sourceAddress: '203.0.113.42',
  }));
  const launch = await new ClientLaunchService({
    installationHasher: hasher('installation'),
    nonceHasher: hasher('launch-nonce'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(24, 7),
    store: harness.store,
  }).create({ installationId, resourceId, subjectUid: harness.subjectUid });
  await new WebSessionBroker({
    csrfHasher: hasher('web-csrf'),
    nonceHasher: hasher('launch-nonce'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(32, 8),
    sessionHasher: hasher('web-session'),
    store: harness.store,
  }).redeemLaunch({
    brokerRequestHash: 'broker-delete-request-000000001',
    nonce: launch.nonce,
  });
  await harness.database.runTransaction(async (transaction) => {
    transaction.create('_private_launch_nonces/malformed-linked-record', {
      codeId: harness.codeId,
      schemaVersion: 999,
      subjectUid: harness.subjectUid,
    });
  });
  const linkedState = harness.database.serializedState();
  assert.match(linkedState, /_private_launch_nonces/u);
  assert.match(linkedState, /_private_web_sessions/u);
  assert.match(linkedState, /_private_redemption_requests/u);
  assert.equal((await harness.database.listCollection('_private_rate_limits')).length, 2);

  const deletion = new ClientAccountDeletionService({
    authAccounts: { async deleteUser() {} },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store: harness.store,
  });
  assert.deepEqual(await deletion.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'completed' });

  const completedState = harness.database.serializedState();
  assert.doesNotMatch(completedState, /_private_launch_nonces/u);
  assert.doesNotMatch(completedState, /_private_web_sessions/u);
  assert.doesNotMatch(completedState, /_private_redemption_requests/u);
  const residualRateLimits = await harness.database.listCollection('_private_rate_limits');
  assert.equal(residualRateLimits.length, 1);
  const residualRateLimit = residualRateLimits[0]?.value;
  assert.ok(isRecord(residualRateLimit));
  assert.equal(Object.hasOwn(residualRateLimit, 'subjectUid'), false);
  assert.equal(Object.hasOwn(residualRateLimit, 'codeId'), false);
  assert.equal(
    residualRateLimit.expiresAtMs,
    nowMs + 2 * 15 * 60 * 1_000,
  );
});

test('a client can request deletion after an administrator revoked the code', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  assert.equal((await harness.store.revokeAccessCode(harness.codeId, nowMs)).kind, 'revoked');
  const deletion = new ClientAccountDeletionService({
    authAccounts: { async deleteUser() {} },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    store: harness.store,
  });

  assert.deepEqual(await deletion.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'completed' });
});

test('admin revocation durably enqueues deletion that the worker completes without a client token', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  const revoked = await harness.store.revokeAccessCode(harness.codeId, nowMs);
  assert.deepEqual(revoked, { kind: 'revoked', subjectUid: harness.subjectUid });
  assert.match(harness.database.serializedState(), /_private_account_deletions/u);

  const deletion = new ClientAccountDeletionService({
    authAccounts: { async deleteUser() {} },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    store: harness.store,
  });
  assert.deepEqual(await deletion.retryPending(), { completed: 1, pending: 0 });
  assert.doesNotMatch(harness.database.serializedState(), /_private_account_deletions/u);
});

test('admin revocation succeeds with a durable tombstone when immediate cleanup fails', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  const failingCleanupDatabase: DocumentDatabase = {
    listCollection(path) {
      if (path === '_private_launch_nonces') {
        return Promise.reject(new Error('injected_cleanup_failure'));
      }
      return harness.database.listCollection(path);
    },
    runTransaction(operation) {
      return harness.database.runTransaction(operation);
    },
  };
  const store = new FirestoreClientAccessStore(failingCleanupDatabase);
  const deletion = new ClientAccountDeletionService({
    authAccounts: { async deleteUser() {} },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store,
  });
  const revocation = new AdminClientAccessRevocationService({
    accountDeletion: deletion,
    nowMs: () => nowMs,
    store,
  });

  assert.deepEqual(await revocation.revoke(harness.codeId), { kind: 'revoked' });
  assert.match(harness.database.serializedState(), /_private_account_deletions/u);
});

test('retrying a committed admin revocation remains successful while cleanup is pending', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  const failingCleanupDatabase: DocumentDatabase = {
    listCollection(path) {
      if (path === '_private_launch_nonces') {
        return Promise.reject(new Error('injected_cleanup_failure'));
      }
      return harness.database.listCollection(path);
    },
    runTransaction(operation) {
      return harness.database.runTransaction(operation);
    },
  };
  const store = new FirestoreClientAccessStore(failingCleanupDatabase);
  const revocation = new AdminClientAccessRevocationService({
    accountDeletion: new ClientAccountDeletionService({
      authAccounts: { async deleteUser() {} },
      installationHasher: hasher('installation'),
      nowMs: () => nowMs,
      store,
    }),
    nowMs: () => nowMs,
    store,
  });

  assert.deepEqual(await revocation.revoke(harness.codeId), { kind: 'revoked' });
  assert.deepEqual(await revocation.revoke(harness.codeId), { kind: 'revoked' });
  assert.match(harness.database.serializedState(), /_private_account_deletions/u);
});

test('a client can request deletion after the access code and grant expired', async () => {
  const harness = await createRedeemedHarness(nowMs + 1_000);
  const deletion = new ClientAccountDeletionService({
    authAccounts: { async deleteUser() {} },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 2_000,
    store: harness.store,
  });

  assert.deepEqual(await deletion.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'completed' });
});

test('natural expiry durably queues and completes cleanup for a redeemed client identity', async () => {
  const harness = await createRedeemedHarness(nowMs + 1_000);

  await harness.store.reconcileExpiredClientAccess(nowMs + 2_000);

  const queuedState = harness.database.serializedState();
  assert.match(queuedState, /_private_account_deletions/u);
  assert.match(queuedState, /"status":"revoked"/u);

  const deletedSubjects: string[] = [];
  const deletion = new ClientAccountDeletionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        deletedSubjects.push(subjectUid);
      },
    },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 2_001,
    store: harness.store,
  });
  assert.deepEqual(await deletion.retryPending(), { completed: 1, pending: 0 });
  assert.deepEqual(deletedSubjects, [harness.subjectUid]);
  const completedState = harness.database.serializedState();
  assert.equal(completedState.includes(harness.subjectUid), false);
  assert.deepEqual(await harness.database.listCollection('_private_access_codes'), []);
  assert.deepEqual(await harness.database.listCollection('_private_client_grants'), []);
  assert.deepEqual(await harness.database.listCollection('_private_account_deletions'), []);
});

test('replacing an expired redeemed slot cannot bypass durable identity cleanup', async () => {
  const harness = await createRedeemedHarness(nowMs + 1_000);

  await new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs + 2_000,
    randomSource: () => Buffer.alloc(16, 2),
    store: harness.store,
  }).issue({
    expiresAtMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
    resourceIds: [resourceId],
    slot: 1,
  });

  const queued = await harness.database.listCollection('_private_account_deletions');
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.id, harness.subjectUid);
});

test('natural expiry of an unredeemed code creates no account-deletion job', async () => {
  const database = new InMemoryDocumentDatabase({ [clientResourcePath(resourceId)]: resource });
  const store = new FirestoreClientAccessStore(database);
  await new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 3),
    store,
  }).issue({ expiresAtMs: nowMs + 1_000, resourceIds: [resourceId], slot: 1 });

  await store.reconcileExpiredClientAccess(nowMs + 2_000);

  assert.deepEqual(await database.listCollection('_private_account_deletions'), []);
  assert.deepEqual(await database.listCollection('_private_client_grants'), []);
});

test('remove durably enqueues deletion and the worker completes after an Auth outage', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  let authUnavailable = true;
  let authAttempts = 0;
  const deletion = new ClientAccountDeletionService({
    authAccounts: {
      async deleteUser() {
        authAttempts += 1;
        if (authUnavailable) throw new Error('temporary_auth_failure');
      },
    },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store: harness.store,
  });
  const removal = new ClientAccessRemovalService({
    accountDeletion: deletion,
    sessions: new ClientSessionManager({
      installationHasher: hasher('installation'),
      nowMs: () => nowMs,
      store: harness.store,
    }),
  });

  assert.deepEqual(await removal.remove({
    installationId,
    subjectUid: harness.subjectUid,
  }), { removed: true });
  assert.match(harness.database.serializedState(), /_private_account_deletions/u);
  assert.deepEqual(await removal.remove({
    installationId,
    subjectUid: harness.subjectUid,
  }), { removed: true });
  authUnavailable = false;
  assert.deepEqual(await deletion.retryPending(), { completed: 1, pending: 0 });
  assert.equal(authAttempts, 3);
  assert.doesNotMatch(harness.database.serializedState(), /_private_account_deletions/u);
});

test('sanitized deletion audit records have an explicit 30-day retention deadline', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  await new ClientAccountDeletionService({
    authAccounts: { async deleteUser() {} },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store: harness.store,
  }).request({ installationId, subjectUid: harness.subjectUid });

  const audit = await harness.database.listCollection('_private_audit_events');
  assert.ok(audit.length >= 2);
  for (const { value } of audit) {
    assert.ok(isRecord(value));
    assert.equal(value.expiresAtMs, (value.occurredAtMs as number) + 30 * 24 * 60 * 60 * 1_000);
    assert.equal(Object.hasOwn(value, 'subjectUid'), false);
  }
});

test('deletion never reports completion while an authoritative client record is malformed', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  let authUnavailable = true;
  const deletion = new ClientAccountDeletionService({
    authAccounts: {
      async deleteUser() {
        if (authUnavailable) throw new Error('temporary_auth_failure');
      },
    },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store: harness.store,
  });
  assert.deepEqual(await deletion.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'pending' });
  await harness.database.runTransaction(async (transaction) => {
    transaction.set(`_private_client_grants/${harness.subjectUid}`, {
      codeId: harness.codeId,
      schemaVersion: 999,
    });
  });
  authUnavailable = false;

  await assert.rejects(deletion.retryPending(), (error: unknown) => {
    if (!(error instanceof AccountDeletionRetryBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 0,
      failed: 1,
      malformed: 0,
      pending: 0,
    });
    assert.doesNotMatch(error.message, /grant|client_/u);
    return true;
  });
  assert.match(harness.database.serializedState(), /_private_account_deletions/u);
  assert.match(harness.database.serializedState(), /_private_client_grants/u);
});

test('scheduled deletion isolates one subject failure and signals a sanitized aggregate', async () => {
  const failingSubject = `client_${'a'.repeat(32)}`;
  const completingSubject = `client_${'b'.repeat(32)}`;
  const attemptedSubjects: string[] = [];
  const store: ClientAccountDeletionStore = {
    async beginAccountDeletion() {
      return { kind: 'invalid' };
    },
    async completeAccountDeletion(subjectUid) {
      return subjectUid === completingSubject
        ? { kind: 'completed' }
        : { kind: 'not_ready' };
    },
    async listPendingAccountDeletions() {
      return { malformed: 0, subjectUids: [failingSubject, completingSubject] };
    },
    async markAccountDeletionAttemptFailed() {},
    async purgeAccountDeletionArtifacts(subjectUid) {
      attemptedSubjects.push(subjectUid);
      if (subjectUid === failingSubject) throw new Error('injected_firestore_failure');
      return { kind: 'ready' };
    },
  };
  const deletion = new ClientAccountDeletionService({
    authAccounts: { async deleteUser() {} },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store,
  });

  await assert.rejects(deletion.retryPending(), (error: unknown) => {
    if (!(error instanceof AccountDeletionRetryBatchError)) return false;
    assert.equal(error.message, 'account_deletion_retry_incomplete');
    assert.deepEqual(error.summary, {
      completed: 1,
      failed: 1,
      malformed: 0,
      pending: 0,
    });
    assert.doesNotMatch(JSON.stringify(error), /client_/u);
    return true;
  });
  assert.deepEqual(attemptedSubjects, [failingSubject, completingSubject]);
});

test('scheduled deletion reports malformed tombstones after valid jobs make progress', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  let authUnavailable = true;
  const deletion = new ClientAccountDeletionService({
    authAccounts: {
      async deleteUser() {
        if (authUnavailable) throw new Error('temporary_auth_failure');
      },
    },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store: harness.store,
  });
  assert.deepEqual(await deletion.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'pending' });
  await harness.database.runTransaction(async (transaction) => {
    transaction.create('_private_account_deletions/malformed-document', {
      schemaVersion: 999,
      status: 'pending',
    });
  });
  authUnavailable = false;

  await assert.rejects(deletion.retryPending(), (error: unknown) => {
    if (!(error instanceof AccountDeletionRetryBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 1,
      failed: 0,
      malformed: 1,
      pending: 0,
    });
    assert.doesNotMatch(JSON.stringify(error), /malformed-document|client_/u);
    return true;
  });
  const residualJobs = await harness.database.listCollection('_private_account_deletions');
  assert.deepEqual(residualJobs.map(({ id }) => id), ['malformed-document']);
});

test('scheduled maintenance completes an existing deletion before reporting malformed expiry reconciliation', async () => {
  const harness = await createRedeemedHarness(nowMs + 30 * 24 * 60 * 60 * 1_000);
  const requester = new ClientAccountDeletionService({
    authAccounts: { async deleteUser() { throw new Error('temporary_auth_failure'); } },
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    store: harness.store,
  });
  assert.deepEqual(await requester.request({
    installationId,
    subjectUid: harness.subjectUid,
  }), { status: 'pending' });

  const expiring = await new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 2),
    store: harness.store,
  }).issue({ expiresAtMs: nowMs + 1_000, resourceIds: [resourceId], slot: 1 });
  let expiringSubject = '';
  await new ClientAccessRedeemer({
    codeHasher: hasher('code'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store: harness.store,
    tokenIssuer: {
      async createCustomToken(subjectUid) {
        expiringSubject = subjectUid;
        return 'second-test-custom-token';
      },
    },
  }).redeem({
    code: expiring.oneTimeCode,
    installationId: '2'.repeat(32),
    requestId: 'request-malformed-expiry-0001',
    sourceAddress: '203.0.113.43',
  });
  await harness.database.runTransaction(async (transaction) => {
    transaction.set(`_private_client_grants/${expiringSubject}`, {
      codeId: expiring.summary.codeId,
      schemaVersion: 999,
    });
  });
  const deletedSubjects: string[] = [];
  const maintenance = new ClientAccountDeletionMaintenanceService({
    deletions: new ClientAccountDeletionService({
      authAccounts: {
        async deleteUser(subjectUid) {
          deletedSubjects.push(subjectUid);
        },
      },
      installationHasher: hasher('installation'),
      nowMs: () => nowMs + 2_000,
      store: harness.store,
    }),
    nowMs: () => nowMs + 2_000,
    reconciler: harness.store,
  });

  await assert.rejects(maintenance.runScheduled(), (error: unknown) => {
    if (!(error instanceof AccountDeletionMaintenanceBatchError)) return false;
    assert.equal(error.message, 'account_deletion_maintenance_incomplete');
    assert.deepEqual(error.summary, {
      completed: 1,
      failed: 0,
      malformed: 0,
      pending: 0,
      reconciliationFailed: 1,
    });
    assert.doesNotMatch(JSON.stringify(error), /client_|invalid_client_grant|temporary/u);
    return true;
  });
  assert.deepEqual(deletedSubjects, [harness.subjectUid]);
  assert.deepEqual(await harness.database.listCollection('_private_account_deletions'), []);
});

async function createRedeemedHarness(expiresAtMs: number) {
  const database = new InMemoryDocumentDatabase(
    { [clientResourcePath(resourceId)]: resource },
    { rejectDuplicateWrites: true },
  );
  const store = new FirestoreClientAccessStore(database);
  const issued = await new AccessCodeIssuer({
    codeHasher: hasher('code'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 1),
    store,
  }).issue({ expiresAtMs, resourceIds: [resourceId], slot: 1 });
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
    requestId: 'request-account-delete-0001',
    sourceAddress: '203.0.113.42',
  });
  return {
    codeId: issued.summary.codeId,
    database,
    redeemer,
    store,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
