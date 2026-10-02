import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AppReviewAccessRedeemer,
  AppReviewCredentialService,
  AppReviewInputError,
} from '../../domain/appReviewAccess.js';
import { AppReviewAccountDeletionService } from '../../domain/appReviewAccountDeletion.js';
import { AccountDeletionReceiptStatusService } from '../../domain/accountDeletionReceipt.js';
import {
  AppReviewDataRetentionService,
  AppReviewRetentionBatchError,
} from '../../domain/appReviewDataRetention.js';
import { FirestoreAppReviewSandboxStore } from '../../repositories/firestoreAppReviewSandboxStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = 1_800_000_000_000;
const installationId = '1'.repeat(32);
const deletionReceipt = 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210abcdefg';
const productionSentinelPath = `_private_client_grants/client_${'p'.repeat(32)}`;

test('a current active review identity can request immediate durable account deletion', async () => {
  const harness = await createReviewHarness();
  const deletedSubjects: string[] = [];
  const retention = new AppReviewDataRetentionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        const durableState = harness.database.serializedState();
        assert.match(durableState, /review_sandbox_account_deletions/u);
        assert.match(durableState, /"status":"removed"/u);
        deletedSubjects.push(subjectUid);
      },
    },
    nowMs: () => nowMs + 1,
    store: harness.store,
  });
  const deletion = new AppReviewAccountDeletionService({
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    receiptHasher: hasher('deletion-receipt'),
    retention,
    store: harness.store,
  });

  assert.deepEqual(await deletion.request({
    deletionReceipt,
    installationId,
    subjectUid: harness.subjectUid,
  }), completedReceiptStatus(nowMs + 1, nowMs + 1));
  assert.deepEqual(deletedSubjects, [harness.subjectUid]);
  assert.deepEqual(await harness.database.listCollection('review_sandbox_grants'), []);
  assert.deepEqual(
    await harness.database.listCollection('review_sandbox_account_deletions'),
    [],
  );
  assert.deepEqual(await new AccountDeletionReceiptStatusService({
    nowMs: () => nowMs + 1,
    receiptHasher: hasher('deletion-receipt'),
    store: harness.store,
  }).getStatus({ deletionReceipt }), completedReceiptStatus(nowMs + 1, nowMs + 1));
  const receiptState = JSON.stringify(
    await harness.database.listCollection('review_sandbox_account_deletion_receipts'),
  );
  assert.equal(receiptState.includes(deletionReceipt), false);
  assert.equal(receiptState.includes(harness.subjectUid), false);
  assert.deepEqual(await harness.database.runTransaction(
    (transaction) => transaction.get(productionSentinelPath),
  ), { realm: 'production-sentinel' });
});

test('review deletion rejects a wrong installation and a production-realm subject generically', async () => {
  const harness = await createReviewHarness();
  const deletion = new AppReviewAccountDeletionService({
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    receiptHasher: hasher('deletion-receipt'),
    retention: new AppReviewDataRetentionService({
      authAccounts: { async deleteUser() { throw new Error('must_not_delete'); } },
      nowMs: () => nowMs + 1,
      store: harness.store,
    }),
    store: harness.store,
  });

  for (const input of [{
    deletionReceipt,
    installationId: '2'.repeat(32),
    subjectUid: harness.subjectUid,
  }, {
    deletionReceipt,
    installationId,
    subjectUid: `client_${'a'.repeat(32)}`,
  }]) {
    await assert.rejects(deletion.request(input), (error: unknown) => (
      error instanceof AppReviewInputError
      && error.code === 'invalid_access'
      && error.message === 'invalid_access'
    ));
  }
  assert.equal((await harness.database.listCollection('review_sandbox_grants')).length, 1);
  assert.deepEqual(
    await harness.database.listCollection('review_sandbox_account_deletions'),
    [],
  );
});

test('an Auth failure returns pending and the scheduled worker completes the durable review deletion', async () => {
  const harness = await createReviewHarness();
  let authUnavailable = true;
  let authAttempts = 0;
  const authAccounts = {
    async deleteUser(subjectUid: string) {
      assert.equal(subjectUid, harness.subjectUid);
      authAttempts += 1;
      if (authUnavailable) throw new Error('temporary_auth_failure');
    },
  };
  const requestRetention = new AppReviewDataRetentionService({
    authAccounts,
    nowMs: () => nowMs + 1,
    store: harness.store,
  });
  const deletion = new AppReviewAccountDeletionService({
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    receiptHasher: hasher('deletion-receipt'),
    retention: requestRetention,
    store: harness.store,
  });

  assert.deepEqual(await deletion.request({
    deletionReceipt,
    installationId,
    subjectUid: harness.subjectUid,
  }), pendingReceiptStatus(nowMs + 1));
  assert.equal((await harness.database.listCollection('review_sandbox_grants')).length, 1);
  assert.equal(
    (await harness.database.listCollection('review_sandbox_account_deletions')).length,
    1,
  );

  authUnavailable = false;
  assert.deepEqual(await new AppReviewDataRetentionService({
    authAccounts,
    nowMs: () => nowMs + 2,
    store: harness.store,
  }).runScheduled(), {
    completed: 1,
    failed: 0,
    malformed: 0,
    pending: 0,
    queued: 0,
  });
  assert.equal(authAttempts, 2);
  assert.deepEqual(await harness.database.listCollection('review_sandbox_grants'), []);
  assert.deepEqual(
    await harness.database.listCollection('review_sandbox_account_deletions'),
    [],
  );
});

test('retrying the same accepted request reuses one durable deletion job', async () => {
  const harness = await createReviewHarness();
  let authAttempts = 0;
  const deletion = new AppReviewAccountDeletionService({
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + authAttempts + 1,
    receiptHasher: hasher('deletion-receipt'),
    retention: new AppReviewDataRetentionService({
      authAccounts: {
        async deleteUser(subjectUid) {
          assert.equal(subjectUid, harness.subjectUid);
          authAttempts += 1;
          throw new Error('temporary_auth_failure');
        },
      },
      nowMs: () => nowMs + authAttempts + 1,
      store: harness.store,
    }),
    store: harness.store,
  });

  const input = Object.freeze({ deletionReceipt, installationId, subjectUid: harness.subjectUid });
  assert.deepEqual(await deletion.request(input), pendingReceiptStatus(nowMs + 1));
  assert.deepEqual(await deletion.request(input), pendingReceiptStatus(nowMs + 1));

  const jobs = await harness.database.listCollection('review_sandbox_account_deletions');
  const grants = await harness.database.listCollection('review_sandbox_grants');
  assert.equal(jobs.length, 1);
  assert.equal((jobs[0]?.value as { attempts?: unknown }).attempts, 2);
  assert.equal((grants[0]?.value as { status?: unknown }).status, 'removed');
  assert.equal(authAttempts, 2);
});

test('review maintenance signals Auth failures while the original receipt remains idempotent through recovery', async () => {
  const harness = await createReviewHarness();
  let clock = nowMs + 1;
  let authUnavailable = true;
  const retention = new AppReviewDataRetentionService({
    authAccounts: {
      async deleteUser() {
        if (authUnavailable) throw new Error(`private_auth_error:${harness.subjectUid}`);
      },
    },
    nowMs: () => clock,
    store: harness.store,
  });
  const deletion = new AppReviewAccountDeletionService({
    installationHasher: hasher('installation'),
    nowMs: () => clock,
    receiptHasher: hasher('deletion-receipt'),
    retention,
    store: harness.store,
  });
  const input = { deletionReceipt, installationId, subjectUid: harness.subjectUid };
  assert.deepEqual(await deletion.request(input), pendingReceiptStatus(nowMs + 1));
  clock += 1;
  await assert.rejects(retention.runScheduled(), (error: unknown) => {
    if (!(error instanceof AppReviewRetentionBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 0,
      failed: 1,
      malformed: 0,
      pending: 0,
      queued: 0,
    });
    assert.doesNotMatch(JSON.stringify(error), /review_|private_auth_error/u);
    return true;
  });
  assert.deepEqual(await deletion.request(input), pendingReceiptStatus(nowMs + 1));
  assert.equal(
    (await harness.database.listCollection('review_sandbox_account_deletion_receipts')).length,
    1,
  );
  assert.equal(
    (await harness.database.listCollection('review_sandbox_account_deletions')).length,
    1,
  );

  authUnavailable = false;
  clock += 1;
  assert.deepEqual(await retention.runScheduled(), {
    completed: 1, failed: 0, malformed: 0, pending: 0, queued: 0,
  });
  assert.deepEqual(await retention.runScheduled(), {
    completed: 0, failed: 0, malformed: 0, pending: 0, queued: 0,
  });
  assert.deepEqual(await new AccountDeletionReceiptStatusService({
    nowMs: () => clock,
    receiptHasher: hasher('deletion-receipt'),
    store: harness.store,
  }).getStatus({ deletionReceipt }), completedReceiptStatus(nowMs + 1, clock));
  assert.deepEqual(await harness.database.listCollection('review_sandbox_grants'), []);
  assert.deepEqual(await harness.database.runTransaction(
    (transaction) => transaction.get(productionSentinelPath),
  ), { realm: 'production-sentinel' });
});

test('review maintenance reports bounded artifact cleanup as pending without an Auth failure', async () => {
  const harness = await createReviewHarness();
  await harness.store.beginAppReviewDataDeletion({
    cutoffMs: nowMs,
    nowMs: nowMs + 1,
    subjectUid: harness.subjectUid,
  });
  await harness.database.runTransaction(async (transaction) => {
    for (let index = 0; index < 401; index += 1) {
      transaction.create(`review_sandbox_redemption_requests/cleanup-${index}`, {
        expiresAtMs: nowMs + 60_000,
        generation: 1,
        schemaVersion: 1,
        subjectUid: harness.subjectUid,
      });
    }
  });
  const deletedSubjects: string[] = [];
  const retention = new AppReviewDataRetentionService({
    authAccounts: { async deleteUser(subjectUid) { deletedSubjects.push(subjectUid); } },
    nowMs: () => nowMs + 2,
    store: harness.store,
  });

  assert.deepEqual(await retention.runScheduled(), {
    completed: 0, failed: 0, malformed: 0, pending: 1, queued: 0,
  });
  assert.deepEqual(deletedSubjects, [], 'Auth deletion waits for the remaining artifacts');
  assert.deepEqual(await retention.runScheduled(), {
    completed: 1, failed: 0, malformed: 0, pending: 0, queued: 0,
  });
  assert.deepEqual(deletedSubjects, [harness.subjectUid]);
  assert.deepEqual(await harness.database.listCollection('review_sandbox_account_deletions'), []);
});

async function createReviewHarness(): Promise<Readonly<{
  database: InMemoryDocumentDatabase;
  store: FirestoreAppReviewSandboxStore;
  subjectUid: string;
}>> {
  const database = new InMemoryDocumentDatabase({
    [productionSentinelPath]: { realm: 'production-sentinel' },
  });
  const store = new FirestoreAppReviewSandboxStore(database);
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => nowMs,
    randomSource: (size) => Buffer.alloc(size, 7),
    store,
  });
  const { oneTimeCredential } = await credentials.rotate({ expectedGeneration: null });
  const redeemed = await new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs,
    rateLimitHasher: hasher('rate-limit'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  }).redeem({
    credential: oneTimeCredential,
    installationId,
    requestId: 'request-review-delete-0001',
    sourceAddress: '203.0.113.10',
  });
  return Object.freeze({ database, store, subjectUid: redeemed.customToken });
}

function hasher(namespace: string): VersionedHmac {
  return VersionedHmac.fromTestKeys({
    currentVersion: 'v1',
    keys: { v1: `${namespace}-app-review-test-pepper-at-least-32-bytes` },
  });
}

function completedReceiptStatus(requestedAtMs: number, completedAtMs: number) {
  return {
    completedAtMs,
    expectedCompletionByMs: requestedAtMs + 30 * 24 * 60 * 60 * 1_000,
    requestedAtMs,
    schemaVersion: 1,
    status: 'completed',
  } as const;
}

function pendingReceiptStatus(requestedAtMs: number) {
  return {
    completedAtMs: null,
    expectedCompletionByMs: requestedAtMs + 30 * 24 * 60 * 60 * 1_000,
    requestedAtMs,
    schemaVersion: 1,
    status: 'pending',
  } as const;
}
