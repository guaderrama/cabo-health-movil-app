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

const CODE = 'SUBMISSION_STATUS_SANITIZATION_FAILED';
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const TASK_PARENT = '/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-7-evidence';
const STATUSES = new Set(['NEW', 'IN_QUEUE', 'IN_PROGRESS', 'FINISHED', 'ERRORED', 'CANCELED']);
const TERMINAL = new Set(['FINISHED', 'ERRORED', 'CANCELED']);

function fail() {
  throw new Error(CODE);
}

function validateOutput(purpose, outputPath, environment) {
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath) || resolve(outputPath) !== outputPath) fail();
  if (purpose === 'task-evidence') {
    if (!dirname(outputPath).endsWith(TASK_PARENT) || outputPath !== join(dirname(outputPath), 'eas-submission-status.json')) fail();
    return validateOwnedDirectory(dirname(outputPath), CODE);
  }
  if (purpose === 'attempt-reconciliation') {
    const root = validateOwnedDirectory(environment.CABOHEALTH_RELEASE_EVIDENCE_ROOT, CODE, { outsideDropbox: true });
    if (outputPath !== join(root, 'upload-testflight-reconciliation.json')) fail();
    return root;
  }
  fail();
}

export function sanitizeSubmissionStatus({
  stdinBytes,
  submissionId,
  easBuildId,
  purpose,
  outputPath,
  environment = process.env,
}) {
  try {
    if (!Buffer.isBuffer(stdinBytes) || stdinBytes.length === 0 || stdinBytes.length > MAX_INPUT_BYTES
      || !UUID_PATTERN.test(submissionId ?? '') || !UUID_PATTERN.test(easBuildId ?? '')) fail();
    const parent = validateOutput(purpose, outputPath, environment);
    const value = parseJsonBytes(stdinBytes, CODE);
    const status = value.status;
    if (value.id !== submissionId || !STATUSES.has(status) || value.platform !== 'IOS'
      || !isCanonicalUtc(value.createdAt)
      || (value.completedAt !== null && !isCanonicalUtc(value.completedAt))
      || (TERMINAL.has(status) ? !isCanonicalUtc(value.completedAt) : value.completedAt !== null)
      || value.iosConfig?.ascAppIdentifier !== CANDIDATE.appleId
      || value.app?.slug !== EAS_PROJECT_SLUG
      || value.app?.ownerAccount?.name !== EAS_ACCOUNT
      || (value.error !== null && (value.error === undefined || typeof value.error !== 'object' || Array.isArray(value.error)))) fail();
    const submitted = value.submittedBuild;
    if (!Object.hasOwn(value, 'submittedBuild')
      || (submitted !== null && (typeof submitted !== 'object' || Array.isArray(submitted)))) fail();
    const submittedAvailable = submitted !== null;
    if (submittedAvailable && (submitted.id !== easBuildId
      || submitted.platform !== 'IOS'
      || submitted.distribution !== 'STORE'
      || submitted.buildProfile !== 'production'
      || submitted.appIdentifier !== CANDIDATE.bundleIdentifier
      || submitted.appVersion !== CANDIDATE.marketingVersion
      || submitted.appBuildVersion !== CANDIDATE.buildNumber
      || submitted.app?.slug !== EAS_PROJECT_SLUG
      || submitted.app?.ownerAccount?.name !== EAS_ACCOUNT)) fail();
    const errorCode = value.error?.errorCode ?? null;
    if (errorCode !== null && (typeof errorCode !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(errorCode))) fail();
    const result = {
      schemaVersion: 1,
      evidenceKind: 'cabohealth-eas-submission-read-only-status',
      submissionId,
      status,
      terminal: TERMINAL.has(status),
      platform: 'IOS',
      createdAt: value.createdAt,
      completedAt: value.completedAt,
      errorPresent: value.error !== null,
      errorCode,
      app: {
        appleId: CANDIDATE.appleId,
        account: EAS_ACCOUNT,
        projectSlug: EAS_PROJECT_SLUG,
        submittedBuildIdentityAvailable: submittedAvailable,
        bundleIdentifier: submittedAvailable ? CANDIDATE.bundleIdentifier : null,
        marketingVersion: submittedAvailable ? CANDIDATE.marketingVersion : null,
        buildNumber: submittedAvailable ? CANDIDATE.buildNumber : null,
        easBuildId: submittedAvailable ? easBuildId : null,
      },
      appleProcessingStatus: 'not-proven-by-eas-submission',
      appleProcessingPendingReadOnlyVerification: true,
      appStoreConnectBuildSelectionPerformed: false,
      mutationPerformed: false,
      rawProviderResponseRetained: false,
      providerUrlsOmitted: true,
      providerFieldsOmitted: true,
      credentialFieldsOmitted: true,
    };
    writeExclusiveCanonicalJson(outputPath, result, CODE, { expectedParent: parent });
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === CODE) throw error;
    fail();
  }
}

function parseArguments(values) {
  if (values.length !== 8
    || values[0] !== '--submission-id' || !UUID_PATTERN.test(values[1] ?? '')
    || values[2] !== '--eas-build-id' || !UUID_PATTERN.test(values[3] ?? '')
    || values[4] !== '--purpose' || !['task-evidence', 'attempt-reconciliation'].includes(values[5])
    || values[6] !== '--output' || typeof values[7] !== 'string') fail();
  return {
    submissionId: values[1], easBuildId: values[3], purpose: values[5], outputPath: values[7],
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const stdinBytes = await readStdinBounded(process.stdin, MAX_INPUT_BYTES, CODE);
  sanitizeSubmissionStatus({ ...options, stdinBytes });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${CODE}\n`);
    process.exitCode = 1;
  });
}
