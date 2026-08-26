import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('draft, live catalog, and audit callables use their exact staff permissions', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  const callables = [
    'adminListCatalogDrafts',
    'adminCreateCatalogDraft',
    'adminUpdateCatalogDraft',
    'adminArchiveCatalogDraft',
    'adminListAudit',
  ];
  for (const callable of callables) {
    const start = source.indexOf(`export const ${callable} =`);
    assert.notEqual(start, -1, `${callable} must exist`);
    const next = source.indexOf('\nexport const ', start + 1);
    const block = source.slice(start, next === -1 ? undefined : next);
    assert.match(block, /assertStaffAppCheck\(request\)/u);
    assert.match(block, /assertProductionAdmin\(request, 'client_resource_drafts'\)/u);
  }
  for (const callable of [
    'adminListCatalogItems',
    'adminCreateCatalogItem',
    'adminUpdateCatalogItem',
    'adminSetCatalogItemActive',
    'adminDeleteCatalogItem',
  ]) {
    const start = source.indexOf(`export const ${callable} =`);
    assert.notEqual(start, -1, `${callable} must exist`);
    const next = source.indexOf('\nexport const ', start + 1);
    const block = source.slice(start, next === -1 ? undefined : next);
    assert.match(block, /assertStaffAppCheck\(request\)/u);
    assert.match(block, /assertProductionAdmin\(request, 'client_resource_publish'\)/u);
  }
  assert.doesNotMatch(source, /publishCatalogDraft|signedCatalog/u);
});

test('portal callable response contracts remain explicit and exact', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  assert.match(source, /adminListCatalogDrafts[\s\S]{0,1400}?Object\.freeze\(\{ drafts:/u);
  assert.match(source, /adminCreateCatalogDraft[\s\S]{0,1400}?Object\.freeze\(\{ draft \}\)/u);
  assert.match(source, /adminUpdateCatalogDraft[\s\S]{0,1400}?Object\.freeze\(\{ draft \}\)/u);
  assert.match(source, /adminArchiveCatalogDraft[\s\S]{0,1400}?Object\.freeze\(\{ archived: true, draft/u);
  assert.match(source, /adminListAudit[\s\S]{0,1400}?Object\.freeze\(\{ events:/u);
  assert.match(source, /adminListCatalogItems[\s\S]{0,1400}?Object\.freeze\(\{ items:/u);
  assert.match(source, /adminCreateCatalogItem[\s\S]{0,1800}?Object\.freeze\(\{ item \}\)/u);
  assert.match(source, /adminDeleteCatalogItem[\s\S]{0,1800}?Object\.freeze\(\{ deleted: true as const \}\)/u);
});
