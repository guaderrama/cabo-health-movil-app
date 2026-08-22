import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Firestore client SDK access is default-deny for every backend collection', async () => {
  const rules = await readFile('../firestore.rules', 'utf8');

  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/u);
  assert.doesNotMatch(rules, /allow\s+(?:read|write|create|update|delete)[^;]*:\s*if\s+true/u);
});
