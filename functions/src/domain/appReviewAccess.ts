import { createHash, randomBytes } from 'node:crypto';

import type { CryptographicRandomSource } from '../security/accessCodeGenerator.js';
import type { HmacDigest } from '../security/versionedHmac.js';
import { VersionedHmac } from '../security/versionedHmac.js';

const INSTALLATION_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/u;
const SOURCE_ADDRESS_PATTERN = /^[0-9A-Fa-f:.]{3,64}$/u;

export const APP_REVIEW_SAMPLE_RESOURCE = Object.freeze({
  access: 'client' as const,
  iconKey: 'featured',
  id: 'review-sandbox-app-review-sample-v1',
  summary: Object.freeze({
    en: 'A fixed, non-clinical sample prepared only for App Review.',
    es: 'Una muestra fija y no clínica preparada sólo para App Review.',
  }),
  title: Object.freeze({ en: 'App Review Sample', es: 'Muestra para App Review' }),
});

export interface AppReviewCredentialStatus {
  readonly configured: boolean;
  readonly generation: number | null;
  readonly purpose: 'app_review';
  readonly rotatedAtMs: number | null;
}

export interface AppReviewGrantView {
  readonly credentialGeneration: number;
  readonly expiresAtMs: null;
  readonly purpose: 'app_review';
  readonly resources: readonly [typeof APP_REVIEW_SAMPLE_RESOURCE];
  readonly schemaVersion: 1;
  readonly scope: 'review_sandbox';
  readonly status: 'active';
}

export interface AppReviewRotateCommand {
  readonly credentialLookup: Readonly<HmacDigest>;
  readonly expectedGeneration: number | null;
  readonly rotatedAtMs: number;
}

export interface AppReviewRedeemCommand {
  readonly credentialLookups: readonly Readonly<HmacDigest>[];
  readonly currentCredentialLookup: Readonly<HmacDigest>;
  readonly currentInstallationLookup: Readonly<HmacDigest>;
  readonly installationLookups: readonly Readonly<HmacDigest>[];
  readonly nowMs: number;
  readonly rateLimitBuckets: readonly Readonly<{
    clearOnSuccess: boolean;
    lookupId: string;
    maximumFailures: number;
  }>[];
  readonly requestIdHash: string;
}

export interface AppReviewRefreshCommand {
  readonly currentInstallationLookup: Readonly<HmacDigest>;
  readonly installationLookups: readonly Readonly<HmacDigest>[];
  readonly nowMs: number;
  readonly subjectUid: string;
}

export interface AppReviewCreateLaunchCommand {
  readonly currentInstallationLookup: Readonly<HmacDigest>;
  readonly expiresAtMs: number;
  readonly installationLookups: readonly Readonly<HmacDigest>[];
  readonly nonceLookup: Readonly<HmacDigest>;
  readonly nowMs: number;
  readonly subjectUid: string;
}

export type AppReviewRedemptionResult =
  | Readonly<{ grant: AppReviewGrantView; kind: 'granted'; subjectUid: string }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'rate_limited'; retryAfterSeconds: number }>;

export interface AppReviewSandboxStore {
  createLaunch(command: AppReviewCreateLaunchCommand): Promise<'created' | 'invalid'>;
  credentialStatus(): Promise<AppReviewCredentialStatus>;
  redeem(command: AppReviewRedeemCommand): Promise<AppReviewRedemptionResult>;
  refresh(command: AppReviewRefreshCommand): Promise<AppReviewGrantView | 'invalid'>;
  rotateCredential(command: AppReviewRotateCommand): Promise<AppReviewCredentialStatus | 'conflict'>;
}

export interface AppReviewTokenIssuer {
  createCustomToken(
    subjectUid: string,
    claims: Readonly<{ authority: 'app_review' }>,
  ): Promise<string>;
}

export class AppReviewCredentialConflictError extends Error {
  constructor() {
    super('app_review_generation_conflict');
    this.name = 'AppReviewCredentialConflictError';
  }
}

export class AppReviewInputError extends Error {
  readonly code: 'invalid_access' | 'rate_limited';
  readonly retryAfterSeconds: number | undefined;

  constructor(code: 'invalid_access' | 'rate_limited', retryAfterSeconds?: number) {
    super(code);
    this.name = 'AppReviewInputError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AppReviewCredentialService {
  readonly #credentialHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #randomSource: CryptographicRandomSource;
  readonly #store: AppReviewSandboxStore;

  constructor(dependencies: Readonly<{
    credentialHasher: VersionedHmac;
    nowMs?: () => number;
    randomSource?: CryptographicRandomSource;
    store: AppReviewSandboxStore;
  }>) {
    this.#credentialHasher = dependencies.credentialHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#randomSource = dependencies.randomSource ?? randomBytes;
    this.#store = dependencies.store;
  }

  status(): Promise<AppReviewCredentialStatus> {
    return this.#store.credentialStatus();
  }

  async rotate(input: Readonly<{ expectedGeneration: number | null }>): Promise<Readonly<{
    oneTimeCredential: string;
    status: AppReviewCredentialStatus;
  }>> {
    if (!(input.expectedGeneration === null || (
      Number.isSafeInteger(input.expectedGeneration) && input.expectedGeneration >= 1
    ))) throw new AppReviewInputError('invalid_access');
    const nowMs = this.#nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('invalid_server_time');
    const oneTimeCredential = generateAppReviewCredential(this.#randomSource);
    const result = await this.#store.rotateCredential(Object.freeze({
      credentialLookup: this.#credentialHasher.currentDigest(oneTimeCredential),
      expectedGeneration: input.expectedGeneration,
      rotatedAtMs: nowMs,
    }));
    if (result === 'conflict') throw new AppReviewCredentialConflictError();
    return Object.freeze({ oneTimeCredential, status: result });
  }
}

export class AppReviewAccessRedeemer {
  readonly #credentialHasher: VersionedHmac;
  readonly #installationHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #rateLimitHasher: VersionedHmac;
  readonly #store: AppReviewSandboxStore;
  readonly #tokenIssuer: AppReviewTokenIssuer;

  constructor(dependencies: Readonly<{
    credentialHasher: VersionedHmac;
    installationHasher: VersionedHmac;
    nowMs?: () => number;
    rateLimitHasher: VersionedHmac;
    store: AppReviewSandboxStore;
    tokenIssuer: AppReviewTokenIssuer;
  }>) {
    this.#credentialHasher = dependencies.credentialHasher;
    this.#installationHasher = dependencies.installationHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#rateLimitHasher = dependencies.rateLimitHasher;
    this.#store = dependencies.store;
    this.#tokenIssuer = dependencies.tokenIssuer;
  }

  async redeem(input: Readonly<{
    credential: string;
    installationId: string;
    requestId: string;
    sourceAddress: string;
  }>): Promise<Readonly<{ customToken: string; grant: AppReviewGrantView }>> {
    if (
      !INSTALLATION_PATTERN.test(input.installationId)
      || !REQUEST_ID_PATTERN.test(input.requestId)
      || !SOURCE_ADDRESS_PATTERN.test(input.sourceAddress)
    ) throw new AppReviewInputError('invalid_access');
    const normalized = normalizeAppReviewCredential(input.credential);
    const credentialMaterial = normalized ?? `invalid:${createHash('sha256')
      .update(input.credential.slice(0, 256), 'utf8')
      .update(`\0${input.credential.length}`, 'utf8')
      .digest('base64url')}`;
    const credentialLookups = this.#credentialHasher.lookupCandidates(credentialMaterial);
    const installationLookups = this.#installationHasher.lookupCandidates(input.installationId);
    const currentInstallationLookup = installationLookups[0]!;
    const sourceBucket = this.#rateLimitHasher.currentDigest(`source\0${input.sourceAddress}`).lookupId;
    const installationBucket = this.#rateLimitHasher.currentDigest(
      `installation\0${input.sourceAddress}\0${currentInstallationLookup.digest}`,
    ).lookupId;
    const requestIdHash = this.#rateLimitHasher.currentDigest(
      `${input.requestId}\0${currentInstallationLookup.digest}\0${credentialLookups[0]!.lookupId}`,
    ).lookupId;
    const result = await this.#store.redeem(Object.freeze({
      credentialLookups,
      currentCredentialLookup: credentialLookups[0]!,
      currentInstallationLookup,
      installationLookups,
      nowMs: this.#nowMs(),
      rateLimitBuckets: Object.freeze([
        Object.freeze({ clearOnSuccess: false, lookupId: sourceBucket, maximumFailures: 10 }),
        Object.freeze({ clearOnSuccess: true, lookupId: installationBucket, maximumFailures: 5 }),
      ]),
      requestIdHash,
    }));
    if (result.kind === 'invalid') throw new AppReviewInputError('invalid_access');
    if (result.kind === 'rate_limited') {
      throw new AppReviewInputError('rate_limited', result.retryAfterSeconds);
    }
    const customToken = await this.#tokenIssuer.createCustomToken(
      result.subjectUid,
      Object.freeze({ authority: 'app_review' }),
    );
    return Object.freeze({ customToken, grant: result.grant });
  }
}

export class AppReviewSessionManager {
  readonly #installationHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #store: AppReviewSandboxStore;

  constructor(dependencies: Readonly<{
    installationHasher: VersionedHmac;
    nowMs?: () => number;
    store: AppReviewSandboxStore;
  }>) {
    this.#installationHasher = dependencies.installationHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#store = dependencies.store;
  }

  async refresh(input: Readonly<{
    installationId: string;
    subjectUid: string;
  }>): Promise<AppReviewGrantView> {
    if (
      !INSTALLATION_PATTERN.test(input.installationId)
      || !/^review_[A-Za-z0-9_-]{32}$/u.test(input.subjectUid)
    ) throw new AppReviewInputError('invalid_access');
    const installationLookups = this.#installationHasher.lookupCandidates(input.installationId);
    const result = await this.#store.refresh(Object.freeze({
      currentInstallationLookup: installationLookups[0]!,
      installationLookups,
      nowMs: this.#nowMs(),
      subjectUid: input.subjectUid,
    }));
    if (result === 'invalid') throw new AppReviewInputError('invalid_access');
    return result;
  }
}

export class AppReviewLaunchService {
  readonly #installationHasher: VersionedHmac;
  readonly #nonceHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #randomSource: CryptographicRandomSource;
  readonly #store: AppReviewSandboxStore;

  constructor(dependencies: Readonly<{
    installationHasher: VersionedHmac;
    nonceHasher: VersionedHmac;
    nowMs?: () => number;
    randomSource?: CryptographicRandomSource;
    store: AppReviewSandboxStore;
  }>) {
    this.#installationHasher = dependencies.installationHasher;
    this.#nonceHasher = dependencies.nonceHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#randomSource = dependencies.randomSource ?? randomBytes;
    this.#store = dependencies.store;
  }

  async create(input: Readonly<{
    installationId: string;
    subjectUid: string;
  }>): Promise<Readonly<{
    expiresAtMs: number;
    launchUrl: 'https://cabohealth.org/apps/app-review/launch/';
    method: 'POST';
    nonce: string;
  }>> {
    if (
      !INSTALLATION_PATTERN.test(input.installationId)
      || !/^review_[A-Za-z0-9_-]{32}$/u.test(input.subjectUid)
    ) throw new AppReviewInputError('invalid_access');
    const bytes = this.#randomSource(24);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 24) {
      throw new Error('cryptographic_random_source_failed');
    }
    const nonce = bytes.toString('base64url');
    const nowMs = this.#nowMs();
    const expiresAtMs = nowMs + 60_000;
    const installationLookups = this.#installationHasher.lookupCandidates(input.installationId);
    const result = await this.#store.createLaunch(Object.freeze({
      currentInstallationLookup: installationLookups[0]!,
      expiresAtMs,
      installationLookups,
      nonceLookup: this.#nonceHasher.currentDigest(nonce),
      nowMs,
      subjectUid: input.subjectUid,
    }));
    if (result !== 'created') throw new AppReviewInputError('invalid_access');
    return Object.freeze({
      expiresAtMs,
      launchUrl: 'https://cabohealth.org/apps/app-review/launch/',
      method: 'POST',
      nonce,
    });
  }
}

function generateAppReviewCredential(randomSource: CryptographicRandomSource): string {
  const entropy = randomSource(16);
  if (!Buffer.isBuffer(entropy) || entropy.length !== 16) {
    throw new Error('cryptographic_random_source_failed');
  }
  const encoded = entropy.toString('hex').toUpperCase();
  return `AR-${encoded.match(/.{8}/gu)!.join('-')}`;
}

function normalizeAppReviewCredential(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 96 || /[\u0000-\u001f\u007f]/u.test(raw)) {
    return null;
  }
  const normalized = raw.trim().toUpperCase().replace(/[\u2010-\u2015\u2212]/gu, '-');
  const body = normalized.startsWith('AR-') ? normalized.slice(3) : normalized;
  const compact = body.replace(/[ -]/gu, '');
  if (!/^[A-F0-9]{32}$/u.test(compact)) return null;
  return `AR-${compact.match(/.{8}/gu)!.join('-')}`;
}
