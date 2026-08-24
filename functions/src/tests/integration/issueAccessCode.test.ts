import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AccessCodeIssuer,
  type AccessCodeCreateRecord,
  type AccessCodeStore,
} from '../../domain/accessCodeIssuer.js';
import { VersionedHmac } from '../../security/versionedHmac.js';

class AtomicMemoryStore implements AccessCodeStore {
  readonly records: AccessCodeCreateRecord[] = [];
  #queue = Promise.resolve();

  createActiveCode(record: AccessCodeCreateRecord): Promise<'created' | 'collision' | 'invalid_resource'> {
    const operation = this.#queue.then(() => {
      if (this.records.some(({ lookupId }) => lookupId === record.lookupId)) return 'collision' as const;
      this.records.push(record);
      return 'created' as const;
    });
    this.#queue = operation.then(() => undefined);
    return operation;
  }
}

test('the owner can issue an individual code for every chosen client even when requests race', async () => {
  const store = new AtomicMemoryStore();
  let sequence = 0;
  const issuer = new AccessCodeIssuer({
    codeHasher: VersionedHmac.fromTestKeys({
      currentVersion: '2026-08',
      keys: { '2026-08': 'test-only-current-pepper-with-at-least-32-bytes' },
    }),
    randomSource: () => {
      sequence += 1;
      return Buffer.alloc(16, sequence);
    },
    store,
  });

  const attempts = await Promise.allSettled(
    Array.from({ length: 25 }, () => issuer.issue({
      expiresAtMs: Date.UTC(2027, 0, 1),
      resourceIds: ['healthy-recipes-client'],
    })),
  );

  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 25);
  assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 0);
  assert.equal(store.records.length, 25);

  const oneTimeCodes = attempts.flatMap((attempt) => (
    attempt.status === 'fulfilled' ? [attempt.value.oneTimeCode] : []
  ));
  const storedPayload = JSON.stringify(store.records);
  assert.equal(oneTimeCodes.some((code) => storedPayload.includes(code)), false);
  assert.equal(storedPayload.includes('clientReference'), false);
});
