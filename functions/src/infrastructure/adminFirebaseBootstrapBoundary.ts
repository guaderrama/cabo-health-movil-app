import { isDeepStrictEqual } from 'node:util';

import type { FirebaseBootstrapAdminBoundary } from '../domain/firebaseActivationBootstrap.js';
import type { DocumentDatabase } from '../repositories/firestoreClientAccessStore.js';

interface FirebaseBootstrapAuthPort {
  getUser(uid: string): Promise<Readonly<{
    customClaims: Readonly<Record<string, unknown>>;
    disabled: boolean;
    emailVerified: boolean;
    factorCount: number;
    providerIds: readonly string[];
  }> | undefined>;
  setCustomClaims(uid: string, claims: Readonly<Record<string, unknown>>): Promise<void>;
}

export class AdminFirebaseBootstrapBoundary implements FirebaseBootstrapAdminBoundary {
  readonly projectId: string;
  readonly #auth: FirebaseBootstrapAuthPort;
  readonly #database: DocumentDatabase;

  constructor(input: Readonly<{
    auth: FirebaseBootstrapAuthPort;
    database: DocumentDatabase;
    projectId: string;
  }>) {
    this.#auth = input.auth;
    this.#database = input.database;
    this.projectId = input.projectId;
  }

  async loadOwner(uid: string): Promise<Readonly<{
    customClaims: Readonly<Record<string, unknown>>;
    disabled: boolean;
    emailVerified: boolean;
    factorCount: number;
    providerIds: readonly string[];
  }> | undefined> {
    const owner = await this.#auth.getUser(uid);
    if (!owner) return undefined;
    return Object.freeze({
      customClaims: Object.freeze({ ...owner.customClaims }),
      disabled: owner.disabled,
      emailVerified: owner.emailVerified,
      factorCount: owner.factorCount,
      providerIds: Object.freeze([...owner.providerIds]),
    });
  }

  ensureDocumentsExact(
    documents: readonly Readonly<{ path: string; value: unknown }>[],
  ): Promise<void> {
    return this.#database.runTransaction(async (transaction) => {
      const existing = [] as unknown[];
      for (const document of documents) {
        existing.push(await transaction.get(document.path));
      }
      for (let index = 0; index < documents.length; index += 1) {
        const current = existing[index];
        if (current !== undefined && !isDeepStrictEqual(current, documents[index]?.value)) {
          throw new Error('firebase_bootstrap_document_drift');
        }
      }
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index];
        if (document && existing[index] === undefined) {
          transaction.create(document.path, document.value);
        }
      }
    });
  }

  setCustomClaims(uid: string, claims: Readonly<Record<string, unknown>>): Promise<void> {
    return this.#auth.setCustomClaims(uid, claims);
  }
}
