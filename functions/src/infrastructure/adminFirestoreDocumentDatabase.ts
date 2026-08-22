import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';

import type {
  DocumentDatabase,
  DocumentTransaction,
} from '../repositories/firestoreClientAccessStore.js';

export class AdminFirestoreDocumentDatabase implements DocumentDatabase {
  readonly #firestore: Firestore;

  constructor(firestore: Firestore) {
    this.#firestore = firestore;
  }

  runTransaction<T>(
    operation: (transaction: DocumentTransaction) => Promise<T>,
  ): Promise<T> {
    return this.#firestore.runTransaction(async (firebaseTransaction) => operation({
      get: async (path) => {
        const snapshot = await firebaseTransaction.get(this.#firestore.doc(path));
        return snapshot.exists ? decodeFirestoreDocument(snapshot.data()) : undefined;
      },
      create: (path, value) => {
        firebaseTransaction.create(
          this.#firestore.doc(path),
          encodeFirestoreDocument(value) as DocumentData,
        );
      },
      delete: (path) => {
        firebaseTransaction.delete(this.#firestore.doc(path));
      },
      set: (path, value) => {
        firebaseTransaction.set(
          this.#firestore.doc(path),
          encodeFirestoreDocument(value) as DocumentData,
        );
      },
    }));
  }

  async listCollection(path: string): Promise<readonly Readonly<{ id: string; value: unknown }>[]> {
    const snapshot = await this.#firestore.collection(path).get();
    return Object.freeze(snapshot.docs.map((document) => Object.freeze({
      id: document.id,
      value: decodeFirestoreDocument(document.data()),
    })));
  }
}

/**
 * Firestore TTL policies ignore numeric epoch values: the configured field must
 * contain a native Firestore timestamp. Domain code deliberately keeps epoch
 * milliseconds so time arithmetic remains explicit and testable, therefore the
 * infrastructure boundary owns the lossless conversion in both directions.
 */
export function encodeFirestoreDocument(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encodeFirestoreDocument);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'expiresAtMs' && isEpochMilliseconds(entry)
      ? Timestamp.fromMillis(entry)
      : encodeFirestoreDocument(entry),
  ]));
}

export function decodeFirestoreDocument(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeFirestoreDocument);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'expiresAtMs' && entry instanceof Timestamp
      ? entry.toMillis()
      : decodeFirestoreDocument(entry),
  ]));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isEpochMilliseconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
