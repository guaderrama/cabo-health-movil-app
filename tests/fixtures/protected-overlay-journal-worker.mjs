import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clearDurableCanonicalRecord,
  executeDurableMoveTransaction,
  readDurableCanonicalRecord,
  recoverDurableMoveTransaction,
  withExclusiveOverlayLock,
  writeDurableCanonicalRecord,
} from '../../scripts/protected-overlay-transaction.mjs';

const [command, root] = process.argv.slice(2);
const managedRoot = join(root, 'managed');
const statePath = join(root, 'state.json');
const startsAbsent = process.env.CABOHEALTH_TEST_STARTS_ABSENT === '1';
const crossDirectory = process.env.CABOHEALTH_TEST_CROSS_DIRECTORY === '1';
const beforeState = startsAbsent ? null : Object.freeze({ release: 'A' });
const afterState = Object.freeze({ release: 'B' });
const locations = crossDirectory
  ? Object.freeze({ backup: 'archive/backup', candidate: 'stage/candidate', live: 'public/live' })
  : Object.freeze({ backup: 'backup', candidate: 'candidate', live: 'live' });
const moves = startsAbsent
  ? Object.freeze([Object.freeze({
    source: locations.candidate,
    destination: locations.live,
  })])
  : Object.freeze([
    Object.freeze({ source: locations.live, destination: locations.backup }),
    Object.freeze({ source: locations.candidate, destination: locations.live }),
  ]);

const callbacks = {
  readState() {
    return readDurableCanonicalRecord(statePath, {
      errorCode: 'test_state_invalid',
      mode: 0o600,
    });
  },
  writeState(state) {
    if (state === null) {
      clearDurableCanonicalRecord(statePath, {
        errorCode: 'test_state_invalid',
        mode: 0o600,
      });
      return;
    }
    writeDurableCanonicalRecord(statePath, state, {
      errorCode: 'test_state_invalid',
      mode: 0o600,
    });
  },
  validateState(state) {
    return state === null || state?.release === 'A' || state?.release === 'B';
  },
  verifyLive(state) {
    if (state === null) return !existsSync(locationPath('live'));
    return readFileSync(locationPath('live', 'release.txt'), 'utf8') === `${state.release}\n`;
  },
  verifyTopology(_journal, appliedCount) {
    try {
      if (startsAbsent) {
        if (appliedCount === 0) {
          return readRelease('candidate') === 'B' && !existsSync(locationPath('live'));
        }
        return appliedCount === 1
          && !existsSync(locationPath('candidate'))
          && readRelease('live') === 'B';
      }
      if (appliedCount === 0) {
        return readRelease('live') === 'A'
          && readRelease('candidate') === 'B'
          && !existsSync(locationPath('backup'));
      }
      if (appliedCount === 1) {
        return !existsSync(locationPath('live'))
          && readRelease('backup') === 'A'
          && readRelease('candidate') === 'B';
      }
      return appliedCount === 2
        && readRelease('live') === 'B'
        && readRelease('backup') === 'A'
        && !existsSync(locationPath('candidate'));
    } catch {
      return false;
    }
  },
};

const result = withExclusiveOverlayLock(managedRoot, ({ token }) => {
  const recovered = recoverDurableMoveTransaction({
    ...callbacks,
    managedRoot,
    root,
    token,
  });
  if (command === 'recover') return recovered;
  if (command !== 'execute') throw new Error('test_command_invalid');
  return executeDurableMoveTransaction({
    ...callbacks,
    afterState,
    beforeState,
    managedRoot,
    moves,
    operation: 'promote',
    root,
    token,
  });
});

process.stdout.write(`${JSON.stringify(result)}\n`);

function readRelease(directory) {
  return readFileSync(locationPath(directory, 'release.txt'), 'utf8').trim();
}

function locationPath(name, ...components) {
  return join(root, ...locations[name].split('/'), ...components);
}
