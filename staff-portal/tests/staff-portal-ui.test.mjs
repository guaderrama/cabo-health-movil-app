import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('the code surface supports a dynamic access list and requires copy acknowledgment before hiding plaintext', () => {
  const source = read('src/components/CodeAdminPanel.tsx');

  assert.match(source, /snapshot\.codes\.map/u);
  assert.doesNotMatch(source, /\[1, 2, 3, 4\]|01 — 04/u);
  assert.match(source, /navigator\.clipboard\.writeText/u);
  assert.match(source, /model\.acknowledgeCodeCopied\(\)/u);
  assert.match(source, /disabled=\{!copied\}/u);
  assert.match(source, /snapshot\.oneTimeCode !== null/u);
  assert.match(source, /aria-live="assertive"/u);
  assert.match(source, /ConfirmDialog/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|AsyncStorage|firestore/iu);
});

test('the resource surface is draft-only, bilingual, and visibly fail-closed when unavailable', () => {
  const source = read('src/components/CatalogDraftPanel.tsx');

  assert.match(source, /t\('drafts\.reviewGate'\)/u);
  assert.match(source, /t\('drafts\.titleEn'\)/u);
  assert.match(source, /t\('drafts\.titleEs'\)/u);
  assert.match(source, /t\('drafts\.summaryEn'\)/u);
  assert.match(source, /t\('drafts\.summaryEs'\)/u);
  assert.match(source, /STAFF_DRAFT_ICONS/u);
  assert.match(source, /model\.archive\(/u);
  assert.match(source, /drafts\.unavailable/u);
  assert.match(source, /rel="noopener noreferrer"/u);
  assert.doesNotMatch(source, /publish|activate|runtime/iu);
  assert.doesNotMatch(source, /localStorage|sessionStorage|firestore/iu);
});

test('the owner miniapp surface publishes immediately with complete guarded CRUD controls', () => {
  const source = read('src/components/MiniappCatalogPanel.tsx');

  assert.match(source, /createCatalogItemModel/u);
  assert.match(source, /model\.create\(/u);
  assert.match(source, /model\.update\(/u);
  assert.match(source, /model\.setActive\(/u);
  assert.match(source, /model\.delete\(/u);
  assert.match(source, /role="switch"/u);
  assert.match(source, /aria-checked=\{item\.active\}/u);
  assert.match(source, /ConfirmDialog/u);
  assert.match(source, /miniapps\.deleteConfirm/u);
  assert.match(source, /miniapps\.appleRule/u);
  assert.match(source, /miniapps\.externalWarning/u);
  assert.match(source, /miniapps\.urlInvalid/u);
  assert.match(source, /isCatalogItemUrlInvalid/u);
  assert.match(source, /url-invalid/u);
  assert.match(source, /url: editing\.url/u);
  assert.match(source, /miniapps\.conflict/u);
  assert.match(source, /disabled=\{busy\}/u);
  assert.match(source, /operationRef\.current/u);
  assert.match(source, /rel="noopener noreferrer"/u);
  assert.doesNotMatch(source, /draft|release review|localStorage|sessionStorage|firestore/iu);
});

test('the activity surface is read-only, sanitized, and visibly fail-closed', () => {
  const source = read('src/components/AuditPanel.tsx');

  assert.match(source, /createAuditModel/u);
  assert.match(source, /t\('audit\.unavailable'\)/u);
  assert.match(source, /<table/u);
  assert.match(source, /targetSuffix/u);
  assert.match(source, /audit\.action\.miniappCreated/u);
  assert.match(source, /audit\.action\.miniappDeleted/u);
  assert.doesNotMatch(source, /action\.split/u);
  assert.doesNotMatch(source, /oneTimeCode|email|phone|clientName/iu);
  assert.doesNotMatch(source, /<form|<input|create\(|delete\(/iu);
});

test('the portal has visible password sign-in, password recovery, scope, language, and owner work areas', () => {
  const app = read('src/App.tsx');

  assert.match(app, /services\.signIn/u);
  assert.match(app, /services\.requestPasswordReset/u);
  assert.match(app, /auth\.verificationSent/u);
  assert.match(app, /auth\.passwordResetSent/u);
  assert.match(app, /auth\.resetPassword/u);
  assert.match(app, /session\.scope/u);
  assert.match(app, /CodeAdminPanel/u);
  assert.match(app, /MiniappCatalogPanel/u);
  assert.match(app, /client_resource_publish/u);
  assert.match(app, /CatalogDraftPanel/u);
  assert.match(app, /AuditPanel/u);
  assert.match(app, /aria-label="Portal language"/u);
  assert.match(app, /document\.documentElement\.lang\s*=\s*language/u);
  assert.match(app, /services\.onAuthorizationLost/u);
  assert.match(app, /isStaffAuthorizationBoundaryError/u);
  assert.match(app, /t\(authError\)/u);
  for (const reset of [
    /setAuthenticated\(null\)/u,
    /setEmail\(''\)/u,
    /setPassword\(''\)/u,
    /setStage\('sign-in'\)/u,
  ]) assert.match(app, reset);
  assert.doesNotMatch(app, /completeTotp|totp-enroll|Authenticator|one-time-code/u);
  assert.doesNotMatch(app, /tapCount|longPress|PIN|localStorage|sessionStorage|indexedDB|location\.search|console\./iu);
  assert.doesNotMatch(app, /select[^>]+scope|scope[^\n]+onChange/iu);
});

test('confirmation dialogs close on Escape, trap focus, and restore the invoking control', () => {
  const dialog = read('src/components/ConfirmDialog.tsx');

  assert.match(dialog, /document\.activeElement/u);
  assert.match(dialog, /event\.key === 'Escape'/u);
  assert.match(dialog, /event\.key !== 'Tab'/u);
  assert.match(dialog, /event\.shiftKey/u);
  assert.match(dialog, /previousFocus\.current\?\.focus\(\)/u);
  assert.match(dialog, /document\.addEventListener\('keydown'/u);
  assert.match(dialog, /document\.removeEventListener\('keydown'/u);
  assert.match(dialog, /aria-modal="true"/u);
  assert.match(dialog, /busyRef\.current/u);
  assert.match(dialog, /disabled=\{props\.busy\}/u);
});

test('App Review is a visible production-only workspace with verified one-time copy and hide confirmation', () => {
  const panel = read('src/components/AppReviewCredentialPanel.tsx');
  const app = read('src/App.tsx');
  const services = read('src/firebase/firebaseStaffServices.ts');
  const domain = read('src/domain/appReviewCredential.ts');

  assert.match(app, /AppReviewCredentialPanel/u);
  assert.match(app, /app_review_credential/u);
  assert.match(app, /session\.scope === 'production'/u);
  assert.match(services, /createAppReviewCredentialGateway/u);
  assert.match(panel, /navigator\.clipboard\.writeText/u);
  assert.match(panel, /model\.markCopied\(\)/u);
  assert.match(panel, /disabled=\{!snapshot\.copied/u);
  assert.match(panel, /model\.acknowledgeHidden\(\)/u);
  assert.match(panel, /ConfirmDialog/u);
  assert.match(panel, /t\('review\.freezeWarning'\)/u);
  assert.match(panel, /snapshot\.oneTimeCredential !== null/u);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|indexedDB|console\./iu);
  assert.doesNotMatch(domain, /localStorage|sessionStorage|indexedDB|console\./iu);
});
