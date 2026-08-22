import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatalogDraftModel,
  validateDraftInput,
} from '../.test-build/domain/catalogDrafts.js';

test('catalog entries are validated as drafts and cannot request publication or activation', () => {
  const valid = validateDraftInput({
    url: 'https://example.org/guides/microbiota',
    title: { en: 'Microbiota guide', 'es-MX': 'Guía de microbiota' },
    summary: { en: 'Evidence-informed reading.', 'es-MX': 'Lectura con base científica.' },
    icon: 'wellness',
    access: 'clients',
  });

  assert.equal(valid.url, 'https://example.org/guides/microbiota');
  assert.equal(valid.access, 'clients');
  assert.throws(() => validateDraftInput({ ...valid, publish: true }), /draft_fields_invalid/u);
  assert.throws(() => validateDraftInput({ ...valid, active: true }), /draft_fields_invalid/u);
  assert.throws(() => validateDraftInput({ ...valid, url: 'http://example.org' }), /draft_url_invalid/u);
});

test('staff can add, edit, and archive drafts without a publication operation', async () => {
  const base = validateDraftInput({
    url: 'https://example.org/guide',
    title: { en: 'Guide', 'es-MX': 'Guía' },
    summary: { en: 'Initial summary', 'es-MX': 'Resumen inicial' },
    icon: 'guide',
    access: 'public',
  });
  let drafts = [];
  const gateway = {
    async list() { return drafts; },
    async create(input) {
      drafts = [{ draftId: 'draft_1', revision: 1, status: 'draft', updatedAtMs: 10, ...input }];
    },
    async update(draftId, revision, input) {
      drafts = drafts.map((draft) => draft.draftId === draftId
        ? { ...draft, ...input, revision: revision + 1, updatedAtMs: 20 }
        : draft);
    },
    async archive(draftId, revision) {
      drafts = drafts.map((draft) => draft.draftId === draftId
        ? { ...draft, status: 'archived', revision: revision + 1, updatedAtMs: 30 }
        : draft);
    },
  };
  const model = createCatalogDraftModel(gateway);

  await model.create(base);
  await model.update('draft_1', 1, { ...base, title: { en: 'Updated guide', 'es-MX': 'Guía actualizada' } });
  await model.archive('draft_1', 2);

  assert.deepEqual(model.getSnapshot().drafts.map(({ title, status, revision }) => ({ title, status, revision })), [{
    title: { en: 'Updated guide', 'es-MX': 'Guía actualizada' },
    status: 'archived',
    revision: 3,
  }]);
  assert.equal('publish' in model, false);
});
