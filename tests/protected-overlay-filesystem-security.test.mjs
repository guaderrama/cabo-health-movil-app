import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
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
const durableRenameWorkerPath = join(
  projectRoot,
  'tests/fixtures/protected-overlay-durable-rename-worker.mjs',
);
const cleanupWorkerPath = join(
  projectRoot,
  'tests/fixtures/protected-overlay-cleanup-worker.mjs',
);

function publishResumeSignal(path) {
  const candidatePath = `${path}.candidate-${process.pid}`;
  writeFileSync(candidatePath, 'resume\n', { flag: 'wx', mode: 0o600 });
  renameSync(candidatePath, path);
}

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

  publishResumeSignal(resumePath);
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

test('two stale-lock recoverers cannot unlink a newly acquired lock', async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-stale-lock-race-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  const staleUnlinkReady = join(fixture, 'stale-unlink.ready');
  const staleUnlinkResume = join(fixture, 'stale-unlink.resume');
  const preload = join(fixture, 'pause-stale-unlink.cjs');
  mkdirSync(managedRoot, { mode: 0o700 });
  writePauseBeforeUnlinkPreload(preload);

  const crashed = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CABOHEALTH_TEST_CRASH_LOCK: '1' },
  });
  assert.equal(crashed.signal, 'SIGKILL');

  const delayedRecoverer = spawn(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      CABOHEALTH_TEST_STALE_UNLINK_TARGET: join(realpathSync(managedRoot), 'transaction.lock'),
      CABOHEALTH_TEST_STALE_UNLINK_READY_PATH: staleUnlinkReady,
      CABOHEALTH_TEST_STALE_UNLINK_RESUME_PATH: staleUnlinkResume,
    },
  });
  const delayedOutput = collectChildOutput(delayedRecoverer);
  await waitForPathWhileRunning(staleUnlinkReady, delayedRecoverer, delayedOutput);

  const contender = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  publishResumeSignal(staleUnlinkResume);
  const [delayedStatus] = await once(delayedRecoverer, 'exit');
  const delayedResult = await delayedOutput;

  assert.notEqual(contender.status, 0, contender.stdout);
  assert.match(
    contender.stderr,
    /protected_overlay_transaction_(?:locked|lock_invalid|lock_recovery_required)/u,
  );
  assert.equal(delayedStatus, 0, delayedResult.stderr);
  assert.deepEqual(JSON.parse(delayedResult.stdout), { status: 'locked' });
});

test('a killed stale-lock reclaimer fails closed without deleting or replacing the lock', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-stale-claim-crash-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  const lockPath = join(managedRoot, 'transaction.lock');
  mkdirSync(managedRoot, { mode: 0o700 });

  const holder = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CABOHEALTH_TEST_CRASH_LOCK: '1' },
  });
  assert.equal(holder.signal, 'SIGKILL');
  const originalLock = statSync(lockPath);

  const reclaimer = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: 'stale-lock-claimed',
    },
  });
  assert.equal(reclaimer.signal, 'SIGKILL');

  const contender = spawnSync(process.execPath, [lockWorkerPath, managedRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.notEqual(contender.status, 0, contender.stdout);
  assert.match(
    contender.stderr,
    /protected_overlay_transaction_lock_recovery_required/u,
  );
  const unchangedLock = statSync(lockPath);
  assert.equal(unchangedLock.dev, originalLock.dev);
  assert.equal(unchangedLock.ino, originalLock.ino);
  assert.equal(
    readdirSync(managedRoot).filter((name) => name.endsWith('.reclaim')).length,
    1,
  );
});

test('test-only transaction barrier holds a real process until explicitly resumed', async (context) => {
  const fixture = makeMoveTransactionFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const readyPath = join(fixture, 'checkpoint.ready');
  const resumeRoot = join(fixture, 'resume-signals');
  mkdirSync(resumeRoot, { mode: 0o700 });
  const resumePath = join(resumeRoot, 'checkpoint.resume');
  const worker = spawn(process.execPath, [journalWorkerPath, 'execute', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_PAUSE_AFTER_STEP: 'journal-prepared',
      CABOHEALTH_OVERLAY_TEST_PAUSE_READY_PATH: readyPath,
      CABOHEALTH_OVERLAY_TEST_PAUSE_RESUME_PATH: resumePath,
    },
  });
  const output = collectChildOutput(worker);

  await waitForFileContentsWhileRunning(
    readyPath,
    'journal-prepared\n',
    worker,
    output,
    30_000,
  );
  assert.equal(worker.exitCode, null);
  assert.equal(readFileSync(readyPath, 'utf8'), 'journal-prepared\n');

  publishResumeSignal(resumePath);
  const [status] = await once(worker, 'exit');
  const result = await output;
  assert.equal(status, 0, result.stderr);
  assert.equal(readFileSync(join(fixture, 'live/release.txt'), 'utf8'), 'B\n');
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

test('durable staging cleanup cannot follow a directory substituted after validation', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-cleanup-aba-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  const stagingRoot = join(managedRoot, 'staging');
  const stagingBackup = join(managedRoot, 'staging-original');
  const victimRoot = join(fixture, 'victim');
  const victimFile = join(victimRoot, 'must-survive.txt');
  const replacement = join(fixture, 'staging-replacement');
  const preload = join(fixture, 'swap-cleanup-directory.cjs');
  const swapMarker = join(fixture, 'root-swap.complete');
  mkdirSync(managedRoot, { mode: 0o700 });
  mkdirSync(stagingRoot, { mode: 0o700 });
  mkdirSync(victimRoot, { mode: 0o700 });
  writeFileSync(join(stagingRoot, 'decoy.txt'), 'decoy\n', { mode: 0o600 });
  writeFileSync(victimFile, 'sensitive\n', { mode: 0o600 });
  symlinkSync(victimRoot, replacement);
  writeSwapAfterLstatPreload(preload);

  const result = spawnSync(process.execPath, [
    cleanupWorkerPath,
    stagingRoot,
    managedRoot,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      CABOHEALTH_TEST_SWAP_TARGET: realpathSync(stagingRoot),
      CABOHEALTH_TEST_SWAP_REPLACEMENT: replacement,
      CABOHEALTH_TEST_SWAP_BACKUP: stagingBackup,
      CABOHEALTH_TEST_SWAP_MARKER: swapMarker,
    },
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /test_cleanup_invalid/u);
  assert.equal(readFileSync(swapMarker, 'utf8'), 'swapped\n');
  assert.equal(readFileSync(victimFile, 'utf8'), 'sensitive\n');
  assert.equal(readFileSync(join(stagingBackup, 'decoy.txt'), 'utf8'), 'decoy\n');
});

test('durable staging cleanup binds every nested directory before traversal', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-cleanup-nested-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  const stagingRoot = join(managedRoot, 'staging');
  const nestedRoot = join(stagingRoot, 'production');
  const nestedBackup = join(stagingRoot, 'production-original');
  const replacement = join(fixture, 'production-replacement');
  const victimRoot = join(fixture, 'victim');
  const victimFile = join(victimRoot, 'must-survive.txt');
  const preload = join(fixture, 'swap-nested-directory.cjs');
  const swapMarker = join(fixture, 'nested-swap.complete');
  mkdirSync(managedRoot, { mode: 0o700 });
  mkdirSync(stagingRoot, { mode: 0o700 });
  mkdirSync(nestedRoot, { mode: 0o755 });
  mkdirSync(victimRoot, { mode: 0o700 });
  writeFileSync(join(nestedRoot, 'decoy.txt'), 'decoy\n', { mode: 0o600 });
  writeFileSync(victimFile, 'sensitive\n', { mode: 0o600 });
  symlinkSync(victimRoot, replacement);
  writeSwapAfterLstatPreload(preload);

  const result = spawnSync(process.execPath, [
    cleanupWorkerPath,
    stagingRoot,
    managedRoot,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      CABOHEALTH_TEST_SWAP_TARGET: realpathSync(nestedRoot),
      CABOHEALTH_TEST_SWAP_REPLACEMENT: replacement,
      CABOHEALTH_TEST_SWAP_BACKUP: nestedBackup,
      CABOHEALTH_TEST_SWAP_MARKER: swapMarker,
    },
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /test_cleanup_invalid/u);
  assert.equal(readFileSync(swapMarker, 'utf8'), 'swapped\n');
  assert.equal(readFileSync(victimFile, 'utf8'), 'sensitive\n');
});

test('durable staging cleanup binds every ancestor below the managed root', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-cleanup-ancestor-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const managedRoot = join(fixture, 'managed');
  const candidatesRoot = join(managedRoot, 'candidates');
  const candidatesBackup = join(managedRoot, 'candidates-original');
  const leafName = 'release.building-0123456789abcdef0123456789abcdef';
  const stagingRoot = join(candidatesRoot, leafName);
  const externalParent = join(fixture, 'external-parent');
  const victimRoot = join(externalParent, leafName);
  const victimFile = join(victimRoot, 'must-survive.txt');
  const preload = join(fixture, 'swap-cleanup-ancestor.cjs');
  const swapMarker = join(fixture, 'ancestor-swap.complete');
  mkdirSync(managedRoot, { mode: 0o700 });
  mkdirSync(candidatesRoot, { mode: 0o700 });
  mkdirSync(stagingRoot, { mode: 0o700 });
  mkdirSync(externalParent, { mode: 0o700 });
  mkdirSync(victimRoot, { mode: 0o700 });
  writeFileSync(join(stagingRoot, 'decoy.txt'), 'decoy\n', { mode: 0o600 });
  writeFileSync(victimFile, 'sensitive\n', { mode: 0o600 });
  writeSwapAncestorAfterExistsPreload(preload);

  const result = spawnSync(process.execPath, [
    cleanupWorkerPath,
    stagingRoot,
    managedRoot,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      CABOHEALTH_TEST_SWAP_EXISTS_TARGET: stagingRoot,
      CABOHEALTH_TEST_SWAP_ANCESTOR: candidatesRoot,
      CABOHEALTH_TEST_SWAP_ANCESTOR_BACKUP: candidatesBackup,
      CABOHEALTH_TEST_SWAP_ANCESTOR_REPLACEMENT: externalParent,
      CABOHEALTH_TEST_SWAP_MARKER: swapMarker,
    },
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /test_cleanup_invalid/u);
  assert.equal(readFileSync(swapMarker, 'utf8'), 'swapped\n');
  assert.equal(readFileSync(victimFile, 'utf8'), 'sensitive\n');
  assert.equal(
    readFileSync(join(candidatesBackup, leafName, 'decoy.txt'), 'utf8'),
    'decoy\n',
  );
});

test('cross-directory durable rename syncs destination before source', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-rename-order-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const sourceRoot = join(fixture, 'source');
  const destinationRoot = join(fixture, 'destination');
  const source = join(sourceRoot, 'release');
  const destination = join(destinationRoot, 'release');
  const logPath = join(fixture, 'fsync-order.txt');
  const preload = join(fixture, 'record-directory-fsync.cjs');
  mkdirSync(sourceRoot, { mode: 0o755 });
  mkdirSync(destinationRoot, { mode: 0o755 });
  mkdirSync(source, { mode: 0o755 });
  writeFileSync(join(source, 'release.txt'), 'B\n', { mode: 0o644 });
  writeDirectoryFsyncPreload(preload);

  const result = spawnSync(process.execPath, [
    durableRenameWorkerPath,
    source,
    destination,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      CABOHEALTH_TEST_FSYNC_LOG: logPath,
      CABOHEALTH_TEST_FSYNC_SOURCE_INO: String(statSync(sourceRoot).ino),
      CABOHEALTH_TEST_FSYNC_DESTINATION_INO: String(statSync(destinationRoot).ino),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(logPath, 'utf8'), 'DS');
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

test('SIGKILL between destination and source fsync recovers a cross-directory move', (context) => {
  const fixture = makeCrossDirectoryMoveTransactionFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    CABOHEALTH_TEST_CROSS_DIRECTORY: '1',
  };
  const crashed = spawnSync(process.execPath, [journalWorkerPath, 'execute', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...environment,
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: 'rename-destination-synced',
    },
  });
  assert.equal(crashed.signal, 'SIGKILL');

  const recovered = spawnSync(process.execPath, [journalWorkerPath, 'recover', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
  });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(readFileSync(join(fixture, 'state.json'), 'utf8'), '{"release":"A"}\n');
  assert.equal(readFileSync(join(fixture, 'public/live/release.txt'), 'utf8'), 'A\n');
  assert.equal(readFileSync(join(fixture, 'stage/candidate/release.txt'), 'utf8'), 'B\n');
  assert.equal(existsSync(join(fixture, 'managed/transaction.json')), false);
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

test('first promotion recovers to truly absent state before an idempotent retry', (context) => {
  const fixture = makeAbsentMoveTransactionFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const environment = {
    ...process.env,
    CABOHEALTH_TEST_STARTS_ABSENT: '1',
  };
  const crashed = spawnSync(process.execPath, [journalWorkerPath, 'execute', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...environment,
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: 'move-1',
    },
  });
  assert.equal(crashed.signal, 'SIGKILL');

  const recovered = spawnSync(process.execPath, [journalWorkerPath, 'recover', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
  });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(existsSync(join(fixture, 'state.json')), false);
  assert.equal(existsSync(join(fixture, 'live')), false);
  assert.equal(readFileSync(join(fixture, 'candidate/release.txt'), 'utf8'), 'B\n');

  const retried = spawnSync(process.execPath, [journalWorkerPath, 'execute', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
  });
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(readFileSync(join(fixture, 'live/release.txt'), 'utf8'), 'B\n');
  assert.equal(readFileSync(join(fixture, 'state.json'), 'utf8'), '{"release":"B"}\n');
});

test('recovery will not clear a committed journal when archived topology is missing', (context) => {
  const fixture = makeMoveTransactionFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const crashed = spawnSync(process.execPath, [journalWorkerPath, 'execute', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: 'state-committed',
    },
  });
  assert.equal(crashed.signal, 'SIGKILL');
  rmSync(join(fixture, 'backup'), { recursive: true });

  const recovery = spawnSync(process.execPath, [journalWorkerPath, 'recover', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.notEqual(recovery.status, 0, recovery.stdout);
  assert.match(recovery.stderr, /protected_overlay_transaction_recovery_failed/u);
  assert.equal(existsSync(join(fixture, 'managed/transaction.json')), true);
});

test('recovery will not clear a committed journal when archived bytes were replaced', (context) => {
  const fixture = makeMoveTransactionFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const crashed = spawnSync(process.execPath, [journalWorkerPath, 'execute', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: 'state-committed',
    },
  });
  assert.equal(crashed.signal, 'SIGKILL');
  writeFileSync(join(fixture, 'backup/release.txt'), 'ATTACKER\n');

  const recovery = spawnSync(process.execPath, [journalWorkerPath, 'recover', fixture], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.notEqual(recovery.status, 0, recovery.stdout);
  assert.match(recovery.stderr, /protected_overlay_transaction_recovery_failed/u);
  assert.equal(existsSync(join(fixture, 'managed/transaction.json')), true);
});

test('move transactions reject a symlinked parent that escapes the deployment root', async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-move-escape-'));
  const outside = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-move-outside-'));
  context.after(() => {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  mkdirSync(join(fixture, 'managed'), { mode: 0o700 });
  mkdirSync(join(outside, 'slot'), { mode: 0o755 });
  writeFileSync(join(outside, 'slot/source.txt'), 'outside\n', { mode: 0o644 });
  symlinkSync(outside, join(fixture, 'escape'));
  let state = Object.freeze({ release: 'A' });
  const transaction = await import('../scripts/protected-overlay-transaction.mjs');

  assert.throws(() => transaction.withExclusiveOverlayLock(
    join(fixture, 'managed'),
    ({ token }) => transaction.executeDurableMoveTransaction({
      afterState: Object.freeze({ release: 'B' }),
      beforeState: state,
      managedRoot: join(fixture, 'managed'),
      moves: [Object.freeze({
        source: 'escape/slot/source.txt',
        destination: 'escape/slot/destination.txt',
      })],
      operation: 'promote',
      readState: () => state,
      root: fixture,
      token,
      validateState: (value) => value?.release === 'A' || value?.release === 'B',
      verifyLive: () => true,
      verifyTopology: () => true,
      writeState: (value) => { state = value; },
    }),
  ), /protected_overlay_transaction_(?:invalid|root_invalid)/u);
  assert.equal(readFileSync(join(outside, 'slot/source.txt'), 'utf8'), 'outside\n');
  assert.equal(existsSync(join(outside, 'slot/destination.txt')), false);
});

test('move transactions enforce initial state and live CAS before journaling', async (context) => {
  const fixture = makeMoveTransactionFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const transaction = await import('../scripts/protected-overlay-transaction.mjs');
  const beforeState = Object.freeze({ release: 'A' });
  const afterState = Object.freeze({ release: 'B' });

  assert.throws(() => transaction.withExclusiveOverlayLock(
    join(fixture, 'managed'),
    ({ token }) => transaction.executeDurableMoveTransaction({
      afterState,
      beforeState,
      managedRoot: join(fixture, 'managed'),
      moves: [
        Object.freeze({ source: 'live', destination: 'backup' }),
        Object.freeze({ source: 'candidate', destination: 'live' }),
      ],
      operation: 'promote',
      readState: () => afterState,
      root: fixture,
      token,
      validateState: (value) => value?.release === 'A' || value?.release === 'B',
      verifyLive: () => true,
      verifyTopology: () => true,
      writeState: () => {},
    }),
  ), /protected_overlay_transaction_state_invalid/u);
  assert.equal(existsSync(join(fixture, 'managed/transaction.json')), false);
  assert.equal(existsSync(join(fixture, 'backup')), false);
});

test('move transactions reject cyclic topology that cannot identify a crash prefix', async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-move-cycle-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, 'managed'), { mode: 0o700 });
  for (const name of ['a', 'b', 'temporary']) {
    writeFileSync(join(fixture, name), `${name}\n`, { mode: 0o644 });
  }
  let state = Object.freeze({ release: 'A' });
  const transaction = await import('../scripts/protected-overlay-transaction.mjs');

  assert.throws(() => transaction.withExclusiveOverlayLock(
    join(fixture, 'managed'),
    ({ token }) => transaction.executeDurableMoveTransaction({
      afterState: Object.freeze({ release: 'B' }),
      beforeState: state,
      managedRoot: join(fixture, 'managed'),
      moves: [
        Object.freeze({ source: 'a', destination: 'slot' }),
        Object.freeze({ source: 'b', destination: 'a' }),
        Object.freeze({ source: 'slot', destination: 'b' }),
      ],
      operation: 'promote',
      readState: () => state,
      root: fixture,
      token,
      validateState: (value) => value?.release === 'A' || value?.release === 'B',
      verifyLive: () => true,
      verifyTopology: () => true,
      writeState: (value) => { state = value; },
    }),
  ), /protected_overlay_transaction_invalid/u);
  assert.equal(existsSync(join(fixture, 'managed/transaction.json')), false);
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

function makeAbsentMoveTransactionFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-absent-journal-'));
  mkdirSync(join(fixture, 'managed'), { mode: 0o700 });
  mkdirSync(join(fixture, 'candidate'), { mode: 0o755 });
  writeFileSync(join(fixture, 'candidate/release.txt'), 'B\n', { mode: 0o644 });
  return fixture;
}

function makeCrossDirectoryMoveTransactionFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-overlay-cross-directory-journal-'));
  for (const path of ['managed', 'public', 'archive', 'stage']) {
    mkdirSync(join(fixture, path), { mode: path === 'managed' ? 0o700 : 0o755 });
  }
  mkdirSync(join(fixture, 'public/live'), { mode: 0o755 });
  mkdirSync(join(fixture, 'stage/candidate'), { mode: 0o755 });
  writeFileSync(join(fixture, 'public/live/release.txt'), 'A\n', { mode: 0o644 });
  writeFileSync(join(fixture, 'stage/candidate/release.txt'), 'B\n', { mode: 0o644 });
  writeFileSync(join(fixture, 'state.json'), '{"release":"A"}\n', { mode: 0o600 });
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
    if (process.env.CABOHEALTH_TEST_SWAP_MARKER) {
      fs.writeFileSync(process.env.CABOHEALTH_TEST_SWAP_MARKER, 'swapped\\n', {
        flag: 'wx',
        mode: 0o600,
      });
    }
  }
  return stat;
};
syncBuiltinESMExports();
`);
}

function writeSwapAncestorAfterExistsPreload(path) {
  writeFileSync(path, `'use strict';
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const pathModule = require('node:path');
const originalExists = fs.existsSync;
let swapped = false;
fs.existsSync = function existsAndSwap(path) {
  const exists = originalExists.call(this, path);
  if (
    !swapped
    && exists
    && pathModule.resolve(path) === pathModule.resolve(process.env.CABOHEALTH_TEST_SWAP_EXISTS_TARGET)
  ) {
    swapped = true;
    fs.renameSync(
      process.env.CABOHEALTH_TEST_SWAP_ANCESTOR,
      process.env.CABOHEALTH_TEST_SWAP_ANCESTOR_BACKUP,
    );
    fs.symlinkSync(
      process.env.CABOHEALTH_TEST_SWAP_ANCESTOR_REPLACEMENT,
      process.env.CABOHEALTH_TEST_SWAP_ANCESTOR,
    );
    fs.writeFileSync(process.env.CABOHEALTH_TEST_SWAP_MARKER, 'swapped\\n', {
      flag: 'wx',
      mode: 0o600,
    });
  }
  return exists;
};
syncBuiltinESMExports();
`);
}

function writePauseBeforeUnlinkPreload(path) {
  writeFileSync(path, `'use strict';
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const pathModule = require('node:path');
const originalUnlink = fs.unlinkSync;
let paused = false;
fs.unlinkSync = function guardedUnlink(path, ...args) {
  if (
    !paused
    && pathModule.resolve(path) === pathModule.resolve(process.env.CABOHEALTH_TEST_STALE_UNLINK_TARGET)
  ) {
    paused = true;
    fs.writeFileSync(
      process.env.CABOHEALTH_TEST_STALE_UNLINK_READY_PATH,
      'ready\\n',
      { flag: 'wx', mode: 0o600 },
    );
    const waiter = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(process.env.CABOHEALTH_TEST_STALE_UNLINK_RESUME_PATH)) {
      Atomics.wait(waiter, 0, 0, 10);
    }
  }
  return originalUnlink.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
}

function writeDirectoryFsyncPreload(path) {
  writeFileSync(path, `'use strict';
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalFsync = fs.fsyncSync;
fs.fsyncSync = function recordedFsync(descriptor) {
  const stat = fs.fstatSync(descriptor);
  if (String(stat.ino) === process.env.CABOHEALTH_TEST_FSYNC_SOURCE_INO) {
    fs.writeFileSync(process.env.CABOHEALTH_TEST_FSYNC_LOG, 'S', { flag: 'a' });
  } else if (String(stat.ino) === process.env.CABOHEALTH_TEST_FSYNC_DESTINATION_INO) {
    fs.writeFileSync(process.env.CABOHEALTH_TEST_FSYNC_LOG, 'D', { flag: 'a' });
  }
  return originalFsync.call(this, descriptor);
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

async function waitForFileContentsWhileRunning(
  path,
  expected,
  child,
  output,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(path) && readFileSync(path, 'utf8') === expected) return;
    if (child.exitCode !== null) {
      const result = await output;
      throw new Error(`child exited before ${path}: ${result.stderr || result.stdout}`);
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

async function waitForPathWhileRunning(path, child, output) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (child.exitCode !== null) {
      const result = await output;
      throw new Error(`child exited before ${path}: ${result.stderr || result.stdout}`);
    }
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
