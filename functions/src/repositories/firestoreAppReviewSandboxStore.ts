import { createHash } from 'node:crypto';

import {
  APP_REVIEW_SAMPLE_RESOURCE,
  type AppReviewCreateLaunchCommand,
  type AppReviewCredentialStatus,
  type AppReviewGrantView,
  type AppReviewRefreshCommand,
  type AppReviewRedeemCommand,
  type AppReviewRedemptionResult,
  type AppReviewRotateCommand,
  type AppReviewSandboxStore,
} from '../domain/appReviewAccess.js';
import type { WebSessionStore } from '../domain/webSessionBroker.js';
import type { HmacDigest } from '../security/versionedHmac.js';
import type {
  DocumentDatabase,
  DocumentTransaction,
} from './firestoreClientAccessStore.js';

const CREDENTIAL_PATH = 'review_sandbox_credentials/current';
const CREDENTIAL_LOOKUP_PREFIX = 'review_sandbox_credential_lookups';
const GRANT_PREFIX = 'review_sandbox_grants';
const RATE_LIMIT_PREFIX = 'review_sandbox_rate_limits';
const REDEMPTION_PREFIX = 'review_sandbox_redemption_requests';
const LAUNCH_NONCE_PREFIX = 'review_sandbox_launch_nonces';
const WEB_SESSION_PREFIX = 'review_sandbox_web_sessions';
const BROKER_REQUEST_PREFIX = 'review_sandbox_broker_requests';
const RATE_WINDOW_MS = 15 * 60 * 1_000;

interface StoredCredential {
  readonly generation: number;
  readonly hashVersion: string;
  readonly lookupId: string;
  readonly purpose: 'app_review';
  readonly rotatedAtMs: number;
  readonly schemaVersion: 1;
  readonly scope: 'review_sandbox';
  readonly status: 'active';
}

interface StoredGrant {
  readonly credentialGeneration: number;
  readonly installationLookupId: string;
  readonly schemaVersion: 1;
  readonly status: 'active' | 'removed';
  readonly subjectUid: string;
  readonly updatedAtMs: number;
}

interface StoredRateLimit {
  readonly blockedUntilMs: number;
  readonly expiresAtMs: number;
  readonly failures: number;
  readonly schemaVersion: 1;
  readonly windowStartedAtMs: number;
}

interface StoredReviewLaunchNonce {
  readonly consumedAtMs: number | null;
  readonly credentialGeneration: number;
  readonly expiresAtMs: number;
  readonly hashVersion: string;
  readonly resourceId: typeof APP_REVIEW_SAMPLE_RESOURCE.id;
  readonly schemaVersion: 1;
  readonly subjectUid: string;
}

interface StoredReviewWebSession {
  readonly createdAtMs: number;
  readonly credentialGeneration: number;
  readonly expiresAtMs: number;
  readonly hashVersion: string;
  readonly resourceId: typeof APP_REVIEW_SAMPLE_RESOURCE.id;
  readonly schemaVersion: 1;
  readonly status: 'active' | 'revoked';
  readonly subjectUid: string;
  readonly updatedAtMs: number;
}

export class FirestoreAppReviewSandboxStore implements AppReviewSandboxStore, WebSessionStore {
  readonly #database: DocumentDatabase;

  constructor(database: DocumentDatabase) {
    this.#database = database;
  }

  credentialStatus(): Promise<AppReviewCredentialStatus> {
    return this.#database.runTransaction(async (transaction) => {
      const value = await transaction.get(CREDENTIAL_PATH);
      if (value === undefined) return emptyStatus();
      const credential = parseCredential(value);
      if (!credential) throw new Error('invalid_app_review_credential_record');
      return credentialStatus(credential);
    });
  }

  createLaunch(command: AppReviewCreateLaunchCommand): Promise<'created' | 'invalid'> {
    return this.#database.runTransaction(async (transaction) => {
      const credential = parseCredential(await transaction.get(CREDENTIAL_PATH));
      const grantPath = `${GRANT_PREFIX}/${command.subjectUid}`;
      const grant = parseGrant(await transaction.get(grantPath));
      const acceptedInstallations = new Set(
        command.installationLookups.map(({ lookupId }) => lookupId),
      );
      if (
        !credential
        || !grant
        || grant.status !== 'active'
        || grant.subjectUid !== command.subjectUid
        || grant.credentialGeneration !== credential.generation
        || !acceptedInstallations.has(grant.installationLookupId)
      ) return 'invalid';
      const noncePath = `${LAUNCH_NONCE_PREFIX}/${command.nonceLookup.lookupId}`;
      if (await transaction.get(noncePath) !== undefined) {
        throw new Error('app_review_launch_nonce_collision');
      }
      if (grant.installationLookupId !== command.currentInstallationLookup.lookupId) {
        transaction.set(grantPath, Object.freeze({
          ...grant,
          installationLookupId: command.currentInstallationLookup.lookupId,
          updatedAtMs: command.nowMs,
        }));
      }
      transaction.create(noncePath, Object.freeze({
        consumedAtMs: null,
        credentialGeneration: credential.generation,
        expiresAtMs: command.expiresAtMs,
        hashVersion: command.nonceLookup.version,
        resourceId: APP_REVIEW_SAMPLE_RESOURCE.id,
        schemaVersion: 1,
        subjectUid: command.subjectUid,
      } satisfies StoredReviewLaunchNonce));
      return 'created';
    });
  }

  rotateCredential(command: AppReviewRotateCommand): Promise<AppReviewCredentialStatus | 'conflict'> {
    return this.#database.runTransaction(async (transaction) => {
      const currentValue = await transaction.get(CREDENTIAL_PATH);
      const current = currentValue === undefined ? null : parseCredential(currentValue);
      if (currentValue !== undefined && !current) {
        throw new Error('invalid_app_review_credential_record');
      }
      const currentGeneration = current?.generation ?? null;
      if (currentGeneration !== command.expectedGeneration) return 'conflict';
      const lookupPath = `${CREDENTIAL_LOOKUP_PREFIX}/${command.credentialLookup.lookupId}`;
      if (await transaction.get(lookupPath) !== undefined) {
        throw new Error('app_review_credential_collision');
      }
      const generation = (current?.generation ?? 0) + 1;
      if (current) transaction.delete(`${CREDENTIAL_LOOKUP_PREFIX}/${current.lookupId}`);
      const next = Object.freeze({
        generation,
        hashVersion: command.credentialLookup.version,
        lookupId: command.credentialLookup.lookupId,
        purpose: 'app_review',
        rotatedAtMs: command.rotatedAtMs,
        schemaVersion: 1,
        scope: 'review_sandbox',
        status: 'active',
      } satisfies StoredCredential);
      transaction.set(CREDENTIAL_PATH, next);
      transaction.create(lookupPath, Object.freeze({
        generation,
        hashVersion: command.credentialLookup.version,
        schemaVersion: 1,
      }));
      return credentialStatus(next);
    });
  }

  redeem(command: AppReviewRedeemCommand): Promise<AppReviewRedemptionResult> {
    return this.#database.runTransaction(async (transaction) => {
      const rateLimits = await Promise.all(command.rateLimitBuckets.map(async (bucket) => {
        const path = `${RATE_LIMIT_PREFIX}/${bucket.lookupId}`;
        return Object.freeze({
          bucket,
          path,
          value: parseRateLimit(await transaction.get(path)),
        });
      }));
      const blocked = rateLimits.find(({ value }) => value && value.blockedUntilMs > command.nowMs);
      if (blocked?.value) {
        return Object.freeze({
          kind: 'rate_limited' as const,
          retryAfterSeconds: Math.max(1, Math.ceil(
            (blocked.value.blockedUntilMs - command.nowMs) / 1_000,
          )),
        });
      }
      const credential = parseCredential(await transaction.get(CREDENTIAL_PATH));
      if (!credential || credential.status !== 'active') {
        writeFailedAttempts(transaction, rateLimits, command.nowMs);
        return Object.freeze({ kind: 'invalid' as const });
      }
      const lookupDocuments = await Promise.all(command.credentialLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${CREDENTIAL_LOOKUP_PREFIX}/${lookup.lookupId}`),
      })));
      const match = lookupDocuments.find(({ value }) => (
        isCredentialLookup(value, credential.generation)
      ));
      if (!match || credential.lookupId !== match.lookup.lookupId) {
        writeFailedAttempts(transaction, rateLimits, command.nowMs);
        return Object.freeze({ kind: 'invalid' as const });
      }
      const subjectUid = createReviewSubject(
        credential.generation,
        command.currentInstallationLookup.digest,
      );
      const requestPath = `${REDEMPTION_PREFIX}/${command.requestIdHash}`;
      const requestValue = await transaction.get(requestPath);
      const request = parseRedemptionRequest(requestValue);
      const idempotent = request !== null
        && request.expiresAtMs > command.nowMs
        && request.generation === credential.generation
        && request.subjectUid === subjectUid;
      if (requestValue !== undefined && !idempotent) {
        throw new Error('app_review_redemption_request_collision');
      }
      const grantPath = `${GRANT_PREFIX}/${subjectUid}`;
      const existingGrant = parseGrant(await transaction.get(grantPath));
      const acceptedInstallations = new Set(command.installationLookups.map(({ lookupId }) => lookupId));
      if (existingGrant && (
        existingGrant.credentialGeneration !== credential.generation
        || !acceptedInstallations.has(existingGrant.installationLookupId)
        || existingGrant.status !== 'active'
      )) {
        throw new Error('invalid_app_review_grant_record');
      }
      if (!idempotent) {
        transaction.set(grantPath, Object.freeze({
          credentialGeneration: credential.generation,
          installationLookupId: command.currentInstallationLookup.lookupId,
          schemaVersion: 1,
          status: 'active',
          subjectUid,
          updatedAtMs: command.nowMs,
        } satisfies StoredGrant));
        transaction.create(requestPath, Object.freeze({
          expiresAtMs: command.nowMs + 5 * 60 * 1_000,
          generation: credential.generation,
          schemaVersion: 1,
          subjectUid,
        }));
      }
      for (const { bucket, path } of rateLimits) {
        if (bucket.clearOnSuccess) transaction.delete(path);
      }
      return Object.freeze({
        grant: grantView(credential.generation),
        kind: 'granted' as const,
        subjectUid,
      });
    });
  }

  refresh(command: AppReviewRefreshCommand): Promise<AppReviewGrantView | 'invalid'> {
    return this.#database.runTransaction(async (transaction) => {
      const credential = parseCredential(await transaction.get(CREDENTIAL_PATH));
      const grantPath = `${GRANT_PREFIX}/${command.subjectUid}`;
      const grant = parseGrant(await transaction.get(grantPath));
      const acceptedInstallations = new Set(
        command.installationLookups.map(({ lookupId }) => lookupId),
      );
      if (
        !credential
        || !grant
        || grant.status !== 'active'
        || grant.subjectUid !== command.subjectUid
        || grant.credentialGeneration !== credential.generation
        || !acceptedInstallations.has(grant.installationLookupId)
      ) return 'invalid';
      if (grant.installationLookupId !== command.currentInstallationLookup.lookupId) {
        transaction.set(grantPath, Object.freeze({
          ...grant,
          installationLookupId: command.currentInstallationLookup.lookupId,
          updatedAtMs: command.nowMs,
        }));
      }
      return grantView(credential.generation);
    });
  }

  redeemLaunchForWeb(command: Readonly<{
    brokerRequestHash: string;
    expiresNoLaterThanMs: number;
    nonceLookups: readonly Readonly<HmacDigest>[];
    nowMs: number;
    sessionLookup: Readonly<HmacDigest>;
  }>): Promise<Readonly<{ expiresAtMs: number; kind: 'created' } | { kind: 'invalid' }>> {
    return this.#database.runTransaction(async (transaction) => {
      if (!await brokerRequestIsFresh(transaction, command.brokerRequestHash)) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      const candidates = await Promise.all(command.nonceLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${LAUNCH_NONCE_PREFIX}/${lookup.lookupId}`),
      })));
      const match = candidates.find(({ value }) => parseReviewLaunchNonce(value) !== null);
      const nonce = match ? parseReviewLaunchNonce(match.value) : null;
      const credential = parseCredential(await transaction.get(CREDENTIAL_PATH));
      const grant = nonce
        ? parseGrant(await transaction.get(`${GRANT_PREFIX}/${nonce.subjectUid}`))
        : null;
      if (
        !match
        || !nonce
        || !credential
        || !grant
        || nonce.consumedAtMs !== null
        || nonce.expiresAtMs <= command.nowMs
        || nonce.credentialGeneration !== credential.generation
        || grant.credentialGeneration !== credential.generation
        || grant.status !== 'active'
        || grant.subjectUid !== nonce.subjectUid
        || nonce.resourceId !== APP_REVIEW_SAMPLE_RESOURCE.id
      ) return Object.freeze({ kind: 'invalid' as const });
      const sessionPath = `${WEB_SESSION_PREFIX}/${command.sessionLookup.lookupId}`;
      if (await transaction.get(sessionPath) !== undefined) {
        throw new Error('app_review_web_session_collision');
      }
      const expiresAtMs = command.expiresNoLaterThanMs;
      transaction.set(`${LAUNCH_NONCE_PREFIX}/${match.lookup.lookupId}`, Object.freeze({
        ...nonce,
        consumedAtMs: command.nowMs,
      }));
      transaction.create(sessionPath, Object.freeze({
        createdAtMs: command.nowMs,
        credentialGeneration: credential.generation,
        expiresAtMs,
        hashVersion: command.sessionLookup.version,
        resourceId: APP_REVIEW_SAMPLE_RESOURCE.id,
        schemaVersion: 1,
        status: 'active',
        subjectUid: nonce.subjectUid,
        updatedAtMs: command.nowMs,
      } satisfies StoredReviewWebSession));
      writeBrokerRequest(transaction, command.brokerRequestHash, command.nowMs);
      return Object.freeze({ expiresAtMs, kind: 'created' as const });
    });
  }

  introspectWebSession(command: Readonly<{
    brokerRequestHash: string;
    currentSessionLookup: Readonly<HmacDigest>;
    nowMs: number;
    sessionLookups: readonly Readonly<HmacDigest>[];
  }>): Promise<Readonly<{
    entitlements: readonly string[];
    expiresAtMs: number;
    kind: 'active';
  } | { kind: 'invalid' }>> {
    return this.#database.runTransaction(async (transaction) => {
      if (!await brokerRequestIsFresh(transaction, command.brokerRequestHash)) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      const candidates = await Promise.all(command.sessionLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${WEB_SESSION_PREFIX}/${lookup.lookupId}`),
      })));
      const match = candidates.find(({ value }) => parseReviewWebSession(value) !== null);
      const session = match ? parseReviewWebSession(match.value) : null;
      const credential = parseCredential(await transaction.get(CREDENTIAL_PATH));
      const grant = session
        ? parseGrant(await transaction.get(`${GRANT_PREFIX}/${session.subjectUid}`))
        : null;
      if (
        !match
        || !session
        || !credential
        || !grant
        || session.status !== 'active'
        || session.expiresAtMs <= command.nowMs
        || session.credentialGeneration !== credential.generation
        || grant.credentialGeneration !== credential.generation
        || grant.status !== 'active'
        || grant.subjectUid !== session.subjectUid
        || session.resourceId !== APP_REVIEW_SAMPLE_RESOURCE.id
      ) return Object.freeze({ kind: 'invalid' as const });
      if (match.lookup.lookupId !== command.currentSessionLookup.lookupId) {
        const currentPath = `${WEB_SESSION_PREFIX}/${command.currentSessionLookup.lookupId}`;
        if (await transaction.get(currentPath) !== undefined) {
          throw new Error('app_review_web_session_collision');
        }
        transaction.create(currentPath, Object.freeze({
          ...session,
          hashVersion: command.currentSessionLookup.version,
          updatedAtMs: command.nowMs,
        }));
        transaction.delete(`${WEB_SESSION_PREFIX}/${match.lookup.lookupId}`);
      }
      writeBrokerRequest(transaction, command.brokerRequestHash, command.nowMs);
      return Object.freeze({
        entitlements: Object.freeze([APP_REVIEW_SAMPLE_RESOURCE.id]),
        expiresAtMs: session.expiresAtMs,
        kind: 'active' as const,
      });
    });
  }

  revokeWebSession(command: Readonly<{
    brokerRequestHash: string;
    nowMs: number;
    sessionLookups: readonly Readonly<HmacDigest>[];
  }>): Promise<'revoked' | 'invalid'> {
    return this.#database.runTransaction(async (transaction) => {
      if (!await brokerRequestIsFresh(transaction, command.brokerRequestHash)) return 'invalid';
      const candidates = await Promise.all(command.sessionLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${WEB_SESSION_PREFIX}/${lookup.lookupId}`),
      })));
      const match = candidates.find(({ value }) => parseReviewWebSession(value) !== null);
      const session = match ? parseReviewWebSession(match.value) : null;
      if (!match || !session || session.status !== 'active') return 'invalid';
      transaction.set(`${WEB_SESSION_PREFIX}/${match.lookup.lookupId}`, Object.freeze({
        ...session,
        status: 'revoked',
        updatedAtMs: command.nowMs,
      }));
      writeBrokerRequest(transaction, command.brokerRequestHash, command.nowMs);
      return 'revoked';
    });
  }
}

function grantView(generation: number): AppReviewGrantView {
  return Object.freeze({
    credentialGeneration: generation,
    expiresAtMs: null,
    purpose: 'app_review',
    resources: Object.freeze([APP_REVIEW_SAMPLE_RESOURCE]) as readonly [typeof APP_REVIEW_SAMPLE_RESOURCE],
    schemaVersion: 1,
    scope: 'review_sandbox',
    status: 'active',
  });
}

function emptyStatus(): AppReviewCredentialStatus {
  return Object.freeze({
    configured: false,
    generation: null,
    purpose: 'app_review',
    rotatedAtMs: null,
  });
}

function credentialStatus(credential: StoredCredential): AppReviewCredentialStatus {
  return Object.freeze({
    configured: true,
    generation: credential.generation,
    purpose: 'app_review',
    rotatedAtMs: credential.rotatedAtMs,
  });
}

function parseCredential(value: unknown): StoredCredential | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || value.purpose !== 'app_review'
    || value.scope !== 'review_sandbox'
    || value.status !== 'active'
    || !Number.isSafeInteger(value.generation)
    || (value.generation as number) < 1
    || typeof value.hashVersion !== 'string'
    || typeof value.lookupId !== 'string'
    || !Number.isSafeInteger(value.rotatedAtMs)
  ) return null;
  return value as unknown as StoredCredential;
}

function isCredentialLookup(value: unknown, generation: number): boolean {
  return isRecord(value)
    && value.schemaVersion === 1
    && value.generation === generation
    && typeof value.hashVersion === 'string';
}

function parseGrant(value: unknown): StoredGrant | null {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new Error('invalid_app_review_grant_record');
  if (
    value.schemaVersion !== 1
    || !Number.isSafeInteger(value.credentialGeneration)
    || typeof value.installationLookupId !== 'string'
    || (value.status !== 'active' && value.status !== 'removed')
    || typeof value.subjectUid !== 'string'
    || !/^review_[A-Za-z0-9_-]{32}$/u.test(value.subjectUid)
    || !Number.isSafeInteger(value.updatedAtMs)
  ) throw new Error('invalid_app_review_grant_record');
  return value as unknown as StoredGrant;
}

function parseRedemptionRequest(value: unknown): Readonly<{
  expiresAtMs: number;
  generation: number;
  subjectUid: string;
}> | null {
  if (value === undefined) return null;
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.expiresAtMs)
    || !Number.isSafeInteger(value.generation)
    || typeof value.subjectUid !== 'string'
    || !/^review_[A-Za-z0-9_-]{32}$/u.test(value.subjectUid)
  ) throw new Error('invalid_app_review_redemption_record');
  return Object.freeze({
    expiresAtMs: value.expiresAtMs as number,
    generation: value.generation as number,
    subjectUid: value.subjectUid,
  });
}

function parseRateLimit(value: unknown): StoredRateLimit | null {
  if (value === undefined) return null;
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.blockedUntilMs)
    || !Number.isSafeInteger(value.expiresAtMs)
    || !Number.isSafeInteger(value.failures)
    || !Number.isSafeInteger(value.windowStartedAtMs)
  ) throw new Error('invalid_app_review_rate_limit_record');
  return value as unknown as StoredRateLimit;
}

function parseReviewLaunchNonce(value: unknown): StoredReviewLaunchNonce | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || !(value.consumedAtMs === null || Number.isSafeInteger(value.consumedAtMs))
    || !Number.isSafeInteger(value.credentialGeneration)
    || !Number.isSafeInteger(value.expiresAtMs)
    || typeof value.hashVersion !== 'string'
    || value.resourceId !== APP_REVIEW_SAMPLE_RESOURCE.id
    || typeof value.subjectUid !== 'string'
    || !/^review_[A-Za-z0-9_-]{32}$/u.test(value.subjectUid)
  ) return null;
  return value as unknown as StoredReviewLaunchNonce;
}

function parseReviewWebSession(value: unknown): StoredReviewWebSession | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || !Number.isSafeInteger(value.createdAtMs)
    || !Number.isSafeInteger(value.credentialGeneration)
    || !Number.isSafeInteger(value.expiresAtMs)
    || typeof value.hashVersion !== 'string'
    || value.resourceId !== APP_REVIEW_SAMPLE_RESOURCE.id
    || (value.status !== 'active' && value.status !== 'revoked')
    || typeof value.subjectUid !== 'string'
    || !/^review_[A-Za-z0-9_-]{32}$/u.test(value.subjectUid)
    || !Number.isSafeInteger(value.updatedAtMs)
  ) return null;
  return value as unknown as StoredReviewWebSession;
}

async function brokerRequestIsFresh(
  transaction: DocumentTransaction,
  requestHash: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{24,128}$/u.test(requestHash)) return false;
  return await transaction.get(`${BROKER_REQUEST_PREFIX}/${requestHash}`) === undefined;
}

function writeBrokerRequest(
  transaction: DocumentTransaction,
  requestHash: string,
  nowMs: number,
): void {
  transaction.create(`${BROKER_REQUEST_PREFIX}/${requestHash}`, Object.freeze({
    expiresAtMs: nowMs + 2 * 60 * 1_000,
    occurredAtMs: nowMs,
    schemaVersion: 1,
  }));
}

function writeFailedAttempts(
  transaction: DocumentTransaction,
  rateLimits: readonly Readonly<{
    bucket: Readonly<{ maximumFailures: number }>;
    path: string;
    value: StoredRateLimit | null;
  }>[],
  nowMs: number,
): void {
  for (const { bucket, path, value } of rateLimits) {
    const withinWindow = value !== null && value.windowStartedAtMs + RATE_WINDOW_MS > nowMs;
    const failures = withinWindow ? value.failures + 1 : 1;
    transaction.set(path, Object.freeze({
      blockedUntilMs: failures >= bucket.maximumFailures ? nowMs + RATE_WINDOW_MS : 0,
      expiresAtMs: nowMs + 2 * RATE_WINDOW_MS,
      failures,
      schemaVersion: 1,
      windowStartedAtMs: withinWindow ? value.windowStartedAtMs : nowMs,
    } satisfies StoredRateLimit));
  }
}

function createReviewSubject(generation: number, installationDigest: string): string {
  const digest = createHash('sha256')
    .update('cabohealth/app-review-subject/v1\0', 'utf8')
    .update(String(generation), 'utf8')
    .update('\0', 'utf8')
    .update(installationDigest, 'utf8')
    .digest('base64url');
  return `review_${digest.slice(0, 32)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
