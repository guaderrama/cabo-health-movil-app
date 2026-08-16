export interface StorageReader {
  getItem(key: string): Promise<string | null>;
}

export type StoredValueResult<T> =
  | { status: 'value'; value: T }
  | { status: 'missing'; value: T }
  | { status: 'error'; value: T };

export async function readStoredValue<T>(
  storage: StorageReader,
  key: string,
  parse: (value: string) => T,
  fallback: T,
): Promise<StoredValueResult<T>> {
  try {
    const stored = await storage.getItem(key);
    if (stored === null) return { status: 'missing', value: fallback };
    return { status: 'value', value: parse(stored) };
  } catch {
    return { status: 'error', value: fallback };
  }
}

export function createOrderedPersistence<T>(options: {
  persist: (value: T) => Promise<void>;
  onCommit: (value: T) => void;
  onFailure: (value: T) => void;
}) {
  let queue: Promise<void> = Promise.resolve();
  let operationGeneration = 0;

  return {
    beginRead() {
      const readGeneration = operationGeneration;
      return {
        applyCurrent(apply: () => void): boolean {
          if (readGeneration !== operationGeneration) return false;
          apply();
          return true;
        },
      };
    },
    submit(value: T): Promise<boolean> {
      operationGeneration += 1;
      const operation = queue.then(async () => {
        try {
          await options.persist(value);
          operationGeneration += 1;
          options.onCommit(value);
          return true;
        } catch {
          operationGeneration += 1;
          options.onFailure(value);
          return false;
        }
      });
      queue = operation.then(() => undefined);
      return operation;
    },
  };
}
