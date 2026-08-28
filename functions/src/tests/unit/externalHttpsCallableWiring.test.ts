import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('getPublishedCatalogV3 requires client App Check and exact empty input without authentication', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  const block = callableBlock(source, 'getPublishedCatalogV3');

  assert.match(block, /onCall\(baseCallableOptions/u);
  assert.match(block, /assertClientAppCheck\(request\)/u);
  assert.match(block, /assertEmptyData\(request\.data, 'invalid_catalog_request'\)/u);
  assert.match(block, /createCatalogService\(\)\.publishedCatalogV3\(\)/u);
  assert.doesNotMatch(block, /assert(?:Client|AppReview|ProductionAdmin|ProductionStaff)Auth/u);
  assert.doesNotMatch(block, /request\.auth/u);
});

function callableBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} =`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nexport const ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}
