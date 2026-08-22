import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

import { type PepperRing } from './versionedHmac.js';

const ALLOWED_PATHS = new Set([
  '/v1/launch/redeem',
  '/v1/sessions/introspect',
  '/v1/sessions/revoke',
]);
const MAXIMUM_BODY_BYTES = 4_096;
const MAXIMUM_CLOCK_SKEW_SECONDS = 60;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TIMESTAMP_PATTERN = /^[0-9]{10}$/u;

export interface BrokerAuthenticationInput {
  readonly body: Buffer;
  readonly keyId: string;
  readonly method: string;
  readonly nowMs: number;
  readonly path: string;
  readonly requestId: string;
  readonly signature: string;
  readonly timestamp: string;
}

export interface BrokerResponseSigningInput {
  readonly body: Buffer;
  readonly keyId: string;
  readonly path: string;
  readonly requestId: string;
  readonly status: number;
}

/**
 * Authenticates a server-to-server request without retaining caller-provided
 * identifiers. Every failure is intentionally indistinguishable to callers.
 */
export function authenticateBrokerRequest(
  input: Readonly<BrokerAuthenticationInput>,
  keyRing: PepperRing,
): Readonly<{ requestHash: string }> {
  return authenticateRealm(
    input,
    keyRing,
    'cabohealth-broker-v1',
    'cabohealth/broker-request-id/v1\0',
  );
}

export function authenticateAppReviewBrokerRequest(
  input: Readonly<BrokerAuthenticationInput>,
  keyRing: PepperRing,
): Readonly<{ requestHash: string }> {
  return authenticateRealm(
    input,
    keyRing,
    'cabohealth-app-review-broker-v1',
    'cabohealth/app-review-broker-request-id/v1\0',
  );
}

export function signBrokerResponse(
  input: Readonly<BrokerResponseSigningInput>,
  keyRing: PepperRing,
): string {
  return signResponseRealm(input, keyRing, 'cabohealth-broker-response-v1');
}

export function signAppReviewBrokerResponse(
  input: Readonly<BrokerResponseSigningInput>,
  keyRing: PepperRing,
): string {
  return signResponseRealm(input, keyRing, 'cabohealth-app-review-broker-response-v1');
}

function signResponseRealm(
  input: Readonly<BrokerResponseSigningInput>,
  keyRing: PepperRing,
  signatureDomain: string,
): string {
  try {
    if (
      !Buffer.isBuffer(input.body)
      || input.body.length > 16_384
      || input.status !== 200
      || !ALLOWED_PATHS.has(input.path)
      || !REQUEST_ID_PATTERN.test(input.requestId)
      || !keyRing.acceptedVersions().includes(input.keyId)
    ) failResponseSigning();
    const bodyHash = createHash('sha256').update(input.body).digest('base64url');
    const canonical = [
      signatureDomain,
      String(input.status),
      input.path,
      input.requestId,
      input.keyId,
      bodyHash,
    ].join('\n');
    return createHmac('sha256', keyRing.keyFor(input.keyId))
      .update(canonical, 'utf8')
      .digest('base64url');
  } catch {
    failResponseSigning();
  }
}

function authenticateRealm(
  input: Readonly<BrokerAuthenticationInput>,
  keyRing: PepperRing,
  signatureDomain: string,
  requestHashDomain: string,
): Readonly<{ requestHash: string }> {
  try {
    if (
      input.method !== 'POST'
      || !ALLOWED_PATHS.has(input.path)
      || !Buffer.isBuffer(input.body)
      || input.body.length > MAXIMUM_BODY_BYTES
      || !REQUEST_ID_PATTERN.test(input.requestId)
      || !TIMESTAMP_PATTERN.test(input.timestamp)
      || !SIGNATURE_PATTERN.test(input.signature)
      || !keyRing.acceptedVersions().includes(input.keyId)
      || !Number.isSafeInteger(input.nowMs)
      || input.nowMs < 0
    ) fail();

    const timestampSeconds = Number(input.timestamp);
    const nowSeconds = Math.floor(input.nowMs / 1_000);
    if (
      !Number.isSafeInteger(timestampSeconds)
      || Math.abs(nowSeconds - timestampSeconds) > MAXIMUM_CLOCK_SKEW_SECONDS
    ) fail();

    const bodyHash = createHash('sha256').update(input.body).digest('base64url');
    const canonical = [
      signatureDomain,
      input.method,
      input.path,
      input.timestamp,
      input.requestId,
      bodyHash,
    ].join('\n');
    const expected = createHmac('sha256', keyRing.keyFor(input.keyId))
      .update(canonical, 'utf8')
      .digest();
    const candidate = Buffer.from(input.signature, 'base64url');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) fail();

    // The UUID carries 122 random bits. A namespaced digest is opaque enough for
    // storage and, unlike a signing-key HMAC, remains stable during key rotation.
    const requestHash = createHash('sha256')
      .update(requestHashDomain, 'utf8')
      .update(input.requestId, 'utf8')
      .digest('base64url');
    return Object.freeze({ requestHash });
  } catch {
    fail();
  }
}

function fail(): never {
  throw new Error('broker_authentication_failed');
}

function failResponseSigning(): never {
  throw new Error('broker_response_signing_failed');
}
