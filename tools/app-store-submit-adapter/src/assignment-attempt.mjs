import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as FS_CONSTANTS,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { CANDIDATE, RESOURCE_ID_PATTERN, SHA256_PATTERN, UUID_PATTERN } from './constants.mjs';
import { reject } from './errors.mjs';
import { canonicalJsonBytes, parseCanonicalJson } from './files.mjs';
import { validateInternalEvidenceRoot } from './secure-output.mjs';

export const ASSIGNMENT_ATTEMPT_NAME = 'internal-testflight-group-assignment-attempt.json';
export const ASSIGNMENT_ATTEMPT_TEMP_PREFIX = '.internal-testflight-group-assignment-attempt.';

const KEYS = [
  'schemaVersion', 'evidenceKind', 'candidate', 'sourceCommit', 'sourceTreeSha256',
  'buildInputAttestationSha256', 'buildArtifactAttestationSha256', 'easBuildId',
  'appStoreConnectBuildResourceId', 'betaGroupResourceId', 'state', 'startedAt',
  'providerStartedAt', 'terminalAt', 'outcome',
];
const CANDIDATE_KEYS = Object.keys(CANDIDATE);
const STATE_OUTCOMES = new Map([
  ['armed', 'pending'],
  ['provider_started', 'pending'],
  ['preprovider_failed', 'preprovider-blocked'],
  ['unknown', 'unknown'],
  ['terminal_failure', 'failed'],
  ['terminal_success', 'succeeded'],
]);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
}

function canonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function timestamp(now) {
  if (!Number.isFinite(now)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
  return new Date(now).toISOString();
}

function validateAttempt(value) {
  const providerStarted = value?.providerStartedAt !== null;
  const terminal = value?.terminalAt !== null;
  if (!exactKeys(value, KEYS)
    || value.schemaVersion !== 1
    || value.evidenceKind !== 'cabohealth-app-store-connect-internal-group-assignment-attempt'
    || !exactKeys(value.candidate, CANDIDATE_KEYS)
    || JSON.stringify(value.candidate) !== JSON.stringify(CANDIDATE)
    || !/^[a-f0-9]{40}$/u.test(value.sourceCommit ?? '')
    || !SHA256_PATTERN.test(value.sourceTreeSha256 ?? '')
    || !SHA256_PATTERN.test(value.buildInputAttestationSha256 ?? '')
    || !SHA256_PATTERN.test(value.buildArtifactAttestationSha256 ?? '')
    || !UUID_PATTERN.test(value.easBuildId ?? '')
    || !RESOURCE_ID_PATTERN.test(value.appStoreConnectBuildResourceId ?? '')
    || !RESOURCE_ID_PATTERN.test(value.betaGroupResourceId ?? '')
    || !STATE_OUTCOMES.has(value.state)
    || value.outcome !== STATE_OUTCOMES.get(value.state)
    || !canonicalTime(value.startedAt)
    || (providerStarted && !canonicalTime(value.providerStartedAt))
    || (terminal && !canonicalTime(value.terminalAt))
    || (['armed', 'preprovider_failed'].includes(value.state) && providerStarted)
    || (!['armed', 'preprovider_failed'].includes(value.state) && !providerStarted)
    || (['preprovider_failed', 'terminal_failure', 'terminal_success'].includes(value.state)
      ? !terminal : terminal)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
  return value;
}

function fsyncDirectory(root) {
  let descriptor;
  try {
    descriptor = openSync(root, FS_CONSTANTS.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateOpened(stat) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== 0o600) {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
}

function sameStableStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function readDescriptorBytes(descriptor, size) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > 128 * 1024) {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count <= 0) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    offset += count;
  }
  return bytes;
}

function validateDescriptorPath(snapshot, path) {
  const opened = fstatSync(snapshot.descriptor);
  validateOpened(opened);
  if (!sameStableStat(opened, snapshot.stat)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
  const bytes = readDescriptorBytes(snapshot.descriptor, opened.size);
  const after = fstatSync(snapshot.descriptor);
  validateOpened(after);
  if (!sameStableStat(after, opened) || !bytes.equals(snapshot.bytes)) {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  const currentPath = lstatSync(path);
  validateOpened(currentPath);
  if (!sameStableStat(currentPath, opened) || realpathSync(path) !== path) {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  return bytes;
}

function openAttemptSnapshot(path) {
  let descriptor;
  try {
    const before = lstatSync(path);
    validateOpened(before);
    if (realpathSync(path) !== path) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    validateOpened(opened);
    if (!sameStableStat(opened, before)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    const bytes = readDescriptorBytes(descriptor, opened.size);
    const after = fstatSync(descriptor);
    validateOpened(after);
    if (!sameStableStat(after, opened)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    const currentPath = lstatSync(path);
    validateOpened(currentPath);
    if (!sameStableStat(currentPath, opened) || realpathSync(path) !== path) {
      reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    const value = validateAttempt(parseCanonicalJson(bytes, 'INTERNAL_GROUP_OUTPUT_INVALID'));
    if (!canonicalJsonBytes(value).equals(bytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    const snapshot = {
      bytes,
      descriptor,
      stat: opened,
      value,
    };
    descriptor = undefined;
    return snapshot;
  } catch (error) {
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* stable error already selected */ }
    }
  }
}

function readAttempt(path) {
  const snapshot = openAttemptSnapshot(path);
  try {
    return { bytes: snapshot.bytes, value: snapshot.value };
  } finally {
    try { closeSync(snapshot.descriptor); } catch { reject('INTERNAL_GROUP_OUTPUT_INVALID'); }
  }
}

function transitionTempNames(root) {
  try {
    return readdirSync(root).filter((name) => name.startsWith(ASSIGNMENT_ATTEMPT_TEMP_PREFIX));
  } catch {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
}

function assertTransitionTemps(root, allowedName = null) {
  const names = transitionTempNames(root);
  if (allowedName === null ? names.length !== 0
    : names.length !== 1 || names[0] !== allowedName) {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
}

function createAttempt(path, root, value) {
  const bytes = canonicalJsonBytes(validateAttempt(value));
  let descriptor;
  try {
    assertTransitionTemps(root);
    descriptor = openSync(path,
      FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor);
    validateOpened(stat);
    if (stat.size !== bytes.length) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(root);
    if (!readAttempt(path).bytes.equals(bytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    assertTransitionTemps(root);
  } catch (error) {
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function cleanupOwnedTemp(tempPath, descriptor, root) {
  try {
    const opened = fstatSync(descriptor);
    validateOpened(opened);
    const currentPath = lstatSync(tempPath);
    validateOpened(currentPath);
    if (opened.dev !== currentPath.dev || opened.ino !== currentPath.ino
      || realpathSync(tempPath) !== tempPath) return;
    unlinkSync(tempPath);
    fsyncDirectory(root);
  } catch {
    // Never unlink a path unless it is still the exact exclusively-created inode.
  }
}

function replaceAttempt(path, root, value, { expectedCurrentBytes, failpoint }) {
  const bytes = canonicalJsonBytes(validateAttempt(value));
  let current;
  let tempDescriptor;
  let tempPath;
  let tempName;
  let renamed = false;
  try {
    assertTransitionTemps(root);
    current = openAttemptSnapshot(path);
    if (!current.bytes.equals(expectedCurrentBytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    tempName = `${ASSIGNMENT_ATTEMPT_TEMP_PREFIX}${randomBytes(16).toString('hex')}.tmp`;
    tempPath = join(root, tempName);
    tempDescriptor = openSync(tempPath,
      FS_CONSTANTS.O_RDWR | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(tempDescriptor, 0o600);
    failpoint('temp_created', { tempPath, newBytes: bytes });
    writeFileSync(tempDescriptor, bytes);
    failpoint('temp_written', { tempPath, newBytes: bytes });
    fsyncSync(tempDescriptor);
    failpoint('temp_fsynced', { tempPath, newBytes: bytes });
    const tempStat = fstatSync(tempDescriptor);
    validateOpened(tempStat);
    if (tempStat.size !== bytes.length) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    const tempSnapshot = { bytes, descriptor: tempDescriptor, stat: tempStat };
    validateDescriptorPath(tempSnapshot, tempPath);
    failpoint('temp_validated', { tempPath, newBytes: bytes });

    assertTransitionTemps(root, tempName);
    validateDescriptorPath(tempSnapshot, tempPath);
    validateDescriptorPath(current, path);
    failpoint('destination_validated', { tempPath, newBytes: bytes });

    assertTransitionTemps(root, tempName);
    validateDescriptorPath(tempSnapshot, tempPath);
    validateDescriptorPath(current, path);
    failpoint('before_rename', { tempPath, newBytes: bytes });

    assertTransitionTemps(root, tempName);
    validateDescriptorPath(tempSnapshot, tempPath);
    validateDescriptorPath(current, path);
    renameSync(tempPath, path);
    renamed = true;
    failpoint('after_rename', { tempPath, newBytes: bytes });

    assertTransitionTemps(root);
    const publishedStat = fstatSync(tempDescriptor);
    validateOpened(publishedStat);
    if (publishedStat.dev !== tempSnapshot.stat.dev
      || publishedStat.ino !== tempSnapshot.stat.ino
      || publishedStat.mode !== tempSnapshot.stat.mode
      || publishedStat.uid !== tempSnapshot.stat.uid
      || publishedStat.nlink !== tempSnapshot.stat.nlink
      || publishedStat.size !== tempSnapshot.stat.size
      || publishedStat.mtimeMs !== tempSnapshot.stat.mtimeMs) {
      reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    // A successful rename changes ctime on supported filesystems without changing the bytes.
    tempSnapshot.stat = publishedStat;
    validateDescriptorPath(tempSnapshot, path);
    fsyncDirectory(root);
    failpoint('directory_fsynced', { tempPath, newBytes: bytes });
    assertTransitionTemps(root);
    validateDescriptorPath(tempSnapshot, path);
    failpoint('before_final_readback', { tempPath, newBytes: bytes });
    if (!readAttempt(path).bytes.equals(bytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    validateDescriptorPath(tempSnapshot, path);
  } catch (error) {
    if (!renamed && tempDescriptor !== undefined && tempPath !== undefined) {
      cleanupOwnedTemp(tempPath, tempDescriptor, root);
    }
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (tempDescriptor !== undefined) {
      try { closeSync(tempDescriptor); } catch { /* stable error already selected */ }
    }
    if (current !== undefined) {
      try { closeSync(current.descriptor); } catch { /* stable error already selected */ }
    }
  }
}

function attemptPath(environment) {
  return join(validateInternalEvidenceRoot(environment), ASSIGNMENT_ATTEMPT_NAME);
}

export function assertAssignmentAttemptAbsent(environment = process.env) {
  const root = validateInternalEvidenceRoot(environment);
  assertTransitionTemps(root);
  const path = attemptPath(environment);
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assertTransitionTemps(root);
      return path;
    }
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  const existing = readAttempt(path).value;
  if (['provider_started', 'unknown'].includes(existing.state)) {
    reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
  }
  reject('INTERNAL_GROUP_ASSIGNMENT_FAILED');
}

export function armAssignmentAttempt(observation, environment = process.env, now = Date.now()) {
  const root = validateInternalEvidenceRoot(environment);
  const path = assertAssignmentAttemptAbsent(environment);
  const value = {
    schemaVersion: 1,
    evidenceKind: 'cabohealth-app-store-connect-internal-group-assignment-attempt',
    candidate: observation.candidate,
    sourceCommit: observation.sourceCommit,
    sourceTreeSha256: observation.sourceTreeSha256,
    buildInputAttestationSha256: observation.buildInputAttestationSha256,
    buildArtifactAttestationSha256: observation.buildArtifactAttestationSha256,
    easBuildId: observation.easBuildId,
    appStoreConnectBuildResourceId: observation.appStoreConnectBuildResourceId,
    betaGroupResourceId: observation.betaGroupResourceId,
    state: 'armed',
    startedAt: timestamp(now),
    providerStartedAt: null,
    terminalAt: null,
    outcome: 'pending',
  };
  createAttempt(path, root, value);
  return path;
}

export function transitionAssignmentAttempt(
  path,
  nextState,
  environment = process.env,
  now = Date.now(),
  { failpoint = () => {} } = {},
) {
  const root = validateInternalEvidenceRoot(environment);
  if (path !== join(root, ASSIGNMENT_ATTEMPT_NAME) || typeof failpoint !== 'function') {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  const observed = readAttempt(path);
  const current = observed.value;
  const allowed = (current.state === 'armed'
    && ['provider_started', 'preprovider_failed'].includes(nextState))
    || (current.state === 'provider_started' && nextState === 'unknown')
    || (current.state === 'unknown' && ['terminal_failure', 'terminal_success'].includes(nextState));
  if (!allowed) reject('INTERNAL_GROUP_OUTPUT_INVALID');
  const at = timestamp(now);
  const value = {
    ...current,
    state: nextState,
    providerStartedAt: nextState === 'provider_started' ? at : current.providerStartedAt,
    terminalAt: ['preprovider_failed', 'terminal_failure', 'terminal_success'].includes(nextState)
      ? at : null,
    outcome: STATE_OUTCOMES.get(nextState),
  };
  try {
    failpoint('before_transition_snapshot', { newBytes: canonicalJsonBytes(value) });
  } catch {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  replaceAttempt(path, root, value, {
    expectedCurrentBytes: observed.bytes,
    failpoint,
  });
  return value;
}
