import {
  createHmac,
  createSecretKey,
  KeyObject,
  timingSafeEqual,
} from 'node:crypto';

const VERSION_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const MINIMUM_PEPPER_BYTES = 32;

export interface HmacDigest {
  readonly digest: string;
  readonly lookupId: string;
  readonly version: string;
}

export interface PepperRing {
  readonly currentVersion: string;
  acceptedVersions(): readonly string[];
  keyFor(version: string): KeyObject;
}

class MemoryPepperRing implements PepperRing {
  readonly currentVersion: string;
  readonly #keys: ReadonlyMap<string, KeyObject>;

  constructor(currentVersion: string, entries: readonly (readonly [string, Buffer])[]) {
    if (!VERSION_PATTERN.test(currentVersion)) throw new Error('invalid_pepper_version');
    const keys = new Map<string, KeyObject>();
    for (const [version, bytes] of entries) {
      if (!VERSION_PATTERN.test(version)) throw new Error('invalid_pepper_version');
      if (bytes.length < MINIMUM_PEPPER_BYTES) throw new Error('pepper_too_short');
      keys.set(version, createSecretKey(bytes));
    }
    if (!keys.has(currentVersion)) throw new Error('current_pepper_missing');
    this.currentVersion = currentVersion;
    this.#keys = keys;
  }

  acceptedVersions(): readonly string[] {
    return Object.freeze([
      this.currentVersion,
      ...[...this.#keys.keys()].filter((version) => version !== this.currentVersion),
    ]);
  }

  keyFor(version: string): KeyObject {
    const key = this.#keys.get(version);
    if (!key) throw new Error('pepper_version_missing');
    return key;
  }
}

export function parsePepperRingSecret(secretValue: string): PepperRing {
  const decodedKeys: Buffer[] = [];
  try {
    const parsed: unknown = JSON.parse(secretValue);
    if (!isRecord(parsed) || typeof parsed.currentVersion !== 'string' || !isRecord(parsed.keys)) {
      throw new Error('invalid');
    }
    const keyEntries = Object.entries(parsed.keys);
    if (keyEntries.length === 0 || keyEntries.length > 3) throw new Error('invalid');
    const entries: [string, Buffer][] = [];
    for (const [version, encoded] of keyEntries) {
      if (
        typeof encoded !== 'string'
        || encoded.length > 256
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
      ) throw new Error('invalid');
      const bytes = Buffer.from(encoded, 'base64');
      decodedKeys.push(bytes);
      entries.push([version, bytes]);
    }
    return new MemoryPepperRing(parsed.currentVersion, entries);
  } catch {
    throw new Error('invalid_pepper_secret');
  } finally {
    for (const bytes of decodedKeys) bytes.fill(0);
  }
}

export class VersionedHmac {
  readonly #namespace: string;
  readonly #ring: PepperRing;

  constructor(ring: PepperRing, namespace = 'cabohealth/access-code/v1') {
    if (!namespace || namespace.length > 80) throw new Error('invalid_hmac_namespace');
    this.#ring = ring;
    this.#namespace = namespace;
  }

  static fromTestKeys(input: {
    readonly currentVersion: string;
    readonly keys: Readonly<Record<string, string>>;
  }): VersionedHmac {
    return new VersionedHmac(new MemoryPepperRing(
      input.currentVersion,
      Object.entries(input.keys).map(([version, value]) => [version, Buffer.from(value, 'utf8')]),
    ));
  }

  currentDigest(value: string): Readonly<HmacDigest> {
    return this.#digest(this.#ring.currentVersion, value);
  }

  lookupCandidates(value: string): readonly Readonly<HmacDigest>[] {
    return Object.freeze(
      this.#ring.acceptedVersions().map((version) => this.#digest(version, value)),
    );
  }

  matches(candidate: string, expected: string): boolean {
    const left = Buffer.from(candidate, 'base64url');
    const right = Buffer.from(expected, 'base64url');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  #digest(version: string, value: string): Readonly<HmacDigest> {
    const digest = createHmac('sha256', this.#ring.keyFor(version))
      .update(this.#namespace, 'utf8')
      .update('\0', 'utf8')
      .update(value, 'utf8')
      .digest('base64url');
    return Object.freeze({
      digest,
      lookupId: `${version}_${digest}`,
      version,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
