import { isAbsolute, resolve } from 'node:path';
import {
  ARGUMENT_NAMES,
  AUTHORIZATION_NONCE_PATTERN,
  CANDIDATE,
  SHA256_PATTERN,
  TESTFLIGHT_BUILD_ID_PATTERN,
} from './constants.mjs';
import { reject } from './errors.mjs';

const PATH_ARGUMENTS = new Set([
  'rc-attestation',
  'build-artifact-attestation',
  'app-store-connect-evidence',
  'physical-iphone-qa',
  'screenshots-manifest',
  'app-privacy',
  'review-notes',
]);
const HASH_ARGUMENTS = new Set([
  'rc-attestation-sha256',
  'build-artifact-attestation-sha256',
  'app-store-connect-evidence-sha256',
  'physical-iphone-qa-sha256',
  'screenshots-manifest-sha256',
  'app-privacy-sha256',
  'review-notes-sha256',
]);

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== ARGUMENT_NAMES.length * 2) {
    reject('CLI_ARGUMENTS_INVALID');
  }
  const parsed = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof flag !== 'string' || !flag.startsWith('--')
      || typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      reject('CLI_ARGUMENTS_INVALID');
    }
    const name = flag.slice(2);
    if (!ARGUMENT_NAMES.includes(name) || Object.hasOwn(parsed, name)) {
      reject('CLI_ARGUMENTS_INVALID');
    }
    parsed[name] = value;
  }
  if (!ARGUMENT_NAMES.every((name) => Object.hasOwn(parsed, name))) {
    reject('CLI_ARGUMENTS_INVALID');
  }
  if (parsed.operation !== 'submit-for-review'
    || parsed['apple-id'] !== CANDIDATE.appleId
    || parsed['bundle-identifier'] !== CANDIDATE.bundleIdentifier
    || parsed['marketing-version'] !== CANDIDATE.marketingVersion
    || parsed['build-number'] !== CANDIDATE.buildNumber) {
    reject('CANDIDATE_IDENTITY_INVALID');
  }
  if (!TESTFLIGHT_BUILD_ID_PATTERN.test(parsed['testflight-build-id'])) {
    reject('TESTFLIGHT_BUILD_ID_INVALID');
  }
  for (const name of PATH_ARGUMENTS) {
    if (!isAbsolute(parsed[name]) || resolve(parsed[name]) !== parsed[name]) {
      reject('EVIDENCE_PATH_INVALID');
    }
  }
  for (const name of HASH_ARGUMENTS) {
    if (!SHA256_PATTERN.test(parsed[name])) reject('EVIDENCE_HASH_ARGUMENT_INVALID');
  }
  if (!AUTHORIZATION_NONCE_PATTERN.test(parsed['authorization-nonce'])) {
    reject('AUTHORIZATION_BINDING_INVALID');
  }
  return Object.freeze(parsed);
}
