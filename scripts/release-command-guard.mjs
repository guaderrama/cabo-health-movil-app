import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants as FS_CONSTANTS,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  validateAppStoreConnectEvidence,
  validateIpaPrivacyReport,
  validatePhysicalIphoneQaEvidence,
  validateScreenshotsManifest,
} from './apple-post-build-evidence.mjs';
import { isValidReviewChronology } from './release-evidence-common.mjs';
import { markProviderStarted } from './release-attempt-runner.mjs';

export {
  validateAppStoreConnectEvidence,
  validateIpaPrivacyReport,
  validatePhysicalIphoneQaEvidence,
  validateScreenshotsManifest,
} from './apple-post-build-evidence.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  parseGoogleServicesPlistIdentity,
} = require('../config/nativeFirebaseExpoConfig.cjs');
const { parse: parsePlist } = require('simple-plist');

const ATTESTATION_PATHS = Object.freeze({
  buildInput: 'release/app-store/3.0/build-input-attestation.json',
  buildArtifact: 'release/app-store/3.0/build-artifact-attestation.json',
  rc: 'release/app-store/3.0/rc-attestation.json',
});
const SCREENSHOTS_MANIFEST_PATH = 'release/app-store/3.0/screenshots-manifest.json';
const APP_PRIVACY_PATH = 'release/app-store/3.0/app-privacy.json';
const REVIEW_NOTES_PATH = 'release/app-store/3.0/review-notes.md';
const PRIVATE_EVIDENCE_PATHS = Object.freeze({
  ipa: 'release/private/rc-build-11/CaboHealth-3.0-build-11.ipa',
  signedEntitlements: 'release/private/rc-build-11/signed-entitlements.plist',
  privacyReport: 'release/private/rc-build-11/privacy-report.json',
  embeddedGoogleServicesPlist: 'release/private/rc-build-11/embedded-GoogleService-Info.plist',
  signingCertificate: 'release/private/rc-build-11/signing-certificate.der',
  embeddedProvisioningProfile: 'release/private/rc-build-11/embedded.mobileprovision',
  physicalIphoneQa: 'release/private/rc-build-11/physical-iphone-qa.json',
  appStoreConnectEvidence: 'release/private/rc-build-11/app-store-connect-evidence.json',
});

// Each phase pin starts null and becomes authoritative only after that phase
// has been produced and independently reviewed. The canonical source digest
// includes this guard after normalizing only these five one-line authority
// values, so advancing a reviewed pin is not circular while every executable
// guard behavior remains part of the reviewed source. An unpinned checked-in
// attestation is historical evidence only and cannot satisfy a current phase.
const BUILD_INPUT_ATTESTATION_SHA256 = null;
const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;
const RC_ATTESTATION_SHA256 = null;
const PINNED_EAS_CLI = null;
const PINNED_APP_STORE_SUBMIT_ADAPTER = null;

const SOURCE_DIGEST_EXCLUSIONS = new Set([
  ...Object.values(ATTESTATION_PATHS),
  // Exact-RC screenshots can only be captured after the immutable build is in
  // TestFlight. Their manifest is independently hashed by the RC attestation,
  // so it is evidence about the build rather than an input to that build.
  SCREENSHOTS_MANIFEST_PATH,
  // App Privacy answers and App Review notes are finalized only after the
  // immutable TestFlight build and physical QA exist. They are not binary
  // inputs; the exact final bytes are instead bound by the RC attestation.
  APP_PRIVACY_PATH,
  REVIEW_NOTES_PATH,
]);
const NORMALIZED_PIN_RULES = Object.freeze([
  ['BUILD_INPUT_ATTESTATION_SHA256', /^(?:null|'[a-f0-9]{64}')$/u],
  ['BUILD_ARTIFACT_ATTESTATION_SHA256', /^(?:null|'[a-f0-9]{64}')$/u],
  ['RC_ATTESTATION_SHA256', /^(?:null|'[a-f0-9]{64}')$/u],
  ['PINNED_EAS_CLI', /^(?:null|'[A-Za-z0-9+/]+={0,2}')$/u],
  ['PINNED_APP_STORE_SUBMIT_ADAPTER', /^(?:null|'[A-Za-z0-9+/]+={0,2}')$/u],
]);
const CANDIDATE = Object.freeze({
  appleId: '6758285327',
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '11',
});
const PRODUCTION_FIREBASE_PROJECT_ID = 'cabohealth-owner-prod';
const PRIVATE_GOOGLE_SERVICES_PLIST_MARKER = '<PRIVATE_GOOGLE_SERVICES_PLIST>';
const CANDIDATE_KEYS = Object.keys(CANDIDATE);
const BUILD_INPUT_KEYS = [
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
];
const BUILD_ARTIFACT_KEYS = [
  'schemaVersion',
  'artifactKind',
  'candidate',
  'buildInputAttestationSha256',
  'sourceTreeSha256',
  'easBuildId',
  'easArtifactAssociation',
  'ipaSha256',
  'signedEntitlementsSha256',
  'privacyReportSha256',
  'embeddedGoogleServicesPlistSha256',
  'signingCertificateSha256',
  'embeddedProvisioningProfileSha256',
  'reviewedAt',
];
const RC_KEYS = [
  'schemaVersion',
  'artifactKind',
  'candidate',
  'buildArtifactAttestationSha256',
  'sourceTreeSha256',
  'testFlightBuildId',
  'testFlightProcessedAt',
  'physicalIphoneQaSha256',
  'screenshotsManifestSha256',
  'appPrivacySha256',
  'reviewNotesSha256',
  'appStoreMetadataEvidenceSha256',
  'reviewedAt',
];
const AUTHORIZATION_KEYS = [
  'schemaVersion',
  'action',
  'rcAttestationSha256',
  'issuedAtMs',
  'expiresAtMs',
  'nonce',
  'confirmationMethod',
  'identityAssurance',
  'confirmationChallenge',
];
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const NONCE_128_PATTERN = /^[A-F0-9]{32}$/u;
const PINNED_NODE_TOOL_KEYS = [
  'entryRelativePath',
  'nodeExecutableSha256',
  'nodeVersion',
  'packageJsonRelativePath',
  'packageVersion',
  'runtimeRootRelativePath',
  'runtimeTreeSha256',
];
const EXPECTED_EAS_ENVIRONMENT = Object.freeze({
  schemaVersion: 1,
  evidenceKind: 'cabohealth-eas-environment-inventory',
  environmentName: 'production',
  profileVariables: Object.freeze([
    Object.freeze({ name: 'APP_ENV', source: 'eas-profile', kind: 'plain' }),
  ]),
  projectVariables: Object.freeze([
    Object.freeze({
      name: 'CABOHEALTH_FIREBASE_PROJECT_ID',
      source: 'eas-project-environment',
      kind: 'sensitive',
    }),
    Object.freeze({
      name: 'CABOHEALTH_GOOGLE_SERVICES_PLIST',
      source: 'eas-project-environment',
      kind: 'secret-file',
    }),
  ]),
  extras: Object.freeze([]),
  valuesIncluded: false,
  providerValuesRetained: false,
});
const INTERNAL_GROUP_OBSERVATION_KEYS = [
  'schemaVersion', 'evidenceKind', 'candidate', 'sourceCommit', 'sourceTreeSha256',
  'buildInputAttestationSha256', 'buildArtifactAttestationSha256', 'easBuildId',
  'appStoreConnectBuildResourceId', 'buildProcessingState', 'buildExpired',
  'buildAudienceType', 'buildUploadedAt', 'betaGroupResourceId', 'betaGroupName',
  'betaGroupInternal', 'betaGroupHasAccessToAllBuilds', 'observedAt', 'available',
  'availabilityReason', 'mutationPerformed', 'rawProviderResponseRetained',
  'providerUrlsOmitted', 'credentialFieldsOmitted',
];
const PRIVATE_OPERATION_PREFIX = 'cabohealth-release-';
const PRIVATE_OPERATION_MARKER = '.cabohealth-private-operation';
const TRUSTED_GIT_EXECUTABLE = '/usr/bin/git';
const TRUSTED_GIT_EXEC_PATH = '/Library/Developer/CommandLineTools/usr/libexec/git-core';
const TRUSTED_GIT_VERSION = 'git version 2.39.5 (Apple Git-154)\n';
const TRUSTED_GIT_DIRECTORIES = Object.freeze([
  '/',
  '/usr',
  '/usr/bin',
  '/Library',
  '/Library/Developer',
  '/Library/Developer/CommandLineTools',
  '/Library/Developer/CommandLineTools/usr',
  '/Library/Developer/CommandLineTools/usr/libexec',
  TRUSTED_GIT_EXEC_PATH,
]);
const TRUSTED_GIT_ENVIRONMENT = Object.freeze({
  PATH: '/usr/bin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_ATTR_NOSYSTEM: '1',
  GIT_EXEC_PATH: TRUSTED_GIT_EXEC_PATH,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_SSH: '/usr/bin/false',
  GIT_SSH_COMMAND: '/usr/bin/false',
  GIT_ASKPASS: '/usr/bin/false',
  SSH_ASKPASS: '/usr/bin/false',
});
const TRUSTED_GIT_OPTIONS = Object.freeze([
  `--exec-path=${TRUSTED_GIT_EXEC_PATH}`,
  '--no-pager',
  '--no-replace-objects',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.attributesFile=/dev/null',
  '-c', 'diff.external=',
  '-c', 'core.sshCommand=/usr/bin/false',
  '-c', 'credential.helper=',
]);
let trustedGitVerified = false;

export class ReleaseGuardError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseGuardError';
  }
}

function reject(code) {
  throw new ReleaseGuardError(code);
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeReleaseGuardAuthority(bytes) {
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    reject('BUILD_SOURCE_GUARD_AUTHORITY_INVALID');
  }
  let normalized = source;
  for (const [name, allowedValue] of NORMALIZED_PIN_RULES) {
    const declaration = new RegExp(`^const ${name} = ([^\\r\\n]*);$`, 'gmu');
    const matches = normalized.match(declaration);
    if (matches?.length !== 1) reject('BUILD_SOURCE_GUARD_AUTHORITY_INVALID');
    const value = matches[0].slice(`const ${name} = `.length, -1);
    if (!allowedValue.test(value)) reject('BUILD_SOURCE_GUARD_AUTHORITY_INVALID');
    normalized = normalized.replace(
      declaration,
      `const ${name} = <INDEPENDENTLY_REVIEWED_PIN>;`,
    );
  }
  return Buffer.from(normalized, 'utf8');
}

function assertSha256(value, code) {
  if (!SHA256_PATTERN.test(value ?? '')) reject(code);
}

function assertReviewedAt(value, code) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) reject(code);
}

export function validateBuildArtifactReviewChronology(
  terminalReviewedAt,
  artifactReviewedAt,
  now = Date.now(),
) {
  const code = 'EXACT_BUILD_ARTIFACT_ATTESTATION_INVALID';
  if (!isValidReviewChronology(terminalReviewedAt, artifactReviewedAt, now)) reject(code);
}

const RC_REVIEW_CHRONOLOGY_KEYS = Object.freeze([
  'buildArtifactReviewedAt',
  'testFlightProcessedAt',
  'physicalIphoneQaPerformedAt',
  'physicalIphoneQaReviewedAt',
  'appStoreConnectCapturedAt',
  'appStoreConnectReviewedAt',
  'screenshotCapturedAts',
  'rcReviewedAt',
]);

export function validateRcReviewChronology(value, now = Date.now()) {
  const code = 'EXACT_RC_ATTESTATION_INVALID';
  if (!hasExactKeys(value, RC_REVIEW_CHRONOLOGY_KEYS)
    || !Array.isArray(value.screenshotCapturedAts)
    || value.screenshotCapturedAts.length === 0) reject(code);
  const predecessors = [
    value.buildArtifactReviewedAt,
    value.testFlightProcessedAt,
    value.physicalIphoneQaPerformedAt,
    value.physicalIphoneQaReviewedAt,
    value.appStoreConnectCapturedAt,
    value.appStoreConnectReviewedAt,
    ...value.screenshotCapturedAts,
  ];
  if (predecessors.some((predecessor) => (
    !isValidReviewChronology(predecessor, value.rcReviewedAt, now)
  ))) reject(code);
}

function assertCandidate(value, code) {
  if (!hasExactKeys(value, CANDIDATE_KEYS) || !isDeepStrictEqual(value, CANDIDATE)) {
    reject(code);
  }
}

function readBoundRegularFile(path, {
  missingCode,
  invalidCode,
  privateMode = null,
  maxBytes = Number.MAX_SAFE_INTEGER,
} = {}) {
  const absolutePath = resolve(path);
  if (absolutePath !== path) reject(invalidCode);

  let descriptor;
  try {
    descriptor = openSync(
      absolutePath,
      FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
    );
  } catch {
    reject(missingCode);
  }

  try {
    const stat = fstatSync(descriptor);
    const { mode } = stat;
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isFile()
      || stat.nlink !== 1
      || stat.uid !== currentUid
      || stat.size > maxBytes
      || (privateMode !== null && (mode & 0o777) !== privateMode)) {
      reject(invalidCode);
    }
    let canonicalPath;
    try {
      canonicalPath = realpathSync(absolutePath);
    } catch {
      reject(invalidCode);
    }
    if (canonicalPath !== absolutePath) reject(invalidCode);
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function parseExactJson(bytes, code) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) reject(code);
    return value;
  } catch (error) {
    if (error instanceof ReleaseGuardError) throw error;
    reject(code);
  }
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !isAbsolute(value)
    && !value.includes('\\')
    && !value.split('/').includes('..')
    && !value.split('/').includes('')
    && !value.includes('\0');
}

function isWithin(root, candidate) {
  const difference = relative(root, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

function synchronizedWorkspaceAncestor(path) {
  let current = resolve(path);
  while (true) {
    if (/^Dropbox(?:$|[ (])/iu.test(basename(current))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function assertOutsideSynchronizedWorkspace(sourcePath, operationRoot, code) {
  const synchronizedRoot = synchronizedWorkspaceAncestor(sourcePath);
  if (synchronizedRoot !== null && isWithin(synchronizedRoot, operationRoot)) reject(code);
}

export function computeRuntimeTreeSha256(directory) {
  const root = resolve(directory);
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    reject('TOOL_RUNTIME_TREE_INVALID');
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : rootStat.uid;
  if (!rootStat.isDirectory()
    || rootStat.isSymbolicLink()
    || rootStat.uid !== currentUid
    || realpathSync(root) !== root) {
    reject('TOOL_RUNTIME_TREE_INVALID');
  }

  const digest = createHash('sha256');
  function visit(relativeDirectory) {
    const absoluteDirectory = relativeDirectory ? join(root, relativeDirectory) : root;
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true })
        .sort((left, right) => Buffer.compare(
          Buffer.from(left.name, 'utf8'),
          Buffer.from(right.name, 'utf8'),
        ));
    } catch {
      reject('TOOL_RUNTIME_TREE_INVALID');
    }
    for (const entry of entries) {
      if (entry.name.includes('\0') || entry.name === '.' || entry.name === '..') {
        reject('TOOL_RUNTIME_TREE_INVALID');
      }
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(root, relativePath);
      let stat;
      try {
        stat = lstatSync(absolutePath);
      } catch {
        reject('TOOL_RUNTIME_TREE_INVALID');
      }
      if (stat.uid !== currentUid) reject('TOOL_RUNTIME_TREE_INVALID');
      const mode = (stat.mode & 0o777).toString(8).padStart(3, '0');
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        digest.update(`D\0${relativePath}\0${mode}\0`);
        visit(relativePath);
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        const bytes = readBoundRegularFile(absolutePath, {
          missingCode: 'TOOL_RUNTIME_TREE_INVALID',
          invalidCode: 'TOOL_RUNTIME_TREE_INVALID',
        });
        digest.update(`F\0${relativePath}\0${mode}\0${sha256(bytes)}\0`);
      } else if (stat.isSymbolicLink()) {
        let link;
        let resolvedTarget;
        try {
          link = readlinkSync(absolutePath);
          if (isAbsolute(link) || link.includes('\0')) reject('TOOL_RUNTIME_TREE_INVALID');
          resolvedTarget = realpathSync(resolve(dirname(absolutePath), link));
        } catch (error) {
          if (error instanceof ReleaseGuardError) throw error;
          reject('TOOL_RUNTIME_TREE_INVALID');
        }
        if (!isWithin(root, resolvedTarget)) reject('TOOL_RUNTIME_TREE_INVALID');
        digest.update(`L\0${relativePath}\0${mode}\0${link}\0`);
      } else {
        reject('TOOL_RUNTIME_TREE_INVALID');
      }
    }
  }
  visit('');
  return digest.digest('hex');
}

function hashProjectFile(root, relativePath, code) {
  return sha256(readBoundRegularFile(join(root, relativePath), {
    missingCode: code,
    invalidCode: code,
  }));
}

function hashPrivateEvidenceFile(root, relativePath, code) {
  return sha256(readBoundRegularFile(join(root, relativePath), {
    missingCode: code,
    invalidCode: code,
    privateMode: 0o600,
  }));
}

function parsePlistDictionary(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  let value;
  try {
    value = parsePlist(bytes);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function googleServicesPlistsHaveSameContent(sourceBytes, embeddedBytes) {
  const source = parsePlistDictionary(sourceBytes);
  const embedded = parsePlistDictionary(embeddedBytes);
  return source !== null && embedded !== null && isDeepStrictEqual(source, embedded);
}

export function readProductionGoogleServicesPlist(environment = process.env) {
  const code = 'EXACT_BUILD_INPUT_GOOGLE_SERVICES_PLIST_INVALID';
  const plistPath = environment.CABOHEALTH_GOOGLE_SERVICES_PLIST;
  if (typeof plistPath !== 'string'
    || !isAbsolute(plistPath)
    || synchronizedWorkspaceAncestor(plistPath) !== null
    || environment.CABOHEALTH_FIREBASE_PROJECT_ID !== PRODUCTION_FIREBASE_PROJECT_ID) {
    reject(code);
  }
  const bytes = readBoundRegularFile(plistPath, {
    missingCode: 'EXACT_BUILD_INPUT_GOOGLE_SERVICES_PLIST_MISSING',
    invalidCode: code,
    privateMode: 0o600,
    maxBytes: 256 * 1024,
  });
  const source = bytes.toString('utf8');
  let identity;
  try {
    identity = parseGoogleServicesPlistIdentity(source);
  } catch {
    reject(code);
  }
  if (!Buffer.from(source, 'utf8').equals(bytes)
    || identity.projectId !== PRODUCTION_FIREBASE_PROJECT_ID
    || identity.bundleId !== CANDIDATE.bundleIdentifier) {
    reject(code);
  }
  return Object.freeze({ bytes, path: plistPath, sha256: sha256(bytes) });
}

export function computeResolvedProductionExpoConfigSha256(root, plistBytes) {
  const code = 'EXACT_BUILD_INPUT_RESOLVED_CONFIG_INVALID';
  const absoluteRoot = realpathSync(resolve(root));
  if (!Buffer.isBuffer(plistBytes)) reject(code);
  let baseConfig;
  let buildNativeFirebaseExpoConfig;
  try {
    baseConfig = parseExactJson(readBoundRegularFile(join(absoluteRoot, 'app.json'), {
      missingCode: code,
      invalidCode: code,
      maxBytes: 256 * 1024,
    }), code).expo;
    const requireFromProject = createRequire(join(absoluteRoot, 'app.config.js'));
    ({ buildNativeFirebaseExpoConfig } = requireFromProject('./config/nativeFirebaseExpoConfig.cjs'));
  } catch (error) {
    if (error instanceof ReleaseGuardError) throw error;
    reject(code);
  }
  if (typeof buildNativeFirebaseExpoConfig !== 'function') reject(code);
  let resolvedConfig;
  try {
    resolvedConfig = buildNativeFirebaseExpoConfig({
      baseConfig,
      env: {
        APP_ENV: 'production',
        CABOHEALTH_FIREBASE_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID,
        CABOHEALTH_GOOGLE_SERVICES_PLIST: PRIVATE_GOOGLE_SERVICES_PLIST_MARKER,
      },
      fileExists: (path) => path === PRIVATE_GOOGLE_SERVICES_PLIST_MARKER,
      readFile: (path) => {
        if (path !== PRIVATE_GOOGLE_SERVICES_PLIST_MARKER) throw new Error(code);
        return plistBytes.toString('utf8');
      },
      projectRoot: absoluteRoot,
    });
  } catch {
    reject(code);
  }
  if (resolvedConfig?.ios?.googleServicesFile !== PRIVATE_GOOGLE_SERVICES_PLIST_MARKER
    || resolvedConfig?.extra?.clientAccessRuntime?.expectedProjectId
      !== PRODUCTION_FIREBASE_PROJECT_ID
    || resolvedConfig?.extra?.clientAccessRuntime?.appEnvironment !== 'production'
    || resolvedConfig?.extra?.clientAccessRuntime?.enabled !== true) {
    reject(code);
  }
  return sha256(Buffer.from(JSON.stringify(resolvedConfig), 'utf8'));
}

function validateTrustedGit(code) {
  if (trustedGitVerified) return;
  try {
    if (process.platform !== 'darwin') reject(code);
    for (const directory of TRUSTED_GIT_DIRECTORIES) {
      const stat = lstatSync(directory);
      if (realpathSync(directory) !== directory
        || !stat.isDirectory() || stat.isSymbolicLink()
        || stat.uid !== 0 || stat.gid !== 0
        || (stat.mode & 0o7777) !== 0o755) reject(code);
    }
    if (realpathSync(TRUSTED_GIT_EXECUTABLE) !== TRUSTED_GIT_EXECUTABLE) reject(code);
    const executable = lstatSync(TRUSTED_GIT_EXECUTABLE);
    if (!executable.isFile() || executable.isSymbolicLink()
      || executable.uid !== 0 || executable.gid !== 0
      || (executable.mode & 0o7777) !== 0o755 || executable.size <= 0) reject(code);
    const version = spawnSync(TRUSTED_GIT_EXECUTABLE, [
      `--exec-path=${TRUSTED_GIT_EXEC_PATH}`,
      '--version',
    ], {
      cwd: '/',
      env: TRUSTED_GIT_ENVIRONMENT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
    if (version.status !== 0 || version.stdout !== TRUSTED_GIT_VERSION || version.stderr !== '') {
      reject(code);
    }
    trustedGitVerified = true;
  } catch (error) {
    if (error instanceof ReleaseGuardError && error.message === code) throw error;
    reject(code);
  }
}

function runGit(root, args, code) {
  validateTrustedGit(code);
  const result = spawnSync(TRUSTED_GIT_EXECUTABLE, [
    ...TRUSTED_GIT_OPTIONS,
    '-c', `core.worktree=${root}`,
    '-C', root,
    ...args,
  ], {
    cwd: '/',
    env: TRUSTED_GIT_ENVIRONMENT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) reject(code);
  return result.stdout;
}

function cleanTrackedEntries(root) {
  const status = runGit(
    root,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'BUILD_SOURCE_STATUS_INVALID',
  );
  if (status !== '') reject('BUILD_SOURCE_NOT_CLEAN');

  const listing = runGit(root, ['ls-files', '-s', '-z'], 'BUILD_SOURCE_INVENTORY_INVALID');
  const rawEntries = listing.split('\0').filter(Boolean);
  const entries = [];
  let previousPath = null;
  for (const entry of rawEntries) {
    const match = entry.match(/^(100644|100755) [a-f0-9]+ 0\t([^\0]+)$/u);
    if (!match) reject('BUILD_SOURCE_INVENTORY_INVALID');
    const [, mode, relativePath] = match;
    if (relativePath.includes('\\')
      || relativePath.startsWith('/')
      || relativePath.split('/').includes('..')) {
      reject('BUILD_SOURCE_INVENTORY_INVALID');
    }
    if (previousPath !== null && relativePath <= previousPath) {
      reject('BUILD_SOURCE_INVENTORY_INVALID');
    }
    previousPath = relativePath;
    entries.push({ mode, relativePath });
  }
  return entries;
}

function writeExclusiveFile(path, bytes, mode, code) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      mode,
    );
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== mode
      || stat.size !== bytes.length) reject(code);
  } catch {
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function ensurePrivateDirectoryTree(root, relativeDirectory, code) {
  const absoluteRoot = resolve(root);
  const segments = relativeDirectory === '' ? [] : relativeDirectory.split('/');
  let directory = absoluteRoot;
  try {
    for (const segment of segments) {
      if (segment === '' || segment === '.' || segment === '..') reject(code);
      directory = join(directory, segment);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) {
        reject(code);
      }
    }
  } catch (error) {
    if (error instanceof ReleaseGuardError) throw error;
    reject(code);
  }
}

function digestTrackedEntries(root, entries, snapshotRoot = null) {
  const digest = createHash('sha256');
  for (const { mode, relativePath } of entries) {
    const originalBytes = readBoundRegularFile(join(root, relativePath), {
      missingCode: 'BUILD_SOURCE_FILE_INVALID',
      invalidCode: 'BUILD_SOURCE_FILE_INVALID',
    });
    if (snapshotRoot !== null) {
      ensurePrivateDirectoryTree(
        snapshotRoot,
        dirname(relativePath) === '.' ? '' : dirname(relativePath),
        'PRIVATE_BUILD_SNAPSHOT_INVALID',
      );
      writeExclusiveFile(
        join(snapshotRoot, relativePath),
        originalBytes,
        mode === '100755' ? 0o755 : 0o644,
        'PRIVATE_BUILD_SNAPSHOT_INVALID',
      );
    }
    if (SOURCE_DIGEST_EXCLUSIONS.has(relativePath)) continue;

    let bytes = originalBytes;
    if (relativePath === 'scripts/release-command-guard.mjs') {
      bytes = normalizeReleaseGuardAuthority(bytes);
    }
    digest.update(mode);
    digest.update('\0');
    digest.update(relativePath);
    digest.update('\0');
    digest.update(sha256(bytes));
    digest.update('\0');
  }
  return digest.digest('hex');
}

export function computeTrackedSourceSha256(root) {
  return digestTrackedEntries(root, cleanTrackedEntries(root));
}

function validatePrivateParent(privateParent) {
  const parent = realpathSync(resolve(privateParent ?? tmpdir()));
  const stat = lstatSync(parent);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid) {
    reject('PRIVATE_OPERATION_PARENT_INVALID');
  }
  return parent;
}

function createPrivateOperationRoot(kind, { privateParent } = {}) {
  if (!/^[a-z-]+$/u.test(kind)) reject('PRIVATE_OPERATION_INVALID');
  const parent = validatePrivateParent(privateParent);
  let operationRoot;
  try {
    operationRoot = mkdtempSync(join(parent, `${PRIVATE_OPERATION_PREFIX}${kind}-`));
    chmodSync(operationRoot, 0o700);
    writeExclusiveFile(
      join(operationRoot, PRIVATE_OPERATION_MARKER),
      Buffer.from(`${kind}\n`, 'utf8'),
      0o600,
      'PRIVATE_OPERATION_INVALID',
    );
  } catch (error) {
    if (error instanceof ReleaseGuardError) throw error;
    reject('PRIVATE_OPERATION_INVALID');
  }
  return { operationRoot: realpathSync(operationRoot), parent };
}

export function removePrivateOperationSnapshot(operationRoot, { privateParent } = {}) {
  const parent = validatePrivateParent(privateParent);
  const absoluteRoot = resolve(operationRoot);
  let stat;
  try {
    stat = lstatSync(absoluteRoot);
  } catch {
    reject('PRIVATE_OPERATION_CLEANUP_INVALID');
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (dirname(absoluteRoot) !== parent
    || !basename(absoluteRoot).startsWith(PRIVATE_OPERATION_PREFIX)
    || !stat.isDirectory()
    || stat.isSymbolicLink()
    || stat.uid !== currentUid
    || (stat.mode & 0o777) !== 0o700
    || realpathSync(absoluteRoot) !== absoluteRoot) {
    reject('PRIVATE_OPERATION_CLEANUP_INVALID');
  }
  const marker = readBoundRegularFile(join(absoluteRoot, PRIVATE_OPERATION_MARKER), {
    missingCode: 'PRIVATE_OPERATION_CLEANUP_INVALID',
    invalidCode: 'PRIVATE_OPERATION_CLEANUP_INVALID',
    privateMode: 0o600,
    maxBytes: 128,
  }).toString('utf8');
  if (!/^[a-z-]+\n$/u.test(marker)) reject('PRIVATE_OPERATION_CLEANUP_INVALID');
  rmSync(absoluteRoot, { recursive: true, force: false });
}

export function createPrivateBuildSnapshot(root, expectedSourceSha256, options = {}) {
  assertSha256(expectedSourceSha256, 'PRIVATE_BUILD_SNAPSHOT_INVALID');
  const sourceRoot = realpathSync(resolve(root));
  const { operationRoot } = createPrivateOperationRoot('build', options);
  const workspaceRoot = join(operationRoot, 'workspace');
  try {
    mkdirSync(workspaceRoot, { mode: 0o700 });
    chmodSync(workspaceRoot, 0o700);
    if (isWithin(sourceRoot, operationRoot)) reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
    assertOutsideSynchronizedWorkspace(
      sourceRoot,
      operationRoot,
      'PRIVATE_BUILD_SNAPSHOT_INVALID',
    );
    const actualSha256 = digestTrackedEntries(
      sourceRoot,
      cleanTrackedEntries(sourceRoot),
      workspaceRoot,
    );
    if (actualSha256 !== expectedSourceSha256) reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
    verifyPrivateBuildSnapshot(workspaceRoot, expectedSourceSha256);
    fsyncDirectory(operationRoot, 'PRIVATE_BUILD_SNAPSHOT_INVALID');
    return { operationRoot, workspaceRoot };
  } catch (error) {
    try {
      removePrivateOperationSnapshot(operationRoot, options);
    } catch {
      // Preserve the original fail-closed reason; the uniquely named directory
      // can then be inspected and removed manually.
    }
    throw error;
  }
}

export function verifyPrivateBuildSnapshot(workspaceRoot, expectedSourceSha256) {
  assertSha256(expectedSourceSha256, 'PRIVATE_BUILD_SNAPSHOT_INVALID');
  const root = realpathSync(resolve(workspaceRoot));
  const rootStat = lstatSync(root);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : rootStat.uid;
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== currentUid
    || (rootStat.mode & 0o777) !== 0o700) {
    reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
  }
  const entries = [];
  function visit(relativeDirectory) {
    const directory = relativeDirectory ? join(root, relativeDirectory) : root;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(root, relativePath);
      const stat = lstatSync(absolutePath);
      if (stat.uid !== currentUid || stat.isSymbolicLink()) {
        reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
      }
      if (stat.isDirectory()) {
        if ((stat.mode & 0o777) !== 0o700) reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
        visit(relativePath);
      } else if (stat.isFile()) {
        const privateMode = stat.mode & 0o777;
        if (![0o644, 0o755].includes(privateMode)) {
          reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
        }
        entries.push({
          mode: privateMode === 0o755 ? '100755' : '100644',
          relativePath,
        });
      } else {
        reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
      }
    }
  }
  visit('');
  entries.sort((left, right) => Buffer.compare(
    Buffer.from(left.relativePath, 'utf8'),
    Buffer.from(right.relativePath, 'utf8'),
  ));
  const digest = createHash('sha256');
  for (const { mode, relativePath } of entries) {
    if (SOURCE_DIGEST_EXCLUSIONS.has(relativePath)) continue;
    let bytes = readBoundRegularFile(join(root, relativePath), {
      missingCode: 'PRIVATE_BUILD_SNAPSHOT_INVALID',
      invalidCode: 'PRIVATE_BUILD_SNAPSHOT_INVALID',
    });
    if (relativePath === 'scripts/release-command-guard.mjs') {
      bytes = normalizeReleaseGuardAuthority(bytes);
    }
    digest.update(`${mode}\0${relativePath}\0${sha256(bytes)}\0`);
  }
  const actualSha256 = digest.digest('hex');
  if (actualSha256 !== expectedSourceSha256) reject('PRIVATE_BUILD_SNAPSHOT_INVALID');
  return actualSha256;
}

export function verifyPrivateUploadIpa(ipaPath, expectedSha256) {
  assertSha256(expectedSha256, 'PRIVATE_UPLOAD_IPA_INVALID');
  const actual = sha256(readBoundRegularFile(resolve(ipaPath), {
    missingCode: 'PRIVATE_UPLOAD_IPA_INVALID',
    invalidCode: 'PRIVATE_UPLOAD_IPA_INVALID',
    privateMode: 0o600,
  }));
  if (actual !== expectedSha256) reject('PRIVATE_UPLOAD_IPA_INVALID');
  return actual;
}

export function createPrivateUploadSnapshot(sourceIpaPath, expectedSha256, options = {}) {
  const absoluteSourceIpaPath = resolve(sourceIpaPath);
  const bytes = readBoundRegularFile(absoluteSourceIpaPath, {
    missingCode: 'PRIVATE_UPLOAD_IPA_INVALID',
    invalidCode: 'PRIVATE_UPLOAD_IPA_INVALID',
    privateMode: 0o600,
  });
  if (sha256(bytes) !== expectedSha256) reject('PRIVATE_UPLOAD_IPA_INVALID');
  const { operationRoot } = createPrivateOperationRoot('upload', options);
  const ipaPath = join(operationRoot, 'payload', basename(PRIVATE_EVIDENCE_PATHS.ipa));
  try {
    assertOutsideSynchronizedWorkspace(
      absoluteSourceIpaPath,
      operationRoot,
      'PRIVATE_UPLOAD_IPA_INVALID',
    );
    ensurePrivateDirectoryTree(operationRoot, 'payload', 'PRIVATE_UPLOAD_IPA_INVALID');
    writeExclusiveFile(ipaPath, bytes, 0o600, 'PRIVATE_UPLOAD_IPA_INVALID');
    verifyPrivateUploadIpa(ipaPath, expectedSha256);
    fsyncDirectory(operationRoot, 'PRIVATE_UPLOAD_IPA_INVALID');
    return { operationRoot, ipaPath };
  } catch (error) {
    try {
      removePrivateOperationSnapshot(operationRoot, options);
    } catch {
      // Preserve the original error as above.
    }
    throw error;
  }
}

function copyRuntimeTree(sourceDirectory, destinationDirectory) {
  const sourceRoot = realpathSync(resolve(sourceDirectory));
  try {
    mkdirSync(destinationDirectory, { mode: 0o700 });
    chmodSync(destinationDirectory, 0o700);
  } catch {
    reject('PRIVATE_TOOL_SNAPSHOT_INVALID');
  }
  function visit(relativeDirectory) {
    const source = relativeDirectory ? join(sourceRoot, relativeDirectory) : sourceRoot;
    const destination = relativeDirectory
      ? join(destinationDirectory, relativeDirectory)
      : destinationDirectory;
    const entries = readdirSync(source, { withFileTypes: true })
      .sort((left, right) => Buffer.compare(
        Buffer.from(left.name, 'utf8'),
        Buffer.from(right.name, 'utf8'),
      ));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const sourcePath = join(sourceRoot, relativePath);
      const destinationPath = join(destinationDirectory, relativePath);
      const stat = lstatSync(sourcePath);
      const mode = stat.mode & 0o777;
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        mkdirSync(destinationPath, { mode });
        chmodSync(destinationPath, mode);
        visit(relativePath);
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        const bytes = readBoundRegularFile(sourcePath, {
          missingCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
          invalidCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
        });
        writeExclusiveFile(
          destinationPath,
          bytes,
          mode,
          'PRIVATE_TOOL_SNAPSHOT_INVALID',
        );
      } else if (stat.isSymbolicLink()) {
        const link = readlinkSync(sourcePath);
        if (isAbsolute(link)
          || !isWithin(sourceRoot, realpathSync(resolve(dirname(sourcePath), link)))) {
          reject('PRIVATE_TOOL_SNAPSHOT_INVALID');
        }
        symlinkSync(link, destinationPath);
      } else {
        reject('PRIVATE_TOOL_SNAPSHOT_INVALID');
      }
    }
    fsyncDirectory(destination, 'PRIVATE_TOOL_SNAPSHOT_INVALID');
  }
  visit('');
}

export function verifyPrivateNodeToolSnapshot(privateTool, pin) {
  if (!hasExactKeys(privateTool, ['executable', 'nodeExecutable', 'runtimeRoot'])
    || !pin
    || !hasExactKeys(pin, PINNED_NODE_TOOL_KEYS)) {
    reject('PRIVATE_TOOL_SNAPSHOT_INVALID');
  }
  const runtimeRoot = realpathSync(resolve(privateTool.runtimeRoot));
  const executable = resolve(runtimeRoot, pin.entryRelativePath);
  const nodeExecutable = realpathSync(resolve(privateTool.nodeExecutable));
  if (privateTool.executable !== executable
    || privateTool.nodeExecutable !== nodeExecutable
    || !isWithin(dirname(runtimeRoot), nodeExecutable)
    || computeRuntimeTreeSha256(runtimeRoot) !== pin.runtimeTreeSha256) {
    reject('PRIVATE_TOOL_SNAPSHOT_INVALID');
  }
  readBoundRegularFile(executable, {
    missingCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
    invalidCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
  });
  const nodeBytes = readBoundRegularFile(nodeExecutable, {
    missingCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
    invalidCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
  });
  if (sha256(nodeBytes) !== pin.nodeExecutableSha256) {
    reject('PRIVATE_TOOL_SNAPSHOT_INVALID');
  }
  return privateTool;
}

export function snapshotPinnedNodeTool(operationRoot, resolvedTool, pin) {
  const absoluteOperationRoot = realpathSync(resolve(operationRoot));
  // The source tool must be outside the new private operation; otherwise a
  // nested copy could recursively include itself.
  if (isWithin(absoluteOperationRoot, resolvedTool.runtimeRoot)) {
    reject('PRIVATE_TOOL_SNAPSHOT_INVALID');
  }
  // Place the reviewed dependency closure at the standard parent node_modules
  // location. The tracked workspace snapshot intentionally contains no
  // dependencies; Expo app.config/plugin resolution must therefore resolve
  // through this private, rehashed runtime rather than Dropbox or the source
  // worktree.
  const runtimeRoot = join(absoluteOperationRoot, 'node_modules');
  copyRuntimeTree(resolvedTool.runtimeRoot, runtimeRoot);
  const nodeDirectory = join(absoluteOperationRoot, 'node-runtime');
  mkdirSync(nodeDirectory, { mode: 0o700 });
  chmodSync(nodeDirectory, 0o700);
  const nodeExecutable = join(nodeDirectory, 'node');
  writeExclusiveFile(
    nodeExecutable,
    readBoundRegularFile(resolvedTool.nodeExecutable, {
      missingCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
      invalidCode: 'PRIVATE_TOOL_SNAPSHOT_INVALID',
    }),
    0o700,
    'PRIVATE_TOOL_SNAPSHOT_INVALID',
  );
  const privateTool = {
    executable: join(runtimeRoot, pin.entryRelativePath),
    nodeExecutable,
    runtimeRoot,
  };
  return verifyPrivateNodeToolSnapshot(privateTool, pin);
}

function readPinnedAttestation(root, {
  relativePath,
  expectedSha256,
  missingCode,
  invalidCode,
}) {
  if (!SHA256_PATTERN.test(expectedSha256 ?? '')) reject(missingCode);
  const bytes = readBoundRegularFile(join(root, relativePath), {
    missingCode,
    invalidCode,
    maxBytes: 128 * 1024,
  });
  if (sha256(bytes) !== expectedSha256) reject(invalidCode);
  return parseExactJson(bytes, invalidCode);
}

function easToolAuthorityFromBuildInput(attestation, code) {
  const pin = {
    entryRelativePath: attestation.easCli?.entryRelativePath,
    nodeExecutableSha256: attestation.nodeRuntime?.executableSha256,
    nodeVersion: attestation.nodeRuntime?.version,
    packageJsonRelativePath: attestation.easCli?.packageJsonRelativePath,
    packageVersion: attestation.easCli?.packageVersion,
    runtimeRootRelativePath: attestation.easCli?.runtimeRootRelativePath,
    runtimeTreeSha256: attestation.easCli?.runtimeTreeSha256,
  };
  if (!hasExactKeys(pin, PINNED_NODE_TOOL_KEYS)) reject(code);
  return pin;
}

const AUTHORITY_GUARD_PATH = 'scripts/release-command-guard.mjs';
const POST_ARTIFACT_FINALIZATION_RULES = Object.freeze([
  Object.freeze([
    Object.freeze({ status: 'M', relativePath: SCREENSHOTS_MANIFEST_PATH }),
  ]),
  Object.freeze([
    Object.freeze({ status: 'M', relativePath: APP_PRIVACY_PATH }),
    Object.freeze({ status: 'M', relativePath: REVIEW_NOTES_PATH }),
  ]),
]);
const PHASE_AUTHORITY_RULES = Object.freeze([
  Object.freeze({
    phase: 'input',
    pinName: 'BUILD_INPUT_ATTESTATION_SHA256',
    expectedKey: 'buildInputSha256',
    attestationPath: ATTESTATION_PATHS.buildInput,
  }),
  Object.freeze({
    phase: 'artifact',
    pinName: 'BUILD_ARTIFACT_ATTESTATION_SHA256',
    expectedKey: 'buildArtifactSha256',
    attestationPath: ATTESTATION_PATHS.buildArtifact,
  }),
  Object.freeze({
    phase: 'rc',
    pinName: 'RC_ATTESTATION_SHA256',
    expectedKey: 'rcSha256',
    attestationPath: ATTESTATION_PATHS.rc,
  }),
  Object.freeze({
    phase: 'submit-tool',
    pinName: 'PINNED_APP_STORE_SUBMIT_ADAPTER',
    expectedKey: 'submitAdapterPin',
    attestationPath: null,
  }),
]);

function authorityCodeForPhase(phase) {
  if (phase === 'input') return 'EXACT_BUILD_INPUT_ATTESTATION_INVALID';
  if (phase === 'artifact') return 'EXACT_BUILD_ARTIFACT_ATTESTATION_INVALID';
  if (phase === 'rc') return 'EXACT_RC_ATTESTATION_INVALID';
  if (phase === 'submit-tool') return 'APP_STORE_SUBMIT_ADAPTER_PIN_INVALID';
  return 'BUILD_SOURCE_PHASE_INVALID';
}

function parseAuthorityPins(bytes, code) {
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) reject(code);
  const pins = {};
  for (const [name, allowedValue] of NORMALIZED_PIN_RULES) {
    const declaration = new RegExp(`^const ${name} = ([^\\r\\n]*);$`, 'gmu');
    const matches = [...source.matchAll(declaration)];
    if (matches.length !== 1 || !allowedValue.test(matches[0][1])) reject(code);
    const literal = matches[0][1];
    pins[name] = literal === 'null' ? null : literal.slice(1, -1);
  }
  return pins;
}

function guardBytesAtCommit(root, commit, code) {
  return Buffer.from(runGit(root, ['show', `${commit}:${AUTHORITY_GUARD_PATH}`], code), 'utf8');
}

function changedEntriesForCommit(root, parent, commit, code) {
  const fields = runGit(root, [
    'diff-tree', '--no-commit-id', '--name-status', '-r', '-z', parent, commit,
  ], code).split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    if (!/^[AM]$/u.test(status) || index + 1 >= fields.length) reject(code);
    entries.push({ status, relativePath: fields[index + 1] });
    index += 2;
  }
  return entries;
}

export function verifyPhaseAuthorityCommitHistory(root, sourceCommit, phase, expectedPins) {
  const code = authorityCodeForPhase(phase);
  const requestedIndex = PHASE_AUTHORITY_RULES.findIndex((rule) => rule.phase === phase);
  if (requestedIndex < 0 || !COMMIT_PATTERN.test(sourceCommit ?? '')) reject(code);
  runGit(root, ['cat-file', '-e', `${sourceCommit}^{commit}`], code);
  runGit(root, ['merge-base', '--is-ancestor', sourceCommit, 'HEAD'], code);

  const baseGuardBytes = guardBytesAtCommit(root, sourceCommit, code);
  const basePins = parseAuthorityPins(baseGuardBytes, code);
  if (Object.values(basePins).some((value) => value !== null)) reject(code);

  const commits = runGit(
    root,
    ['rev-list', '--reverse', '--ancestry-path', `${sourceCommit}..HEAD`],
    code,
  ).split('\n').filter(Boolean);
  let completedPhases = 0;
  let completedFinalizations = 0;
  let previousGuardBytes = baseGuardBytes;
  let previousCommit = sourceCommit;
  for (const commit of commits) {
    const parents = runGit(root, ['rev-list', '--parents', '-n', '1', commit], code)
      .trim().split(/\s+/u);
    if (parents.length !== 2 || parents[1] !== previousCommit) reject(code);
    const entries = changedEntriesForCommit(root, previousCommit, commit, code);
    const guardEntry = entries.find((entry) => entry.relativePath === AUTHORITY_GUARD_PATH);

    if (!guardEntry) {
      if (completedPhases !== 2
        || requestedIndex < 2
        || completedFinalizations >= POST_ARTIFACT_FINALIZATION_RULES.length) reject(code);
      const expectedEntries = POST_ARTIFACT_FINALIZATION_RULES[completedFinalizations];
      if (!isDeepStrictEqual(
        [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        [...expectedEntries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      )) reject(code);
      completedFinalizations += 1;
      previousCommit = commit;
      continue;
    }

    if (guardEntry.status !== 'M' || completedPhases > requestedIndex) reject(code);
    const rule = PHASE_AUTHORITY_RULES[completedPhases];
    if (rule.phase === 'rc'
      && completedFinalizations !== POST_ARTIFACT_FINALIZATION_RULES.length) reject(code);
    const expectedEntries = rule.attestationPath === null
      ? [{ status: 'M', relativePath: AUTHORITY_GUARD_PATH }]
      : [
        { status: 'A', relativePath: rule.attestationPath },
        { status: 'M', relativePath: AUTHORITY_GUARD_PATH },
      ];
    if (!isDeepStrictEqual(
      [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      expectedEntries.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    )) reject(code);

    const currentGuardBytes = guardBytesAtCommit(root, commit, code);
    const previousPins = parseAuthorityPins(previousGuardBytes, code);
    const currentPins = parseAuthorityPins(currentGuardBytes, code);
    const changedPins = Object.keys(currentPins)
      .filter((name) => currentPins[name] !== previousPins[name]);
    const expectedValue = expectedPins?.[rule.expectedKey];
    if (changedPins.length !== 1
      || changedPins[0] !== rule.pinName
      || previousPins[rule.pinName] !== null
      || currentPins[rule.pinName] !== expectedValue
      || typeof expectedValue !== 'string') {
      reject(code);
    }
    try {
      if (!normalizeReleaseGuardAuthority(previousGuardBytes)
        .equals(normalizeReleaseGuardAuthority(currentGuardBytes))) reject(code);
    } catch {
      reject(code);
    }
    if (rule.attestationPath !== null) {
      const attestationBytes = Buffer.from(
        runGit(root, ['show', `${commit}:${rule.attestationPath}`], code),
        'utf8',
      );
      if (sha256(attestationBytes) !== expectedValue) reject(code);
    }
    completedPhases += 1;
    previousGuardBytes = currentGuardBytes;
    previousCommit = commit;
  }

  if (completedPhases !== requestedIndex + 1) reject(code);
  if (requestedIndex >= 2
    && completedFinalizations !== POST_ARTIFACT_FINALIZATION_RULES.length) reject(code);
  const finalPins = parseAuthorityPins(guardBytesAtCommit(root, 'HEAD', code), code);
  for (let index = 0; index < PHASE_AUTHORITY_RULES.length; index += 1) {
    const rule = PHASE_AUTHORITY_RULES[index];
    const expectedValue = index <= requestedIndex ? expectedPins?.[rule.expectedKey] : null;
    if (finalPins[rule.pinName] !== expectedValue) reject(code);
  }
  if (finalPins.PINNED_EAS_CLI !== null) reject(code);
}

function verifyFrozenSourceCommit(root, sourceCommit, phase, expectedPins) {
  verifyPhaseAuthorityCommitHistory(root, sourceCommit, phase, expectedPins);
}

export function verifyBuildInputAttestation(root, expectedSha256, {
  phase = 'input',
  phasePins = {},
} = {}) {
  const code = 'EXACT_BUILD_INPUT_ATTESTATION_INVALID';
  const attestation = readPinnedAttestation(root, {
    relativePath: ATTESTATION_PATHS.buildInput,
    expectedSha256,
    missingCode: 'EXACT_BUILD_INPUT_ATTESTATION_MISSING',
    invalidCode: code,
  });
  if (!hasExactKeys(attestation, BUILD_INPUT_KEYS)
    || attestation.schemaVersion !== 1
    || attestation.artifactKind !== 'cabohealth-ios-build-input-attestation') {
    reject(code);
  }
  assertCandidate(attestation.candidate, code);
  assertReviewedAt(attestation.reviewedAt, code);
  verifyFrozenSourceCommit(root, attestation.sourceCommit, phase, {
    buildInputSha256: expectedSha256,
    ...phasePins,
  });
  for (const key of BUILD_INPUT_KEYS.filter((key) => key.endsWith('Sha256'))) {
    assertSha256(attestation[key], code);
  }
  const easPin = easToolAuthorityFromBuildInput(attestation, code);
  const resolvedEasCli = resolvePinnedNodeTool(root, easPin, code, code);
  const nodeExecutableSha256 = sha256(readBoundRegularFile(resolvedEasCli.nodeExecutable, {
    missingCode: code,
    invalidCode: code,
  }));
  const googleServicesPlist = readProductionGoogleServicesPlist();
  const environmentInventoryBytes = Buffer.from(
    `${JSON.stringify(attestation.easEnvironment)}\n`,
    'utf8',
  );
  if (attestation.sourceTreeSha256 !== computeTrackedSourceSha256(root)
    || attestation.appJsonSha256 !== hashProjectFile(root, 'app.json', code)
    || attestation.configSha256 !== hashProjectFile(root, 'constants/config.ts', code)
    || attestation.packageLockSha256 !== hashProjectFile(root, 'package-lock.json', code)
    || attestation.releaseManifestSha256 !== hashProjectFile(
      root,
      'release/app-store/3.0/release-manifest.json',
      code,
    )
    || attestation.releaseVerifierSha256 !== hashProjectFile(
      root,
      'scripts/verify-release-v3.mjs',
      code,
    )
    || attestation.metadataVerifierSha256 !== hashProjectFile(
      root,
      'scripts/verify-app-store-metadata.mjs',
      code,
    )
    || attestation.firebaseProjectId !== PRODUCTION_FIREBASE_PROJECT_ID
    || attestation.nodeRuntime?.version !== process.version
    || attestation.nodeRuntime?.version !== 'v22.22.3'
    || attestation.nodeRuntime?.executableSha256 !== nodeExecutableSha256
    || !isDeepStrictEqual(attestation.easEnvironment, EXPECTED_EAS_ENVIRONMENT)
    || attestation.easEnvironmentInventorySha256 !== sha256(environmentInventoryBytes)
    || attestation.googleServicesPlistSha256 !== googleServicesPlist.sha256
    || attestation.resolvedProductionExpoConfigSha256
      !== computeResolvedProductionExpoConfigSha256(root, googleServicesPlist.bytes)) {
    reject(code);
  }
  return attestation;
}

export function verifyBuildArtifactAttestation(root, {
  buildInputSha256,
  buildArtifactSha256,
}, { phase = 'artifact', phasePins = {} } = {}) {
  const code = 'EXACT_BUILD_ARTIFACT_ATTESTATION_INVALID';
  if (!SHA256_PATTERN.test(buildArtifactSha256 ?? '')) {
    reject('EXACT_BUILD_ARTIFACT_ATTESTATION_MISSING');
  }
  const buildInput = verifyBuildInputAttestation(root, buildInputSha256, {
    phase,
    phasePins: { buildArtifactSha256, ...phasePins },
  });
  const attestation = readPinnedAttestation(root, {
    relativePath: ATTESTATION_PATHS.buildArtifact,
    expectedSha256: buildArtifactSha256,
    missingCode: 'EXACT_BUILD_ARTIFACT_ATTESTATION_MISSING',
    invalidCode: code,
  });
  if (!hasExactKeys(attestation, BUILD_ARTIFACT_KEYS)
    || attestation.schemaVersion !== 1
    || attestation.artifactKind !== 'cabohealth-ios-build-artifact-attestation') {
    reject(code);
  }
  assertCandidate(attestation.candidate, code);
  assertReviewedAt(attestation.reviewedAt, code);
  if (!hasExactKeys(attestation.easArtifactAssociation, [
    'evidenceType',
    'buildId',
    'buildStatus',
    'downloadedIpaSha256',
    'associationGuardProven',
    'reviewedAt',
  ])) reject(code);
  assertReviewedAt(attestation.easArtifactAssociation.reviewedAt, code);
  validateBuildArtifactReviewChronology(
    attestation.easArtifactAssociation.reviewedAt,
    attestation.reviewedAt,
  );
  for (const key of BUILD_ARTIFACT_KEYS.filter((key) => key.endsWith('Sha256'))) {
    assertSha256(attestation[key], code);
  }
  const sourceGoogleServicesPlist = readProductionGoogleServicesPlist();
  const embeddedGoogleServicesPlist = readBoundRegularFile(
    join(root, PRIVATE_EVIDENCE_PATHS.embeddedGoogleServicesPlist),
    {
      missingCode: code,
      invalidCode: code,
      privateMode: 0o600,
      maxBytes: 256 * 1024,
    },
  );
  const privacyReportBytes = readBoundRegularFile(
    join(root, PRIVATE_EVIDENCE_PATHS.privacyReport),
    {
      missingCode: code,
      invalidCode: code,
      privateMode: 0o600,
      maxBytes: 64 * 1024 * 1024,
    },
  );
  if (attestation.buildInputAttestationSha256 !== buildInputSha256
    || attestation.sourceTreeSha256 !== buildInput.sourceTreeSha256
    || !UUID_PATTERN.test(attestation.easBuildId)
    || attestation.easArtifactAssociation.evidenceType
      !== 'independently-reviewed-procedural'
    || attestation.easArtifactAssociation.buildId !== attestation.easBuildId
    || attestation.easArtifactAssociation.buildStatus !== 'FINISHED'
    || attestation.easArtifactAssociation.downloadedIpaSha256 !== attestation.ipaSha256
    || attestation.easArtifactAssociation.associationGuardProven !== false
    || attestation.ipaSha256 !== hashPrivateEvidenceFile(
      root,
      PRIVATE_EVIDENCE_PATHS.ipa,
      code,
    )
    || attestation.signedEntitlementsSha256 !== hashPrivateEvidenceFile(
      root,
      PRIVATE_EVIDENCE_PATHS.signedEntitlements,
      code,
    )
    || attestation.privacyReportSha256 !== sha256(privacyReportBytes)
    || attestation.embeddedGoogleServicesPlistSha256 !== sha256(embeddedGoogleServicesPlist)
    || !googleServicesPlistsHaveSameContent(
      sourceGoogleServicesPlist.bytes,
      embeddedGoogleServicesPlist,
    )
    || attestation.signingCertificateSha256 !== hashPrivateEvidenceFile(
      root,
      PRIVATE_EVIDENCE_PATHS.signingCertificate,
      code,
    )
    || attestation.embeddedProvisioningProfileSha256 !== hashPrivateEvidenceFile(
      root,
      PRIVATE_EVIDENCE_PATHS.embeddedProvisioningProfile,
      code,
    )) {
    reject(code);
  }
  try {
    validateIpaPrivacyReport(parseExactJson(privacyReportBytes, code), {
      ipaSha256: attestation.ipaSha256,
      signedEntitlementsSha256: attestation.signedEntitlementsSha256,
      signingCertificateSha256: attestation.signingCertificateSha256,
      embeddedProvisioningProfileSha256: attestation.embeddedProvisioningProfileSha256,
      sourceGoogleServicesPlistSha256: buildInput.googleServicesPlistSha256,
      embeddedGoogleServicesPlistSha256: attestation.embeddedGoogleServicesPlistSha256,
    });
  } catch {
    reject(code);
  }
  return attestation;
}

export function verifyRcAttestation(root, {
  buildInputSha256,
  buildArtifactSha256,
  rcSha256,
}, { phase = 'rc', phasePins = {} } = {}) {
  const code = 'EXACT_RC_ATTESTATION_INVALID';
  if (!SHA256_PATTERN.test(rcSha256 ?? '')) reject('EXACT_RC_ATTESTATION_MISSING');
  const buildArtifact = verifyBuildArtifactAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
  }, { phase, phasePins: { rcSha256, ...phasePins } });
  const attestation = readPinnedAttestation(root, {
    relativePath: ATTESTATION_PATHS.rc,
    expectedSha256: rcSha256,
    missingCode: 'EXACT_RC_ATTESTATION_MISSING',
    invalidCode: code,
  });
  if (!hasExactKeys(attestation, RC_KEYS)
    || attestation.schemaVersion !== 1
    || attestation.artifactKind !== 'cabohealth-ios-exact-rc-attestation') {
    reject(code);
  }
  assertCandidate(attestation.candidate, code);
  assertReviewedAt(attestation.reviewedAt, code);
  assertReviewedAt(attestation.testFlightProcessedAt, code);
  for (const key of RC_KEYS.filter((key) => key.endsWith('Sha256'))) {
    assertSha256(attestation[key], code);
  }
  const physicalIphoneQaBytes = readBoundRegularFile(
    join(root, PRIVATE_EVIDENCE_PATHS.physicalIphoneQa),
    {
      missingCode: code,
      invalidCode: code,
      privateMode: 0o600,
      maxBytes: 1024 * 1024,
    },
  );
  const appStoreConnectEvidenceBytes = readBoundRegularFile(
    join(root, PRIVATE_EVIDENCE_PATHS.appStoreConnectEvidence),
    {
      missingCode: code,
      invalidCode: code,
      privateMode: 0o600,
      maxBytes: 1024 * 1024,
    },
  );
  const screenshotsManifestBytes = readBoundRegularFile(
    join(root, SCREENSHOTS_MANIFEST_PATH),
    {
      missingCode: code,
      invalidCode: code,
      maxBytes: 1024 * 1024,
    },
  );
  const appPrivacyBytes = readBoundRegularFile(join(root, APP_PRIVACY_PATH), {
    missingCode: code,
    invalidCode: code,
    maxBytes: 1024 * 1024,
  });
  const reviewNotesBytes = readBoundRegularFile(join(root, REVIEW_NOTES_PATH), {
    missingCode: code,
    invalidCode: code,
    maxBytes: 1024 * 1024,
  });
  if (attestation.buildArtifactAttestationSha256 !== buildArtifactSha256
    || attestation.sourceTreeSha256 !== buildArtifact.sourceTreeSha256
    || typeof attestation.testFlightBuildId !== 'string'
    || !/^\d+$/u.test(attestation.testFlightBuildId)
    || attestation.physicalIphoneQaSha256 !== sha256(physicalIphoneQaBytes)
    || attestation.screenshotsManifestSha256 !== sha256(screenshotsManifestBytes)
    || attestation.appPrivacySha256 !== sha256(appPrivacyBytes)
    || attestation.reviewNotesSha256 !== sha256(reviewNotesBytes)
    || attestation.appStoreMetadataEvidenceSha256 !== sha256(appStoreConnectEvidenceBytes)) {
    reject(code);
  }
  const now = Date.now();
  try {
    const bindings = {
      testFlightBuildId: attestation.testFlightBuildId,
      sourceTreeSha256: attestation.sourceTreeSha256,
      testFlightProcessedAt: attestation.testFlightProcessedAt,
    };
    const physicalIphoneQa = parseExactJson(physicalIphoneQaBytes, code);
    const appStoreConnectEvidence = parseExactJson(appStoreConnectEvidenceBytes, code);
    const screenshotsManifest = parseExactJson(screenshotsManifestBytes, code);
    validatePhysicalIphoneQaEvidence(physicalIphoneQa, bindings, { now });
    validateAppStoreConnectEvidence(
      appStoreConnectEvidence,
      bindings,
      { now },
    );
    validateScreenshotsManifest(screenshotsManifest, {
      phase: 'final',
      ...bindings,
      now,
      evidenceRoot: join(root, 'release/private/rc-build-11'),
      requireFiles: true,
    });
    validateRcReviewChronology({
      buildArtifactReviewedAt: buildArtifact.reviewedAt,
      testFlightProcessedAt: attestation.testFlightProcessedAt,
      physicalIphoneQaPerformedAt: physicalIphoneQa.performedAt,
      physicalIphoneQaReviewedAt: physicalIphoneQa.reviewedAt,
      appStoreConnectCapturedAt: appStoreConnectEvidence.capturedAt,
      appStoreConnectReviewedAt: appStoreConnectEvidence.reviewedAt,
      screenshotCapturedAts: screenshotsManifest.captures.map((capture) => capture.capturedAt),
      rcReviewedAt: attestation.reviewedAt,
    }, now);
  } catch {
    reject(code);
  }
  return attestation;
}

export function confirmationChallengeForAuthorization(authorization) {
  const {
    action,
    rcAttestationSha256,
    issuedAtMs,
    expiresAtMs,
    nonce,
  } = authorization ?? {};
  if (action !== 'submit-for-review'
    || !SHA256_PATTERN.test(rcAttestationSha256 ?? '')
    || !Number.isSafeInteger(issuedAtMs)
    || !Number.isSafeInteger(expiresAtMs)
    || !NONCE_128_PATTERN.test(nonce ?? '')) {
    reject('SUBMIT_AUTHORIZATION_INVALID');
  }
  // This public, deterministic challenge binds the human confirmation phrase
  // to one RC and time window. It is deliberately not described as a
  // signature: without a user-held secret it cannot authenticate identity.
  return sha256(Buffer.from([
    'cabohealth-submit-confirmation-v1',
    action,
    rcAttestationSha256,
    String(issuedAtMs),
    String(expiresAtMs),
    nonce,
  ].join('\0'), 'utf8')).slice(0, 32).toUpperCase();
}

export function validateAuthorization(authorization, {
  expectedAction,
  expectedRcSha256,
  now = Date.now(),
}) {
  const { issuedAtMs, expiresAtMs } = authorization ?? {};
  if (!hasExactKeys(authorization, AUTHORIZATION_KEYS)
    || authorization.schemaVersion !== 1
    || authorization.action !== expectedAction
    || authorization.rcAttestationSha256 !== expectedRcSha256
    || !Number.isSafeInteger(issuedAtMs)
    || !Number.isSafeInteger(expiresAtMs)
    || issuedAtMs > now
    || now - issuedAtMs > 10 * 60 * 1000
    || expiresAtMs <= now
    || expiresAtMs - now > 10 * 60 * 1000
    || expiresAtMs - issuedAtMs > 10 * 60 * 1000
    || expiresAtMs <= issuedAtMs
    || !NONCE_128_PATTERN.test(authorization.nonce)
    || authorization.confirmationMethod !== 'codex-explicit-user-confirmation'
    || authorization.identityAssurance !== 'operational-only-not-cryptographic') {
    reject('SUBMIT_AUTHORIZATION_INVALID');
  }
  if (authorization.confirmationChallenge
    !== confirmationChallengeForAuthorization(authorization)) {
    reject('SUBMIT_AUTHORIZATION_INVALID');
  }
  return authorization;
}

function readAuthorization(argument, expectedAction) {
  const prefix = '--authorization-file=';
  if (!argument?.startsWith(prefix)) reject('SUBMIT_AUTHORIZATION_REQUIRED');
  const authorizationPath = argument.slice(prefix.length);
  if (!authorizationPath || authorizationPath !== resolve(authorizationPath)) {
    reject('SUBMIT_AUTHORIZATION_INVALID');
  }
  const bytes = readBoundRegularFile(authorizationPath, {
    missingCode: 'SUBMIT_AUTHORIZATION_REQUIRED',
    invalidCode: 'SUBMIT_AUTHORIZATION_INVALID',
    privateMode: 0o600,
    maxBytes: 32 * 1024,
  });
  const authorization = parseExactJson(bytes, 'SUBMIT_AUTHORIZATION_INVALID');
  validateAuthorization(authorization, {
    expectedAction,
    expectedRcSha256: RC_ATTESTATION_SHA256,
  });
  // Keep this explicit binding visible at the production call boundary.
  if (authorization.rcAttestationSha256 !== RC_ATTESTATION_SHA256) {
    reject('SUBMIT_AUTHORIZATION_INVALID');
  }
  return { authorization, authorizationPath };
}

function fsyncDirectory(path, code) {
  let descriptor;
  try {
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function consumeAuthorizationNonce({
  authorizationPath,
  authorization,
  projectRoot: root,
}) {
  const store = join(root, 'release/private/submit-authorizations');
  let storeStat;
  try {
    storeStat = lstatSync(store);
  } catch {
    reject('SUBMIT_AUTHORIZATION_STORE_INVALID');
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : storeStat.uid;
  if (!storeStat.isDirectory()
    || storeStat.isSymbolicLink()
    || storeStat.uid !== currentUid
    || (storeStat.mode & 0o777) !== 0o700
    || realpathSync(store) !== store) {
    reject('SUBMIT_AUTHORIZATION_STORE_INVALID');
  }
  const marker = join(store, `consumed-${authorization.nonce}`);
  try {
    mkdirSync(marker, { mode: 0o700 });
  } catch {
    reject('SUBMIT_AUTHORIZATION_REPLAYED');
  }
  fsyncDirectory(store, 'SUBMIT_AUTHORIZATION_CONSUMPTION_FAILED');
  try {
    unlinkSync(authorizationPath);
  } catch {
    reject('SUBMIT_AUTHORIZATION_CONSUMPTION_FAILED');
  }
  fsyncDirectory(dirname(authorizationPath), 'SUBMIT_AUTHORIZATION_CONSUMPTION_FAILED');
}

function runVerifier(root, relativePath) {
  const result = spawnSync(process.execPath, [join(root, relativePath)], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) reject('RELEASE_PREFLIGHT_FAILED');
}

export function decodePinnedNodeToolAuthority(encodedPin, missingCode, invalidCode) {
  if (encodedPin === null || encodedPin === undefined) reject(missingCode);
  if (typeof encodedPin !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encodedPin)) {
    reject(invalidCode);
  }
  let bytes;
  try {
    bytes = Buffer.from(encodedPin, 'base64');
  } catch {
    reject(invalidCode);
  }
  if (bytes.toString('base64') !== encodedPin) reject(invalidCode);
  return parseExactJson(bytes, invalidCode);
}

export function resolvePinnedNodeTool(root, pin, missingCode, invalidCode) {
  if (!pin || !hasExactKeys(pin, PINNED_NODE_TOOL_KEYS)) {
    reject(missingCode);
  }
  assertSha256(pin.nodeExecutableSha256, invalidCode);
  assertSha256(pin.runtimeTreeSha256, invalidCode);
  if (!isSafeRelativePath(pin.runtimeRootRelativePath)
    || !isSafeRelativePath(pin.entryRelativePath)
    || !isSafeRelativePath(pin.packageJsonRelativePath)
    || typeof pin.packageVersion !== 'string'
    || pin.packageVersion.length === 0
    || pin.nodeVersion !== process.version) {
    reject(invalidCode);
  }

  const runtimeRoot = resolve(root, pin.runtimeRootRelativePath);
  if (!isWithin(resolve(root), runtimeRoot)
    || computeRuntimeTreeSha256(runtimeRoot) !== pin.runtimeTreeSha256) {
    reject(invalidCode);
  }
  const executable = resolve(runtimeRoot, pin.entryRelativePath);
  const packageJsonPath = resolve(runtimeRoot, pin.packageJsonRelativePath);
  if (!isWithin(runtimeRoot, executable) || !isWithin(runtimeRoot, packageJsonPath)) {
    reject(invalidCode);
  }
  readBoundRegularFile(executable, {
    missingCode: invalidCode,
    invalidCode,
  });
  const packageJson = parseExactJson(readBoundRegularFile(packageJsonPath, {
    missingCode: invalidCode,
    invalidCode,
    maxBytes: 256 * 1024,
  }), invalidCode);
  if (packageJson.version !== pin.packageVersion) reject(invalidCode);

  const nodeExecutable = realpathSync(process.execPath);
  const nodeBytes = readBoundRegularFile(nodeExecutable, {
    missingCode: invalidCode,
    invalidCode,
  });
  if (sha256(nodeBytes) !== pin.nodeExecutableSha256) reject(invalidCode);
  return { executable, nodeExecutable, runtimeRoot };
}

export function easArgumentsForAction(action, { ipaPath } = {}) {
  if (action === 'build') {
    return [
      'build',
      '--platform', 'ios',
      '--profile', 'production',
      '--non-interactive',
      '--freeze-credentials',
    ];
  }
  if (action === 'upload-testflight') {
    if (typeof ipaPath !== 'string' || ipaPath !== resolve(ipaPath)) {
      reject('PRIVATE_UPLOAD_IPA_INVALID');
    }
    return [
      'submit',
      '--platform', 'ios',
      '--path', ipaPath,
      '--non-interactive',
      '--no-auto-testflight-setup',
    ];
  }
  reject('RELEASE_COMMAND_INVALID');
}

export function appStoreSubmitArguments(root, {
  rcAttestation,
  rcAttestationSha256,
  authorization,
}) {
  const code = 'APP_STORE_SUBMIT_BINDING_INVALID';
  const absoluteRoot = resolve(root);
  assertCandidate(rcAttestation?.candidate, code);
  assertSha256(rcAttestationSha256, code);
  assertSha256(rcAttestation.buildArtifactAttestationSha256, code);
  assertSha256(rcAttestation.appStoreMetadataEvidenceSha256, code);
  assertSha256(rcAttestation.physicalIphoneQaSha256, code);
  assertSha256(rcAttestation.screenshotsManifestSha256, code);
  assertSha256(rcAttestation.appPrivacySha256, code);
  assertSha256(rcAttestation.reviewNotesSha256, code);
  if (!/^\d+$/u.test(rcAttestation.testFlightBuildId ?? '')
    || !NONCE_128_PATTERN.test(authorization?.nonce ?? '')) {
    reject(code);
  }
  return [
    '--operation', 'submit-for-review',
    '--apple-id', rcAttestation.candidate.appleId,
    '--bundle-identifier', rcAttestation.candidate.bundleIdentifier,
    '--marketing-version', rcAttestation.candidate.marketingVersion,
    '--build-number', rcAttestation.candidate.buildNumber,
    '--testflight-build-id', rcAttestation.testFlightBuildId,
    '--rc-attestation', join(absoluteRoot, ATTESTATION_PATHS.rc),
    '--rc-attestation-sha256', rcAttestationSha256,
    '--build-artifact-attestation', join(absoluteRoot, ATTESTATION_PATHS.buildArtifact),
    '--build-artifact-attestation-sha256', rcAttestation.buildArtifactAttestationSha256,
    '--app-store-connect-evidence', join(
      absoluteRoot,
      PRIVATE_EVIDENCE_PATHS.appStoreConnectEvidence,
    ),
    '--app-store-connect-evidence-sha256', rcAttestation.appStoreMetadataEvidenceSha256,
    '--physical-iphone-qa', join(absoluteRoot, PRIVATE_EVIDENCE_PATHS.physicalIphoneQa),
    '--physical-iphone-qa-sha256', rcAttestation.physicalIphoneQaSha256,
    '--screenshots-manifest', join(
      absoluteRoot,
      'release/app-store/3.0/screenshots-manifest.json',
    ),
    '--screenshots-manifest-sha256', rcAttestation.screenshotsManifestSha256,
    '--app-privacy', join(absoluteRoot, APP_PRIVACY_PATH),
    '--app-privacy-sha256', rcAttestation.appPrivacySha256,
    '--review-notes', join(absoluteRoot, REVIEW_NOTES_PATH),
    '--review-notes-sha256', rcAttestation.reviewNotesSha256,
    '--authorization-nonce', authorization.nonce,
  ];
}

function releaseEvidenceRoot(environment = process.env) {
  const value = environment.CABOHEALTH_RELEASE_EVIDENCE_ROOT;
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
    || synchronizedWorkspaceAncestor(value) !== null) reject('INTERNAL_GROUP_OUTPUT_INVALID');
  let stat;
  try {
    stat = lstatSync(value);
  } catch {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid
    || (stat.mode & 0o777) !== 0o700 || realpathSync(value) !== value) {
    reject('INTERNAL_GROUP_OUTPUT_INVALID');
  }
  return value;
}

export function validateInternalGroupObservation(bytes, {
  buildInput,
  buildArtifact,
  buildInputSha256,
  buildArtifactSha256,
  now = Date.now(),
}) {
  const code = 'INTERNAL_GROUP_INPUT_INVALID';
  const resourceIdPattern = /^[A-Za-z0-9-]{1,128}$/u;
  if (!Buffer.isBuffer(bytes) || !Number.isFinite(now)
    || !SHA256_PATTERN.test(buildInputSha256 ?? '')
    || !SHA256_PATTERN.test(buildArtifactSha256 ?? '')) reject(code);
  const observation = parseExactJson(bytes, code);
  const observedAt = Date.parse(observation.observedAt);
  const uploadedAt = Date.parse(observation.buildUploadedAt);
  if (!bytes.equals(Buffer.from(`${JSON.stringify(observation)}\n`, 'utf8'))
    || !isDeepStrictEqual(Object.keys(observation), INTERNAL_GROUP_OBSERVATION_KEYS)
    || observation.schemaVersion !== 1
    || observation.evidenceKind
      !== 'cabohealth-app-store-connect-internal-group-observation'
    || !isDeepStrictEqual(Object.keys(observation.candidate ?? {}), CANDIDATE_KEYS)
    || !isDeepStrictEqual(observation.candidate, CANDIDATE)
    || observation.sourceCommit !== buildInput?.sourceCommit
    || observation.sourceTreeSha256 !== buildInput?.sourceTreeSha256
    || observation.buildInputAttestationSha256 !== buildInputSha256
    || observation.buildArtifactAttestationSha256 !== buildArtifactSha256
    || observation.easBuildId !== buildArtifact?.easBuildId
    || !resourceIdPattern.test(observation.appStoreConnectBuildResourceId ?? '')
    || observation.buildProcessingState !== 'VALID'
    || observation.buildExpired !== false
    || observation.buildAudienceType !== 'APP_STORE_ELIGIBLE'
    || !Number.isFinite(uploadedAt)
    || new Date(uploadedAt).toISOString() !== observation.buildUploadedAt
    || !resourceIdPattern.test(observation.betaGroupResourceId ?? '')
    || observation.betaGroupName !== 'cabo health'
    || observation.betaGroupInternal !== true
    || observation.betaGroupHasAccessToAllBuilds !== false
    || observation.available !== false
    || observation.availabilityReason !== 'not-assigned'
    || observation.mutationPerformed !== false
    || observation.rawProviderResponseRetained !== false
    || observation.providerUrlsOmitted !== true
    || observation.credentialFieldsOmitted !== true
    || !Number.isFinite(observedAt)
    || new Date(observedAt).toISOString() !== observation.observedAt
    || observedAt > now || now - observedAt > 15 * 60 * 1000) reject(code);
  return observation;
}

export function internalGroupAdapterArguments({
  action,
  sourceCommit,
  buildInputSha256,
  buildArtifactSha256,
  buildInputPath,
  buildArtifactPath,
  evidenceRoot,
  observationSha256 = null,
}) {
  if (!['observe-testflight-internal', 'assign-testflight-internal'].includes(action)
    || !COMMIT_PATTERN.test(sourceCommit ?? '')
    || !SHA256_PATTERN.test(buildInputSha256 ?? '')
    || !SHA256_PATTERN.test(buildArtifactSha256 ?? '')
    || !isAbsolute(buildInputPath) || resolve(buildInputPath) !== buildInputPath
    || !isAbsolute(buildArtifactPath) || resolve(buildArtifactPath) !== buildArtifactPath
    || !isAbsolute(evidenceRoot) || resolve(evidenceRoot) !== evidenceRoot) {
    reject('INTERNAL_GROUP_ARGUMENT_INVALID');
  }
  const assignment = action === 'assign-testflight-internal';
  if (assignment !== SHA256_PATTERN.test(observationSha256 ?? '')) {
    reject('INTERNAL_GROUP_ARGUMENT_INVALID');
  }
  const values = [
    '--operation', assignment
      ? 'ensure-existing-internal-testflight-access'
      : 'observe-existing-internal-testflight-access',
    '--apple-id', CANDIDATE.appleId,
    '--bundle-identifier', CANDIDATE.bundleIdentifier,
    '--marketing-version', CANDIDATE.marketingVersion,
    '--build-number', CANDIDATE.buildNumber,
    '--group-name', 'cabo health',
    '--source-commit', sourceCommit,
    '--build-input-attestation', buildInputPath,
    '--build-input-attestation-sha256', buildInputSha256,
    '--build-artifact-attestation', buildArtifactPath,
    '--build-artifact-attestation-sha256', buildArtifactSha256,
  ];
  if (assignment) values.push(
    '--observation', join(evidenceRoot, 'internal-testflight-group-observation.json'),
    '--observation-sha256', observationSha256,
  );
  values.push('--output', join(
    evidenceRoot,
    assignment
      ? 'internal-testflight-group-assignment.json'
      : 'internal-testflight-group-observation.json',
  ));
  return values;
}

function executeInternalGroupAction(action) {
  const buildArtifact = verifyBuildArtifactAttestation(projectRoot, {
    buildInputSha256: BUILD_INPUT_ATTESTATION_SHA256,
    buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256,
  });
  const buildInput = verifyBuildInputAttestation(
    projectRoot,
    BUILD_INPUT_ATTESTATION_SHA256,
    {
      phase: 'artifact',
      phasePins: { buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256 },
    },
  );
  const evidenceRoot = releaseEvidenceRoot();
  let observationSha256 = null;
  if (action === 'assign-testflight-internal') {
    const observationPath = join(evidenceRoot, 'internal-testflight-group-observation.json');
    const observationBytes = readBoundRegularFile(observationPath, {
      missingCode: 'INTERNAL_GROUP_INPUT_INVALID',
      invalidCode: 'INTERNAL_GROUP_INPUT_INVALID',
      privateMode: 0o600,
      maxBytes: 1024 * 1024,
    });
    validateInternalGroupObservation(observationBytes, {
      buildInput,
      buildArtifact,
      buildInputSha256: BUILD_INPUT_ATTESTATION_SHA256,
      buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256,
    });
    observationSha256 = sha256(observationBytes);
  }
  const { operationRoot } = createPrivateOperationRoot(
    action === 'assign-testflight-internal' ? 'internal-assign' : 'internal-observe',
  );
  try {
    const inputSnapshot = join(operationRoot, 'build-input-attestation.json');
    const artifactSnapshot = join(operationRoot, 'build-artifact-attestation.json');
    writeExclusiveFile(inputSnapshot, readBoundRegularFile(
      join(projectRoot, ATTESTATION_PATHS.buildInput),
      { missingCode: 'INTERNAL_GROUP_INPUT_INVALID', invalidCode: 'INTERNAL_GROUP_INPUT_INVALID' },
    ), 0o600, 'INTERNAL_GROUP_INPUT_INVALID');
    writeExclusiveFile(artifactSnapshot, readBoundRegularFile(
      join(projectRoot, ATTESTATION_PATHS.buildArtifact),
      { missingCode: 'INTERNAL_GROUP_INPUT_INVALID', invalidCode: 'INTERNAL_GROUP_INPUT_INVALID' },
    ), 0o600, 'INTERNAL_GROUP_INPUT_INVALID');
    const assignment = action === 'assign-testflight-internal';
    executeNodeProgram(
      projectRoot,
      join(
        projectRoot,
        `tools/app-store-submit-adapter/bin/${assignment ? 'assign' : 'observe'}-internal-group.mjs`,
      ),
      internalGroupAdapterArguments({
        action,
        sourceCommit: buildInput.sourceCommit,
        buildInputSha256: BUILD_INPUT_ATTESTATION_SHA256,
        buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256,
        buildInputPath: inputSnapshot,
        buildArtifactPath: artifactSnapshot,
        evidenceRoot,
        observationSha256,
      }),
      assignment ? 'Internal TestFlight assignment' : 'Internal TestFlight observation',
    );
  } finally {
    removePrivateOperationSnapshot(operationRoot);
  }
}

export function executeNodeProgram(root, executable, args, label, {
  nodeExecutable = process.execPath,
  environment = {},
  releaseAttempt = null,
} = {}) {
  process.stdout.write(`${label} command started\n`);
  const childEnvironment = { ...process.env, ...environment };
  for (const key of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'npm_config_node_options',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'CABOHEALTH_RELEASE_ATTEMPT_STATE',
  ]) {
    delete childEnvironment[key];
  }
  if (releaseAttempt !== null) {
    const attemptPath = process.env.CABOHEALTH_RELEASE_ATTEMPT_STATE;
    if (typeof attemptPath !== 'string') reject('RELEASE_ATTEMPT_STATE_INVALID');
    try {
      markProviderStarted(attemptPath, releaseAttempt);
    } catch {
      reject('RELEASE_ATTEMPT_STATE_INVALID');
    }
  }
  const result = spawnSync(nodeExecutable, [executable, ...args], {
    cwd: root,
    env: childEnvironment,
    stdio: 'inherit',
  });
  if (result.status !== 0) reject(`${label.toUpperCase().replaceAll(' ', '_')}_COMMAND_FAILED`);
}

function main() {
  const [action, authorizationArgument, ...extra] = process.argv.slice(2);
  if (![
    'build', 'upload-testflight', 'observe-testflight-internal',
    'assign-testflight-internal', 'submit-review',
  ].includes(action) || extra.length > 0) {
    reject('RELEASE_COMMAND_INVALID');
  }

  if (action === 'build') {
    if (authorizationArgument !== undefined) reject('RELEASE_COMMAND_INVALID');
    const buildInput = verifyBuildInputAttestation(projectRoot, BUILD_INPUT_ATTESTATION_SHA256);
    const easPin = easToolAuthorityFromBuildInput(buildInput, 'EAS_CLI_PIN_INVALID');
    const easCli = resolvePinnedNodeTool(
      projectRoot,
      easPin,
      'EAS_CLI_NOT_PINNED',
      'EAS_CLI_PIN_INVALID',
    );
    const snapshot = createPrivateBuildSnapshot(projectRoot, buildInput.sourceTreeSha256);
    try {
      runVerifier(snapshot.workspaceRoot, 'scripts/verify-release-v3.mjs');
      runVerifier(snapshot.workspaceRoot, 'scripts/verify-app-store-metadata.mjs');
      const privateTool = snapshotPinnedNodeTool(
        snapshot.operationRoot,
        easCli,
        easPin,
      );
      verifyPrivateNodeToolSnapshot(privateTool, easPin);
      verifyPrivateBuildSnapshot(snapshot.workspaceRoot, buildInput.sourceTreeSha256);
      executeNodeProgram(
        snapshot.workspaceRoot,
        privateTool.executable,
        easArgumentsForAction('build'),
        'EAS',
        {
          nodeExecutable: privateTool.nodeExecutable,
          environment: { EAS_NO_VCS: '1' },
          releaseAttempt: { action: 'build', sourceCommit: buildInput.sourceCommit },
        },
      );
    } finally {
      removePrivateOperationSnapshot(snapshot.operationRoot);
    }
    return;
  }

  if (action === 'upload-testflight') {
    if (authorizationArgument !== undefined) reject('RELEASE_COMMAND_INVALID');
    const buildArtifact = verifyBuildArtifactAttestation(projectRoot, {
      buildInputSha256: BUILD_INPUT_ATTESTATION_SHA256,
      buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256,
    });
    const buildInput = verifyBuildInputAttestation(
      projectRoot,
      BUILD_INPUT_ATTESTATION_SHA256,
      {
        phase: 'artifact',
        phasePins: { buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256 },
      },
    );
    runVerifier(projectRoot, 'scripts/verify-release-v3.mjs');
    runVerifier(projectRoot, 'scripts/verify-app-store-metadata.mjs');
    const easPin = easToolAuthorityFromBuildInput(buildInput, 'EAS_CLI_PIN_INVALID');
    const easCli = resolvePinnedNodeTool(
      projectRoot,
      easPin,
      'EAS_CLI_NOT_PINNED',
      'EAS_CLI_PIN_INVALID',
    );
    const snapshot = createPrivateUploadSnapshot(
      join(projectRoot, PRIVATE_EVIDENCE_PATHS.ipa),
      buildArtifact.ipaSha256,
    );
    try {
      const privateTool = snapshotPinnedNodeTool(
        snapshot.operationRoot,
        easCli,
        easPin,
      );
      verifyPrivateNodeToolSnapshot(privateTool, easPin);
      verifyPrivateUploadIpa(snapshot.ipaPath, buildArtifact.ipaSha256);
      executeNodeProgram(
        projectRoot,
        privateTool.executable,
        easArgumentsForAction('upload-testflight', { ipaPath: snapshot.ipaPath }),
        'EAS',
        {
          nodeExecutable: privateTool.nodeExecutable,
          releaseAttempt: {
            action: 'upload-testflight',
            sourceCommit: buildInput.sourceCommit,
          },
        },
      );
    } finally {
      removePrivateOperationSnapshot(snapshot.operationRoot);
    }
    return;
  }

  if (['observe-testflight-internal', 'assign-testflight-internal'].includes(action)) {
    if (authorizationArgument !== undefined) reject('RELEASE_COMMAND_INVALID');
    executeInternalGroupAction(action);
    return;
  }

  const rcAttestation = verifyRcAttestation(projectRoot, {
    buildInputSha256: BUILD_INPUT_ATTESTATION_SHA256,
    buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256,
    rcSha256: RC_ATTESTATION_SHA256,
  }, {
    phase: 'submit-tool',
    phasePins: { submitAdapterPin: PINNED_APP_STORE_SUBMIT_ADAPTER },
  });
  verifyBuildInputAttestation(projectRoot, BUILD_INPUT_ATTESTATION_SHA256, {
    phase: 'submit-tool',
    phasePins: {
      buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256,
      rcSha256: RC_ATTESTATION_SHA256,
      submitAdapterPin: PINNED_APP_STORE_SUBMIT_ADAPTER,
    },
  });
  runVerifier(projectRoot, 'scripts/verify-release-v3.mjs');
  runVerifier(projectRoot, 'scripts/verify-app-store-metadata.mjs');
  const adapterPin = decodePinnedNodeToolAuthority(
    PINNED_APP_STORE_SUBMIT_ADAPTER,
    'APP_STORE_SUBMIT_ADAPTER_NOT_PINNED',
    'APP_STORE_SUBMIT_ADAPTER_PIN_INVALID',
  );
  const adapter = resolvePinnedNodeTool(
    projectRoot,
    adapterPin,
    'APP_STORE_SUBMIT_ADAPTER_NOT_PINNED',
    'APP_STORE_SUBMIT_ADAPTER_PIN_INVALID',
  );
  const { authorization, authorizationPath } = readAuthorization(
    authorizationArgument,
    'submit-for-review',
  );
  const { operationRoot } = createPrivateOperationRoot('submit');
  try {
    const privateTool = snapshotPinnedNodeTool(
      operationRoot,
      adapter,
      adapterPin,
    );
    verifyPrivateNodeToolSnapshot(privateTool, adapterPin);
    consumeAuthorizationNonce({ authorizationPath, authorization, projectRoot });
    executeNodeProgram(
      projectRoot,
      privateTool.executable,
      appStoreSubmitArguments(projectRoot, {
        rcAttestation,
        rcAttestationSha256: RC_ATTESTATION_SHA256,
        authorization,
      }),
      'App Store submit',
      { nodeExecutable: privateTool.nodeExecutable },
    );
  } finally {
    removePrivateOperationSnapshot(operationRoot);
  }
}

const invokedAsCli = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  try {
    main();
  } catch (error) {
    const code = error instanceof ReleaseGuardError ? error.message : 'RELEASE_GUARD_INTERNAL_ERROR';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
