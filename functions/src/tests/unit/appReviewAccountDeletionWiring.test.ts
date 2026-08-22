import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('the App Review deletion callable has the exact fail-closed contract', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  const block = callableBlock(source, 'deleteAppReviewAccount');

  assert.match(block, /onCall\(\{[\s\S]*?\.\.\.baseCallableOptions/u);
  assert.match(block, /secrets: \[APP_REVIEW_INSTALLATION_PEPPER_RING\]/u);
  assert.match(block, /assertClientAppCheck\(request\)/u);
  assert.match(block, /assertAppReviewDeletionAuth\(request\)/u);
  assert.match(block, /createAppReviewAccountDeletionService\(\)\.request\(\{/u);
  assert.match(block, /installationId: parseInstallationId\(request\.data\)/u);
  assert.match(block, /mapAppReviewAccountDeletionError\(error\)/u);
  assert.doesNotMatch(block, /createStore\(/u);
  assert.doesNotMatch(block, /console\.|logger\./u);

  assert.match(
    source,
    /function assertAppReviewDeletionAuth[\s\S]{0,500}?permission-denied[\s\S]{0,100}?invalid_access/u,
  );
  assert.match(
    source,
    /function createAppReviewAccountDeletionService[\s\S]{0,1200}?const store = createAppReviewStore\(\)[\s\S]{0,1200}?installation\/v1[\s\S]{0,1200}?createAppReviewDataRetentionService\(store\)/u,
  );
  assert.match(
    source,
    /function mapAppReviewAccountDeletionError[\s\S]{0,400}?permission-denied[\s\S]{0,100}?invalid_access[\s\S]{0,300}?internal[\s\S]{0,100}?app_review_operation_failed/u,
  );
});

function callableBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} =`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nexport const ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}
