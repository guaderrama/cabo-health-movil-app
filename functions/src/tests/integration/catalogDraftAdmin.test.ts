import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';

import {
  CatalogDraftAdminService,
  CatalogDraftConflictError,
  CatalogDraftInputError,
  type CatalogDraftInput,
  validateCatalogDraftInput,
} from '../../domain/catalogDraftAdmin.js';
import { AccessCodeIssuer } from '../../domain/accessCodeIssuer.js';
import {
  clientResourcePath,
  FirestoreClientAccessStore,
} from '../../repositories/firestoreClientAccessStore.js';
import { FirestoreCatalogDraftStore } from '../../repositories/firestoreCatalogDraftStore.js';
import { VersionedHmac } from '../../security/versionedHmac.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const draftInput: CatalogDraftInput = Object.freeze({
  access: 'clients',
  icon: 'nutrition',
  summary: Object.freeze({ en: 'Science-backed nutrition.', 'es-MX': 'Nutrición basada en ciencia.' }),
  title: Object.freeze({ en: 'Nutrition guide', 'es-MX': 'Guía de nutrición' }),
  url: 'https://resources.example.org/nutrition',
});

test('creates an opaque draft and lists its exact portal view without publishing it', async () => {
  const database = new InMemoryDocumentDatabase();
  const service = new CatalogDraftAdminService({
    nowMs: () => 1_800_000_000_000,
    randomBytes: () => Buffer.alloc(24, 7),
    store: new FirestoreCatalogDraftStore(database),
  });

  const created = await service.create(draftInput);

  assert.deepEqual(created, {
    access: 'clients',
    draftId: 'dr_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH',
    icon: 'nutrition',
    revision: 1,
    status: 'draft',
    summary: { en: 'Science-backed nutrition.', 'es-MX': 'Nutrición basada en ciencia.' },
    title: { en: 'Nutrition guide', 'es-MX': 'Guía de nutrición' },
    updatedAtMs: 1_800_000_000_000,
    url: 'https://resources.example.org/nutrition',
  });
  assert.deepEqual(await service.list(), [created]);

  const state = database.serializedState();
  assert.match(state, /_private_catalog_drafts\/dr_/u);
  assert.doesNotMatch(state, /_private_client_resources|signed_catalog|published/u);
  const audit = await database.listCollection('_private_audit_events');
  assert.equal(audit.length, 1);
  assert.doesNotMatch(JSON.stringify(audit), /resources\.example\.org/u, 'audit records must not copy the URL');
});

test('updates and archives only the exact current revision while recording bounded sanitized audit', async () => {
  const database = new InMemoryDocumentDatabase();
  let byte = 1;
  const service = new CatalogDraftAdminService({
    nowMs: (() => {
      let now = 1_800_000_000_000;
      return () => now++;
    })(),
    randomBytes: (size) => Buffer.alloc(size, byte++),
    store: new FirestoreCatalogDraftStore(database),
  });
  const created = await service.create(draftInput);
  const updateInput = Object.freeze({
    ...draftInput,
    access: 'public' as const,
    title: Object.freeze({ en: 'Updated guide', 'es-MX': 'Guía actualizada' }),
  });

  const updated = await service.update(created.draftId, 1, updateInput);
  assert.equal(updated.revision, 2);
  assert.equal(updated.access, 'public');
  await assert.rejects(
    service.update(created.draftId, 1, draftInput),
    CatalogDraftConflictError,
  );
  const archived = await service.archive(created.draftId, 2);
  assert.equal(archived.revision, 3);
  assert.equal(archived.status, 'archived');

  assert.deepEqual((await service.listAudit()).map((event) => event.action), [
    'draft.archived',
    'draft.updated',
    'draft.created',
  ]);
  for (const event of await service.listAudit()) {
    assert.deepEqual(Object.keys(event).sort(), [
      'action',
      'actorLabel',
      'eventId',
      'occurredAtMs',
      'outcome',
      'targetSuffix',
    ]);
    assert.equal(event.actorLabel, 'Staff');
    assert.equal(event.outcome, 'success');
    assert.match(event.targetSuffix, /^[A-Za-z0-9_-]{1,12}$/u);
  }
  assert.doesNotMatch(JSON.stringify(await service.listAudit()), /resources\.example\.org/u);
});

test('draft validation accepts the shared safe external URL for Public and VIP and rejects every unsafe fixture URL', async () => {
  const fixtureText = await readFile(
    resolve(process.cwd(), '../tests/fixtures/external-https-url-cases.json'),
    'utf8',
  );
  const cases = JSON.parse(fixtureText) as Readonly<{
    accepted: readonly Readonly<{ canonical: string; input: string; kind: string }>[];
    rejected: readonly string[];
  }>;
  const external = cases.accepted.find(({ kind }) => kind === 'external_https');
  assert.ok(external);

  for (const access of ['public', 'clients'] as const) {
    assert.equal(validateCatalogDraftInput({
      ...draftInput,
      access,
      url: external.input,
    }).url, external.canonical);
  }
  for (const url of cases.rejected) {
    assert.throws(() => validateCatalogDraftInput({ ...draftInput, url }), CatalogDraftInputError, url);
  }
});

test('stored draft parser rejects noncanonical URLs and normalization-changing copy', async () => {
  const draftId = 'dr_00000000000000000000000000000000';
  const base = Object.freeze({
    ...draftInput,
    createdAtMs: 1_800_000_000_000,
    draftId,
    revision: 1,
    schemaVersion: 1,
    status: 'draft',
    updatedAtMs: 1_800_000_000_000,
  });
  for (const [label, stored] of [
    ['explicit default port', { ...base, url: 'https://resources.example.org:443/nutrition' }],
    ['trimmed summary', { ...base, summary: { ...base.summary, en: `${base.summary.en} ` } }],
  ] as const) {
    const service = new CatalogDraftAdminService({
      store: new FirestoreCatalogDraftStore(new InMemoryDocumentDatabase({
        [`_private_catalog_drafts/${draftId}`]: stored,
      })),
    });

    await assert.rejects(service.list(), /invalid_catalog_draft_record/u, label);
  }
});

test('stored drafts accept epoch zero but reject signed-zero timestamps', async () => {
  const draftId = 'dr_00000000000000000000000000000000';
  const base = Object.freeze({
    ...draftInput,
    createdAtMs: 0,
    draftId,
    revision: 1,
    schemaVersion: 1,
    status: 'draft',
    updatedAtMs: 0,
  });
  const validService = new CatalogDraftAdminService({
    store: new FirestoreCatalogDraftStore(new InMemoryDocumentDatabase({
      [`_private_catalog_drafts/${draftId}`]: base,
    })),
  });
  assert.deepEqual(await validService.list(), [{
    access: base.access,
    draftId,
    icon: base.icon,
    revision: 1,
    status: 'draft',
    summary: base.summary,
    title: base.title,
    updatedAtMs: 0,
    url: base.url,
  }]);

  for (const field of ['createdAtMs', 'updatedAtMs'] as const) {
    const service = new CatalogDraftAdminService({
      store: new FirestoreCatalogDraftStore(new InMemoryDocumentDatabase({
        [`_private_catalog_drafts/${draftId}`]: { ...base, [field]: -0 },
      })),
    });

    await assert.rejects(service.list(), /invalid_catalog_draft_record/u, field);
  }
});

test('draft creation accepts epoch zero but rejects signed-zero server time', async () => {
  const validService = new CatalogDraftAdminService({
    nowMs: () => 0,
    randomBytes: () => Buffer.alloc(24, 9),
    store: new FirestoreCatalogDraftStore(new InMemoryDocumentDatabase()),
  });
  const created = await validService.create(draftInput);
  assert.equal(Object.is(created.updatedAtMs, 0), true);

  const invalidService = new CatalogDraftAdminService({
    nowMs: () => -0,
    randomBytes: () => Buffer.alloc(24, 10),
    store: new FirestoreCatalogDraftStore(new InMemoryDocumentDatabase()),
  });
  assert.throws(() => invalidService.create(draftInput), /invalid_server_time/u);
});

test('rejects non-exact drafts and ambiguous or unsafe HTTPS URLs', () => {
  const invalidInputs: unknown[] = [
    { ...draftInput, extra: true },
    { ...draftInput, access: 'premium' },
    { ...draftInput, icon: 'custom' },
    { ...draftInput, title: { en: 'x', 'es-MX': 'y', es: 'z' } },
    { ...draftInput, summary: { en: 'x'.repeat(121), 'es-MX': 'y' } },
    { ...draftInput, url: 'http://resources.example.test/path' },
    { ...draftInput, url: 'https://user:pass@resources.example.test/path' },
    { ...draftInput, url: 'https://resources.example.test:8443/path' },
    { ...draftInput, url: 'https://resources.example.test/path?next=https://evil.test' },
    { ...draftInput, url: 'https://resources.example.test/path#section' },
  ];
  for (const value of invalidInputs) {
    assert.throws(() => validateCatalogDraftInput(value), CatalogDraftInputError);
  }
});

test('exposes only successful create/revoke code audit with the one-time suffix', async () => {
  const nowMs = 1_800_000_000_000;
  const resource = Object.freeze({
    access: 'client',
    iconKey: 'nutrition',
    id: 'reviewed-resource',
    schemaVersion: 1,
    status: 'active',
    summary: { en: 'Summary', es: 'Resumen' },
    title: { en: 'Title', es: 'Título' },
  });
  const database = new InMemoryDocumentDatabase({
    [clientResourcePath(resource.id)]: resource,
  });
  const clientStore = new FirestoreClientAccessStore(database);
  const issuer = new AccessCodeIssuer({
    codeHasher: VersionedHmac.fromTestKeys({
      currentVersion: 'v1',
      keys: { v1: 'catalog-audit-test-pepper-at-least-32-bytes' },
    }),
    nowMs: () => nowMs,
    randomSource: () => Buffer.from('00112233445566778899aabbccddeeff', 'hex'),
    store: clientStore,
  });
  const issued = await issuer.issue({
    expiresAtMs: nowMs + 86_400_000,
    resourceIds: [resource.id],
  });
  await clientStore.revokeAccessCode(issued.summary.codeId, nowMs + 1);

  const audit = await new FirestoreCatalogDraftStore(database).listAudit();
  assert.deepEqual(audit.map(({ action, targetSuffix }) => ({ action, targetSuffix })), [
    { action: 'client_code.revoked', targetSuffix: issued.summary.displaySuffix },
    { action: 'client_code.created', targetSuffix: issued.summary.displaySuffix },
  ]);
  assert.equal(JSON.stringify(audit).includes(issued.summary.codeId), false);
  assert.equal(JSON.stringify(audit).includes(issued.oneTimeCode), false);
});
