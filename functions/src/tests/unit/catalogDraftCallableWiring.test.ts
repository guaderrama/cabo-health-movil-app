import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('draft and audit callables use the exact staff boundary and expose no publish surface', async () => {
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
  assert.doesNotMatch(source, /adminPublish|publishCatalogDraft|signedCatalog/u);
});

test('portal callable response contracts remain explicit and exact', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  assert.match(source, /adminListCatalogDrafts[\s\S]{0,1400}?Object\.freeze\(\{ drafts:/u);
  assert.match(source, /adminCreateCatalogDraft[\s\S]{0,1400}?Object\.freeze\(\{ draft \}\)/u);
  assert.match(source, /adminUpdateCatalogDraft[\s\S]{0,1400}?Object\.freeze\(\{ draft \}\)/u);
  assert.match(source, /adminArchiveCatalogDraft[\s\S]{0,1400}?Object\.freeze\(\{ archived: true, draft/u);
  assert.match(source, /adminListAudit[\s\S]{0,1400}?Object\.freeze\(\{ events:/u);
});
