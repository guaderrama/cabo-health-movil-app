import {
  closeSync,
  constants as FS_CONSTANTS,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { CANDIDATE, RESOURCE_ID_PATTERN, SHA256_PATTERN, UUID_PATTERN } from './constants.mjs';
import { reject } from './errors.mjs';
import { canonicalJsonBytes, parseCanonicalJson } from './files.mjs';
import { validateInternalEvidenceRoot } from './secure-output.mjs';

export const ASSIGNMENT_ATTEMPT_NAME = 'internal-testflight-group-assignment-attempt.json';

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

function readAttempt(path) {
  let descriptor;
  try {
    const before = lstatSync(path);
    validateOpened(before);
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    validateOpened(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs || opened.size <= 0 || opened.size > 128 * 1024) {
      reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) reject('INTERNAL_GROUP_OUTPUT_INVALID');
      offset += count;
    }
    const after = fstatSync(descriptor);
    validateOpened(after);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    const value = validateAttempt(parseCanonicalJson(bytes, 'INTERNAL_GROUP_OUTPUT_INVALID'));
    if (!canonicalJsonBytes(value).equals(bytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    return { bytes, value };
  } catch (error) {
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function createAttempt(path, root, value) {
  const bytes = canonicalJsonBytes(validateAttempt(value));
  let descriptor;
  try {
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
  } catch (error) {
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function replaceAttempt(path, root, value) {
  const current = readAttempt(path);
  const bytes = canonicalJsonBytes(validateAttempt(value));
  let descriptor;
  try {
    const before = lstatSync(path);
    validateOpened(before);
    descriptor = openSync(path, FS_CONSTANTS.O_WRONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    validateOpened(opened);
    const currentPath = lstatSync(path);
    validateOpened(currentPath);
    if (opened.dev !== before.dev || opened.ino !== before.ino
      || opened.dev !== currentPath.dev || opened.ino !== currentPath.ino
      || !current.bytes.equals(readAttempt(path).bytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const after = fstatSync(descriptor);
    validateOpened(after);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.length) {
      reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(root);
    if (!readAttempt(path).bytes.equals(bytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } catch (error) {
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function attemptPath(environment) {
  return join(validateInternalEvidenceRoot(environment), ASSIGNMENT_ATTEMPT_NAME);
}

export function assertAssignmentAttemptAbsent(environment = process.env) {
  const path = attemptPath(environment);
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return path;
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
) {
  const root = validateInternalEvidenceRoot(environment);
  if (path !== join(root, ASSIGNMENT_ATTEMPT_NAME)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
  const current = readAttempt(path).value;
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
  replaceAttempt(path, root, value);
  return value;
}
