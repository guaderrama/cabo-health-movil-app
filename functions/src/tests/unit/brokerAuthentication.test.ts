import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  authenticateAppReviewBrokerRequest,
  authenticateBrokerRequest,
  signAppReviewBrokerResponse,
  signBrokerResponse,
} from '../../security/brokerAuthentication.js';
import { parsePepperRingSecret } from '../../security/versionedHmac.js';

const key = Buffer.alloc(32, 71);
const keyId = '2026-08';
const nowMs = Date.UTC(2026, 7, 21);
const timestamp = String(Math.floor(nowMs / 1_000));
const requestId = '83044b11-bdd6-4df8-aa63-83b3b9243767';
const path = '/v1/launch/redeem';
const body = Buffer.from('{"nonce":"opaque"}', 'utf8');

test('broker HMAC authenticates the exact method, route, timestamp, request id, and raw bytes', () => {
  const signature = sign('POST', path, timestamp, requestId, body);
  const authenticated = authenticateBrokerRequest({
    body,
    keyId,
    method: 'POST',
    nowMs,
    path,
    requestId,
    signature,
    timestamp,
  }, parsePepperRingSecret(JSON.stringify({
    currentVersion: keyId,
    keys: { [keyId]: key.toString('base64') },
  })));

  assert.match(authenticated.requestHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.throws(() => authenticateBrokerRequest({
    body: Buffer.from('{"nonce":"tampered"}', 'utf8'),
    keyId,
    method: 'POST',
    nowMs,
    path,
    requestId,
    signature,
    timestamp,
  }, parsePepperRingSecret(JSON.stringify({
    currentVersion: keyId,
    keys: { [keyId]: key.toString('base64') },
  }))), /broker_authentication_failed/u);
});

test('broker authentication fails closed for stale, replay-shaping, and unsupported inputs', () => {
  const ring = parsePepperRingSecret(JSON.stringify({
    currentVersion: keyId,
    keys: { [keyId]: key.toString('base64') },
  }));
  const signature = sign('POST', path, timestamp, requestId, body);
  const valid = {
    body,
    keyId,
    method: 'POST',
    nowMs,
    path,
    requestId,
    signature,
    timestamp,
  } as const;

  for (const changed of [
    { ...valid, method: 'GET' },
    { ...valid, path: '/v1/launch/redeem/' },
    { ...valid, path: '/v1/not-supported' },
    { ...valid, requestId: 'not-a-request-id' },
    { ...valid, timestamp: String(Number(timestamp) - 61) },
    { ...valid, keyId: 'unknown-key' },
    { ...valid, signature: `${signature.slice(0, -1)}x` },
    { ...valid, body: Buffer.alloc(4_097) },
  ]) {
    assert.throws(
      () => authenticateBrokerRequest(changed, ring),
      /broker_authentication_failed/u,
    );
  }
});

test('broker replay hash stays opaque and stable while an old signing key remains accepted', () => {
  const nextKey = Buffer.alloc(32, 72);
  const oldRing = parsePepperRingSecret(JSON.stringify({
    currentVersion: keyId,
    keys: { [keyId]: key.toString('base64') },
  }));
  const rotatedRing = parsePepperRingSecret(JSON.stringify({
    currentVersion: '2026-09',
    keys: {
      [keyId]: key.toString('base64'),
      '2026-09': nextKey.toString('base64'),
    },
  }));
  const signature = sign('POST', path, timestamp, requestId, body);
  const first = authenticateBrokerRequest({
    body, keyId, method: 'POST', nowMs, path, requestId, signature, timestamp,
  }, oldRing);
  const second = authenticateBrokerRequest({
    body, keyId, method: 'POST', nowMs, path, requestId, signature, timestamp,
  }, rotatedRing);

  assert.equal(first.requestHash, second.requestHash);
  assert.equal(first.requestHash.includes(requestId), false);
});

test('production and App Review broker signatures cannot cross realms even with the same key bytes', () => {
  const ring = parsePepperRingSecret(JSON.stringify({
    currentVersion: keyId,
    keys: { [keyId]: key.toString('base64') },
  }));
  const input = (signature: string) => ({
    body, keyId, method: 'POST', nowMs, path, requestId, signature, timestamp,
  });
  const productionSignature = sign('POST', path, timestamp, requestId, body);
  const reviewSignature = sign(
    'POST',
    path,
    timestamp,
    requestId,
    body,
    'cabohealth-app-review-broker-v1',
  );

  assert.doesNotThrow(() => authenticateBrokerRequest(input(productionSignature), ring));
  assert.doesNotThrow(() => authenticateAppReviewBrokerRequest(input(reviewSignature), ring));
  assert.throws(
    () => authenticateAppReviewBrokerRequest(input(productionSignature), ring),
    /broker_authentication_failed/u,
  );
  assert.throws(
    () => authenticateBrokerRequest(input(reviewSignature), ring),
    /broker_authentication_failed/u,
  );
});

test('broker response signatures authenticate exact response bytes and remain realm isolated', () => {
  const ring = parsePepperRingSecret(JSON.stringify({
    currentVersion: keyId,
    keys: { [keyId]: key.toString('base64') },
  }));
  const responseBody = Buffer.from('{"expiresAtMs":123,"sessionId":"opaque"}', 'utf8');
  const production = signBrokerResponse({
    body: responseBody,
    keyId,
    path,
    requestId,
    status: 200,
  }, ring);
  const review = signAppReviewBrokerResponse({
    body: responseBody,
    keyId,
    path,
    requestId,
    status: 200,
  }, ring);

  assert.match(production, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(review, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(production, review);
  assert.notEqual(production, signBrokerResponse({
    body: Buffer.from('{"expiresAtMs":124,"sessionId":"opaque"}', 'utf8'),
    keyId,
    path,
    requestId,
    status: 200,
  }, ring));
});

function sign(
  method: string,
  route: string,
  at: string,
  id: string,
  rawBody: Buffer,
  domain = 'cabohealth-broker-v1',
): string {
  const bodyHash = createHash('sha256').update(rawBody).digest('base64url');
  const canonical = `${domain}\n${method}\n${route}\n${at}\n${id}\n${bodyHash}`;
  return createHmac('sha256', key).update(canonical, 'utf8').digest('base64url');
}
