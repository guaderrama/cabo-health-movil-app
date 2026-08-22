import { randomBytes } from 'node:crypto';

import { type CryptographicRandomSource } from '../security/accessCodeGenerator.js';
import { type HmacDigest, VersionedHmac } from '../security/versionedHmac.js';
import { ClientAccessPublicError } from './clientAccessRedeemer.js';

const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const REQUEST_HASH_PATTERN = /^[A-Za-z0-9_-]{24,128}$/u;
const WEB_SESSION_LIFETIME_MS = 60 * 60 * 1_000;

export interface WebSessionStore {
  redeemLaunchForWeb(command: Readonly<{
    brokerRequestHash: string;
    expiresNoLaterThanMs: number;
    nonceLookups: readonly Readonly<HmacDigest>[];
    nowMs: number;
    sessionLookup: Readonly<HmacDigest>;
  }>): Promise<Readonly<{ expiresAtMs: number; kind: 'created' } | { kind: 'invalid' }>>;
  introspectWebSession(command: Readonly<{
    brokerRequestHash: string;
    currentSessionLookup: Readonly<HmacDigest>;
    nowMs: number;
    sessionLookups: readonly Readonly<HmacDigest>[];
  }>): Promise<Readonly<{
    entitlements: readonly string[];
    expiresAtMs: number;
    kind: 'active';
  } | { kind: 'invalid' }>>;
  revokeWebSession(command: Readonly<{
    brokerRequestHash: string;
    nowMs: number;
    sessionLookups: readonly Readonly<HmacDigest>[];
  }>): Promise<'revoked' | 'invalid'>;
}

export class WebSessionBroker {
  readonly #csrfHasher: VersionedHmac;
  readonly #nonceHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #randomSource: CryptographicRandomSource | undefined;
  readonly #sessionHasher: VersionedHmac;
  readonly #store: WebSessionStore;

  constructor(dependencies: {
    readonly csrfHasher: VersionedHmac;
    readonly nonceHasher: VersionedHmac;
    readonly nowMs?: () => number;
    readonly randomSource?: CryptographicRandomSource;
    readonly sessionHasher: VersionedHmac;
    readonly store: WebSessionStore;
  }) {
    this.#csrfHasher = dependencies.csrfHasher;
    this.#nonceHasher = dependencies.nonceHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#randomSource = dependencies.randomSource;
    this.#sessionHasher = dependencies.sessionHasher;
    this.#store = dependencies.store;
  }

  async redeemLaunch(input: {
    readonly brokerRequestHash: string;
    readonly nonce: string;
  }): Promise<Readonly<{ expiresAtMs: number; sessionId: string }>> {
    if (!NONCE_PATTERN.test(input.nonce) || !REQUEST_HASH_PATTERN.test(input.brokerRequestHash)) {
      throw new ClientAccessPublicError('invalid_access');
    }
    const bytes = this.#randomSource ? this.#randomSource(32) : randomBytes(32);
    if (bytes.length !== 32) throw new Error('cryptographic_random_source_failed');
    const sessionId = bytes.toString('base64url');
    const nowMs = this.#nowMs();
    const result = await this.#store.redeemLaunchForWeb(Object.freeze({
      brokerRequestHash: input.brokerRequestHash,
      expiresNoLaterThanMs: nowMs + WEB_SESSION_LIFETIME_MS,
      nonceLookups: this.#nonceHasher.lookupCandidates(input.nonce),
      nowMs,
      sessionLookup: this.#sessionHasher.currentDigest(sessionId),
    }));
    if (result.kind !== 'created') throw new ClientAccessPublicError('invalid_access');
    return Object.freeze({ expiresAtMs: result.expiresAtMs, sessionId });
  }

  async introspect(input: {
    readonly brokerRequestHash: string;
    readonly sessionId: string;
  }): Promise<Readonly<{
    active: true;
    csrfToken: string;
    entitlements: readonly string[];
    expiresAtMs: number;
  }>> {
    this.#validateSessionInput(input);
    const sessionLookups = this.#sessionHasher.lookupCandidates(input.sessionId);
    const result = await this.#store.introspectWebSession(Object.freeze({
      brokerRequestHash: input.brokerRequestHash,
      currentSessionLookup: sessionLookups[0]!,
      nowMs: this.#nowMs(),
      sessionLookups,
    }));
    if (result.kind !== 'active') throw new ClientAccessPublicError('invalid_access');
    return Object.freeze({
      active: true,
      csrfToken: this.#csrfHasher.currentDigest(input.sessionId).digest,
      entitlements: result.entitlements,
      expiresAtMs: result.expiresAtMs,
    });
  }

  async revoke(input: {
    readonly brokerRequestHash: string;
    readonly csrfToken: string;
    readonly sessionId: string;
  }): Promise<Readonly<{ revoked: true }>> {
    this.#validateSessionInput(input);
    if (!CSRF_TOKEN_PATTERN.test(input.csrfToken)) {
      throw new ClientAccessPublicError('invalid_access');
    }
    const validCsrf = this.#csrfHasher.lookupCandidates(input.sessionId).some(({ digest }) => (
      this.#csrfHasher.matches(input.csrfToken, digest)
    ));
    if (!validCsrf) throw new ClientAccessPublicError('invalid_access');
    const result = await this.#store.revokeWebSession(Object.freeze({
      brokerRequestHash: input.brokerRequestHash,
      nowMs: this.#nowMs(),
      sessionLookups: this.#sessionHasher.lookupCandidates(input.sessionId),
    }));
    if (result !== 'revoked') throw new ClientAccessPublicError('invalid_access');
    return Object.freeze({ revoked: true });
  }

  #validateSessionInput(input: { brokerRequestHash: string; sessionId: string }): void {
    if (
      !SESSION_ID_PATTERN.test(input.sessionId)
      || !REQUEST_HASH_PATTERN.test(input.brokerRequestHash)
    ) throw new ClientAccessPublicError('invalid_access');
  }
}
