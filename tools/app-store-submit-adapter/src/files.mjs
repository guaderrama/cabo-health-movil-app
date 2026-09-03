import { createHash } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { constants as FS_CONSTANTS } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_JSON_BYTES } from './constants.mjs';
import { reject } from './errors.mjs';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readBoundFile(path, {
  expectedSha256,
  privateFile,
  maxBytes = MAX_JSON_BYTES,
  code = 'EVIDENCE_FILE_INVALID',
} = {}) {
  try {
    if (resolve(path) !== path || realpathSync(path) !== path) reject(code);
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) reject(code);
    if (typeof process.getuid === 'function' && before.uid !== process.getuid()) reject(code);
    const mode = before.mode & 0o777;
    if (privateFile ? mode !== 0o600 : (mode & 0o022) !== 0) reject(code);
    if (before.size <= 0 || before.size > maxBytes) reject(code);
    const descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    try {
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.nlink !== 1 || opened.size !== before.size
        || opened.mtimeMs !== before.mtimeMs) reject(code);
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      if (after.nlink !== 1 || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || (expectedSha256 !== undefined && sha256(bytes) !== expectedSha256)) reject(code);
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (error?.message === code) throw error;
    reject(code);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJsonBytes(value, { sortKeys = false } = {}) {
  return Buffer.from(`${JSON.stringify(sortKeys ? canonicalize(value) : value)}\n`, 'utf8');
}

export function parseCanonicalJson(bytes, code, { sortKeys = false } = {}) {
  let value;
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || text.startsWith('\uFEFF')) reject(code);
    value = JSON.parse(text);
    if (!canonicalJsonBytes(value, { sortKeys }).equals(bytes)) reject(code);
  } catch (error) {
    if (error?.message === code) throw error;
    reject(code);
  }
  return value;
}

export function readBoundJson(path, options) {
  const { sortKeys = false, ...fileOptions } = options;
  return parseCanonicalJson(
    readBoundFile(path, fileOptions),
    options.code,
    { sortKeys },
  );
}
