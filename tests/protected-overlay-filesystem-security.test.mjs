import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

import {
  createProtectedOverlayArtifact,
} from '../scripts/protected-overlay-release-gate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(projectRoot, 'scripts/protected-overlay-release.mjs');
const lockWorkerPath = join(
  projectRoot,
  'tests/fixtures/protected-overlay-lock-worker.mjs',
);
const journalWorkerPath = join(
  projectRoot,
  'tests/fixtures/protected-overlay-journal-worker.mjs',
);

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

test('deployment lock admits only one real operator process at a time', async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-lock-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  const readyPath = join(fixture, 'holder.ready');
  const resumePath = join(fixture, 'holder.resume');
  mkdirSync(managedRoot, { mode: 0o700 });

  const holder = spawn(process.execPath, [
    lockWorkerPath,
    managedRoot,
    readyPath,
    resumePath,
  ], { cwd: projectRoot, encoding: 'utf8' });
  const holderOutput = collectChildOutput(holder);
  await waitForPath(readyPath);

  const contender = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.notEqual(contender.status, 0, contender.stdout);
  assert.match(contender.stderr, /protected_overlay_transaction_locked/u);

  writeFileSync(resumePath, 'resume\n', { flag: 'wx', mode: 0o600 });
  const [status] = await once(holder, 'exit');
  const output = await holderOutput;
  assert.equal(status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), { status: 'locked' });
});

test('a process killed while holding the deployment lock cannot deadlock recovery', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-stale-lock-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  mkdirSync(managedRoot, { mode: 0o700 });

  const crashed = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CABOHEALTH_TEST_CRASH_LOCK: '1' },
  });
  assert.equal(crashed.status, null);
  assert.equal(crashed.signal, 'SIGKILL');

  const recovered = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(JSON.parse(recovered.stdout), { status: 'locked' });
});

test('durable journal records replace atomically and clear without a stale candidate', async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-journal-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const journalPath = join(fixture, 'transaction.json');
  const transaction = await import('../scripts/protected-overlay-transaction.mjs');

  transaction.writeDurableCanonicalRecord(journalPath, { phase: 'prepared' }, {
    errorCode: 'test_journal_invalid',
    mode: 0o600,
  });
  assert.deepEqual(transaction.readDurableCanonicalRecord(journalPath, {
    errorCode: 'test_journal_invalid',
    mode: 0o600,
  }), { phase: 'prepared' });

  transaction.writeDurableCanonicalRecord(journalPath, { phase: 'committed' }, {
    errorCode: 'test_journal_invalid',
    mode: 0o600,
  });
  assert.deepEqual(transaction.readDurableCanonicalRecord(journalPath, {
    errorCode: 'test_journal_invalid',
    mode: 0o600,
  }), { phase: 'committed' });
  assert.equal(statSync(journalPath).mode & 0o777, 0o600);
  assert.equal(existsSync(`${journalPath}.candidate`), false);

  transaction.clearDurableCanonicalRecord(journalPath, {
    errorCode: 'test_journal_invalid',
    mode: 0o600,
  });
  assert.equal(transaction.readDurableCanonicalRecord(journalPath, {
    errorCode: 'test_journal_invalid',
    mode: 0o600,
  }), null);
});

test('durable staging cleanup removes only an owned tree below its managed root', async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-staging-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  mkdirSync(managedRoot, { mode: 0o700 });
  const transaction = await import('../scripts/protected-overlay-transaction.mjs');
  const stagingRoot = join(managedRoot, 'staging');
  const realmRoot = join(stagingRoot, 'production');

  transaction.ensureDurableDirectory(stagingRoot, 0o700, 'test_staging_invalid');
  transaction.ensureDurableDirectory(realmRoot, 0o755, 'test_staging_invalid');
  transaction.writeDurableExclusiveFile(
    join(realmRoot, 'index.html'),
    '<!doctype html>\n',
    0o644,
    'test_staging_invalid',
  );
  transaction.removeDurableOwnedTree(stagingRoot, managedRoot, 'test_staging_invalid');

  assert.equal(existsSync(stagingRoot), false);
  assert.equal(existsSync(managedRoot), true);
});

test('SIGKILL at every durable move phase recovers one coherent release', (context) => {
  const crashSteps = [
    'journal-prepared',
    'move-1',
    'move-2',
    'state-committed',
    'journal-cleared',
  ];
  for (const crashStep of crashSteps) {
    const fixture = makeMoveTransactionFixture();
    context.after(() => rmSync(fixture, { recursive: true, force: true }));
    const crashed = spawnSync(process.execPath, [journalWorkerPath, 'execute', fixture], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: crashStep,
      },
    });
    assert.equal(crashed.status, null, `${crashStep}: ${crashed.stderr}`);
    assert.equal(crashed.signal, 'SIGKILL', crashStep);

    const recovered = spawnSync(process.execPath, [journalWorkerPath, 'recover', fixture], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.equal(recovered.status, 0, `${crashStep}: ${recovered.stderr}`);
    const state = JSON.parse(readFileSync(join(fixture, 'state.json'), 'utf8'));
    const live = readFileSync(join(fixture, 'live/release.txt'), 'utf8').trim();
    assert.equal(live, state.release, crashStep);
    assert.equal(['A', 'B'].includes(live), true, crashStep);
    assert.equal(existsSync(join(fixture, 'managed/transaction.json')), false, crashStep);

    if (state.release === 'A') {
      const retry = spawnSync(process.execPath, [journalWorkerPath, 'execute', fixture], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      assert.equal(retry.status, 0, `${crashStep}: ${retry.stderr}`);
      assert.equal(readFileSync(join(fixture, 'live/release.txt'), 'utf8'), 'B\n');
    }
  }
});

test('SIGKILL during journal recovery is itself idempotently recoverable', (context) => {
  for (const recoveryStep of ['recovery-move-2', 'recovery-move-1']) {
    const fixture = makeMoveTransactionFixture();
    context.after(() => rmSync(fixture, { recursive: true, force: true }));
    const interrupted = spawnSync(
      process.execPath,
      [journalWorkerPath, 'execute', fixture],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: 'move-2',
        },
      },
    );
    assert.equal(interrupted.signal, 'SIGKILL', recoveryStep);

    const crashedRecovery = spawnSync(
      process.execPath,
      [journalWorkerPath, 'recover', fixture],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: recoveryStep,
        },
      },
    );
    assert.equal(crashedRecovery.signal, 'SIGKILL', recoveryStep);

    const recovered = spawnSync(process.execPath, [journalWorkerPath, 'recover', fixture], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.equal(recovered.status, 0, `${recoveryStep}: ${recovered.stderr}`);
    assert.equal(readFileSync(join(fixture, 'state.json'), 'utf8'), '{"release":"A"}\n');
    assert.equal(readFileSync(join(fixture, 'live/release.txt'), 'utf8'), 'A\n');
    assert.equal(existsSync(join(fixture, 'managed/transaction.json')), false);
  }
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

function makeMoveTransactionFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-move-journal-'));
  mkdirSync(join(fixture, 'managed'), { mode: 0o700 });
  mkdirSync(join(fixture, 'live'), { mode: 0o755 });
  mkdirSync(join(fixture, 'candidate'), { mode: 0o755 });
  writeFileSync(join(fixture, 'live/release.txt'), 'A\n', { mode: 0o644 });
  writeFileSync(join(fixture, 'candidate/release.txt'), 'B\n', { mode: 0o644 });
  writeFileSync(join(fixture, 'state.json'), `${JSON.stringify({ release: 'A' })}\n`, {
    mode: 0o600,
  });
  chmodSync(join(fixture, 'state.json'), 0o600);
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

async function waitForPath(path) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

function collectChildOutput(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolvePromise) => {
    child.on('close', () => resolvePromise({ stderr, stdout }));
  });
}
