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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
