#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeRuntimeTreeSha256,
  computeResolvedProductionExpoConfigSha256,
  computeTrackedSourceSha256,
  readProductionGoogleServicesPlist,
} from './release-command-guard.mjs';

export const BUILD_INPUT_CANDIDATE = Object.freeze({
  appleId: '6758285327',
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '8',
});

const PRODUCTION_FIREBASE_PROJECT_ID = 'cabohealth-owner-prod';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const EXPECTED_NODE_VERSION = 'v22.22.3';
const EAS_RUNTIME_ROOT_RELATIVE_PATH = 'node_modules';
const EAS_PACKAGE_JSON_RELATIVE_PATH = 'eas-cli/package.json';
const EAS_ENTRY_RELATIVE_PATH = 'eas-cli/bin/run';
const EAS_PACKAGE_VERSION = '22.2.0';
const REVIEWED_PATHS = Object.freeze({
  appJsonSha256: 'app.json',
  configSha256: 'constants/config.ts',
  packageLockSha256: 'package-lock.json',
  releaseManifestSha256: 'release/app-store/3.0/release-manifest.json',
  releaseVerifierSha256: 'scripts/verify-release-v3.mjs',
  metadataVerifierSha256: 'scripts/verify-app-store-metadata.mjs',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readReviewedFile(root, relativePath) {
  const path = resolve(root, relativePath);
  const normalized = relative(root, path);
  const stat = lstatSync(path);
  if (
    normalized !== relativePath
    || normalized.startsWith('..')
    || stat.isSymbolicLink()
    || !stat.isFile()
    || realpathSync(path) !== path
  ) throw new Error('BUILD_INPUT_PRODUCER_FILE_INVALID');
  return readFileSync(path);
}

export function assembleBuildInputAttestation({
  candidate = BUILD_INPUT_CANDIDATE,
  reviewedAt,
  sourceCommit,
  sourceTreeSha256,
  reviewedFileSha256,
  googleServicesPlistSha256,
  resolvedProductionExpoConfigSha256,
  nodeRuntime,
  easCli,
  easEnvironment,
}) {
  const expectedEasEnvironment = {
    environmentName: 'production',
    variables: [
      { name: 'APP_ENV', source: 'eas-profile', kind: 'plain' },
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
    valuesIncluded: false,
    reviewStatus: 'independently-reviewed',
  };
  if (
    JSON.stringify(candidate) !== JSON.stringify(BUILD_INPUT_CANDIDATE)
    || typeof reviewedAt !== 'string'
    || Number.isNaN(Date.parse(reviewedAt))
    || !COMMIT_PATTERN.test(sourceCommit ?? '')
    || !HASH_PATTERN.test(sourceTreeSha256 ?? '')
    || !HASH_PATTERN.test(googleServicesPlistSha256 ?? '')
    || !HASH_PATTERN.test(resolvedProductionExpoConfigSha256 ?? '')
    || reviewedFileSha256 === null
    || typeof reviewedFileSha256 !== 'object'
    || Array.isArray(reviewedFileSha256)
    || JSON.stringify(Object.keys(reviewedFileSha256))
      !== JSON.stringify(Object.keys(REVIEWED_PATHS))
    || Object.values(reviewedFileSha256).some((value) => !HASH_PATTERN.test(value ?? ''))
    || JSON.stringify(nodeRuntime) !== JSON.stringify({
      version: EXPECTED_NODE_VERSION,
      executableSha256: nodeRuntime?.executableSha256,
    })
    || !HASH_PATTERN.test(nodeRuntime?.executableSha256 ?? '')
    || JSON.stringify(easCli) !== JSON.stringify({
      packageVersion: EAS_PACKAGE_VERSION,
      packageJsonRelativePath: EAS_PACKAGE_JSON_RELATIVE_PATH,
      entryRelativePath: EAS_ENTRY_RELATIVE_PATH,
      runtimeRootRelativePath: EAS_RUNTIME_ROOT_RELATIVE_PATH,
      runtimeTreeSha256: easCli?.runtimeTreeSha256,
    })
    || !HASH_PATTERN.test(easCli?.runtimeTreeSha256 ?? '')
    || JSON.stringify(easEnvironment) !== JSON.stringify(expectedEasEnvironment)
  ) throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-attestation',
    candidate: BUILD_INPUT_CANDIDATE,
    sourceCommit,
    sourceTreeSha256,
    ...reviewedFileSha256,
    firebaseProjectId: PRODUCTION_FIREBASE_PROJECT_ID,
    googleServicesPlistSha256,
    resolvedProductionExpoConfigSha256,
    nodeRuntime,
    easCli,
    easEnvironment,
    reviewedAt,
  });
}

export function createBuildInputAttestation({
  root,
  reviewedAt,
  sourceCommit,
  environment = process.env,
}) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');
  }
  const canonicalRoot = realpathSync(root);
  if (canonicalRoot !== root) throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');

  const googleServicesPlist = readProductionGoogleServicesPlist(environment);
  const nodeRuntime = {
    version: process.version,
    executableSha256: sha256(readFileSync(realpathSync(process.execPath))),
  };
  const easRuntimeRoot = join(canonicalRoot, EAS_RUNTIME_ROOT_RELATIVE_PATH);
  const easPackage = JSON.parse(readFileSync(
    join(easRuntimeRoot, EAS_PACKAGE_JSON_RELATIVE_PATH),
    'utf8',
  ));
  const easCli = {
    packageVersion: easPackage.version,
    packageJsonRelativePath: EAS_PACKAGE_JSON_RELATIVE_PATH,
    entryRelativePath: EAS_ENTRY_RELATIVE_PATH,
    runtimeRootRelativePath: EAS_RUNTIME_ROOT_RELATIVE_PATH,
    runtimeTreeSha256: computeRuntimeTreeSha256(easRuntimeRoot),
  };
  const easEnvironment = {
    environmentName: 'production',
    variables: [
      { name: 'APP_ENV', source: 'eas-profile', kind: 'plain' },
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
    valuesIncluded: false,
    reviewStatus: 'independently-reviewed',
  };
  const reviewedFileSha256 = Object.fromEntries(
    Object.entries(REVIEWED_PATHS).map(([key, relativePath]) => [
      key,
      sha256(readReviewedFile(canonicalRoot, relativePath)),
    ]),
  );
  return assembleBuildInputAttestation({
    reviewedAt,
    sourceCommit,
    sourceTreeSha256: computeTrackedSourceSha256(canonicalRoot),
    reviewedFileSha256,
    googleServicesPlistSha256: googleServicesPlist.sha256,
    resolvedProductionExpoConfigSha256: computeResolvedProductionExpoConfigSha256(
      canonicalRoot,
      googleServicesPlist.bytes,
    ),
    nodeRuntime,
    easCli,
    easEnvironment,
  });
}

function parseArguments(values) {
  if (values.length !== 4
    || values[0] !== '--reviewed-at'
    || values[2] !== '--source-commit'
    || !COMMIT_PATTERN.test(values[3] ?? '')) {
    throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');
  }
  return { reviewedAt: values[1], sourceCommit: values[3] };
}

function main() {
  const { reviewedAt, sourceCommit } = parseArguments(process.argv.slice(2));
  const root = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))));
  const attestation = createBuildInputAttestation({ root, reviewedAt, sourceCommit });
  process.stdout.write(`${JSON.stringify(attestation)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'BUILD_INPUT_PRODUCER_INTERNAL_ERROR';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
