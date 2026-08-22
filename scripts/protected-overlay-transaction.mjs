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
import { dirname, relative, resolve, sep } from 'node:path';

import {
  inspectDescriptorBoundDirectory,
  readDescriptorBoundFile,
} from './protected-overlay-secure-fs.mjs';

const LOCK_NAME = 'transaction.lock';
const LOCK_KIND = 'cabohealth-protected-overlay-lock-v1';
const JOURNAL_KIND = 'cabohealth-protected-overlay-transaction-v1';
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

export function executeDurableMoveTransaction({
  afterState,
  beforeState,
  managedRoot,
  moves,
  operation,
  readState,
  root,
  token,
  validateState,
  verifyLive,
  writeState,
}) {
  const context = validateMoveTransactionContext({
    afterState,
    beforeState,
    managedRoot,
    moves,
    operation,
    readState,
    root,
    token,
    validateState,
    verifyLive,
    writeState,
  });
  const journalPath = resolve(context.managedRoot, 'transaction.json');
  if (readDurableCanonicalRecord(journalPath, {
    errorCode: 'protected_overlay_transaction_journal_invalid',
    mode: 0o600,
  }) !== null) throw new Error('protected_overlay_transaction_journal_exists');
  assertMovePlanTopology(context.root, context.moves);
  let journal = Object.freeze({
    schemaVersion: 1,
    journalKind: JOURNAL_KIND,
    operation,
    transactionId: token,
    phase: 'prepared',
    appliedCount: 0,
    beforeState,
    afterState,
    moves: context.moves,
  });
  writeTransactionJournal(journalPath, journal);
  transactionCheckpoint('journal-prepared');

  try {
    for (let index = 0; index < context.moves.length; index += 1) {
      const move = resolveMove(context.root, context.moves[index]);
      if (!existsSync(move.source) || existsSync(move.destination)) {
        throw new Error('protected_overlay_transaction_topology_invalid');
      }
      durableRename(
        move.source,
        move.destination,
        'protected_overlay_transaction_move_failed',
      );
      journal = Object.freeze({
        ...journal,
        phase: 'applying',
        appliedCount: index + 1,
      });
      writeTransactionJournal(journalPath, journal);
      transactionCheckpoint(`move-${index + 1}`);
    }
    if (!verifyLive(afterState)) throw new Error('protected_overlay_transaction_live_invalid');
    writeState(afterState);
    if (!statesEqual(readState(), afterState)) {
      throw new Error('protected_overlay_transaction_state_invalid');
    }
    journal = Object.freeze({
      ...journal,
      phase: 'state-committed',
      appliedCount: context.moves.length,
    });
    writeTransactionJournal(journalPath, journal);
    transactionCheckpoint('state-committed');
    if (!verifyLive(afterState)) throw new Error('protected_overlay_transaction_live_invalid');
    clearTransactionJournal(journalPath);
    transactionCheckpoint('journal-cleared');
    return Object.freeze({ status: 'committed', operation });
  } catch (error) {
    try {
      recoverDurableMoveTransaction(context);
    } catch {
      throw new Error('protected_overlay_transaction_recovery_failed');
    }
    throw error;
  }
}

export function recoverDurableMoveTransaction({
  managedRoot,
  readState,
  root,
  validateState,
  verifyLive,
  writeState,
}) {
  const context = validateMoveTransactionContext({
    afterState: null,
    beforeState: null,
    managedRoot,
    moves: [],
    operation: 'recover',
    readState,
    root,
    token: '0'.repeat(32),
    validateState,
    verifyLive,
    writeState,
  }, { allowPlaceholderPlan: true });
  const journalPath = resolve(context.managedRoot, 'transaction.json');
  removeOwnedFileIfPresent(
    `${journalPath}.candidate`,
    0o600,
    'protected_overlay_transaction_journal_invalid',
  );
  const journal = readDurableCanonicalRecord(journalPath, {
    errorCode: 'protected_overlay_transaction_journal_invalid',
    mode: 0o600,
  });
  if (journal === null) return Object.freeze({ status: 'clean' });
  validateTransactionJournal(journal, context.root, validateState);

  const currentState = readState();
  if (!validateState(currentState)) {
    throw new Error('protected_overlay_transaction_state_invalid');
  }
  const appliedCount = inferAppliedMoveCount(
    context.root,
    journal.moves,
    journal.appliedCount,
  );
  if (
    statesEqual(currentState, journal.afterState)
    && appliedCount === journal.moves.length
    && verifyLive(journal.afterState)
  ) {
    clearTransactionJournal(journalPath);
    return Object.freeze({ status: 'recovered-committed', operation: journal.operation });
  }
  if (
    !statesEqual(currentState, journal.beforeState)
    && !statesEqual(currentState, journal.afterState)
  ) throw new Error('protected_overlay_transaction_state_invalid');

  reverseMovePlan(
    context.root,
    journal.moves,
    appliedCount,
  );
  if (!statesEqual(currentState, journal.beforeState)) writeState(journal.beforeState);
  if (
    !statesEqual(readState(), journal.beforeState)
    || !verifyLive(journal.beforeState)
  ) throw new Error('protected_overlay_transaction_recovery_failed');
  clearTransactionJournal(journalPath);
  return Object.freeze({ status: 'recovered-rolled-back', operation: journal.operation });
}

export function transactionCheckpoint(step) {
  if (
    process.env.NODE_ENV === 'test'
    && process.env.CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP === step
  ) process.kill(process.pid, 'SIGKILL');
  if (
    process.env.NODE_ENV === 'test'
    && process.env.CABOHEALTH_OVERLAY_TEST_PAUSE_AFTER_STEP === step
  ) {
    const readyPath = process.env.CABOHEALTH_OVERLAY_TEST_PAUSE_READY_PATH;
    const resumePath = process.env.CABOHEALTH_OVERLAY_TEST_PAUSE_RESUME_PATH;
    if (typeof readyPath !== 'string' || typeof resumePath !== 'string') {
      throw new Error('protected_overlay_test_checkpoint_invalid');
    }
    writeDurableExclusiveFile(
      readyPath,
      `${step}\n`,
      0o600,
      'protected_overlay_test_checkpoint_invalid',
    );
    const waiter = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      if (existsSync(resumePath)) {
        const resume = readDescriptorBoundFile(resumePath, {
          allowedModes: [0o600],
          errorCode: 'protected_overlay_test_checkpoint_invalid',
          expectedParentModes: [0o700, 0o755],
          maximumSize: 7,
          minimumSize: 7,
        });
        if (resume.bytes.toString('utf8') !== 'resume\n') {
          throw new Error('protected_overlay_test_checkpoint_invalid');
        }
        break;
      }
      Atomics.wait(waiter, 0, 0, 10);
    }
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

function validateMoveTransactionContext(input, { allowPlaceholderPlan = false } = {}) {
  if (
    typeof input.root !== 'string'
    || typeof input.managedRoot !== 'string'
    || typeof input.readState !== 'function'
    || typeof input.writeState !== 'function'
    || typeof input.validateState !== 'function'
    || typeof input.verifyLive !== 'function'
  ) throw new Error('protected_overlay_transaction_invalid');
  const root = inspectDescriptorBoundDirectory(input.root, {
    allowedModes: [0o700, 0o755],
    errorCode: 'protected_overlay_transaction_root_invalid',
  }).path;
  const managedRoot = inspectDescriptorBoundDirectory(input.managedRoot, {
    allowedModes: [0o700],
    errorCode: 'protected_overlay_transaction_root_invalid',
    mustBeInside: root,
  }).path;
  if (!allowPlaceholderPlan) {
    if (
      !['promote', 'rollback'].includes(input.operation)
      || typeof input.token !== 'string'
      || !TOKEN_PATTERN.test(input.token)
      || !input.validateState(input.beforeState)
      || !input.validateState(input.afterState)
      || statesEqual(input.beforeState, input.afterState)
    ) throw new Error('protected_overlay_transaction_invalid');
    validateMovePlan(input.moves, root);
  }
  return Object.freeze({ ...input, managedRoot, root });
}

function validateTransactionJournal(journal, root, validateState) {
  if (
    journal === null
    || typeof journal !== 'object'
    || Array.isArray(journal)
    || JSON.stringify(Object.keys(journal).sort()) !== JSON.stringify([
      'afterState',
      'appliedCount',
      'beforeState',
      'journalKind',
      'moves',
      'operation',
      'phase',
      'schemaVersion',
      'transactionId',
    ])
    || journal.schemaVersion !== 1
    || journal.journalKind !== JOURNAL_KIND
    || !['promote', 'rollback'].includes(journal.operation)
    || typeof journal.transactionId !== 'string'
    || !TOKEN_PATTERN.test(journal.transactionId)
    || !['prepared', 'applying', 'state-committed'].includes(journal.phase)
    || !Number.isSafeInteger(journal.appliedCount)
    || !validateState(journal.beforeState)
    || !validateState(journal.afterState)
    || statesEqual(journal.beforeState, journal.afterState)
  ) throw new Error('protected_overlay_transaction_journal_invalid');
  validateMovePlan(journal.moves, root);
  if (
    journal.appliedCount < 0
    || journal.appliedCount > journal.moves.length
    || (journal.phase === 'prepared' && journal.appliedCount !== 0)
    || (journal.phase === 'state-committed' && journal.appliedCount !== journal.moves.length)
  ) throw new Error('protected_overlay_transaction_journal_invalid');
}

function validateMovePlan(moves, root) {
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > 32) {
    throw new Error('protected_overlay_transaction_invalid');
  }
  for (const move of moves) {
    if (
      move === null
      || typeof move !== 'object'
      || Array.isArray(move)
      || JSON.stringify(Object.keys(move).sort())
        !== JSON.stringify(['destination', 'source'])
    ) throw new Error('protected_overlay_transaction_invalid');
    resolveMove(root, move);
  }
}

function resolveMove(root, move) {
  const source = resolveTransactionPath(root, move.source);
  const destination = resolveTransactionPath(root, move.destination);
  if (source === destination) throw new Error('protected_overlay_transaction_invalid');
  return Object.freeze({ destination, source });
}

function resolveTransactionPath(root, value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\\')
    || value.startsWith('/')
    || value.split('/').some((component) => component === '' || component === '.' || component === '..')
  ) throw new Error('protected_overlay_transaction_invalid');
  const absolute = resolve(root, ...value.split('/'));
  if (
    absolute === root
    || !absolute.startsWith(`${root}${sep}`)
    || relative(root, absolute).split(sep).join('/') !== value
  ) throw new Error('protected_overlay_transaction_invalid');
  return absolute;
}

function assertMovePlanTopology(root, moves) {
  const occupied = new Map();
  const pathExists = (path) => {
    if (!occupied.has(path)) occupied.set(path, existsSync(path));
    return occupied.get(path);
  };
  for (const rawMove of moves) {
    const move = resolveMove(root, rawMove);
    if (!pathExists(move.source) || pathExists(move.destination)) {
      throw new Error('protected_overlay_transaction_topology_invalid');
    }
    occupied.set(move.source, false);
    occupied.set(move.destination, true);
  }
}

function reverseMovePlan(root, moves, appliedCount) {
  for (let index = appliedCount - 1; index >= 0; index -= 1) {
    const move = resolveMove(root, moves[index]);
    const sourceExists = existsSync(move.source);
    const destinationExists = existsSync(move.destination);
    if (destinationExists && !sourceExists) {
      durableRename(
        move.destination,
        move.source,
        'protected_overlay_transaction_recovery_failed',
      );
      transactionCheckpoint(`recovery-move-${index + 1}`);
    } else if (!(sourceExists && !destinationExists)) {
      throw new Error('protected_overlay_transaction_recovery_failed');
    }
  }
}

function inferAppliedMoveCount(root, moves, recordedCount) {
  const initial = inferInitialMoveTopology(root, moves);
  const candidates = [];
  for (
    let appliedCount = 0;
    appliedCount <= Math.min(recordedCount + 1, moves.length);
    appliedCount += 1
  ) {
    const expected = new Map(initial);
    for (let index = 0; index < appliedCount; index += 1) {
      const move = resolveMove(root, moves[index]);
      expected.set(move.source, false);
      expected.set(move.destination, true);
    }
    if ([...expected].every(([path, shouldExist]) => existsSync(path) === shouldExist)) {
      candidates.push(appliedCount);
    }
  }
  if (candidates.length !== 1) throw new Error('protected_overlay_transaction_recovery_failed');
  return candidates[0];
}

function inferInitialMoveTopology(root, moves) {
  const initial = new Map();
  const current = new Map();
  for (const rawMove of moves) {
    const move = resolveMove(root, rawMove);
    if (!current.has(move.source)) {
      current.set(move.source, true);
      initial.set(move.source, true);
    }
    if (!current.has(move.destination)) {
      current.set(move.destination, false);
      initial.set(move.destination, false);
    }
    if (!current.get(move.source) || current.get(move.destination)) {
      throw new Error('protected_overlay_transaction_invalid');
    }
    current.set(move.source, false);
    current.set(move.destination, true);
  }
  return initial;
}

function writeTransactionJournal(path, journal) {
  writeDurableCanonicalRecord(path, journal, {
    errorCode: 'protected_overlay_transaction_journal_invalid',
    mode: 0o600,
  });
}

function clearTransactionJournal(path) {
  clearDurableCanonicalRecord(path, {
    errorCode: 'protected_overlay_transaction_journal_invalid',
    mode: 0o600,
  });
}

function statesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
