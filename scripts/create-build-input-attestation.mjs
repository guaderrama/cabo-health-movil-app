#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeResolvedProductionExpoConfigSha256,
  computeTrackedSourceSha256,
  readProductionGoogleServicesPlist,
} from './release-command-guard.mjs';

export const BUILD_INPUT_CANDIDATE = Object.freeze({
  appleId: '6758285327',
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '7',
});

const PRODUCTION_FIREBASE_PROJECT_ID = 'cabohealth-owner-prod';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
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
  sourceTreeSha256,
  reviewedFileSha256,
  googleServicesPlistSha256,
  resolvedProductionExpoConfigSha256,
}) {
  if (
    JSON.stringify(candidate) !== JSON.stringify(BUILD_INPUT_CANDIDATE)
    || typeof reviewedAt !== 'string'
    || Number.isNaN(Date.parse(reviewedAt))
    || !HASH_PATTERN.test(sourceTreeSha256 ?? '')
    || !HASH_PATTERN.test(googleServicesPlistSha256 ?? '')
    || !HASH_PATTERN.test(resolvedProductionExpoConfigSha256 ?? '')
    || reviewedFileSha256 === null
    || typeof reviewedFileSha256 !== 'object'
    || Array.isArray(reviewedFileSha256)
    || JSON.stringify(Object.keys(reviewedFileSha256))
      !== JSON.stringify(Object.keys(REVIEWED_PATHS))
    || Object.values(reviewedFileSha256).some((value) => !HASH_PATTERN.test(value ?? ''))
  ) throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-attestation',
    candidate: BUILD_INPUT_CANDIDATE,
    sourceTreeSha256,
    ...reviewedFileSha256,
    firebaseProjectId: PRODUCTION_FIREBASE_PROJECT_ID,
    googleServicesPlistSha256,
    resolvedProductionExpoConfigSha256,
    reviewedAt,
  });
}

export function createBuildInputAttestation({
  root,
  reviewedAt,
  environment = process.env,
}) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');
  }
  const canonicalRoot = realpathSync(root);
  if (canonicalRoot !== root) throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');

  const googleServicesPlist = readProductionGoogleServicesPlist(environment);
  const reviewedFileSha256 = Object.fromEntries(
    Object.entries(REVIEWED_PATHS).map(([key, relativePath]) => [
      key,
      sha256(readReviewedFile(canonicalRoot, relativePath)),
    ]),
  );
  return assembleBuildInputAttestation({
    reviewedAt,
    sourceTreeSha256: computeTrackedSourceSha256(canonicalRoot),
    reviewedFileSha256,
    googleServicesPlistSha256: googleServicesPlist.sha256,
    resolvedProductionExpoConfigSha256: computeResolvedProductionExpoConfigSha256(
      canonicalRoot,
      googleServicesPlist.bytes,
    ),
  });
}

function parseArguments(values) {
  if (values.length !== 2 || values[0] !== '--reviewed-at') {
    throw new Error('BUILD_INPUT_PRODUCER_ARGUMENT_INVALID');
  }
  return { reviewedAt: values[1] };
}

function main() {
  const { reviewedAt } = parseArguments(process.argv.slice(2));
  const root = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))));
  const attestation = createBuildInputAttestation({ root, reviewedAt });
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
