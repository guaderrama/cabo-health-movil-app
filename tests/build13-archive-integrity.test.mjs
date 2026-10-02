import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('build 13 archive preserves the original input and signed-artifact authority bytes', () => {
  const history = new URL('../release/app-store/3.0/history/build-13/', import.meta.url);
  const inputPath = new URL('build-input-attestation.json', history);
  const artifactPath = new URL('build-artifact-attestation.json', history);
  assert.ok(existsSync(inputPath), 'build 13 input authority must be archived');
  assert.ok(existsSync(artifactPath), 'build 13 artifact authority must be archived');
  const input = readFileSync(inputPath);
  const artifact = readFileSync(artifactPath);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(input), 'a3e8d760f63e5216095573549fa95e55c52d4901a0add6c2b2c2e12ead8ca9f2');
  assert.equal(hash(artifact), 'c562c3173d0da66283170676e9c78da6f0145a2b56d0aa7e96d9614a82da90ee');
  assert.equal(JSON.parse(input).candidate.buildNumber, '13');
  assert.equal(JSON.parse(input).sourceCommit, 'e02270ffc6392632a610ab11cef8152f2ff64789');
  assert.equal(JSON.parse(artifact).candidate.buildNumber, '13');
  assert.equal(JSON.parse(artifact).easBuildId, '7970caac-4b8f-4c0e-82f3-ffd5146eb624');
  assert.equal(JSON.parse(artifact).ipaSha256, 'cc602edad62f013232ae80002e5195f8f9692dd1d5032848cd706c28a6d9cc97');
});
