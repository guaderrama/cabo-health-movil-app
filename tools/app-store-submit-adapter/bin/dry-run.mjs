#!/usr/bin/env node

import { resolve } from 'node:path';
import { readBoundFile, parseCanonicalJson } from '../src/files.mjs';
import { FixtureTransport } from '../src/transport.mjs';
import { runAdapter } from '../src/index.mjs';
import { publicErrorCode, reject } from '../src/errors.mjs';

function readFixture(argv) {
  if (argv.length < 2 || argv[0] !== '--fixture'
    || resolve(argv[1]) !== argv[1]) reject('DRY_RUN_FIXTURE_ARGUMENT_INVALID');
  const fixture = parseCanonicalJson(readBoundFile(argv[1], {
    privateFile: false,
    maxBytes: 2 * 1024 * 1024,
    code: 'DRY_RUN_FIXTURE_FILE_INVALID',
  }), 'DRY_RUN_FIXTURE_INVALID', { sortKeys: true });
  if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)
    || JSON.stringify(Object.keys(fixture).sort())
      !== JSON.stringify(['artifactKind', 'expectations', 'now', 'schemaVersion'].sort())
    || fixture.schemaVersion !== 1
    || fixture.artifactKind !== 'cabohealth-app-store-submit-dry-run-fixture'
    || typeof fixture.now !== 'string'
    || new Date(Date.parse(fixture.now)).toISOString() !== fixture.now
    || !Array.isArray(fixture.expectations)) reject('DRY_RUN_FIXTURE_INVALID');
  return { fixture, adapterArguments: argv.slice(2) };
}

try {
  const { fixture, adapterArguments } = readFixture(process.argv.slice(2));
  const transport = new FixtureTransport(fixture.expectations);
  const result = await runAdapter(adapterArguments, {
    transport,
    now: Date.parse(fixture.now),
    sleep: async () => {},
    environment: Object.create(null),
  });
  transport.assertConsumed();
  process.stdout.write(`${JSON.stringify({ dryRun: true, result })}\n`);
} catch (error) {
  process.stderr.write(`${publicErrorCode(error)}\n`);
  process.exitCode = 1;
}
