const REVIEW_SUBJECT_PATTERN = /^review_[A-Za-z0-9_-]{32}$/u;

export const APP_REVIEW_DATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface AppReviewDataRetentionStore {
  beginAppReviewDataDeletion(command: Readonly<{
    cutoffMs: number;
    nowMs: number;
    subjectUid: string;
  }>): Promise<'already_queued' | 'not_due' | 'queued'>;
  completeAppReviewDataDeletion(subjectUid: string, nowMs: number): Promise<
    'completed' | 'not_ready'
  >;
  listAppReviewDataDeletionJobs(limit: number): Promise<Readonly<{
    malformed: number;
    subjectUids: readonly string[];
  }>>;
  listAppReviewRetentionCandidates(cutoffMs: number, limit: number): Promise<Readonly<{
    malformed: number;
    subjectUids: readonly string[];
  }>>;
  markAppReviewDataDeletionFailed(subjectUid: string, nowMs: number): Promise<void>;
  purgeAppReviewDataArtifacts(subjectUid: string, nowMs: number): Promise<
    'missing' | 'more' | 'ready'
  >;
}

export interface AppReviewAuthDeletionGateway {
  deleteUser(subjectUid: string): Promise<void>;
}

export interface AppReviewRetentionSummary {
  readonly completed: number;
  readonly failed: number;
  readonly malformed: number;
  readonly pending: number;
  readonly queued: number;
}

export class AppReviewRetentionBatchError extends Error {
  readonly summary: Readonly<AppReviewRetentionSummary>;

  constructor(summary: Readonly<AppReviewRetentionSummary>) {
    super('app_review_retention_incomplete');
    this.name = 'AppReviewRetentionBatchError';
    this.summary = Object.freeze({ ...summary });
  }
}

export class AppReviewDataRetentionService {
  readonly #authAccounts: AppReviewAuthDeletionGateway;
  readonly #nowMs: () => number;
  readonly #store: AppReviewDataRetentionStore;

  constructor(dependencies: Readonly<{
    authAccounts: AppReviewAuthDeletionGateway;
    nowMs?: () => number;
    store: AppReviewDataRetentionStore;
  }>) {
    this.#authAccounts = dependencies.authAccounts;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#store = dependencies.store;
  }

  async runScheduled(limit = 20): Promise<Readonly<AppReviewRetentionSummary>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('invalid_app_review_retention_limit');
    }
    const nowMs = this.#nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error('invalid_server_time');
    }
    const cutoffMs = Math.max(0, nowMs - APP_REVIEW_DATA_RETENTION_MS);
    const candidates = await this.#store.listAppReviewRetentionCandidates(cutoffMs, limit);
    let failed = 0;
    let queued = 0;
    for (const subjectUid of candidates.subjectUids) {
      try {
        if (await this.#store.beginAppReviewDataDeletion({
          cutoffMs,
          nowMs,
          subjectUid,
        }) === 'queued') queued += 1;
      } catch {
        failed += 1;
      }
    }

    const jobs = await this.#store.listAppReviewDataDeletionJobs(limit);
    let completed = 0;
    let pending = 0;
    for (const subjectUid of jobs.subjectUids) {
      try {
        const result = await this.#processPending(subjectUid);
        if (result === 'completed') completed += 1;
        else pending += 1;
      } catch {
        failed += 1;
        try {
          await this.#store.markAppReviewDataDeletionFailed(subjectUid, this.#nowMs());
        } catch {
          // The durable job remains discoverable. Continue the bounded batch.
        }
      }
    }
    const summary = Object.freeze({
      completed,
      failed,
      malformed: candidates.malformed + jobs.malformed,
      pending,
      queued,
    });
    if (summary.failed > 0 || summary.malformed > 0) {
      throw new AppReviewRetentionBatchError(summary);
    }
    return summary;
  }

  async #processPending(subjectUid: string): Promise<'completed' | 'pending'> {
    if (!REVIEW_SUBJECT_PATTERN.test(subjectUid)) return 'pending';
    const nowMs = this.#nowMs();
    const purge = await this.#store.purgeAppReviewDataArtifacts(subjectUid, nowMs);
    if (purge !== 'ready') return 'pending';
    try {
      await this.#authAccounts.deleteUser(subjectUid);
    } catch {
      await this.#store.markAppReviewDataDeletionFailed(subjectUid, nowMs);
      return 'pending';
    }
    return await this.#store.completeAppReviewDataDeletion(subjectUid, this.#nowMs()) === 'completed'
      ? 'completed'
      : 'pending';
  }
}
