import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BUILD_INPUT_CANDIDATE,
  assembleBuildInputAttestation,
  createBuildInputAttestation,
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

function canonicalGoogleServicesPlist() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<key>PROJECT_ID</key><string>cabohealth-owner-prod</string>',
    '<key>BUNDLE_ID</key><string>com.cabohealth.app</string>',
    '</dict></plist>',
    '',
  ].join('\n');
}

function writeOwnedCanonicalInventory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  const inventoryPath = join(path, 'eas-environment.json');
  writeFileSync(inventoryPath, `${JSON.stringify(easEnvironment)}\n`, { mode: 0o600 });
  chmodSync(inventoryPath, 0o600);
  return inventoryPath;
}

test('build-input producer assembles the exact canonical build 14 authority with inventory digest', () => {
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
  assert.equal(value.candidate.buildNumber, '14');
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

test('build-input producer accepts only the current task-2 inventory parent', (context) => {
  const projectRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-build-input-producer-')));
  chmodSync(temporaryRoot, 0o700);
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

  const currentEvidenceParent = join(
    temporaryRoot,
    '.superpowers/sdd/2026-10-01-cabohealth-apple-readiness/task-2-evidence',
  );
  const obsoleteEvidenceParent = join(
    temporaryRoot,
    '.superpowers/sdd/2026-08-31-cabohealth-build10-testflight-release/task-2-evidence',
  );
  const currentInventoryPath = writeOwnedCanonicalInventory(currentEvidenceParent);
  const obsoleteInventoryPath = writeOwnedCanonicalInventory(obsoleteEvidenceParent);
  const plistPath = join(temporaryRoot, 'GoogleService-Info.plist');
  writeFileSync(plistPath, canonicalGoogleServicesPlist(), { mode: 0o600 });
  chmodSync(plistPath, 0o600);
  const environment = {
    CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-owner-prod',
    CABOHEALTH_GOOGLE_SERVICES_PLIST: plistPath,
  };

  const currentOutputPath = join(currentEvidenceParent, 'build-input-candidate.json');
  const current = createBuildInputAttestation({
    root: projectRoot,
    reviewedAt: '2026-09-03T00:00:00.000Z',
    sourceCommit,
    easEnvironmentInventoryPath: currentInventoryPath,
    outputPath: currentOutputPath,
    environment,
  });
  assert.deepEqual(current.candidate, BUILD_INPUT_CANDIDATE);
  assert.ok(existsSync(currentOutputPath));

  const obsoleteOutputPath = join(obsoleteEvidenceParent, 'build-input-candidate.json');
  assert.throws(() => createBuildInputAttestation({
    root: projectRoot,
    reviewedAt: '2026-09-03T00:00:00.000Z',
    sourceCommit,
    easEnvironmentInventoryPath: obsoleteInventoryPath,
    outputPath: obsoleteOutputPath,
    environment,
  }), /BUILD_INPUT_ENVIRONMENT_INVENTORY_INVALID/u);
  assert.equal(existsSync(obsoleteOutputPath), false);
});
