import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

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

export function writeDurableCanonicalRecord(path, value, {
  errorCode = 'protected_overlay_journal_invalid',
  mode = 0o600,
} = {}) {
  if (![0o400, 0o600].includes(mode)) throw new Error(errorCode);
  let source;
  try {
    source = `${JSON.stringify(value)}\n`;
  } catch {
    throw new Error(errorCode);
  }
  const destination = resolve(path);
  const candidate = `${destination}.candidate`;
  removeOwnedFileIfPresent(candidate, mode, errorCode);
  if (existsSync(destination)) {
    readDescriptorBoundFile(destination, {
      allowedModes: [mode],
      errorCode,
      expectedParentModes: [0o700, 0o755],
      maximumSize: 16 * 1024 * 1024,
      minimumSize: 0,
    });
  }
  writeDurableExclusiveFile(candidate, source, mode, errorCode);
  durableRename(candidate, destination, errorCode);
}

export function readDurableCanonicalRecord(path, {
  errorCode = 'protected_overlay_journal_invalid',
  mode = 0o600,
  maximumSize = 16 * 1024 * 1024,
} = {}) {
  const target = resolve(path);
  if (!existsSync(target)) return null;
  const file = readDescriptorBoundFile(target, {
    allowedModes: [mode],
    errorCode,
    expectedParentModes: [0o700, 0o755],
    maximumSize,
  });
  const source = file.bytes.toString('utf8');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(errorCode);
  }
  if (source !== `${JSON.stringify(value)}\n`) throw new Error(errorCode);
  return value;
}

export function clearDurableCanonicalRecord(path, {
  errorCode = 'protected_overlay_journal_invalid',
  mode = 0o600,
} = {}) {
  const target = resolve(path);
  removeOwnedFileIfPresent(`${target}.candidate`, mode, errorCode);
  removeOwnedFileIfPresent(target, mode, errorCode);
}

export function durableRename(source, destination, errorCode = 'protected_overlay_rename_failed') {
  const sourcePath = resolve(source);
  const destinationPath = resolve(destination);
  const sourceParent = dirname(sourcePath);
  const destinationParent = dirname(destinationPath);
  inspectDescriptorBoundDirectory(sourceParent, {
    allowedModes: [0o700, 0o755],
    errorCode,
  });
  inspectDescriptorBoundDirectory(destinationParent, {
    allowedModes: [0o700, 0o755],
    errorCode,
  });
  try {
    renameSync(sourcePath, destinationPath);
    fsyncDirectory(sourceParent, errorCode);
    if (destinationParent !== sourceParent) fsyncDirectory(destinationParent, errorCode);
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

export function ensureDurableDirectory(path, mode, errorCode = 'protected_overlay_directory_invalid') {
  const target = resolve(path);
  const parent = dirname(target);
  inspectDescriptorBoundDirectory(parent, {
    allowedModes: [0o700, 0o755],
    errorCode,
  });
  let created = false;
  try {
    mkdirSync(target, { mode });
    created = true;
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'EEXIST')) {
      throw new Error(errorCode);
    }
  }
  const directory = inspectDescriptorBoundDirectory(target, {
    allowedModes: [mode],
    errorCode,
  });
  if (created) {
    fsyncDirectory(directory.path, errorCode);
    fsyncDirectory(parent, errorCode);
  }
  return directory.path;
}

export function removeDurableOwnedTree(
  path,
  managedRoot,
  errorCode = 'protected_overlay_staging_invalid',
) {
  const root = inspectDescriptorBoundDirectory(managedRoot, {
    allowedModes: [0o700],
    errorCode,
  }).path;
  const lexicalTarget = resolve(path);
  if (!existsSync(lexicalTarget)) return;
  let target;
  try {
    const lexicalStat = lstatSync(lexicalTarget, { bigint: true });
    if (lexicalStat.isSymbolicLink()) throw new Error(errorCode);
    target = realpathSync(lexicalTarget);
  } catch {
    throw new Error(errorCode);
  }
  if (target === root || !target.startsWith(`${root}${sep}`)) throw new Error(errorCode);
  removeDirectoryRecursively(target, errorCode);
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

function removeOwnedFileIfPresent(path, mode, errorCode) {
  if (!existsSync(path)) return;
  readDescriptorBoundFile(path, {
    allowedLinkCounts: [1],
    allowedModes: [mode],
    errorCode,
    expectedParentModes: [0o700, 0o755],
    maximumSize: 16 * 1024 * 1024,
    minimumSize: 0,
  });
  durableUnlink(path, errorCode);
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

function removeDirectoryRecursively(path, errorCode) {
  const directory = inspectDescriptorBoundDirectory(path, {
    allowedModes: [0o700, 0o755],
    errorCode,
  });
  const entries = readdirSync(directory.path, { withFileTypes: true });
  for (const entry of entries) {
    const child = resolve(directory.path, entry.name);
    const stat = lstatSync(child, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error(errorCode);
    if (stat.isDirectory()) {
      removeDirectoryRecursively(child, errorCode);
    } else if (stat.isFile()) {
      readDescriptorBoundFile(child, {
        allowedLinkCounts: [1],
        allowedModes: [0o400, 0o600, 0o644],
        errorCode,
        expectedParentModes: [0o700, 0o755],
        maximumSize: 16 * 1024 * 1024,
        minimumSize: 0,
      });
      durableUnlink(child, errorCode);
    } else {
      throw new Error(errorCode);
    }
  }
  if (readdirSync(directory.path).length !== 0) throw new Error(errorCode);
  try {
    rmdirSync(directory.path);
    fsyncDirectory(dirname(directory.path), errorCode);
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}
