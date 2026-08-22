import { type PendingAccountDeletionProcessor } from './clientAccountDeletion.js';

export interface ClientAccessSessionRemover {
  remove(input: {
    readonly installationId: string;
    readonly subjectUid: string;
  }): Promise<Readonly<{ removed: true }>>;
}

export class ClientAccessRemovalService {
  readonly #accountDeletion: PendingAccountDeletionProcessor;
  readonly #sessions: ClientAccessSessionRemover;

  constructor(dependencies: {
    readonly accountDeletion: PendingAccountDeletionProcessor;
    readonly sessions: ClientAccessSessionRemover;
  }) {
    this.#accountDeletion = dependencies.accountDeletion;
    this.#sessions = dependencies.sessions;
  }

  async remove(input: {
    readonly installationId: string;
    readonly subjectUid: string;
  }): Promise<Readonly<{ removed: true }>> {
    const result = await this.#sessions.remove(input);
    try {
      await this.#accountDeletion.processPending(input.subjectUid);
    } catch {
      // The removal transaction already revoked authorization and created the
      // durable deletion job. The scheduled worker owns cleanup retries.
    }
    return result;
  }
}
