import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AccountDeletionReceiptError,
  AccountDeletionReceiptStatusService,
} from '../../domain/accountDeletionReceipt.js';
import { VersionedHmac } from '../../security/versionedHmac.js';

const receipt = 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG';
const requestedAtMs = Date.UTC(2026, 7, 22);
const expectedCompletionByMs = requestedAtMs + 30 * 24 * 60 * 60 * 1_000;

test('an opaque deletion receipt retrieves an exact pending status without Auth or identity input', async () => {
  const lookups: string[][] = [];
  const service = new AccountDeletionReceiptStatusService({
    receiptHasher: hasher(),
    store: {
      async findAccountDeletionReceiptStatus(candidates) {
        lookups.push(candidates.map(({ lookupId }) => lookupId));
        return {
          completedAtMs: null,
          expectedCompletionByMs,
          requestedAtMs,
          schemaVersion: 1,
          status: 'pending',
        };
      },
    },
  });

  assert.deepEqual(await service.getStatus({ deletionReceipt: receipt }), {
    completedAtMs: null,
    expectedCompletionByMs,
    requestedAtMs,
    schemaVersion: 1,
    status: 'pending',
  });
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0]?.length, 2);
  assert.equal(JSON.stringify(lookups).includes(receipt), false);
});

test('malformed and unknown receipts fail with one generic non-identifying error', async () => {
  const service = new AccountDeletionReceiptStatusService({
    receiptHasher: hasher(),
    store: { async findAccountDeletionReceiptStatus() { return null; } },
  });

  for (const deletionReceipt of ['short', receipt]) {
    await assert.rejects(service.getStatus({ deletionReceipt }), (error: unknown) => (
      error instanceof AccountDeletionReceiptError
      && error.code === 'invalid_access'
      && error.message === 'invalid_access'
      && !JSON.stringify(error).includes(deletionReceipt)
    ));
  }
});

test('completed receipts stop resolving at the exact retention boundary even if TTL cleanup is late', async () => {
  const completedAtMs = requestedAtMs + 1_000;
  let nowMs = completedAtMs + 30 * 24 * 60 * 60 * 1_000 - 1;
  const service = new AccountDeletionReceiptStatusService({
    nowMs: () => nowMs,
    receiptHasher: hasher(),
    store: {
      async findAccountDeletionReceiptStatus() {
        return {
          completedAtMs,
          expectedCompletionByMs,
          requestedAtMs,
          schemaVersion: 1,
          status: 'completed' as const,
        };
      },
    },
  });

  assert.equal((await service.getStatus({ deletionReceipt: receipt })).status, 'completed');
  nowMs += 1;
  await assert.rejects(
    service.getStatus({ deletionReceipt: receipt }),
    (error: unknown) => error instanceof AccountDeletionReceiptError,
  );
});

test('pending receipts remain consultable after their expected completion date', async () => {
  const service = new AccountDeletionReceiptStatusService({
    nowMs: () => expectedCompletionByMs + 1,
    receiptHasher: hasher(),
    store: {
      async findAccountDeletionReceiptStatus() {
        return {
          completedAtMs: null,
          expectedCompletionByMs,
          requestedAtMs,
          schemaVersion: 1,
          status: 'pending' as const,
        };
      },
    },
  });

  assert.equal((await service.getStatus({ deletionReceipt: receipt })).status, 'pending');
});

test('a receipt lookup from the other realm reveals no status', async () => {
  const productionLookupIds = new Set(
    realmHasher('production').lookupCandidates(receipt).map(({ lookupId }) => lookupId),
  );
  const reviewService = new AccountDeletionReceiptStatusService({
    receiptHasher: realmHasher('review'),
    store: {
      async findAccountDeletionReceiptStatus(candidates) {
        return candidates.some(({ lookupId }) => productionLookupIds.has(lookupId))
          ? {
            completedAtMs: null,
            expectedCompletionByMs,
            requestedAtMs,
            schemaVersion: 1,
            status: 'pending' as const,
          }
          : null;
      },
    },
  });

  await assert.rejects(
    reviewService.getStatus({ deletionReceipt: receipt }),
    (error: unknown) => (
      error instanceof AccountDeletionReceiptError
      && error.message === 'invalid_access'
    ),
  );
});

function hasher(): VersionedHmac {
  return realmHasher('shared');
}

function realmHasher(realm: string): VersionedHmac {
  return VersionedHmac.fromTestKeys({
    currentVersion: 'v2',
    keys: {
      v1: `receipt-old-${realm}-pepper-at-least-32-bytes`,
      v2: `receipt-current-${realm}-pepper-at-least-32-bytes`,
    },
  });
}
