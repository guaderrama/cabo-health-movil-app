import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AppReviewAccessRedeemer,
  AppReviewCredentialService,
  AppReviewInputError,
  AppReviewLaunchService,
  AppReviewSessionManager,
} from '../../domain/appReviewAccess.js';
import { WebSessionBroker } from '../../domain/webSessionBroker.js';
import {
  APP_REVIEW_DATA_RETENTION_MS,
  type AppReviewDataRetentionStore,
  AppReviewDataRetentionService,
  AppReviewRetentionBatchError,
} from '../../domain/appReviewDataRetention.js';
import { FirestoreAppReviewSandboxStore } from '../../repositories/firestoreAppReviewSandboxStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = 1_800_000_000_000;

test('credential rotation physically removes stale review identities while retaining the current generation', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let clock = nowMs;
  let randomByte = 1;
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => clock,
    randomSource: (size) => Buffer.alloc(size, randomByte++),
    store,
  });
  const firstCredential = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => clock,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  });
  clock += 1;
  const first = await redeemer.redeem(redeemInput(
    firstCredential.oneTimeCredential,
    'a',
    'request-retain-aaaa',
  ));
  clock += 1;
  const secondCredential = await credentials.rotate({ expectedGeneration: 1 });
  clock += 1;
  const second = await redeemer.redeem(redeemInput(
    secondCredential.oneTimeCredential,
    'b',
    'request-retain-bbbb',
  ));
  const deletedSubjects: string[] = [];
  const retention = new AppReviewDataRetentionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        deletedSubjects.push(subjectUid);
      },
    },
    nowMs: () => clock,
    store,
  });

  assert.deepEqual(await retention.runScheduled(), {
    completed: 1,
    failed: 0,
    malformed: 0,
    pending: 0,
    queued: 1,
  });
  assert.deepEqual(deletedSubjects, [first.customToken]);
  assert.deepEqual(
    (await database.listCollection('review_sandbox_grants')).map(({ id }) => id),
    [second.customToken],
  );
  assert.equal(database.serializedState().includes(first.customToken), false);
});

test('a current review identity is retained until 30 days of inactivity and deleted at the boundary', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let clock = nowMs;
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => clock,
    randomSource: (size) => Buffer.alloc(size, 7),
    store,
  });
  const { oneTimeCredential } = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => clock,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  });
  const installationId = 'c'.repeat(32);
  const redeemed = await redeemer.redeem(redeemInput(
    oneTimeCredential,
    'c',
    'request-retain-cccc',
  ));
  const retention = new AppReviewDataRetentionService({
    authAccounts: { async deleteUser() {} },
    nowMs: () => clock,
    store,
  });

  clock = nowMs + APP_REVIEW_DATA_RETENTION_MS - 1;
  assert.deepEqual(await retention.runScheduled(), {
    completed: 0,
    failed: 0,
    malformed: 0,
    pending: 0,
    queued: 0,
  });
  assert.equal(database.serializedState().includes(redeemed.customToken), true);

  await new AppReviewSessionManager({
    installationHasher: hasher('installation'),
    nowMs: () => clock,
    store,
  }).refresh({ installationId, subjectUid: redeemed.customToken });

  clock += 1;
  assert.deepEqual(await retention.runScheduled(), {
    completed: 0,
    failed: 0,
    malformed: 0,
    pending: 0,
    queued: 0,
  });

  clock += APP_REVIEW_DATA_RETENTION_MS - 1;
  assert.deepEqual(await retention.runScheduled(), {
    completed: 1,
    failed: 0,
    malformed: 0,
    pending: 0,
    queued: 1,
  });
  assert.equal(database.serializedState().includes(redeemed.customToken), false);
});

test('an Auth outage leaves review access denied and a durable job that succeeds on retry', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let clock = nowMs;
  let randomByte = 10;
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => clock,
    randomSource: (size) => Buffer.alloc(size, randomByte++),
    store,
  });
  const firstCredential = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => clock,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  });
  clock += 1;
  const installationId = 'd'.repeat(32);
  const redeemed = await redeemer.redeem(redeemInput(
    firstCredential.oneTimeCredential,
    'd',
    'request-retain-dddd',
  ));
  clock += 1;
  const launch = await new AppReviewLaunchService({
    installationHasher: hasher('installation'),
    nonceHasher: hasher('nonce'),
    nowMs: () => clock,
    randomSource: () => Buffer.alloc(24, 12),
    store,
  }).create({ installationId, subjectUid: redeemed.customToken });
  await new WebSessionBroker({
    csrfHasher: hasher('csrf'),
    nonceHasher: hasher('nonce'),
    nowMs: () => clock,
    randomSource: () => Buffer.alloc(32, 13),
    sessionHasher: hasher('session'),
    store,
  }).redeemLaunch({
    brokerRequestHash: 'z'.repeat(43),
    nonce: launch.nonce,
  });
  assert.equal((await database.listCollection('review_sandbox_launch_nonces')).length, 1);
  assert.equal((await database.listCollection('review_sandbox_web_sessions')).length, 1);
  clock += 1;
  await credentials.rotate({ expectedGeneration: 1 });
  let authUnavailable = true;
  const retention = new AppReviewDataRetentionService({
    authAccounts: {
      async deleteUser() {
        if (authUnavailable) throw new Error('injected_auth_outage');
      },
    },
    nowMs: () => clock,
    store,
  });

  await assert.rejects(retention.runScheduled(), (error: unknown) => {
    if (!(error instanceof AppReviewRetentionBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 0,
      failed: 1,
      malformed: 0,
      pending: 0,
      queued: 1,
    });
    return true;
  });
  assert.equal((await database.listCollection('review_sandbox_account_deletions')).length, 1);
  await assert.rejects(
    new AppReviewSessionManager({
      installationHasher: hasher('installation'),
      nowMs: () => clock,
      store,
    }).refresh({ installationId, subjectUid: redeemed.customToken }),
    (error: unknown) => error instanceof AppReviewInputError && error.code === 'invalid_access',
  );

  authUnavailable = false;
  clock += 1;
  assert.deepEqual(await retention.runScheduled(), {
    completed: 1,
    failed: 0,
    malformed: 0,
    pending: 0,
    queued: 0,
  });
  assert.deepEqual(await database.listCollection('review_sandbox_account_deletions'), []);
  assert.deepEqual(await database.listCollection('review_sandbox_grants'), []);
  assert.deepEqual(await database.listCollection('review_sandbox_launch_nonces'), []);
  assert.deepEqual(await database.listCollection('review_sandbox_redemption_requests'), []);
  assert.deepEqual(await database.listCollection('review_sandbox_web_sessions'), []);
});

test('review cleanup completes an existing job before reporting malformed candidate discovery', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let clock = nowMs;
  let randomByte = 20;
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => clock,
    randomSource: (size) => Buffer.alloc(size, randomByte++),
    store,
  });
  const firstCredential = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => clock,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  });
  clock += 1;
  const redeemed = await redeemer.redeem(redeemInput(
    firstCredential.oneTimeCredential,
    'e',
    'request-retain-eeee',
  ));
  clock += 1;
  await credentials.rotate({ expectedGeneration: 1 });
  const unavailableRetention = new AppReviewDataRetentionService({
    authAccounts: { async deleteUser() { throw new Error('temporary_auth_failure'); } },
    nowMs: () => clock,
    store,
  });
  await assert.rejects(unavailableRetention.runScheduled(), (error: unknown) => {
    if (!(error instanceof AppReviewRetentionBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 0,
      failed: 1,
      malformed: 0,
      pending: 0,
      queued: 1,
    });
    return true;
  });
  await database.runTransaction(async (transaction) => {
    transaction.set('review_sandbox_credentials/current', {
      generation: 2,
      schemaVersion: 999,
    });
  });
  const deletedSubjects: string[] = [];
  const retention = new AppReviewDataRetentionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        deletedSubjects.push(subjectUid);
      },
    },
    nowMs: () => clock,
    store,
  });

  await assert.rejects(retention.runScheduled(), (error: unknown) => {
    if (!(error instanceof AppReviewRetentionBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 1,
      failed: 1,
      malformed: 0,
      pending: 0,
      queued: 0,
    });
    assert.doesNotMatch(JSON.stringify(error), /review_|invalid_app_review|temporary/u);
    return true;
  });
  assert.deepEqual(deletedSubjects, [redeemed.customToken]);
  assert.deepEqual(await database.listCollection('review_sandbox_account_deletions'), []);
  assert.deepEqual(await database.listCollection('review_sandbox_grants'), []);
});

test('review cleanup isolates one subject failure and reports only aggregate counts', async () => {
  const failingSubject = `review_${'a'.repeat(32)}`;
  const completingSubject = `review_${'b'.repeat(32)}`;
  const attemptedSubjects: string[] = [];
  const store: AppReviewDataRetentionStore = {
    async beginAppReviewDataDeletion() { return 'not_due'; },
    async completeAppReviewDataDeletion() { return 'completed'; },
    async listAppReviewDataDeletionJobs() {
      return { malformed: 0, subjectUids: [failingSubject, completingSubject] };
    },
    async listAppReviewRetentionCandidates() {
      return { malformed: 0, subjectUids: [] };
    },
    async markAppReviewDataDeletionFailed() {},
    async purgeAppReviewDataArtifacts(subjectUid) {
      attemptedSubjects.push(subjectUid);
      if (subjectUid === failingSubject) throw new Error('injected_firestore_failure');
      return 'ready';
    },
  };
  const retention = new AppReviewDataRetentionService({
    authAccounts: { async deleteUser() {} },
    nowMs: () => nowMs,
    store,
  });

  await assert.rejects(retention.runScheduled(), (error: unknown) => {
    if (!(error instanceof AppReviewRetentionBatchError)) return false;
    assert.equal(error.message, 'app_review_retention_incomplete');
    assert.deepEqual(error.summary, {
      completed: 1,
      failed: 1,
      malformed: 0,
      pending: 0,
      queued: 0,
    });
    assert.doesNotMatch(JSON.stringify(error), /review_|injected|firestore/u);
    return true;
  });
  assert.deepEqual(attemptedSubjects, [failingSubject, completingSubject]);
});

test('persistently failing review deletions cannot starve a later eligible identity', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let clock = nowMs;
  let randomByte = 40;
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => clock,
    randomSource: (size) => Buffer.alloc(size, randomByte++),
    store,
  });
  const { oneTimeCredential } = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => clock,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  });
  const subjects: string[] = [];
  for (let index = 0; index < 21; index += 1) {
    clock += 1;
    const redeemed = await redeemer.redeem({
      credential: oneTimeCredential,
      installationId: index.toString(16).padStart(32, '0'),
      requestId: `request-retention-${index.toString().padStart(4, '0')}`,
      sourceAddress: '203.0.113.10',
    });
    subjects.push(redeemed.customToken);
  }
  clock += 1;
  await credentials.rotate({ expectedGeneration: 1 });
  const permanentlyFailing = new Set(subjects.slice(0, 20));
  const deletedSubjects: string[] = [];
  const retention = new AppReviewDataRetentionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        if (permanentlyFailing.has(subjectUid)) throw new Error('injected_auth_outage');
        deletedSubjects.push(subjectUid);
      },
    },
    nowMs: () => clock,
    store,
  });

  await assert.rejects(retention.runScheduled(), (error: unknown) => {
    if (!(error instanceof AppReviewRetentionBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 0,
      failed: 20,
      malformed: 0,
      pending: 0,
      queued: 20,
    });
    return true;
  });
  clock += 1;
  await assert.rejects(retention.runScheduled(), (error: unknown) => {
    if (!(error instanceof AppReviewRetentionBatchError)) return false;
    assert.deepEqual(error.summary, {
      completed: 1,
      failed: 19,
      malformed: 0,
      pending: 0,
      queued: 1,
    });
    return true;
  });
  assert.deepEqual(deletedSubjects, [subjects[20]]);
  assert.equal((await database.listCollection('review_sandbox_account_deletions')).length, 20);
});

function redeemInput(
  credential: string,
  installationFill: string,
  requestId: string,
): Readonly<{
  credential: string;
  installationId: string;
  requestId: string;
  sourceAddress: string;
}> {
  return Object.freeze({
    credential,
    installationId: installationFill.repeat(32),
    requestId,
    sourceAddress: '203.0.113.10',
  });
}

function hasher(namespace: string): VersionedHmac {
  return VersionedHmac.fromTestKeys({
    currentVersion: 'v1',
    keys: { v1: `${namespace}-app-review-test-pepper-at-least-32-bytes` },
  });
}
