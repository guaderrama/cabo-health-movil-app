import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as FS_CONSTANTS,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const CANDIDATE = Object.freeze({
  appleId: '6758285327',
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '11',
});
export const EAS_ACCOUNT = 'guaderrama';
export const EAS_PROJECT_SLUG = 'cabohealth';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

export function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
}

export function isCanonicalUtc(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function isValidReviewChronology(terminalReviewedAt, artifactReviewedAt, now = Date.now()) {
  if (!Number.isFinite(now)
    || !isCanonicalUtc(terminalReviewedAt)
    || !isCanonicalUtc(artifactReviewedAt)) return false;
  const terminalMilliseconds = Date.parse(terminalReviewedAt);
  const artifactMilliseconds = Date.parse(artifactReviewedAt);
  return terminalMilliseconds <= artifactMilliseconds && artifactMilliseconds <= now;
}

export function parseJsonBytes(bytes, code, { canonical = false } = {}) {
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || text.startsWith('\uFEFF')) throw new Error(code);
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
    if (canonical && !canonicalJsonBytes(value).equals(bytes)) throw new Error(code);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  }
}

export function isWithin(root, candidate) {
  const difference = relative(root, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

export function synchronizedWorkspaceAncestor(path) {
  let current = resolve(path);
  while (true) {
    if (/^Dropbox(?:$|[ (])/iu.test(basename(current))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function validateOwnedDirectory(path, code, {
  mode = 0o700,
  outsideDropbox = false,
} = {}) {
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) throw new Error(code);
    const stat = lstatSync(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isDirectory()
      || stat.isSymbolicLink()
      || stat.uid !== uid
      || (stat.mode & 0o777) !== mode
      || realpathSync(path) !== path
      || (outsideDropbox && synchronizedWorkspaceAncestor(path) !== null)) throw new Error(code);
    return path;
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  }
}

export function fsyncDirectory(path, code) {
  let descriptor;
  try {
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    throw new Error(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readSecureFile(path, code, {
  mode = 0o600,
  maxBytes,
  allowEmpty = false,
  parent,
} = {}) {
  let descriptor;
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) throw new Error(code);
    if (parent !== undefined && !isWithin(parent, path)) throw new Error(code);
    const before = lstatSync(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : before.uid;
    if (!before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1
      || before.uid !== uid
      || (before.mode & 0o777) !== mode
      || (!allowEmpty && before.size === 0)
      || (maxBytes !== undefined && before.size > maxBytes)
      || realpathSync(path) !== path) throw new Error(code);
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.nlink !== 1
      || opened.uid !== uid
      || (opened.mode & 0o777) !== mode
      || opened.size !== before.size) throw new Error(code);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error(code);
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function writeExclusiveFile(path, bytes, code, {
  mode = 0o600,
  expectedParent,
} = {}) {
  let descriptor;
  let created = false;
  try {
    if (!Buffer.isBuffer(bytes)
      || typeof path !== 'string'
      || !isAbsolute(path)
      || resolve(path) !== path
      || (expectedParent !== undefined && dirname(path) !== expectedParent)) throw new Error(code);
    descriptor = openSync(
      path,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      mode,
    );
    created = true;
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor);
    const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid
      || (stat.mode & 0o777) !== mode || stat.size !== bytes.length) throw new Error(code);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* handled below */ }
      descriptor = undefined;
    }
    if (created) {
      try { unlinkSync(path); } catch { /* output may not have been created */ }
    }
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const parent = dirname(path);
  fsyncDirectory(parent, code);
  const actual = readSecureFile(path, code, {
    mode,
    maxBytes: bytes.length,
    allowEmpty: bytes.length === 0,
  });
  if (!actual.equals(bytes)) throw new Error(code);
}

export function writeExclusiveCanonicalJson(path, value, code, options) {
  writeExclusiveFile(path, canonicalJsonBytes(value), code, options);
}

export function atomicReplaceCanonicalJson(path, value, code) {
  const parent = dirname(path);
  const candidate = join(parent, `.${basename(path)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`);
  try {
    writeExclusiveCanonicalJson(candidate, value, code, { expectedParent: parent });
    renameSync(candidate, path);
    fsyncDirectory(parent, code);
    const bytes = readSecureFile(path, code, { maxBytes: 256 * 1024 });
    if (!bytes.equals(canonicalJsonBytes(value))) throw new Error(code);
  } catch (error) {
    try { unlinkSync(candidate); } catch { /* candidate may already be renamed */ }
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  }
}

export async function readStdinBounded(stream, maximumBytes, code) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > maximumBytes) throw new Error(code);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  }
  return Buffer.concat(chunks, total);
}

export function setExactMode(path, mode, code) {
  try {
    chmodSync(path, mode);
    if ((statSync(path).mode & 0o777) !== mode) throw new Error(code);
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  }
}
