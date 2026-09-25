import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('build 12 archive preserves the original input and signed-artifact authority bytes', () => {
  const history = new URL('../release/app-store/3.0/history/build-12/', import.meta.url);
  const input = readFileSync(new URL('build-input-attestation.json', history));
  const artifact = readFileSync(new URL('build-artifact-attestation.json', history));
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(input), 'f97c87859d9df5ced271121f6d522b44d6375cda745846abfe44d17cd8c19ed0');
  assert.equal(hash(artifact), '3edaa6ebe18f01707cc651e3303d03fca2983d5ca96bcc27d775288b03d29028');
  assert.equal(JSON.parse(input).candidate.buildNumber, '12');
  assert.equal(JSON.parse(artifact).candidate.buildNumber, '12');
  assert.equal(JSON.parse(artifact).easBuildId, '181bb213-b43e-49b0-bfed-bbfc4d99f1d0');
});
