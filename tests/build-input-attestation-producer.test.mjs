import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILD_INPUT_CANDIDATE,
  assembleBuildInputAttestation,
} from '../scripts/create-build-input-attestation.mjs';

const hash = (character) => character.repeat(64);
const sourceCommit = 'a'.repeat(40);
const nodeRuntime = {
  version: 'v22.22.3',
  executableSha256: hash('3'),
};
const easCli = {
  packageVersion: '22.2.0',
  packageJsonRelativePath: 'eas-cli/package.json',
  entryRelativePath: 'eas-cli/bin/run',
  runtimeRootRelativePath: 'node_modules',
  runtimeTreeSha256: hash('4'),
};
const easEnvironment = {
  schemaVersion: 1,
  evidenceKind: 'cabohealth-eas-environment-inventory',
  environmentName: 'production',
  profileVariables: [
    { name: 'APP_ENV', source: 'eas-profile', kind: 'plain' },
  ],
  projectVariables: [
    {
      name: 'CABOHEALTH_FIREBASE_PROJECT_ID',
      source: 'eas-project-environment',
      kind: 'sensitive',
    },
    {
      name: 'CABOHEALTH_GOOGLE_SERVICES_PLIST',
      source: 'eas-project-environment',
      kind: 'secret-file',
    },
  ],
  extras: [],
  valuesIncluded: false,
  providerValuesRetained: false,
};

test('build-input producer assembles the exact canonical build 10 authority with inventory digest', () => {
  const value = assembleBuildInputAttestation({
    reviewedAt: '2026-08-26T07:00:00.000Z',
    sourceCommit,
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
    nodeRuntime,
    easCli,
    easEnvironmentInventorySha256: hash('5'),
    easEnvironment,
  });

  assert.deepEqual(value.candidate, BUILD_INPUT_CANDIDATE);
  assert.equal(value.candidate.buildNumber, '10');
  assert.equal(value.firebaseProjectId, 'cabohealth-owner-prod');
  assert.equal(`${JSON.stringify(value)}\n`.endsWith('\n'), true);
  assert.deepEqual(Object.keys(value), [
    'schemaVersion',
    'artifactKind',
    'candidate',
    'sourceCommit',
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
    'nodeRuntime',
    'easCli',
    'easEnvironmentInventorySha256',
    'easEnvironment',
    'reviewedAt',
  ]);
});

test('build-input producer rejects a stale candidate, malformed hash, or ambiguous file set', () => {
  const base = {
    reviewedAt: '2026-08-26T07:00:00.000Z',
    sourceCommit,
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
    nodeRuntime,
    easCli,
    easEnvironmentInventorySha256: hash('5'),
    easEnvironment,
  };

  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    candidate: { ...BUILD_INPUT_CANDIDATE, buildNumber: '7' },
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    sourceTreeSha256: 'not-a-hash',
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    nodeRuntime: { ...nodeRuntime, version: 'v20.0.0' },
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    easEnvironment: {
      ...easEnvironment,
      projectVariables: easEnvironment.projectVariables.filter(
        (variable) => variable.name !== 'CABOHEALTH_GOOGLE_SERVICES_PLIST',
      ),
    },
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
  assert.throws(() => assembleBuildInputAttestation({
    ...base,
    reviewedFileSha256: { ...base.reviewedFileSha256, extra: hash('3') },
  }), /BUILD_INPUT_PRODUCER_ARGUMENT_INVALID/u);
});
