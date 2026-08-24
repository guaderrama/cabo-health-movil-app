import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { parseServerStaffSession } from '../.test-build/domain/staffGateway.js';

const read = (path) => readFileSync(path, 'utf8');

test('Firebase boundary requires App Check, verified password auth, and never imports Firestore', () => {
  const source = read('src/firebase/firebaseStaffServices.ts');
  const gatewaySource = read('src/domain/staffGateway.ts');
  const adminGatewaySources = [
    gatewaySource,
    read('src/domain/catalogDrafts.ts'),
    read('src/domain/auditLog.ts'),
    read('src/domain/appReviewCredential.ts'),
  ].join('\n');

  assert.match(source, /initializeAppCheck/u);
  assert.match(source, /ReCaptchaEnterpriseProvider/u);
  assert.match(source, /isTokenAutoRefreshEnabled:\s*true/u);
  assert.match(source, /sendEmailVerification/u);
  assert.match(source, /sendPasswordResetEmail/u);
  assert.match(source, /credential\.user\.emailVerified/u);
  assert.match(source, /await user\.getIdTokenResult\(\)/u);
  assert.doesNotMatch(source, /getIdTokenResult\(true\)/u);
  assert.match(source, /token\.signInProvider !== ProviderId\.PASSWORD/u);
  assert.match(source, /Date\.parse\(token\.authTime\)/u);
  assert.doesNotMatch(source, /FactorId|TotpMultiFactorGenerator|getMultiFactorResolver|multiFactor\(|MultiFactor|completeTotp|pendingTotp|totp-enrollment-required|mfa-required/u);
  assert.doesNotMatch(source, /token\.claims\.(?:firebase|auth_time)/u);
  assert.match(source, /adminGetStaffSession/u);
  assert.match(source, /httpsCallable/u);
  assert.match(source, /limitedUseAppCheckTokens:\s*true/u);
  assert.match(source, /createAuthorizationBoundTransport/u);
  assert.match(source, /onAuthorizationLost/u);
  assert.match(source, /await signOut\(auth\)/u);
  assert.match(source, /calculateStaffSessionExpiryMs/u);
  assert.match(source, /setTimeout/u);
  assert.match(source, /clearTimeout/u);
  const passwordFlow = source.slice(source.indexOf('signIn: async'), source.indexOf('requestPasswordReset: async'));
  const resetFlow = source.slice(source.indexOf('requestPasswordReset: async'), source.indexOf('restore: async'));
  assert.match(passwordFlow, /await signOut\(auth\)/u);
  assert.match(resetFlow, /sendPasswordResetEmail\(auth,\s*email\.trim\(\)/u);
  assert.match(resetFlow, /error\.code === 'auth\/user-not-found'/u);
  for (const callableName of [
    'adminGetStaffSession',
    'adminListClientAccessCodes',
    'adminCreateClientAccessCode',
    'adminRevokeClientAccessCode',
    'adminListCatalogDrafts',
    'adminCreateCatalogDraft',
    'adminUpdateCatalogDraft',
    'adminArchiveCatalogDraft',
    'adminListAudit',
    'adminGetAppReviewCredentialStatus',
    'adminRotateAppReviewCredential',
  ]) {
    assert.ok(source.includes(callableName) || adminGatewaySources.includes(callableName));
  }
  assert.doesNotMatch(source, /firebase\/firestore|getFirestore|FIREBASE_APPCHECK_DEBUG_TOKEN|localStorage|sessionStorage|console\./iu);
});

test('the trusted server session has an exact schema with no client-supplied scope fields', () => {
  assert.deepEqual(parseServerStaffSession({
    scope: 'production',
    permissions: ['client_codes', 'client_resource_drafts', 'app_review_credential'],
  }), {
    scope: 'production',
    permissions: ['client_codes', 'client_resource_drafts', 'app_review_credential'],
  });
  assert.throws(() => parseServerStaffSession({
    scope: 'production',
    permissions: ['client_codes'],
    requestedScope: 'review-sandbox',
  }), /staff_session_untrusted/u);
});

test('authenticated services expose real server-scoped draft and audit gateways with no unavailable stubs', () => {
  const source = read('src/firebase/firebaseStaffServices.ts');
  const main = read('src/main.tsx');
  const app = read('src/App.tsx');
  const draftGateway = read('src/domain/catalogDrafts.ts');
  const auditGateway = read('src/domain/auditLog.ts');

  assert.match(source, /createCatalogDraftGateway/u);
  assert.match(source, /createAuditGateway/u);
  assert.match(source, /draftGateway:/u);
  assert.match(source, /auditGateway:/u);
  for (const callableName of [
    'adminListCatalogDrafts',
    'adminCreateCatalogDraft',
    'adminUpdateCatalogDraft',
    'adminArchiveCatalogDraft',
  ]) assert.match(draftGateway, new RegExp(callableName, 'u'));
  assert.match(auditGateway, /adminListAudit/u);
  assert.match(app, /authenticated\.draftGateway/u);
  assert.match(app, /authenticated\.auditGateway/u);
  assert.doesNotMatch(main, /createUnavailable|unavailableGateways/u);
});
