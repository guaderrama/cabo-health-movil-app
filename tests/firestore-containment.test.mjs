import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function firestoreRules() {
  return readFileSync(`${projectRoot}/firestore.rules`, 'utf8');
}

test('Firestore denies every direct client operation by default', () => {
  const rules = firestoreRules();

  assert.match(rules, /match\s+\/\{document=\*\*\}\s*\{/u);
  assert.match(rules, /allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/u);
  assert.doesNotMatch(rules, /allow\s+[^;]+:\s*if\s+(?!false\s*;)[^;]+;/u);
});

test('legacy setup documents cannot re-enable public data or static admin bypasses', () => {
  const legacyDocs = [
    'FIREBASE_SETUP.md',
    'PRODUCTION_CHECKLIST.md',
  ].map((relativePath) => readFileSync(`${projectRoot}/${relativePath}`, 'utf8')).join('\n');

  for (const unsafeInstruction of [
    /start in test mode/iu,
    /allow\s+read\s*:\s*if\s+true/iu,
    /master admin code/iu,
    /admin access[^\n]*pin/iu,
    /seed-firestore\.(?:ts|js)/iu,
  ]) {
    assert.equal(
      unsafeInstruction.test(legacyDocs),
      false,
      'legacy operations documentation contains a prohibited instruction',
    );
  }
});

test('the containment runbook requires private backup and a fail-closed rollback', () => {
  const runbook = readFileSync(
    `${projectRoot}/docs/operations/firestore-legacy-containment.md`,
    'utf8',
  );

  for (const requiredControl of [
    /gcloud firestore export/iu,
    /overall_export_metadata/iu,
    /public access prevention/iu,
    /firebase deploy --only firestore:rules/iu,
    /anonymous[^\n]+denied/iu,
    /authenticated[^\n]+denied/iu,
    /never[^\n]+restore[^\n]+public (?:read|write)/iu,
    /recovery project/iu,
  ]) {
    assert.equal(
      requiredControl.test(runbook),
      true,
      'Firestore containment runbook is missing a required safety control',
    );
  }
});

test('retired anonymous Firestore mutator scripts cannot be run', () => {
  for (const relativePath of [
    'scripts/seed-firestore.ts',
    'scripts/update-cards.js',
  ]) {
    assert.equal(
      existsSync(`${projectRoot}/${relativePath}`),
      false,
      `${relativePath} must not remain executable`,
    );
  }
});

test('Firebase commands cannot silently select a remote default project', () => {
  const firebaseRc = JSON.parse(readFileSync(`${projectRoot}/.firebaserc`, 'utf8'));

  assert.equal(firebaseRc.projects?.default, undefined);
});
