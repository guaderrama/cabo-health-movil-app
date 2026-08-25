import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runAdapter, FixtureTransport } from '../src/index.mjs';
import {
  createEvidenceFixture,
  NOW,
  successfulNewSubmissionExpectations,
  writeJson,
} from './helpers.mjs';

const adapterRoot = fileURLToPath(new URL('..', import.meta.url));

test('runAdapter accepts an injected fixture transport without loading credentials', async () => {
  const fixture = createEvidenceFixture();
  const transport = new FixtureTransport(successfulNewSubmissionExpectations());
  const result = await runAdapter(fixture.args, {
    transport,
    environment: { APP_STORE_CONNECT_PRIVATE_KEY: 'must-not-be-read' },
    now: NOW,
    sleep: async () => {},
  });
  transport.assertConsumed();
  assert.equal(result.status, 'submitted');
});

test('dry-run CLI consumes a canonical deterministic fixture and performs no authentication', () => {
  const evidence = createEvidenceFixture();
  const fixturePath = join(evidence.root, 'dry-run-fixture.json');
  writeJson(fixturePath, {
    schemaVersion: 1,
    artifactKind: 'cabohealth-app-store-submit-dry-run-fixture',
    now: new Date(NOW).toISOString(),
    expectations: successfulNewSubmissionExpectations(),
  }, 0o644, true);
  const execution = spawnSync(process.execPath, [
    join(adapterRoot, 'bin', 'dry-run.mjs'),
    '--fixture', fixturePath,
    ...evidence.args,
  ], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      APP_STORE_CONNECT_PRIVATE_KEY: 'forbidden-if-read',
    },
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, '');
  const output = JSON.parse(execution.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.result.status, 'submitted');
});

test('dry-run fails closed when a fixture request is missing and does not print arguments', () => {
  const evidence = createEvidenceFixture();
  const fixturePath = join(evidence.root, 'short-fixture.json');
  writeJson(fixturePath, {
    schemaVersion: 1,
    artifactKind: 'cabohealth-app-store-submit-dry-run-fixture',
    now: new Date(NOW).toISOString(),
    expectations: successfulNewSubmissionExpectations().slice(0, 1),
  }, 0o644, true);
  chmodSync(fixturePath, 0o644);
  const execution = spawnSync(process.execPath, [
    join(adapterRoot, 'bin', 'dry-run.mjs'),
    '--fixture', fixturePath,
    ...evidence.args,
  ], { encoding: 'utf8' });
  assert.equal(execution.status, 1);
  assert.equal(execution.stderr, 'DRY_RUN_FIXTURE_MISMATCH\n');
  assert.doesNotMatch(execution.stderr, /physical-iphone|authorization|987654321/u);
});
