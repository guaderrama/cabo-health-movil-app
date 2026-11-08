import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
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
const OTHER_SUBMISSION_ID = '11111111-2222-4333-8444-555555555555';
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

function buildReconciliationEvidence(overrides = {}) {
  return {
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
    buildNumber: '15',
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
  };
}

function git(project, args) {
  const result = spawnSync('git', args, {
    cwd: project,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function authorityGuard({
  inputSha256 = null,
  artifactSha256 = null,
  rcSha256 = null,
  easCliPin = null,
  submitAdapterPin = null,
} = {}) {
  const literal = (value) => value === null ? 'null' : `'${value}'`;
  return [
    `const BUILD_INPUT_ATTESTATION_SHA256 = ${literal(inputSha256)};`,
    `const BUILD_ARTIFACT_ATTESTATION_SHA256 = ${literal(artifactSha256)};`,
    `const RC_ATTESTATION_SHA256 = ${literal(rcSha256)};`,
    `const PINNED_EAS_CLI = ${literal(easCliPin)};`,
    `const PINNED_APP_STORE_SUBMIT_ADAPTER = ${literal(submitAdapterPin)};`,
    '',
  ].join('\n');
}

function commitAll(project, message) {
  git(project, ['add', '--all']);
  git(project, ['commit', '--quiet', '-m', message]);
}

function withProcessEnvironment(overrides, callback) {
  const previous = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, Object.hasOwn(process.env, name) ? process.env[name] : undefined);
    process.env[name] = value;
  }
  try {
    return callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function fakeGitPath(t, { delegate }) {
  const directory = root(t);
  const sentinel = join(directory, 'fake-git-invoked');
  const executable = join(directory, 'git');
  writeFileSync(executable, [
    '#!/bin/sh',
    `: > "${sentinel}"`,
    delegate ? 'exec /usr/bin/git "$@"' : 'exit 97',
    '',
  ].join('\n'), { mode: 0o755 });
  chmodSync(executable, 0o755);
  return { directory, sentinel };
}

function copyAuthorityWorkingFiles(source, destination) {
  for (const relativePath of [
    'scripts/release-command-guard.mjs',
    'release/app-store/3.0/build-input-attestation.json',
    'release/app-store/3.0/build-artifact-attestation.json',
    'release/private/rc-build-15/CaboHealth-3.0-build-15.ipa',
  ]) {
    writeFileSync(
      join(destination.projectRoot, relativePath),
      readFileSync(join(source.projectRoot, relativePath)),
    );
  }
  chmodSync(
    join(destination.projectRoot, 'release/private/rc-build-15/CaboHealth-3.0-build-15.ipa'),
    0o600,
  );
}

async function currentLocalIpaAuthority(t, {
  sourceTreeSha256,
  combinedHistory = false,
  laterPhase = null,
  trackedSource = 'frozen build 15 source\n',
  artifactAssociationReviewedAt = '2026-08-30T10:30:00.000Z',
  artifactReviewedAt = '2026-08-30T11:00:00.000Z',
} = {}) {
  const project = root(t);
  git(project, ['init', '--quiet']);
  git(project, ['config', 'user.name', 'CaboHealth Test']);
  git(project, ['config', 'user.email', 'cabohealth-test@example.invalid']);
  mkdirSync(join(project, 'scripts'), { recursive: true });
  const releaseRoot = join(project, 'release/app-store/3.0');
  mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(project, '.gitignore'), 'release/private/\n');
  writeFileSync(join(project, 'tracked-source.txt'), trackedSource);
  writeFileSync(join(project, 'scripts/release-command-guard.mjs'), authorityGuard());
  writeFileSync(join(releaseRoot, 'screenshots-manifest.json'), '{"status":"pending"}\n');
  writeFileSync(join(releaseRoot, 'app-privacy.json'), '{"status":"pending"}\n');
  writeFileSync(join(releaseRoot, 'review-notes.md'), 'Pending review notes.\n');
  commitAll(project, 'freeze build 15 source');
  const sourceCommit = git(project, ['rev-parse', 'HEAD']);
  const { computeTrackedSourceSha256 } = await import('../scripts/release-command-guard.mjs');
  const exactSourceTreeSha256 = computeTrackedSourceSha256(project);
  const input = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-attestation',
    candidate: {
      appleId: '6758285327', bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0', buildNumber: '15',
    },
    sourceCommit,
    sourceTreeSha256: sourceTreeSha256 ?? exactSourceTreeSha256,
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
      reviewedAt: artifactAssociationReviewedAt,
    },
    ipaSha256: hash(ipaBytes),
    signedEntitlementsSha256: 'd'.repeat(64),
    privacyReportSha256: 'e'.repeat(64),
    embeddedGoogleServicesPlistSha256: 'f'.repeat(64),
    signingCertificateSha256: '0'.repeat(64),
    embeddedProvisioningProfileSha256: '1'.repeat(64),
    reviewedAt: artifactReviewedAt,
  };
  const privateRoot = join(project, 'release/private/rc-build-15');
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const inputBytes = Buffer.from(`${JSON.stringify(input)}\n`);
  const inputSha256 = hash(inputBytes);
  if (artifact.buildInputAttestationSha256 === null) {
    artifact.buildInputAttestationSha256 = inputSha256;
  }
  writeFileSync(join(releaseRoot, 'build-input-attestation.json'), inputBytes, { mode: 0o600 });
  writeFileSync(join(project, 'scripts/release-command-guard.mjs'), authorityGuard({ inputSha256 }));
  if (!combinedHistory) commitAll(project, 'pin build 15 input authority');

  const artifactBytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  const artifactSha256 = hash(artifactBytes);
  writeFileSync(join(releaseRoot, 'build-artifact-attestation.json'), artifactBytes, { mode: 0o600 });
  const ipaPath = join(privateRoot, 'CaboHealth-3.0-build-15.ipa');
  writeFileSync(ipaPath, ipaBytes, { mode: 0o600 });
  chmodSync(ipaPath, 0o600);
  writeFileSync(join(project, 'scripts/release-command-guard.mjs'), authorityGuard({
    inputSha256,
    artifactSha256,
  }));
  commitAll(project, combinedHistory
    ? 'forged combined build authority' : 'pin build 15 artifact authority');
  let rcSha256 = null;
  let submitAdapterPin = null;
  if (['rc', 'submit-tool', 'gap-submit'].includes(laterPhase)) {
    writeFileSync(join(releaseRoot, 'screenshots-manifest.json'), '{"status":"final"}\n');
    commitAll(project, 'record screenshot evidence');
    writeFileSync(join(releaseRoot, 'app-privacy.json'), '{"status":"final"}\n');
    writeFileSync(join(releaseRoot, 'review-notes.md'), 'Final review notes.\n');
    commitAll(project, 'finalize App Store metadata');
  }
  if (laterPhase === 'rc' || laterPhase === 'submit-tool') {
    const rcBytes = Buffer.from('{"reviewed":"exact rc authority"}\n');
    rcSha256 = hash(rcBytes);
    writeFileSync(join(releaseRoot, 'rc-attestation.json'), rcBytes);
    writeFileSync(join(project, 'scripts/release-command-guard.mjs'), authorityGuard({
      inputSha256,
      artifactSha256,
      rcSha256,
    }));
    commitAll(project, 'pin build 15 rc authority');
  }
  if (laterPhase === 'submit-tool' || laterPhase === 'gap-submit') {
    submitAdapterPin = Buffer.from('{"entry":"reviewed-submit-adapter"}').toString('base64');
    writeFileSync(join(project, 'scripts/release-command-guard.mjs'), authorityGuard({
      inputSha256,
      artifactSha256,
      rcSha256,
      submitAdapterPin,
    }));
    commitAll(project, 'pin build 15 submit adapter authority');
  }
  return {
    projectRoot: project,
    sourceCommit,
    sourceTreeSha256: exactSourceTreeSha256,
    input,
    artifact,
    inputSha256,
    artifactSha256,
    rcSha256,
    submitAdapterPin,
    ipaBytes,
  };
}

function prepareUnknownUploadAttempt(module, evidenceRoot, {
  sourceCommit = SOURCE_COMMIT,
  providerId = SUBMISSION_ID,
} = {}) {
  module.armAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    sourceCommit,
    runnerPid: 515151,
    startedAt: NOW,
  });
  module.createAttemptLogs({ evidenceRoot, action: 'upload-testflight', attemptNumber: 1 });
  module.markProviderStarted(join(evidenceRoot, 'upload-testflight-attempt.json'), {
    action: 'upload-testflight', sourceCommit,
  });
  if (providerId !== null) {
    writeFileSync(join(evidenceRoot, 'upload-testflight-attempt-1.stdout.log'),
      `https://expo.dev/accounts/guaderrama/projects/cabohealth/submissions/${providerId}\n`);
  }
  module.finalizeObservedAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    exitStatus: 1,
    terminalAt: '2026-08-30T12:05:00.000Z',
  });
}

function prepareProviderStartedUploadAttempt(module, evidenceRoot, {
  sourceCommit,
  providerId = null,
}) {
  module.armAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    sourceCommit,
    runnerPid: 525252,
    startedAt: NOW,
  });
  module.createAttemptLogs({ evidenceRoot, action: 'upload-testflight', attemptNumber: 1 });
  module.markProviderStarted(join(evidenceRoot, 'upload-testflight-attempt.json'), {
    action: 'upload-testflight', sourceCommit,
  });
  if (providerId !== null) {
    writeFileSync(join(evidenceRoot, 'upload-testflight-attempt-1.stdout.log'),
      `https://expo.dev/accounts/guaderrama/projects/cabohealth/submissions/${providerId}\n`);
  }
}

function writeSubmissionReconciliation(evidenceRoot, {
  submissionId = SUBMISSION_ID,
  appOverrides = {},
} = {}) {
  const evidencePath = join(evidenceRoot, 'upload-testflight-reconciliation.json');
  const bytes = Buffer.from(`${JSON.stringify(submissionReconciliationEvidence(
    appOverrides,
    { submissionId },
  ))}\n`);
  writeFileSync(evidencePath, bytes, { mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  return { evidencePath, evidenceSha256: hash(bytes) };
}

function reconcileUpload(module, {
  evidenceRoot,
  projectRoot: authorityRoot,
  submissionId = SUBMISSION_ID,
  appOverrides = {},
}) {
  const evidence = writeSubmissionReconciliation(evidenceRoot, { submissionId, appOverrides });
  return module.reconcileAttempt({
    evidenceRoot,
    action: 'upload-testflight',
    providerOperationId: submissionId,
    terminalStatus: 'FINISHED',
    ...evidence,
    terminalAt: '2026-08-30T12:20:00.000Z',
    projectRoot: authorityRoot,
  });
}

function forgeWorkingAuthority(authority, options) {
  const combinedForgery = options === undefined;
  const {
    mutateInput = () => {},
    mutateArtifact = () => {},
    ipaBytes = combinedForgery
      ? Buffer.from('self-consistent forged working IPA\n')
      : authority.ipaBytes,
  } = options ?? {};
  const input = structuredClone(authority.input);
  if (combinedForgery) input.sourceTreeSha256 = 'f'.repeat(64);
  mutateInput(input);
  const inputBytes = Buffer.from(`${JSON.stringify(input)}\n`);
  const inputSha256 = hash(inputBytes);
  const artifact = structuredClone(authority.artifact);
  artifact.buildInputAttestationSha256 = inputSha256;
  artifact.sourceTreeSha256 = input.sourceTreeSha256;
  artifact.ipaSha256 = hash(ipaBytes);
  artifact.easArtifactAssociation.downloadedIpaSha256 = artifact.ipaSha256;
  if (combinedForgery) {
    artifact.easBuildId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    artifact.easArtifactAssociation.buildId = artifact.easBuildId;
  }
  mutateArtifact(artifact);
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  const artifactSha256 = hash(artifactBytes);
  writeFileSync(
    join(authority.projectRoot, 'release/app-store/3.0/build-input-attestation.json'),
    inputBytes,
  );
  writeFileSync(
    join(authority.projectRoot, 'release/app-store/3.0/build-artifact-attestation.json'),
    artifactBytes,
  );
  writeFileSync(
    join(authority.projectRoot, 'release/private/rc-build-15/CaboHealth-3.0-build-15.ipa'),
    ipaBytes,
  );
  writeFileSync(
    join(authority.projectRoot, 'scripts/release-command-guard.mjs'),
    authorityGuard({ inputSha256, artifactSha256 }),
  );
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

test('guard and runner CLI entry points retain finite errors under hostile Git environment', (t) => {
  const fake = fakeGitPath(t, { delegate: false });
  const hostileEnvironment = {
    ...process.env,
    PATH: `${fake.directory}:/usr/bin:/bin`,
    GIT_DIR: join(fake.directory, 'forged-repository'),
    GIT_WORK_TREE: fake.directory,
    GIT_INDEX_FILE: join(fake.directory, 'forged-index'),
    GIT_OBJECT_DIRECTORY: join(fake.directory, 'forged-objects'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'alias.status',
    GIT_CONFIG_VALUE_0: '!/usr/bin/false',
    GIT_NO_REPLACE_OBJECTS: '0',
    GIT_EXEC_PATH: fake.directory,
    GIT_SSH_COMMAND: '/usr/bin/false',
  };
  for (const [script, argument, expected] of [
    ['release-command-guard.mjs', 'not-a-release-command', 'RELEASE_COMMAND_INVALID'],
    ['release-attempt-runner.mjs', 'not-a-runner-command', 'RELEASE_ATTEMPT_ARGUMENT_INVALID'],
  ]) {
    const result = spawnSync(process.execPath, [
      join(projectRoot, 'scripts', script),
      argument,
    ], {
      cwd: projectRoot,
      env: hostileEnvironment,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${expected}\n`);
  }
  assert.equal(existsSync(fake.sentinel), false);
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
    buildNumber: '15', sourceCommit: SOURCE_COMMIT,
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
  let effectiveUmask = 0o077;
  const label = (descriptor) => (descriptor === stdoutDescriptor ? 'stdout' : 'stderr');
  const child = (_executable, _args, options) => {
    assert.equal(effectiveUmask, 0o022);
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
      assert.equal(readAttemptMarker(evidenceRoot, 'build').state, 'terminal_success');
      events.push(`close:${label(descriptor)}`);
      closeSync(descriptor);
    },
    umask: (next) => {
      const previous = effectiveUmask;
      effectiveUmask = next;
      events.push(`umask:${next.toString(8)}`);
      return previous;
    },
  });
  assert.deepEqual(events, [
    'umask:22',
    'child-complete',
    'umask:77',
    'fsync:stdout', 'fstat:stdout', 'fstat:stdout',
    'fsync:stderr', 'fstat:stderr', 'fstat:stderr',
    'fstat:stdout', 'fstat:stderr',
    'close:stdout', 'close:stderr',
  ]);
  const marker = readAttemptMarker(evidenceRoot, 'build');
  assert.equal(marker.state, 'terminal_success');
  assert.equal(marker.outcome, 'succeeded');
  assert.match(marker.rawEvidenceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(effectiveUmask, 0o077);
});

test('mode-0600 pathname replacement cannot replace either exact fsynced log at publication', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  for (const replacedStream of ['stdout', 'stderr']) {
    await t.test(replacedStream, () => {
      const evidenceRoot = root(t);
      module.armAttempt({
        evidenceRoot,
        action: 'build',
        sourceCommit: SOURCE_COMMIT,
        runnerPid: 323232,
        startedAt: NOW,
      });
      module.createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
      let stdoutDescriptor;
      let stderrDescriptor;
      let replacementMade = false;
      const child = (_executable, _args, options) => {
        stdoutDescriptor = options.stdio[1];
        stderrDescriptor = options.stdio[2];
        module.markProviderStarted(join(evidenceRoot, 'build-attempt.json'), {
          action: 'build', sourceCommit: SOURCE_COMMIT,
        });
        writeSync(stdoutDescriptor, 'child stdout without an operation id\n');
        writeSync(stderrDescriptor, 'child stderr without an operation id\n');
        return { status: 0 };
      };
      assert.throws(() => module.runGuard(projectRoot, evidenceRoot, 'build', 1, {
        spawn: child,
        fsync: fsyncSync,
        fstat: (descriptor) => {
          const stat = fstatSync(descriptor);
          const selected = replacedStream === 'stdout' ? stdoutDescriptor : stderrDescriptor;
          if (descriptor === selected && !replacementMade) {
            replacementMade = true;
            const path = join(
              evidenceRoot,
              `build-attempt-1.${replacedStream}.log`,
            );
            renameSync(path, `${path}.original`);
            writeFileSync(
              path,
              `https://expo.dev/accounts/guaderrama/projects/cabohealth/builds/${BUILD_ID}\n`,
              { mode: 0o600 },
            );
            chmodSync(path, 0o600);
          }
          return stat;
        },
        close: closeSync,
      }), /RELEASE_ATTEMPT_MARKER_INVALID/u);
      const marker = module.readAttemptMarker(evidenceRoot, 'build');
      assert.equal(marker.state, 'provider_started');
      assert.equal(marker.rawEvidenceSha256, null);
      assert.equal(marker.providerOperationId, null);
    });
  }
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
    buildNumber: '15',
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

test('FINISHED build reconciliation requires an available artifact and no provider error', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  for (const [name, overrides] of [
    ['missing artifact', { artifactAvailable: false }],
    ['provider error', { errorPresent: true, errorCode: 'EAS_BUILD_FAILED' }],
  ]) {
    await t.test(name, () => {
      const evidenceRoot = root(t);
      module.armAttempt({
        evidenceRoot,
        action: 'build',
        sourceCommit: SOURCE_COMMIT,
        runnerPid: 616161,
        startedAt: NOW,
      });
      module.createAttemptLogs({ evidenceRoot, action: 'build', attemptNumber: 1 });
      module.markProviderStarted(join(evidenceRoot, 'build-attempt.json'), {
        action: 'build', sourceCommit: SOURCE_COMMIT,
      });
      writeFileSync(
        join(evidenceRoot, 'build-attempt-1.stdout.log'),
        `https://expo.dev/accounts/guaderrama/projects/cabohealth/builds/${BUILD_ID}\n`,
      );
      module.finalizeObservedAttempt({ evidenceRoot, action: 'build', exitStatus: 1 });
      const evidencePath = join(evidenceRoot, 'build-reconciliation.json');
      const bytes = Buffer.from(`${JSON.stringify(buildReconciliationEvidence(overrides))}\n`);
      writeFileSync(evidencePath, bytes, { mode: 0o600 });
      chmodSync(evidencePath, 0o600);
      assert.throws(() => module.reconcileAttempt({
        evidenceRoot,
        action: 'build',
        providerOperationId: BUILD_ID,
        terminalStatus: 'FINISHED',
        evidencePath,
        evidenceSha256: hash(bytes),
        terminalAt: '2026-08-30T12:20:00.000Z',
      }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
      assert.equal(module.readAttemptMarker(evidenceRoot, 'build').state, 'unknown');
    });
  }
});

test('local-IPA submission reconciliation accepts provider submittedBuild null only with exact current authority', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const authority = await currentLocalIpaAuthority(t);
  const evidenceRoot = root(t);
  prepareUnknownUploadAttempt(module, evidenceRoot, { sourceCommit: authority.sourceCommit });
  reconcileUpload(module, {
    evidenceRoot, projectRoot: authority.projectRoot,
  });
  const marker = module.readAttemptMarker(evidenceRoot, 'upload-testflight');
  assert.equal(marker.state, 'terminal_success');
  assert.equal(marker.providerOperationId, SUBMISSION_ID);
  assert.match(marker.reconciliationEvidenceSha256, /^[a-f0-9]{64}$/u);
});

test('local-IPA authority rejects artifact review chronology before terminal evidence or in the future', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const cases = [
    ['artifact before association', {
      artifactAssociationReviewedAt: '2026-08-30T11:00:00.000Z',
      artifactReviewedAt: '2026-08-30T10:59:59.999Z',
    }],
    ['future reviews', {
      artifactAssociationReviewedAt: '2999-08-30T11:00:00.000Z',
      artifactReviewedAt: '2999-08-30T11:01:00.000Z',
    }],
  ];
  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const authority = await currentLocalIpaAuthority(t, options);
      const evidenceRoot = root(t);
      prepareUnknownUploadAttempt(module, evidenceRoot, { sourceCommit: authority.sourceCommit });
      assert.throws(() => reconcileUpload(module, {
        evidenceRoot,
        projectRoot: authority.projectRoot,
      }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
      assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'unknown');
    });
  }
});

test('local-IPA reconciliation accepts exact later RC and submit-tool phase histories', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  for (const laterPhase of ['rc', 'submit-tool']) {
    await t.test(laterPhase, async () => {
      const authority = await currentLocalIpaAuthority(t, { laterPhase });
      const evidenceRoot = root(t);
      prepareUnknownUploadAttempt(module, evidenceRoot, { sourceCommit: authority.sourceCommit });
      reconcileUpload(module, {
        evidenceRoot, projectRoot: authority.projectRoot,
      });
      assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'terminal_success');
    });
  }
});

test('hostile Git environment cannot synthesize committed null-identity authority', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const actual = await currentLocalIpaAuthority(t);
  const malicious = await currentLocalIpaAuthority(t, {
    trackedSource: 'forged alternate build 15 source\n',
  });
  copyAuthorityWorkingFiles(malicious, actual);
  const evidenceRoot = root(t);
  prepareUnknownUploadAttempt(module, evidenceRoot, { sourceCommit: malicious.sourceCommit });
  const fake = fakeGitPath(t, { delegate: true });
  const poisonConfig = join(fake.directory, 'poisoned-global-gitconfig');
  writeFileSync(poisonConfig, `[core]\n\tworktree = ${actual.projectRoot}\n`);
  const error = withProcessEnvironment({
    PATH: `${fake.directory}:/usr/bin:/bin`,
    GIT_DIR: join(malicious.projectRoot, '.git'),
    GIT_WORK_TREE: actual.projectRoot,
    GIT_INDEX_FILE: join(malicious.projectRoot, '.git/index'),
    GIT_OBJECT_DIRECTORY: join(malicious.projectRoot, '.git/objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(malicious.projectRoot, '.git/objects'),
    GIT_CONFIG_GLOBAL: poisonConfig,
    GIT_CONFIG_NOSYSTEM: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: actual.projectRoot,
    GIT_NO_REPLACE_OBJECTS: '0',
    GIT_REPLACE_REF_BASE: 'refs/forged-replace',
    GIT_EXEC_PATH: fake.directory,
    GIT_SSH_COMMAND: '/usr/bin/false',
    GIT_ASKPASS: '/usr/bin/false',
  }, () => {
    try {
      reconcileUpload(module, {
        evidenceRoot,
        projectRoot: actual.projectRoot,
      });
      return null;
    } catch (caught) {
      return caught;
    }
  });
  assert.equal(error?.message, 'RELEASE_ATTEMPT_RECONCILIATION_INVALID');
  assert.equal(existsSync(fake.sentinel), false, 'caller PATH must never select Git');
  assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'unknown');
});

test('exact committed authority still reconciles when caller PATH contains a failing fake Git', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const authority = await currentLocalIpaAuthority(t);
  const evidenceRoot = root(t);
  prepareUnknownUploadAttempt(module, evidenceRoot, { sourceCommit: authority.sourceCommit });
  const fake = fakeGitPath(t, { delegate: false });
  const preloadSentinel = join(fake.directory, 'authority-child-preload-invoked');
  const preload = join(fake.directory, 'authority-child-preload.cjs');
  writeFileSync(preload, [
    "const { writeFileSync } = require('node:fs');",
    `writeFileSync(${JSON.stringify(preloadSentinel)}, 'invoked');`,
    '',
  ].join('\n'));
  withProcessEnvironment({
    PATH: `${fake.directory}:/usr/bin:/bin`,
    NODE_OPTIONS: `--require=${preload}`,
    NODE_PATH: fake.directory,
    npm_config_node_options: `--require=${preload}`,
    DYLD_INSERT_LIBRARIES: join(fake.directory, 'forged-loader.dylib'),
    DYLD_LIBRARY_PATH: fake.directory,
    LD_PRELOAD: join(fake.directory, 'forged-loader.so'),
    LD_LIBRARY_PATH: fake.directory,
  }, () => {
    reconcileUpload(module, {
      evidenceRoot,
      projectRoot: authority.projectRoot,
    });
  });
  assert.equal(existsSync(fake.sentinel), false, 'caller PATH must never select Git');
  assert.equal(existsSync(preloadSentinel), false, 'authority child must reject preload state');
  assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'terminal_success');
});

test('null submittedBuild reconciliation rejects uncommitted or forged phase authority', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const cases = [
    ['dirty tracked source', async () => {
      const authority = await currentLocalIpaAuthority(t);
      writeFileSync(join(authority.projectRoot, 'tracked-source.txt'), 'dirty source\n');
      return authority;
    }],
    ['forged working guard pin', async () => {
      const authority = await currentLocalIpaAuthority(t);
      writeFileSync(join(authority.projectRoot, 'scripts/release-command-guard.mjs'), authorityGuard({
        inputSha256: authority.inputSha256,
        artifactSha256: 'f'.repeat(64),
      }));
      return authority;
    }],
    ['forged working input attestation', async () => {
      const authority = await currentLocalIpaAuthority(t);
      writeFileSync(
        join(authority.projectRoot, 'release/app-store/3.0/build-input-attestation.json'),
        '{"forged":"input"}\n',
      );
      return authority;
    }],
    ['forged working artifact attestation', async () => {
      const authority = await currentLocalIpaAuthority(t);
      writeFileSync(
        join(authority.projectRoot, 'release/app-store/3.0/build-artifact-attestation.json'),
        '{"forged":"artifact"}\n',
      );
      return authority;
    }],
    ['forged ignored local IPA', async () => {
      const authority = await currentLocalIpaAuthority(t);
      writeFileSync(
        join(authority.projectRoot, 'release/private/rc-build-15/CaboHealth-3.0-build-15.ipa'),
        'forged ignored IPA bytes\n',
      );
      return authority;
    }],
    ['wrong candidate in self-consistent working artifact', async () => {
      const authority = await currentLocalIpaAuthority(t);
      forgeWorkingAuthority(authority, {
        mutateArtifact(artifact) {
          artifact.candidate.buildNumber = '8';
        },
      });
      return authority;
    }],
    ['wrong source digest linkage in self-consistent working artifact', async () => {
      const authority = await currentLocalIpaAuthority(t);
      forgeWorkingAuthority(authority, {
        mutateArtifact(artifact) {
          artifact.sourceTreeSha256 = 'f'.repeat(64);
        },
      });
      return authority;
    }],
    ['wrong input linkage in self-consistent working artifact', async () => {
      const authority = await currentLocalIpaAuthority(t);
      forgeWorkingAuthority(authority, {
        mutateArtifact(artifact) {
          artifact.buildInputAttestationSha256 = 'f'.repeat(64);
        },
      });
      return authority;
    }],
    ['wrong EAS build linkage in self-consistent working artifact', async () => {
      const authority = await currentLocalIpaAuthority(t);
      forgeWorkingAuthority(authority, {
        mutateArtifact(artifact) {
          artifact.easArtifactAssociation.buildId = SUBMISSION_ID;
        },
      });
      return authority;
    }],
    ['wrong marker source commit', async () => ({
      ...await currentLocalIpaAuthority(t),
      markerSourceCommit: 'f'.repeat(40),
    })],
    ['self-consistent forged working guard, attestations, and IPA', async () => {
      const authority = await currentLocalIpaAuthority(t);
      forgeWorkingAuthority(authority);
      return authority;
    }],
    ['forged combined phase history', () => currentLocalIpaAuthority(t, { combinedHistory: true })],
    ['committed but unrecomputed source digest', () => currentLocalIpaAuthority(t, {
      sourceTreeSha256: 'f'.repeat(64),
    })],
    ['submit-tool pin with missing RC phase', () => currentLocalIpaAuthority(t, {
      laterPhase: 'gap-submit',
    })],
  ];
  for (const [name, prepareAuthority] of cases) {
    await t.test(name, async () => {
      const authority = await prepareAuthority();
      const evidenceRoot = root(t);
      prepareUnknownUploadAttempt(module, evidenceRoot, {
        sourceCommit: authority.markerSourceCommit ?? authority.sourceCommit,
      });
      assert.throws(() => reconcileUpload(module, {
        evidenceRoot, projectRoot: authority.projectRoot,
      }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
      assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'unknown');
    });
  }
});

test('null submittedBuild reconciliation requires the exact attempted submission UUID', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const authority = await currentLocalIpaAuthority(t);

  await t.test('provider-started without a unique log UUID remains blocked', () => {
    const evidenceRoot = root(t);
    prepareProviderStartedUploadAttempt(module, evidenceRoot, {
      sourceCommit: authority.sourceCommit,
    });
    assert.throws(() => reconcileUpload(module, {
      evidenceRoot, projectRoot: authority.projectRoot,
    }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
    assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'provider_started');
  });

  await t.test('unknown without a unique log UUID remains blocked', () => {
    const evidenceRoot = root(t);
    prepareUnknownUploadAttempt(module, evidenceRoot, {
      sourceCommit: authority.sourceCommit,
      providerId: null,
    });
    assert.throws(() => reconcileUpload(module, {
      evidenceRoot, projectRoot: authority.projectRoot,
    }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
    assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'unknown');
  });

  await t.test('provider-started exact fsynced log UUID rejects another same-app submission', () => {
    const evidenceRoot = root(t);
    prepareProviderStartedUploadAttempt(module, evidenceRoot, {
      sourceCommit: authority.sourceCommit,
      providerId: SUBMISSION_ID,
    });
    assert.throws(() => reconcileUpload(module, {
      evidenceRoot,
      projectRoot: authority.projectRoot,
      submissionId: OTHER_SUBMISSION_ID,
    }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
    assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'provider_started');
  });

  await t.test('provider-started exact fsynced log UUID can bind reconciliation', () => {
    const evidenceRoot = root(t);
    prepareProviderStartedUploadAttempt(module, evidenceRoot, {
      sourceCommit: authority.sourceCommit,
      providerId: SUBMISSION_ID,
    });
    reconcileUpload(module, {
      evidenceRoot, projectRoot: authority.projectRoot,
    });
    assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'terminal_success');
  });
});

test('submission reconciliation enforces consistent null and present identity fields', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const authority = await currentLocalIpaAuthority(t);
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
      buildNumber: '15',
      easBuildId: SUBMISSION_ID,
    }],
  ];
  for (const [name, appOverrides] of cases) {
    await t.test(name, () => {
      const evidenceRoot = root(t);
      prepareUnknownUploadAttempt(module, evidenceRoot, { sourceCommit: authority.sourceCommit });
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
        projectRoot: authority.projectRoot,
      }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
    });
  }
});

test('provider-present submission identity retains exact candidate and EAS build matching', async (t) => {
  const module = await import('../scripts/release-attempt-runner.mjs');
  const evidenceRoot = root(t);
  const authority = await currentLocalIpaAuthority(t);
  prepareUnknownUploadAttempt(module, evidenceRoot, { sourceCommit: authority.sourceCommit });
  const evidence = submissionReconciliationEvidence({
    submittedBuildIdentityAvailable: true,
    bundleIdentifier: 'com.cabohealth.app',
    marketingVersion: '3.0',
    buildNumber: '15',
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
    projectRoot: authority.projectRoot,
  });
  assert.equal(module.readAttemptMarker(evidenceRoot, 'upload-testflight').state, 'terminal_success');
});

test('provider-started crash reconciliation requires the exact logged operation and rejects forged fields', async (t) => {
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
    buildNumber: '15',
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
  assert.throws(() => reconcileAttempt({
    evidenceRoot: crashedRoot,
    action: 'build',
    providerOperationId: BUILD_ID,
    terminalStatus: 'FINISHED',
    evidencePath,
    evidenceSha256: hash(evidenceBytes),
    terminalAt: '2026-08-30T12:20:00.000Z',
  }), /RELEASE_ATTEMPT_RECONCILIATION_INVALID/u);
  assert.equal(readAttemptMarker(crashedRoot, 'build').state, 'provider_started');

  const anchoredRoot = root(t);
  armAttempt({
    evidenceRoot: anchoredRoot,
    action: 'build',
    sourceCommit: SOURCE_COMMIT,
    runnerPid: 125,
    startedAt: NOW,
  });
  createAttemptLogs({ evidenceRoot: anchoredRoot, action: 'build', attemptNumber: 1 });
  markProviderStarted(join(anchoredRoot, 'build-attempt.json'), {
    action: 'build', sourceCommit: SOURCE_COMMIT,
  });
  writeFileSync(
    join(anchoredRoot, 'build-attempt-1.stdout.log'),
    `https://expo.dev/accounts/guaderrama/projects/cabohealth/builds/${BUILD_ID}\n`,
  );
  const anchoredEvidencePath = join(anchoredRoot, 'build-reconciliation.json');
  writeFileSync(anchoredEvidencePath, evidenceBytes, { mode: 0o600 });
  chmodSync(anchoredEvidencePath, 0o600);
  reconcileAttempt({
    evidenceRoot: anchoredRoot,
    action: 'build',
    providerOperationId: BUILD_ID,
    terminalStatus: 'FINISHED',
    evidencePath: anchoredEvidencePath,
    evidenceSha256: hash(evidenceBytes),
    terminalAt: '2026-08-30T12:20:00.000Z',
  });
  const recovered = readAttemptMarker(anchoredRoot, 'build');
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
