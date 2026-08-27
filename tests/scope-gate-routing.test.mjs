import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runPackageScript(name) {
  return spawnSync(npmExecutable, ['run', name, '--silent'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}

test('the canonical scope gate verifies the complete RC v3 package', () => {
  const result = runPackageScript('test:scope');
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Release 3\.0\/build 6 verified: pre-build-configured\./u);
  assert.match(output, /App Store pre-build metadata verified; submission remains blocked\./u);
});

test('the minimal v1 auditor remains available under an explicitly historical name', () => {
  const result = runPackageScript('audit:scope:historical-v1');
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1, 'the historical v1 boundary must reject the current v3 scope');
  assert.match(output, /Legacy access-code, biometry, Firebase, or Firestore import is reachable/u);
  assert.match(output, /Unapproved miniapp slug in release metadata: client-resources/u);
  assert.doesNotMatch(output, /Missing script/u);
});
