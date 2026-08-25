#!/usr/bin/env node

import { runAdapter } from '../src/index.mjs';
import { publicErrorCode } from '../src/errors.mjs';

try {
  const result = await runAdapter(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${publicErrorCode(error)}\n`);
  process.exitCode = 1;
}
