#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANDIDATE,
  EAS_ACCOUNT,
  EAS_PROJECT_SLUG,
  SHA256_PATTERN,
  UUID_PATTERN,
  hasExactKeys,
  isCanonicalUtc,
  isValidReviewChronology,
  parseJsonBytes,
  readSecureFile,
  sha256,
  validateOwnedDirectory,
  writeExclusiveCanonicalJson,
} from './release-evidence-common.mjs';

const ARGUMENT = 'BUILD_ARTIFACT_PRODUCER_ARGUMENT_INVALID';
const ASSOCIATION = 'BUILD_ARTIFACT_PRODUCER_ASSOCIATION_INVALID';
const FILE = 'BUILD_ARTIFACT_PRODUCER_FILE_INVALID';
const OUTPUT = 'BUILD_ARTIFACT_PRODUCER_OUTPUT_INVALID';
const TASK_PARENT = '/.superpowers/sdd/2026-11-08-cabohealth-build15-recovery/task-4-evidence';
const FILES = Object.freeze([
  'CaboHealth-3.0-build-15.ipa',
  'signed-entitlements.plist',
  'privacy-report.json',
  'embedded-GoogleService-Info.plist',
  'signing-certificate.der',
  'embedded.mobileprovision',
]);
const ASSOCIATION_KEYS = [
  'schemaVersion', 'evidenceKind', 'candidate', 'easBuildId', 'account',
  'projectSlug', 'platform', 'distribution', 'buildProfile', 'buildStatus',
  'artifactAvailable', 'downloadedIpaByteCount', 'downloadedIpaSha256',
  'associationGuardProven', 'providerUrlsOmitted', 'credentialFieldsOmitted',
  'reviewedAt',
];

function fail(code) {
  throw new Error(code);
}

function readAssociation(path) {
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
      || basename(path) !== 'eas-artifact-association.json'
      || !dirname(path).endsWith(TASK_PARENT)) fail(ASSOCIATION);
    validateOwnedDirectory(dirname(path), ASSOCIATION);
    const bytes = readSecureFile(path, ASSOCIATION, { maxBytes: 128 * 1024 });
    const value = parseJsonBytes(bytes, ASSOCIATION, { canonical: true });
    if (!hasExactKeys(value, ASSOCIATION_KEYS)
      || value.schemaVersion !== 1
      || value.evidenceKind !== 'cabohealth-eas-artifact-association'
      || JSON.stringify(value.candidate) !== JSON.stringify(CANDIDATE)
      || !UUID_PATTERN.test(value.easBuildId ?? '')
      || value.account !== EAS_ACCOUNT || value.projectSlug !== EAS_PROJECT_SLUG
      || value.platform !== 'IOS' || value.distribution !== 'STORE'
      || value.buildProfile !== 'production' || value.buildStatus !== 'FINISHED'
      || value.artifactAvailable !== true
      || !Number.isSafeInteger(value.downloadedIpaByteCount) || value.downloadedIpaByteCount <= 0
      || !SHA256_PATTERN.test(value.downloadedIpaSha256 ?? '')
      || value.associationGuardProven !== false || value.providerUrlsOmitted !== true
      || value.credentialFieldsOmitted !== true || !isCanonicalUtc(value.reviewedAt)) fail(ASSOCIATION);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === ASSOCIATION) throw error;
    fail(ASSOCIATION);
  }
}

export function createBuildArtifactAttestation({
  reviewedAt,
  buildInputAttestationSha256,
  sourceTreeSha256,
  associationPath,
  evidenceDir,
  outputPath,
  now = Date.now(),
}) {
  if (!isCanonicalUtc(reviewedAt) || !SHA256_PATTERN.test(buildInputAttestationSha256 ?? '')
    || !SHA256_PATTERN.test(sourceTreeSha256 ?? '') || !Number.isFinite(now)) fail(ARGUMENT);
  const association = readAssociation(associationPath);
  if (!isValidReviewChronology(association.reviewedAt, reviewedAt, now)) fail(ASSOCIATION);
  try {
    if (typeof evidenceDir !== 'string' || !isAbsolute(evidenceDir) || resolve(evidenceDir) !== evidenceDir
      || !evidenceDir.endsWith('/rc-build-15')) fail(FILE);
    validateOwnedDirectory(evidenceDir, FILE);
    const entries = readdirSync(evidenceDir).sort();
    if (JSON.stringify(entries) !== JSON.stringify([...FILES].sort())) fail(FILE);
    const bytes = Object.fromEntries(FILES.map((name) => [
      name,
      readSecureFile(join(evidenceDir, name), FILE, {
        parent: evidenceDir,
        maxBytes: name.endsWith('.ipa') ? 1024 * 1024 * 1024 : 64 * 1024 * 1024,
      }),
    ]));
    const ipa = bytes[FILES[0]];
    if (ipa.length !== association.downloadedIpaByteCount
      || sha256(ipa) !== association.downloadedIpaSha256) fail(FILE);
    if (typeof outputPath !== 'string' || !isAbsolute(outputPath) || resolve(outputPath) !== outputPath
      || basename(outputPath) !== 'build-artifact-candidate.json'
      || !dirname(outputPath).endsWith(TASK_PARENT)) fail(OUTPUT);
    const parent = validateOwnedDirectory(dirname(outputPath), OUTPUT);
    const value = {
      schemaVersion: 1,
      artifactKind: 'cabohealth-ios-build-artifact-attestation',
      candidate: CANDIDATE,
      buildInputAttestationSha256,
      sourceTreeSha256,
      easBuildId: association.easBuildId,
      easArtifactAssociation: {
        evidenceType: 'independently-reviewed-procedural',
        buildId: association.easBuildId,
        buildStatus: association.buildStatus,
        downloadedIpaSha256: association.downloadedIpaSha256,
        associationGuardProven: false,
        reviewedAt: association.reviewedAt,
      },
      ipaSha256: association.downloadedIpaSha256,
      signedEntitlementsSha256: sha256(bytes['signed-entitlements.plist']),
      privacyReportSha256: sha256(bytes['privacy-report.json']),
      embeddedGoogleServicesPlistSha256: sha256(bytes['embedded-GoogleService-Info.plist']),
      signingCertificateSha256: sha256(bytes['signing-certificate.der']),
      embeddedProvisioningProfileSha256: sha256(bytes['embedded.mobileprovision']),
      reviewedAt,
    };
    writeExclusiveCanonicalJson(outputPath, value, OUTPUT, { expectedParent: parent });
    return value;
  } catch (error) {
    if (error instanceof Error && [FILE, OUTPUT].includes(error.message)) throw error;
    fail(FILE);
  }
}

function parseArguments(values) {
  if (values.length !== 12
    || values[0] !== '--reviewed-at'
    || values[2] !== '--build-input-attestation-sha256'
    || values[4] !== '--source-tree-sha256'
    || values[6] !== '--association'
    || values[8] !== '--evidence-dir'
    || values[10] !== '--output'
    || !isCanonicalUtc(values[1])
    || !SHA256_PATTERN.test(values[3] ?? '') || !SHA256_PATTERN.test(values[5] ?? '')) fail(ARGUMENT);
  return {
    reviewedAt: values[1], buildInputAttestationSha256: values[3], sourceTreeSha256: values[5],
    associationPath: values[7], evidenceDir: values[9], outputPath: values[11],
  };
}

function main() {
  createBuildArtifactAttestation(parseArguments(process.argv.slice(2)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const allowed = new Set([ARGUMENT, ASSOCIATION, FILE, OUTPUT]);
    process.stderr.write(`${allowed.has(error?.message) ? error.message : 'BUILD_ARTIFACT_PRODUCER_INTERNAL_ERROR'}\n`);
    process.exitCode = 1;
  }
}
