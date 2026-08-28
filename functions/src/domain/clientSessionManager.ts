import {
  ClientAccessPublicError,
  type ClientResourceResolutionMode,
  type VersionedClientGrantView,
} from './clientAccessRedeemer.js';
import { type HmacDigest, VersionedHmac } from '../security/versionedHmac.js';

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const SUBJECT_UID_PATTERN = /^client_[A-Za-z0-9_-]{32}$/u;

export interface ClientSessionCommand {
  readonly currentInstallationHash: Readonly<HmacDigest>;
  readonly installationHashes: readonly Readonly<HmacDigest>[];
  readonly nowMs: number;
  readonly resourceResolutionMode: ClientResourceResolutionMode;
  readonly subjectUid: string;
}

export interface ClientSessionStore {
  refreshSession(command: Readonly<ClientSessionCommand>): Promise<
    Readonly<{ kind: 'active'; grant: Readonly<VersionedClientGrantView> } | { kind: 'invalid' }>
  >;
  removeSession(command: Readonly<ClientSessionCommand>): Promise<
    Readonly<{ kind: 'invalid' } | { kind: 'removed' }>
  >;
}

export class ClientSessionManager {
  readonly #installationHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #resourceResolutionMode: ClientResourceResolutionMode;
  readonly #store: ClientSessionStore;

  constructor(dependencies: {
    readonly installationHasher: VersionedHmac;
    readonly nowMs?: () => number;
    readonly resourceResolutionMode: ClientResourceResolutionMode;
    readonly store: ClientSessionStore;
  }) {
    this.#installationHasher = dependencies.installationHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#resourceResolutionMode = dependencies.resourceResolutionMode;
    this.#store = dependencies.store;
  }

  async refresh(input: {
    readonly installationId: string;
    readonly subjectUid: string;
  }): Promise<Readonly<VersionedClientGrantView>> {
    const result = await this.#store.refreshSession(this.#command(input));
    if (result.kind !== 'active') throw new ClientAccessPublicError('invalid_access');
    return result.grant;
  }

  async remove(input: {
    readonly installationId: string;
    readonly subjectUid: string;
  }): Promise<Readonly<{ removed: true }>> {
    const result = await this.#store.removeSession(this.#command(input));
    if (result.kind !== 'removed') throw new ClientAccessPublicError('invalid_access');
    return Object.freeze({ removed: true });
  }

  #command(input: {
    readonly installationId: string;
    readonly subjectUid: string;
  }): Readonly<ClientSessionCommand> {
    if (
      !INSTALLATION_ID_PATTERN.test(input.installationId)
      || !SUBJECT_UID_PATTERN.test(input.subjectUid)
    ) throw new ClientAccessPublicError('invalid_access');
    const installationHashes = this.#installationHasher.lookupCandidates(input.installationId);
    return Object.freeze({
      currentInstallationHash: installationHashes[0]!,
      installationHashes,
      nowMs: this.#nowMs(),
      resourceResolutionMode: this.#resourceResolutionMode,
      subjectUid: input.subjectUid,
    });
  }
}
