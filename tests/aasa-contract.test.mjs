import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const generator = join(root, 'scripts', 'generate-aasa.mjs');
const verifier = join(root, 'scripts', 'verify-aasa.mjs');
const expectedBytes = `${JSON.stringify({
  applinks: {
    details: [{
      appIDs: ['DQ8PH2DZ3R.com.cabohealth.app'],
      components: [
        { '/': '/apps/healthy-recipes/' },
        { '/': '/apps/clinic-guide/' },
      ],
    }],
  },
}, null, 2)}\n`;

function run(script, file) {
  return spawnSync(process.execPath, [script, file], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('generator derives the exact App ID and canonical root-only components deterministically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cabohealth-aasa-generate-'));
  const output = join(directory, 'apple-app-site-association');

  const first = run(generator, output);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(output, 'utf8'), expectedBytes);

  const second = run(generator, output);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(output, 'utf8'), expectedBytes);
});

test('verifier accepts only canonical bytes and exact Expo domain arrays', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cabohealth-aasa-verify-'));
  const output = join(directory, 'apple-app-site-association');
  writeFileSync(output, expectedBytes);

  const result = run(verifier, output);
  assert.equal(result.status, 0, result.stderr);
});

test('verifier rejects duplicate keys, BOM, trailing content, extras, wildcards, and a wrong App ID', () => {
  const duplicate = expectedBytes.replace(
    '"applinks": {',
    '"applinks": {},\n  "applinks": {',
  );
  const mutations = [
    `\uFEFF${expectedBytes}`,
    `${expectedBytes}trailing`,
    duplicate,
    expectedBytes.replace('{\n  "applinks"', '{\n  "extra": true,\n  "applinks"'),
    expectedBytes.replace('"appIDs": [', '"extra": true,\n        "appIDs": ['),
    expectedBytes.replace('DQ8PH2DZ3R.com.cabohealth.app', 'WRONG.com.cabohealth.app'),
    expectedBytes.replace('/apps/healthy-recipes/', '/apps/healthy-recipes/*'),
    expectedBytes.replace(
      '          {\n            "/": "/apps/clinic-guide/"\n          }',
      '          {\n            "/": "/apps/clinic-guide/"\n          },\n          {\n            "/": "/apps/third/"\n          }',
    ),
  ];

  const directory = mkdtempSync(join(tmpdir(), 'cabohealth-aasa-mutations-'));
  mutations.forEach((bytes, index) => {
    const output = join(directory, `aasa-${index}`);
    writeFileSync(output, bytes);
    const result = run(verifier, output);
    assert.notEqual(result.status, 0, `mutation ${index} unexpectedly passed`);
  });
});
