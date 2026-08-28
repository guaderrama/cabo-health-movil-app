import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AccessCodeIssuer,
  type AccessCodeCreateRecord,
  type AccessCodeStore,
} from '../../domain/accessCodeIssuer.js';
import { clientResourcePath, FirestoreClientAccessStore } from '../../repositories/firestoreClientAccessStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

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

test('new access codes may resolve active external VIP resources without storing a URL', async () => {
  const nowMs = Date.UTC(2026, 7, 28);
  const externalId = 'external-fedcba9876543210fedcba9876543210';
  const external = {
    access: 'clients',
    active: true,
    createdAtMs: nowMs,
    icon: 'wellness',
    id: externalId,
    revision: 1,
    summary: { en: 'External VIP summary.', 'es-MX': 'Resumen VIP externo.' },
    title: { en: 'External VIP', 'es-MX': 'VIP Externo' },
    updatedAtMs: nowMs,
    url: 'https://wellness.example.org/private/',
  } as const;
  const database = new InMemoryDocumentDatabase({
    '_private_catalog/current': {
      items: [external], revision: 1, schemaVersion: 1, updatedAtMs: nowMs,
    },
    [clientResourcePath(externalId)]: {
      access: 'client',
      iconKey: 'heart-outline',
      id: externalId,
      schemaVersion: 1,
      status: 'active',
      summary: { en: external.summary.en, es: external.summary['es-MX'] },
      title: { en: external.title.en, es: external.title['es-MX'] },
    },
  });
  const store = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: VersionedHmac.fromTestKeys({
      currentVersion: '2026-08',
      keys: { '2026-08': 'test-only-current-pepper-with-at-least-32-bytes' },
    }),
    nowMs: () => nowMs,
    randomSource: () => Buffer.alloc(16, 77),
    store,
  });

  const issued = await issuer.issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds: [externalId],
  });
  const storedCodes = await database.listCollection('_private_access_codes');
  const stored = storedCodes.find(({ id }) => id === issued.summary.codeId)?.value;
  assert.ok(stored);
  assert.equal(JSON.stringify(stored).includes('https://'), false);
  assert.equal(JSON.stringify(stored).includes(external.url), false);
});
