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

/**
 * Authenticates a server-to-server request without retaining caller-provided
 * identifiers. Every failure is intentionally indistinguishable to callers.
 */
export function authenticateBrokerRequest(
  input: Readonly<BrokerAuthenticationInput>,
  keyRing: PepperRing,
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
      'cabohealth-broker-v1',
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
      .update('cabohealth/broker-request-id/v1\0', 'utf8')
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
