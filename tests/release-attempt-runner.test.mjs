import assert from 'node:assert/strict';
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

const SOURCE_COMMIT = 'a'.repeat(40);
const BUILD_ID = '12345678-1234-4234-8234-123456789abc';
const SUBMISSION_ID = '87654321-4321-4234-8234-cba987654321';
const NOW = '2026-08-30T12:00:00.000Z';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function root(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-attempt-root-')));
  chmodSync(path, 0o700);
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
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
