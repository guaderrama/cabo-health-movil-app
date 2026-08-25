import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import ignore from 'ignore';

const projectRoot = new URL('..', import.meta.url);
const require = createRequire(import.meta.url);
const { makeShallowCopyAsync } = require('eas-cli/build/vcs/local.js');
const easRules = ignore().add(readFileSync(new URL('../.easignore', import.meta.url), 'utf8'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeFixture(root, relativePath, bytes) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, bytes);
}

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
    'patches/@react-native-firebase+app+26.3.2.patch',
    'patches/@react-native-firebase+auth+26.3.2.patch',
    'release/public-contact-facts.json',
  ];
  for (const path of retained) {
    assert.equal(easRules.ignores(path), false, `${path} would be missing from the EAS upload context`);
  }
});

test('the pinned EAS archive implementation copies the exact public contact record', async (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'cabohealth-eas-context-'));
  const archiveRoot = mkdtempSync(join(tmpdir(), 'cabohealth-eas-archive-'));
  t.after(() => {
    rmSync(fixtureRoot, { force: true, recursive: true });
    rmSync(archiveRoot, { force: true, recursive: true });
  });

  const contactBytes = readFileSync(new URL('../release/public-contact-facts.json', import.meta.url));
  writeFixture(fixtureRoot, '.easignore', readFileSync(new URL('../.easignore', import.meta.url)));
  writeFixture(fixtureRoot, 'app/index.tsx', 'export default null;\n');
  writeFixture(fixtureRoot, 'release/public-contact-facts.json', contactBytes);
  writeFixture(fixtureRoot, 'release/private/secret.json', '{"secret":true}\n');
  writeFixture(fixtureRoot, 'release/app-store/3.0/evidence.json', '{"private":true}\n');
  writeFixture(fixtureRoot, 'app-review-private/config/backend.php', '<?php // private\n');

  await makeShallowCopyAsync(fixtureRoot, archiveRoot);

  const archivedContact = readFileSync(join(archiveRoot, 'release/public-contact-facts.json'));
  assert.equal(sha256(archivedContact), sha256(contactBytes));
  assert.equal(easRules.ignores('release/public-contact-facts.json'), false);
  assert.throws(() => readFileSync(join(archiveRoot, 'release/private/secret.json')), /ENOENT/u);
  assert.throws(
    () => readFileSync(join(archiveRoot, 'release/app-store/3.0/evidence.json')),
    /ENOENT/u,
  );
  assert.throws(
    () => readFileSync(join(archiveRoot, 'app-review-private/config/backend.php')),
    /ENOENT/u,
  );
});

test('Firebase parameter files are excluded from Git as well as EAS', () => {
  const output = execFileSync('git', ['check-ignore', '-q', 'functions/.env.cabohealth-prod'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(output, '');
});
