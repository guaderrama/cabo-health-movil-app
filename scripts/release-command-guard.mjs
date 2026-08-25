import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants as FS_CONSTANTS,
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
const PRIVATE_EVIDENCE_PATHS = Object.freeze({
  ipa: 'release/private/rc/CaboHealth-3.0-build-4.ipa',
  signedEntitlements: 'release/private/rc/signed-entitlements.plist',
  privacyReport: 'release/private/rc/privacy-report.json',
  embeddedGoogleServicesPlist: 'release/private/rc/embedded-GoogleService-Info.plist',
  signingCertificate: 'release/private/rc/signing-certificate.der',
  embeddedProvisioningProfile: 'release/private/rc/embedded.mobileprovision',
  physicalIphoneQa: 'release/private/rc/physical-iphone-qa.json',
  appStoreConnectEvidence: 'release/private/rc/app-store-connect-evidence.json',
});

// Each pin remains null until that phase has been produced and independently
// reviewed. The canonical source digest includes this guard after normalizing
// only these five one-line authority values, so pinning is not circular while
// every executable guard behavior remains part of the reviewed source.
const BUILD_INPUT_ATTESTATION_SHA256 = '38b8502a751bc7e0165d692200b36b4662a34705fdec87e1480b80feab692f82';
const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;
const RC_ATTESTATION_SHA256 = null;
const PINNED_EAS_CLI = 'eyJlbnRyeVJlbGF0aXZlUGF0aCI6ImVhcy1jbGkvYmluL3J1biIsIm5vZGVFeGVjdXRhYmxlU2hhMjU2IjoiNWQ5ZDM4NzI5MTFlMjM0MGE0M2I3MDc5NjJlNjgxNDNkZThhNGU4ZDU0NjI4ODQ1YzBjNGYyZGUxZmI3Y2Q1YyIsIm5vZGVWZXJzaW9uIjoidjIyLjIyLjMiLCJwYWNrYWdlSnNvblJlbGF0aXZlUGF0aCI6ImVhcy1jbGkvcGFja2FnZS5qc29uIiwicGFja2FnZVZlcnNpb24iOiIyMi4yLjAiLCJydW50aW1lUm9vdFJlbGF0aXZlUGF0aCI6Im5vZGVfbW9kdWxlcyIsInJ1bnRpbWVUcmVlU2hhMjU2IjoiYzllNjdiODJiNzYxOTZlNDhhYjgxMjJiZDcwMDczYmI3MzU0MWQzMDc0NGI0M2JjZTUwZGQwNDUwYjgwZWVmNSJ9';
const PINNED_APP_STORE_SUBMIT_ADAPTER = 'eyJlbnRyeVJlbGF0aXZlUGF0aCI6ImJpbi9zdWJtaXQubWpzIiwibm9kZUV4ZWN1dGFibGVTaGEyNTYiOiI1ZDlkMzg3MjkxMWUyMzQwYTQzYjcwNzk2MmU2ODE0M2RlOGE0ZThkNTQ2Mjg4NDVjMGM0ZjJkZTFmYjdjZDVjIiwibm9kZVZlcnNpb24iOiJ2MjIuMjIuMyIsInBhY2thZ2VKc29uUmVsYXRpdmVQYXRoIjoicGFja2FnZS5qc29uIiwicGFja2FnZVZlcnNpb24iOiIxLjAuMCIsInJ1bnRpbWVSb290UmVsYXRpdmVQYXRoIjoidG9vbHMvYXBwLXN0b3JlLXN1Ym1pdC1hZGFwdGVyIiwicnVudGltZVRyZWVTaGEyNTYiOiIwY2Q1NmVhZjM2YzljOTI2NzI1MTEzYmIzOWI2NmUwYjRkYmIyZGM5NTJhOWM2Yjc0Yjg0OTRlN2NiMjY4YjJjIn0=';

const SOURCE_DIGEST_EXCLUSIONS = new Set([
  ...Object.values(ATTESTATION_PATHS),
  // Exact-RC screenshots can only be captured after the immutable build is in
  // TestFlight. Their manifest is independently hashed by the RC attestation,
  // so it is evidence about the build rather than an input to that build.
  'release/app-store/3.0/screenshots-manifest.json',
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
  buildNumber: '4',
});
const PRODUCTION_FIREBASE_PROJECT_ID = 'cabohealth-owner-prod';
const PRIVATE_GOOGLE_SERVICES_PLIST_MARKER = '<PRIVATE_GOOGLE_SERVICES_PLIST>';
const CANDIDATE_KEYS = Object.keys(CANDIDATE);
const BUILD_INPUT_KEYS = [
  'schemaVersion',
  'artifactKind',
  'candidate',
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
  'reviewedAt',
];
const BUILD_ARTIFACT_KEYS = [
  'schemaVersion',
  'artifactKind',
  'candidate',
  'buildInputAttestationSha256',
  'sourceTreeSha256',
  'easBuildId',
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
const PRIVATE_OPERATION_PREFIX = 'cabohealth-release-';
const PRIVATE_OPERATION_MARKER = '.cabohealth-private-operation';

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

function runGit(root, args, code) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    descriptor = openSync(
      path,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      mode,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } catch {
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
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
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== currentUid) {
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

export function verifyBuildInputAttestation(root, expectedSha256) {
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
  for (const key of BUILD_INPUT_KEYS.filter((key) => key.endsWith('Sha256'))) {
    assertSha256(attestation[key], code);
  }
  const googleServicesPlist = readProductionGoogleServicesPlist();
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
}) {
  const code = 'EXACT_BUILD_ARTIFACT_ATTESTATION_INVALID';
  if (!SHA256_PATTERN.test(buildArtifactSha256 ?? '')) {
    reject('EXACT_BUILD_ARTIFACT_ATTESTATION_MISSING');
  }
  const buildInput = verifyBuildInputAttestation(root, buildInputSha256);
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
}) {
  const code = 'EXACT_RC_ATTESTATION_INVALID';
  if (!SHA256_PATTERN.test(rcSha256 ?? '')) reject('EXACT_RC_ATTESTATION_MISSING');
  const buildArtifact = verifyBuildArtifactAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
  });
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
    join(root, 'release/app-store/3.0/screenshots-manifest.json'),
    {
      missingCode: code,
      invalidCode: code,
      maxBytes: 1024 * 1024,
    },
  );
  if (attestation.buildArtifactAttestationSha256 !== buildArtifactSha256
    || attestation.sourceTreeSha256 !== buildArtifact.sourceTreeSha256
    || typeof attestation.testFlightBuildId !== 'string'
    || !/^\d+$/u.test(attestation.testFlightBuildId)
    || attestation.physicalIphoneQaSha256 !== sha256(physicalIphoneQaBytes)
    || attestation.screenshotsManifestSha256 !== sha256(screenshotsManifestBytes)
    || attestation.appStoreMetadataEvidenceSha256 !== sha256(appStoreConnectEvidenceBytes)) {
    reject(code);
  }
  try {
    const bindings = {
      testFlightBuildId: attestation.testFlightBuildId,
      sourceTreeSha256: attestation.sourceTreeSha256,
      testFlightProcessedAt: attestation.testFlightProcessedAt,
    };
    validatePhysicalIphoneQaEvidence(parseExactJson(physicalIphoneQaBytes, code), bindings);
    validateAppStoreConnectEvidence(
      parseExactJson(appStoreConnectEvidenceBytes, code),
      bindings,
    );
    validateScreenshotsManifest(parseExactJson(screenshotsManifestBytes, code), {
      phase: 'final',
      ...bindings,
      evidenceRoot: join(root, 'release/private/rc'),
      requireFiles: true,
    });
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
      '--freeze-credentials',
      '--non-interactive',
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
    '--authorization-nonce', authorization.nonce,
  ];
}

export function executeNodeProgram(root, executable, args, label, {
  nodeExecutable = process.execPath,
  environment = {},
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
  ]) {
    delete childEnvironment[key];
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
  if (!['build', 'upload-testflight', 'submit-review'].includes(action) || extra.length > 0) {
    reject('RELEASE_COMMAND_INVALID');
  }

  if (action === 'build') {
    if (authorizationArgument !== undefined) reject('RELEASE_COMMAND_INVALID');
    const buildInput = verifyBuildInputAttestation(projectRoot, BUILD_INPUT_ATTESTATION_SHA256);
    const easPin = decodePinnedNodeToolAuthority(
      PINNED_EAS_CLI,
      'EAS_CLI_NOT_PINNED',
      'EAS_CLI_PIN_INVALID',
    );
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
    runVerifier(projectRoot, 'scripts/verify-release-v3.mjs');
    runVerifier(projectRoot, 'scripts/verify-app-store-metadata.mjs');
    const easPin = decodePinnedNodeToolAuthority(
      PINNED_EAS_CLI,
      'EAS_CLI_NOT_PINNED',
      'EAS_CLI_PIN_INVALID',
    );
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
        { nodeExecutable: privateTool.nodeExecutable },
      );
    } finally {
      removePrivateOperationSnapshot(snapshot.operationRoot);
    }
    return;
  }

  const rcAttestation = verifyRcAttestation(projectRoot, {
    buildInputSha256: BUILD_INPUT_ATTESTATION_SHA256,
    buildArtifactSha256: BUILD_ARTIFACT_ATTESTATION_SHA256,
    rcSha256: RC_ATTESTATION_SHA256,
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
