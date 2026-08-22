import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APP_REVIEW_SAMPLE_RESOURCE,
  AppReviewAccessRedeemer,
  AppReviewCredentialConflictError,
  AppReviewCredentialService,
  AppReviewInputError,
  AppReviewLaunchService,
  AppReviewSessionManager,
} from '../../domain/appReviewAccess.js';
import { WebSessionBroker } from '../../domain/webSessionBroker.js';
import { FirestoreAppReviewSandboxStore } from '../../repositories/firestoreAppReviewSandboxStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const nowMs = 1_800_000_000_000;

test('rotates a one-time HMAC-only App Review credential with optimistic generation', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.from('00112233445566778899aabbccddeeff', 'hex'),
    store,
  });

  assert.deepEqual(await credentials.status(), {
    configured: false,
    generation: null,
    purpose: 'app_review',
    rotatedAtMs: null,
  });
  const rotated = await credentials.rotate({ expectedGeneration: null });
  assert.equal(rotated.oneTimeCredential, 'AR-00112233-44556677-8899AABB-CCDDEEFF');
  assert.deepEqual(rotated.status, {
    configured: true,
    generation: 1,
    purpose: 'app_review',
    rotatedAtMs: nowMs,
  });
  await assert.rejects(
    credentials.rotate({ expectedGeneration: null }),
    AppReviewCredentialConflictError,
  );

  const serialized = database.serializedState();
  assert.equal(serialized.includes(rotated.oneTimeCredential), false);
  assert.doesNotMatch(serialized, /_private_access_codes|_private_client_slots|production_client/u);
});

test('one App Review credential grants the fixed sample independently to multiple installations', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 9),
    store,
  });
  const { oneTimeCredential } = await credentials.rotate({ expectedGeneration: null });
  const issuedSubjects: string[] = [];
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: {
      async createCustomToken(subjectUid, claims) {
        issuedSubjects.push(subjectUid);
        assert.deepEqual(claims, { authority: 'app_review' });
        return `token-${issuedSubjects.length}`;
      },
    },
  });

  const first = await redeemer.redeem(redeemInput(oneTimeCredential, 'a', 'request-aaaaaaaaa'));
  const second = await redeemer.redeem(redeemInput(oneTimeCredential, 'b', 'request-bbbbbbbbb'));

  assert.notEqual(issuedSubjects[0], issuedSubjects[1]);
  assert.match(issuedSubjects[0]!, /^review_[A-Za-z0-9_-]{32}$/u);
  assert.deepEqual(first.grant.resources, [APP_REVIEW_SAMPLE_RESOURCE]);
  assert.deepEqual(second.grant.resources, [APP_REVIEW_SAMPLE_RESOURCE]);
  assert.equal(first.grant.expiresAtMs, null);
  assert.equal(first.grant.purpose, 'app_review');
  assert.equal(first.grant.scope, 'review_sandbox');
  assert.equal(database.serializedState().includes(oneTimeCredential), false);
  assert.doesNotMatch(database.serializedState(), /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/u);
});

test('rotation invalidates the old credential and every prior review grant immediately', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let randomByte = 3;
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => nowMs,
    randomSource: (size) => Buffer.alloc(size, randomByte++),
    store,
  });
  const firstCredential = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: {
      async createCustomToken(subjectUid) { return subjectUid; },
    },
  });
  const installationId = 'c'.repeat(32);
  const redeemed = await redeemer.redeem(redeemInput(
    firstCredential.oneTimeCredential,
    'c',
    'request-ccccccccc',
  ));
  const subjectUid = redeemed.customToken;
  const sessions = new AppReviewSessionManager({
    installationHasher: hasher('installation'),
    store,
  });
  assert.equal((await sessions.refresh({ installationId, subjectUid })).credentialGeneration, 1);

  await credentials.rotate({ expectedGeneration: 1 });

  await assert.rejects(
    sessions.refresh({ installationId, subjectUid }),
    (error: unknown) => error instanceof AppReviewInputError && error.code === 'invalid_access',
  );
  await assert.rejects(
    redeemer.redeem(redeemInput(firstCredential.oneTimeCredential, 'd', 'request-ddddddddd')),
    (error: unknown) => error instanceof AppReviewInputError && error.code === 'invalid_access',
  );
});

test('review launch and web session are one-use, short-lived, HMAC-only, and live-generation bound', async () => {
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let rotationByte = 5;
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => nowMs,
    randomSource: (size) => Buffer.alloc(size, rotationByte++),
    store,
  });
  const { oneTimeCredential } = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => nowMs + 1,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  });
  const installationId = 'e'.repeat(32);
  const { customToken: subjectUid } = await redeemer.redeem(redeemInput(
    oneTimeCredential,
    'e',
    'request-eeeeeeeee',
  ));
  const launch = new AppReviewLaunchService({
    installationHasher: hasher('installation'),
    nonceHasher: hasher('nonce'),
    nowMs: () => nowMs + 2,
    randomSource: () => Buffer.alloc(24, 7),
    store,
  });
  const launchResponse = await launch.create({ installationId, subjectUid });
  assert.deepEqual(launchResponse, {
    expiresAtMs: nowMs + 60_002,
    launchUrl: 'https://cabohealth.org/apps/app-review/launch/',
    method: 'POST',
    nonce: Buffer.alloc(24, 7).toString('base64url'),
  });

  const broker = new WebSessionBroker({
    csrfHasher: hasher('csrf'),
    nonceHasher: hasher('nonce'),
    nowMs: () => nowMs + 3,
    randomSource: () => Buffer.alloc(32, 8),
    sessionHasher: hasher('session'),
    store,
  });
  const web = await broker.redeemLaunch({
    brokerRequestHash: 'r'.repeat(43),
    nonce: launchResponse.nonce,
  });
  await assert.rejects(broker.redeemLaunch({
    brokerRequestHash: 's'.repeat(43),
    nonce: launchResponse.nonce,
  }));
  const introspected = await broker.introspect({
    brokerRequestHash: 't'.repeat(43),
    sessionId: web.sessionId,
  });
  assert.deepEqual(introspected.entitlements, [APP_REVIEW_SAMPLE_RESOURCE.id]);
  assert.ok(introspected.expiresAtMs <= nowMs + 60 * 60 * 1_000 + 3);

  const serialized = database.serializedState();
  assert.equal(serialized.includes(launchResponse.nonce), false);
  assert.equal(serialized.includes(web.sessionId), false);
  assert.doesNotMatch(serialized, /_private_launch_nonces|_private_web_sessions|_private_broker_requests/u);

  await credentials.rotate({ expectedGeneration: 1 });
  await assert.rejects(broker.introspect({
    brokerRequestHash: 'u'.repeat(43),
    sessionId: web.sessionId,
  }));
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
