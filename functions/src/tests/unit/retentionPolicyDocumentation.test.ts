import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('operations docs state the exact production and App Review retention contract', async () => {
  const backend = await readFile('../docs/operations/client-access-backend.md', 'utf8');
  const consumers = await readFile('../docs/operations/app-review-consumers.md', 'utf8');
  const threatModel = await readFile('../docs/security/app-review-sandbox-threat-model.md', 'utf8');

  assert.match(
    backend,
    /every five minutes[\s\S]{0,700}?expired redeemed[\s\S]{0,700}?durable deletion/u,
  );
  assert.match(backend, /unredeemed[\s\S]{0,180}?no Auth identity/u);
  assert.match(
    backend,
    /App Review[\s\S]{0,1200}?30 days of inactivity[\s\S]{0,700}?stale credential generation/u,
  );
  assert.match(
    backend,
    /review_sandbox_account_deletions[\s\S]{0,900}?Firebase Auth[\s\S]{0,900}?five minutes/u,
  );
  assert.match(consumers, /30 days of inactivity/u);
  assert.match(threatModel, /30 days of inactivity/u);
  assert.doesNotMatch(backend, /not yet physically purged/u);
  assert.doesNotMatch(threatModel, /Define and verify bounded physical cleanup/u);
});
