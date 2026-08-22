import { existsSync, writeFileSync } from 'node:fs';

import {
  withExclusiveOverlayLock,
} from '../../scripts/protected-overlay-transaction.mjs';

const [managedRoot, readyPath = '', resumePath = ''] = process.argv.slice(2);

const result = withExclusiveOverlayLock(managedRoot, () => {
  if (process.env.CABOHEALTH_TEST_CRASH_LOCK === '1') {
    process.kill(process.pid, 'SIGKILL');
  }
  if (readyPath !== '') writeFileSync(readyPath, 'ready\n', { flag: 'wx', mode: 0o600 });
  if (resumePath !== '') {
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(resumePath)) Atomics.wait(sleeper, 0, 0, 10);
  }
  return { status: 'locked' };
});

process.stdout.write(`${JSON.stringify(result)}\n`);
