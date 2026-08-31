#!/usr/bin/env node

import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANDIDATE,
  EAS_ACCOUNT,
  EAS_PROJECT_SLUG,
  UUID_PATTERN,
  isCanonicalUtc,
  parseJsonBytes,
  readStdinBounded,
  validateOwnedDirectory,
  writeExclusiveCanonicalJson,
} from './release-evidence-common.mjs';

const CODE = 'BUILD_STATUS_SANITIZATION_FAILED';
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const STATUSES = new Set(['NEW', 'IN_QUEUE', 'IN_PROGRESS', 'PENDING_CANCEL', 'FINISHED', 'ERRORED', 'CANCELED']);
const TERMINAL = new Set(['FINISHED', 'ERRORED', 'CANCELED']);

function fail() {
  throw new Error(CODE);
}

function parseBuild(bytes, buildId) {
  const value = parseJsonBytes(bytes, CODE);
  const status = value.status;
  const artifactUrl = value.artifacts?.buildUrl;
  if (!UUID_PATTERN.test(buildId ?? '')
    || value.id !== buildId
    || !STATUSES.has(status)
    || value.platform !== 'IOS'
    || value.distribution !== 'STORE'
    || value.buildProfile !== 'production'
    || value.appIdentifier !== CANDIDATE.bundleIdentifier
    || value.appVersion !== CANDIDATE.marketingVersion
    || value.appBuildVersion !== CANDIDATE.buildNumber
    || value.app?.slug !== EAS_PROJECT_SLUG
    || value.app?.ownerAccount?.name !== EAS_ACCOUNT
    || !isCanonicalUtc(value.createdAt)
    || (value.completedAt !== null && !isCanonicalUtc(value.completedAt))
    || (TERMINAL.has(status) ? !isCanonicalUtc(value.completedAt) : value.completedAt !== null)
    || (artifactUrl !== undefined && (typeof artifactUrl !== 'string' || !artifactUrl.startsWith('https://')))
    || (value.error !== null && (value.error === undefined || typeof value.error !== 'object' || Array.isArray(value.error)))) fail();
  const errorCode = value.error?.errorCode ?? null;
  if (errorCode !== null && (typeof errorCode !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(errorCode))) fail();
  return { value, status, errorCode, artifactAvailable: typeof artifactUrl === 'string' };
}

export function sanitizeBuildStatus({ stdinBytes, buildId, outputPath, environment = process.env }) {
  try {
    if (!Buffer.isBuffer(stdinBytes) || stdinBytes.length === 0 || stdinBytes.length > MAX_INPUT_BYTES) fail();
    const root = validateOwnedDirectory(environment.CABOHEALTH_RELEASE_EVIDENCE_ROOT, CODE, { outsideDropbox: true });
    if (typeof outputPath !== 'string' || !isAbsolute(outputPath) || resolve(outputPath) !== outputPath
      || outputPath !== join(root, 'build-reconciliation.json') || dirname(outputPath) !== root) fail();
    const { value, status, errorCode, artifactAvailable } = parseBuild(stdinBytes, buildId);
    const result = {
      schemaVersion: 1,
      evidenceKind: 'cabohealth-eas-build-read-only-status',
      easBuildId: buildId,
      status,
      terminal: TERMINAL.has(status),
      platform: 'IOS',
      distribution: 'STORE',
      account: EAS_ACCOUNT,
      projectSlug: EAS_PROJECT_SLUG,
      buildProfile: 'production',
      bundleIdentifier: CANDIDATE.bundleIdentifier,
      marketingVersion: CANDIDATE.marketingVersion,
      buildNumber: CANDIDATE.buildNumber,
      artifactAvailable,
      createdAt: value.createdAt,
      completedAt: value.completedAt,
      errorPresent: value.error !== null,
      errorCode,
      mutationPerformed: false,
      rawProviderResponseRetained: false,
      providerUrlsOmitted: true,
      providerFieldsOmitted: true,
      credentialFieldsOmitted: true,
    };
    writeExclusiveCanonicalJson(outputPath, result, CODE, { expectedParent: root });
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === CODE) throw error;
    fail();
  }
}

function parseArguments(values) {
  if (values.length !== 4 || values[0] !== '--build-id' || !UUID_PATTERN.test(values[1] ?? '')
    || values[2] !== '--output' || typeof values[3] !== 'string') fail();
  return { buildId: values[1], outputPath: values[3] };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const stdinBytes = await readStdinBounded(process.stdin, MAX_INPUT_BYTES, CODE);
  sanitizeBuildStatus({ ...options, stdinBytes });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${CODE}\n`);
    process.exitCode = 1;
  });
}
