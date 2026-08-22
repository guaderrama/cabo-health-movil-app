import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Firebase config has no legacy/default project and requires explicit safe aliases', async () => {
  const parsed: unknown = JSON.parse(await readFile('../.firebaserc', 'utf8'));
  assert.ok(isRecord(parsed) && isRecord(parsed.projects));
  assert.deepEqual(Object.keys(parsed.projects).sort(), ['cabohealth-prod', 'cabohealth-staging']);
  assert.equal(Object.hasOwn(parsed.projects, 'default'), false);
  assert.match(String(parsed.projects['cabohealth-staging']), /^UNCONFIGURED_/u);
  assert.match(String(parsed.projects['cabohealth-prod']), /^UNCONFIGURED_/u);
  assert.doesNotMatch(JSON.stringify(parsed), /instalacionmariposas/u);
});

test('Firestore index config contains no legacy catalog index', async () => {
  const parsed: unknown = JSON.parse(await readFile('../firestore.indexes.json', 'utf8'));
  assert.deepEqual(parsed, { fieldOverrides: [], indexes: [] });
  assert.doesNotMatch(JSON.stringify(parsed), /cabohealth_apps/u);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
