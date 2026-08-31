import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SOURCE_COMMIT = 'a'.repeat(40);
const BUILD_ID = '12345678-1234-4234-8234-123456789abc';
const SUBMISSION_ID = '87654321-4321-4234-8234-cba987654321';
const NOW = '2026-08-30T12:00:00.000Z';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function root(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-attempt-root-')));
  chmodSync(path, 0o700);
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

async function preparePreproviderRetry(t, action = 'build') {
  const {
    armAttempt,
    createAttemptLogs,
    finalizeObservedAttempt,
  } = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  armAttempt({
    evidenceRoot,
    action,
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 123456,
    startedAt: NOW,
  });
  createAttemptLogs({ evidenceRoot, action, attemptNumber: 1 });
  finalizeObservedAttempt({
    evidenceRoot,
    action,
    exitStatus: 1,
    terminalAt: '2026-08-30T12:01:00.000Z',
  });
  return evidenceRoot;
}

test('runner accepts only the frozen ordered command grammars', async () => {
  const { parseReleaseAttemptArguments } = await import('../scripts/release-attempt-runner.mjs');
  assert.deepEqual(parseReleaseAttemptArguments(['start', 'build']), { command: 'start', action: 'build' });
  assert.deepEqual(
    parseReleaseAttemptArguments(['retry', 'upload-testflight', '--review-sha256', 'b'.repeat(64)]),
    { command: 'retry', action: 'upload-testflight', reviewSha256: 'b'.repeat(64) },
  );
  assert.deepEqual(
    parseReleaseAttemptArguments(['recover-armed', 'build', '--expected-runner-pid', '123']),
    { command: 'recover-armed', action: 'build', expectedRunnerPid: 123 },
  );
  assert.deepEqual(parseReleaseAttemptArguments([
    'reconcile', 'build',
    '--provider-operation-id', BUILD_ID,
    '--terminal-status', 'FINISHED',
    '--evidence', '/tmp/evidence.json',
    '--evidence-sha256', 'c'.repeat(64),
  ]), {
    command: 'reconcile', action: 'build', providerOperationId: BUILD_ID,
    terminalStatus: 'FINISHED', evidencePath: '/tmp/evidence.json',
    evidenceSha256: 'c'.repeat(64),
  });
  for (const values of [
    ['start', 'build', '--extra'],
    ['retry', 'build'],
    ['retry', 'build', '--review-sha256', 'A'.repeat(64)],
    ['recover-armed', 'build', '--expected-runner-pid', '0'],
    ['reconcile', 'build', '--provider-operation-id', BUILD_ID, '--terminal-status', 'RUNNING', '--evidence', '/tmp/x', '--evidence-sha256', 'c'.repeat(64)],
  ]) assert.throws(() => parseReleaseAttemptArguments(values), /RELEASE_ATTEMPT_ARGUMENT_INVALID/u);
});

test('runner exposes every finite stable public failure code without a provider call', async (t) => {
  const {
    armAttempt,
    markProviderStarted,
    parseReleaseAttemptArguments,
    readAttemptMarker,
    reconcileAttempt,
    recoverArmedAttempt,
    retryAttempt,
  } = await import('../scripts/release-attempt-runner.mjs');
  const observed = new Set();
  const capture = (fn) => {
    try {
      fn();
      assert.fail('expected stable release-attempt failure');
    } catch (error) {
      observed.add(error.message);
    }
  };

  capture(() => parseReleaseAttemptArguments(['start', 'other']));

  const invalidRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-attempt-invalid-root-')));
  t.after(() => rmSync(invalidRoot, { recursive: true, force: true }));
  chmodSync(invalidRoot, 0o755);
  capture(() => armAttempt({
    evidenceRoot: invalidRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 1,
    startedAt: NOW,
  }));

  const markerRoot = root(t);
  armAttempt({
    evidenceRoot: markerRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 2,
    startedAt: NOW,
  });
  chmodSync(join(markerRoot, 'build-attempt.json'), 0o644);
  capture(() => readAttemptMarker(markerRoot, 'build'));

  const stateRoot = root(t);
  armAttempt({
    evidenceRoot: stateRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 3,
    startedAt: NOW,
  });
  capture(() => markProviderStarted(join(stateRoot, 'build-attempt.json'), {
    action: 'build',
    sourceCommit: 'f'.repeat(40),
  }));

  const recoveryRoot = root(t);
  armAttempt({
    evidenceRoot: recoveryRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 4,
    startedAt: NOW,
  });
  capture(() => recoverArmedAttempt({
    evidenceRoot: recoveryRoot,
    action: 'build',
    expectedRunnerPid: 4,
    kill: () => {},
  }));

  const retryRoot = root(t);
  armAttempt({
    evidenceRoot: retryRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 5,
    startedAt: NOW,
  });
  capture(() => retryAttempt({
    evidenceRoot: retryRoot,
    action: 'build',
    reviewSha256: 'a'.repeat(64),
    runnerPid: 6,
    startedAt: NOW,
  }));

  const reconciliationRoot = root(t);
  armAttempt({
    evidenceRoot: reconciliationRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 7,
    startedAt: NOW,
  });
  capture(() => reconcileAttempt({
    evidenceRoot: reconciliationRoot,
    action: 'build',
    providerOperationId: BUILD_ID,
    terminalStatus: 'FINISHED',
    evidencePath: join(reconciliationRoot, 'build-reconciliation.json'),
    evidenceSha256: 'b'.repeat(64),
    terminalAt: NOW,
  }));

  const guardRoot = await preparePreproviderRetry(t);
  const guardPreload = join(guardRoot, 'fail-guard-spawn.cjs');
  writeFileSync(guardPreload, [
    "const childProcess = require('node:child_process');",
    'childProcess.spawnSync = () => ({ status: 1 });',
    "require('node:module').syncBuiltinESMExports();",
    '',
  ].join('\n'), { mode: 0o600 });
  chmodSync(guardPreload, 0o600);
  const guardFailure = spawnSync(process.execPath, [
    join(projectRoot, 'scripts/release-attempt-runner.mjs'),
    'retry', 'build', '--review-sha256', 'c'.repeat(64),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CABOHEALTH_RELEASE_EVIDENCE_ROOT: guardRoot,
      NODE_OPTIONS: `--require=${guardPreload}`,
    },
  });
  assert.equal(guardFailure.status, 1);
  assert.equal(guardFailure.stdout, '');
  observed.add(guardFailure.stderr.trim());

  const internalRoot = await preparePreproviderRetry(t);
  const preload = join(internalRoot, 'throw-spawn.cjs');
  writeFileSync(preload, [
    "const childProcess = require('node:child_process');",
    "childProcess.spawnSync = () => { throw new Error('injected unexpected failure'); };",
    "require('node:module').syncBuiltinESMExports();",
    '',
  ].join('\n'), { mode: 0o600 });
  chmodSync(preload, 0o600);
  const internalFailure = spawnSync(process.execPath, [
    join(projectRoot, 'scripts/release-attempt-runner.mjs'),
    'retry', 'build', '--review-sha256', 'd'.repeat(64),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CABOHEALTH_RELEASE_EVIDENCE_ROOT: internalRoot,
      NODE_OPTIONS: `--require=${preload}`,
    },
  });
  assert.equal(internalFailure.status, 1);
  assert.equal(internalFailure.stdout, '');
  observed.add(internalFailure.stderr.trim());

  assert.deepEqual([...observed].sort(), [
    'RELEASE_ATTEMPT_ARGUMENT_INVALID',
    'RELEASE_ATTEMPT_ARMED_RECOVERY_INVALID',
    'RELEASE_ATTEMPT_EVIDENCE_ROOT_INVALID',
    'RELEASE_ATTEMPT_GUARD_FAILED',
    'RELEASE_ATTEMPT_INTERNAL_ERROR',
    'RELEASE_ATTEMPT_MARKER_INVALID',
    'RELEASE_ATTEMPT_RECONCILIATION_INVALID',
    'RELEASE_ATTEMPT_RETRY_NOT_AUTHORIZED',
    'RELEASE_ATTEMPT_STATE_INVALID',
  ].sort());
});

test('attempt markers and logs are explicit mode 0600 and raw evidence uses length-delimited hashing', async (t) => {
  const {
    armAttempt,
    createAttemptLogs,
    rawEvidenceSha256,
    readAttemptMarker,
  } = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  const previous = process.umask(0o077);
  try {
    armAttempt({
      evidenceRoot,
      action: 'build',
      sourceCommit: SOURCE_COMMIT,
      runnerPid: 424242,
      startedAt: NOW,
    });
    createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
  } finally {
    process.umask(previous);
  }
  const markerPath = join(evidenceRoot, 'build-attempt.json');
  const stdoutPath = join(evidenceRoot, 'build-attempt-1.stdout.log');
  const stderrPath = join(evidenceRoot, 'build-attempt-1.stderr.log');
  assert.equal(statSync(markerPath).mode & 0o777, 0o600);
  assert.equal(statSync(stdoutPath).mode & 0o777, 0o600);
  assert.equal(statSync(stderrPath).mode & 0o777, 0o600);
  const marker = readAttemptMarker(evidenceRoot, 'build');
  assert.deepEqual(Object.keys(marker), [
    'schemaVersion', 'action', 'candidate', 'attemptNumber', 'runnerPid', 'state',
    'providerOperationId', 'startedAt', 'terminalAt', 'outcome', 'rawEvidenceSha256',
    'reconciliationEvidenceSha256', 'retryReviewSha256',
  ]);
  assert.deepEqual(marker.candidate, {
    bundleIdentifier: 'com.cabohealth.app', marketingVersion: '3.0',
    buildNumber: '9', sourceCommit: SOURCE_COMMIT,
  });
  assert.equal(marker.state, 'armed');
  assert.notEqual(rawEvidenceSha256(Buffer.from('ab'), Buffer.from('c')),
    rawEvidenceSha256(Buffer.from('a'), Buffer.from('bc')));
});

test('marker validation rejects every field type, nullability, key-order, and state pairing drift', async (t) => {
  const { armAttempt, readAttemptMarker } = await import('../scripts/release-attempt-runner.mjs');
  const mutations = [
    ['schema type', (marker) => { marker.schemaVersion = '1'; }],
    ['action', (marker) => { marker.action = 'submit'; }],
    ['candidate key order', (marker) => { marker.candidate = { ...marker.candidate, extra: false }; }],
    ['candidate build', (marker) => { marker.candidate.buildNumber = '8'; }],
    ['attempt number', (marker) => { marker.attemptNumber = 3; }],
    ['runner PID type', (marker) => { marker.runnerPid = '42'; }],
    ['runner PID range', (marker) => { marker.runnerPid = 0; }],
    ['state', (marker) => { marker.state = 'running'; }],
    ['armed provider ID', (marker) => { marker.providerOperationId = BUILD_ID; }],
    ['started timestamp', (marker) => { marker.startedAt = '2026-08-30T12:00:00Z'; }],
    ['armed terminal timestamp', (marker) => { marker.terminalAt = NOW; }],
    ['state outcome', (marker) => { marker.outcome = 'unknown'; }],
    ['armed raw digest', (marker) => { marker.rawEvidenceSha256 = 'a'.repeat(64); }],
    ['armed reconciliation digest', (marker) => { marker.reconciliationEvidenceSha256 = 'b'.repeat(64); }],
    ['attempt-one review digest', (marker) => { marker.retryReviewSha256 = 'c'.repeat(64); }],
    ['top-level extra key', (marker) => { marker.extra = null; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const evidenceRoot = root(t);
      const marker = armAttempt({
        evidenceRoot,
        action: 'build',
        sourceCommit: SOURCE_COMMIT,
        runnerPid: 424242,
        startedAt: NOW,
      });
      const malformed = structuredClone(marker);
      mutate(malformed);
      const markerPath = join(evidenceRoot, 'build-attempt.json');
      writeFileSync(markerPath, `${JSON.stringify(malformed)}\n`);
      chmodSync(markerPath, 0o600);
      assert.throws(() => readAttemptMarker(evidenceRoot, 'build'), /RELEASE_ATTEMPT_MARKER_INVALID/u);
    });
  }
});

test('guard handoff, unique provider ID parsing, and terminal completion are fail closed', async (t) => {
  const {
    armAttempt,
    createAttemptLogs,
    markProviderStarted,
    finalizeObservedAttempt,
    readAttemptMarker,
  } = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  armAttempt({ evidenceRoot, action: 'build', sourceCommit: SOURCE_COMMIT, runnerPid: 123, startedAt: NOW });
  createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
  markProviderStarted(join(evidenceRoot, 'build-attempt.json'), {
    action: 'build', sourceCommit: SOURCE_COMMIT,
  });
  writeFileSync(
    join(evidenceRoot, 'build-attempt-1.stdout.log'),
    `Build details: https://expo.dev/accounts/guaderrama/projects/cabohealth/builds/${BUILD_ID}\n`,
  );
  finalizeObservedAttempt({
    evidenceRoot, action: 'build', exitStatus: 0,
    terminalAt: '2026-08-30T12:10:00.000Z',
  });
  const marker = readAttemptMarker(evidenceRoot, 'build');
  assert.equal(marker.state, 'terminal_success');
  assert.equal(marker.providerOperationId, BUILD_ID);
  assert.equal(marker.outcome, 'succeeded');
  assert.match(marker.rawEvidenceSha256, /^[a-f0-9]{64}$/u);
});

test('provider ID parsing rejects missing, ambiguous, and wrong-action URLs while retaining one exact ID', async (t) => {
  const {
    armAttempt,
    createAttemptLogs,
    finalizeObservedAttempt,
    markProviderStarted,
    readAttemptMarker,
  } = await import('../scripts/release-attempt-runner.mjs');
  const cases = [
    ['missing', 'build', '', '', null, 'unknown'],
    [
      'ambiguous',
      'build',
      `https://expo.dev/builds/${BUILD_ID}\n`,
      'https://expo.dev/builds/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n',
      null,
      'unknown',
    ],
    [
      'wrong action suffix',
      'build',
      `https://expo.dev/submissions/${SUBMISSION_ID}\n`,
      '',
      null,
      'unknown',
    ],
    [
      'repeated exact ID',
      'build',
      `https://expo.dev/builds/${BUILD_ID}\n`,
      `https://expo.dev/builds/${BUILD_ID}\n`,
      BUILD_ID,
      'terminal_success',
    ],
    [
      'upload submission ID',
      'upload-testflight',
      `https://expo.dev/submissions/${SUBMISSION_ID}\n`,
      '',
      SUBMISSION_ID,
      'terminal_success',
    ],
  ];
  for (const [name, action, stdout, stderr, expectedId, expectedState] of cases) {
    await t.test(name, () => {
      const evidenceRoot = root(t);
      armAttempt({
        evidenceRoot,
        action,
        sourceCommit: SOURCE_COMMIT,
        runnerPid: 121212,
        startedAt: NOW,
      });
      createAttemptLogs({ evidenceRoot, action, attemptNumber: 1 });
      markProviderStarted(join(evidenceRoot, `${action}-attempt.json`), {
        action,
        sourceCommit: SOURCE_COMMIT,
      });
      writeFileSync(join(evidenceRoot, `${action}-attempt-1.stdout.log`), stdout);
      writeFileSync(join(evidenceRoot, `${action}-attempt-1.stderr.log`), stderr);
      finalizeObservedAttempt({
        evidenceRoot,
        action,
        exitStatus: 0,
        terminalAt: '2026-08-30T12:10:00.000Z',
      });
      const marker = readAttemptMarker(evidenceRoot, action);
      assert.equal(marker.providerOperationId, expectedId);
      assert.equal(marker.state, expectedState);
      assert.match(marker.rawEvidenceSha256, /^[a-f0-9]{64}$/u);
    });
  }
});

test('stale armed recovery requires ESRCH, creates missing empty logs, and authorizes only one reviewed retry', async (t) => {
  const {
    armAttempt,
    recoverArmedAttempt,
    retryAttempt,
    readAttemptMarker,
  } = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  armAttempt({ evidenceRoot, action: 'upload-testflight', sourceCommit: SOURCE_COMMIT, runnerPid: 555555, startedAt: NOW });
  recoverArmedAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    expectedRunnerPid: 555555,
    terminalAt: '2026-08-30T12:01:00.000Z',
    kill: () => { const error = new Error('missing'); error.code = 'ESRCH'; throw error; },
  });
  let marker = readAttemptMarker(evidenceRoot, 'upload-testflight');
  assert.equal(marker.state, 'preprovider_failed');
  assert.equal(marker.outcome, 'preprovider-blocked');
  assert.equal(readFileSync(join(evidenceRoot, 'upload-testflight-attempt-1.stdout.log')).length, 0);
  assert.equal(readFileSync(join(evidenceRoot, 'upload-testflight-attempt-1.stderr.log')).length, 0);

  retryAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    reviewSha256: 'b'.repeat(64),
    runnerPid: 666666,
    startedAt: '2026-08-30T12:02:00.000Z',
  });
  marker = readAttemptMarker(evidenceRoot, 'upload-testflight');
  assert.equal(marker.attemptNumber, 2);
  assert.equal(marker.state, 'armed');
  assert.equal(marker.retryReviewSha256, 'b'.repeat(64));
  assert.throws(() => retryAttempt({
    evidenceRoot, action: 'upload-testflight', reviewSha256: 'c'.repeat(64),
    runnerPid: 777777, startedAt: NOW,
  }), /RELEASE_ATTEMPT_RETRY_NOT_AUTHORIZED/u);
});

test('crash-after-log recovery preserves both logs and hashes their exact length-delimited bytes', async (t) => {
  const {
    armAttempt,
    createAttemptLogs,
    rawEvidenceSha256,
    readAttemptMarker,
    recoverArmedAttempt,
  } = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  armAttempt({
    evidenceRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 888888,
    startedAt: NOW,
  });
  createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
  const stdoutBytes = Buffer.from('local pre-provider stdout\n');
  const stderrBytes = Buffer.from('local pre-provider stderr\n');
  writeFileSync(join(evidenceRoot, 'build-attempt-1.stdout.log'), stdoutBytes);
  writeFileSync(join(evidenceRoot, 'build-attempt-1.stderr.log'), stderrBytes);

  recoverArmedAttempt({
    evidenceRoot,
    action: 'build',
    expectedRunnerPid: 888888,
    terminalAt: '2026-08-30T12:01:00.000Z',
    kill: () => { const error = new Error('missing'); error.code = 'ESRCH'; throw error; },
  });
  const marker = readAttemptMarker(evidenceRoot, 'build');
  assert.equal(marker.state, 'preprovider_failed');
  assert.equal(marker.rawEvidenceSha256, rawEvidenceSha256(stdoutBytes, stderrBytes));
  assert.deepEqual(readFileSync(join(evidenceRoot, 'build-attempt-1.stdout.log')), stdoutBytes);
  assert.deepEqual(readFileSync(join(evidenceRoot, 'build-attempt-1.stderr.log')), stderrBytes);
});

test('recover-armed refuses live, EPERM, and indeterminate PIDs without creating logs', async (t) => {
  const {
    armAttempt,
    readAttemptMarker,
    recoverArmedAttempt,
  } = await import('../scripts/release-attempt-runner.mjs');
  const cases = [
    ['live PID', () => {}],
    ['EPERM PID', () => { const error = new Error('not permitted'); error.code = 'EPERM'; throw error; }],
    ['indeterminate PID', () => { const error = new Error('indeterminate'); error.code = 'EIO'; throw error; }],
  ];
  for (const [name, kill] of cases) {
    await t.test(name, () => {
      const evidenceRoot = root(t);
      armAttempt({
        evidenceRoot,
        action: 'upload-testflight',
        sourceCommit: SOURCE_COMMIT,
        runnerPid: 999999,
        startedAt: NOW,
      });
      assert.throws(() => recoverArmedAttempt({
        evidenceRoot,
        action: 'upload-testflight',
        expectedRunnerPid: 999999,
        terminalAt: '2026-08-30T12:01:00.000Z',
        kill,
      }), /RELEASE_ATTEMPT_ARMED_RECOVERY_INVALID/u);
      assert.equal(readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'armed');
      assert.throws(
        () => statSync(join(evidenceRoot, 'upload-testflight-attempt-1.stdout.log')),
        { code: 'ENOENT' },
      );
      assert.throws(
        () => statSync(join(evidenceRoot, 'upload-testflight-attempt-1.stderr.log')),
        { code: 'ENOENT' },
      );
    });
  }
});

test('read-only reconciliation binds canonical evidence and preserves the raw digest', async (t) => {
  const {
    armAttempt,
    createAttemptLogs,
    markProviderStarted,
    finalizeObservedAttempt,
    reconcileAttempt,
    readAttemptMarker,
  } = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  armAttempt({ evidenceRoot, action: 'build', sourceCommit: SOURCE_COMMIT, runnerPid: 123, startedAt: NOW });
  createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
  markProviderStarted(join(evidenceRoot, 'build-attempt.json'), { action: 'build', sourceCommit: SOURCE_COMMIT });
  writeFileSync(join(evidenceRoot, 'build-attempt-1.stderr.log'),
    `https://expo.dev/accounts/a/projects/b/builds/${BUILD_ID}\n`);
  finalizeObservedAttempt({ evidenceRoot, action: 'build', exitStatus: 1 });
  const before = readAttemptMarker(evidenceRoot, 'build');
  assert.equal(before.state, 'unknown');
  const evidence = {
    schemaVersion: 1,
    evidenceKind: 'cabohealth-eas-build-read-only-status',
    easBuildId: BUILD_ID,
    status: 'ERRORED',
    terminal: true,
    platform: 'IOS',
    distribution: 'STORE',
    account: 'guaderrama',
    projectSlug: 'cabohealth',
    buildProfile: 'production',
    bundleIdentifier: 'com.cabohealth.app',
    marketingVersion: '3.0',
    buildNumber: '9',
    artifactAvailable: false,
    createdAt: '2026-08-30T11:00:00.000Z',
    completedAt: '2026-08-30T11:10:00.000Z',
    errorPresent: true,
    errorCode: 'EAS_BUILD_FAILED',
    mutationPerformed: false,
    rawProviderResponseRetained: false,
    providerUrlsOmitted: true,
    providerFieldsOmitted: true,
    credentialFieldsOmitted: true,
  };
  const evidencePath = join(evidenceRoot, 'build-reconciliation.json');
  const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
  writeFileSync(evidencePath, bytes, { mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  reconcileAttempt({
    evidenceRoot, action: 'build', providerOperationId: BUILD_ID,
    terminalStatus: 'ERRORED', evidencePath, evidenceSha256: hash(bytes),
    terminalAt: '2026-08-30T12:20:00.000Z',
  });
  const after = readAttemptMarker(evidenceRoot, 'build');
  assert.equal(after.state, 'terminal_failure');
  assert.equal(after.outcome, 'failed');
  assert.equal(after.rawEvidenceSha256, before.rawEvidenceSha256);
  assert.equal(after.reconciliationEvidenceSha256, hash(bytes));
});

test('provider-started crash reconciliation preserves a null raw digest and rejects forged sanitizer fields', async (t) => {
  const {
    armAttempt,
    createAttemptLogs,
    finalizeObservedAttempt,
    markProviderStarted,
    readAttemptMarker,
    reconcileAttempt,
  } = await import('../scripts/release-attempt-runner.mjs');

  const exactEvidence = (overrides = {}) => ({
    schemaVersion: 1,
    evidenceKind: 'cabohealth-eas-build-read-only-status',
    easBuildId: BUILD_ID,
    status: 'FINISHED',
    terminal: true,
    platform: 'IOS',
    distribution: 'STORE',
    account: 'guaderrama',
    projectSlug: 'cabohealth',
    buildProfile: 'production',
    bundleIdentifier: 'com.cabohealth.app',
    marketingVersion: '3.0',
    buildNumber: '9',
    artifactAvailable: true,
    createdAt: '2026-08-30T11:00:00.000Z',
    completedAt: '2026-08-30T11:10:00.000Z',
    errorPresent: false,
    errorCode: null,
    mutationPerformed: false,
    rawProviderResponseRetained: false,
    providerUrlsOmitted: true,
    providerFieldsOmitted: true,
    credentialFieldsOmitted: true,
    ...overrides,
  });

  const crashedRoot = root(t);
  armAttempt({
    evidenceRoot: crashedRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 123,
    startedAt: NOW,
  });
  createAttemptLogs({ evidenceRoot: crashedRoot, action: 'build', attemptNumber: 1 });
  markProviderStarted(join(crashedRoot, 'build-attempt.json'), {
    action: 'build', sourceCommit: SOURCE_COMMIT,
  });
  const evidencePath = join(crashedRoot, 'build-reconciliation.json');
  const evidenceBytes = Buffer.from(`${JSON.stringify(exactEvidence())}\n`);
  writeFileSync(evidencePath, evidenceBytes, { mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  reconcileAttempt({
    evidenceRoot: crashedRoot,
    action: 'build',
    providerOperationId: BUILD_ID,
    terminalStatus: 'FINISHED',
    evidencePath,
    evidenceSha256: hash(evidenceBytes),
    terminalAt: '2026-08-30T12:20:00.000Z',
  });
  const recovered = readAttemptMarker(crashedRoot, 'build');
  assert.equal(recovered.state, 'terminal_success');
  assert.equal(recovered.rawEvidenceSha256, null);
  assert.equal(recovered.reconciliationEvidenceSha256, hash(evidenceBytes));

  const forgedRoot = root(t);
  armAttempt({
    evidenceRoot: forgedRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 124,
    startedAt: NOW,
  });
  createAttemptLogs({ evidenceRoot: forgedRoot, action: 'build', attemptNumber: 1 });
  markProviderStarted(join(forgedRoot, 'build-attempt.json'), {
    action: 'build', sourceCommit: SOURCE_COMMIT,
  });
  writeFileSync(
    join(forgedRoot, 'build-attempt-1.stderr.log'),
    `https://expo.dev/accounts/guaderrama/projects/cabohealth/builds/${BUILD_ID}\n`,
  );
  finalizeObservedAttempt({ evidenceRoot: forgedRoot, action: 'build', exitStatus: 1 });
  const forgedPath = join(forgedRoot, 'build-reconciliation.json');
  const forgedBytes = Buffer.from(`${JSON.stringify(exactEvidence({ account: 'other' }))}\n`);
  writeFileSync(forgedPath, forgedBytes, { mode: 0o600 });
  chmodSync(forgedPath, 0o600);
  assert.throws(() => reconcileAttempt({
    evidenceRoot: forgedRoot,
    action: 'build',
    providerOperationId: BUILD_ID,
    terminalStatus: 'FINISHED',
    evidencePath: forgedPath,
    evidenceSha256: hash(forgedBytes),
    terminalAt: '2026-08-30T12:20:00.000Z',
  }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
});
