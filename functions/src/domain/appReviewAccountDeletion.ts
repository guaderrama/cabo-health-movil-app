import { AppReviewInputError } from './appReviewAccess.js';
import type { AppReviewDataRetentionService } from './appReviewDataRetention.js';
import type {
  AccountDeletionReceiptStatus,
  AccountDeletionReceiptStatusStore,
} from './accountDeletionReceipt.js';
import type { HmacDigest } from '../security/versionedHmac.js';
import { VersionedHmac } from '../security/versionedHmac.js';

const INSTALLATION_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const REVIEW_SUBJECT_PATTERN = /^review_[A-Za-z0-9_-]{32}$/u;

export interface AppReviewAccountDeletionStore extends AccountDeletionReceiptStatusStore {
  beginRequestedAppReviewDataDeletion(command: Readonly<{
    currentDeletionReceiptLookup: Readonly<HmacDigest>;
    deletionReceiptLookups: readonly Readonly<HmacDigest>[];
    installationLookups: readonly Readonly<HmacDigest>[];
    nowMs: number;
    subjectUid: string;
  }>): Promise<'accepted' | 'invalid'>;
}

export class AppReviewAccountDeletionService {
  readonly #installationHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #receiptHasher: VersionedHmac;
  readonly #retention: Pick<AppReviewDataRetentionService, 'processPending'>;
  readonly #store: AppReviewAccountDeletionStore;

  constructor(dependencies: Readonly<{
    installationHasher: VersionedHmac;
    nowMs?: () => number;
    receiptHasher: VersionedHmac;
    retention: Pick<AppReviewDataRetentionService, 'processPending'>;
    store: AppReviewAccountDeletionStore;
  }>) {
    this.#installationHasher = dependencies.installationHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#receiptHasher = dependencies.receiptHasher;
    this.#retention = dependencies.retention;
    this.#store = dependencies.store;
  }

  async request(input: Readonly<{
    deletionReceipt: string;
    installationId: string;
    subjectUid: string;
  }>): Promise<AccountDeletionReceiptStatus> {
    if (
      !INSTALLATION_PATTERN.test(input.installationId)
      || !/^[A-Za-z0-9_-]{43}$/u.test(input.deletionReceipt)
      || !REVIEW_SUBJECT_PATTERN.test(input.subjectUid)
    ) throw new AppReviewInputError('invalid_access');
    const nowMs = this.#nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('invalid_server_time');
    const deletionReceiptLookups = this.#receiptHasher.lookupCandidates(input.deletionReceipt);
    const accepted = await this.#store.beginRequestedAppReviewDataDeletion(Object.freeze({
      currentDeletionReceiptLookup: deletionReceiptLookups[0]!,
      deletionReceiptLookups,
      installationLookups: this.#installationHasher.lookupCandidates(input.installationId),
      nowMs,
      subjectUid: input.subjectUid,
    }));
    if (accepted !== 'accepted') throw new AppReviewInputError('invalid_access');
    try {
      await this.#retention.processPending(input.subjectUid);
    } catch {
      // The atomic request transaction already owns the durable receipt and
      // deletion job. Status remains queryable while scheduled retries run.
    }
    const status = await this.#store.findAccountDeletionReceiptStatus(
      this.#receiptHasher.lookupCandidates(input.deletionReceipt),
    );
    if (!status) throw new Error('app_review_deletion_receipt_state_missing');
    return status;
  }
}
