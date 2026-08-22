import type { DocumentData, Firestore } from 'firebase-admin/firestore';

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
        return snapshot.exists ? snapshot.data() : undefined;
      },
      create: (path, value) => {
        firebaseTransaction.create(
          this.#firestore.doc(path),
          value as DocumentData,
        );
      },
      delete: (path) => {
        firebaseTransaction.delete(this.#firestore.doc(path));
      },
      set: (path, value) => {
        firebaseTransaction.set(
          this.#firestore.doc(path),
          value as DocumentData,
        );
      },
    }));
  }

  async listCollection(path: string): Promise<readonly Readonly<{ id: string; value: unknown }>[]> {
    const snapshot = await this.#firestore.collection(path).get();
    return Object.freeze(snapshot.docs.map((document) => Object.freeze({
      id: document.id,
      value: document.data(),
    })));
  }
}
