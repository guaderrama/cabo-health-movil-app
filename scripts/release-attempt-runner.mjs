#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as FS_CONSTANTS,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CANDIDATE,
  COMMIT_PATTERN,
  EAS_ACCOUNT,
  EAS_PROJECT_SLUG,
  SHA256_PATTERN,
  UUID_PATTERN,
  atomicReplaceCanonicalJson,
  canonicalJsonBytes,
  hasExactKeys,
  isCanonicalUtc,
  isWithin,
  parseJsonBytes,
  readSecureFile,
  sha256,
  validateOwnedDirectory,
  writeExclusiveCanonicalJson,
  writeExclusiveFile,
} from './release-evidence-common.mjs';

const ARGUMENT = 'RELEASE_ATTEMPT_ARGUMENT_INVALID';
const ROOT = 'RELEASE_ATTEMPT_EVIDENCE_ROOT_INVALID';
const MARKER = 'RELEASE_ATTEMPT_MARKER_INVALID';
const STATE = 'RELEASE_ATTEMPT_STATE_INVALID';
const RECOVERY = 'RELEASE_ATTEMPT_ARMED_RECOVERY_INVALID';
const RETRY = 'RELEASE_ATTEMPT_RETRY_NOT_AUTHORIZED';
const RECONCILIATION = 'RELEASE_ATTEMPT_RECONCILIATION_INVALID';
const ACTIONS = new Set(['build', 'upload-testflight']);
const TERMINAL_STATUSES = new Set(['FINISHED', 'ERRORED', 'CANCELED']);
const DEFAULT_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER_KEYS = [
  'schemaVersion', 'action', 'candidate', 'attemptNumber', 'runnerPid', 'state',
  'providerOperationId', 'startedAt', 'terminalAt', 'outcome', 'rawEvidenceSha256',
  'reconciliationEvidenceSha256', 'retryReviewSha256',
];
const CANDIDATE_KEYS = ['bundleIdentifier', 'marketingVersion', 'buildNumber', 'sourceCommit'];
const STATE_OUTCOMES = new Map([
  ['armed', 'pending'],
  ['provider_started', 'pending'],
  ['preprovider_failed', 'preprovider-blocked'],
  ['unknown', 'unknown'],
  ['terminal_failure', 'failed'],
  ['terminal_success', 'succeeded'],
]);

function fail(code) {
  throw new Error(code);
}

function markerName(action) {
  if (!ACTIONS.has(action)) fail(ARGUMENT);
  return `${action}-attempt.json`;
}

function logName(action, attemptNumber, stream) {
  if (!ACTIONS.has(action) || ![1, 2].includes(attemptNumber)
    || !['stdout', 'stderr'].includes(stream)) fail(MARKER);
  return `${action}-attempt-${attemptNumber}.${stream}.log`;
}

function validateEvidenceRoot(evidenceRoot) {
  return validateOwnedDirectory(evidenceRoot, ROOT, { outsideDropbox: true });
}

function validateMarker(value, code = MARKER) {
  if (!hasExactKeys(value, MARKER_KEYS)
    || value.schemaVersion !== 1 || !ACTIONS.has(value.action)
    || !hasExactKeys(value.candidate, CANDIDATE_KEYS)
    || value.candidate.bundleIdentifier !== CANDIDATE.bundleIdentifier
    || value.candidate.marketingVersion !== CANDIDATE.marketingVersion
    || value.candidate.buildNumber !== CANDIDATE.buildNumber
    || !COMMIT_PATTERN.test(value.candidate.sourceCommit ?? '')
    || ![1, 2].includes(value.attemptNumber)
    || !Number.isSafeInteger(value.runnerPid) || value.runnerPid <= 0
    || !STATE_OUTCOMES.has(value.state)
    || value.outcome !== STATE_OUTCOMES.get(value.state)
    || !isCanonicalUtc(value.startedAt)
    || (value.terminalAt !== null && !isCanonicalUtc(value.terminalAt))
    || (['preprovider_failed', 'terminal_failure', 'terminal_success'].includes(value.state)
      ? value.terminalAt === null : value.terminalAt !== null)
    || (value.providerOperationId !== null && !UUID_PATTERN.test(value.providerOperationId))
    || (['armed', 'provider_started', 'preprovider_failed'].includes(value.state)
      && value.providerOperationId !== null)
    || (['terminal_failure', 'terminal_success'].includes(value.state)
      && !UUID_PATTERN.test(value.providerOperationId ?? ''))
    || (['armed', 'provider_started'].includes(value.state)
      ? value.rawEvidenceSha256 !== null
      : (value.rawEvidenceSha256 === null
        ? value.reconciliationEvidenceSha256 === null
        : !SHA256_PATTERN.test(value.rawEvidenceSha256)))
    || (value.reconciliationEvidenceSha256 !== null
      && !SHA256_PATTERN.test(value.reconciliationEvidenceSha256))
    || (value.reconciliationEvidenceSha256 !== null
      && !['terminal_failure', 'terminal_success'].includes(value.state))
    || (value.attemptNumber === 1
      ? value.retryReviewSha256 !== null : !SHA256_PATTERN.test(value.retryReviewSha256 ?? ''))) fail(code);
  return value;
}

function markerPath(evidenceRoot, action) {
  return join(validateEvidenceRoot(evidenceRoot), markerName(action));
}

function readMarkerAt(path, expectedAction) {
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
      || dirname(path) === path) fail(MARKER);
    const root = validateEvidenceRoot(dirname(path));
    if (path !== join(root, markerName(expectedAction))) fail(MARKER);
    const bytes = readSecureFile(path, MARKER, { maxBytes: 128 * 1024, parent: root });
    const value = validateMarker(parseJsonBytes(bytes, MARKER, { canonical: true }));
    if (value.action !== expectedAction || !canonicalJsonBytes(value).equals(bytes)) fail(MARKER);
    return value;
  } catch (error) {
    if (error instanceof Error && [MARKER, ROOT].includes(error.message)) throw error;
    fail(MARKER);
  }
}

export function readAttemptMarker(evidenceRoot, action) {
  return readMarkerAt(markerPath(evidenceRoot, action), action);
}

export function armAttempt({ evidenceRoot, action, sourceCommit, runnerPid, startedAt }) {
  const root = validateEvidenceRoot(evidenceRoot);
  if (!ACTIONS.has(action) || !COMMIT_PATTERN.test(sourceCommit ?? '')
    || !Number.isSafeInteger(runnerPid) || runnerPid <= 0 || !isCanonicalUtc(startedAt)) fail(ARGUMENT);
  const value = {
    schemaVersion: 1,
    action,
    candidate: {
      bundleIdentifier: CANDIDATE.bundleIdentifier,
      marketingVersion: CANDIDATE.marketingVersion,
      buildNumber: CANDIDATE.buildNumber,
      sourceCommit,
    },
    attemptNumber: 1,
    runnerPid,
    state: 'armed',
    providerOperationId: null,
    startedAt,
    terminalAt: null,
    outcome: 'pending',
    rawEvidenceSha256: null,
    reconciliationEvidenceSha256: null,
    retryReviewSha256: null,
  };
  try {
    writeExclusiveCanonicalJson(join(root, markerName(action)), value, MARKER, { expectedParent: root });
  } catch {
    fail(MARKER);
  }
  return value;
}

export function createAttemptLogs({ evidenceRoot, action, attemptNumber }) {
  const root = validateEvidenceRoot(evidenceRoot);
  const marker = readAttemptMarker(root, action);
  if (marker.attemptNumber !== attemptNumber || marker.state !== 'armed') fail(STATE);
  const paths = {};
  for (const stream of ['stdout', 'stderr']) {
    const path = join(root, logName(action, attemptNumber, stream));
    try {
      writeExclusiveFile(path, Buffer.alloc(0), MARKER, {
        expectedParent: root,
      });
    } catch {
      fail(MARKER);
    }
    paths[stream] = path;
  }
  return paths;
}

export function rawEvidenceSha256(stdoutBytes, stderrBytes) {
  if (!Buffer.isBuffer(stdoutBytes) || !Buffer.isBuffer(stderrBytes)) fail(MARKER);
  const stdoutLength = Buffer.alloc(8);
  const stderrLength = Buffer.alloc(8);
  stdoutLength.writeBigUInt64BE(BigInt(stdoutBytes.length));
  stderrLength.writeBigUInt64BE(BigInt(stderrBytes.length));
  return sha256(Buffer.concat([stdoutLength, stdoutBytes, stderrLength, stderrBytes]));
}

function replaceMarker(path, value, code = MARKER) {
  validateMarker(value, code);
  try {
    atomicReplaceCanonicalJson(path, value, code);
  } catch {
    fail(code);
  }
  return value;
}

export function markProviderStarted(path, { action, sourceCommit }) {
  const marker = readMarkerAt(path, action);
  if (marker.state !== 'armed' || marker.candidate.sourceCommit !== sourceCommit) fail(STATE);
  return replaceMarker(path, { ...marker, state: 'provider_started' }, STATE);
}

function readAttemptLog(root, action, attemptNumber, stream, { createMissing = false } = {}) {
  const path = join(root, logName(action, attemptNumber, stream));
  if (createMissing && !existsSync(path)) {
    try {
      writeExclusiveFile(path, Buffer.alloc(0), MARKER, { expectedParent: root });
    } catch {
      fail(MARKER);
    }
  }
  return readSecureFile(path, MARKER, {
    maxBytes: 1024 * 1024 * 1024,
    allowEmpty: true,
    parent: root,
  });
}

function uniqueProviderId(action, stdoutBytes, stderrBytes) {
  const text = Buffer.concat([stdoutBytes, Buffer.from('\n'), stderrBytes]).toString('utf8');
  const suffix = action === 'build' ? 'builds' : 'submissions';
  const pattern = new RegExp(`/\\b${suffix}/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(?=$|[\\s?#])`, 'gu');
  const ids = new Set([...text.matchAll(pattern)].map((match) => match[1]));
  return ids.size === 1 ? [...ids][0] : null;
}

function finalizeObservedBytes({
  path,
  marker,
  action,
  exitStatus,
  terminalAt,
  stdoutBytes,
  stderrBytes,
}) {
  if (!['armed', 'provider_started'].includes(marker.state)
    || !Number.isInteger(exitStatus) || exitStatus < 0 || !isCanonicalUtc(terminalAt)
    || !Buffer.isBuffer(stdoutBytes) || !Buffer.isBuffer(stderrBytes)) fail(STATE);
  const rawDigest = rawEvidenceSha256(stdoutBytes, stderrBytes);
  const parsedId = uniqueProviderId(action, stdoutBytes, stderrBytes);
  if (marker.state === 'armed') {
    return replaceMarker(path, {
      ...marker,
      state: 'preprovider_failed', terminalAt, outcome: 'preprovider-blocked',
      rawEvidenceSha256: rawDigest,
    }, STATE);
  }
  if (exitStatus === 0 && parsedId !== null) {
    return replaceMarker(path, {
      ...marker,
      state: 'terminal_success', providerOperationId: parsedId, terminalAt,
      outcome: 'succeeded', rawEvidenceSha256: rawDigest,
    }, STATE);
  }
  return replaceMarker(path, {
    ...marker,
    state: 'unknown', providerOperationId: parsedId, terminalAt: null,
    outcome: 'unknown', rawEvidenceSha256: rawDigest,
  }, STATE);
}

export function finalizeObservedAttempt({
  evidenceRoot,
  action,
  exitStatus,
  terminalAt = new Date().toISOString(),
}) {
  const root = validateEvidenceRoot(evidenceRoot);
  const path = join(root, markerName(action));
  const marker = readMarkerAt(path, action);
  return finalizeObservedBytes({
    path,
    marker,
    action,
    exitStatus,
    terminalAt,
    stdoutBytes: readAttemptLog(root, action, marker.attemptNumber, 'stdout'),
    stderrBytes: readAttemptLog(root, action, marker.attemptNumber, 'stderr'),
  });
}

export function recoverArmedAttempt({
  evidenceRoot,
  action,
  expectedRunnerPid,
  terminalAt = new Date().toISOString(),
  kill = process.kill,
}) {
  const root = validateEvidenceRoot(evidenceRoot);
  const path = join(root, markerName(action));
  const marker = readMarkerAt(path, action);
  if (marker.state !== 'armed' || marker.providerOperationId !== null
    || !Number.isSafeInteger(expectedRunnerPid) || expectedRunnerPid <= 0
    || marker.runnerPid !== expectedRunnerPid || !isCanonicalUtc(terminalAt)
    || typeof kill !== 'function') fail(RECOVERY);
  try {
    kill(expectedRunnerPid, 0);
    fail(RECOVERY);
  } catch (error) {
    if (error instanceof Error && error.message === RECOVERY) throw error;
    if (error?.code !== 'ESRCH') fail(RECOVERY);
  }
  const stdoutBytes = readAttemptLog(root, action, marker.attemptNumber, 'stdout', { createMissing: true });
  const stderrBytes = readAttemptLog(root, action, marker.attemptNumber, 'stderr', { createMissing: true });
  return replaceMarker(path, {
    ...marker,
    state: 'preprovider_failed', terminalAt, outcome: 'preprovider-blocked',
    rawEvidenceSha256: rawEvidenceSha256(stdoutBytes, stderrBytes),
  }, RECOVERY);
}

export function retryAttempt({ evidenceRoot, action, reviewSha256, runnerPid, startedAt }) {
  const root = validateEvidenceRoot(evidenceRoot);
  const path = join(root, markerName(action));
  const marker = readMarkerAt(path, action);
  if (marker.state !== 'preprovider_failed' || marker.attemptNumber !== 1
    || !SHA256_PATTERN.test(reviewSha256 ?? '')
    || !Number.isSafeInteger(runnerPid) || runnerPid <= 0 || !isCanonicalUtc(startedAt)
    || ['stdout', 'stderr'].some((stream) => existsSync(join(root, logName(action, 2, stream))))) fail(RETRY);
  return replaceMarker(path, {
    ...marker,
    attemptNumber: 2,
    runnerPid,
    state: 'armed',
    providerOperationId: null,
    startedAt,
    terminalAt: null,
    outcome: 'pending',
    rawEvidenceSha256: null,
    reconciliationEvidenceSha256: null,
    retryReviewSha256: reviewSha256,
  }, RETRY);
}

const BUILD_RECONCILIATION_KEYS = [
  'schemaVersion', 'evidenceKind', 'easBuildId', 'status', 'terminal', 'platform',
  'distribution', 'account', 'projectSlug', 'buildProfile', 'bundleIdentifier',
  'marketingVersion', 'buildNumber', 'artifactAvailable', 'createdAt', 'completedAt',
  'errorPresent', 'errorCode', 'mutationPerformed', 'rawProviderResponseRetained',
  'providerUrlsOmitted', 'providerFieldsOmitted', 'credentialFieldsOmitted',
];
const SUBMISSION_RECONCILIATION_KEYS = [
  'schemaVersion', 'evidenceKind', 'submissionId', 'status', 'terminal', 'platform',
  'createdAt', 'completedAt', 'errorPresent', 'errorCode', 'app',
  'appleProcessingStatus', 'appleProcessingPendingReadOnlyVerification',
  'appStoreConnectBuildSelectionPerformed', 'mutationPerformed',
  'rawProviderResponseRetained', 'providerUrlsOmitted', 'providerFieldsOmitted',
  'credentialFieldsOmitted',
];
const SUBMISSION_APP_KEYS = [
  'appleId', 'account', 'projectSlug', 'submittedBuildIdentityAvailable',
  'bundleIdentifier', 'marketingVersion', 'buildNumber', 'easBuildId',
];
const BUILD_INPUT_AUTHORITY_KEYS = [
  'schemaVersion', 'artifactKind', 'candidate', 'sourceCommit', 'sourceTreeSha256',
  'appJsonSha256', 'configSha256', 'packageLockSha256', 'releaseManifestSha256',
  'releaseVerifierSha256', 'metadataVerifierSha256', 'firebaseProjectId',
  'googleServicesPlistSha256', 'resolvedProductionExpoConfigSha256', 'nodeRuntime',
  'easCli', 'easEnvironmentInventorySha256', 'easEnvironment', 'reviewedAt',
];
const BUILD_ARTIFACT_AUTHORITY_KEYS = [
  'schemaVersion', 'artifactKind', 'candidate', 'buildInputAttestationSha256',
  'sourceTreeSha256', 'easBuildId', 'easArtifactAssociation', 'ipaSha256',
  'signedEntitlementsSha256', 'privacyReportSha256',
  'embeddedGoogleServicesPlistSha256', 'signingCertificateSha256',
  'embeddedProvisioningProfileSha256', 'reviewedAt',
];
const ARTIFACT_ASSOCIATION_KEYS = [
  'evidenceType', 'buildId', 'buildStatus', 'downloadedIpaSha256',
  'associationGuardProven', 'reviewedAt',
];
const AUTHORITY_PIN_RULES = Object.freeze([
  ['BUILD_INPUT_ATTESTATION_SHA256', /^(?:null|'[a-f0-9]{64}')$/u],
  ['BUILD_ARTIFACT_ATTESTATION_SHA256', /^(?:null|'[a-f0-9]{64}')$/u],
  ['RC_ATTESTATION_SHA256', /^(?:null|'[a-f0-9]{64}')$/u],
  ['PINNED_EAS_CLI', /^(?:null|'[A-Za-z0-9+/]+={0,2}')$/u],
  ['PINNED_APP_STORE_SUBMIT_ADAPTER', /^(?:null|'[A-Za-z0-9+/]+={0,2}')$/u],
]);

function readCurrentAuthorityFile(projectRoot, relativePath, maxBytes) {
  let descriptor;
  try {
    if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)
      || resolve(projectRoot) !== projectRoot || realpathSync(projectRoot) !== projectRoot) {
      fail(RECONCILIATION);
    }
    const path = join(projectRoot, relativePath);
    if (!isWithin(projectRoot, path) || realpathSync(path) !== path) fail(RECONCILIATION);
    const before = lstatSync(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : before.uid;
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.uid !== uid || before.size <= 0 || before.size > maxBytes) fail(RECONCILIATION);
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs
      || opened.nlink !== 1 || opened.uid !== uid) fail(RECONCILIATION);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.nlink !== 1) fail(RECONCILIATION);
    return bytes;
  } catch (error) {
    if (error?.message === RECONCILIATION) throw error;
    fail(RECONCILIATION);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function currentAuthorityPins(guardBytes) {
  const source = guardBytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(guardBytes)) fail(RECONCILIATION);
  const pins = {};
  for (const [name, pattern] of AUTHORITY_PIN_RULES) {
    const matches = [...source.matchAll(new RegExp(`^const ${name} = ([^\\r\\n]*);$`, 'gmu'))];
    if (matches.length !== 1 || !pattern.test(matches[0][1])) fail(RECONCILIATION);
    pins[name] = matches[0][1] === 'null' ? null : matches[0][1].slice(1, -1);
  }
  return pins;
}

function committedAuthorityPhase(pins) {
  if (!SHA256_PATTERN.test(pins.BUILD_INPUT_ATTESTATION_SHA256 ?? '')
    || !SHA256_PATTERN.test(pins.BUILD_ARTIFACT_ATTESTATION_SHA256 ?? '')
    || pins.PINNED_EAS_CLI !== null
    || (pins.RC_ATTESTATION_SHA256 !== null
      && !SHA256_PATTERN.test(pins.RC_ATTESTATION_SHA256))
    || (pins.PINNED_APP_STORE_SUBMIT_ADAPTER !== null
      && pins.RC_ATTESTATION_SHA256 === null)) fail(RECONCILIATION);
  if (pins.PINNED_APP_STORE_SUBMIT_ADAPTER !== null) return 'submit-tool';
  if (pins.RC_ATTESTATION_SHA256 !== null) return 'rc';
  return 'artifact';
}

function verifyCommittedAuthority(projectRoot, sourceCommit, sourceTreeSha256, pins) {
  const phase = committedAuthorityPhase(pins);
  const expectedPins = {
    buildInputSha256: pins.BUILD_INPUT_ATTESTATION_SHA256,
    buildArtifactSha256: pins.BUILD_ARTIFACT_ATTESTATION_SHA256,
  };
  if (pins.RC_ATTESTATION_SHA256 !== null) expectedPins.rcSha256 = pins.RC_ATTESTATION_SHA256;
  if (pins.PINNED_APP_STORE_SUBMIT_ADAPTER !== null) {
    expectedPins.submitAdapterPin = pins.PINNED_APP_STORE_SUBMIT_ADAPTER;
  }
  const guardUrl = pathToFileURL(join(DEFAULT_PROJECT_ROOT, 'scripts/release-command-guard.mjs')).href;
  const program = [
    `const { computeTrackedSourceSha256, verifyPhaseAuthorityCommitHistory } = await import(${JSON.stringify(guardUrl)});`,
    'const [root, commit, phase, encodedPins] = process.argv.slice(1);',
    'try {',
    '  verifyPhaseAuthorityCommitHistory(root, commit, phase, JSON.parse(encodedPins));',
    "  process.stdout.write(`${computeTrackedSourceSha256(root)}\\n`);",
    '} catch { process.exitCode = 1; }',
  ].join('\n');
  // This child performs only committed Git authority checks. It receives no
  // caller-controlled repository, executable, Node preload, or loader state.
  const environment = {
    PATH: '/usr/bin:/bin',
    LANG: 'C',
    LC_ALL: 'C',
  };
  const result = spawnSync(process.execPath, [
    '--input-type=module', '--eval', program,
    projectRoot, sourceCommit, phase, JSON.stringify(expectedPins),
  ], {
    cwd: DEFAULT_PROJECT_ROOT,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.stdout !== `${sourceTreeSha256}\n`) fail(RECONCILIATION);
}

function hashCurrentIpa(projectRoot) {
  const relativePath = 'release/private/rc-build-9/CaboHealth-3.0-build-9.ipa';
  const path = join(projectRoot, relativePath);
  let descriptor;
  try {
    if (!isWithin(projectRoot, path) || realpathSync(path) !== path) fail(RECONCILIATION);
    const before = lstatSync(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : before.uid;
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.uid !== uid || (before.mode & 0o777) !== 0o600
      || before.size <= 0 || before.size > 1024 * 1024 * 1024) fail(RECONCILIATION);
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs || opened.nlink !== 1) fail(RECONCILIATION);
    const digest = createHash('sha256');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const count = readSync(descriptor, chunk, 0, Math.min(chunk.length, opened.size - offset), offset);
      if (count <= 0) fail(RECONCILIATION);
      digest.update(chunk.subarray(0, count));
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.nlink !== 1) fail(RECONCILIATION);
    return digest.digest('hex');
  } catch (error) {
    if (error?.message === RECONCILIATION) throw error;
    fail(RECONCILIATION);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateCurrentLocalIpaAuthority(projectRoot, marker) {
  const guardBytes = readCurrentAuthorityFile(
    projectRoot,
    'scripts/release-command-guard.mjs',
    2 * 1024 * 1024,
  );
  const pins = currentAuthorityPins(guardBytes);
  const inputPin = pins.BUILD_INPUT_ATTESTATION_SHA256;
  const artifactPin = pins.BUILD_ARTIFACT_ATTESTATION_SHA256;
  const inputBytes = readCurrentAuthorityFile(
    projectRoot,
    'release/app-store/3.0/build-input-attestation.json',
    1024 * 1024,
  );
  const artifactBytes = readCurrentAuthorityFile(
    projectRoot,
    'release/app-store/3.0/build-artifact-attestation.json',
    1024 * 1024,
  );
  if (sha256(inputBytes) !== inputPin || sha256(artifactBytes) !== artifactPin) fail(RECONCILIATION);
  const input = parseJsonBytes(inputBytes, RECONCILIATION, { canonical: true });
  const artifact = parseJsonBytes(artifactBytes, RECONCILIATION, { canonical: true });
  if (!canonicalJsonBytes(input).equals(inputBytes) || !canonicalJsonBytes(artifact).equals(artifactBytes)
    || !hasExactKeys(input, BUILD_INPUT_AUTHORITY_KEYS)
    || input.schemaVersion !== 1
    || input.artifactKind !== 'cabohealth-ios-build-input-attestation'
    || !hasExactKeys(input.candidate, Object.keys(CANDIDATE))
    || JSON.stringify(input.candidate) !== JSON.stringify(CANDIDATE)
    || input.sourceCommit !== marker.candidate.sourceCommit
    || !SHA256_PATTERN.test(input.sourceTreeSha256 ?? '')
    || !isCanonicalUtc(input.reviewedAt)
    || !hasExactKeys(artifact, BUILD_ARTIFACT_AUTHORITY_KEYS)
    || artifact.schemaVersion !== 1
    || artifact.artifactKind !== 'cabohealth-ios-build-artifact-attestation'
    || !hasExactKeys(artifact.candidate, Object.keys(CANDIDATE))
    || JSON.stringify(artifact.candidate) !== JSON.stringify(CANDIDATE)
    || artifact.buildInputAttestationSha256 !== inputPin
    || artifact.sourceTreeSha256 !== input.sourceTreeSha256
    || !UUID_PATTERN.test(artifact.easBuildId ?? '')
    || !hasExactKeys(artifact.easArtifactAssociation, ARTIFACT_ASSOCIATION_KEYS)
    || artifact.easArtifactAssociation.evidenceType !== 'independently-reviewed-procedural'
    || artifact.easArtifactAssociation.buildId !== artifact.easBuildId
    || artifact.easArtifactAssociation.buildStatus !== 'FINISHED'
    || artifact.easArtifactAssociation.downloadedIpaSha256 !== artifact.ipaSha256
    || artifact.easArtifactAssociation.associationGuardProven !== false
    || !isCanonicalUtc(artifact.easArtifactAssociation.reviewedAt)
    || !isCanonicalUtc(artifact.reviewedAt)
    || BUILD_ARTIFACT_AUTHORITY_KEYS.filter((key) => key.endsWith('Sha256'))
      .some((key) => !SHA256_PATTERN.test(artifact[key] ?? ''))
    || artifact.ipaSha256 !== hashCurrentIpa(projectRoot)) fail(RECONCILIATION);
  verifyCommittedAuthority(projectRoot, input.sourceCommit, input.sourceTreeSha256, pins);
  return artifact;
}

function validateAttemptLogStat(stat) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid
    || (stat.mode & 0o777) !== 0o600 || stat.size < 0
    || stat.size > 1024 * 1024 * 1024) fail(RECONCILIATION);
}

function openFsyncedAttemptLog(root, action, attemptNumber, stream) {
  const path = join(root, logName(action, attemptNumber, stream));
  let descriptor;
  try {
    const before = lstatSync(path);
    validateAttemptLogStat(before);
    if (realpathSync(path) !== path) fail(RECONCILIATION);
    descriptor = openSync(path, FS_CONSTANTS.O_RDWR | FS_CONSTANTS.O_APPEND
      | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    validateAttemptLogStat(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) fail(RECONCILIATION);
    fsyncSync(descriptor);
    const synced = fstatSync(descriptor);
    validateAttemptLogStat(synced);
    if (synced.dev !== opened.dev || synced.ino !== opened.ino
      || synced.size !== opened.size || synced.mtimeMs !== opened.mtimeMs) fail(RECONCILIATION);
    const bytes = Buffer.alloc(synced.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) fail(RECONCILIATION);
      offset += count;
    }
    const afterRead = fstatSync(descriptor);
    validateAttemptLogStat(afterRead);
    if (afterRead.dev !== synced.dev || afterRead.ino !== synced.ino
      || afterRead.size !== synced.size || afterRead.mtimeMs !== synced.mtimeMs) fail(RECONCILIATION);
    return {
      path,
      descriptor,
      bytes,
      dev: afterRead.dev,
      ino: afterRead.ino,
      size: afterRead.size,
      mtimeMs: afterRead.mtimeMs,
    };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.message === RECONCILIATION) throw error;
    fail(RECONCILIATION);
  }
}

function revalidateAttemptLog(log) {
  try {
    const descriptorStat = fstatSync(log.descriptor);
    const pathStat = lstatSync(log.path);
    validateAttemptLogStat(descriptorStat);
    validateAttemptLogStat(pathStat);
    if (realpathSync(log.path) !== log.path
      || descriptorStat.dev !== log.dev || descriptorStat.ino !== log.ino
      || descriptorStat.size !== log.size || descriptorStat.mtimeMs !== log.mtimeMs
      || pathStat.dev !== log.dev || pathStat.ino !== log.ino
      || pathStat.size !== log.size || pathStat.mtimeMs !== log.mtimeMs) fail(RECONCILIATION);
  } catch (error) {
    if (error?.message === RECONCILIATION) throw error;
    fail(RECONCILIATION);
  }
}

function openSubmissionAttemptAnchor(root, marker) {
  if (marker.state !== 'provider_started' || marker.providerOperationId !== null
    || marker.rawEvidenceSha256 !== null) fail(RECONCILIATION);
  const logs = [];
  try {
    for (const stream of ['stdout', 'stderr']) {
      logs.push(openFsyncedAttemptLog(root, marker.action, marker.attemptNumber, stream));
    }
    const providerOperationId = uniqueProviderId(
      marker.action,
      logs[0].bytes,
      logs[1].bytes,
    );
    if (providerOperationId === null) fail(RECONCILIATION);
    return { logs, providerOperationId };
  } catch (error) {
    for (const log of logs) closeSync(log.descriptor);
    if (error?.message === RECONCILIATION) throw error;
    fail(RECONCILIATION);
  }
}

function closeSubmissionAttemptAnchor(anchor) {
  if (anchor === null) return;
  for (const log of anchor.logs) closeSync(log.descriptor);
}

function validateReconciliationTimesAndError(value) {
  if (!isCanonicalUtc(value.createdAt) || !isCanonicalUtc(value.completedAt)
    || typeof value.errorPresent !== 'boolean'
    || (value.errorCode !== null
      && (typeof value.errorCode !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(value.errorCode)))
    || (value.errorPresent === false && value.errorCode !== null)) fail(RECONCILIATION);
}

function validateReconciliationEvidence(
  action,
  value,
  providerOperationId,
  terminalStatus,
  marker,
  projectRoot,
  attemptedSubmissionId,
) {
  if (action === 'build') {
    if (!hasExactKeys(value, BUILD_RECONCILIATION_KEYS)
      || value.evidenceKind !== 'cabohealth-eas-build-read-only-status'
      || value.easBuildId !== providerOperationId
      || value.distribution !== 'STORE'
      || value.account !== EAS_ACCOUNT
      || value.projectSlug !== EAS_PROJECT_SLUG
      || value.buildProfile !== 'production'
      || value.bundleIdentifier !== CANDIDATE.bundleIdentifier
      || value.marketingVersion !== CANDIDATE.marketingVersion
      || value.buildNumber !== CANDIDATE.buildNumber
      || typeof value.artifactAvailable !== 'boolean') fail(RECONCILIATION);
  } else {
    if (!hasExactKeys(value, SUBMISSION_RECONCILIATION_KEYS)
      || value.evidenceKind !== 'cabohealth-eas-submission-read-only-status'
      || value.submissionId !== providerOperationId
      || !hasExactKeys(value.app, SUBMISSION_APP_KEYS)
      || value.app.appleId !== CANDIDATE.appleId
      || value.app.account !== EAS_ACCOUNT
      || value.app.projectSlug !== EAS_PROJECT_SLUG
      || typeof value.app.submittedBuildIdentityAvailable !== 'boolean'
      || value.appleProcessingStatus !== 'not-proven-by-eas-submission'
      || value.appleProcessingPendingReadOnlyVerification !== true
      || value.appStoreConnectBuildSelectionPerformed !== false) fail(RECONCILIATION);
    const localAuthority = validateCurrentLocalIpaAuthority(projectRoot, marker);
    if (value.app.submittedBuildIdentityAvailable) {
      if (value.app.bundleIdentifier !== CANDIDATE.bundleIdentifier
        || value.app.marketingVersion !== CANDIDATE.marketingVersion
        || value.app.buildNumber !== CANDIDATE.buildNumber
        || value.app.easBuildId !== localAuthority.easBuildId) fail(RECONCILIATION);
    } else {
      if (value.app.bundleIdentifier !== null || value.app.marketingVersion !== null
        || value.app.buildNumber !== null || value.app.easBuildId !== null
        || attemptedSubmissionId !== providerOperationId) fail(RECONCILIATION);
    }
  }
  if (value.schemaVersion !== 1 || value.status !== terminalStatus || value.terminal !== true
    || value.platform !== 'IOS' || value.mutationPerformed !== false
    || value.rawProviderResponseRetained !== false || value.providerUrlsOmitted !== true
    || value.providerFieldsOmitted !== true || value.credentialFieldsOmitted !== true) fail(RECONCILIATION);
  validateReconciliationTimesAndError(value);
}

export function reconcileAttempt({
  evidenceRoot,
  action,
  providerOperationId,
  terminalStatus,
  evidencePath,
  evidenceSha256,
  terminalAt = new Date().toISOString(),
  projectRoot = DEFAULT_PROJECT_ROOT,
}) {
  const root = validateEvidenceRoot(evidenceRoot);
  const path = join(root, markerName(action));
  const marker = readMarkerAt(path, action);
  const expectedEvidenceName = action === 'build'
    ? 'build-reconciliation.json' : 'upload-testflight-reconciliation.json';
  if (!['provider_started', 'unknown'].includes(marker.state)
    || !UUID_PATTERN.test(providerOperationId ?? '')
    || (marker.providerOperationId !== null && marker.providerOperationId !== providerOperationId)
    || !TERMINAL_STATUSES.has(terminalStatus)
    || !SHA256_PATTERN.test(evidenceSha256 ?? '') || !isCanonicalUtc(terminalAt)
    || typeof evidencePath !== 'string' || !isAbsolute(evidencePath)
    || resolve(evidencePath) !== evidencePath || !isWithin(root, evidencePath)
    || evidencePath !== join(root, expectedEvidenceName)) fail(RECONCILIATION);
  let anchor = null;
  try {
    const bytes = readSecureFile(
      evidencePath,
      RECONCILIATION,
      { maxBytes: 1024 * 1024, parent: root },
    );
    if (sha256(bytes) !== evidenceSha256) fail(RECONCILIATION);
    const value = parseJsonBytes(bytes, RECONCILIATION, { canonical: true });
    if (action === 'upload-testflight'
      && value?.app?.submittedBuildIdentityAvailable === false
      && marker.providerOperationId === null) {
      anchor = openSubmissionAttemptAnchor(root, marker);
    }
    validateReconciliationEvidence(
      action,
      value,
      providerOperationId,
      terminalStatus,
      marker,
      projectRoot,
      marker.providerOperationId ?? anchor?.providerOperationId ?? null,
    );
    if (anchor !== null) {
      for (const log of anchor.logs) revalidateAttemptLog(log);
    }
    const succeeded = terminalStatus === 'FINISHED';
    return replaceMarker(path, {
      ...marker,
      state: succeeded ? 'terminal_success' : 'terminal_failure',
      providerOperationId,
      terminalAt,
      outcome: succeeded ? 'succeeded' : 'failed',
      reconciliationEvidenceSha256: evidenceSha256,
    }, RECONCILIATION);
  } catch (error) {
    if (error?.message === RECONCILIATION) throw error;
    fail(RECONCILIATION);
  } finally {
    closeSubmissionAttemptAnchor(anchor);
  }
}

export function parseReleaseAttemptArguments(values) {
  if (!Array.isArray(values)) fail(ARGUMENT);
  const [command, action] = values;
  if (!ACTIONS.has(action)) fail(ARGUMENT);
  if (command === 'start' && values.length === 2) return { command, action };
  if (command === 'retry' && values.length === 4 && values[2] === '--review-sha256'
    && SHA256_PATTERN.test(values[3] ?? '')) {
    return { command, action, reviewSha256: values[3] };
  }
  if (command === 'recover-armed' && values.length === 4
    && values[2] === '--expected-runner-pid' && /^[1-9]\d*$/u.test(values[3] ?? '')) {
    const expectedRunnerPid = Number(values[3]);
    if (Number.isSafeInteger(expectedRunnerPid) && expectedRunnerPid > 0) {
      return { command, action, expectedRunnerPid };
    }
  }
  if (command === 'reconcile' && values.length === 10
    && values[2] === '--provider-operation-id' && UUID_PATTERN.test(values[3] ?? '')
    && values[4] === '--terminal-status' && TERMINAL_STATUSES.has(values[5])
    && values[6] === '--evidence' && typeof values[7] === 'string' && isAbsolute(values[7])
    && values[8] === '--evidence-sha256' && SHA256_PATTERN.test(values[9] ?? '')) {
    return {
      command, action, providerOperationId: values[3], terminalStatus: values[5],
      evidencePath: values[7], evidenceSha256: values[9],
    };
  }
  fail(ARGUMENT);
}

function frozenSourceCommit(projectRoot) {
  try {
    const path = join(projectRoot, 'release/app-store/3.0/build-input-attestation.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!COMMIT_PATTERN.test(value.sourceCommit ?? '')
      || value.candidate?.buildNumber !== CANDIDATE.buildNumber) fail(MARKER);
    return value.sourceCommit;
  } catch (error) {
    if (error instanceof Error && error.message === MARKER) throw error;
    fail(MARKER);
  }
}

function openLogForChild(path) {
  const descriptor = openSync(path, FS_CONSTANTS.O_RDWR | FS_CONSTANTS.O_APPEND
    | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
  const stat = fstatSync(descriptor);
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== 0o600) {
    closeSync(descriptor);
    fail(MARKER);
  }
  return {
    path,
    descriptor,
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
  };
}

function validateRunLogDescriptor(log, stat) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.dev !== log.dev || stat.ino !== log.ino
    || stat.nlink !== 1 || stat.uid !== log.uid || stat.uid !== uid
    || (stat.mode & 0o777) !== 0o600 || stat.size < 0
    || stat.size > 1024 * 1024 * 1024) fail(MARKER);
}

function syncAndReadLog(log, { fsync, fstat }) {
  fsync(log.descriptor);
  const synced = fstat(log.descriptor);
  validateRunLogDescriptor(log, synced);
  const bytes = Buffer.alloc(synced.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(log.descriptor, bytes, offset, bytes.length - offset, offset);
    if (count <= 0) fail(MARKER);
    offset += count;
  }
  const afterRead = fstat(log.descriptor);
  validateRunLogDescriptor(log, afterRead);
  if (afterRead.size !== synced.size || afterRead.mtimeMs !== synced.mtimeMs) fail(MARKER);
  log.size = afterRead.size;
  log.mtimeMs = afterRead.mtimeMs;
  return bytes;
}

function revalidateRunLogPath(log, { fstat }) {
  try {
    const descriptorStat = fstat(log.descriptor);
    const pathStat = lstatSync(log.path);
    validateRunLogDescriptor(log, descriptorStat);
    const uid = typeof process.getuid === 'function' ? process.getuid() : pathStat.uid;
    if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1
      || pathStat.uid !== uid || (pathStat.mode & 0o777) !== 0o600
      || realpathSync(log.path) !== log.path
      || descriptorStat.size !== log.size || descriptorStat.mtimeMs !== log.mtimeMs
      || pathStat.dev !== log.dev || pathStat.ino !== log.ino
      || pathStat.size !== log.size || pathStat.mtimeMs !== log.mtimeMs) fail(MARKER);
  } catch (error) {
    if (error?.message === MARKER) throw error;
    fail(MARKER);
  }
}

export function runGuard(projectRoot, evidenceRoot, action, attemptNumber, {
  spawn = spawnSync,
  fsync = fsyncSync,
  fstat = fstatSync,
  close = closeSync,
} = {}) {
  if (typeof spawn !== 'function' || typeof fsync !== 'function'
    || typeof fstat !== 'function' || typeof close !== 'function') fail(MARKER);
  const stdoutPath = join(evidenceRoot, logName(action, attemptNumber, 'stdout'));
  const stderrPath = join(evidenceRoot, logName(action, attemptNumber, 'stderr'));
  const stdout = openLogForChild(stdoutPath);
  let stderr;
  let result;
  let final;
  try {
    stderr = openLogForChild(stderrPath);
    result = spawn(process.execPath, [
      join(projectRoot, 'scripts/release-command-guard.mjs'), action,
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CABOHEALTH_RELEASE_ATTEMPT_STATE: join(evidenceRoot, markerName(action)),
      },
      stdio: ['ignore', stdout.descriptor, stderr.descriptor],
    });
    const stdoutBytes = syncAndReadLog(stdout, { fsync, fstat });
    const stderrBytes = syncAndReadLog(stderr, { fsync, fstat });
    revalidateRunLogPath(stdout, { fstat });
    revalidateRunLogPath(stderr, { fstat });
    const exitStatus = Number.isInteger(result.status) ? result.status : 1;
    const markerPath = join(evidenceRoot, markerName(action));
    final = finalizeObservedBytes({
      path: markerPath,
      marker: readMarkerAt(markerPath, action),
      action,
      exitStatus,
      terminalAt: new Date().toISOString(),
      stdoutBytes,
      stderrBytes,
    });
  } finally {
    let closeError;
    try {
      close(stdout.descriptor);
    } catch (error) {
      closeError = error;
    }
    if (stderr !== undefined) {
      try {
        close(stderr.descriptor);
      } catch (error) {
        closeError ??= error;
      }
    }
    if (closeError !== undefined) throw closeError;
  }
  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0 || final.state !== 'terminal_success') fail('RELEASE_ATTEMPT_GUARD_FAILED');
}

function main() {
  const options = parseReleaseAttemptArguments(process.argv.slice(2));
  const evidenceRoot = validateEvidenceRoot(process.env.CABOHEALTH_RELEASE_EVIDENCE_ROOT);
  if (options.command === 'recover-armed') {
    recoverArmedAttempt({ evidenceRoot, ...options });
    return;
  }
  if (options.command === 'reconcile') {
    reconcileAttempt({ evidenceRoot, ...options });
    return;
  }
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (options.command === 'start') {
    armAttempt({
      evidenceRoot,
      action: options.action,
      sourceCommit: frozenSourceCommit(projectRoot),
      runnerPid: process.pid,
      startedAt: new Date().toISOString(),
    });
  } else {
    retryAttempt({
      evidenceRoot,
      action: options.action,
      reviewSha256: options.reviewSha256,
      runnerPid: process.pid,
      startedAt: new Date().toISOString(),
    });
  }
  const marker = readAttemptMarker(evidenceRoot, options.action);
  createAttemptLogs({ evidenceRoot, action: options.action, attemptNumber: marker.attemptNumber });
  runGuard(projectRoot, evidenceRoot, options.action, marker.attemptNumber);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const publicCodes = new Set([
      ARGUMENT, ROOT, MARKER, STATE, RECOVERY, RETRY, RECONCILIATION,
      'RELEASE_ATTEMPT_GUARD_FAILED',
    ]);
    process.stderr.write(`${publicCodes.has(error?.message) ? error.message : 'RELEASE_ATTEMPT_INTERNAL_ERROR'}\n`);
    process.exitCode = 1;
  }
}
