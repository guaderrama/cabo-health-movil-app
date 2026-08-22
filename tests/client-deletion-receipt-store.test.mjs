import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_DELETION_RECEIPT_KEYS,
  createClientDeletionReceiptStore,
  parseDeletionStatus,
} from '../.test-build/features/clientAccess/clientDeletionReceiptStore.js';

const nowMs = Date.UTC(2026, 7, 22);
const expectedCompletionByMs = nowMs + 30 * 24 * 60 * 60 * 1_000;

function harness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  const storage = {
    getItem: async (key) => {
      calls.push(['get', key]);
      return values.get(key) ?? null;
    },
    setItem: async (key, value) => {
      calls.push(['set', key, value]);
      values.set(key, value);
    },
    deleteItem: async (key) => {
      calls.push(['delete', key]);
      values.delete(key);
    },
  };
  const create = () => createClientDeletionReceiptStore({
    storage,
    randomBytes: async (length) => {
      calls.push(['random', length]);
      return Uint8Array.from({ length }, (_, index) => index + 1);
    },
    now: () => nowMs,
  });
  return { calls, create, values };
}

test('prepare writes and verifies one 256-bit receipt before exposing it', async () => {
  const { calls, create, values } = harness();
  const receipt = await create().prepare('production_client');

  assert.match(receipt.deletionReceipt, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(receipt.phase, 'prepared');
  assert.equal(receipt.realm, 'production_client');
  assert.equal(receipt.lastKnownStatus, null);
  assert.deepEqual(calls, [
    ['get', CLIENT_DELETION_RECEIPT_KEYS.production_client],
    ['get', CLIENT_DELETION_RECEIPT_KEYS.review_sandbox],
    ['random', 32],
    ['set', CLIENT_DELETION_RECEIPT_KEYS.production_client, JSON.stringify(receipt)],
    ['get', CLIENT_DELETION_RECEIPT_KEYS.production_client],
  ]);
  const serialized = values.get(CLIENT_DELETION_RECEIPT_KEYS.production_client);
  assert.equal(serialized.includes('client_'), false);
  assert.equal(serialized.includes('CH-'), false);
  assert.equal(serialized.includes('http'), false);
});

test('an accepted receipt and exact last-known status survive runtime recreation', async () => {
  const { create } = harness();
  const prepared = await create().prepare('review_sandbox');
  const pending = {
    completedAtMs: null,
    expectedCompletionByMs,
    requestedAtMs: nowMs,
    schemaVersion: 1,
    status: 'pending',
  };
  const accepted = await create().markAccepted(prepared, pending);

  assert.equal(accepted.phase, 'accepted');
  assert.deepEqual(accepted.lastKnownStatus, pending);
  assert.deepEqual(await create().load(), { kind: 'receipt', receipt: accepted });
});

test('a completed status may advance pending but can never regress to pending', async () => {
  const { create } = harness();
  const store = create();
  const prepared = await store.prepare('production_client');
  const pending = {
    completedAtMs: null,
    expectedCompletionByMs,
    requestedAtMs: nowMs,
    schemaVersion: 1,
    status: 'pending',
  };
  const accepted = await store.markAccepted(prepared, pending);
  const completed = {
    ...pending,
    completedAtMs: nowMs + 2_000,
    status: 'completed',
  };
  const advanced = await store.markAccepted(accepted, completed);

  assert.deepEqual(advanced.lastKnownStatus, completed);
  await assert.rejects(store.markAccepted(advanced, pending), /client_deletion_receipt_regression/u);
});

test('malformed, extra-field, and conflicting realm state fail closed without deletion', async () => {
  const key = CLIENT_DELETION_RECEIPT_KEYS.production_client;
  for (const value of [
    '{',
    JSON.stringify({ schemaVersion: 1, realm: 'production_client', extra: true }),
  ]) {
    const { calls, create } = harness({ [key]: value });
    assert.deepEqual(await create().load(), {
      kind: 'unavailable',
      realms: ['production_client'],
    });
    assert.equal(calls.some(([operation]) => operation === 'delete'), false);
  }

  const { create } = harness();
  const store = create();
  await store.prepare('production_client');
  await assert.rejects(store.prepare('review_sandbox'), /client_deletion_receipt_conflict/u);
});

test('clear removes only the matching receipt and verifies secure deletion', async () => {
  const { calls, create } = harness();
  const store = create();
  const receipt = await store.prepare('production_client');
  await store.clear(receipt);

  assert.deepEqual(calls.slice(-3), [
    ['get', CLIENT_DELETION_RECEIPT_KEYS.production_client],
    ['delete', CLIENT_DELETION_RECEIPT_KEYS.production_client],
    ['get', CLIENT_DELETION_RECEIPT_KEYS.production_client],
  ]);
  assert.deepEqual(await store.load(), { kind: 'none' });
});

test('status parsing rejects extra fields and timestamps outside the renderable date range', () => {
  const pending = {
    completedAtMs: null,
    expectedCompletionByMs,
    requestedAtMs: nowMs,
    schemaVersion: 1,
    status: 'pending',
  };
  assert.deepEqual(parseDeletionStatus(pending), pending);
  assert.equal(parseDeletionStatus({ ...pending, extra: true }), null);
  assert.equal(parseDeletionStatus({
    ...pending,
    expectedCompletionByMs: Number.MAX_SAFE_INTEGER + 30 * 24 * 60 * 60 * 1_000,
    requestedAtMs: Number.MAX_SAFE_INTEGER,
  }), null);
  assert.equal(parseDeletionStatus({
    ...pending,
    completedAtMs: nowMs - 1,
    status: 'completed',
  }), null);
});
