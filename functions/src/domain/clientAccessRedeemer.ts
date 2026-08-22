import { createHash } from 'node:crypto';

import { normalizeAccessCode } from '../security/accessCodeGenerator.js';
import { type HmacDigest, VersionedHmac } from '../security/versionedHmac.js';

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/u;
const SOURCE_ADDRESS_PATTERN = /^[0-9A-Fa-f:.]{3,64}$/u;

export interface ClientResourceView {
  readonly access: 'client';
  readonly iconKey: string;
  readonly id: string;
  readonly summary: Readonly<{ en: string; es: string }>;
  readonly title: Readonly<{ en: string; es: string }>;
}

export interface ClientGrantView {
  readonly expiresAtMs: number;
  readonly resources: readonly Readonly<ClientResourceView>[];
  readonly schemaVersion: 1;
  readonly status: 'active';
}

export interface RedeemCommand {
  readonly codeLookups: readonly Readonly<HmacDigest>[];
  readonly currentCodeLookup: Readonly<HmacDigest>;
  readonly currentInstallationHash: Readonly<HmacDigest>;
  readonly installationHashes: readonly Readonly<HmacDigest>[];
  readonly nowMs: number;
  readonly rateLimitBuckets: readonly Readonly<{
    clearOnSuccess: boolean;
    lookupId: string;
    maximumFailures: number;
  }>[];
  readonly requestIdHash: string;
}

export type RedemptionResult =
  | Readonly<{ kind: 'granted'; grant: Readonly<ClientGrantView>; subjectUid: string }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'rate_limited'; retryAfterSeconds: number }>;

export interface RedemptionStore {
  redeem(command: Readonly<RedeemCommand>): Promise<RedemptionResult>;
}

export interface CustomTokenIssuer {
  createCustomToken(subjectUid: string): Promise<string>;
}

export class ClientAccessPublicError extends Error {
  readonly code: 'invalid_access' | 'rate_limited';
  readonly retryAfterSeconds: number | undefined;

  constructor(code: 'invalid_access' | 'rate_limited', retryAfterSeconds?: number) {
    super(code);
    this.code = code;
    this.name = 'ClientAccessPublicError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ClientAccessRedeemer {
  readonly #codeHasher: VersionedHmac;
  readonly #installationHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #rateLimitHasher: VersionedHmac;
  readonly #store: RedemptionStore;
  readonly #tokenIssuer: CustomTokenIssuer;

  constructor(dependencies: {
    readonly codeHasher: VersionedHmac;
    readonly installationHasher: VersionedHmac;
    readonly nowMs?: () => number;
    readonly rateLimitHasher: VersionedHmac;
    readonly store: RedemptionStore;
    readonly tokenIssuer: CustomTokenIssuer;
  }) {
    this.#codeHasher = dependencies.codeHasher;
    this.#installationHasher = dependencies.installationHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#rateLimitHasher = dependencies.rateLimitHasher;
    this.#store = dependencies.store;
    this.#tokenIssuer = dependencies.tokenIssuer;
  }

  async redeem(input: {
    readonly code: string;
    readonly installationId: string;
    readonly requestId: string;
    readonly sourceAddress: string;
  }): Promise<Readonly<{ customToken: string; grant: Readonly<ClientGrantView> }>> {
    const normalizedCode = normalizeAccessCode(input.code);
    if (
      !INSTALLATION_ID_PATTERN.test(input.installationId)
      || !REQUEST_ID_PATTERN.test(input.requestId)
      || !SOURCE_ADDRESS_PATTERN.test(input.sourceAddress)
    ) {
      throw new ClientAccessPublicError('invalid_access');
    }

    const installationHashes = this.#installationHasher.lookupCandidates(input.installationId);
    const currentInstallationHash = installationHashes[0]!;
    const sourceBucketId = this.#rateLimitHasher.currentDigest(
      `source\0${input.sourceAddress}`,
    ).lookupId;
    const installationBucketId = this.#rateLimitHasher.currentDigest(
      `installation\0${input.sourceAddress}\0${currentInstallationHash.digest}`,
    ).lookupId;
    const codeMaterial = normalizedCode ?? `invalid:${createHash('sha256')
      .update(input.code.slice(0, 256), 'utf8')
      .update(`\0${input.code.length}`, 'utf8')
      .digest('base64url')}`;
    const codeLookups = this.#codeHasher.lookupCandidates(codeMaterial);
    const requestIdHash = this.#rateLimitHasher.currentDigest(
      `${input.requestId}\0${currentInstallationHash.digest}\0${codeLookups[0]!.lookupId}`,
    ).lookupId;
    const result = await this.#store.redeem(Object.freeze({
      codeLookups,
      currentCodeLookup: codeLookups[0]!,
      currentInstallationHash,
      installationHashes,
      nowMs: this.#nowMs(),
      rateLimitBuckets: Object.freeze([
        Object.freeze({ clearOnSuccess: false, lookupId: sourceBucketId, maximumFailures: 10 }),
        Object.freeze({ clearOnSuccess: true, lookupId: installationBucketId, maximumFailures: 5 }),
      ]),
      requestIdHash,
    }));

    if (result.kind === 'invalid') throw new ClientAccessPublicError('invalid_access');
    if (result.kind === 'rate_limited') {
      throw new ClientAccessPublicError('rate_limited', result.retryAfterSeconds);
    }

    const customToken = await this.#tokenIssuer.createCustomToken(result.subjectUid);
    return Object.freeze({ customToken, grant: result.grant });
  }
}
