import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parsePepperRingSecret,
  VersionedHmac,
} from '../../security/versionedHmac.js';

test('access-code lookups are current-first, versioned HMAC digests without plaintext', () => {
  const hmac = VersionedHmac.fromTestKeys({
    currentVersion: '2026-08',
    keys: {
      '2026-08': 'test-only-current-pepper-with-at-least-32-bytes',
      '2026-05': 'test-only-previous-pepper-with-at-least-32-bytes',
    },
  });

  const candidates = hmac.lookupCandidates('CH-00112233-44556677-8899AABB-CCDDEEFF');

  assert.deepEqual(candidates.map(({ version }) => version), ['2026-08', '2026-05']);
  assert.match(candidates[0]!.lookupId, /^2026-08_[A-Za-z0-9_-]{43}$/u);
  assert.equal(JSON.stringify(candidates).includes('00112233'), false);
  assert.deepEqual(candidates[0], hmac.currentDigest('CH-00112233-44556677-8899AABB-CCDDEEFF'));
});

test('a Secret Manager payload exposes only a validated versioned key ring', () => {
  const ring = parsePepperRingSecret(JSON.stringify({
    currentVersion: '2026-08',
    keys: {
      '2026-08': Buffer.alloc(32, 1).toString('base64'),
      '2026-05': Buffer.alloc(32, 2).toString('base64'),
    },
  }));

  assert.deepEqual(ring.acceptedVersions(), ['2026-08', '2026-05']);
  assert.throws(
    () => parsePepperRingSecret('{"currentVersion":"missing","keys":{}}'),
    /invalid_pepper_secret/u,
  );
});
