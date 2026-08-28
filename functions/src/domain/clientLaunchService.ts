import { randomBytes } from 'node:crypto';

import { type CryptographicRandomSource } from '../security/accessCodeGenerator.js';
import { type HmacDigest, VersionedHmac } from '../security/versionedHmac.js';
import { ClientAccessPublicError } from './clientAccessRedeemer.js';

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const SUBJECT_UID_PATTERN = /^client_[A-Za-z0-9_-]{32}$/u;
const MAX_RESOURCE_ID_LENGTH = 64;
const RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/u;
const LAUNCH_LIFETIME_MS = 60_000;

export interface CreateLaunchCommand {
  readonly currentInstallationHash: Readonly<HmacDigest>;
  readonly expiresAtMs: number;
  readonly installationHashes: readonly Readonly<HmacDigest>[];
  readonly nonceLookup: Readonly<HmacDigest>;
  readonly nowMs: number;
  readonly resourceId: string;
  readonly subjectUid: string;
}

export interface ConsumeLaunchCommand {
  readonly nonceLookups: readonly Readonly<HmacDigest>[];
  readonly nowMs: number;
}

export interface ClientLaunchStore {
  createLaunch(command: Readonly<CreateLaunchCommand>): Promise<'created' | 'invalid'>;
  createLaunchV2(command: Readonly<CreateLaunchCommand>): Promise<Readonly<
    | { kind: 'broker'; expiresAtMs: number }
    | { kind: 'external_https'; expiresAtMs: number; url: string }
    | { kind: 'invalid' }
  >>;
  consumeLaunch(command: Readonly<ConsumeLaunchCommand>): Promise<
    Readonly<{ kind: 'consumed'; resourceId: string } | { kind: 'invalid' }>
  >;
}

export type ClientLaunchV2 = Readonly<
  | {
    kind: 'broker';
    expiresAtMs: number;
    launchUrl: 'https://cabohealth.org/apps/client-resources/launch/';
    method: 'POST';
    nonce: string;
  }
  | { kind: 'external_https'; expiresAtMs: number; url: string }
>;

export class ClientLaunchService {
  readonly #installationHasher: VersionedHmac;
  readonly #nonceHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #randomSource: CryptographicRandomSource | undefined;
  readonly #store: ClientLaunchStore;

  constructor(dependencies: {
    readonly installationHasher: VersionedHmac;
    readonly nonceHasher: VersionedHmac;
    readonly nowMs?: () => number;
    readonly randomSource?: CryptographicRandomSource;
    readonly store: ClientLaunchStore;
  }) {
    this.#installationHasher = dependencies.installationHasher;
    this.#nonceHasher = dependencies.nonceHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#randomSource = dependencies.randomSource;
    this.#store = dependencies.store;
  }

  async create(input: {
    readonly installationId: string;
    readonly resourceId: string;
    readonly subjectUid: string;
  }): Promise<Readonly<{
    expiresAtMs: number;
    launchUrl: 'https://cabohealth.org/apps/client-resources/launch/';
    method: 'POST';
    nonce: string;
  }>> {
    if (
      !INSTALLATION_ID_PATTERN.test(input.installationId)
      || input.resourceId.length > MAX_RESOURCE_ID_LENGTH
      || !RESOURCE_ID_PATTERN.test(input.resourceId)
      || !SUBJECT_UID_PATTERN.test(input.subjectUid)
    ) throw new ClientAccessPublicError('invalid_access');
    const installationHashes = this.#installationHasher.lookupCandidates(input.installationId);
    const random = this.#randomSource
      ? this.#randomSource(24)
      : randomBytes(24);
    if (random.length !== 24) throw new Error('cryptographic_random_source_failed');
    const nonce = random.toString('base64url');
    const nowMs = this.#nowMs();
    const expiresAtMs = nowMs + LAUNCH_LIFETIME_MS;
    const result = await this.#store.createLaunch(Object.freeze({
      currentInstallationHash: installationHashes[0]!,
      expiresAtMs,
      installationHashes,
      nonceLookup: this.#nonceHasher.currentDigest(nonce),
      nowMs,
      resourceId: input.resourceId,
      subjectUid: input.subjectUid,
    }));
    if (result !== 'created') throw new ClientAccessPublicError('invalid_access');
    return Object.freeze({
      expiresAtMs,
      launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
      method: 'POST',
      nonce,
    });
  }

  async createV2(input: {
    readonly installationId: string;
    readonly resourceId: string;
    readonly subjectUid: string;
  }): Promise<ClientLaunchV2> {
    if (
      !INSTALLATION_ID_PATTERN.test(input.installationId)
      || input.resourceId.length > MAX_RESOURCE_ID_LENGTH
      || !RESOURCE_ID_PATTERN.test(input.resourceId)
      || !SUBJECT_UID_PATTERN.test(input.subjectUid)
    ) throw new ClientAccessPublicError('invalid_access');
    const installationHashes = this.#installationHasher.lookupCandidates(input.installationId);
    const random = this.#randomSource
      ? this.#randomSource(24)
      : randomBytes(24);
    if (random.length !== 24) throw new Error('cryptographic_random_source_failed');
    const nonce = random.toString('base64url');
    const nowMs = this.#nowMs();
    const result = await this.#store.createLaunchV2(Object.freeze({
      currentInstallationHash: installationHashes[0]!,
      expiresAtMs: nowMs + LAUNCH_LIFETIME_MS,
      installationHashes,
      nonceLookup: this.#nonceHasher.currentDigest(nonce),
      nowMs,
      resourceId: input.resourceId,
      subjectUid: input.subjectUid,
    }));
    if (result.kind === 'invalid') throw new ClientAccessPublicError('invalid_access');
    if (result.kind === 'external_https') return result;
    return Object.freeze({
      kind: 'broker' as const,
      expiresAtMs: result.expiresAtMs,
      launchUrl: 'https://cabohealth.org/apps/client-resources/launch/' as const,
      method: 'POST' as const,
      nonce,
    });
  }

  async consume(input: { readonly nonce: string }): Promise<Readonly<{ resourceId: string }>> {
    if (!NONCE_PATTERN.test(input.nonce)) throw new ClientAccessPublicError('invalid_access');
    const result = await this.#store.consumeLaunch(Object.freeze({
      nonceLookups: this.#nonceHasher.lookupCandidates(input.nonce),
      nowMs: this.#nowMs(),
    }));
    if (result.kind !== 'consumed') throw new ClientAccessPublicError('invalid_access');
    return Object.freeze({ resourceId: result.resourceId });
  }
}
