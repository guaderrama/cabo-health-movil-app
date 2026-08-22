import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('App Review callables have exact realm-specific auth and fixed contracts', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  for (const callable of [
    'adminGetAppReviewCredentialStatus',
    'adminRotateAppReviewCredential',
  ]) {
    const block = callableBlock(source, callable);
    assert.match(block, /assertStaffAppCheck\(request\)/u);
    assert.match(block, /assertProductionAdmin\(request, 'app_review_credential'\)/u);
  }
  assert.match(callableBlock(source, 'redeemAppReviewCredential'), /assertClientAppCheck\(request\)/u);
  for (const callable of ['refreshAppReviewAccess', 'createAppReviewLaunch']) {
    const block = callableBlock(source, callable);
    assert.match(block, /assertClientAppCheck\(request\)/u);
    assert.match(block, /assertAppReviewAuth\(request\)/u);
  }
  const launchBlock = callableBlock(source, 'createAppReviewLaunch');
  assert.doesNotMatch(launchBlock, /resourceId/u);
  const deletionBlock = callableBlock(source, 'deleteAppReviewAccount');
  assert.match(deletionBlock, /assertClientAppCheck\(request\)/u);
  assert.match(deletionBlock, /assertAppReviewDeletionAuth\(request\)/u);
  assert.match(deletionBlock, /const input = parseDeletionRequestInput\(request\.data\)/u);
  assert.match(deletionBlock, /\.\.\.input,[\s\S]{0,120}?subjectUid/u);
  assert.match(source, /function assertAppReviewAuth[\s\S]{0,500}?authority !== 'app_review'/u);
  assert.match(source, /function assertClientAuth[\s\S]{0,300}?\^client_/u);
});

test('App Review uses a mandatory named database, separate secrets, store, broker and signing realm', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  for (const secret of [
    'APP_REVIEW_CREDENTIAL_PEPPER_RING',
    'APP_REVIEW_INSTALLATION_PEPPER_RING',
    'APP_REVIEW_DELETION_RECEIPT_PEPPER_RING',
    'APP_REVIEW_RATE_LIMIT_PEPPER_RING',
    'APP_REVIEW_LAUNCH_NONCE_PEPPER_RING',
    'APP_REVIEW_WEB_SESSION_PEPPER_RING',
    'APP_REVIEW_WEB_CSRF_PEPPER_RING',
    'APP_REVIEW_BROKER_HMAC_KEY_RING',
  ]) assert.match(source, new RegExp(`defineSecret\\('${secret}'\\)`, 'u'));
  assert.match(source, /defineString\('APP_REVIEW_FIRESTORE_DATABASE_ID'\)/u);
  assert.match(source, /getFirestore\(requireAppReviewDatabaseId\(\)\)/u);
  assert.match(source, /function requireAppReviewDatabaseId[\s\S]{0,500}?cabohealth-review-/u);
  assert.match(source, /export const appReviewBrokerApi = onRequest/u);
  assert.match(source, /appReviewBrokerApi[\s\S]{0,1600}?authenticateAppReviewBrokerRequest/u);
  assert.match(source, /createAppReviewWebSessionBroker/u);
  assert.match(source, /appReviewBrokerApi[\s\S]{0,2200}?\}, createAppReviewWebSessionBroker\(\)\)/u);
});

function callableBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} =`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nexport const ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}
