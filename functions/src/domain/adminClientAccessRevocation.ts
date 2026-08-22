import { type PendingAccountDeletionProcessor } from './clientAccountDeletion.js';

export interface AdminClientAccessRevocationStore {
  revokeAccessCode(
    codeId: string,
    nowMs: number,
  ): Promise<Readonly<
    { kind: 'not_active' }
    | { kind: 'revoked'; subjectUid: string | null }
  >>;
}

export class AdminClientAccessRevocationService {
  readonly #accountDeletion: PendingAccountDeletionProcessor;
  readonly #nowMs: () => number;
  readonly #store: AdminClientAccessRevocationStore;

  constructor(dependencies: {
    readonly accountDeletion: PendingAccountDeletionProcessor;
    readonly nowMs?: () => number;
    readonly store: AdminClientAccessRevocationStore;
  }) {
    this.#accountDeletion = dependencies.accountDeletion;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#store = dependencies.store;
  }

  async revoke(codeId: string): Promise<Readonly<
    { kind: 'not_active' }
    | { kind: 'revoked' }
  >> {
    const result = await this.#store.revokeAccessCode(codeId, this.#nowMs());
    if (result.kind !== 'revoked') return result;
    if (result.subjectUid) {
      try {
        await this.#accountDeletion.processPending(result.subjectUid);
      } catch {
        // Revocation and its deletion tombstone are already durable. The
        // scheduled worker owns retries; a cleanup outage must not turn this
        // successfully committed admin action into an ambiguous failure.
      }
    }
    return Object.freeze({ kind: 'revoked' as const });
  }
}
