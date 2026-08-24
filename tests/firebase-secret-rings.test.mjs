import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SECRET_RING_NAMES,
  buildSecretRing,
  parseSecretProvisionArguments,
} from '../scripts/provision-firebase-secret-rings.mjs';

const EXPECTED_SECRET_RING_NAMES = [
  'CLIENT_CODE_PEPPER_RING',
  'CLIENT_INSTALLATION_PEPPER_RING',
  'CLIENT_DELETION_RECEIPT_PEPPER_RING',
  'CLIENT_RATE_LIMIT_PEPPER_RING',
  'CLIENT_LAUNCH_NONCE_PEPPER_RING',
  'CLIENT_WEB_SESSION_PEPPER_RING',
  'CLIENT_WEB_CSRF_PEPPER_RING',
  'CLIENT_BROKER_HMAC_KEY_RING',
  'APP_REVIEW_CREDENTIAL_PEPPER_RING',
  'APP_REVIEW_INSTALLATION_PEPPER_RING',
  'APP_REVIEW_DELETION_RECEIPT_PEPPER_RING',
  'APP_REVIEW_RATE_LIMIT_PEPPER_RING',
  'APP_REVIEW_LAUNCH_NONCE_PEPPER_RING',
  'APP_REVIEW_WEB_SESSION_PEPPER_RING',
  'APP_REVIEW_WEB_CSRF_PEPPER_RING',
  'APP_REVIEW_BROKER_HMAC_KEY_RING',
];

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const provisionerPath = join(projectRoot, 'scripts', 'provision-firebase-secret-rings.mjs');

function findDebugLogs(root) {
  const results = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/^firebase-debug[^/]*\.log$/u.test(entry.name)) results.push(path);
    }
  };
  visit(root);
  return results;
}

function runApplyFixture({ cliExitCode }) {
  const fixtureRepository = realpathSync(
    mkdtempSync(join(tmpdir(), 'cabohealth-firebase-secret-repo-')),
  );
  const temporaryParent = realpathSync(
    mkdtempSync(join(tmpdir(), 'cabohealth-firebase-secret-tmp-')),
  );
  const fakeBin = join(fixtureRepository, 'bin');
  const fakeFirebaseDirectory = join(
    fixtureRepository,
    'node_modules',
    'firebase-tools',
    'lib',
    'bin',
  );
  const fixtureScriptDirectory = join(fixtureRepository, 'scripts');
  const markerPath = join(temporaryParent, 'firebase-cli-observation.json');

  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(fakeFirebaseDirectory, { recursive: true });
  mkdirSync(fixtureScriptDirectory, { recursive: true });
  copyFileSync(provisionerPath, join(fixtureScriptDirectory, 'provision-firebase-secret-rings.mjs'));

  const gcloudPath = join(fakeBin, 'gcloud');
  writeFileSync(
    gcloudPath,
    '#!/usr/bin/env node\nprocess.stdout.write("\\n");\n',
    { mode: 0o700 },
  );
  chmodSync(gcloudPath, 0o700);

  writeFileSync(
    join(fakeFirebaseDirectory, 'firebase.js'),
    [
      "const { appendFileSync, readFileSync, statSync, writeFileSync } = require('node:fs');",
      "const { join } = require('node:path');",
      "const secret = readFileSync(0, 'utf8');",
      "writeFileSync(join(process.cwd(), 'firebase-debug.log'), secret);",
      "writeFileSync(join(process.cwd(), 'firebase-debug.1.log'), secret);",
      "writeFileSync(join(process.cwd(), 'firebase-debug-injected.log'), secret);",
      "appendFileSync(process.env.CABOHEALTH_TEST_MARKER, `${JSON.stringify({",
      '  cwd: process.cwd(),',
      "  mode: statSync(process.cwd()).mode & 0o777,",
      '  debugPresent: [',
      "    'DEBUG',",
      "    'FIREBASE_DEBUG',",
      "    'FIREBASE_DEBUG_MODE',",
      "    'FIREBASE_MCP_DEBUG_LOG',",
      "    'GRPC_TRACE',",
      "    'NODE_DEBUG',",
      "    'VSCODE_DEBUG_MODE',",
      '  ].some((name) => Object.hasOwn(process.env, name)),',
      "})}\\n`);",
      'process.stdout.write(secret);',
      'process.stderr.write(secret);',
      `process.exit(${cliExitCode});`,
    ].join('\n'),
    { mode: 0o600 },
  );

  const result = spawnSync(
    process.execPath,
    [
      join(fixtureScriptDirectory, 'provision-firebase-secret-rings.mjs'),
      '--project',
      'cabohealth-owner-prod',
      '--version',
      '2026-08',
      '--apply',
    ],
    {
      cwd: fixtureRepository,
      encoding: 'utf8',
      env: {
        ...process.env,
        CABOHEALTH_TEST_MARKER: markerPath,
        DEBUG: 'firebase:*',
        FIREBASE_DEBUG: 'true',
        FIREBASE_DEBUG_MODE: 'true',
        FIREBASE_MCP_DEBUG_LOG: join(fixtureRepository, 'must-not-be-created.log'),
        GRPC_TRACE: 'all',
        NODE_DEBUG: 'http',
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        TMPDIR: temporaryParent,
        VSCODE_DEBUG_MODE: 'true',
      },
    },
  );

  return {
    cleanup() {
      rmSync(fixtureRepository, { force: true, recursive: true });
      rmSync(temporaryParent, { force: true, recursive: true });
    },
    fixtureRepository,
    markerPath,
    result,
    temporaryParent,
  };
}

test('initial Firebase secret provisioning has the exact 16-ring inventory', async () => {
  assert.deepEqual(SECRET_RING_NAMES, EXPECTED_SECRET_RING_NAMES);
  assert.equal(new Set(SECRET_RING_NAMES).size, 16);

  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(
    packageJson.scripts['firebase:secrets:initial'],
    'node scripts/provision-firebase-secret-rings.mjs',
  );
});

test('every generated ring has one independent 256-bit-or-stronger key', () => {
  const rings = SECRET_RING_NAMES.map(() => buildSecretRing('2026-08'));
  const values = rings.map((ring) => ring.keys['2026-08']);

  assert.equal(new Set(values).size, 16);
  for (const ring of rings) {
    assert.deepEqual(Object.keys(ring), ['currentVersion', 'keys']);
    assert.equal(ring.currentVersion, '2026-08');
    assert.deepEqual(Object.keys(ring.keys), ['2026-08']);
    assert.ok(Buffer.from(ring.keys['2026-08'], 'base64').byteLength >= 32);
  }
});

test('secret provisioning arguments fail closed and require an explicit mode', () => {
  assert.deepEqual(
    parseSecretProvisionArguments([
      '--project', 'cabohealth-owner-prod',
      '--version', '2026-08',
      '--plan',
    ]),
    {
      apply: false,
      projectId: 'cabohealth-owner-prod',
      version: '2026-08',
    },
  );
  assert.deepEqual(
    parseSecretProvisionArguments([
      '--project', 'cabohealth-owner-prod',
      '--version', '2026-08',
      '--apply',
    ]),
    {
      apply: true,
      projectId: 'cabohealth-owner-prod',
      version: '2026-08',
    },
  );

  for (const arguments_ of [
    [],
    ['--project', 'cabohealth-owner-prod', '--version', '2026-08'],
    ['--project', 'other-project', '--version', '2026-08', '--plan'],
    ['--project', 'cabohealth-owner-prod', '--version', '2026-8', '--plan'],
    ['--project', 'cabohealth-owner-prod', '--version', '2026-08', '--plan', '--apply'],
  ]) {
    assert.throws(
      () => parseSecretProvisionArguments(arguments_),
      /firebase_secret_provision_arguments_invalid/u,
    );
  }
});

test('plan evidence never claims keys were generated', () => {
  const result = spawnSync(
    process.execPath,
    [
      provisionerPath,
      '--project',
      'cabohealth-owner-prod',
      '--version',
      '2026-08',
      '--plan',
    ],
    { cwd: projectRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.status, 'planned');
  assert.equal(evidence.independentGeneratedKeys, 0);
  assert.equal(evidence.containsSensitiveValues, false);
});

test('successful Firebase CLI apply is isolated, sanitized, silent, and residue-free', (t) => {
  const fixture = runApplyFixture({ cliExitCode: 0 });
  t.after(fixture.cleanup);

  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  assert.equal(fixture.result.stderr, '');
  assert.doesNotMatch(fixture.result.stdout, /currentVersion|keys|firebase-debug/u);

  const observations = readFileSync(fixture.markerPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(observations.length, SECRET_RING_NAMES.length);
  for (const observation of observations) {
    assert.equal(observation.mode, 0o700);
    assert.equal(observation.debugPresent, false);
    assert.equal(relative(fixture.fixtureRepository, observation.cwd).startsWith('..'), true);
    assert.equal(existsSync(observation.cwd), false);
  }
  assert.deepEqual(findDebugLogs(fixture.fixtureRepository), []);
  assert.deepEqual(findDebugLogs(fixture.temporaryParent), []);
});

test('injected Firebase CLI failure leaves no secret output, workspace, or debug residue', (t) => {
  const fixture = runApplyFixture({ cliExitCode: 2 });
  t.after(fixture.cleanup);

  assert.equal(fixture.result.status, 1);
  assert.equal(fixture.result.stdout, '');
  assert.equal(fixture.result.stderr, 'firebase_secret_apply_failed\n');
  assert.doesNotMatch(fixture.result.stderr, /currentVersion|keys|firebase-debug/u);

  const [observation] = readFileSync(fixture.markerPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(observation.mode, 0o700);
  assert.equal(observation.debugPresent, false);
  assert.equal(relative(fixture.fixtureRepository, observation.cwd).startsWith('..'), true);
  assert.equal(existsSync(observation.cwd), false);
  assert.deepEqual(findDebugLogs(fixture.fixtureRepository), []);
  assert.deepEqual(findDebugLogs(fixture.temporaryParent), []);
});
