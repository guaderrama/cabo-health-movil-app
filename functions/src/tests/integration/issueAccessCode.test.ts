import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AccessCodeIssuer,
  AccessCodeLimitError,
  type AccessCodeCreateRecord,
  type AccessCodeStore,
} from '../../domain/accessCodeIssuer.js';
import { VersionedHmac } from '../../security/versionedHmac.js';

class AtomicMemoryStore implements AccessCodeStore {
  readonly records: AccessCodeCreateRecord[] = [];
  #queue = Promise.resolve();

  createActiveCode(record: AccessCodeCreateRecord, maximumActive: number): Promise<'created' | 'collision' | 'invalid_resource' | 'limit'> {
    const operation = this.#queue.then(() => {
      if (this.records.some(({ lookupId }) => lookupId === record.lookupId)) return 'collision' as const;
      if (this.records.length >= maximumActive) return 'limit' as const;
      this.records.push(record);
      return 'created' as const;
    });
    this.#queue = operation.then(() => undefined);
    return operation;
  }
}

test('at most four active client codes can be issued even when requests race', async () => {
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
    Array.from({ length: 5 }, (_, index) => issuer.issue({
      expiresAtMs: Date.UTC(2027, 0, 1),
      resourceIds: ['healthy-recipes-client'],
      slot: (index % 4) + 1 as 1 | 2 | 3 | 4,
    })),
  );

  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 4);
  const rejection = attempts.find(({ status }) => status === 'rejected');
  assert.ok(rejection?.status === 'rejected');
  assert.ok(rejection.reason instanceof AccessCodeLimitError);
  assert.equal(store.records.length, 4);

  const oneTimeCodes = attempts.flatMap((attempt) => (
    attempt.status === 'fulfilled' ? [attempt.value.oneTimeCode] : []
  ));
  const storedPayload = JSON.stringify(store.records);
  assert.equal(oneTimeCodes.some((code) => storedPayload.includes(code)), false);
  assert.equal(storedPayload.includes('clientReference'), false);
});
