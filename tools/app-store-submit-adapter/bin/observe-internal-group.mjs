#!/usr/bin/env node

import { publicErrorCode } from '../src/errors.mjs';
import { runInternalGroup } from '../src/internal-group-runner.mjs';

try {
  await runInternalGroup(process.argv.slice(2));
  process.stdout.write('INTERNAL_GROUP_EVIDENCE_WRITTEN\n');
} catch (error) {
  const code = publicErrorCode(error);
  process.stderr.write(`${code.startsWith('INTERNAL_GROUP_') ? code : 'INTERNAL_GROUP_INTERNAL_ERROR'}\n`);
  process.exitCode = 1;
}
