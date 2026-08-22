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
import type { AppReviewAccountDeletionStore } from '../domain/appReviewAccountDeletion.js';
import type { AppReviewDataRetentionStore } from '../domain/appReviewDataRetention.js';
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
const DATA_DELETION_PREFIX = 'review_sandbox_account_deletions';
const RATE_WINDOW_MS = 15 * 60 * 1_000;
const DELETION_ARTIFACT_BATCH_LIMIT = 400;

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
  readonly rateLimitLookupIds: readonly string[];
  readonly schemaVersion: 1;
  readonly status: 'active' | 'removed';
  readonly subjectUid: string;
  readonly updatedAtMs: number;
}

interface StoredReviewDataDeletion {
  readonly attempts: number;
  readonly cleanupCompletedAtMs: number | null;
  readonly credentialGeneration: number;
  readonly createdAtMs: number;
  readonly installationLookupId: string;
  readonly lastAttemptAtMs: number | null;
  readonly rateLimitLookupIds: readonly string[];
  readonly schemaVersion: 1;
  readonly status: 'pending';
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

export class FirestoreAppReviewSandboxStore implements
  AppReviewSandboxStore,
  AppReviewAccountDeletionStore,
  AppReviewDataRetentionStore,
  WebSessionStore {
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
      transaction.set(grantPath, Object.freeze({
        ...grant,
        installationLookupId: command.currentInstallationLookup.lookupId,
        updatedAtMs: command.nowMs,
      }));
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
      if ((idempotent && !existingGrant) || (existingGrant && (
        existingGrant.credentialGeneration !== credential.generation
        || !acceptedInstallations.has(existingGrant.installationLookupId)
        || existingGrant.status !== 'active'
      ))) {
        throw new Error('invalid_app_review_grant_record');
      }
      if (!idempotent) {
        transaction.create(requestPath, Object.freeze({
          expiresAtMs: command.nowMs + 5 * 60 * 1_000,
          generation: credential.generation,
          schemaVersion: 1,
          subjectUid,
        }));
      }
      transaction.set(grantPath, Object.freeze({
        credentialGeneration: credential.generation,
        installationLookupId: command.currentInstallationLookup.lookupId,
        rateLimitLookupIds: Object.freeze(command.rateLimitBuckets
          .filter(({ clearOnSuccess }) => clearOnSuccess)
          .map(({ lookupId }) => lookupId)),
        schemaVersion: 1,
        status: 'active',
        subjectUid,
        updatedAtMs: command.nowMs,
      } satisfies StoredGrant));
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
      transaction.set(grantPath, Object.freeze({
        ...grant,
        installationLookupId: command.currentInstallationLookup.lookupId,
        updatedAtMs: command.nowMs,
      }));
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
      transaction.set(`${GRANT_PREFIX}/${nonce.subjectUid}`, Object.freeze({
        ...grant,
        updatedAtMs: command.nowMs,
      }));
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
      transaction.set(`${GRANT_PREFIX}/${session.subjectUid}`, Object.freeze({
        ...grant,
        updatedAtMs: command.nowMs,
      }));
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

  async listAppReviewRetentionCandidates(
    cutoffMs: number,
    limit: number,
  ): Promise<Readonly<{ malformed: number; subjectUids: readonly string[] }>> {
    assertRetentionArguments(cutoffMs, limit);
    const currentGeneration = await this.#database.runTransaction(async (transaction) => {
      const value = await transaction.get(CREDENTIAL_PATH);
      if (value === undefined) return null;
      const credential = parseCredential(value);
      if (!credential) throw new Error('invalid_app_review_retention_state');
      return credential.generation;
    });
    const [documents, deletionDocuments] = await Promise.all([
      this.#database.listCollection(GRANT_PREFIX),
      this.#database.listCollection(DATA_DELETION_PREFIX),
    ]);
    const queuedSubjectUids = new Set(deletionDocuments
      .map(({ id }) => (/^review_[A-Za-z0-9_-]{32}$/u.test(id) ? id : null))
      .filter((id): id is string => id !== null));
    const parsed = documents.map(({ id, value }) => {
      try {
        const grant = parseGrant(value);
        return grant?.subjectUid === id ? grant : null;
      } catch {
        return null;
      }
    });
    const subjectUids = parsed
      .filter((grant): grant is StoredGrant => grant !== null)
      .filter((grant) => !queuedSubjectUids.has(grant.subjectUid))
      .filter((grant) => (
        grant.status === 'removed'
        || currentGeneration === null
        || grant.credentialGeneration !== currentGeneration
        || grant.updatedAtMs <= cutoffMs
      ))
      .sort((left, right) => left.updatedAtMs - right.updatedAtMs)
      .slice(0, limit)
      .map(({ subjectUid }) => subjectUid);
    return Object.freeze({
      malformed: parsed.filter((grant) => grant === null).length,
      subjectUids: Object.freeze(subjectUids),
    });
  }

  beginAppReviewDataDeletion(command: Readonly<{
    cutoffMs: number;
    nowMs: number;
    subjectUid: string;
  }>): Promise<'already_queued' | 'not_due' | 'queued'> {
    if (
      !isNonnegativeSafeInteger(command.cutoffMs)
      || !isNonnegativeSafeInteger(command.nowMs)
      || !/^review_[A-Za-z0-9_-]{32}$/u.test(command.subjectUid)
    ) throw new Error('invalid_app_review_retention_state');
    return this.#database.runTransaction(async (transaction) => {
      const credentialValue = await transaction.get(CREDENTIAL_PATH);
      const credential = credentialValue === undefined ? null : parseCredential(credentialValue);
      if (credentialValue !== undefined && !credential) {
        throw new Error('invalid_app_review_retention_state');
      }
      const grantPath = `${GRANT_PREFIX}/${command.subjectUid}`;
      const deletionPath = `${DATA_DELETION_PREFIX}/${command.subjectUid}`;
      const [grantValue, deletionValue] = await Promise.all([
        transaction.get(grantPath),
        transaction.get(deletionPath),
      ]);
      const grant = parseGrant(grantValue);
      const deletion = parseReviewDataDeletion(deletionValue);
      if (!grant || grant.subjectUid !== command.subjectUid) {
        throw new Error('invalid_app_review_retention_state');
      }
      if (deletionValue !== undefined && !deletion) {
        throw new Error('invalid_app_review_retention_state');
      }
      if (deletion) {
        if (
          deletion.subjectUid !== grant.subjectUid
          || deletion.credentialGeneration !== grant.credentialGeneration
          || deletion.installationLookupId !== grant.installationLookupId
        ) throw new Error('invalid_app_review_retention_state');
        return 'already_queued';
      }
      const due = grant.status === 'removed'
        || !credential
        || grant.credentialGeneration !== credential.generation
        || grant.updatedAtMs <= command.cutoffMs;
      if (!due) return 'not_due';
      transaction.set(grantPath, Object.freeze({
        ...grant,
        status: 'removed',
        updatedAtMs: command.nowMs,
      }));
      transaction.create(deletionPath, Object.freeze({
        attempts: 0,
        cleanupCompletedAtMs: null,
        credentialGeneration: grant.credentialGeneration,
        createdAtMs: command.nowMs,
        installationLookupId: grant.installationLookupId,
        lastAttemptAtMs: null,
        rateLimitLookupIds: grant.rateLimitLookupIds,
        schemaVersion: 1,
        status: 'pending',
        subjectUid: command.subjectUid,
        updatedAtMs: command.nowMs,
      } satisfies StoredReviewDataDeletion));
      return 'queued';
    });
  }

  beginRequestedAppReviewDataDeletion(command: Readonly<{
    installationLookups: readonly Readonly<HmacDigest>[];
    nowMs: number;
    subjectUid: string;
  }>): Promise<'accepted' | 'invalid'> {
    if (
      !isNonnegativeSafeInteger(command.nowMs)
      || !/^review_[A-Za-z0-9_-]{32}$/u.test(command.subjectUid)
      || command.installationLookups.length < 1
    ) return Promise.resolve('invalid');
    const acceptedInstallations = new Set(
      command.installationLookups.map(({ lookupId }) => lookupId),
    );
    return this.#database.runTransaction(async (transaction) => {
      const grantPath = `${GRANT_PREFIX}/${command.subjectUid}`;
      const deletionPath = `${DATA_DELETION_PREFIX}/${command.subjectUid}`;
      const [grantValue, deletionValue] = await Promise.all([
        transaction.get(grantPath),
        transaction.get(deletionPath),
      ]);
      const grant = parseGrant(grantValue);
      const deletion = parseReviewDataDeletion(deletionValue);
      if (deletionValue !== undefined && !deletion) {
        throw new Error('invalid_app_review_retention_state');
      }
      if (
        !grant
        || grant.subjectUid !== command.subjectUid
        || !acceptedInstallations.has(grant.installationLookupId)
      ) return 'invalid';
      if (deletion) {
        if (
          deletion.subjectUid !== grant.subjectUid
          || deletion.credentialGeneration !== grant.credentialGeneration
          || deletion.installationLookupId !== grant.installationLookupId
        ) throw new Error('invalid_app_review_retention_state');
        return 'accepted';
      }
      transaction.set(grantPath, Object.freeze({
        ...grant,
        status: 'removed',
        updatedAtMs: command.nowMs,
      }));
      transaction.create(deletionPath, Object.freeze({
        attempts: 0,
        cleanupCompletedAtMs: null,
        credentialGeneration: grant.credentialGeneration,
        createdAtMs: command.nowMs,
        installationLookupId: grant.installationLookupId,
        lastAttemptAtMs: null,
        rateLimitLookupIds: grant.rateLimitLookupIds,
        schemaVersion: 1,
        status: 'pending',
        subjectUid: command.subjectUid,
        updatedAtMs: command.nowMs,
      } satisfies StoredReviewDataDeletion));
      return 'accepted';
    });
  }

  async listAppReviewDataDeletionJobs(limit: number): Promise<Readonly<{
    malformed: number;
    subjectUids: readonly string[];
  }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('invalid_app_review_retention_limit');
    }
    const documents = await this.#database.listCollection(DATA_DELETION_PREFIX);
    const parsed = documents.map(({ id, value }) => {
      const deletion = parseReviewDataDeletion(value);
      return deletion?.subjectUid === id ? deletion : null;
    });
    return Object.freeze({
      malformed: parsed.filter((deletion) => deletion === null).length,
      subjectUids: Object.freeze(parsed
        .filter((deletion): deletion is StoredReviewDataDeletion => deletion !== null)
        .sort((left, right) => (
          (left.lastAttemptAtMs ?? -1) - (right.lastAttemptAtMs ?? -1)
          || left.createdAtMs - right.createdAtMs
        ))
        .slice(0, limit)
        .map(({ subjectUid }) => subjectUid)),
    });
  }

  async purgeAppReviewDataArtifacts(
    subjectUid: string,
    nowMs: number,
  ): Promise<'missing' | 'more' | 'ready'> {
    if (!/^review_[A-Za-z0-9_-]{32}$/u.test(subjectUid) || !isNonnegativeSafeInteger(nowMs)) {
      return 'missing';
    }
    const deletionPath = `${DATA_DELETION_PREFIX}/${subjectUid}`;
    const deletion = await this.#database.runTransaction(async (transaction) => {
      const value = await transaction.get(deletionPath);
      const parsed = parseReviewDataDeletion(value);
      if (value !== undefined && !parsed) throw new Error('invalid_app_review_retention_state');
      return parsed;
    });
    if (!deletion || deletion.subjectUid !== subjectUid) return 'missing';
    const collections = await Promise.all([
      this.#database.listCollection(LAUNCH_NONCE_PREFIX),
      this.#database.listCollection(WEB_SESSION_PREFIX),
      this.#database.listCollection(REDEMPTION_PREFIX),
    ]);
    const candidates = [
      ...collections[0].flatMap(({ id, value }) => (
        recordReferencesReviewSubject(value, deletion)
          ? [`${LAUNCH_NONCE_PREFIX}/${id}`]
          : []
      )),
      ...collections[1].flatMap(({ id, value }) => (
        recordReferencesReviewSubject(value, deletion)
          ? [`${WEB_SESSION_PREFIX}/${id}`]
          : []
      )),
      ...collections[2].flatMap(({ id, value }) => (
        recordReferencesReviewSubject(value, deletion)
          ? [`${REDEMPTION_PREFIX}/${id}`]
          : []
      )),
      ...deletion.rateLimitLookupIds.map((lookupId) => `${RATE_LIMIT_PREFIX}/${lookupId}`),
    ];
    const uniqueCandidates = [...new Set(candidates)];
    const batch = uniqueCandidates.slice(0, DELETION_ARTIFACT_BATCH_LIMIT);
    const hasMore = uniqueCandidates.length > batch.length;
    return this.#database.runTransaction(async (transaction) => {
      const value = await transaction.get(deletionPath);
      const current = parseReviewDataDeletion(value);
      if (value !== undefined && !current) throw new Error('invalid_app_review_retention_state');
      if (!current || current.subjectUid !== subjectUid) return 'missing';
      const artifacts = await Promise.all(batch.map(async (path) => Object.freeze({
        path,
        value: await transaction.get(path),
      })));
      for (const artifact of artifacts) {
        if (reviewDeletionArtifactBelongsTo(artifact.path, artifact.value, current)) {
          transaction.delete(artifact.path);
        }
      }
      transaction.set(deletionPath, Object.freeze({
        ...current,
        cleanupCompletedAtMs: hasMore ? null : nowMs,
        updatedAtMs: nowMs,
      }));
      return hasMore ? 'more' : 'ready';
    });
  }

  markAppReviewDataDeletionFailed(subjectUid: string, nowMs: number): Promise<void> {
    const deletionPath = `${DATA_DELETION_PREFIX}/${subjectUid}`;
    return this.#database.runTransaction(async (transaction) => {
      const value = await transaction.get(deletionPath);
      const deletion = parseReviewDataDeletion(value);
      if (value !== undefined && !deletion) throw new Error('invalid_app_review_retention_state');
      if (!deletion || deletion.subjectUid !== subjectUid) return;
      transaction.set(deletionPath, Object.freeze({
        ...deletion,
        attempts: deletion.attempts + 1,
        lastAttemptAtMs: nowMs,
        updatedAtMs: nowMs,
      }));
    });
  }

  completeAppReviewDataDeletion(
    subjectUid: string,
    nowMs: number,
  ): Promise<'completed' | 'not_ready'> {
    const deletionPath = `${DATA_DELETION_PREFIX}/${subjectUid}`;
    return this.#database.runTransaction(async (transaction) => {
      const deletionValue = await transaction.get(deletionPath);
      const deletion = parseReviewDataDeletion(deletionValue);
      if (deletionValue !== undefined && !deletion) {
        throw new Error('invalid_app_review_retention_state');
      }
      if (
        !deletion
        || deletion.subjectUid !== subjectUid
        || deletion.cleanupCompletedAtMs === null
      ) return 'not_ready';
      const grantPath = `${GRANT_PREFIX}/${subjectUid}`;
      const grantValue = await transaction.get(grantPath);
      const grant = parseGrant(grantValue);
      if (grantValue !== undefined && !grant) throw new Error('invalid_app_review_retention_state');
      if (grant && (
        grant.subjectUid !== subjectUid
        || grant.credentialGeneration !== deletion.credentialGeneration
        || grant.installationLookupId !== deletion.installationLookupId
        || grant.status !== 'removed'
      )) throw new Error('invalid_app_review_retention_state');
      if (grant) transaction.delete(grantPath);
      transaction.delete(deletionPath);
      return 'completed';
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
    || !(value.rateLimitLookupIds === undefined || (
      Array.isArray(value.rateLimitLookupIds)
      && value.rateLimitLookupIds.every((lookupId) => typeof lookupId === 'string')
    ))
    || (value.status !== 'active' && value.status !== 'removed')
    || typeof value.subjectUid !== 'string'
    || !/^review_[A-Za-z0-9_-]{32}$/u.test(value.subjectUid)
    || !Number.isSafeInteger(value.updatedAtMs)
  ) throw new Error('invalid_app_review_grant_record');
  return Object.freeze({
    ...(value as unknown as StoredGrant),
    rateLimitLookupIds: Object.freeze(value.rateLimitLookupIds ?? []),
  });
}

function parseReviewDataDeletion(value: unknown): StoredReviewDataDeletion | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || value.status !== 'pending'
    || !isNonnegativeSafeInteger(value.attempts)
    || !(value.cleanupCompletedAtMs === null
      || isNonnegativeSafeInteger(value.cleanupCompletedAtMs))
    || !Number.isSafeInteger(value.credentialGeneration)
    || (value.credentialGeneration as number) < 1
    || !isNonnegativeSafeInteger(value.createdAtMs)
    || typeof value.installationLookupId !== 'string'
    || !(value.lastAttemptAtMs === null || isNonnegativeSafeInteger(value.lastAttemptAtMs))
    || !Array.isArray(value.rateLimitLookupIds)
    || value.rateLimitLookupIds.some((lookupId) => typeof lookupId !== 'string')
    || typeof value.subjectUid !== 'string'
    || !/^review_[A-Za-z0-9_-]{32}$/u.test(value.subjectUid)
    || !isNonnegativeSafeInteger(value.updatedAtMs)
  ) return null;
  return value as unknown as StoredReviewDataDeletion;
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

function assertRetentionArguments(cutoffMs: number, limit: number): void {
  if (
    !isNonnegativeSafeInteger(cutoffMs)
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 100
  ) throw new Error('invalid_app_review_retention_limit');
}

function recordReferencesReviewSubject(
  value: unknown,
  deletion: Readonly<StoredReviewDataDeletion>,
): boolean {
  return isRecord(value) && value.subjectUid === deletion.subjectUid;
}

function reviewDeletionArtifactBelongsTo(
  path: string,
  value: unknown,
  deletion: Readonly<StoredReviewDataDeletion>,
): boolean {
  if (path.startsWith(`${RATE_LIMIT_PREFIX}/`)) {
    return deletion.rateLimitLookupIds.some(
      (lookupId) => path === `${RATE_LIMIT_PREFIX}/${lookupId}`,
    );
  }
  return recordReferencesReviewSubject(value, deletion);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
