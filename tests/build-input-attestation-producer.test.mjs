import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILD_INPUT_CANDIDATE,
  assembleBuildInputAttestation,
} from '../scripts/create-build-input-attestation.mjs';

const hash = (character) => character.repeat(64);

test('build-input producer assembles the exact canonical build 5 authority', () => {
  const value = assembleBuildInputAttestation({
    reviewedAt: '2026-08-26T07:00:00.000Z',
    sourceTreeSha256: hash('a'),
    reviewedFileSha256: {
      appJsonSha256: hash('b'),
      configSha256: hash('c'),
      packageLockSha256: hash('d'),
      releaseManifestSha256: hash('e'),
      releaseVerifierSha256: hash('f'),
      metadataVerifierSha256: hash('0'),
    },
    googleServicesPlistSha256: hash('1'),
    resolvedProductionExpoConfigSha256: hash('2'),
  });

  assert.deepEqual(value.candidate, BUILD_INPUT_CANDIDATE);
  assert.equal(value.candidate.buildNumber, '5');
  assert.equal(value.firebaseProjectId, 'cabohealth-owner-prod');
  assert.equal(`${JSON.stringify(value)}\n`.endsWith('\n'), true);
  assert.deepEqual(Object.keys(value), [
    'schemaVersion',
    'artifactKind',
    'candidate',
    'sourceTreeSha256',
    'appJsonSha256',
    'configSha256',
    'packageLockSha256',
    'releaseManifestSha256',
    'releaseVerifierSha256',
    'metadataVerifierSha256',
    'firebaseProjectId',
    'googleServicesPlistSha256',
    'resolvedProductionExpoConfigSha256',
    'reviewedAt',
  ]);
});

test('build-input producer rejects a stale candidate, malformed hash, or ambiguous file set', () => {
  const base = {
    reviewedAt: '2026-08-26T07:00:00.000Z',
    sourceTreeSha256: hash('a'),
    reviewedFileSha256: {
      appJsonSha256: hash('b'),
      configSha256: hash('c'),
      packageLockSha256: hash('d'),
      releaseManifestSha256: hash('e'),
      releaseVerifierSha256: hash('f'),
      metadataVerifierSha256: hash('0'),
    },
    googleServicesPlistSha256: hash('1'),
    resolvedProductionExpoConfigSha256: hash('2'),
  };

  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    candidate: { ...BUILD_INPUT_CANDIDATE, buildNumber: '4' },
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    sourceTreeSha256: 'not-a-hash',
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    reviewedFileSha256: { ...base.reviewedFileSha256, extra: hash('3') },
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
});
