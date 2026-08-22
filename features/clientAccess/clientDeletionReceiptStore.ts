import type {
  ClientAccessRealm,
  ClientAccountDeletionStatusResult,
} from './clientAccessController';
import type { ClientInstallationSecureStorage } from './clientInstallationStore';

const RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const RECEIPT_BYTES = 32;
const EXPECTED_COMPLETION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const CLIENT_DELETION_RECEIPT_KEYS = Object.freeze({
  production_client: 'cabohealth.client.deletion-receipt.production.v1',
  review_sandbox: 'cabohealth.client.deletion-receipt.review.v1',
} satisfies Readonly<Record<ClientAccessRealm, string>>);

export interface ClientDeletionReceiptRecord {
  readonly createdAtMs: number;
  readonly deletionReceipt: string;
  readonly lastKnownStatus: Readonly<ClientAccountDeletionStatusResult> | null;
  readonly phase: 'accepted' | 'prepared';
  readonly realm: ClientAccessRealm;
  readonly schemaVersion: 1;
}

export type ClientAccountDeletionTrackingState = Readonly<
  | { kind: 'none' }
  | {
    availability: 'current' | 'offline';
    kind: 'completed' | 'pending';
    realm: ClientAccessRealm;
    status: Readonly<ClientAccountDeletionStatusResult>;
  }
  | {
    kind: 'unavailable';
    phase: 'accepted' | 'corrupt' | 'prepared';
    realm: ClientAccessRealm | null;
  }
>;

export interface ClientAccountDeletionTracker {
  check(): Promise<ClientAccountDeletionTrackingState>;
  acknowledgeCompleted(): Promise<boolean>;
  archiveAccepted(): Promise<boolean>;
}

export type ClientDeletionReceiptLoadResult = Readonly<
  | { kind: 'none' }
  | { kind: 'receipt'; receipt: Readonly<ClientDeletionReceiptRecord> }
  | { kind: 'unavailable'; realms: readonly ClientAccessRealm[] }
>;

export interface ClientDeletionReceiptStore {
  prepare(realm: ClientAccessRealm): Promise<Readonly<ClientDeletionReceiptRecord>>;
  markAccepted(
    receipt: Readonly<ClientDeletionReceiptRecord>,
    status: Readonly<ClientAccountDeletionStatusResult>,
  ): Promise<Readonly<ClientDeletionReceiptRecord>>;
  load(): Promise<ClientDeletionReceiptLoadResult>;
  clear(receipt: Readonly<ClientDeletionReceiptRecord>): Promise<void>;
}

export function createClientDeletionReceiptStore({
  storage,
  randomBytes,
  now = Date.now,
}: {
  readonly storage: ClientInstallationSecureStorage;
  readonly randomBytes: (length: number) => Promise<Uint8Array>;
  readonly now?: () => number;
}): ClientDeletionReceiptStore {
  let operation = Promise.resolve<unknown>(undefined);
  const exclusively = <T>(work: () => Promise<T>): Promise<T> => {
    const next = operation.then(work, work);
    operation = next.then(() => undefined, () => undefined);
    return next;
  };

  const loadUnlocked = async (): Promise<ClientDeletionReceiptLoadResult> => {
    const realms = Object.keys(CLIENT_DELETION_RECEIPT_KEYS) as ClientAccessRealm[];
    const stored = await Promise.all(realms.map(async (realm) => ({
      raw: await storage.getItem(CLIENT_DELETION_RECEIPT_KEYS[realm]),
      realm,
    })));
    const unavailable: ClientAccessRealm[] = [];
    const receipts: Readonly<ClientDeletionReceiptRecord>[] = [];
    for (const candidate of stored) {
      if (candidate.raw === null) continue;
      const parsed = parseStoredReceipt(candidate.raw, candidate.realm);
      if (parsed) receipts.push(parsed);
      else unavailable.push(candidate.realm);
    }
    if (unavailable.length > 0 || receipts.length > 1) {
      return Object.freeze({
        kind: 'unavailable' as const,
        realms: Object.freeze(receipts.length > 1 ? realms : unavailable),
      });
    }
    if (receipts.length === 0) return Object.freeze({ kind: 'none' as const });
    return Object.freeze({ kind: 'receipt' as const, receipt: receipts[0]! });
  };

  return Object.freeze({
    prepare: (realm: ClientAccessRealm) => exclusively(async () => {
      const existing = await loadUnlocked();
      if (existing.kind === 'unavailable') {
        throw new Error('client_deletion_receipt_unavailable');
      }
      if (existing.kind === 'receipt') {
        if (existing.receipt.realm !== realm) {
          throw new Error('client_deletion_receipt_conflict');
        }
        if (existing.receipt.phase !== 'prepared') {
          throw new Error('client_deletion_receipt_already_accepted');
        }
        return existing.receipt;
      }
      const createdAtMs = now();
      if (!isNonnegativeSafeInteger(createdAtMs)) {
        throw new Error('client_deletion_receipt_time_failed');
      }
      const entropy = await randomBytes(RECEIPT_BYTES);
      if (!(entropy instanceof Uint8Array) || entropy.length !== RECEIPT_BYTES) {
        throw new Error('client_deletion_receipt_random_failed');
      }
      const deletionReceipt = encodeBase64Url(entropy);
      if (!RECEIPT_PATTERN.test(deletionReceipt)) {
        throw new Error('client_deletion_receipt_random_failed');
      }
      const created = Object.freeze({
        createdAtMs,
        deletionReceipt,
        lastKnownStatus: null,
        phase: 'prepared' as const,
        realm,
        schemaVersion: 1 as const,
      });
      const key = CLIENT_DELETION_RECEIPT_KEYS[realm];
      const serialized = JSON.stringify(created);
      await storage.setItem(key, serialized);
      if (await storage.getItem(key) !== serialized) {
        throw new Error('client_deletion_receipt_persistence_failed');
      }
      return created;
    }),

    markAccepted: (
      receipt: Readonly<ClientDeletionReceiptRecord>,
      status: Readonly<ClientAccountDeletionStatusResult>,
    ) => exclusively(async () => {
      const parsedStatus = parseDeletionStatus(status);
      if (!parsedStatus) throw new Error('client_deletion_status_invalid');
      const current = await readExactReceipt(storage, receipt);
      if (current.phase === 'accepted' && current.lastKnownStatus?.status === 'completed'
        && parsedStatus.status !== 'completed') {
        throw new Error('client_deletion_receipt_regression');
      }
      const accepted = Object.freeze({
        createdAtMs: current.createdAtMs,
        deletionReceipt: current.deletionReceipt,
        lastKnownStatus: parsedStatus,
        phase: 'accepted' as const,
        realm: current.realm,
        schemaVersion: 1 as const,
      });
      const key = CLIENT_DELETION_RECEIPT_KEYS[current.realm];
      const serialized = JSON.stringify(accepted);
      await storage.setItem(key, serialized);
      if (await storage.getItem(key) !== serialized) {
        throw new Error('client_deletion_receipt_persistence_failed');
      }
      return accepted;
    }),

    load: () => exclusively(loadUnlocked),

    clear: (receipt: Readonly<ClientDeletionReceiptRecord>) => exclusively(async () => {
      const current = await readExactReceipt(storage, receipt);
      const key = CLIENT_DELETION_RECEIPT_KEYS[current.realm];
      await storage.deleteItem(key);
      if (await storage.getItem(key) !== null) {
        throw new Error('client_deletion_receipt_clear_failed');
      }
    }),
  });
}

async function readExactReceipt(
  storage: ClientInstallationSecureStorage,
  expected: Readonly<ClientDeletionReceiptRecord>,
): Promise<Readonly<ClientDeletionReceiptRecord>> {
  if (!isRealm(expected.realm) || !RECEIPT_PATTERN.test(expected.deletionReceipt)) {
    throw new Error('client_deletion_receipt_mismatch');
  }
  const raw = await storage.getItem(CLIENT_DELETION_RECEIPT_KEYS[expected.realm]);
  const current = raw === null ? null : parseStoredReceipt(raw, expected.realm);
  if (!current || current.deletionReceipt !== expected.deletionReceipt) {
    throw new Error('client_deletion_receipt_mismatch');
  }
  return current;
}

function parseStoredReceipt(
  raw: string,
  expectedRealm: ClientAccessRealm,
): Readonly<ClientDeletionReceiptRecord> | null {
  if (raw.length < 1 || raw.length > 2_048) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value)
      || !hasExactKeys(value, [
        'createdAtMs',
        'deletionReceipt',
        'lastKnownStatus',
        'phase',
        'realm',
        'schemaVersion',
      ])
      || value.schemaVersion !== 1
      || value.realm !== expectedRealm
      || !isRealm(value.realm)
      || !isNonnegativeSafeInteger(value.createdAtMs)
      || typeof value.deletionReceipt !== 'string'
      || !RECEIPT_PATTERN.test(value.deletionReceipt)
      || (value.phase !== 'prepared' && value.phase !== 'accepted')
    ) return null;
    const lastKnownStatus = value.lastKnownStatus === null
      ? null
      : parseDeletionStatus(value.lastKnownStatus);
    if (
      (value.phase === 'prepared' && value.lastKnownStatus !== null)
      || (value.phase === 'accepted' && !lastKnownStatus)
    ) return null;
    return Object.freeze({
      createdAtMs: value.createdAtMs,
      deletionReceipt: value.deletionReceipt,
      lastKnownStatus,
      phase: value.phase,
      realm: value.realm,
      schemaVersion: 1,
    });
  } catch {
    return null;
  }
}

export function parseDeletionStatus(
  value: unknown,
): Readonly<ClientAccountDeletionStatusResult> | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'completedAtMs',
      'expectedCompletionByMs',
      'requestedAtMs',
      'schemaVersion',
      'status',
    ])
    || value.schemaVersion !== 1
    || !isDateTimestamp(value.requestedAtMs)
    || !isDateTimestamp(value.expectedCompletionByMs)
    || value.expectedCompletionByMs !== value.requestedAtMs + EXPECTED_COMPLETION_MS
  ) return null;
  if (value.status === 'pending' && value.completedAtMs === null) {
    return Object.freeze({
      completedAtMs: null,
      expectedCompletionByMs: value.expectedCompletionByMs,
      requestedAtMs: value.requestedAtMs,
      schemaVersion: 1,
      status: 'pending',
    });
  }
  if (
    value.status === 'completed'
    && isDateTimestamp(value.completedAtMs)
    && value.completedAtMs >= value.requestedAtMs
  ) {
    return Object.freeze({
      completedAtMs: value.completedAtMs,
      expectedCompletionByMs: value.expectedCompletionByMs,
      requestedAtMs: value.requestedAtMs,
      schemaVersion: 1,
      status: 'completed',
    });
  }
  return null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const secondPresent = offset + 1 < bytes.length;
    const thirdPresent = offset + 2 < bytes.length;
    const second = secondPresent ? bytes[offset + 1]! : 0;
    const third = thirdPresent ? bytes[offset + 2]! : 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64URL_ALPHABET[(value >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(value >>> 12) & 63];
    if (secondPresent) encoded += BASE64URL_ALPHABET[(value >>> 6) & 63];
    if (thirdPresent) encoded += BASE64URL_ALPHABET[value & 63];
  }
  return encoded;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRealm(value: unknown): value is ClientAccessRealm {
  return value === 'production_client' || value === 'review_sandbox';
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDateTimestamp(value: unknown): value is number {
  return isNonnegativeSafeInteger(value) && value <= MAX_DATE_MS;
}
