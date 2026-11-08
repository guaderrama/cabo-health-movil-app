import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the rejected build 14 remains byte-identical historical evidence, not build 15 authority', () => {
  const root = new URL('../release/app-store/3.0/history/build-14/', import.meta.url);
  const record = JSON.parse(readFileSync(new URL('manifest.json', root)));
  assert.equal(record.candidate.buildNumber, '14');
  assert.equal(record.status, 'app-review-rejected-2.1a-superseded-for-launch-recovery');
  for (const [name, expected] of [
    ['build-input-attestation.json', '8cbfe18960023c5242161ead7991adf5e65a96e9524f5401349c9195a3ac731f'],
    ['build-artifact-attestation.json', 'fd0b36028e0ee8f4e0f3d2ddc0c21224c6e3f6c8b763f14858b4bc7561147be9'],
  ]) {
    const bytes = readFileSync(new URL(name, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    assert.equal(JSON.parse(bytes).candidate.buildNumber, '14');
  }
  assert.equal(record.supersession.appleIncidentRootCauseConfirmed, false);
});
