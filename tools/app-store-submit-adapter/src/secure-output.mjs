import {
  closeSync,
  constants as FS_CONSTANTS,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { canonicalJsonBytes, parseCanonicalJson, sha256 } from './files.mjs';
import { reject } from './errors.mjs';

function synchronizedAncestor(path) {
  let current = resolve(path);
  while (true) {
    if (/^Dropbox(?:$|[ (])/iu.test(basename(current))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function validateInternalEvidenceRoot(environment = process.env) {
  const path = environment.CABOHEALTH_RELEASE_EVIDENCE_ROOT;
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
      reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    const stat = lstatSync(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid
      || (stat.mode & 0o777) !== 0o700 || realpathSync(path) !== path
      || synchronizedAncestor(path) !== null) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    return path;
  } catch (error) {
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
}

export function readInternalPrivateJson(path, expectedSha256, code = 'INTERNAL_GROUP_INPUT_INVALID') {
  let descriptor;
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
      || realpathSync(path) !== path) reject(code);
    const before = lstatSync(path);
    const uid = typeof process.getuid === 'function' ? process.getuid() : before.uid;
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== uid
      || (before.mode & 0o777) !== 0o600 || before.size <= 0 || before.size > 1024 * 1024) reject(code);
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs || opened.nlink !== 1) reject(code);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || sha256(bytes) !== expectedSha256) reject(code);
    return { bytes, value: parseCanonicalJson(bytes, code) };
  } catch (error) {
    if (error?.message === code) throw error;
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fsyncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function validateInternalOutputTarget(
  outputPath,
  operation,
  environment = process.env,
) {
  const root = validateInternalEvidenceRoot(environment);
  const expectedName = operation === 'observe-existing-internal-testflight-access'
    ? 'internal-testflight-group-observation.json'
    : (operation === 'ensure-existing-internal-testflight-access'
      ? 'internal-testflight-group-assignment.json' : null);
  try {
    if (expectedName === null || typeof outputPath !== 'string'
      || outputPath !== resolve(outputPath) || dirname(outputPath) !== root
      || basename(outputPath) !== expectedName || relative(root, outputPath) !== expectedName) {
      reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    let present = false;
    try {
      lstatSync(outputPath);
      present = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    if (present) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    return root;
  } catch (error) {
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
}

export function writeInternalOutput(outputPath, value, operation, environment = process.env) {
  const root = validateInternalOutputTarget(outputPath, operation, environment);
  const bytes = canonicalJsonBytes(value);
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(outputPath,
      FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor);
    const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid
      || (stat.mode & 0o777) !== 0o600 || stat.size !== bytes.length) {
      reject('INTERNAL_GROUP_OUTPUT_INVALID');
    }
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(root);
    const actual = readInternalPrivateJson(
      outputPath,
      sha256(bytes),
      'INTERNAL_GROUP_OUTPUT_INVALID',
    );
    if (!actual.bytes.equals(bytes)) reject('INTERNAL_GROUP_OUTPUT_INVALID');
    return outputPath;
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* stable output error below */ }
      descriptor = undefined;
    }
    if (created) {
      try {
        unlinkSync(outputPath);
        fsyncDirectory(root);
      } catch {
        // Preserve the stable output error; never remove a pre-existing file.
      }
    }
    if (error?.message === 'INTERNAL_GROUP_OUTPUT_INVALID') throw error;
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
