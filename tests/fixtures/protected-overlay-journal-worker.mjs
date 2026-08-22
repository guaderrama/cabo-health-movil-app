import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  executeDurableMoveTransaction,
  readDurableCanonicalRecord,
  recoverDurableMoveTransaction,
  withExclusiveOverlayLock,
  writeDurableCanonicalRecord,
} from '../../scripts/protected-overlay-transaction.mjs';

const [command, root] = process.argv.slice(2);
const managedRoot = join(root, 'managed');
const statePath = join(root, 'state.json');
const beforeState = Object.freeze({ release: 'A' });
const afterState = Object.freeze({ release: 'B' });
const moves = Object.freeze([
  Object.freeze({ source: 'live', destination: 'backup' }),
  Object.freeze({ source: 'candidate', destination: 'live' }),
]);

const callbacks = {
  readState() {
    return readDurableCanonicalRecord(statePath, {
      errorCode: 'test_state_invalid',
      mode: 0o600,
    });
  },
  writeState(state) {
    writeDurableCanonicalRecord(statePath, state, {
      errorCode: 'test_state_invalid',
      mode: 0o600,
    });
  },
  validateState(state) {
    return state === null || state?.release === 'A' || state?.release === 'B';
  },
  verifyLive(state) {
    if (state === null) return !existsSync(join(root, 'live'));
    return readFileSync(join(root, 'live/release.txt'), 'utf8') === `${state.release}\n`;
  },
};

const result = withExclusiveOverlayLock(managedRoot, ({ token }) => {
  const recovered = recoverDurableMoveTransaction({
    ...callbacks,
    managedRoot,
    root,
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
