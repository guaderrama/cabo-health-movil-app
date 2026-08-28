import { createHash } from 'node:crypto';

import {
  type AccessCodeCreateRecord,
  type AccessCodeStore,
} from '../domain/accessCodeIssuer.js';
import {
  type ClientResourceView,
  type ClientResourceResolutionMode,
  type RedeemCommand,
  type RedemptionResult,
  type RedemptionStore,
  type VersionedClientGrantView,
} from '../domain/clientAccessRedeemer.js';
import {
  type ClientAccountDeletionCommand,
  type ClientAccountDeletionStore,
} from '../domain/clientAccountDeletion.js';
import {
  ACCOUNT_DELETION_EXPECTED_COMPLETION_MS,
  COMPLETED_DELETION_RECEIPT_RETENTION_MS,
  type AccountDeletionReceiptStatus,
} from '../domain/accountDeletionReceipt.js';
import {
  type ClientSessionCommand,
  type ClientSessionStore,
} from '../domain/clientSessionManager.js';
import {
  type ClientLaunchStore,
  type ConsumeLaunchCommand,
  type CreateLaunchCommand,
} from '../domain/clientLaunchService.js';
import {
  CATALOG_ID_PATTERN,
  isPermanentlyRetiredCatalogId,
} from '../domain/catalogAdmin.js';
import {
  EXTERNAL_CATALOG_ID_PATTERN,
  isLegacyCompatibleCatalogUrl,
  parseSafeCatalogUrl,
} from '../domain/catalogUrlPolicy.js';
import { type WebSessionStore } from '../domain/webSessionBroker.js';
import type { HmacDigest } from '../security/versionedHmac.js';

const ACCESS_CODE_PREFIX = '_private_access_codes';
const ACCESS_CODE_LOOKUP_PREFIX = '_private_access_code_lookups';
const CLIENT_GRANT_PREFIX = '_private_client_grants';
const CLIENT_RESOURCE_PREFIX = '_private_client_resources';
const RATE_LIMIT_PREFIX = '_private_rate_limits';
const REDEMPTION_REQUEST_PREFIX = '_private_redemption_requests';
const AUDIT_EVENT_PREFIX = '_private_audit_events';
const LAUNCH_NONCE_PREFIX = '_private_launch_nonces';
const WEB_SESSION_PREFIX = '_private_web_sessions';
const BROKER_REQUEST_PREFIX = '_private_broker_requests';
const ACCOUNT_DELETION_PREFIX = '_private_account_deletions';
const ACCOUNT_DELETION_RECEIPT_PREFIX = '_private_account_deletion_receipts';
const CATALOG_PATH = '_private_catalog/current';
const CLIENT_RESOURCE_GROUP_MARKER = 'client-resources';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const DELETION_ARTIFACT_BATCH_LIMIT = 400;
const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CATALOG_ITEMS = 12;

const CATALOG_ICONS = new Set([
  'laboratory',
  'guide',
  'nutrition',
  'recipes',
  'wellness',
  'location',
  'contact',
  'featured',
]);

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
  readonly status: 'active' | 'revoked';
}

interface StoredAccessCodeCommon extends Omit<AccessCodeCreateRecord, 'status'> {
  readonly boundInstallationLookupId: string | null;
  readonly redeemedAtMs: number | null;
  readonly subjectUid: string | null;
  readonly updatedAtMs: number;
  readonly status: 'active' | 'revoked';
}

type StoredAccessCode = Readonly<
  | (StoredAccessCodeCommon & {
    readonly schemaVersion: 1;
    readonly slot: 1 | 2 | 3 | 4;
  })
  | (StoredAccessCodeCommon & {
    readonly schemaVersion: 2;
    readonly slot?: never;
  })
>;

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
  readonly rateLimitLookupIds: readonly string[];
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

interface StoredAccountDeletion {
  readonly attempts: number;
  readonly cleanupCompletedAtMs: number | null;
  readonly codeId: string;
  readonly createdAtMs: number;
  readonly deletionReceiptLookupId: string | null;
  readonly installationLookupId: string;
  readonly lastAttemptAtMs: number | null;
  readonly rateLimitLookupIds: readonly string[];
  readonly schemaVersion: 1;
  readonly status: 'pending';
  readonly subjectUid: string;
  readonly updatedAtMs: number;
}

type StoredAccountDeletionReceipt = Readonly<{
  readonly completedAtMs: null;
  readonly expectedCompletionByMs: number;
  readonly hashVersion: string;
  readonly requestedAtMs: number;
  readonly schemaVersion: 1;
  readonly status: 'pending';
} | {
  readonly completedAtMs: number;
  readonly expectedCompletionByMs: number;
  readonly expiresAtMs: number;
  readonly requestedAtMs: number;
  readonly schemaVersion: 1;
  readonly status: 'completed';
}>;

export function clientResourcePath(resourceId: string): string {
  return `${CLIENT_RESOURCE_PREFIX}/${resourceId}`;
}

export class FirestoreClientAccessStore implements AccessCodeStore, RedemptionStore, ClientSessionStore, ClientLaunchStore, WebSessionStore, ClientAccountDeletionStore {
  readonly #database: DocumentDatabase;

  constructor(database: DocumentDatabase) {
    this.#database = database;
  }

  createActiveCode(
    record: AccessCodeCreateRecord,
  ): Promise<'created' | 'collision' | 'invalid_resource'> {
    return this.#database.runTransaction(async (transaction) => {
      const resources = await resolveClientResources(transaction, record.resourceIds, 'v2_all');
      if (resources === null) return 'invalid_resource';
      const lookupPath = `${ACCESS_CODE_LOOKUP_PREFIX}/${record.lookupId}`;
      const codePath = `${ACCESS_CODE_PREFIX}/${record.codeId}`;
      const [existingLookup, existingCode] = await Promise.all([
        transaction.get(lookupPath),
        transaction.get(codePath),
      ]);
      if (existingLookup !== undefined || existingCode !== undefined) return 'collision';

      const storedCode: Readonly<StoredAccessCode> = Object.freeze({
        ...record,
        boundInstallationLookupId: null,
        redeemedAtMs: null,
        schemaVersion: 2,
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
      const createdEventId = staffAuditEventId('client_code.created', record.codeId, record.createdAtMs);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/${createdEventId}`,
        staffAudit(
          createdEventId,
          'client_code.created',
          record.displaySuffix,
          record.createdAtMs,
        ),
      );
      return 'created';
    });
  }

  async listAccessCodes(nowMs: number): Promise<readonly Readonly<AdminAccessCodeSummary>[]> {
    if (!isNonnegativeSafeInteger(nowMs)) throw new Error('invalid_reconciliation_time');
    await this.reconcileExpiredClientAccess(nowMs);
    const documents = await this.#database.listCollection(ACCESS_CODE_PREFIX);
    const summaries = documents.flatMap(({ value }) => {
      const code = parseStoredAccessCode(value);
      if (!code) throw new Error('invalid_access_code_record');
      return [Object.freeze({
        codeId: code.codeId,
        createdAtMs: code.createdAtMs,
        displaySuffix: code.displaySuffix,
        expiresAtMs: code.expiresAtMs,
        status: code.status,
      })];
    });
    return Object.freeze(summaries
      .filter(({ status }) => status === 'active')
      .sort((left, right) => right.createdAtMs - left.createdAtMs));
  }

  async reconcileExpiredClientAccess(nowMs: number): Promise<void> {
    if (!isNonnegativeSafeInteger(nowMs)) throw new Error('invalid_reconciliation_time');
    const documents = await this.#database.listCollection(ACCESS_CODE_PREFIX);
    const expiredCodeIds = documents.flatMap(({ value }) => {
      const code = parseStoredAccessCode(value);
      if (!code) throw new Error('invalid_access_code_record');
      return code.status === 'active' && code.expiresAtMs <= nowMs ? [code.codeId] : [];
    });
    for (const codeId of expiredCodeIds) {
      await this.#database.runTransaction(async (transaction) => {
        await expireAccessCode(transaction, codeId, nowMs);
      });
    }
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
      const parsedGrant = parseStoredClientGrant(grant);
      const deletionPath = code?.subjectUid
        ? `${ACCOUNT_DELETION_PREFIX}/${code.subjectUid}`
        : null;
      const deletionValue = deletionPath ? await transaction.get(deletionPath) : undefined;
      const deletion = parseStoredAccountDeletion(deletionValue);
      if (grant !== undefined && !parsedGrant) throw new Error('invalid_client_grant_record');
      if (deletionValue !== undefined && !deletion) {
        throw new Error('invalid_account_deletion_record');
      }
      if (code?.status === 'revoked' && code.subjectUid && deletion) {
        if (
          deletion.subjectUid !== code.subjectUid
          || deletion.codeId !== code.codeId
        ) throw new Error('invalid_account_deletion_record');
        return Object.freeze({
          kind: 'revoked' as const,
          subjectUid: code.subjectUid,
        });
      }
      if (!code || code.status !== 'active') {
        return Object.freeze({ kind: 'not_active' as const });
      }
      if (code.expiresAtMs <= nowMs) {
        await expireAccessCode(transaction, code.codeId, nowMs);
        return Object.freeze({ kind: 'not_active' as const });
      }

      transaction.set(codePath, Object.freeze({
        ...code,
        status: 'revoked',
        updatedAtMs: nowMs,
      }));
      transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${code.lookupId}`);
      if (grantPath && parsedGrant) {
        transaction.set(grantPath, Object.freeze({
          ...parsedGrant,
          status: 'revoked',
          updatedAtMs: nowMs,
        }));
      }
      if (code.subjectUid) {
        if (!parsedGrant || !deletionPath) throw new Error('invalid_client_grant_record');
        if (deletion === null) {
          transaction.create(deletionPath, Object.freeze({
            attempts: 0,
            cleanupCompletedAtMs: null,
            codeId: code.codeId,
            createdAtMs: nowMs,
            deletionReceiptLookupId: null,
            installationLookupId: parsedGrant.installationLookupId,
            lastAttemptAtMs: null,
            rateLimitLookupIds: parsedGrant.rateLimitLookupIds,
            schemaVersion: 1,
            status: 'pending',
            subjectUid: code.subjectUid,
            updatedAtMs: nowMs,
          } satisfies StoredAccountDeletion));
          transaction.create(
            `${AUDIT_EVENT_PREFIX}/delete_request_${subjectAuditId(code.subjectUid)}_${nowMs}`,
            sanitizedAudit('client_account_deletion_requested', nowMs),
          );
        }
      }
      const revokedEventId = staffAuditEventId('client_code.revoked', codeId, nowMs);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/${revokedEventId}`,
        staffAudit(revokedEventId, 'client_code.revoked', code.displaySuffix, nowMs),
      );
      return Object.freeze({ kind: 'revoked' as const, subjectUid: code.subjectUid });
    });
  }

  refreshSession(command: Readonly<ClientSessionCommand>): Promise<
    Readonly<{ kind: 'active'; grant: Readonly<VersionedClientGrantView> } | { kind: 'invalid' }>
  > {
    return this.#database.runTransaction(async (transaction) => {
      const session = await readLiveSession(
        transaction,
        command,
        command.resourceResolutionMode,
      );
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
      const deletionPath = `${ACCOUNT_DELETION_PREFIX}/${command.subjectUid}`;
      const deletionValue = await transaction.get(deletionPath);
      const deletion = parseStoredAccountDeletion(deletionValue);
      if (deletionValue !== undefined) {
        if (!deletion) throw new Error('invalid_account_deletion_record');
        const acceptedInstallations = new Set(
          command.installationHashes.map(({ lookupId }) => lookupId),
        );
        return Object.freeze({
          kind: deletion.subjectUid === command.subjectUid
            && acceptedInstallations.has(deletion.installationLookupId)
            ? 'removed' as const
            : 'invalid' as const,
        });
      }
      const session = await readLiveSession(
        transaction,
        command,
        command.resourceResolutionMode,
        false,
      );
      if (!session) return Object.freeze({ kind: 'invalid' as const });
      transaction.create(deletionPath, Object.freeze({
        attempts: 0,
        cleanupCompletedAtMs: null,
        codeId: session.code.codeId,
        createdAtMs: command.nowMs,
        deletionReceiptLookupId: null,
        installationLookupId: session.grant.installationLookupId,
        lastAttemptAtMs: null,
        rateLimitLookupIds: session.grant.rateLimitLookupIds,
        schemaVersion: 1,
        status: 'pending',
        subjectUid: command.subjectUid,
        updatedAtMs: command.nowMs,
      } satisfies StoredAccountDeletion));
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
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/remove_${session.code.codeId}_${command.nowMs}`,
        sanitizedAudit('client_access_removed', command.nowMs, session.code.codeId),
      );
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/delete_request_${subjectAuditId(command.subjectUid)}_${command.nowMs}`,
        sanitizedAudit('client_account_deletion_requested', command.nowMs),
      );
      return Object.freeze({ kind: 'removed' as const });
    });
  }

  beginAccountDeletion(command: Readonly<ClientAccountDeletionCommand>): Promise<
    Readonly<{ kind: 'accepted' } | { kind: 'invalid' }>
  > {
    const deletionPath = `${ACCOUNT_DELETION_PREFIX}/${command.subjectUid}`;
    return this.#database.runTransaction(async (transaction) => {
      const existingValue = await transaction.get(deletionPath);
      const existing = parseStoredAccountDeletion(existingValue);
      if (existingValue !== undefined && !existing) {
        throw new Error('invalid_account_deletion_record');
      }
      const acceptedInstallations = new Set(
        command.installationHashes.map(({ lookupId }) => lookupId),
      );
      const acceptedReceiptLookups = new Set(
        command.deletionReceiptLookups.map(({ lookupId }) => lookupId),
      );
      if (existing) {
        if (
          existing.subjectUid !== command.subjectUid
          || !acceptedInstallations.has(existing.installationLookupId)
        ) return Object.freeze({ kind: 'invalid' as const });
        if (existing.deletionReceiptLookupId === null) {
          const candidates = await readDeletionReceiptCandidates(
            transaction,
            command.deletionReceiptLookups,
          );
          if (candidates.some(({ value }) => value !== undefined)) {
            return Object.freeze({ kind: 'invalid' as const });
          }
          transaction.set(deletionPath, Object.freeze({
            ...existing,
            deletionReceiptLookupId: command.currentDeletionReceiptLookup.lookupId,
            updatedAtMs: command.nowMs,
          } satisfies StoredAccountDeletion));
          transaction.create(
            `${ACCOUNT_DELETION_RECEIPT_PREFIX}/${command.currentDeletionReceiptLookup.lookupId}`,
            pendingDeletionReceipt(command.currentDeletionReceiptLookup, command.nowMs),
          );
          return Object.freeze({ kind: 'accepted' as const });
        }
        const receiptPath = `${ACCOUNT_DELETION_RECEIPT_PREFIX}/${existing.deletionReceiptLookupId}`;
        const receiptValue = await transaction.get(receiptPath);
        const receipt = parseStoredAccountDeletionReceipt(receiptValue);
        if (receiptValue !== undefined && !receipt) {
          throw new Error('invalid_account_deletion_receipt_record');
        }
        if (
          !acceptedReceiptLookups.has(existing.deletionReceiptLookupId)
          || receipt?.status !== 'pending'
        ) return Object.freeze({ kind: 'invalid' as const });
        return Object.freeze({ kind: 'accepted' as const });
      }
      const receiptCandidates = await readDeletionReceiptCandidates(
        transaction,
        command.deletionReceiptLookups,
      );
      if (receiptCandidates.some(({ value }) => value !== undefined)) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      const receiptPath = `${ACCOUNT_DELETION_RECEIPT_PREFIX}/${command.currentDeletionReceiptLookup.lookupId}`;

      const grantPath = `${CLIENT_GRANT_PREFIX}/${command.subjectUid}`;
      const grant = parseStoredClientGrant(await transaction.get(grantPath));
      if (!grant || !acceptedInstallations.has(grant.installationLookupId)) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      const codePath = `${ACCESS_CODE_PREFIX}/${grant.codeId}`;
      const code = parseStoredAccessCode(await transaction.get(codePath));
      if (
        !code
        || code.subjectUid !== command.subjectUid
        || code.boundInstallationLookupId === null
        || !acceptedInstallations.has(code.boundInstallationLookupId)
      ) return Object.freeze({ kind: 'invalid' as const });
      transaction.create(deletionPath, Object.freeze({
        attempts: 0,
        cleanupCompletedAtMs: null,
        codeId: code.codeId,
        createdAtMs: command.nowMs,
        deletionReceiptLookupId: command.currentDeletionReceiptLookup.lookupId,
        installationLookupId: command.currentInstallationHash.lookupId,
        lastAttemptAtMs: null,
        rateLimitLookupIds: grant.rateLimitLookupIds,
        schemaVersion: 1,
        status: 'pending',
        subjectUid: command.subjectUid,
        updatedAtMs: command.nowMs,
      } satisfies StoredAccountDeletion));
      transaction.create(
        receiptPath,
        pendingDeletionReceipt(command.currentDeletionReceiptLookup, command.nowMs),
      );
      transaction.set(codePath, Object.freeze({
        ...code,
        status: 'revoked',
        updatedAtMs: command.nowMs,
      }));
      transaction.set(grantPath, Object.freeze({
        ...grant,
        status: 'revoked',
        updatedAtMs: command.nowMs,
      }));
      transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${code.lookupId}`);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/delete_request_${subjectAuditId(command.subjectUid)}_${command.nowMs}`,
        sanitizedAudit('client_account_deletion_requested', command.nowMs),
      );
      return Object.freeze({ kind: 'accepted' as const });
    });
  }

  async purgeAccountDeletionArtifacts(
    subjectUid: string,
    nowMs: number,
  ): Promise<Readonly<{ kind: 'missing' | 'more' | 'ready' }>> {
    const deletionPath = `${ACCOUNT_DELETION_PREFIX}/${subjectUid}`;
    const deletion = await this.#database.runTransaction(async (transaction) => (
      parseStoredAccountDeletion(await transaction.get(deletionPath))
    ));
    if (!deletion || deletion.subjectUid !== subjectUid) {
      return Object.freeze({ kind: 'missing' as const });
    }
    const collections = await Promise.all([
      this.#database.listCollection(LAUNCH_NONCE_PREFIX),
      this.#database.listCollection(WEB_SESSION_PREFIX),
      this.#database.listCollection(REDEMPTION_REQUEST_PREFIX),
    ]);
    const candidates = [
      ...collections[0].flatMap(({ id, value }) => {
        return recordReferencesDeletion(value, deletion)
          ? [`${LAUNCH_NONCE_PREFIX}/${id}`]
          : [];
      }),
      ...collections[1].flatMap(({ id, value }) => {
        return recordReferencesDeletion(value, deletion)
          ? [`${WEB_SESSION_PREFIX}/${id}`]
          : [];
      }),
      ...collections[2].flatMap(({ id, value }) => {
        return recordReferencesDeletion(value, deletion)
          ? [`${REDEMPTION_REQUEST_PREFIX}/${id}`]
          : [];
      }),
      ...deletion.rateLimitLookupIds.map((lookupId) => `${RATE_LIMIT_PREFIX}/${lookupId}`),
    ];
    const batch = candidates.slice(0, DELETION_ARTIFACT_BATCH_LIMIT);
    const hasMore = candidates.length > batch.length;
    return this.#database.runTransaction(async (transaction) => {
      const currentDeletion = parseStoredAccountDeletion(await transaction.get(deletionPath));
      if (!currentDeletion || currentDeletion.subjectUid !== subjectUid) {
        return Object.freeze({ kind: 'missing' as const });
      }
      const currentArtifacts = await Promise.all(batch.map(async (path) => Object.freeze({
        path,
        value: await transaction.get(path),
      })));
      for (const artifact of currentArtifacts) {
        if (deletionArtifactBelongsTo(artifact.path, artifact.value, currentDeletion)) {
          transaction.delete(artifact.path);
        }
      }
      transaction.set(deletionPath, Object.freeze({
        ...currentDeletion,
        cleanupCompletedAtMs: hasMore ? null : nowMs,
        updatedAtMs: nowMs,
      }));
      return Object.freeze({ kind: hasMore ? 'more' as const : 'ready' as const });
    });
  }

  markAccountDeletionAttemptFailed(subjectUid: string, nowMs: number): Promise<void> {
    const deletionPath = `${ACCOUNT_DELETION_PREFIX}/${subjectUid}`;
    return this.#database.runTransaction(async (transaction) => {
      const deletion = parseStoredAccountDeletion(await transaction.get(deletionPath));
      if (!deletion || deletion.subjectUid !== subjectUid) return;
      transaction.set(deletionPath, Object.freeze({
        ...deletion,
        attempts: deletion.attempts + 1,
        lastAttemptAtMs: nowMs,
        updatedAtMs: nowMs,
      }));
    });
  }

  completeAccountDeletion(subjectUid: string, nowMs: number): Promise<
    Readonly<{ kind: 'completed' } | { kind: 'not_ready' }>
  > {
    const deletionPath = `${ACCOUNT_DELETION_PREFIX}/${subjectUid}`;
    return this.#database.runTransaction(async (transaction) => {
      const deletion = parseStoredAccountDeletion(await transaction.get(deletionPath));
      if (
        !deletion
        || deletion.subjectUid !== subjectUid
        || deletion.cleanupCompletedAtMs === null
      ) return Object.freeze({ kind: 'not_ready' as const });
      const codePath = `${ACCESS_CODE_PREFIX}/${deletion.codeId}`;
      const grantPath = `${CLIENT_GRANT_PREFIX}/${subjectUid}`;
      const receiptPath = deletion.deletionReceiptLookupId === null
        ? null
        : `${ACCOUNT_DELETION_RECEIPT_PREFIX}/${deletion.deletionReceiptLookupId}`;
      const [code, grant, receiptValue] = await Promise.all([
        transaction.get(codePath),
        transaction.get(grantPath),
        receiptPath ? transaction.get(receiptPath) : undefined,
      ]);
      const parsedCode = parseStoredAccessCode(code);
      const parsedGrant = parseStoredClientGrant(grant);
      const receipt = parseStoredAccountDeletionReceipt(receiptValue);
      if (code !== undefined && !parsedCode) throw new Error('invalid_access_code_record');
      if (grant !== undefined && !parsedGrant) throw new Error('invalid_client_grant_record');
      if (receiptPath && (!receipt || receipt.status !== 'pending')) {
        throw new Error('invalid_account_deletion_receipt_record');
      }
      if (
        parsedCode
        && (
          parsedCode.codeId !== deletion.codeId
          || parsedCode.subjectUid !== subjectUid
          || parsedCode.status !== 'revoked'
        )
      ) throw new Error('invalid_access_code_record');
      if (
        parsedGrant
        && (
          parsedGrant.codeId !== deletion.codeId
          || parsedGrant.status === 'active'
        )
      ) throw new Error('invalid_client_grant_record');
      if (parsedCode?.lookupId) {
        transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${parsedCode.lookupId}`);
      }
      if (parsedCode) transaction.delete(codePath);
      if (parsedGrant) transaction.delete(grantPath);
      if (receiptPath && receipt?.status === 'pending') {
        transaction.set(receiptPath, Object.freeze({
          completedAtMs: nowMs,
          expectedCompletionByMs: receipt.expectedCompletionByMs,
          expiresAtMs: nowMs + COMPLETED_DELETION_RECEIPT_RETENTION_MS,
          requestedAtMs: receipt.requestedAtMs,
          schemaVersion: 1,
          status: 'completed',
        } satisfies StoredAccountDeletionReceipt));
      }
      transaction.delete(deletionPath);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/delete_complete_${subjectAuditId(subjectUid)}_${nowMs}`,
        sanitizedAudit('client_account_deletion_completed', nowMs),
      );
      return Object.freeze({ kind: 'completed' as const });
    });
  }

  async findAccountDeletionReceiptStatus(
    receiptLookups: readonly Readonly<HmacDigest>[],
  ): Promise<AccountDeletionReceiptStatus | null> {
    if (receiptLookups.length < 1) return null;
    return this.#database.runTransaction(async (transaction) => {
      const candidates = await Promise.all(receiptLookups.map(async (lookup) => ({
        value: await transaction.get(`${ACCOUNT_DELETION_RECEIPT_PREFIX}/${lookup.lookupId}`),
      })));
      const matches = candidates.flatMap(({ value }) => {
        if (value === undefined) return [];
        const receipt = parseStoredAccountDeletionReceipt(value);
        if (!receipt) throw new Error('invalid_account_deletion_receipt_record');
        return [receipt];
      });
      if (matches.length === 0) return null;
      if (matches.length !== 1) throw new Error('ambiguous_account_deletion_receipt');
      return accountDeletionReceiptView(matches[0]!);
    });
  }

  async listPendingAccountDeletions(limit: number): Promise<Readonly<{
    malformed: number;
    subjectUids: readonly string[];
  }>> {
    const documents = await this.#database.listCollection(ACCOUNT_DELETION_PREFIX);
    const parsed = documents.map(({ id, value }) => {
      const deletion = parseStoredAccountDeletion(value);
      return deletion?.subjectUid === id ? deletion : null;
    });
    const subjectUids = parsed
      .filter((value): value is Readonly<StoredAccountDeletion> => value !== null)
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .slice(0, limit)
      .map(({ subjectUid }) => subjectUid);
    return Object.freeze({
      malformed: parsed.filter((value) => value === null).length,
      subjectUids: Object.freeze(subjectUids),
    });
  }

  createLaunch(command: Readonly<CreateLaunchCommand>): Promise<'created' | 'invalid'> {
    return this.#database.runTransaction(async (transaction) => {
      const session = await readLiveSession(transaction, command, 'legacy_cabohealth');
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

  createLaunchV2(command: Readonly<CreateLaunchCommand>): Promise<Readonly<
    | { kind: 'broker'; expiresAtMs: number }
    | { kind: 'external_https'; expiresAtMs: number; url: string }
    | { kind: 'invalid' }
  >> {
    return this.#database.runTransaction(async (transaction) => {
      const session = await readLiveSession(transaction, command, 'v2_all');
      if (!session || !session.view.resources.some(({ id }) => id === command.resourceId)) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      const expiresAtMs = Math.min(
        command.expiresAtMs,
        session.grant.expiresAtMs,
        session.code.expiresAtMs,
      );
      if (expiresAtMs <= command.nowMs) return Object.freeze({ kind: 'invalid' as const });

      if (EXTERNAL_CATALOG_ID_PATTERN.test(command.resourceId)) {
        const catalog = parseCatalogClientItems(await transaction.get(CATALOG_PATH));
        const item = catalog?.find(({ access, active, id }) => (
          access === 'clients' && active && id === command.resourceId
        ));
        const target = item ? parseSafeCatalogUrl(item.url) : null;
        if (!item || !target || target.kind !== 'external_https' || target.url !== item.url) {
          return Object.freeze({ kind: 'invalid' as const });
        }
        transaction.create(
          `${AUDIT_EVENT_PREFIX}/external_launch_${command.nonceLookup.digest.slice(0, 20)}_${command.nowMs}`,
          sanitizedAudit('client_external_launch_created', command.nowMs, session.code.codeId),
        );
        return Object.freeze({
          kind: 'external_https' as const,
          expiresAtMs,
          url: target.url,
        });
      }

      const noncePath = `${LAUNCH_NONCE_PREFIX}/${command.nonceLookup.lookupId}`;
      if (await transaction.get(noncePath) !== undefined) {
        return Object.freeze({ kind: 'invalid' as const });
      }
      transaction.create(noncePath, Object.freeze({
        codeId: session.code.codeId,
        consumedAtMs: null,
        expiresAtMs,
        hashVersion: command.nonceLookup.version,
        resourceId: command.resourceId,
        schemaVersion: 1,
        subjectUid: command.subjectUid,
      } satisfies StoredLaunchNonce));
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/launch_${command.nonceLookup.digest.slice(0, 20)}_${command.nowMs}`,
        sanitizedAudit('client_launch_created', command.nowMs, session.code.codeId),
      );
      return Object.freeze({ kind: 'broker' as const, expiresAtMs });
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
      const resources = grant
        ? await resolveClientResources(transaction, grant.resourceIds, 'legacy_cabohealth')
        : null;
      if (
        !grant
        || grant.status !== 'active'
        || grant.expiresAtMs <= command.nowMs
        || resources === null
        || !resources.some(({ id }) => id === nonce.resourceId)
        || !code
        || code.status !== 'active'
        || code.expiresAtMs <= command.nowMs
        || code.subjectUid !== nonce.subjectUid
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
      const resources = grant
        ? await resolveClientResources(transaction, grant.resourceIds, 'legacy_cabohealth')
        : null;
      if (
        !grant
        || grant.status !== 'active'
        || grant.expiresAtMs <= command.nowMs
        || resources === null
        || !resources.some(({ id }) => id === nonce.resourceId)
        || !code
        || code.status !== 'active'
        || code.expiresAtMs <= command.nowMs
        || code.subjectUid !== nonce.subjectUid
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
      const resources = grant
        ? await resolveClientResources(transaction, grant.resourceIds, 'legacy_cabohealth')
        : null;
      if (
        !grant
        || grant.status !== 'active'
        || grant.expiresAtMs <= command.nowMs
        || resources === null
        || !resources.some(({ id }) => id === session.resourceId)
        || !code
        || code.status !== 'active'
        || code.expiresAtMs <= command.nowMs
        || code.subjectUid !== session.subjectUid
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

      const resources = await resolveClientResources(
        transaction,
        storedCode.resourceIds,
        command.resourceResolutionMode,
      );
      if (resources === null) {
        writeFailedAttempts(transaction, rateLimits, command.nowMs);
        return Object.freeze({ kind: 'invalid' as const });
      }

      const currentInstallationLookupId = command.currentInstallationHash.lookupId;
      const subjectUid = storedCode.subjectUid ?? createSubjectUid(
        storedCode.codeId,
        currentInstallationLookupId,
      );
      const grant: Readonly<VersionedClientGrantView> = Object.freeze({
        expiresAtMs: storedCode.expiresAtMs,
        resources,
        schemaVersion: grantSchemaVersion(command.resourceResolutionMode),
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
          rateLimitLookupIds: Object.freeze(command.rateLimitBuckets
            .filter(({ clearOnSuccess }) => clearOnSuccess)
            .map(({ lookupId }) => lookupId)),
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

async function expireAccessCode(
  transaction: DocumentTransaction,
  codeId: string,
  nowMs: number,
): Promise<boolean> {
  const codePath = `${ACCESS_CODE_PREFIX}/${codeId}`;
  const codeValue = await transaction.get(codePath);
  const code = parseStoredAccessCode(codeValue);
  if (codeValue !== undefined && !code) throw new Error('invalid_access_code_record');
  if (!code || code.status !== 'active' || code.expiresAtMs > nowMs) return false;

  const grantPath = code.subjectUid ? `${CLIENT_GRANT_PREFIX}/${code.subjectUid}` : null;
  const deletionPath = code.subjectUid ? `${ACCOUNT_DELETION_PREFIX}/${code.subjectUid}` : null;
  const [grantValue, deletionValue] = await Promise.all([
    grantPath ? transaction.get(grantPath) : undefined,
    deletionPath ? transaction.get(deletionPath) : undefined,
  ]);
  const grant = parseStoredClientGrant(grantValue);
  const deletion = parseStoredAccountDeletion(deletionValue);
  if (code.subjectUid && (
    !grantPath
    || !deletionPath
    || !grant
    || grant.codeId !== code.codeId
  )) throw new Error('invalid_client_grant_record');
  if (deletionValue !== undefined && (!deletion
    || deletion.subjectUid !== code.subjectUid
    || deletion.codeId !== code.codeId
  )) throw new Error('invalid_account_deletion_record');

  transaction.set(codePath, Object.freeze({
    ...code,
    status: 'revoked',
    updatedAtMs: nowMs,
  }));
  transaction.delete(`${ACCESS_CODE_LOOKUP_PREFIX}/${code.lookupId}`);
  if (code.subjectUid && grant && grantPath && deletionPath) {
    transaction.set(grantPath, Object.freeze({
      ...grant,
      status: 'revoked',
      updatedAtMs: nowMs,
    }));
    if (!deletion) {
      transaction.create(deletionPath, Object.freeze({
        attempts: 0,
        cleanupCompletedAtMs: null,
        codeId: code.codeId,
        createdAtMs: nowMs,
        deletionReceiptLookupId: null,
        installationLookupId: grant.installationLookupId,
        lastAttemptAtMs: null,
        rateLimitLookupIds: grant.rateLimitLookupIds,
        schemaVersion: 1,
        status: 'pending',
        subjectUid: code.subjectUid,
        updatedAtMs: nowMs,
      } satisfies StoredAccountDeletion));
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/delete_request_${subjectAuditId(code.subjectUid)}_${nowMs}`,
        sanitizedAudit('client_account_deletion_requested', nowMs),
      );
    }
  }
  transaction.create(
    `${AUDIT_EVENT_PREFIX}/expire_${code.codeId}_${nowMs}`,
    sanitizedAudit('access_code_expired', nowMs, code.codeId),
  );
  return true;
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
  if (!isRecord(value) || ![1, 2].includes(value.schemaVersion as number)) return null;
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
    || !(candidate.boundInstallationLookupId === null || typeof candidate.boundInstallationLookupId === 'string')
    || !(candidate.redeemedAtMs === null || isNonnegativeSafeInteger(candidate.redeemedAtMs))
    || !(candidate.subjectUid === null || typeof candidate.subjectUid === 'string')
    || !isNonnegativeSafeInteger(candidate.updatedAtMs)
  ) return null;
  const ownsSlot = Object.hasOwn(candidate, 'slot');
  if (
    (candidate.schemaVersion === 1
      && (!ownsSlot || ![1, 2, 3, 4].includes(candidate.slot as number)))
    || (candidate.schemaVersion === 2 && ownsSlot)
  ) return null;
  return candidate as StoredAccessCode;
}

function parseClientResource(value: unknown): Readonly<ClientResourceView> | null {
  if (!isRecord(value)) return null;
  if (
    !recordHasExactKeys(value, [
      'access', 'iconKey', 'id', 'schemaVersion', 'status', 'summary', 'title',
    ])
    || value.schemaVersion !== 1
    || value.status !== 'active'
    || value.access !== 'client'
    || typeof value.id !== 'string'
    || !CATALOG_ID_PATTERN.test(value.id)
    || isPermanentlyRetiredCatalogId(value.id)
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

interface StoredCatalogClientItem {
  readonly access: 'clients' | 'public';
  readonly active: boolean;
  readonly createdAtMs: number;
  readonly icon: string;
  readonly id: string;
  readonly revision: number;
  readonly summary: Readonly<{ en: string; 'es-MX': string }>;
  readonly title: Readonly<{ en: string; 'es-MX': string }>;
  readonly updatedAtMs: number;
  readonly url: string;
}

/**
 * Resolves the durable group marker on every authorization decision. Keeping the
 * marker in codes and grants means catalog activations and withdrawals take
 * effect without rewriting security artifacts.
 */
async function resolveClientResources(
  transaction: DocumentTransaction,
  resourceIds: readonly string[],
  mode: ClientResourceResolutionMode,
): Promise<readonly Readonly<ClientResourceView>[] | null> {
  const catalogValue = await transaction.get(CATALOG_PATH);
  if (catalogValue === undefined) {
    if (resourceIds.some((resourceId) => EXTERNAL_CATALOG_ID_PATTERN.test(resourceId))) return null;
    return readSpecificClientResources(transaction, resourceIds);
  }
  const catalog = parseCatalogClientItems(catalogValue);
  if (catalog === null) return null;

  const activeClients = catalog.filter(({ access, active }) => access === 'clients' && active);
  const activeById = new Map(activeClients.map((item) => [item.id, item]));
  const activeResources = await readSpecificClientResources(
    transaction,
    activeClients.map(({ id }) => id),
  );
  if (activeResources === null || activeResources.some((resource) => (
    !clientResourceMatchesCatalog(resource, activeById.get(resource.id)!)
  ))) return null;
  const activeResourceById = new Map(activeResources.map((resource) => [resource.id, resource]));

  const expandedIds: string[] = [];
  const seen = new Set<string>();
  for (const resourceId of resourceIds) {
    const replacements = resourceId === CLIENT_RESOURCE_GROUP_MARKER
      ? activeClients.map(({ id }) => id)
      : [resourceId];
    for (const replacement of replacements) {
      if (!seen.has(replacement)) {
        seen.add(replacement);
        expandedIds.push(replacement);
      }
    }
  }

  const resources = expandedIds.map((resourceId) => activeResourceById.get(resourceId));
  if (resources.some((resource) => resource === undefined)) return null;
  const selected = Object.freeze(resources as Readonly<ClientResourceView>[]);
  return mode === 'legacy_cabohealth'
    ? Object.freeze(selected.filter((resource) => (
      isLegacyCompatibleCatalogUrl(activeById.get(resource.id)!.url)
    )))
    : selected;
}

function grantSchemaVersion(mode: ClientResourceResolutionMode): 1 | 2 {
  return mode === 'legacy_cabohealth' ? 1 : 2;
}

async function readSpecificClientResources(
  transaction: DocumentTransaction,
  resourceIds: readonly string[],
): Promise<readonly Readonly<ClientResourceView>[] | null> {
  const resources = await Promise.all(resourceIds.map(async (resourceId) => (
    parseClientResource(await transaction.get(clientResourcePath(resourceId)))
  )));
  if (resources.some((resource, index) => (
    resource === null || resource.id !== resourceIds[index]
  ))) return null;
  return Object.freeze(resources as Readonly<ClientResourceView>[]);
}

function clientResourceMatchesCatalog(
  resource: Readonly<ClientResourceView>,
  catalogItem: Readonly<StoredCatalogClientItem>,
): boolean {
  return resource.id === catalogItem.id
    && resource.iconKey === catalogClientIconKey(catalogItem.icon)
    && resource.title.en === catalogItem.title.en
    && resource.title.es === catalogItem.title['es-MX']
    && resource.summary.en === catalogItem.summary.en
    && resource.summary.es === catalogItem.summary['es-MX'];
}

function catalogClientIconKey(icon: string): string | null {
  return {
    contact: 'chatbubble-ellipses-outline',
    featured: 'sparkles-outline',
    guide: 'book-outline',
    laboratory: 'flask-outline',
    location: 'map-outline',
    nutrition: 'leaf-outline',
    recipes: 'restaurant-outline',
    wellness: 'heart-outline',
  }[icon] ?? null;
}

function parseCatalogClientItems(value: unknown): readonly Readonly<StoredCatalogClientItem>[] | null {
  if (
    !isRecord(value)
    || !recordHasExactKeys(value, ['items', 'revision', 'schemaVersion', 'updatedAtMs'])
    || value.schemaVersion !== 1
    || !isNonnegativeSafeInteger(value.revision)
    || !isNonnegativeSafeInteger(value.updatedAtMs)
    || !Array.isArray(value.items)
    || value.items.length > MAX_CATALOG_ITEMS
  ) return null;

  const parsed: StoredCatalogClientItem[] = [];
  const ids = new Set<string>();
  for (const candidate of value.items) {
    const item = parseCatalogItem(candidate);
    if (!item || ids.has(item.id)) return null;
    ids.add(item.id);
    parsed.push(item);
  }
  return Object.freeze(parsed);
}

function parseCatalogItem(value: unknown): Readonly<StoredCatalogClientItem> | null {
  const parsedUrl = isRecord(value) ? parseSafeCatalogUrl(value.url) : null;
  if (
    !isRecord(value)
    || !recordHasExactKeys(value, [
      'access',
      'active',
      'createdAtMs',
      'icon',
      'id',
      'revision',
      'summary',
      'title',
      'updatedAtMs',
      'url',
    ])
    || (value.access !== 'public' && value.access !== 'clients')
    || typeof value.active !== 'boolean'
    || !isNonnegativeSafeInteger(value.createdAtMs)
    || !isNonnegativeSafeInteger(value.updatedAtMs)
    || value.updatedAtMs < value.createdAtMs
    || typeof value.icon !== 'string'
    || !CATALOG_ICONS.has(value.icon)
    || typeof value.id !== 'string'
    || !CATALOG_ID_PATTERN.test(value.id)
    || isPermanentlyRetiredCatalogId(value.id)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || typeof value.url !== 'string'
    || parsedUrl === null
    || value.url !== parsedUrl.url
    || (parsedUrl.kind === 'cabohealth'
      ? value.id !== parsedUrl.id
      : !EXTERNAL_CATALOG_ID_PATTERN.test(value.id))
    || value.id === 'app-review'
    || value.id === 'shared'
    || (value.id === 'client-resources' && value.access !== 'clients')
  ) return null;
  const title = parseExactCatalogCopy(value.title, 80);
  const summary = parseExactCatalogCopy(value.summary, 240);
  if (!title || !summary) return null;
  return Object.freeze({
    access: value.access,
    active: value.active,
    createdAtMs: value.createdAtMs,
    icon: value.icon,
    id: value.id,
    revision: value.revision as number,
    summary,
    title,
    updatedAtMs: value.updatedAtMs,
    url: value.url,
  }) as Readonly<StoredCatalogClientItem>;
}

function parseExactCatalogCopy(
  value: unknown,
  maximumLength: number,
): Readonly<{ en: string; 'es-MX': string }> | null {
  if (!isRecord(value) || !recordHasExactKeys(value, ['en', 'es-MX'])) return null;
  if (
    typeof value.en !== 'string'
    || typeof value['es-MX'] !== 'string'
    || value.en.length < 1
    || value.en.length > maximumLength
    || value['es-MX'].length < 1
    || value['es-MX'].length > maximumLength
    || value.en !== value.en.trim()
    || value['es-MX'] !== value['es-MX'].trim()
    || /[\u0000-\u001f\u007f]/u.test(value.en)
    || /[\u0000-\u001f\u007f]/u.test(value['es-MX'])
  ) return null;
  return Object.freeze({ en: value.en, 'es-MX': value['es-MX'] });
}

async function readLiveSession(
  transaction: DocumentTransaction,
  command: Readonly<Pick<
    ClientSessionCommand,
    'currentInstallationHash' | 'installationHashes' | 'nowMs' | 'subjectUid'
  >>,
  mode: ClientResourceResolutionMode,
  includeResources = true,
): Promise<Readonly<{
  code: Readonly<StoredAccessCode>;
  codePath: string;
  grant: Readonly<StoredClientGrant>;
  grantPath: string;
  view: Readonly<VersionedClientGrantView>;
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
    ? await resolveClientResources(transaction, grant.resourceIds, mode)
    : [];
  if (resources === null) return null;
  const view = Object.freeze({
    expiresAtMs: grant.expiresAtMs,
    resources: Object.freeze(resources),
    schemaVersion: grantSchemaVersion(mode),
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
    || !(candidate.rateLimitLookupIds === undefined || (
      Array.isArray(candidate.rateLimitLookupIds)
      && candidate.rateLimitLookupIds.every((lookupId) => typeof lookupId === 'string')
    ))
    || !Array.isArray(candidate.resourceIds)
    || candidate.resourceIds.some((resourceId) => typeof resourceId !== 'string')
    || !['active', 'removed', 'revoked'].includes(candidate.status as string)
    || !isNonnegativeSafeInteger(candidate.updatedAtMs)
  ) return null;
  return Object.freeze({
    ...(candidate as StoredClientGrant),
    rateLimitLookupIds: Object.freeze(candidate.rateLimitLookupIds ?? []),
  });
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

function parseStoredAccountDeletion(value: unknown): Readonly<StoredAccountDeletion> | null {
  if (!isRecord(value)) return null;
  const candidate = value as Partial<StoredAccountDeletion>;
  if (
    candidate.schemaVersion !== 1
    || candidate.status !== 'pending'
    || !isNonnegativeSafeInteger(candidate.attempts)
    || !(candidate.cleanupCompletedAtMs === null
      || isNonnegativeSafeInteger(candidate.cleanupCompletedAtMs))
    || typeof candidate.codeId !== 'string'
    || !/^ac_[A-Za-z0-9_-]{32}$/u.test(candidate.codeId)
    || !isNonnegativeSafeInteger(candidate.createdAtMs)
    || !(candidate.deletionReceiptLookupId === null
      || (typeof candidate.deletionReceiptLookupId === 'string'
        && /^[A-Za-z0-9_-]{20,128}$/u.test(candidate.deletionReceiptLookupId)))
    || typeof candidate.installationLookupId !== 'string'
    || !(candidate.lastAttemptAtMs === null || isNonnegativeSafeInteger(candidate.lastAttemptAtMs))
    || !Array.isArray(candidate.rateLimitLookupIds)
    || candidate.rateLimitLookupIds.some((lookupId) => typeof lookupId !== 'string')
    || typeof candidate.subjectUid !== 'string'
    || !/^client_[A-Za-z0-9_-]{32}$/u.test(candidate.subjectUid)
    || !isNonnegativeSafeInteger(candidate.updatedAtMs)
  ) return null;
  return candidate as StoredAccountDeletion;
}

function parseStoredAccountDeletionReceipt(value: unknown): StoredAccountDeletionReceipt | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (
    value.status === 'pending'
    && recordHasExactKeys(value, [
      'completedAtMs',
      'expectedCompletionByMs',
      'hashVersion',
      'requestedAtMs',
      'schemaVersion',
      'status',
    ])
    && value.completedAtMs === null
    && typeof value.hashVersion === 'string'
    && /^[A-Za-z0-9_-]{1,32}$/u.test(value.hashVersion)
    && isNonnegativeSafeInteger(value.requestedAtMs)
    && value.expectedCompletionByMs === (
      value.requestedAtMs + ACCOUNT_DELETION_EXPECTED_COMPLETION_MS
    )
  ) return value as unknown as StoredAccountDeletionReceipt;
  if (
    value.status === 'completed'
    && recordHasExactKeys(value, [
      'completedAtMs',
      'expectedCompletionByMs',
      'expiresAtMs',
      'requestedAtMs',
      'schemaVersion',
      'status',
    ])
    && isNonnegativeSafeInteger(value.requestedAtMs)
    && value.expectedCompletionByMs === (
      value.requestedAtMs + ACCOUNT_DELETION_EXPECTED_COMPLETION_MS
    )
    && isNonnegativeSafeInteger(value.completedAtMs)
    && value.completedAtMs >= value.requestedAtMs
    && value.expiresAtMs === (
      value.completedAtMs + COMPLETED_DELETION_RECEIPT_RETENTION_MS
    )
  ) return value as unknown as StoredAccountDeletionReceipt;
  return null;
}

async function readDeletionReceiptCandidates(
  transaction: DocumentTransaction,
  lookups: readonly Readonly<HmacDigest>[],
): Promise<readonly Readonly<{ value: unknown | undefined }>[]> {
  const candidates = await Promise.all(lookups.map(async (lookup) => ({
    value: await transaction.get(`${ACCOUNT_DELETION_RECEIPT_PREFIX}/${lookup.lookupId}`),
  })));
  for (const candidate of candidates) {
    if (candidate.value !== undefined && !parseStoredAccountDeletionReceipt(candidate.value)) {
      throw new Error('invalid_account_deletion_receipt_record');
    }
  }
  return candidates;
}

function pendingDeletionReceipt(
  lookup: Readonly<HmacDigest>,
  requestedAtMs: number,
): StoredAccountDeletionReceipt {
  return Object.freeze({
    completedAtMs: null,
    expectedCompletionByMs: requestedAtMs + ACCOUNT_DELETION_EXPECTED_COMPLETION_MS,
    hashVersion: lookup.version,
    requestedAtMs,
    schemaVersion: 1,
    status: 'pending',
  });
}

function accountDeletionReceiptView(
  receipt: StoredAccountDeletionReceipt,
): AccountDeletionReceiptStatus {
  return Object.freeze({
    completedAtMs: receipt.completedAtMs,
    expectedCompletionByMs: receipt.expectedCompletionByMs,
    requestedAtMs: receipt.requestedAtMs,
    schemaVersion: 1,
    status: receipt.status,
  });
}

function deletionArtifactBelongsTo(
  path: string,
  value: unknown,
  deletion: Readonly<StoredAccountDeletion>,
): boolean {
  if (path.startsWith(`${LAUNCH_NONCE_PREFIX}/`)) {
    return recordReferencesDeletion(value, deletion);
  }
  if (path.startsWith(`${WEB_SESSION_PREFIX}/`)) {
    return recordReferencesDeletion(value, deletion);
  }
  if (path.startsWith(`${REDEMPTION_REQUEST_PREFIX}/`)) {
    return recordReferencesDeletion(value, deletion);
  }
  if (path.startsWith(`${RATE_LIMIT_PREFIX}/`)) {
    const lookupId = path.slice(RATE_LIMIT_PREFIX.length + 1);
    return deletion.rateLimitLookupIds.includes(lookupId) && value !== undefined;
  }
  return false;
}

function recordReferencesDeletion(
  value: unknown,
  deletion: Readonly<StoredAccountDeletion>,
): boolean {
  return isRecord(value)
    && (value.subjectUid === deletion.subjectUid || value.codeId === deletion.codeId);
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
    expiresAtMs: occurredAtMs + AUDIT_RETENTION_MS,
    occurredAtMs,
    schemaVersion: 1,
  });
}

function staffAudit(
  eventId: string,
  action: 'client_code.created' | 'client_code.revoked',
  targetSuffix: string,
  occurredAtMs: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    action,
    actorLabel: 'Staff',
    eventId,
    expiresAtMs: occurredAtMs + AUDIT_RETENTION_MS,
    occurredAtMs,
    outcome: 'success',
    schemaVersion: 2,
    targetSuffix,
  });
}

function staffAuditEventId(action: string, codeId: string, occurredAtMs: number): string {
  return `evt_${createHash('sha256')
    .update('cabohealth/staff-audit-event/v1\0', 'utf8')
    .update(action, 'utf8')
    .update('\0', 'utf8')
    .update(codeId, 'utf8')
    .update('\0', 'utf8')
    .update(String(occurredAtMs), 'utf8')
    .digest('base64url')
    .slice(0, 32)}`;
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

function recordHasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
