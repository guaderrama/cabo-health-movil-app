import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import ignore from 'ignore';

const easRules = ignore().add(readFileSync(new URL('../.easignore', import.meta.url), 'utf8'));

test('the native EAS upload excludes server, private, evidence, and parameter surfaces', () => {
  const excluded = [
    'functions/src/index.ts',
    'functions/.env.cabohealth-prod',
    'staff-portal/src/main.tsx',
    'staff-portal/dist/index.html',
    'web-hosting/cabohealth.org/app/privacy/index.html',
    'client-resources-private/config/backend-factory.php',
    'app-review-private/config/backend-factory.php',
    'miniapps/healthy-recipes/index.html',
    'release/app-store/3.0/review-notes.md',
    'firebase.json',
    'firestore.rules',
    'firestore.review.rules',
  ];
  for (const path of excluded) {
    assert.equal(easRules.ignores(path), true, `${path} would enter the EAS upload context`);
  }
});

test('the native EAS upload retains required app source and assets', () => {
  const retained = [
    'app/index.tsx',
    'features/clientAccess/firebaseClientAccessAdapter.ts',
    'assets/icon.png',
    'app.json',
    'app.config.js',
    'eas.json',
    'package.json',
    'package-lock.json',
  ];
  for (const path of retained) {
    assert.equal(easRules.ignores(path), false, `${path} would be missing from the EAS upload context`);
  }
});

test('Firebase parameter files are excluded from Git as well as EAS', () => {
  const output = execFileSync('git', ['check-ignore', '-q', 'functions/.env.cabohealth-prod'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(output, '');
});
