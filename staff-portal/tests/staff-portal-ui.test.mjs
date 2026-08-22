import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('the code surface shows four slots and requires copy acknowledgment before hiding plaintext', () => {
  const source = read('src/components/CodeAdminPanel.tsx');

  assert.match(source, /model\.getSlots\(\)/u);
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

test('the activity surface is read-only, sanitized, and visibly fail-closed', () => {
  const source = read('src/components/AuditPanel.tsx');

  assert.match(source, /createAuditModel/u);
  assert.match(source, /t\('audit\.unavailable'\)/u);
  assert.match(source, /<table/u);
  assert.match(source, /targetSuffix/u);
  assert.doesNotMatch(source, /oneTimeCode|email|phone|clientName/iu);
  assert.doesNotMatch(source, /<form|<input|create\(|delete\(/iu);
});

test('the portal has visible sign-in, TOTP, scope, language, and three explicit work areas', () => {
  const app = read('src/App.tsx');

  assert.match(app, /services\.signIn/u);
  assert.match(app, /services\.completeTotp/u);
  assert.match(app, /session\.scope/u);
  assert.match(app, /CodeAdminPanel/u);
  assert.match(app, /CatalogDraftPanel/u);
  assert.match(app, /AuditPanel/u);
  assert.match(app, /aria-label="Portal language"/u);
  assert.doesNotMatch(app, /tapCount|longPress|PIN|localStorage|sessionStorage|location\.search/iu);
  assert.doesNotMatch(app, /select[^>]+scope|scope[^\n]+onChange/iu);
});
