#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeRuntimeTreeSha256,
  computeResolvedProductionExpoConfigSha256,
  computeTrackedSourceSha256,
  readProductionGoogleServicesPlist,
} from './release-command-guard.mjs';
import {
  CANDIDATE,
  COMMIT_PATTERN,
  SHA256_PATTERN,
  canonicalJsonBytes,
  hasExactKeys,
  isCanonicalUtc,
  parseJsonBytes,
  readSecureFile,
  sha256,
  validateOwnedDirectory,
  writeExclusiveCanonicalJson,
} from './release-evidence-common.mjs';

export const BUILD_INPUT_CANDIDATE = CANDIDATE;

const ARGUMENT = 'BUILD_INPUT_PRODUCER_ARGUMENT_INVALID';
const FILE = 'BUILD_INPUT_PRODUCER_FILE_INVALID';
const INVENTORY = 'BUILD_INPUT_ENVIRONMENT_INVENTORY_INVALID';
const OUTPUT = 'BUILD_INPUT_PRODUCER_OUTPUT_INVALID';
const TASK_PARENT = '/.superpowers/sdd/2026-09-04-cabohealth-build11-input-authority-recovery/task-3-recovery-evidence';
const PRODUCTION_FIREBASE_PROJECT_ID = 'cabohealth-owner-prod';
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
const INVENTORY_KEYS = [
  'schemaVersion', 'evidenceKind', 'environmentName', 'profileVariables',
  'projectVariables', 'extras', 'valuesIncluded', 'providerValuesRetained',
];
const EXPECTED_INVENTORY = Object.freeze({
  schemaVersion: 1,
  evidenceKind: 'cabohealth-eas-environment-inventory',
  environmentName: 'production',
  profileVariables: Object.freeze([
    Object.freeze({ name: 'APP_ENV', source: 'eas-profile', kind: 'plain' }),
  ]),
  projectVariables: Object.freeze([
    Object.freeze({
      name: 'CABOHEALTH_FIREBASE_PROJECT_ID', source: 'eas-project-environment', kind: 'sensitive',
    }),
    Object.freeze({
      name: 'CABOHEALTH_GOOGLE_SERVICES_PLIST', source: 'eas-project-environment', kind: 'secret-file',
    }),
  ]),
  extras: Object.freeze([]),
  valuesIncluded: false,
  providerValuesRetained: false,
});

function fail(code) {
  throw new Error(code);
}

function readReviewedFile(root, relativePath) {
  try {
    const path = resolve(root, relativePath);
    const normalized = relative(root, path);
    const stat = lstatSync(path);
    if (normalized !== relativePath || normalized.startsWith('..') || stat.isSymbolicLink()
      || !stat.isFile() || realpathSync(path) !== path) fail(FILE);
    return readFileSync(path);
  } catch (error) {
    if (error instanceof Error && error.message === FILE) throw error;
    fail(FILE);
  }
}

function isExactInventory(value) {
  return hasExactKeys(value, INVENTORY_KEYS)
    && JSON.stringify(value) === JSON.stringify(EXPECTED_INVENTORY);
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
  easEnvironmentInventorySha256,
  easEnvironment,
}) {
  if (JSON.stringify(candidate) !== JSON.stringify(BUILD_INPUT_CANDIDATE)
    || !isCanonicalUtc(reviewedAt)
    || !COMMIT_PATTERN.test(sourceCommit ?? '')
    || !SHA256_PATTERN.test(sourceTreeSha256 ?? '')
    || !SHA256_PATTERN.test(googleServicesPlistSha256 ?? '')
    || !SHA256_PATTERN.test(resolvedProductionExpoConfigSha256 ?? '')
    || !SHA256_PATTERN.test(easEnvironmentInventorySha256 ?? '')
    || !hasExactKeys(reviewedFileSha256, Object.keys(REVIEWED_PATHS))
    || Object.values(reviewedFileSha256).some((value) => !SHA256_PATTERN.test(value ?? ''))
    || JSON.stringify(nodeRuntime) !== JSON.stringify({
      version: EXPECTED_NODE_VERSION,
      executableSha256: nodeRuntime?.executableSha256,
    })
    || !SHA256_PATTERN.test(nodeRuntime?.executableSha256 ?? '')
    || JSON.stringify(easCli) !== JSON.stringify({
      packageVersion: EAS_PACKAGE_VERSION,
      packageJsonRelativePath: EAS_PACKAGE_JSON_RELATIVE_PATH,
      entryRelativePath: EAS_ENTRY_RELATIVE_PATH,
      runtimeRootRelativePath: EAS_RUNTIME_ROOT_RELATIVE_PATH,
      runtimeTreeSha256: easCli?.runtimeTreeSha256,
    })
    || !SHA256_PATTERN.test(easCli?.runtimeTreeSha256 ?? '')
    || !isExactInventory(easEnvironment)) fail(ARGUMENT);

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
    easEnvironmentInventorySha256,
    easEnvironment,
    reviewedAt,
  });
}

function readEnvironmentInventory(path) {
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
      || basename(path) !== 'eas-environment.json' || !dirname(path).endsWith(TASK_PARENT)) fail(INVENTORY);
    validateOwnedDirectory(dirname(path), INVENTORY);
    const bytes = readSecureFile(path, INVENTORY, { maxBytes: 128 * 1024 });
    const value = parseJsonBytes(bytes, INVENTORY, { canonical: true });
    if (!isExactInventory(value) || !canonicalJsonBytes(value).equals(bytes)) fail(INVENTORY);
    return { bytes, value };
  } catch (error) {
    if (error instanceof Error && error.message === INVENTORY) throw error;
    fail(INVENTORY);
  }
}

export function createBuildInputAttestation({
  root,
  reviewedAt,
  sourceCommit,
  easEnvironmentInventoryPath,
  outputPath,
  environment = process.env,
}) {
  if (typeof root !== 'string' || !isAbsolute(root) || !isCanonicalUtc(reviewedAt)
    || !COMMIT_PATTERN.test(sourceCommit ?? '')) fail(ARGUMENT);
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    fail(FILE);
  }
  if (canonicalRoot !== root) fail(ARGUMENT);
  const inventory = readEnvironmentInventory(easEnvironmentInventoryPath);
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath) || resolve(outputPath) !== outputPath
    || basename(outputPath) !== 'build-input-candidate.json'
    || dirname(outputPath) !== dirname(easEnvironmentInventoryPath)) fail(OUTPUT);
  const outputParent = validateOwnedDirectory(dirname(outputPath), OUTPUT);

  let googleServicesPlist;
  try {
    googleServicesPlist = readProductionGoogleServicesPlist(environment);
  } catch {
    fail(FILE);
  }
  const nodeRuntime = {
    version: process.version,
    executableSha256: sha256(readFileSync(realpathSync(process.execPath))),
  };
  let easPackage;
  const easRuntimeRoot = join(canonicalRoot, EAS_RUNTIME_ROOT_RELATIVE_PATH);
  try {
    easPackage = JSON.parse(readReviewedFile(easRuntimeRoot, EAS_PACKAGE_JSON_RELATIVE_PATH));
  } catch {
    fail(FILE);
  }
  const easCli = {
    packageVersion: easPackage.version,
    packageJsonRelativePath: EAS_PACKAGE_JSON_RELATIVE_PATH,
    entryRelativePath: EAS_ENTRY_RELATIVE_PATH,
    runtimeRootRelativePath: EAS_RUNTIME_ROOT_RELATIVE_PATH,
    runtimeTreeSha256: computeRuntimeTreeSha256(easRuntimeRoot),
  };
  const reviewedFileSha256 = Object.fromEntries(
    Object.entries(REVIEWED_PATHS).map(([key, relativePath]) => [
      key,
      sha256(readReviewedFile(canonicalRoot, relativePath)),
    ]),
  );
  const attestation = assembleBuildInputAttestation({
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
    easEnvironmentInventorySha256: sha256(inventory.bytes),
    easEnvironment: inventory.value,
  });
  try {
    writeExclusiveCanonicalJson(outputPath, attestation, OUTPUT, { expectedParent: outputParent });
  } catch {
    fail(OUTPUT);
  }
  return attestation;
}

function parseArguments(values) {
  if (values.length !== 8
    || values[0] !== '--reviewed-at' || !isCanonicalUtc(values[1])
    || values[2] !== '--source-commit' || !COMMIT_PATTERN.test(values[3] ?? '')
    || values[4] !== '--eas-environment-inventory' || typeof values[5] !== 'string'
    || values[6] !== '--output' || typeof values[7] !== 'string') fail(ARGUMENT);
  return {
    reviewedAt: values[1], sourceCommit: values[3],
    easEnvironmentInventoryPath: values[5], outputPath: values[7],
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))));
  createBuildInputAttestation({ root, ...options });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const allowed = new Set([ARGUMENT, FILE, INVENTORY, OUTPUT]);
    process.stderr.write(`${allowed.has(error?.message) ? error.message : 'BUILD_INPUT_PRODUCER_INTERNAL_ERROR'}\n`);
    process.exitCode = 1;
  }
}
