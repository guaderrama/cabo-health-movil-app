import type {
  DocumentDatabase,
  DocumentTransaction,
} from '../../repositories/firestoreClientAccessStore.js';

export class InMemoryDocumentDatabase implements DocumentDatabase {
  readonly #documents = new Map<string, unknown>();
  readonly #rejectDuplicateWrites: boolean;
  #queue = Promise.resolve();

  constructor(
    seed: Readonly<Record<string, unknown>> = {},
    options: Readonly<{ rejectDuplicateWrites?: boolean }> = {},
  ) {
    this.#rejectDuplicateWrites = options.rejectDuplicateWrites ?? false;
    for (const [path, value] of Object.entries(seed)) {
      this.#documents.set(path, structuredClone(value));
    }
  }

  runTransaction<T>(operation: (transaction: DocumentTransaction) => Promise<T>): Promise<T> {
    const pending = this.#queue.then(async () => {
      const workingCopy = new Map(
        [...this.#documents].map(([path, value]) => [path, structuredClone(value)]),
      );
      const transaction: DocumentTransaction = {
        async get(path) {
          const value = workingCopy.get(path);
          return value === undefined ? undefined : structuredClone(value);
        },
        create(path, value) {
          registerWrite(path);
          if (workingCopy.has(path)) throw new Error('document_already_exists');
          workingCopy.set(path, structuredClone(value));
        },
        delete(path) {
          registerWrite(path);
          workingCopy.delete(path);
        },
        set(path, value) {
          registerWrite(path);
          workingCopy.set(path, structuredClone(value));
        },
      };
      const writtenPaths = new Set<string>();
      const rejectDuplicateWrites = this.#rejectDuplicateWrites;
      function registerWrite(path: string): void {
        if (rejectDuplicateWrites && writtenPaths.has(path)) {
          throw new Error(`duplicate_document_write:${path}`);
        }
        writtenPaths.add(path);
      }
      const result = await operation(transaction);
      this.#documents.clear();
      for (const [path, value] of workingCopy) this.#documents.set(path, value);
      return result;
    });
    this.#queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async listCollection(path: string): Promise<readonly Readonly<{ id: string; value: unknown }>[]> {
    await this.#queue;
    const prefix = `${path}/`;
    return [...this.#documents]
      .filter(([documentPath]) => documentPath.startsWith(prefix) && !documentPath.slice(prefix.length).includes('/'))
      .map(([documentPath, value]) => Object.freeze({
        id: documentPath.slice(prefix.length),
        value: structuredClone(value),
      }));
  }

  serializedState(): string {
    return JSON.stringify(Object.fromEntries(this.#documents));
  }
}
