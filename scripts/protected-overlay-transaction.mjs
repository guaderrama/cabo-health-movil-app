import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  inspectDescriptorBoundDirectory,
  readDescriptorBoundFile,
} from './protected-overlay-secure-fs.mjs';

const LOCK_NAME = 'transaction.lock';
const LOCK_KIND = 'cabohealth-protected-overlay-lock-v1';
const TOKEN_PATTERN = /^[a-f0-9]{32}$/u;

export function withExclusiveOverlayLock(managedRoot, operation) {
  if (typeof operation !== 'function') throw new Error('protected_overlay_transaction_invalid');
  const root = inspectDescriptorBoundDirectory(managedRoot, {
    allowedModes: [0o700],
    errorCode: 'protected_overlay_transaction_root_invalid',
  }).path;
  const lock = acquireExclusiveLock(root);
  try {
    return operation(Object.freeze({ token: lock.token }));
  } finally {
    releaseExclusiveLock(root, lock);
  }
}

export function writeDurableExclusiveFile(path, bytes, mode, errorCode) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let descriptor;
  try {
    descriptor = openSync(
      resolve(path),
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | constants.O_NOFOLLOW,
      mode,
    );
    let offset = 0;
    while (offset < payload.length) {
      offset += writeSync(descriptor, payload, offset, payload.length - offset, offset);
    }
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor, { bigint: true });
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || Number(stat.mode & 0o777n) !== mode
      || stat.nlink !== 1n
      || stat.size !== BigInt(payload.length)
      || (typeof process.geteuid === 'function' && Number(stat.uid) !== process.geteuid())
    ) throw new Error(errorCode);
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  fsyncDirectory(dirname(resolve(path)), errorCode);
}

export function fsyncDirectory(path, errorCode = 'protected_overlay_fsync_failed') {
  const directory = inspectDescriptorBoundDirectory(path, {
    allowedModes: [0o700, 0o755],
    errorCode,
  });
  let descriptor;
  try {
    descriptor = openSync(
      directory.path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    fsyncSync(descriptor);
  } catch {
    throw new Error(errorCode);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function durableUnlink(path, errorCode = 'protected_overlay_unlink_failed') {
  try {
    unlinkSync(resolve(path));
    fsyncDirectory(dirname(resolve(path)), errorCode);
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

function acquireExclusiveLock(root) {
  const token = randomBytes(16).toString('hex');
  const payload = Object.freeze({
    schemaVersion: 1,
    lockKind: LOCK_KIND,
    pid: process.pid,
    token,
  });
  const lockPath = resolve(root, LOCK_NAME);
  const candidatePath = lockCandidatePath(root, payload);
  writeDurableExclusiveFile(
    candidatePath,
    `${JSON.stringify(payload)}\n`,
    0o600,
    'protected_overlay_transaction_lock_invalid',
  );

  for (;;) {
    try {
      linkSync(candidatePath, lockPath);
      fsyncDirectory(root, 'protected_overlay_transaction_lock_invalid');
      durableUnlink(candidatePath, 'protected_overlay_transaction_lock_invalid');
      return payload;
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'EEXIST')) {
        safeRemoveOwnCandidate(candidatePath);
        throw new Error('protected_overlay_transaction_lock_invalid');
      }
    }

    const existing = readLock(root);
    if (isProcessAlive(existing.value.pid)) {
      safeRemoveOwnCandidate(candidatePath);
      throw new Error('protected_overlay_transaction_locked');
    }
    removeStaleLock(root, existing);
  }
}

function releaseExclusiveLock(root, expected) {
  const existing = readLock(root);
  if (
    existing.value.pid !== expected.pid
    || existing.value.token !== expected.token
  ) throw new Error('protected_overlay_transaction_lock_lost');
  durableUnlink(resolve(root, LOCK_NAME), 'protected_overlay_transaction_lock_lost');
}

function readLock(root) {
  const path = resolve(root, LOCK_NAME);
  const file = readDescriptorBoundFile(path, {
    allowedLinkCounts: [1, 2],
    allowedModes: [0o600],
    errorCode: 'protected_overlay_transaction_lock_invalid',
    expectedParentModes: [0o700],
    maximumSize: 4096,
  });
  const source = file.bytes.toString('utf8');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('protected_overlay_transaction_lock_invalid');
  }
  if (
    source !== `${JSON.stringify(value)}\n`
    || value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify(['lockKind', 'pid', 'schemaVersion', 'token'])
    || value.schemaVersion !== 1
    || value.lockKind !== LOCK_KIND
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || typeof value.token !== 'string'
    || !TOKEN_PATTERN.test(value.token)
  ) throw new Error('protected_overlay_transaction_lock_invalid');
  return Object.freeze({ identity: file.identity, value: Object.freeze(value) });
}

function removeStaleLock(root, existing) {
  const staleCandidatePath = lockCandidatePath(root, existing.value);
  let candidate = null;
  if (existsSync(staleCandidatePath)) {
    candidate = readDescriptorBoundFile(staleCandidatePath, {
      allowedLinkCounts: [2],
      allowedModes: [0o600],
      errorCode: 'protected_overlay_transaction_lock_invalid',
      expectedParentModes: [0o700],
      maximumSize: 4096,
    });
    if (
      candidate.identity.dev !== existing.identity.dev
      || candidate.identity.ino !== existing.identity.ino
    ) throw new Error('protected_overlay_transaction_lock_invalid');
  } else if (Number(existing.identity.nlink) !== 1) {
    throw new Error('protected_overlay_transaction_lock_invalid');
  }
  durableUnlink(
    resolve(root, LOCK_NAME),
    'protected_overlay_transaction_lock_invalid',
  );
  if (candidate !== null) {
    durableUnlink(staleCandidatePath, 'protected_overlay_transaction_lock_invalid');
  }
}

function safeRemoveOwnCandidate(path) {
  if (!existsSync(path)) return;
  readDescriptorBoundFile(path, {
    allowedLinkCounts: [1],
    allowedModes: [0o600],
    errorCode: 'protected_overlay_transaction_lock_invalid',
    expectedParentModes: [0o700],
    maximumSize: 4096,
  });
  durableUnlink(path, 'protected_overlay_transaction_lock_invalid');
}

function lockCandidatePath(root, lock) {
  return resolve(root, `.${LOCK_NAME}.${lock.pid}.${lock.token}.candidate`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === 'object' && error.code !== 'ESRCH';
  }
}
