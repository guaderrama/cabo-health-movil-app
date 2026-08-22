import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('App Review retention runs in its isolated named database every five minutes', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  const scheduled = source.slice(
    source.indexOf('export const cleanupAppReviewData = onSchedule'),
    source.indexOf('export const createClientLaunch = onCall'),
  );
  assert.match(scheduled, /schedule: 'every 5 minutes'/u);
  assert.match(scheduled, /createAppReviewDataRetentionService\(\)\.runScheduled\(\)/u);
  assert.match(
    source,
    /function createAppReviewDataRetentionService\(\)[\s\S]{0,900}?store: createAppReviewStore\(\)/u,
  );
  assert.match(
    source,
    /function createAppReviewDataRetentionService\(\)[\s\S]{0,900}?getAuth\(\)\.deleteUser\(subjectUid\)/u,
  );
  assert.match(
    source,
    /function createAppReviewStore\(\)[\s\S]{0,300}?getFirestore\(requireAppReviewDatabaseId\(\)\)/u,
  );
});
