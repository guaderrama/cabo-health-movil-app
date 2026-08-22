import { createHash } from 'node:crypto';

import {
  type AccessCodeCreateRecord,
  type AccessCodeStore,
} from '../domain/accessCodeIssuer.js';
import {
  type ClientGrantView,
  type ClientResourceView,
  type RedeemCommand,
  type RedemptionResult,
  type RedemptionStore,
} from '../domain/clientAccessRedeemer.js';
import {
  type ClientSessionCommand,
  type ClientSessionStore,
} from '../domain/clientSessionManager.js';
import {
  type ClientLaunchStore,
  type ConsumeLaunchCommand,
  type CreateLaunchCommand,
} from '../domain/clientLaunchService.js';
import { type WebSessionStore } from '../domain/webSessionBroker.js';

const ACTIVE_CODE_COUNTER_PATH = '_private_admin_counters/active_client_codes';
const ACCESS_CODE_PREFIX = '_private_access_codes';
const ACCESS_CODE_LOOKUP_PREFIX = '_private_access_code_lookups';
const CLIENT_GRANT_PREFIX = '_private_client_grants';
const CLIENT_RESOURCE_PREFIX = '_private_client_resources';
const CLIENT_SLOT_PREFIX = '_private_client_slots';
const RATE_LIMIT_PREFIX = '_private_rate_limits';
const REDEMPTION_REQUEST_PREFIX = '_private_redemption_requests';
const AUDIT_EVENT_PREFIX = '_private_audit_events';
const LAUNCH_NONCE_PREFIX = '_private_launch_nonces';
const WEB_SESSION_PREFIX = '_private_web_sessions';
const BROKER_REQUEST_PREFIX = '_private_broker_requests';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;

export interface DocumentTransaction {
  get(path: string): Promise<unknown | undefined>;
  create(path: string, value: unknown): void;
  delete(path: string): void;
  set(path: string, value: unknown): void;
}

export interface DocumentDatabase {
  runTransaction<T>(
    operation: (transaction: DocumentTransaction) => Promise<T>,
  ): Promise<T>;
  listCollection(path: string): Promise<readonly Readonly<{ id: string; value: unknown }>[] >;
}

export interface AdminAccessCodeSummary {
  readonly codeId: string;
  readonly createdAtMs: number;
  readonly displaySuffix: string;
  readonly expiresAtMs: number;
  readonly slot: 1 | 2 | 3 | 4;
  readonly status: 'active' | 'revoked';
}

interface StoredAccessCode extends Omit<AccessCodeCreateRecord, 'status'> {
  readonly boundInstallationLookupId: string | null;
  readonly redeemedAtMs: number | null;
  readonly schemaVersion: 1;
  readonly subjectUid: string | null;
  readonly updatedAtMs: number;
  readonly status: 'active' | 'revoked';
}

interface StoredRateLimit {
  readonly blockedUntilMs: number;
  readonly expiresAtMs: number;
  readonly failures: number;
  readonly schemaVersion: 1;
  readonly windowStartedAtMs: number;
}

interface StoredClientGrant {
  readonly codeId: string;
  readonly expiresAtMs: number;
  readonly installationLookupId: string;
  readonly resourceIds: readonly string[];
  readonly schemaVersion: 1;
  readonly status: 'active' | 'removed' | 'revoked';
  readonly updatedAtMs: number;
}

interface StoredLaunchNonce {
  readonly codeId: string;
  readonly consumedAtMs: number | null;
  readonly expiresAtMs: number;
  readonly hashVersion: string;
  readonly resourceId: string;
  readonly schemaVersion: 1;
  readonly subjectUid: string;
}

interface StoredWebSession {
  readonly codeId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly hashVersion: string;
  readonly resourceId: string;
  readonly schemaVersion: 1;
  readonly status: 'active' | 'revoked';
  readonly subjectUid: string;
  readonly updatedAtMs: number;
}

export function clientResourcePath(resourceId: string): string {
  return `${CLIENT_RESOURCE_PREFIX}/${resourceId}`;
}

export class FirestoreClientAccessStore implements AccessCodeStore, RedemptionStore, ClientSessionStore, ClientLaunchStore, WebSessionStore {
  readonly #database: DocumentDatabase;

  constructor(database: DocumentDatabase) {
    this.#database = database;
  }

  createActiveCode(
    record: AccessCodeCreateRecord,
    maximumActive: number,
  ): Promise<'created' | 'collision' | 'invalid_resource' | 'limit'> {
    return this.#database.runTransaction(async (transaction) => {
      parseCounter(await transaction.get(ACTIVE_CODE_COUNTER_PATH));
      const resources = await Promise.all(record.resourceIds.map(async (resourceId) => (
        parseClientResource(await transaction.get(clientResourcePath(resourceId)))
      )));
      if (resources.some((resource, index) => (
        resource === null || resource.id !== record.resourceIds[index]
      ))) return 'invalid_resource';
      const lookupPath = `${ACCESS_CODE_LOOKUP_PREFIX}/${record.lookupId}`;
      const codePath = `${ACCESS_CODE_PREFIX}/${record.codeId}`;
      const slotDocuments = await Promise.all([1, 2, 3, 4].map(async (slot) => ({
        path: `${CLIENT_SLOT_PREFIX}/${slot}`,
        slot,
        value: await transaction.get(`${CLIENT_SLOT_PREFIX}/${slot}`),
      })));
      const [existingLookup, existingCode] = await Promise.all([
        transaction.get(lookupPath),
        transaction.get(codePath),
      ]);
      if (existingLookup !== undefined || existingCode !== undefined) return 'collision';

      const occupied = await Promise.all(slotDocuments.flatMap(({ path, slot, value }) => {
        if (value === undefined) return [];
        const slotDocument = parseSlotDocument(value, slot);
        if (!slotDocument) throw new Error('invalid_client_slot_record');
        return [transaction.get(`${ACCESS_CODE_PREFIX}/${slotDocument.codeId}`).then((codeValue) => {
          const code = parseStoredAccessCode(codeValue);
          if (!code || code.slot !== slot) throw new Error('invalid_client_slot_record');
          return Object.freeze({ code, path });
        })];
      }));
      const active = occupied.filter(({ code }) => (
        code.status === 'active' && code.expiresAtMs > record.createdAtMs
      ));
      if (active.some(({ code }) => code.slot === record.slot)) return 'collision';
      if (active.length >= maximumActive) return 'limit';
      const activeCodeIds = new Set(active.map(({ code }) => code.codeId));
      const stale = occupied.filter(({ code }) => !activeCodeIds.has(code.codeId));
      const staleGrants = await Promise.all(stale.map(async ({ code }) => ({
        code,
        value: code.subjectUid
          ? await transaction.get(`${CLIENT_GRANT_PREFIX}/${code.subjectUid}`)
          : undefined,
      })));

      for (const { code, value } of staleGrants) {
        transaction.set(`${ACCESS_CODE_PREFIX}/${code.codeId}`, Object.freeze({
          ...code,
          status: 'revoked',
          updatedAtMs: record.createdAtMs,
        }));
        transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${code.lookupId}`);
        if (code.slot !== record.slot) {
          transaction.delete(`${CLIENT_SLOT_PREFIX}/${code.slot}`);
        }
        if (code.subjectUid && isRecord(value)) {
          transaction.set(`${CLIENT_GRANT_PREFIX}/${code.subjectUid}`, Object.freeze({
            ...value,
            status: 'revoked',
            updatedAtMs: record.createdAtMs,
          }));
        }
        transaction.create(
          `${AUDIT_EVENT_PREFIX}/expire_${code.codeId}_${record.createdAtMs}`,
          sanitizedAudit('access_code_expired', record.createdAtMs, code.codeId),
        );
      }

      const storedCode: Readonly<StoredAccessCode> = Object.freeze({
        ...record,
        boundInstallationLookupId: null,
        redeemedAtMs: null,
        schemaVersion: 1,
        subjectUid: null,
        updatedAtMs: record.createdAtMs,
      });
      transaction.create(codePath, storedCode);
      transaction.create(lookupPath, Object.freeze({
        codeId: record.codeId,
        createdAtMs: record.createdAtMs,
        hashVersion: record.hashVersion,
        schemaVersion: 1,
      }));
      // The slot document was read above, so a concurrent writer makes Firestore
      // retry. `set` is also a single final mutation when replacing an expired
      // occupant; delete+create on the same path has ambiguous preconditions.
      transaction.set(`${CLIENT_SLOT_PREFIX}/${record.slot}`, Object.freeze({
        codeId: record.codeId,
        schemaVersion: 1,
        slot: record.slot,
      }));
      transaction.set(ACTIVE_CODE_COUNTER_PATH, Object.freeze({
        activeCount: active.length + 1,
        schemaVersion: 1,
        updatedAtMs: record.createdAtMs,
      }));
      return 'created';
    });
  }

  async listAccessCodes(nowMs: number): Promise<readonly Readonly<AdminAccessCodeSummary>[]> {
    if (!isNonnegativeSafeInteger(nowMs)) throw new Error('invalid_reconciliation_time');
    await this.#database.runTransaction(async (transaction) => {
      await reconcileExpiredSlots(transaction, nowMs);
    });
    const documents = await this.#database.listCollection(ACCESS_CODE_PREFIX);
    const summaries = documents.flatMap(({ value }) => {
      const code = parseStoredAccessCode(value);
      if (!code) throw new Error('invalid_access_code_record');
      return [Object.freeze({
        codeId: code.codeId,
        createdAtMs: code.createdAtMs,
        displaySuffix: code.displaySuffix,
        expiresAtMs: code.expiresAtMs,
        slot: code.slot,
        status: code.status,
      })];
    });
    return Object.freeze(summaries.sort((left, right) => left.slot - right.slot));
  }

  revokeAccessCode(
    codeId: string,
    nowMs: number,
  ): Promise<Readonly<{ kind: 'not_active' } | { kind: 'revoked'; subjectUid: string | null }>> {
    if (!/^ac_[A-Za-z0-9_-]{32}$/u.test(codeId) || !isNonnegativeSafeInteger(nowMs)) {
      return Promise.resolve(Object.freeze({ kind: 'not_active' as const }));
    }
    return this.#database.runTransaction(async (transaction) => {
      const codePath = `${ACCESS_CODE_PREFIX}/${codeId}`;
      const code = parseStoredAccessCode(await transaction.get(codePath));
      const grantPath = code?.subjectUid ? `${CLIENT_GRANT_PREFIX}/${code.subjectUid}` : null;
      const grant = grantPath ? await transaction.get(grantPath) : undefined;
      const activeCount = await reconcileExpiredSlots(transaction, nowMs, false);
      if (!code || code.status !== 'active') {
        writeActiveCodeCounter(transaction, activeCount, nowMs);
        return Object.freeze({ kind: 'not_active' as const });
      }
      if (code.expiresAtMs <= nowMs) {
        writeActiveCodeCounter(transaction, activeCount, nowMs);
        return Object.freeze({ kind: 'not_active' as const });
      }

      transaction.set(codePath, Object.freeze({
        ...code,
        status: 'revoked',
        updatedAtMs: nowMs,
      }));
      transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${code.lookupId}`);
      transaction.delete(`${CLIENT_SLOT_PREFIX}/${code.slot}`);
      writeActiveCodeCounter(transaction, Math.max(0, activeCount - 1), nowMs);
      if (grantPath && isRecord(grant)) {
        transaction.set(grantPath, Object.freeze({
          ...grant,
          status: 'revoked',
          updatedAtMs: nowMs,
        }));
      }
      transaction.create(`${AUDIT_EVENT_PREFIX}/revoke_${codeId}_${nowMs}`, Object.freeze({
        codeId,
        eventType: 'access_code_revoked',
        occurredAtMs: nowMs,
        schemaVersion: 1,
      }));
      return Object.freeze({ kind: 'revoked' as const, subjectUid: code.subjectUid });
    });
  }

  refreshSession(command: Readonly<ClientSessionCommand>): Promise<
    Readonly<{ kind: 'active'; grant: Readonly<ClientGrantView> } | { kind: 'invalid' }>
  > {
    return this.#database.runTransaction(async (transaction) => {
      const session = await readLiveSession(transaction, command);
      if (!session) return Object.freeze({ kind: 'invalid' as const });
      if (session.grant.installationLookupId !== command.currentInstallationHash.lookupId) {
        transaction.set(session.grantPath, Object.freeze({
          ...session.grant,
          installationLookupId: command.currentInstallationHash.lookupId,
          updatedAtMs: command.nowMs,
        }));
        transaction.set(session.codePath, Object.freeze({
          ...session.code,
          boundInstallationLookupId: command.currentInstallationHash.lookupId,
          updatedAtMs: command.nowMs,
        }));
      }
      return Object.freeze({ kind: 'active' as const, grant: session.view });
    });
  }

  removeSession(command: Readonly<ClientSessionCommand>): Promise<
    Readonly<{ kind: 'invalid' } | { kind: 'removed' }>
  > {
    return this.#database.runTransaction(async (transaction) => {
      const session = await readLiveSession(transaction, command, false);
      if (!session) return Object.freeze({ kind: 'invalid' as const });
      const counter = parseCounter(await transaction.get(ACTIVE_CODE_COUNTER_PATH));
      transaction.set(session.codePath, Object.freeze({
        ...session.code,
        status: 'revoked',
        updatedAtMs: command.nowMs,
      }));
      transaction.set(session.grantPath, Object.freeze({
        ...session.grant,
        status: 'removed',
        updatedAtMs: command.nowMs,
      }));
      transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${session.code.lookupId}`);
      transaction.delete(`${CLIENT_SLOT_PREFIX}/${session.code.slot}`);
      transaction.set(ACTIVE_CODE_COUNTER_PATH, Object.freeze({
        activeCount: Math.max(0, counter - 1),
        schemaVersion: 1,
        updatedAtMs: command.nowMs,
      }));
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/remove_${session.code.codeId}_${command.nowMs}`,
        sanitizedAudit('client_access_removed', command.nowMs, session.code.codeId),
      );
      return Object.freeze({ kind: 'removed' as const });
    });
  }

  deleteSession(command: Readonly<ClientSessionCommand>): Promise<
    Readonly<{ kind: 'deleted' } | { kind: 'invalid' }>
  > {
    return this.#database.runTransaction(async (transaction) => {
      const session = await readLiveSession(transaction, command, false);
      if (!session) return Object.freeze({ kind: 'invalid' as const });
      const counter = parseCounter(await transaction.get(ACTIVE_CODE_COUNTER_PATH));
      transaction.delete(session.codePath);
      transaction.delete(session.grantPath);
      transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${session.code.lookupId}`);
      transaction.delete(`${CLIENT_SLOT_PREFIX}/${session.code.slot}`);
      transaction.set(ACTIVE_CODE_COUNTER_PATH, Object.freeze({
        activeCount: Math.max(0, counter - 1),
        schemaVersion: 1,
        updatedAtMs: command.nowMs,
      }));
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/delete_${subjectAuditId(command.subjectUid)}_${command.nowMs}`,
        sanitizedAudit('client_account_deleted', command.nowMs),
      );
      return Object.freeze({ kind: 'deleted' as const });
    });
  }

  createLaunch(command: Readonly<CreateLaunchCommand>): Promise<'created' | 'invalid'> {
    return this.#database.runTransaction(async (transaction) => {
      const session = await readLiveSession(transaction, command);
      if (!session || !session.view.resources.some(({ id }) => id === command.resourceId)) {
        return 'invalid';
      }
      const noncePath = `${LAUNCH_NONCE_PREFIX}/${command.nonceLookup.lookupId}`;
      if (await transaction.get(noncePath) !== undefined) return 'invalid';
      transaction.create(noncePath, Object.freeze({
        codeId: session.code.codeId,
        consumedAtMs: null,
        expiresAtMs: command.expiresAtMs,
        hashVersion: command.nonceLookup.version,
        resourceId: command.resourceId,
        schemaVersion: 1,
        subjectUid: command.subjectUid,
      } satisfies StoredLaunchNonce));
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/launch_${command.nonceLookup.digest.slice(0, 20)}_${command.nowMs}`,
        sanitizedAudit('client_launch_created', command.nowMs, session.code.codeId),
      );
      return 'created';
    });
  }

  consumeLaunch(command: Readonly<ConsumeLaunchCommand>): Promise<
    Readonly<{ kind: 'consumed'; resourceId: string } | { kind: 'invalid' }>
  > {
    return this.#database.runTransaction(async (transaction) => {
      const candidates = await Promise.all(command.nonceLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${LAUNCH_NONCE_PREFIX}/${lookup.lookupId}`),
      })));
      const match = candidates.find(({ value }) => parseStoredLaunchNonce(value) !== null);
      const nonce = match ? parseStoredLaunchNonce(match.value) : null;
      if (
        !match
        || !nonce
        || nonce.consumedAtMs !== null
        || nonce.expiresAtMs <= command.nowMs
      ) return Object.freeze({ kind: 'invalid' as const });
      const grant = parseStoredClientGrant(
        await transaction.get(`${CLIENT_GRANT_PREFIX}/${nonce.subjectUid}`),
      );
      const code = parseStoredAccessCode(
        await transaction.get(`${ACCESS_CODE_PREFIX}/${nonce.codeId}`),
      );
      const resource = parseClientResource(
        await transaction.get(clientResourcePath(nonce.resourceId)),
      );
      if (
        !grant
        || grant.status !== 'active'
        || grant.expiresAtMs <= command.nowMs
        || !grant.resourceIds.includes(nonce.resourceId)
        || !code
        || code.status !== 'active'
        || code.expiresAtMs <= command.nowMs
        || code.subjectUid !== nonce.subjectUid
        || !resource
      ) return Object.freeze({ kind: 'invalid' as const });
      transaction.set(`${LAUNCH_NONCE_PREFIX}/${match.lookup.lookupId}`, Object.freeze({
        ...nonce,
        consumedAtMs: command.nowMs,
      }));
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/consume_${match.lookup.digest.slice(0, 20)}_${command.nowMs}`,
        sanitizedAudit('client_launch_consumed', command.nowMs, code.codeId),
      );
      return Object.freeze({ kind: 'consumed' as const, resourceId: nonce.resourceId });
    });
  }

  redeemLaunchForWeb(command: Readonly<{
    brokerRequestHash: string;
    expiresNoLaterThanMs: number;
    nonceLookups: readonly Readonly<import('../security/versionedHmac.js').HmacDigest>[];
    nowMs: number;
    sessionLookup: Readonly<import('../security/versionedHmac.js').HmacDigest>;
  }>): Promise<Readonly<{ expiresAtMs: number; kind: 'created' } | { kind: 'invalid' }>> {
    return this.#database.runTransaction(async (transaction) => {
      if (!await brokerRequestIsFresh(transaction, command.brokerRequestHash)) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      const candidates = await Promise.all(command.nonceLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${LAUNCH_NONCE_PREFIX}/${lookup.lookupId}`),
      })));
      const match = candidates.find(({ value }) => parseStoredLaunchNonce(value) !== null);
      const nonce = match ? parseStoredLaunchNonce(match.value) : null;
      const sessionPath = `${WEB_SESSION_PREFIX}/${command.sessionLookup.lookupId}`;
      const existingSession = await transaction.get(sessionPath);
      if (
        !match
        || !nonce
        || nonce.consumedAtMs !== null
        || nonce.expiresAtMs <= command.nowMs
        || existingSession !== undefined
      ) return Object.freeze({ kind: 'invalid' as const });
      const grant = parseStoredClientGrant(
        await transaction.get(`${CLIENT_GRANT_PREFIX}/${nonce.subjectUid}`),
      );
      const code = parseStoredAccessCode(
        await transaction.get(`${ACCESS_CODE_PREFIX}/${nonce.codeId}`),
      );
      const resource = parseClientResource(
        await transaction.get(clientResourcePath(nonce.resourceId)),
      );
      if (
        !grant
        || grant.status !== 'active'
        || grant.expiresAtMs <= command.nowMs
        || !grant.resourceIds.includes(nonce.resourceId)
        || !code
        || code.status !== 'active'
        || code.expiresAtMs <= command.nowMs
        || code.subjectUid !== nonce.subjectUid
        || !resource
      ) return Object.freeze({ kind: 'invalid' as const });
      const expiresAtMs = Math.min(
        command.expiresNoLaterThanMs,
        grant.expiresAtMs,
        code.expiresAtMs,
      );
      transaction.set(`${LAUNCH_NONCE_PREFIX}/${match.lookup.lookupId}`, Object.freeze({
        ...nonce,
        consumedAtMs: command.nowMs,
      }));
      transaction.create(sessionPath, Object.freeze({
        codeId: code.codeId,
        createdAtMs: command.nowMs,
        expiresAtMs,
        hashVersion: command.sessionLookup.version,
        resourceId: nonce.resourceId,
        schemaVersion: 1,
        status: 'active',
        subjectUid: nonce.subjectUid,
        updatedAtMs: command.nowMs,
      } satisfies StoredWebSession));
      writeBrokerRequest(transaction, command.brokerRequestHash, command.nowMs);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/web_create_${command.sessionLookup.digest.slice(0, 20)}_${command.nowMs}`,
        sanitizedAudit('web_session_created', command.nowMs, code.codeId),
      );
      return Object.freeze({ expiresAtMs, kind: 'created' as const });
    });
  }

  introspectWebSession(command: Readonly<{
    brokerRequestHash: string;
    currentSessionLookup: Readonly<import('../security/versionedHmac.js').HmacDigest>;
    nowMs: number;
    sessionLookups: readonly Readonly<import('../security/versionedHmac.js').HmacDigest>[];
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
      const match = candidates.find(({ value }) => parseStoredWebSession(value) !== null);
      const session = match ? parseStoredWebSession(match.value) : null;
      if (!match || !session || session.status !== 'active' || session.expiresAtMs <= command.nowMs) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      const grant = parseStoredClientGrant(
        await transaction.get(`${CLIENT_GRANT_PREFIX}/${session.subjectUid}`),
      );
      const code = parseStoredAccessCode(
        await transaction.get(`${ACCESS_CODE_PREFIX}/${session.codeId}`),
      );
      const resource = parseClientResource(
        await transaction.get(clientResourcePath(session.resourceId)),
      );
      if (
        !grant
        || grant.status !== 'active'
        || grant.expiresAtMs <= command.nowMs
        || !grant.resourceIds.includes(session.resourceId)
        || !code
        || code.status !== 'active'
        || code.expiresAtMs <= command.nowMs
        || code.subjectUid !== session.subjectUid
        || !resource
      ) return Object.freeze({ kind: 'invalid' as const });
      if (match.lookup.lookupId !== command.currentSessionLookup.lookupId) {
        const currentValue = candidates.find(
          ({ lookup }) => lookup.lookupId === command.currentSessionLookup.lookupId,
        )?.value;
        if (currentValue !== undefined) throw new Error('web_session_lookup_collision');
        transaction.create(
          `${WEB_SESSION_PREFIX}/${command.currentSessionLookup.lookupId}`,
          Object.freeze({
            ...session,
            hashVersion: command.currentSessionLookup.version,
            updatedAtMs: command.nowMs,
          }),
        );
        transaction.delete(`${WEB_SESSION_PREFIX}/${match.lookup.lookupId}`);
      }
      writeBrokerRequest(transaction, command.brokerRequestHash, command.nowMs);
      return Object.freeze({
        entitlements: Object.freeze([session.resourceId]),
        expiresAtMs: session.expiresAtMs,
        kind: 'active' as const,
      });
    });
  }

  revokeWebSession(command: Readonly<{
    brokerRequestHash: string;
    nowMs: number;
    sessionLookups: readonly Readonly<import('../security/versionedHmac.js').HmacDigest>[];
  }>): Promise<'revoked' | 'invalid'> {
    return this.#database.runTransaction(async (transaction) => {
      if (!await brokerRequestIsFresh(transaction, command.brokerRequestHash)) return 'invalid';
      const candidates = await Promise.all(command.sessionLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${WEB_SESSION_PREFIX}/${lookup.lookupId}`),
      })));
      const match = candidates.find(({ value }) => parseStoredWebSession(value) !== null);
      const session = match ? parseStoredWebSession(match.value) : null;
      if (!match || !session || session.status !== 'active') return 'invalid';
      transaction.set(`${WEB_SESSION_PREFIX}/${match.lookup.lookupId}`, Object.freeze({
        ...session,
        status: 'revoked',
        updatedAtMs: command.nowMs,
      }));
      writeBrokerRequest(transaction, command.brokerRequestHash, command.nowMs);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/web_revoke_${match.lookup.digest.slice(0, 20)}_${command.nowMs}`,
        sanitizedAudit('web_session_revoked', command.nowMs, session.codeId),
      );
      return 'revoked';
    });
  }

  redeem(command: Readonly<RedeemCommand>): Promise<RedemptionResult> {
    return this.#database.runTransaction(async (transaction) => {
      const rateLimits = await Promise.all(command.rateLimitBuckets.map(async (bucket) => ({
        bucket,
        path: `${RATE_LIMIT_PREFIX}/${bucket.lookupId}`,
        value: parseRateLimit(await transaction.get(`${RATE_LIMIT_PREFIX}/${bucket.lookupId}`)),
      })));
      const blocked = rateLimits.find(({ value }) => value && value.blockedUntilMs > command.nowMs);
      if (blocked?.value) {
        return Object.freeze({
          kind: 'rate_limited' as const,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((blocked.value.blockedUntilMs - command.nowMs) / 1_000),
          ),
        });
      }
      const requestPath = `${REDEMPTION_REQUEST_PREFIX}/${command.requestIdHash}`;
      const requestRecord = parseRedemptionRequest(await transaction.get(requestPath));

      const lookupDocuments = await Promise.all(command.codeLookups.map(async (lookup) => ({
        lookup,
        value: await transaction.get(`${ACCESS_CODE_LOOKUP_PREFIX}/${lookup.lookupId}`),
      })));
      const match = lookupDocuments.find(({ value }) => isLookupDocument(value));
      if (!match || !isLookupDocument(match.value)) {
        writeFailedAttempts(transaction, rateLimits, command.nowMs);
        return Object.freeze({ kind: 'invalid' as const });
      }

      const codePath = `${ACCESS_CODE_PREFIX}/${match.value.codeId}`;
      const storedCode = parseStoredAccessCode(await transaction.get(codePath));
      if (
        !storedCode
        || storedCode.status !== 'active'
        || storedCode.expiresAtMs <= command.nowMs
      ) {
        writeFailedAttempts(transaction, rateLimits, command.nowMs);
        return Object.freeze({ kind: 'invalid' as const });
      }

      const acceptedInstallations = new Set(
        command.installationHashes.map(({ lookupId }) => lookupId),
      );
      if (
        storedCode.boundInstallationLookupId !== null
        && !acceptedInstallations.has(storedCode.boundInstallationLookupId)
      ) {
        writeFailedAttempts(transaction, rateLimits, command.nowMs);
        return Object.freeze({ kind: 'invalid' as const });
      }

      const resourceDocuments = await Promise.all(storedCode.resourceIds.map(async (resourceId) => (
        transaction.get(clientResourcePath(resourceId))
      )));
      const resources = resourceDocuments.map(parseClientResource);
      if (resources.some((resource) => resource === null)) {
        writeFailedAttempts(transaction, rateLimits, command.nowMs);
        return Object.freeze({ kind: 'invalid' as const });
      }

      const currentInstallationLookupId = command.currentInstallationHash.lookupId;
      const subjectUid = storedCode.subjectUid ?? createSubjectUid(
        storedCode.codeId,
        currentInstallationLookupId,
      );
      const grant: Readonly<ClientGrantView> = Object.freeze({
        expiresAtMs: storedCode.expiresAtMs,
        resources: Object.freeze(resources as Readonly<ClientResourceView>[]),
        schemaVersion: 1,
        status: 'active',
      });
      const isIdempotentRetry = requestRecord !== null
        && requestRecord.expiresAtMs > command.nowMs
        && requestRecord.codeId === storedCode.codeId
        && requestRecord.subjectUid === subjectUid;
      if (requestRecord !== null && !isIdempotentRetry) {
        throw new Error('redemption_request_collision');
      }

      const currentLookupPath = `${ACCESS_CODE_LOOKUP_PREFIX}/${command.currentCodeLookup.lookupId}`;
      if (!isIdempotentRetry && match.lookup.lookupId !== command.currentCodeLookup.lookupId) {
        const currentLookup = lookupDocuments.find(
          ({ lookup }) => lookup.lookupId === command.currentCodeLookup.lookupId,
        )?.value;
        if (currentLookup !== undefined && !(
          isLookupDocument(currentLookup) && currentLookup.codeId === storedCode.codeId
        )) {
          throw new Error('access_code_lookup_collision');
        }
        if (currentLookup === undefined) {
          transaction.create(currentLookupPath, Object.freeze({
            codeId: storedCode.codeId,
            createdAtMs: command.nowMs,
            hashVersion: command.currentCodeLookup.version,
            schemaVersion: 1,
          }));
        }
        transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${match.lookup.lookupId}`);
      }

      if (!isIdempotentRetry) {
        transaction.set(codePath, Object.freeze({
          ...storedCode,
          boundInstallationLookupId: currentInstallationLookupId,
          hashVersion: command.currentCodeLookup.version,
          lookupId: command.currentCodeLookup.lookupId,
          redeemedAtMs: storedCode.redeemedAtMs ?? command.nowMs,
          subjectUid,
          updatedAtMs: command.nowMs,
        }));
        transaction.set(`${CLIENT_GRANT_PREFIX}/${subjectUid}`, Object.freeze({
          codeId: storedCode.codeId,
          expiresAtMs: storedCode.expiresAtMs,
          installationLookupId: currentInstallationLookupId,
          resourceIds: storedCode.resourceIds,
          schemaVersion: 1,
          status: 'active',
          updatedAtMs: command.nowMs,
        }));
        transaction.create(requestPath, Object.freeze({
          codeId: storedCode.codeId,
          expiresAtMs: command.nowMs + 5 * 60 * 1_000,
          schemaVersion: 1,
          status: 'completed',
          subjectUid,
        }));
      }
      for (const { bucket, path } of rateLimits) {
        if (bucket.clearOnSuccess) transaction.delete(path);
      }
      return Object.freeze({ kind: 'granted' as const, grant, subjectUid });
    });
  }
}

async function reconcileExpiredSlots(
  transaction: DocumentTransaction,
  nowMs: number,
  updateCounter = true,
): Promise<number> {
  parseCounter(await transaction.get(ACTIVE_CODE_COUNTER_PATH));
  const slotDocuments = await Promise.all([1, 2, 3, 4].map(async (slot) => ({
    path: `${CLIENT_SLOT_PREFIX}/${slot}`,
    slot,
    value: await transaction.get(`${CLIENT_SLOT_PREFIX}/${slot}`),
  })));
  const occupied = await Promise.all(slotDocuments.flatMap(({ path, slot, value }) => {
    if (value === undefined) return [];
    const slotDocument = parseSlotDocument(value, slot);
    if (!slotDocument) throw new Error('invalid_client_slot_record');
    return [transaction.get(`${ACCESS_CODE_PREFIX}/${slotDocument.codeId}`).then((codeValue) => {
      const code = parseStoredAccessCode(codeValue);
      if (!code || code.slot !== slot) throw new Error('invalid_client_slot_record');
      return Object.freeze({ code, path });
    })];
  }));
  const active = occupied.filter(({ code }) => (
    code.status === 'active' && code.expiresAtMs > nowMs
  ));
  const activeIds = new Set(active.map(({ code }) => code.codeId));
  const stale = occupied.filter(({ code }) => !activeIds.has(code.codeId));
  const staleGrants = await Promise.all(stale.map(async ({ code }) => ({
    code,
    grant: code.subjectUid
      ? await transaction.get(`${CLIENT_GRANT_PREFIX}/${code.subjectUid}`)
      : undefined,
  })));

  for (const { code, grant } of staleGrants) {
    transaction.set(`${ACCESS_CODE_PREFIX}/${code.codeId}`, Object.freeze({
      ...code,
      status: 'revoked',
      updatedAtMs: nowMs,
    }));
    transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${code.lookupId}`);
    transaction.delete(`${CLIENT_SLOT_PREFIX}/${code.slot}`);
    if (code.subjectUid && isRecord(grant)) {
      transaction.set(`${CLIENT_GRANT_PREFIX}/${code.subjectUid}`, Object.freeze({
        ...grant,
        status: 'revoked',
        updatedAtMs: nowMs,
      }));
    }
    transaction.create(
      `${AUDIT_EVENT_PREFIX}/expire_${code.codeId}_${nowMs}`,
      sanitizedAudit('access_code_expired', nowMs, code.codeId),
    );
  }
  if (updateCounter) writeActiveCodeCounter(transaction, active.length, nowMs);
  return active.length;
}

function writeActiveCodeCounter(
  transaction: DocumentTransaction,
  activeCount: number,
  nowMs: number,
): void {
  transaction.set(ACTIVE_CODE_COUNTER_PATH, Object.freeze({
    activeCount,
    schemaVersion: 1,
    updatedAtMs: nowMs,
  }));
}

function parseCounter(value: unknown): number {
  if (value === undefined) return 0;
  if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.activeCount)) {
    throw new Error('invalid_active_code_counter');
  }
  const activeCount = value.activeCount as number;
  if (activeCount < 0) throw new Error('invalid_active_code_counter');
  return activeCount;
}

function parseSlotDocument(
  value: unknown,
  expectedSlot: number,
): Readonly<{ codeId: string; slot: number }> | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.slot !== expectedSlot
    || typeof value.codeId !== 'string'
    || !/^ac_[A-Za-z0-9_-]{32}$/u.test(value.codeId)
  ) return null;
  return Object.freeze({ codeId: value.codeId, slot: expectedSlot });
}

function parseRateLimit(value: unknown): Readonly<StoredRateLimit> | null {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new Error('invalid_rate_limit_record');
  const candidate = value as Partial<StoredRateLimit>;
  if (
    candidate.schemaVersion !== 1
    || !isNonnegativeSafeInteger(candidate.blockedUntilMs)
    || !isNonnegativeSafeInteger(candidate.expiresAtMs)
    || !isNonnegativeSafeInteger(candidate.failures)
    || !isNonnegativeSafeInteger(candidate.windowStartedAtMs)
  ) throw new Error('invalid_rate_limit_record');
  return candidate as StoredRateLimit;
}

function writeFailedAttempts(
  transaction: DocumentTransaction,
  rateLimits: readonly Readonly<{
    bucket: Readonly<{ maximumFailures: number }>;
    path: string;
    value: Readonly<StoredRateLimit> | null;
  }>[],
  nowMs: number,
): void {
  for (const { bucket, path, value } of rateLimits) {
    writeFailedAttempt(transaction, path, value, nowMs, bucket.maximumFailures);
  }
}

function writeFailedAttempt(
  transaction: DocumentTransaction,
  ratePath: string,
  previous: Readonly<StoredRateLimit> | null,
  nowMs: number,
  maximumFailures: number,
): void {
  const withinWindow = previous !== null
    && previous.windowStartedAtMs + RATE_LIMIT_WINDOW_MS > nowMs;
  const failures = withinWindow ? previous.failures + 1 : 1;
  transaction.set(ratePath, Object.freeze({
    blockedUntilMs: failures >= maximumFailures ? nowMs + RATE_LIMIT_WINDOW_MS : 0,
    expiresAtMs: nowMs + 2 * RATE_LIMIT_WINDOW_MS,
    failures,
    schemaVersion: 1,
    windowStartedAtMs: withinWindow ? previous.windowStartedAtMs : nowMs,
  } satisfies StoredRateLimit));
}

function isLookupDocument(value: unknown): value is Readonly<{
  codeId: string;
  createdAtMs: number;
  hashVersion: string;
  schemaVersion: 1;
}> {
  return isRecord(value)
    && value.schemaVersion === 1
    && typeof value.codeId === 'string'
    && /^ac_[A-Za-z0-9_-]{32}$/u.test(value.codeId)
    && isNonnegativeSafeInteger(value.createdAtMs)
    && typeof value.hashVersion === 'string';
}

function parseStoredAccessCode(value: unknown): Readonly<StoredAccessCode> | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const candidate = value as Partial<StoredAccessCode>;
  if (
    typeof candidate.codeId !== 'string'
    || !isNonnegativeSafeInteger(candidate.createdAtMs)
    || typeof candidate.displaySuffix !== 'string'
    || !isNonnegativeSafeInteger(candidate.expiresAtMs)
    || typeof candidate.hashVersion !== 'string'
    || typeof candidate.lookupId !== 'string'
    || candidate.purpose !== 'cabohealth_client'
    || !Array.isArray(candidate.resourceIds)
    || candidate.resourceIds.some((id) => typeof id !== 'string')
    || !['active', 'revoked'].includes(candidate.status as string)
    || candidate.scope !== 'production_client'
    || ![1, 2, 3, 4].includes(candidate.slot as number)
    || !(candidate.boundInstallationLookupId === null || typeof candidate.boundInstallationLookupId === 'string')
    || !(candidate.redeemedAtMs === null || isNonnegativeSafeInteger(candidate.redeemedAtMs))
    || !(candidate.subjectUid === null || typeof candidate.subjectUid === 'string')
    || !isNonnegativeSafeInteger(candidate.updatedAtMs)
  ) return null;
  return candidate as StoredAccessCode;
}

function parseClientResource(value: unknown): Readonly<ClientResourceView> | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || value.status !== 'active'
    || value.access !== 'client'
    || typeof value.id !== 'string'
    || typeof value.iconKey !== 'string'
    || !isLocalizedText(value.title)
    || !isLocalizedText(value.summary)
  ) return null;
  return Object.freeze({
    access: 'client',
    iconKey: value.iconKey,
    id: value.id,
    summary: Object.freeze({ en: value.summary.en, es: value.summary.es }),
    title: Object.freeze({ en: value.title.en, es: value.title.es }),
  });
}

async function readLiveSession(
  transaction: DocumentTransaction,
  command: Readonly<ClientSessionCommand>,
  includeResources = true,
): Promise<Readonly<{
  code: Readonly<StoredAccessCode>;
  codePath: string;
  grant: Readonly<StoredClientGrant>;
  grantPath: string;
  view: Readonly<ClientGrantView>;
}> | null> {
  const grantPath = `${CLIENT_GRANT_PREFIX}/${command.subjectUid}`;
  const grant = parseStoredClientGrant(await transaction.get(grantPath));
  if (!grant || grant.status !== 'active' || grant.expiresAtMs <= command.nowMs) return null;
  const acceptedInstallations = new Set(command.installationHashes.map(({ lookupId }) => lookupId));
  if (!acceptedInstallations.has(grant.installationLookupId)) return null;
  const codePath = `${ACCESS_CODE_PREFIX}/${grant.codeId}`;
  const code = parseStoredAccessCode(await transaction.get(codePath));
  if (!code || code.status !== 'active' || code.expiresAtMs <= command.nowMs) return null;
  if (
    code.subjectUid !== command.subjectUid
    || code.boundInstallationLookupId === null
    || !acceptedInstallations.has(code.boundInstallationLookupId)
  ) return null;

  const resources = includeResources
    ? (await Promise.all(grant.resourceIds.map((resourceId) => (
      transaction.get(clientResourcePath(resourceId))
    )))).map(parseClientResource)
    : [];
  if (resources.some((resource) => resource === null)) return null;
  const view = Object.freeze({
    expiresAtMs: grant.expiresAtMs,
    resources: Object.freeze(resources as Readonly<ClientResourceView>[]),
    schemaVersion: 1 as const,
    status: 'active' as const,
  });
  return Object.freeze({ code, codePath, grant, grantPath, view });
}

function parseStoredClientGrant(value: unknown): Readonly<StoredClientGrant> | null {
  if (!isRecord(value)) return null;
  const candidate = value as Partial<StoredClientGrant>;
  if (
    candidate.schemaVersion !== 1
    || typeof candidate.codeId !== 'string'
    || !isNonnegativeSafeInteger(candidate.expiresAtMs)
    || typeof candidate.installationLookupId !== 'string'
    || !Array.isArray(candidate.resourceIds)
    || candidate.resourceIds.some((resourceId) => typeof resourceId !== 'string')
    || !['active', 'removed', 'revoked'].includes(candidate.status as string)
    || !isNonnegativeSafeInteger(candidate.updatedAtMs)
  ) return null;
  return candidate as StoredClientGrant;
}

function parseStoredLaunchNonce(value: unknown): Readonly<StoredLaunchNonce> | null {
  if (!isRecord(value)) return null;
  const candidate = value as Partial<StoredLaunchNonce>;
  if (
    candidate.schemaVersion !== 1
    || typeof candidate.codeId !== 'string'
    || !(candidate.consumedAtMs === null || isNonnegativeSafeInteger(candidate.consumedAtMs))
    || !isNonnegativeSafeInteger(candidate.expiresAtMs)
    || typeof candidate.hashVersion !== 'string'
    || typeof candidate.resourceId !== 'string'
    || typeof candidate.subjectUid !== 'string'
  ) return null;
  return candidate as StoredLaunchNonce;
}

function parseRedemptionRequest(value: unknown): Readonly<{
  codeId: string;
  expiresAtMs: number;
  subjectUid: string;
}> | null {
  if (value === undefined) return null;
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.status !== 'completed'
    || typeof value.codeId !== 'string'
    || !isNonnegativeSafeInteger(value.expiresAtMs)
    || typeof value.subjectUid !== 'string'
  ) throw new Error('invalid_redemption_request_record');
  return Object.freeze({
    codeId: value.codeId,
    expiresAtMs: value.expiresAtMs,
    subjectUid: value.subjectUid,
  });
}

function parseStoredWebSession(value: unknown): Readonly<StoredWebSession> | null {
  if (!isRecord(value)) return null;
  const candidate = value as Partial<StoredWebSession>;
  if (
    candidate.schemaVersion !== 1
    || typeof candidate.codeId !== 'string'
    || !isNonnegativeSafeInteger(candidate.createdAtMs)
    || !isNonnegativeSafeInteger(candidate.expiresAtMs)
    || typeof candidate.hashVersion !== 'string'
    || typeof candidate.resourceId !== 'string'
    || !['active', 'revoked'].includes(candidate.status as string)
    || typeof candidate.subjectUid !== 'string'
    || !isNonnegativeSafeInteger(candidate.updatedAtMs)
  ) return null;
  return candidate as StoredWebSession;
}

async function brokerRequestIsFresh(
  transaction: DocumentTransaction,
  brokerRequestHash: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{24,128}$/u.test(brokerRequestHash)) return false;
  return await transaction.get(`${BROKER_REQUEST_PREFIX}/${brokerRequestHash}`) === undefined;
}

function writeBrokerRequest(
  transaction: DocumentTransaction,
  brokerRequestHash: string,
  nowMs: number,
): void {
  transaction.create(`${BROKER_REQUEST_PREFIX}/${brokerRequestHash}`, Object.freeze({
    expiresAtMs: nowMs + 2 * 60 * 1_000,
    occurredAtMs: nowMs,
    schemaVersion: 1,
  }));
}

function sanitizedAudit(eventType: string, occurredAtMs: number, codeId?: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...(codeId ? { codeId } : {}),
    eventType,
    occurredAtMs,
    schemaVersion: 1,
  });
}

function subjectAuditId(subjectUid: string): string {
  return createHash('sha256')
    .update('cabohealth/audit-subject/v1\0', 'utf8')
    .update(subjectUid, 'utf8')
    .digest('base64url')
    .slice(0, 24);
}

function isLocalizedText(value: unknown): value is { en: string; es: string } {
  return isRecord(value)
    && typeof value.en === 'string'
    && value.en.length > 0
    && value.en.length <= 240
    && typeof value.es === 'string'
    && value.es.length > 0
    && value.es.length <= 240;
}

function createSubjectUid(codeId: string, installationLookupId: string): string {
  const digest = createHash('sha256')
    .update('cabohealth/client-subject/v1\0', 'utf8')
    .update(codeId, 'utf8')
    .update('\0', 'utf8')
    .update(installationLookupId, 'utf8')
    .digest('base64url');
  return `client_${digest.slice(0, 32)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
