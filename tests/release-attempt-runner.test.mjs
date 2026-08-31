import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fstatSync,
  fsyncSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeSync,
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

function submissionReconciliationEvidence(appOverrides = {}, overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceKind: 'cabohealth-eas-submission-read-only-status',
    submissionId: SUBMISSION_ID,
    status: 'FINISHED',
    terminal: true,
    platform: 'IOS',
    createdAt: '2026-08-30T11:00:00.000Z',
    completedAt: '2026-08-30T11:10:00.000Z',
    errorPresent: false,
    errorCode: null,
    app: {
      appleId: '6758285327',
      account: 'guaderrama',
      projectSlug: 'cabohealth',
      submittedBuildIdentityAvailable: false,
      bundleIdentifier: null,
      marketingVersion: null,
      buildNumber: null,
      easBuildId: null,
      ...appOverrides,
    },
    appleProcessingStatus: 'not-proven-by-eas-submission',
    appleProcessingPendingReadOnlyVerification: true,
    appStoreConnectBuildSelectionPerformed: false,
    mutationPerformed: false,
    rawProviderResponseRetained: false,
    providerUrlsOmitted: true,
    providerFieldsOmitted: true,
    credentialFieldsOmitted: true,
    ...overrides,
  };
}

function currentLocalIpaAuthority(t, mutate = () => {}, pinOverrides = {}) {
  const project = root(t);
  const input = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-attestation',
    candidate: {
      appleId: '6758285327', bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0', buildNumber: '9',
    },
    sourceCommit: SOURCE_COMMIT,
    sourceTreeSha256: '1'.repeat(64),
    appJsonSha256: '2'.repeat(64),
    configSha256: '3'.repeat(64),
    packageLockSha256: '4'.repeat(64),
    releaseManifestSha256: '5'.repeat(64),
    releaseVerifierSha256: '6'.repeat(64),
    metadataVerifierSha256: '7'.repeat(64),
    firebaseProjectId: 'cabohealth-owner-prod',
    googleServicesPlistSha256: '8'.repeat(64),
    resolvedProductionExpoConfigSha256: '9'.repeat(64),
    nodeRuntime: { version: 'v22.22.3', executableSha256: 'a'.repeat(64) },
    easCli: {
      packageVersion: '22.2.0', packageJsonRelativePath: 'eas-cli/package.json',
      entryRelativePath: 'eas-cli/bin/run', runtimeRootRelativePath: 'node_modules',
      runtimeTreeSha256: 'b'.repeat(64),
    },
    easEnvironmentInventorySha256: 'c'.repeat(64),
    easEnvironment: {},
    reviewedAt: '2026-08-30T10:00:00.000Z',
  };
  const ipaBytes = Buffer.from('exact canonical local IPA authority\n');
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-artifact-attestation',
    candidate: structuredClone(input.candidate),
    buildInputAttestationSha256: null,
    sourceTreeSha256: input.sourceTreeSha256,
    easBuildId: BUILD_ID,
    easArtifactAssociation: {
      evidenceType: 'independently-reviewed-procedural',
      buildId: BUILD_ID,
      buildStatus: 'FINISHED',
      downloadedIpaSha256: hash(ipaBytes),
      associationGuardProven: false,
      reviewedAt: '2026-08-30T10:30:00.000Z',
    },
    ipaSha256: hash(ipaBytes),
    signedEntitlementsSha256: 'd'.repeat(64),
    privacyReportSha256: 'e'.repeat(64),
    embeddedGoogleServicesPlistSha256: 'f'.repeat(64),
    signingCertificateSha256: '0'.repeat(64),
    embeddedProvisioningProfileSha256: '1'.repeat(64),
    reviewedAt: '2026-08-30T11:00:00.000Z',
  };
  mutate({ input, artifact });
  const releaseRoot = join(project, 'release/app-store/3.0');
  const privateRoot = join(project, 'release/private/rc-build-9');
  const scriptsRoot = join(project, 'scripts');
  mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  mkdirSync(scriptsRoot, { recursive: true, mode: 0o700 });
  const inputBytes = Buffer.from(`${JSON.stringify(input)}\n`);
  const inputSha256 = hash(inputBytes);
  if (artifact.buildInputAttestationSha256 === null) {
    artifact.buildInputAttestationSha256 = inputSha256;
  }
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  const artifactSha256 = hash(artifactBytes);
  writeFileSync(join(releaseRoot, 'build-input-attestation.json'), inputBytes, { mode: 0o600 });
  writeFileSync(join(releaseRoot, 'build-artifact-attestation.json'), artifactBytes, { mode: 0o600 });
  const ipaPath = join(privateRoot, 'CaboHealth-3.0-build-9.ipa');
  writeFileSync(ipaPath, pinOverrides.ipaBytes ?? ipaBytes, { mode: 0o600 });
  chmodSync(ipaPath, 0o600);
  writeFileSync(join(scriptsRoot, 'release-command-guard.mjs'), [
    `const BUILD_INPUT_ATTESTATION_SHA256 = '${pinOverrides.inputSha256 ?? inputSha256}';`,
    `const BUILD_ARTIFACT_ATTESTATION_SHA256 = '${pinOverrides.artifactSha256 ?? artifactSha256}';`,
    '',
  ].join('\n'));
  return project;
}

function prepareUnknownUploadAttempt(module, evidenceRoot) {
  module.armAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 515151,
    startedAt: NOW,
  });
  module.createAttemptLogs({ evidenceRoot, action: 'upload-testflight', attemptNumber: 1 });
  module.markProviderStarted(join(evidenceRoot, 'upload-testflight-attempt.json'), {
    action: 'upload-testflight', sourceCommit: SOURCE_COMMIT,
  });
  writeFileSync(join(evidenceRoot, 'upload-testflight-attempt-1.stdout.log'),
    `https://expo.dev/accounts/guaderrama/projects/cabohealth/submissions/${SUBMISSION_ID}\n`);
  module.finalizeObservedAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    exitStatus: 1,
    terminalAt: '2026-08-30T12:05:00.000Z',
  });
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

test('guard completion fsyncs and revalidates both open logs before close, hashing, and success', async (t) => {
  const {
    armAttempt,
    createAttemptLogs,
    markProviderStarted,
    readAttemptMarker,
    runGuard,
  } = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  armAttempt({
    evidenceRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 313131,
    startedAt: NOW,
  });
  createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
  const events = [];
  let stdoutDescriptor;
  let stderrDescriptor;
  const label = (descriptor) => (descriptor === stdoutDescriptor ? 'stdout' : 'stderr');
  const child = (_executable, _args, options) => {
    stdoutDescriptor = options.stdio[1];
    stderrDescriptor = options.stdio[2];
    markProviderStarted(join(evidenceRoot, 'build-attempt.json'), {
      action: 'build', sourceCommit: SOURCE_COMMIT,
    });
    writeSync(stdoutDescriptor,
      `https://expo.dev/accounts/guaderrama/projects/cabohealth/builds/${BUILD_ID}\n`);
    writeSync(stderrDescriptor, 'sanitized child diagnostic\n');
    events.push('child-complete');
    return { status: 0 };
  };
  runGuard(projectRoot, evidenceRoot, 'build', 1, {
    spawn: child,
    fsync: (descriptor) => {
      events.push(`fsync:${label(descriptor)}`);
      fsyncSync(descriptor);
    },
    fstat: (descriptor) => {
      events.push(`fstat:${label(descriptor)}`);
      return fstatSync(descriptor);
    },
    close: (descriptor) => {
      events.push(`close:${label(descriptor)}`);
      closeSync(descriptor);
    },
  });
  assert.deepEqual(events, [
    'child-complete',
    'fsync:stdout', 'fstat:stdout',
    'fsync:stderr', 'fstat:stderr',
    'close:stdout', 'close:stderr',
  ]);
  const marker = readAttemptMarker(evidenceRoot, 'build');
  assert.equal(marker.state, 'terminal_success');
  assert.equal(marker.outcome, 'succeeded');
  assert.match(marker.rawEvidenceSha256, /^[a-f0-9]{64}$/u);
});

test('log fsync or descriptor revalidation failure cannot produce a terminal marker', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  for (const failureKind of ['fsync', 'revalidation']) {
    await t.test(failureKind, () => {
      const evidenceRoot = root(t);
      module.armAttempt({
        evidenceRoot,
        action: 'build',
        sourceCommit: SOURCE_COMMIT,
        runnerPid: 414141,
        startedAt: NOW,
      });
      module.createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
      let stdoutDescriptor;
      const child = (_executable, _args, options) => {
        stdoutDescriptor = options.stdio[1];
        module.markProviderStarted(join(evidenceRoot, 'build-attempt.json'), {
          action: 'build', sourceCommit: SOURCE_COMMIT,
        });
        writeSync(stdoutDescriptor,
          `https://expo.dev/accounts/guaderrama/projects/cabohealth/builds/${BUILD_ID}\n`);
        return { status: 0 };
      };
      assert.throws(() => module.runGuard(projectRoot, evidenceRoot, 'build', 1, {
        spawn: child,
        fsync: (descriptor) => {
          if (failureKind === 'fsync' && descriptor === stdoutDescriptor) throw new Error('fsync failed');
          fsyncSync(descriptor);
        },
        fstat: (descriptor) => {
          const stat = fstatSync(descriptor);
          return failureKind === 'revalidation' && descriptor === stdoutDescriptor
            ? { ...stat, isFile: () => true, nlink: 2 } : stat;
        },
        close: closeSync,
      }), failureKind === 'fsync' ? /fsync failed/u : /RELEASE_ATTEMPT_MARKER_INVALID/u);
      const marker = module.readAttemptMarker(evidenceRoot, 'build');
      assert.equal(marker.state, 'provider_started');
      assert.equal(marker.terminalAt, null);
      assert.equal(marker.rawEvidenceSha256, null);
    });
  }
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

test('local-IPA submission reconciliation accepts provider submittedBuild null only with exact current authority', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  prepareUnknownUploadAttempt(module, evidenceRoot);
  const projectRoot = currentLocalIpaAuthority(t);
  const evidence = submissionReconciliationEvidence();
  const evidencePath = join(evidenceRoot, 'upload-testflight-reconciliation.json');
  const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
  writeFileSync(evidencePath, bytes, { mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  module.reconcileAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    providerOperationId: SUBMISSION_ID,
    terminalStatus: 'FINISHED',
    evidencePath,
    evidenceSha256: hash(bytes),
    terminalAt: '2026-08-30T12:20:00.000Z',
    projectRoot,
  });
  const marker = module.readAttemptMarker(evidenceRoot, 'upload-testflight');
  assert.equal(marker.state, 'terminal_success');
  assert.equal(marker.providerOperationId, SUBMISSION_ID);
  assert.equal(marker.reconciliationEvidenceSha256, hash(bytes));
});

test('null submittedBuild reconciliation rejects wrong current IPA/build authority', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const cases = [
    ['wrong artifact pin', () => {}, { artifactSha256: 'f'.repeat(64) }],
    ['wrong input pin', () => {}, { inputSha256: 'e'.repeat(64) }],
    ['wrong candidate', ({ artifact }) => { artifact.candidate.buildNumber = '8'; }, {}],
    ['wrong marker source commit', ({ input }) => { input.sourceCommit = 'f'.repeat(40); }, {}],
    ['wrong source digest linkage', ({ artifact }) => { artifact.sourceTreeSha256 = 'f'.repeat(64); }, {}],
    ['wrong input linkage', ({ artifact }) => { artifact.buildInputAttestationSha256 = 'f'.repeat(64); }, {}],
    ['wrong EAS build linkage', ({ artifact }) => { artifact.easArtifactAssociation.buildId = SUBMISSION_ID; }, {}],
    ['wrong local IPA bytes', () => {}, { ipaBytes: Buffer.from('different IPA') }],
  ];
  for (const [name, mutate, pinOverrides] of cases) {
    await t.test(name, () => {
      const evidenceRoot = root(t);
      prepareUnknownUploadAttempt(module, evidenceRoot);
      const projectRoot = currentLocalIpaAuthority(t, mutate, pinOverrides);
      const evidencePath = join(evidenceRoot, 'upload-testflight-reconciliation.json');
      const bytes = Buffer.from(`${JSON.stringify(submissionReconciliationEvidence())}\n`);
      writeFileSync(evidencePath, bytes, { mode: 0o600 });
      chmodSync(evidencePath, 0o600);
      assert.throws(() => module.reconcileAttempt({
        evidenceRoot,
        action: 'upload-testflight',
        providerOperationId: SUBMISSION_ID,
        terminalStatus: 'FINISHED',
        evidencePath,
        evidenceSha256: hash(bytes),
        terminalAt: '2026-08-30T12:20:00.000Z',
        projectRoot,
      }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
      assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'unknown');
    });
  }
});

test('submission reconciliation enforces consistent null and present identity fields', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const projectRoot = currentLocalIpaAuthority(t);
  const cases = [
    ['false with bundle', { bundleIdentifier: 'com.cabohealth.app' }],
    ['false with EAS build', { easBuildId: BUILD_ID }],
    ['true with null build number', {
      submittedBuildIdentityAvailable: true,
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: null,
      easBuildId: BUILD_ID,
    }],
    ['true with wrong EAS build', {
      submittedBuildIdentityAvailable: true,
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '9',
      easBuildId: SUBMISSION_ID,
    }],
  ];
  for (const [name, appOverrides] of cases) {
    await t.test(name, () => {
      const evidenceRoot = root(t);
      prepareUnknownUploadAttempt(module, evidenceRoot);
      const evidencePath = join(evidenceRoot, 'upload-testflight-reconciliation.json');
      const bytes = Buffer.from(`${JSON.stringify(submissionReconciliationEvidence(appOverrides))}\n`);
      writeFileSync(evidencePath, bytes, { mode: 0o600 });
      chmodSync(evidencePath, 0o600);
      assert.throws(() => module.reconcileAttempt({
        evidenceRoot,
        action: 'upload-testflight',
        providerOperationId: SUBMISSION_ID,
        terminalStatus: 'FINISHED',
        evidencePath,
        evidenceSha256: hash(bytes),
        terminalAt: '2026-08-30T12:20:00.000Z',
        projectRoot,
      }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
    });
  }
});

test('provider-present submission identity retains exact candidate and EAS build matching', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  const projectRoot = currentLocalIpaAuthority(t);
  prepareUnknownUploadAttempt(module, evidenceRoot);
  const evidence = submissionReconciliationEvidence({
    submittedBuildIdentityAvailable: true,
    bundleIdentifier: 'com.cabohealth.app',
    marketingVersion: '3.0',
    buildNumber: '9',
    easBuildId: BUILD_ID,
  });
  const evidencePath = join(evidenceRoot, 'upload-testflight-reconciliation.json');
  const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
  writeFileSync(evidencePath, bytes, { mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  module.reconcileAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    providerOperationId: SUBMISSION_ID,
    terminalStatus: 'FINISHED',
    evidencePath,
    evidenceSha256: hash(bytes),
    terminalAt: '2026-08-30T12:20:00.000Z',
    projectRoot,
  });
  assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'terminal_success');
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
