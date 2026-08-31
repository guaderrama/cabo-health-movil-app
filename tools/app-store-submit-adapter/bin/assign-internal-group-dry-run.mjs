#!/usr/bin/env node

import { dirname, resolve } from 'node:path';

import { publicErrorCode, reject } from '../src/errors.mjs';
import { parseCanonicalJson, readBoundFile } from '../src/files.mjs';
import { runInternalGroup } from '../src/internal-group-runner.mjs';
import { FixtureTransport } from '../src/transport.mjs';

try {
  const values = process.argv.slice(2);
  if (values.length < 3 || values[0] !== '--fixture' || resolve(values[1]) !== values[1]) {
    reject('INTERNAL_GROUP_ARGUMENT_INVALID');
  }
  const fixture = parseCanonicalJson(readBoundFile(values[1], {
    privateFile: false, maxBytes: 2 * 1024 * 1024, code: 'INTERNAL_GROUP_INPUT_INVALID',
  }), 'INTERNAL_GROUP_INPUT_INVALID');
  if (fixture?.schemaVersion !== 1
    || fixture.evidenceKind !== 'cabohealth-internal-group-assignment-dry-run-fixture'
    || !Array.isArray(fixture.expectations)
    || new Date(Date.parse(fixture.now)).toISOString() !== fixture.now) {
    reject('INTERNAL_GROUP_INPUT_INVALID');
  }
  const adapterArguments = values.slice(2);
  const outputIndex = adapterArguments.indexOf('--output');
  if (outputIndex < 0 || outputIndex + 1 >= adapterArguments.length) {
    reject('INTERNAL_GROUP_ARGUMENT_INVALID');
  }
  const transport = new FixtureTransport(fixture.expectations);
  await runInternalGroup(adapterArguments, {
    assignment: true,
    transport,
    now: Date.parse(fixture.now),
    sleep: async () => {},
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: dirname(adapterArguments[outputIndex + 1]) },
  });
  transport.assertConsumed();
  process.stdout.write('{"dryRun":true,"status":"evidence-written"}\n');
} catch (error) {
  const code = publicErrorCode(error);
  process.stderr.write(`${code.startsWith('INTERNAL_GROUP_') ? code : 'INTERNAL_GROUP_INTERNAL_ERROR'}\n`);
  process.exitCode = 1;
}
