import { createHash } from 'node:crypto';

import {
  generateAccessCode,
  type CryptographicRandomSource,
} from '../security/accessCodeGenerator.js';
import { VersionedHmac } from '../security/versionedHmac.js';

const MAX_RESOURCE_IDS = 12;
const MAX_CODE_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;
const RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface AccessCodeCreateRecord {
  readonly codeId: string;
  readonly createdAtMs: number;
  readonly displaySuffix: string;
  readonly expiresAtMs: number;
  readonly hashVersion: string;
  readonly lookupId: string;
  readonly purpose: 'cabohealth_client';
  readonly resourceIds: readonly string[];
  readonly scope: 'production_client';
  readonly status: 'active';
}

export interface AccessCodeStore {
  createActiveCode(record: AccessCodeCreateRecord): Promise<'created' | 'collision' | 'invalid_resource'>;
}

export interface IssuedAccessCode {
  readonly oneTimeCode: string;
  readonly summary: {
    readonly codeId: string;
    readonly displaySuffix: string;
    readonly expiresAtMs: number;
    readonly resourceIds: readonly string[];
    readonly status: 'active';
  };
}

export class AccessCodeInputError extends Error {
  readonly code = 'invalid_admin_input';

  constructor() {
    super('invalid_admin_input');
    this.name = 'AccessCodeInputError';
  }
}

export class AccessCodeIssuer {
  readonly #codeHasher: VersionedHmac;
  readonly #nowMs: () => number;
  readonly #randomSource: CryptographicRandomSource | undefined;
  readonly #store: AccessCodeStore;

  constructor(dependencies: {
    readonly codeHasher: VersionedHmac;
    readonly nowMs?: () => number;
    readonly randomSource?: CryptographicRandomSource;
    readonly store: AccessCodeStore;
  }) {
    this.#codeHasher = dependencies.codeHasher;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#randomSource = dependencies.randomSource;
    this.#store = dependencies.store;
  }

  async issue(input: {
    readonly expiresAtMs: number;
    readonly resourceIds: readonly string[];
  }): Promise<Readonly<IssuedAccessCode>> {
    const nowMs = this.#nowMs();
    const resourceIds = [...new Set(input.resourceIds)];
    if (
      !Number.isSafeInteger(input.expiresAtMs)
      || input.expiresAtMs <= nowMs
      || input.expiresAtMs > nowMs + MAX_CODE_LIFETIME_MS
      || resourceIds.length === 0
      || resourceIds.length > MAX_RESOURCE_IDS
      || resourceIds.some((resourceId) => !RESOURCE_ID_PATTERN.test(resourceId))
    ) {
      throw new AccessCodeInputError();
    }

    const oneTimeCode = this.#randomSource
      ? generateAccessCode(this.#randomSource)
      : generateAccessCode();
    const digest = this.#codeHasher.currentDigest(oneTimeCode);
    const codeId = `ac_${createHash('sha256').update(digest.lookupId, 'utf8').digest('base64url').slice(0, 32)}`;
    const record: Readonly<AccessCodeCreateRecord> = Object.freeze({
      codeId,
      createdAtMs: nowMs,
      displaySuffix: oneTimeCode.slice(-4),
      expiresAtMs: input.expiresAtMs,
      hashVersion: digest.version,
      lookupId: digest.lookupId,
      purpose: 'cabohealth_client',
      resourceIds: Object.freeze(resourceIds),
      scope: 'production_client',
      status: 'active',
    });

    const result = await this.#store.createActiveCode(record);
    if (result === 'invalid_resource') throw new AccessCodeInputError();
    if (result === 'collision') throw new Error('access_code_collision');

    return Object.freeze({
      oneTimeCode,
      summary: Object.freeze({
        codeId,
        displaySuffix: record.displaySuffix,
        expiresAtMs: record.expiresAtMs,
        resourceIds: record.resourceIds,
        status: record.status,
      }),
    });
  }
}
