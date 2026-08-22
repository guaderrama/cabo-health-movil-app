import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createProtectedOverlayArtifact,
} from '../scripts/protected-overlay-release-gate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(projectRoot, 'scripts/protected-overlay-release.mjs');

test('CLI rejects an inode substituted between metadata validation and reading', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-cli-toctou-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));

  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const target = join(fixture, 'artifact.json');
  const replacement = join(fixture, 'replacement.json');
  const backup = join(fixture, 'original.json');
  const preload = join(fixture, 'swap-after-lstat.cjs');
  const bytes = `${JSON.stringify(artifact)}\n`;
  writeFileSync(target, bytes, { mode: 0o400 });
  writeFileSync(replacement, bytes, { mode: 0o400 });
  chmodSync(target, 0o400);
  chmodSync(replacement, 0o400);
  writeFileSync(preload, `'use strict';
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalLstat = fs.lstatSync;
let swapped = false;
fs.lstatSync = function guardedLstat(path, ...args) {
  const stat = originalLstat.call(this, path, ...args);
  if (!swapped && require('node:path').resolve(path) === process.env.CABOHEALTH_TEST_SWAP_TARGET) {
    swapped = true;
    fs.renameSync(path, process.env.CABOHEALTH_TEST_SWAP_BACKUP);
    fs.renameSync(process.env.CABOHEALTH_TEST_SWAP_REPLACEMENT, path);
  }
  return stat;
};
syncBuiltinESMExports();
`);

  const result = spawnSync(process.execPath, [
    cliPath,
    'verify-artifact',
    '--project-root', projectRoot,
    '--artifact', target,
    '--release-id', artifact.releaseId,
    '--inventory-sha256', artifact.inventorySha256,
    '--artifact-sha256', artifact.artifactSha256,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      CABOHEALTH_TEST_SWAP_TARGET: target,
      CABOHEALTH_TEST_SWAP_REPLACEMENT: replacement,
      CABOHEALTH_TEST_SWAP_BACKUP: backup,
    },
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /protected_overlay_input_file_invalid/u);
});

test('artifact creation rejects a reviewed source inode swapped after inventory validation', (context) => {
  const fixture = makeProjectFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));

  const target = join(
    fixture,
    'web-hosting/cabohealth.org/apps/client-resources/app.js',
  );
  const replacement = join(fixture, 'replacement-app.js');
  const backup = join(fixture, 'reviewed-app.js');
  const output = join(fixture, 'artifact.json');
  const preload = join(fixture, 'swap-reviewed-source.cjs');
  cpSync(target, replacement);
  chmodSync(replacement, 0o644);
  writeSwapAfterLstatPreload(preload);

  const result = spawnSync(process.execPath, [
    cliPath,
    'create-artifact',
    '--project-root', fixture,
    '--out', output,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      CABOHEALTH_TEST_SWAP_TARGET: target,
      CABOHEALTH_TEST_SWAP_REPLACEMENT: replacement,
      CABOHEALTH_TEST_SWAP_BACKUP: backup,
    },
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /protected_overlay_(?:file|source)_invalid|protected_overlay_source_changed/u);
});

function makeProjectFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-source-toctou-'));
  for (const path of [
    'web-hosting/cabohealth.org/apps/client-resources',
    'web-hosting/cabohealth.org/apps/app-review',
    'client-resources-private/config/broker-config.schema.json',
    'app-review-private/config/broker-config.schema.json',
  ]) {
    cpSync(
      join(projectRoot, ...path.split('/')),
      join(fixture, ...path.split('/')),
      { recursive: true },
    );
  }
  return fixture;
}

function writeSwapAfterLstatPreload(path) {
  writeFileSync(path, `'use strict';
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalLstat = fs.lstatSync;
let swapped = false;
fs.lstatSync = function guardedLstat(path, ...args) {
  const stat = originalLstat.call(this, path, ...args);
  if (!swapped && require('node:path').resolve(path) === process.env.CABOHEALTH_TEST_SWAP_TARGET) {
    swapped = true;
    fs.renameSync(path, process.env.CABOHEALTH_TEST_SWAP_BACKUP);
    fs.renameSync(process.env.CABOHEALTH_TEST_SWAP_REPLACEMENT, path);
  }
  return stat;
};
syncBuiltinESMExports();
`);
}
