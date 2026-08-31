import { isAbsolute, resolve } from 'node:path';

import { CANDIDATE, SHA256_PATTERN } from './constants.mjs';
import { reject } from './errors.mjs';

const BASE_NAMES = Object.freeze([
  'operation', 'apple-id', 'bundle-identifier', 'marketing-version', 'build-number',
  'group-name', 'source-commit', 'build-input-attestation',
  'build-input-attestation-sha256', 'build-artifact-attestation',
  'build-artifact-attestation-sha256',
]);

function pairs(values) {
  if (!Array.isArray(values) || values.length % 2 !== 0) reject('INTERNAL_GROUP_ARGUMENT_INVALID');
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    if (typeof flag !== 'string' || !flag.startsWith('--') || typeof values[index + 1] !== 'string') {
      reject('INTERNAL_GROUP_ARGUMENT_INVALID');
    }
    result[flag.slice(2)] = values[index + 1];
  }
  return result;
}

export function parseInternalGroupArguments(values, { assignment = false } = {}) {
  const names = assignment
    ? [...BASE_NAMES, 'observation', 'observation-sha256', 'output']
    : [...BASE_NAMES, 'output'];
  if (values.length !== names.length * 2
    || names.some((name, index) => values[index * 2] !== `--${name}`)) {
    reject('INTERNAL_GROUP_ARGUMENT_INVALID');
  }
  const parsed = pairs(values);
  const expectedOperation = assignment
    ? 'ensure-existing-internal-testflight-access'
    : 'observe-existing-internal-testflight-access';
  if (parsed.operation !== expectedOperation
    || parsed['apple-id'] !== CANDIDATE.appleId
    || parsed['bundle-identifier'] !== CANDIDATE.bundleIdentifier
    || parsed['marketing-version'] !== CANDIDATE.marketingVersion
    || parsed['build-number'] !== CANDIDATE.buildNumber
    || parsed['group-name'] !== 'cabo health'
    || !/^[a-f0-9]{40}$/u.test(parsed['source-commit'] ?? '')
    || !SHA256_PATTERN.test(parsed['build-input-attestation-sha256'] ?? '')
    || !SHA256_PATTERN.test(parsed['build-artifact-attestation-sha256'] ?? '')
    || (assignment && !SHA256_PATTERN.test(parsed['observation-sha256'] ?? ''))) {
    reject('INTERNAL_GROUP_ARGUMENT_INVALID');
  }
  for (const name of [
    'build-input-attestation', 'build-artifact-attestation',
    ...(assignment ? ['observation'] : []), 'output',
  ]) {
    if (!isAbsolute(parsed[name]) || resolve(parsed[name]) !== parsed[name]) {
      reject('INTERNAL_GROUP_ARGUMENT_INVALID');
    }
  }
  return Object.freeze({
    operation: parsed.operation,
    sourceCommit: parsed['source-commit'],
    buildInputAttestationPath: parsed['build-input-attestation'],
    buildInputAttestationSha256: parsed['build-input-attestation-sha256'],
    buildArtifactAttestationPath: parsed['build-artifact-attestation'],
    buildArtifactAttestationSha256: parsed['build-artifact-attestation-sha256'],
    ...(assignment ? {
      observationPath: parsed.observation,
      observationSha256: parsed['observation-sha256'],
    } : {}),
    outputPath: parsed.output,
  });
}
