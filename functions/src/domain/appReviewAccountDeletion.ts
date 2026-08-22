import { AppReviewInputError } from './appReviewAccess.js';
import type { AppReviewDataRetentionService } from './appReviewDataRetention.js';
import type { HmacDigest } from '../security/versionedHmac.js';
import { VersionedHmac } from '../security/versionedHmac.js';

const INSTALLATION_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const REVIEW_SUBJECT_PATTERN = /^review_[A-Za-z0-9_-]{32}$/u;

export interface AppReviewAccountDeletionStore {
  beginRequestedAppReviewDataDeletion(command: Readonly<{
    installationLookups: readonly Readonly<HmacDigest>[];
    nowMs: number;
    subjectUid: string;
  }>): Promise<'accepted' | 'invalid'>;
}

export class AppReviewAccountDeletionService {
  readonly #installationHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #retention: Pick<AppReviewDataRetentionService, 'processPending'>;
  readonly #store: AppReviewAccountDeletionStore;

  constructor(dependencies: Readonly<{
    installationHasher: VersionedHmac;
    nowMs?: () => number;
    retention: Pick<AppReviewDataRetentionService, 'processPending'>;
    store: AppReviewAccountDeletionStore;
  }>) {
    this.#installationHasher = dependencies.installationHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#retention = dependencies.retention;
    this.#store = dependencies.store;
  }

  async request(input: Readonly<{
    installationId: string;
    subjectUid: string;
  }>): Promise<Readonly<{ status: 'completed' | 'pending' }>> {
    if (
      !INSTALLATION_PATTERN.test(input.installationId)
      || !REVIEW_SUBJECT_PATTERN.test(input.subjectUid)
    ) throw new AppReviewInputError('invalid_access');
    const nowMs = this.#nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('invalid_server_time');
    const accepted = await this.#store.beginRequestedAppReviewDataDeletion(Object.freeze({
      installationLookups: this.#installationHasher.lookupCandidates(input.installationId),
      nowMs,
      subjectUid: input.subjectUid,
    }));
    if (accepted !== 'accepted') throw new AppReviewInputError('invalid_access');
    try {
      return Object.freeze({
        status: await this.#retention.processPending(input.subjectUid),
      });
    } catch {
      return Object.freeze({ status: 'pending' as const });
    }
  }
}
