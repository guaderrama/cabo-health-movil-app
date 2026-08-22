import { ClientAccessPublicError } from './clientAccessRedeemer.js';
import { type HmacDigest, VersionedHmac } from '../security/versionedHmac.js';

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const SUBJECT_UID_PATTERN = /^client_[A-Za-z0-9_-]{32}$/u;

export interface ClientAccountDeletionCommand {
  readonly currentInstallationHash: Readonly<HmacDigest>;
  readonly installationHashes: readonly Readonly<HmacDigest>[];
  readonly nowMs: number;
  readonly subjectUid: string;
}

export interface ClientAccountDeletionStore {
  beginAccountDeletion(command: Readonly<ClientAccountDeletionCommand>): Promise<
    Readonly<{ kind: 'accepted' } | { kind: 'invalid' }>
  >;
  completeAccountDeletion(subjectUid: string, nowMs: number): Promise<
    Readonly<{ kind: 'completed' } | { kind: 'not_ready' }>
  >;
  listPendingAccountDeletions(limit: number): Promise<Readonly<{
    malformed: number;
    subjectUids: readonly string[];
  }>>;
  markAccountDeletionAttemptFailed(subjectUid: string, nowMs: number): Promise<void>;
  purgeAccountDeletionArtifacts(subjectUid: string, nowMs: number): Promise<
    Readonly<{ kind: 'missing' | 'more' | 'ready' }>
  >;
}

export interface AuthAccountDeletionGateway {
  deleteUser(subjectUid: string): Promise<void>;
}

export interface PendingAccountDeletionProcessor {
  processPending(subjectUid: string): Promise<Readonly<{
    status: 'completed' | 'pending';
  }>>;
}

export interface AccountDeletionRetrySummary {
  readonly completed: number;
  readonly failed: number;
  readonly malformed: number;
  readonly pending: number;
}

export class AccountDeletionRetryBatchError extends Error {
  readonly summary: Readonly<AccountDeletionRetrySummary>;

  constructor(summary: Readonly<AccountDeletionRetrySummary>) {
    super('account_deletion_retry_incomplete');
    this.name = 'AccountDeletionRetryBatchError';
    this.summary = Object.freeze({ ...summary });
  }
}

export class ClientAccountDeletionService {
  readonly #authAccounts: AuthAccountDeletionGateway;
  readonly #installationHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #store: ClientAccountDeletionStore;

  constructor(dependencies: {
    readonly authAccounts: AuthAccountDeletionGateway;
    readonly installationHasher: VersionedHmac;
    readonly nowMs?: () => number;
    readonly store: ClientAccountDeletionStore;
  }) {
    this.#authAccounts = dependencies.authAccounts;
    this.#installationHasher = dependencies.installationHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#store = dependencies.store;
  }

  async request(input: {
    readonly installationId: string;
    readonly subjectUid: string;
  }): Promise<Readonly<{ status: 'completed' | 'pending' }>> {
    if (
      !INSTALLATION_ID_PATTERN.test(input.installationId)
      || !SUBJECT_UID_PATTERN.test(input.subjectUid)
    ) throw new ClientAccessPublicError('invalid_access');
    const installationHashes = this.#installationHasher.lookupCandidates(input.installationId);
    const accepted = await this.#store.beginAccountDeletion(Object.freeze({
      currentInstallationHash: installationHashes[0]!,
      installationHashes,
      nowMs: this.#nowMs(),
      subjectUid: input.subjectUid,
    }));
    if (accepted.kind !== 'accepted') throw new ClientAccessPublicError('invalid_access');
    return this.processPending(input.subjectUid);
  }

  async processPending(
    subjectUid: string,
  ): Promise<Readonly<{ status: 'completed' | 'pending' }>> {
    if (!SUBJECT_UID_PATTERN.test(subjectUid)) return Object.freeze({ status: 'pending' });
    const nowMs = this.#nowMs();
    const purge = await this.#store.purgeAccountDeletionArtifacts(subjectUid, nowMs);
    if (purge.kind !== 'ready') return Object.freeze({ status: 'pending' });
    try {
      await this.#authAccounts.deleteUser(subjectUid);
    } catch {
      await this.#store.markAccountDeletionAttemptFailed(subjectUid, nowMs);
      return Object.freeze({ status: 'pending' });
    }
    const completion = await this.#store.completeAccountDeletion(subjectUid, this.#nowMs());
    return Object.freeze({
      status: completion.kind === 'completed' ? 'completed' : 'pending',
    });
  }

  async retryPending(limit = 4): Promise<Readonly<{ completed: number; pending: number }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new Error('invalid_deletion_retry_limit');
    }
    const batch = await this.#store.listPendingAccountDeletions(limit);
    let completed = 0;
    let failed = 0;
    let pending = 0;
    for (const subjectUid of batch.subjectUids) {
      try {
        const result = await this.processPending(subjectUid);
        if (result.status === 'completed') completed += 1;
        else pending += 1;
      } catch {
        failed += 1;
        try {
          await this.#store.markAccountDeletionAttemptFailed(subjectUid, this.#nowMs());
        } catch {
          // Keep processing the rest of the bounded batch. The durable job is
          // still present and the aggregate error below signals the failure.
        }
      }
    }
    const summary = Object.freeze({
      completed,
      failed,
      malformed: batch.malformed,
      pending,
    });
    if (failed > 0 || batch.malformed > 0) {
      throw new AccountDeletionRetryBatchError(summary);
    }
    return Object.freeze({ completed, pending });
  }
}

export interface ExpiredClientAccessReconciler {
  reconcileExpiredClientAccess(nowMs: number): Promise<void>;
}

export interface AccountDeletionMaintenanceSummary extends AccountDeletionRetrySummary {
  readonly reconciliationFailed: number;
}

export class AccountDeletionMaintenanceBatchError extends Error {
  readonly summary: Readonly<AccountDeletionMaintenanceSummary>;

  constructor(summary: Readonly<AccountDeletionMaintenanceSummary>) {
    super('account_deletion_maintenance_incomplete');
    this.name = 'AccountDeletionMaintenanceBatchError';
    this.summary = Object.freeze({ ...summary });
  }
}

export class ClientAccountDeletionMaintenanceService {
  readonly #deletions: Pick<ClientAccountDeletionService, 'retryPending'>;
  readonly #nowMs: () => number;
  readonly #reconciler: ExpiredClientAccessReconciler;

  constructor(dependencies: Readonly<{
    deletions: Pick<ClientAccountDeletionService, 'retryPending'>;
    nowMs?: () => number;
    reconciler: ExpiredClientAccessReconciler;
  }>) {
    this.#deletions = dependencies.deletions;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#reconciler = dependencies.reconciler;
  }

  async runScheduled(limit = 4): Promise<Readonly<{ completed: number; pending: number }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new Error('invalid_deletion_retry_limit');
    }
    const nowMs = this.#nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('invalid_server_time');

    let reconciliationFailed = 0;
    try {
      await this.#reconciler.reconcileExpiredClientAccess(nowMs);
    } catch {
      reconciliationFailed = 1;
    }

    let retrySummary: Readonly<AccountDeletionRetrySummary>;
    try {
      const result = await this.#deletions.retryPending(limit);
      retrySummary = Object.freeze({
        completed: result.completed,
        failed: 0,
        malformed: 0,
        pending: result.pending,
      });
    } catch (error) {
      retrySummary = error instanceof AccountDeletionRetryBatchError
        ? error.summary
        : Object.freeze({ completed: 0, failed: 1, malformed: 0, pending: 0 });
    }

    const summary = Object.freeze({
      ...retrySummary,
      reconciliationFailed,
    });
    if (
      summary.reconciliationFailed > 0
      || summary.failed > 0
      || summary.malformed > 0
    ) throw new AccountDeletionMaintenanceBatchError(summary);
    return Object.freeze({ completed: summary.completed, pending: summary.pending });
  }
}
