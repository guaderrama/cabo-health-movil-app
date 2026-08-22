import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('the callable and scheduled retry both use the durable account-deletion service', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  assert.match(source, /export const deleteClientAccount =[\s\S]{0,900}?createAccountDeletionService\(\)\.request/u);
  const scheduled = source.slice(
    source.indexOf('export const retryClientAccountDeletions = onSchedule'),
    source.indexOf('export const createClientLaunch = onCall'),
  );
  assert.match(scheduled, /const store = createStore\(\)/u);
  assert.match(scheduled, /await store\.reconcileExpiredClientAccess\(nowMs\)/u);
  assert.match(scheduled, /await createAccountDeletionService\(store\)\.retryPending\(\)/u);
  assert.ok(
    scheduled.indexOf('reconcileExpiredClientAccess') < scheduled.indexOf('retryPending'),
  );
  assert.match(source, /export const adminRevokeClientAccessCode =[\s\S]{0,900}?createAdminRevocationService\(\)\.revoke/u);
  assert.match(source, /function createAdminRevocationService\(\)[\s\S]{0,500}?new AdminClientAccessRevocationService/u);
  assert.match(source, /export const removeClientAccess =[\s\S]{0,700}?createClientAccessRemovalService\(\)\.remove/u);
  assert.match(source, /function createClientAccessRemovalService\(\)[\s\S]{0,500}?new ClientAccessRemovalService/u);
  assert.doesNotMatch(source, /createSessionManager\(\)\.deleteAccount/u);
  assert.doesNotMatch(source, /revokeRefreshTokens\(result\.subjectUid\)/u);
  assert.doesNotMatch(source, /revokeRefreshTokens\(subjectUid\)/u);
  assert.doesNotMatch(source, /return Object\.freeze\(\{ deleted: true \}\)/u);
});
