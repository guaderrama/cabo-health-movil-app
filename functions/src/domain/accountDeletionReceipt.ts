import type { HmacDigest } from '../security/versionedHmac.js';
import { VersionedHmac } from '../security/versionedHmac.js';

const DELETION_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export const ACCOUNT_DELETION_EXPECTED_COMPLETION_MS = 30 * 24 * 60 * 60 * 1_000;
export const COMPLETED_DELETION_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type AccountDeletionReceiptStatus = Readonly<{
  completedAtMs: number | null;
  expectedCompletionByMs: number;
  requestedAtMs: number;
  schemaVersion: 1;
  status: 'completed' | 'pending';
}>;

export interface AccountDeletionReceiptStatusStore {
  findAccountDeletionReceiptStatus(
    receiptLookups: readonly Readonly<HmacDigest>[],
  ): Promise<AccountDeletionReceiptStatus | null>;
}

export class AccountDeletionReceiptError extends Error {
  readonly code = 'invalid_access' as const;

  constructor() {
    super('invalid_access');
    this.name = 'AccountDeletionReceiptError';
  }
}

export class AccountDeletionReceiptStatusService {
  readonly #nowMs: () => number;
  readonly #receiptHasher: VersionedHmac;
  readonly #store: AccountDeletionReceiptStatusStore;

  constructor(dependencies: Readonly<{
    nowMs?: () => number;
    receiptHasher: VersionedHmac;
    store: AccountDeletionReceiptStatusStore;
  }>) {
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#receiptHasher = dependencies.receiptHasher;
    this.#store = dependencies.store;
  }

  async getStatus(input: Readonly<{
    deletionReceipt: string;
  }>): Promise<AccountDeletionReceiptStatus> {
    if (!DELETION_RECEIPT_PATTERN.test(input.deletionReceipt)) {
      throw new AccountDeletionReceiptError();
    }
    const status = await this.#store.findAccountDeletionReceiptStatus(
      this.#receiptHasher.lookupCandidates(input.deletionReceipt),
    );
    if (!status) throw new AccountDeletionReceiptError();
    if (
      status.status === 'completed'
      && (
        status.completedAtMs === null
        || this.#nowMs() >= status.completedAtMs + COMPLETED_DELETION_RECEIPT_RETENTION_MS
      )
    ) throw new AccountDeletionReceiptError();
    return Object.freeze({ ...status });
  }
}
