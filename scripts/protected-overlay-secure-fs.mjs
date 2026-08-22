import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

const CURRENT_UID = typeof process.geteuid === 'function' ? process.geteuid() : null;
const STAT_IDENTITY_FIELDS = Object.freeze([
  'dev',
  'ino',
  'mode',
  'nlink',
  'uid',
  'gid',
  'rdev',
  'size',
  'mtimeNs',
  'ctimeNs',
]);
const ANCESTOR_IDENTITY_FIELDS = Object.freeze([
  'dev',
  'ino',
  'mode',
  'uid',
  'gid',
]);

/**
 * Reads one immutable input through the exact descriptor whose metadata was
 * validated. Path and ancestor identities are checked on both sides of the
 * read so a rename race fails closed instead of minting evidence for swapped
 * bytes.
 */
export function readDescriptorBoundFile(path, options = {}) {
  const errorCode = options.errorCode ?? 'protected_overlay_file_invalid';
  try {
    return readDescriptorBoundFileUnsafe(path, options);
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

export function readDescriptorBoundCanonicalJson(path, options = {}) {
  const errorCode = options.errorCode ?? 'protected_overlay_input_file_invalid';
  const { bytes } = readDescriptorBoundFile(path, {
    ...options,
    errorCode,
  });
  const source = bytes.toString('utf8');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(errorCode);
  }
  if (source !== `${JSON.stringify(value)}\n`) throw new Error(errorCode);
  return value;
}

export function inspectDescriptorBoundDirectory(path, options = {}) {
  const errorCode = options.errorCode ?? 'protected_overlay_directory_invalid';
  try {
    const lexicalPath = resolve(path);
    const before = capturePath(lexicalPath, options);
    let descriptor;
    try {
      descriptor = openSync(
        before.canonicalPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const descriptorBefore = fstatSync(descriptor, { bigint: true });
      assertSameIdentity(before.leaf, descriptorBefore);
      const mode = permissionMode(descriptorBefore);
      if (
        !descriptorBefore.isDirectory()
        || descriptorBefore.isSymbolicLink()
        || descriptorBefore.nlink < 1n
        || (options.expectedOwnerUid ?? CURRENT_UID) !== null
          && Number(descriptorBefore.uid) !== (options.expectedOwnerUid ?? CURRENT_UID)
        || options.allowedModes !== undefined && !options.allowedModes.includes(mode)
      ) throw new Error(errorCode);
      const descriptorAfter = fstatSync(descriptor, { bigint: true });
      assertSameIdentity(descriptorBefore, descriptorAfter);
      const after = capturePath(lexicalPath, options);
      if (before.canonicalPath !== after.canonicalPath) throw new Error(errorCode);
      assertSameIdentity(descriptorAfter, after.leaf);
      assertAncestorSnapshotsEqual(before.ancestors, after.ancestors);
      return Object.freeze({
        path: before.canonicalPath,
        identity: filesystemIdentityKey(descriptorAfter),
      });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

export function filesystemIdentityKey(statOrIdentity) {
  return STAT_IDENTITY_FIELDS.map((field) => String(statOrIdentity[field])).join(':');
}

function readDescriptorBoundFileUnsafe(path, {
  allowedLinkCounts = [1],
  allowedModes,
  errorCode,
  expectedOwnerUid = CURRENT_UID,
  expectedParentModes,
  maximumSize = 16 * 1024 * 1024,
  minimumSize = 1,
  mustBeInside,
  mustBeOutside,
} = {}) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || !Array.isArray(allowedLinkCounts)
    || allowedLinkCounts.length === 0
    || !Number.isSafeInteger(maximumSize)
    || !Number.isSafeInteger(minimumSize)
    || minimumSize < 0
    || maximumSize < minimumSize
  ) throw new Error(errorCode);

  const lexicalPath = resolve(path);
  const before = capturePath(lexicalPath, {
    expectedParentModes,
    mustBeInside,
    mustBeOutside,
  });
  let descriptor;
  try {
    descriptor = openSync(
      before.canonicalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const descriptorBefore = fstatSync(descriptor, { bigint: true });
    assertSameIdentity(before.leaf, descriptorBefore);
    assertRegularFile(descriptorBefore, {
      allowedLinkCounts,
      allowedModes,
      expectedOwnerUid,
      maximumSize,
      minimumSize,
    });
    const bytes = readFileSync(descriptor);
    const descriptorAfter = fstatSync(descriptor, { bigint: true });
    assertSameIdentity(descriptorBefore, descriptorAfter);
    if (BigInt(bytes.length) !== descriptorAfter.size) throw new Error(errorCode);

    const after = capturePath(lexicalPath, {
      expectedParentModes,
      mustBeInside,
      mustBeOutside,
    });
    if (before.canonicalPath !== after.canonicalPath) throw new Error(errorCode);
    assertSameIdentity(descriptorAfter, after.leaf);
    assertAncestorSnapshotsEqual(before.ancestors, after.ancestors);
    return Object.freeze({
      path: before.canonicalPath,
      bytes,
      identity: Object.freeze(identityRecord(descriptorAfter)),
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function capturePath(lexicalPath, {
  expectedParentModes,
  mustBeInside,
  mustBeOutside,
}) {
  if (!isAbsolute(lexicalPath)) throw new Error('protected_overlay_path_invalid');
  const lexicalLeaf = lstatSync(lexicalPath, { bigint: true });
  if (lexicalLeaf.isSymbolicLink()) throw new Error('protected_overlay_path_invalid');
  const canonicalPath = realpathSync(lexicalPath);
  const canonicalLeaf = lstatSync(canonicalPath, { bigint: true });
  assertSameIdentity(lexicalLeaf, canonicalLeaf);
  const ancestors = captureAncestors(dirname(canonicalPath));
  if (expectedParentModes !== undefined) {
    const parentMode = permissionMode(ancestors.at(-1).stat);
    if (!expectedParentModes.includes(parentMode)) {
      throw new Error('protected_overlay_path_invalid');
    }
  }
  if (mustBeInside !== undefined) {
    const root = realpathSync(resolve(mustBeInside));
    if (canonicalPath !== root && !isStrictlyInside(canonicalPath, root)) {
      throw new Error('protected_overlay_path_invalid');
    }
  }
  if (mustBeOutside !== undefined) {
    const root = realpathSync(resolve(mustBeOutside));
    if (canonicalPath === root || isStrictlyInside(canonicalPath, root)) {
      throw new Error('protected_overlay_path_invalid');
    }
  }
  return Object.freeze({ ancestors, canonicalPath, leaf: canonicalLeaf });
}

function captureAncestors(canonicalParent) {
  const root = parse(canonicalParent).root;
  const components = relative(root, canonicalParent).split(sep).filter(Boolean);
  const snapshots = [];
  let current = root;
  snapshots.push(captureAncestor(current));
  for (const component of components) {
    current = resolve(current, component);
    snapshots.push(captureAncestor(current));
  }
  return Object.freeze(snapshots);
}

function captureAncestor(path) {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.nlink < 1n) {
    throw new Error('protected_overlay_path_invalid');
  }
  const mode = permissionMode(stat);
  const owner = Number(stat.uid);
  const worldWritable = (mode & 0o002) !== 0;
  const sticky = (Number(stat.mode) & 0o1000) !== 0;
  if (
    CURRENT_UID !== null
    && owner !== 0
    && owner !== CURRENT_UID
  ) throw new Error('protected_overlay_path_invalid');
  if (worldWritable && !(owner === 0 && sticky)) {
    throw new Error('protected_overlay_path_invalid');
  }
  return Object.freeze({ path, stat: Object.freeze(identityRecord(stat)) });
}

function assertRegularFile(stat, {
  allowedLinkCounts,
  allowedModes,
  expectedOwnerUid,
  maximumSize,
  minimumSize,
}) {
  const mode = permissionMode(stat);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || (expectedOwnerUid !== null && Number(stat.uid) !== expectedOwnerUid)
    || !allowedLinkCounts.includes(Number(stat.nlink))
    || (allowedModes !== undefined && !allowedModes.includes(mode))
    || stat.size < BigInt(minimumSize)
    || stat.size > BigInt(maximumSize)
  ) throw new Error('protected_overlay_file_invalid');
}

function assertAncestorSnapshotsEqual(before, after) {
  if (before.length !== after.length) throw new Error('protected_overlay_path_invalid');
  for (let index = 0; index < before.length; index += 1) {
    if (before[index].path !== after[index].path) throw new Error('protected_overlay_path_invalid');
    assertIdentityRecordsEqual(
      before[index].stat,
      after[index].stat,
      ANCESTOR_IDENTITY_FIELDS,
    );
  }
}

function assertSameIdentity(left, right) {
  assertIdentityRecordsEqual(identityRecord(left), identityRecord(right));
}

function assertIdentityRecordsEqual(left, right, fields = STAT_IDENTITY_FIELDS) {
  for (const field of fields) {
    if (left[field] !== right[field]) throw new Error('protected_overlay_path_identity_changed');
  }
}

function identityRecord(stat) {
  return Object.fromEntries(STAT_IDENTITY_FIELDS.map((field) => [field, stat[field]]));
}

function permissionMode(stat) {
  return Number(stat.mode & 0o777n);
}

function isStrictlyInside(path, root) {
  return path !== root && path.startsWith(`${root}${sep}`);
}
