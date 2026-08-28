import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decodeFirestoreDocument,
  encodeFirestoreDocument,
} from '../../infrastructure/adminFirestoreDocumentDatabase.js';

test('Firestore TTL deadlines are encoded as native timestamps and decoded to epoch milliseconds', () => {
  const expiresAtMs = Date.UTC(2026, 8, 21, 12, 34, 56, 789);
  const encoded = encodeFirestoreDocument(Object.freeze({
    expiresAtMs,
    nested: Object.freeze({ expiresAtMs: expiresAtMs + 1_000 }),
    requestedAtMs: expiresAtMs - 1_000,
    schemaVersion: 1,
  }));

  assert.ok(isRecord(encoded));
  assert.equal(typeof encoded.expiresAtMs, 'object');
  assert.equal(
    (encoded.expiresAtMs as { toMillis(): number }).toMillis(),
    expiresAtMs,
  );
  assert.ok(isRecord(encoded.nested));
  assert.equal(
    (encoded.nested.expiresAtMs as { toMillis(): number }).toMillis(),
    expiresAtMs + 1_000,
  );
  assert.equal(encoded.requestedAtMs, expiresAtMs - 1_000);

  assert.deepEqual(decodeFirestoreDocument(encoded), {
    expiresAtMs,
    nested: { expiresAtMs: expiresAtMs + 1_000 },
    requestedAtMs: expiresAtMs - 1_000,
    schemaVersion: 1,
  });
});

test('Firestore conversion preserves arrays, nulls, and non-TTL numeric fields', () => {
  const value = Object.freeze({
    expiresAtMs: null,
    resourceIds: Object.freeze(['client-resources']),
    retryWorkerMinutes: 5,
  });

  assert.deepEqual(decodeFirestoreDocument(encodeFirestoreDocument(value)), value);
});

for (const [label, expiresAtMs] of [
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['negative integer', -1],
  ['signed negative zero', -0],
  ['fractional value', 1.5],
  ['maximum safe integer outside Timestamp range', Number.MAX_SAFE_INTEGER],
  ['one millisecond beyond Timestamp range', 253_402_300_800_000],
] as const) {
  test(`Firestore adapter rejects ${label} expiresAtMs instead of persisting a numeric TTL`, () => {
    assert.throws(
      () => encodeFirestoreDocument({ expiresAtMs }),
      /invalid_firestore_expiry/u,
    );
  });
}

test('Firestore adapter accepts the exact maximum Timestamp millisecond', () => {
  const expiresAtMs = 253_402_300_799_999;
  const encoded = encodeFirestoreDocument({ expiresAtMs }) as { expiresAtMs: unknown };

  assert.equal(
    (encoded.expiresAtMs as { toMillis(): number }).toMillis(),
    expiresAtMs,
  );
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
