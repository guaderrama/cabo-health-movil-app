#!/usr/bin/env node

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
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { googleServicesPlistsHaveSameContent } from './release-command-guard.mjs';

const require = createRequire(import.meta.url);
const { parse: parsePlist } = require('simple-plist');

const MAX_IPA_BYTES = 1024 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_ARCHIVE_PATH_BYTES = 4096;
const MAX_SCANNED_FILE_BYTES = 512 * 1024 * 1024;
const MAX_SCANNED_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const TEMPORARY_PREFIX = 'cabohealth-ipa-audit.';

const EXACT_SIGNED_ENTITLEMENT_KEYS = Object.freeze([
  'application-identifier',
  'beta-reports-active',
  'com.apple.developer.associated-domains',
  'com.apple.developer.devicecheck.appattest-environment',
  'com.apple.developer.team-identifier',
  'get-task-allow',
]);

const FORBIDDEN_INFO_PLIST_KEYS = Object.freeze([
  'NSCameraUsageDescription',
  'NSHealthClinicalHealthRecordsShareUsageDescription',
  'NSHealthShareUsageDescription',
  'NSHealthUpdateUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationAlwaysUsageDescription',
  'NSLocationTemporaryUsageDescriptionDictionary',
  'NSLocationUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSPhotoLibraryUsageDescription',
]);

const FORBIDDEN_ENTITLEMENT_KEYS = Object.freeze([
  'aps-environment',
  'com.apple.developer.healthkit',
  'com.apple.developer.healthkit.access',
  'com.apple.developer.healthkit.background-delivery',
  'com.apple.developer.location.push',
  'com.apple.developer.location.push.service',
  'com.apple.security.application-groups',
  'keychain-access-groups',
]);

const FORBIDDEN_MARKERS = Object.freeze({
  camera: [
    'AVCaptureDevice',
    'AVCaptureMetadataOutput',
    'AVCapturePhotoOutput',
    'AVCaptureSession',
    'AVCaptureVideoDataOutput',
    'ExpoCamera',
    'NSCameraUsageDescription',
    'UIImagePickerControllerSourceTypeCamera',
    'VNDocumentCameraViewController',
  ],
  devPanel: [
    'DEV_MINIAPP_FEATURE_MARKER',
    'Miniapp test panel',
    'Panel de prueba de miniapps',
    'development-source-only',
    'devPanel.',
    'home.testMiniapps',
  ],
  expoFileSystem: [
    // ExpoModulesCore always carries the EXFileSystemInterface protocol,
    // legacy utilities, and a "module not found" error string even when the
    // optional expo-file-system pod is not linked. Match signatures owned by
    // the concrete SDK 54 module instead of those unavoidable core strings.
    'EXFileSystemLocalFileHandler',
    'ExponentFileSystem',
    'ExpoFileSystem/FileSystemModule.swift',
    'ExpoFileSystem_privacy.bundle',
    'PodsDummy_ExpoFileSystem',
    '_TtC14ExpoFileSystem16FileSystemModule',
  ],
  healthKit: [
    'HealthKit.framework',
    'HKHealthStore',
    'HKObjectType',
    'HKQuantityType',
    'HKWorkout',
    'com.apple.developer.healthkit',
  ],
  location: [
    'CLLocationManager',
    'CLGeocoder',
    'CoreLocation.framework',
    'ExpoLocation',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSLocationAlwaysUsageDescription',
    'NSLocationWhenInUseUsageDescription',
  ],
  microphone: [
    'AVAudioRecorder',
    'AVAudioSessionRecordPermission',
    'AVCaptureAudioDataOutput',
    'ExpoAudio',
    'NSMicrophoneUsageDescription',
    'SFSpeechAudioBufferRecognitionRequest',
    'SFSpeechRecognizer',
    'Speech.framework',
    'requestRecordPermission',
  ],
  photos: [
    'PHAsset',
    'PHPicker',
    'PHPhotoLibrary',
    'Photos.framework',
    'PhotosUI.framework',
    'NSPhotoLibraryAddUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'UIImagePickerController',
    'UIImagePickerControllerSourceTypePhotoLibrary',
  ],
  staffUrl: [
    'cabohealth.org/staff',
    'cabohealth.org%2fstaff',
    'staff.cabohealth.org',
  ],
});

const FORBIDDEN_PRIVACY_DATA_TYPES = Object.freeze({
  healthKit: [
    'NSPrivacyCollectedDataTypeFitness',
    'NSPrivacyCollectedDataTypeHealth',
  ],
  location: [
    'NSPrivacyCollectedDataTypeCoarseLocation',
    'NSPrivacyCollectedDataTypePreciseLocation',
  ],
  microphone: ['NSPrivacyCollectedDataTypeAudioData'],
  photos: ['NSPrivacyCollectedDataTypePhotosorVideos'],
});

const REQUIRED_OPTIONS = Object.freeze([
  'ipa',
  'google-services-plist',
  'bundle-id',
  'version',
  'build',
  'team-id',
  'firebase-project-id',
  'app-attest-environment',
  'associated-domain',
  'generated-at',
  'output',
]);

const OPTION_NAMES = new Set([
  ...REQUIRED_OPTIONS,
  'attestation-input-dir',
]);

export class IpaAuditError extends Error {
  constructor(code) {
    super(code);
    this.name = 'IpaAuditError';
  }
}

function reject(code) {
  throw new IpaAuditError(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function exactObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsePlistDictionary(bytes, code) {
  let parsed;
  try {
    parsed = parsePlist(bytes);
  } catch {
    reject(code);
  }
  if (!exactObject(parsed)) reject(code);
  return parsed;
}

function readBoundRegularFile(path, {
  code,
  maxBytes = MAX_SCANNED_FILE_BYTES,
  requirePrivate = false,
} = {}) {
  const invalidCode = code ?? 'IPA_AUDIT_INPUT_INVALID';
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    reject(invalidCode);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) reject(invalidCode);
  if (requirePrivate && (stat.mode & 0o077) !== 0) reject(invalidCode);
  let descriptor;
  try {
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) reject(invalidCode);
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof IpaAuditError) throw error;
    reject(invalidCode);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (exactObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value))}\n`, 'utf8');
}

function stableStrings(value, code) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) reject(code);
  return [...new Set(value)].sort();
}

function sameStrings(left, right) {
  return isDeepStrictEqual(stableStrings(left, 'IPA_IDENTITY_INVALID'), [...right].sort());
}

function hasOnlyKeys(value, keys) {
  return exactObject(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function ensureAbsoluteFile(path, code, options = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) reject(code);
  return readBoundRegularFile(resolve(path), { code, ...options });
}

function validateExpected(expected) {
  if (!hasOnlyKeys(expected, [
    'bundleIdentifier',
    'marketingVersion',
    'buildNumber',
    'teamIdentifier',
    'firebaseProjectId',
    'appAttestEnvironment',
    'associatedDomains',
  ])
    || !/^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/u.test(expected.bundleIdentifier ?? '')
    || !/^\d+(?:\.\d+){0,2}$/u.test(expected.marketingVersion ?? '')
    || !/^\d+$/u.test(expected.buildNumber ?? '')
    || !/^[A-Z0-9]{10}$/u.test(expected.teamIdentifier ?? '')
    || !/^[a-z][a-z0-9-]{3,62}$/u.test(expected.firebaseProjectId ?? '')
    || expected.appAttestEnvironment !== 'production'
    || !Array.isArray(expected.associatedDomains)
    || expected.associatedDomains.length === 0
    || expected.associatedDomains.some((domain) => (
      typeof domain !== 'string'
      || !/^applinks:[a-z0-9.-]+$/u.test(domain)
    ))) {
    reject('IPA_EXPECTED_IDENTITY_INVALID');
  }
  const associatedDomains = [...new Set(expected.associatedDomains)].sort();
  if (associatedDomains.length !== expected.associatedDomains.length) {
    reject('IPA_EXPECTED_IDENTITY_INVALID');
  }
  return Object.freeze({ ...expected, associatedDomains });
}

function validateGeneratedAt(generatedAt) {
  if (typeof generatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt)) {
    reject('IPA_GENERATED_AT_INVALID');
  }
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== generatedAt) {
    reject('IPA_GENERATED_AT_INVALID');
  }
  return generatedAt;
}

function defaultCommandRunner(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: null,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error || result.status !== 0 || result.signal !== null) {
    return {
      ok: false,
      stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
      stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
    };
  }
  return {
    ok: true,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
  };
}

function runRequired(commandRunner, command, arguments_, code) {
  const result = commandRunner(command, arguments_);
  if (!result || result.ok !== true || !Buffer.isBuffer(result.stdout)
    || !Buffer.isBuffer(result.stderr)) reject(code);
  return result;
}

function decodeUtf8(bytes, code) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    reject(code);
  }
}

function validateArchiveEntryName(name, seen, seenFolded) {
  const byteLength = Buffer.byteLength(name, 'utf8');
  if (name.length === 0 || byteLength > MAX_ARCHIVE_PATH_BYTES
    || name.startsWith('/') || name.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(name)) {
    reject('IPA_ARCHIVE_ENTRY_INVALID');
  }
  const path = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = path.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    reject('IPA_ARCHIVE_ENTRY_INVALID');
  }
  const folded = path.normalize('NFC').toLocaleLowerCase('en-US');
  if (seen.has(path) || seenFolded.has(folded)) reject('IPA_ARCHIVE_ENTRY_COLLISION');
  seen.add(path);
  seenFolded.add(folded);
}

function defaultExtractArchive(ipaPath, extractionRoot, commandRunner = defaultCommandRunner) {
  const list = runRequired(
    commandRunner,
    '/usr/bin/unzip',
    ['-Z1', ipaPath],
    'IPA_ARCHIVE_LIST_FAILED',
  );
  const listing = decodeUtf8(list.stdout, 'IPA_ARCHIVE_LIST_INVALID');
  const entries = listing.endsWith('\n') ? listing.slice(0, -1).split('\n') : listing.split('\n');
  if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
    reject('IPA_ARCHIVE_LIST_INVALID');
  }
  const seen = new Set();
  const seenFolded = new Set();
  for (const entry of entries) validateArchiveEntryName(entry, seen, seenFolded);
  const modeList = runRequired(
    commandRunner,
    '/usr/bin/unzip',
    ['-Z', '-l', ipaPath],
    'IPA_ARCHIVE_MODE_LIST_FAILED',
  );
  const modeListing = decodeUtf8(modeList.stdout, 'IPA_ARCHIVE_MODE_LIST_INVALID');
  const modePattern = /^([bcdlps-])[rwxStTs-]{9}\s+\S+\s+\S+\s+(\d+)\s+/u;
  const modeEntries = modeListing.split(/\r?\n/u).flatMap((line) => {
    const match = modePattern.exec(line);
    return match ? [{ kind: match[1], size: Number(match[2]) }] : [];
  });
  if (modeEntries.length !== entries.length
    || modeEntries.some((entry) => !['-', 'd'].includes(entry.kind)
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || entry.size > MAX_SCANNED_FILE_BYTES)
    || modeEntries.reduce((total, entry) => total + entry.size, 0) > MAX_SCANNED_TOTAL_BYTES) {
    reject('IPA_ARCHIVE_ENTRY_TYPE_OR_SIZE_INVALID');
  }
  runRequired(
    commandRunner,
    '/usr/bin/ditto',
    ['-x', '-k', '--sequesterRsrc', '--rsrc', ipaPath, extractionRoot],
    'IPA_ARCHIVE_EXTRACTION_FAILED',
  );
}

function assertPathInside(root, candidate, code) {
  const resolvedRoot = realpathSync(root);
  const resolvedCandidate = realpathSync(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    reject(code);
  }
}

function walkPrivateTree(root) {
  const files = [];
  let scannedBytes = 0;
  const seen = new Set();
  const seenFolded = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      validateArchiveEntryName(
        `${relative(root, path)}${stat.isDirectory() ? '/' : ''}`,
        seen,
        seenFolded,
      );
      if (stat.isSymbolicLink()) reject('IPA_EXTRACTED_SYMLINK_INVALID');
      assertPathInside(root, path, 'IPA_EXTRACTED_PATH_INVALID');
      if (stat.isDirectory()) {
        chmodSync(path, PRIVATE_DIRECTORY_MODE);
        visit(path);
      } else if (stat.isFile() && stat.nlink === 1) {
        scannedBytes += stat.size;
        if (stat.size > MAX_SCANNED_FILE_BYTES || scannedBytes > MAX_SCANNED_TOTAL_BYTES) {
          reject('IPA_EXTRACTED_SIZE_INVALID');
        }
        chmodSync(path, (stat.mode & 0o111) === 0 ? PRIVATE_FILE_MODE : PRIVATE_DIRECTORY_MODE);
        files.push(path);
      } else {
        reject('IPA_EXTRACTED_ENTRY_INVALID');
      }
    }
  };
  visit(root);
  return files.sort((left, right) => compareStrings(relative(root, left), relative(root, right)));
}

function locateApplication(extractionRoot) {
  const payload = join(extractionRoot, 'Payload');
  let entries;
  try {
    entries = readdirSync(payload, { withFileTypes: true });
  } catch {
    reject('IPA_APPLICATION_MISSING');
  }
  const applications = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (applications.length !== 1 || entries.some((entry) => entry.isSymbolicLink())) {
    reject('IPA_APPLICATION_INVALID');
  }
  const appPath = join(payload, applications[0].name);
  assertPathInside(extractionRoot, appPath, 'IPA_APPLICATION_INVALID');
  return appPath;
}

function parseCodesignDetails(bytes) {
  const text = decodeUtf8(bytes, 'IPA_CODESIGN_DETAILS_INVALID');
  const values = new Map();
  const authorities = [];
  for (const line of text.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'Authority') authorities.push(value);
    else if (!values.has(key)) values.set(key, value);
  }
  return { values, authorities };
}

function validateBundleInfo(info, expected) {
  if (info.CFBundleIdentifier !== expected.bundleIdentifier
    || String(info.CFBundleShortVersionString) !== expected.marketingVersion
    || String(info.CFBundleVersion) !== expected.buildNumber
    || typeof info.CFBundleExecutable !== 'string'
    || info.CFBundleExecutable.length === 0) {
    reject('IPA_BUNDLE_IDENTITY_MISMATCH');
  }
  for (const key of FORBIDDEN_INFO_PLIST_KEYS) {
    if (Object.hasOwn(info, key)) reject('IPA_PROTECTED_RESOURCE_PURPOSE_STRING_PRESENT');
  }
  const appBoundDomains = expected.associatedDomains.map((domain) => domain.slice('applinks:'.length));
  if (!sameStrings(info.WKAppBoundDomains, appBoundDomains)) reject('IPA_APP_BOUND_DOMAINS_MISMATCH');
  return {
    bundleIdentifier: info.CFBundleIdentifier,
    executable: info.CFBundleExecutable,
    marketingVersion: String(info.CFBundleShortVersionString),
    buildNumber: String(info.CFBundleVersion),
    appBoundDomains: [...appBoundDomains].sort(),
  };
}

function validateSignedEntitlements(entitlements, expected) {
  if (!hasOnlyKeys(entitlements, EXACT_SIGNED_ENTITLEMENT_KEYS)
    || entitlements['application-identifier'] !== `${expected.teamIdentifier}.${expected.bundleIdentifier}`
    || entitlements['com.apple.developer.team-identifier'] !== expected.teamIdentifier
    || entitlements['com.apple.developer.devicecheck.appattest-environment']
      !== expected.appAttestEnvironment
    || !sameStrings(
      entitlements['com.apple.developer.associated-domains'],
      expected.associatedDomains,
    )
    || entitlements['get-task-allow'] !== false
    || entitlements['beta-reports-active'] !== true) {
    reject('IPA_SIGNED_ENTITLEMENTS_MISMATCH');
  }
  for (const key of FORBIDDEN_ENTITLEMENT_KEYS) {
    if (Object.hasOwn(entitlements, key)) reject('IPA_FORBIDDEN_ENTITLEMENT_PRESENT');
  }
  return Object.keys(entitlements).sort();
}

function validateProvisioningProfile(profile, expected, leafCertificate) {
  const applicationIdentifier = `${expected.teamIdentifier}.${expected.bundleIdentifier}`;
  const profileEntitlements = profile.Entitlements;
  const certificateList = profile.DeveloperCertificates;
  const expiration = profile.ExpirationDate instanceof Date
    ? profile.ExpirationDate
    : new Date(profile.ExpirationDate);
  if (!exactObject(profileEntitlements)
    || !Array.isArray(profile.TeamIdentifier)
    || !isDeepStrictEqual(profile.TeamIdentifier, [expected.teamIdentifier])
    || !Array.isArray(profile.ApplicationIdentifierPrefix)
    || !isDeepStrictEqual(profile.ApplicationIdentifierPrefix, [expected.teamIdentifier])
    || !Array.isArray(profile.Platform)
    || !profile.Platform.includes('iOS')
    || profileEntitlements['application-identifier'] !== applicationIdentifier
    || profileEntitlements['com.apple.developer.team-identifier'] !== expected.teamIdentifier
    || profileEntitlements['get-task-allow'] !== false
    || profileEntitlements['beta-reports-active'] !== true
    || !Array.isArray(certificateList)
    || !certificateList.some((certificate) => (
      Buffer.isBuffer(certificate) && certificate.equals(leafCertificate)
    ))
    || Number.isNaN(expiration.valueOf())
    || expiration.valueOf() <= Date.now()
    || Object.hasOwn(profile, 'ProvisionedDevices')
    || profile.ProvisionsAllDevices === true) {
    reject('IPA_PROVISIONING_PROFILE_MISMATCH');
  }
  const provisionedAppAttest = profileEntitlements[
    'com.apple.developer.devicecheck.appattest-environment'
  ];
  if (!(provisionedAppAttest === expected.appAttestEnvironment
    || (Array.isArray(provisionedAppAttest)
      && provisionedAppAttest.includes(expected.appAttestEnvironment)))) {
    reject('IPA_PROVISIONING_PROFILE_MISMATCH');
  }
  const provisionedDomains = profileEntitlements['com.apple.developer.associated-domains'];
  if (!(provisionedDomains === '*'
    || (Array.isArray(provisionedDomains)
      && expected.associatedDomains.every((domain) => provisionedDomains.includes(domain))))) {
    reject('IPA_PROVISIONING_PROFILE_MISMATCH');
  }
  if (typeof profile.UUID !== 'string' || profile.UUID.length === 0) {
    reject('IPA_PROVISIONING_PROFILE_MISMATCH');
  }
  return {
    expiration: expiration.toISOString(),
    name: typeof profile.Name === 'string' ? profile.Name : null,
    uuid: profile.UUID,
  };
}

function validateFirebasePlists(sourceBytes, embeddedBytes, expected) {
  if (!googleServicesPlistsHaveSameContent(sourceBytes, embeddedBytes)) {
    reject('IPA_FIREBASE_PLIST_CONTENT_MISMATCH');
  }
  const source = parsePlistDictionary(sourceBytes, 'IPA_FIREBASE_PLIST_INVALID');
  const embedded = parsePlistDictionary(embeddedBytes, 'IPA_FIREBASE_PLIST_INVALID');
  for (const plist of [source, embedded]) {
    if (plist.BUNDLE_ID !== expected.bundleIdentifier
      || plist.PROJECT_ID !== expected.firebaseProjectId) {
      reject('IPA_FIREBASE_PLIST_IDENTITY_MISMATCH');
    }
  }
  return {
    bundleIdentifier: expected.bundleIdentifier,
    projectIdentifier: expected.firebaseProjectId,
    sourceSha256: sha256(sourceBytes),
    embeddedSha256: sha256(embeddedBytes),
    semanticEquality: true,
  };
}

function sortedUniqueStrings(value, code) {
  if (value === undefined) return [];
  return stableStrings(value, code);
}

function normalizePrivacyManifest(bytes, relativePath) {
  const code = 'IPA_PRIVACY_MANIFEST_INVALID';
  const manifest = parsePlistDictionary(bytes, code);
  const tracking = manifest.NSPrivacyTracking ?? false;
  if (typeof tracking !== 'boolean') reject(code);
  const trackingDomains = sortedUniqueStrings(manifest.NSPrivacyTrackingDomains, code);
  if (tracking || trackingDomains.length > 0) reject('IPA_PRIVACY_TRACKING_PRESENT');

  const collected = manifest.NSPrivacyCollectedDataTypes ?? [];
  if (!Array.isArray(collected)) reject(code);
  const collectedDataTypes = collected.map((entry) => {
    if (!exactObject(entry)
      || typeof entry.NSPrivacyCollectedDataType !== 'string'
      || typeof entry.NSPrivacyCollectedDataTypeLinked !== 'boolean'
      || typeof entry.NSPrivacyCollectedDataTypeTracking !== 'boolean') reject(code);
    const purposes = sortedUniqueStrings(entry.NSPrivacyCollectedDataTypePurposes, code);
    if (entry.NSPrivacyCollectedDataTypeTracking) reject('IPA_PRIVACY_TRACKING_PRESENT');
    for (const [category, types] of Object.entries(FORBIDDEN_PRIVACY_DATA_TYPES)) {
      if (types.includes(entry.NSPrivacyCollectedDataType)) {
        reject(`IPA_FORBIDDEN_${category.replace(/([a-z])([A-Z])/gu, '$1_$2').toUpperCase()}_PRIVACY_DATA`);
      }
    }
    return {
      dataType: entry.NSPrivacyCollectedDataType,
      linked: entry.NSPrivacyCollectedDataTypeLinked,
      purposes,
      tracking: entry.NSPrivacyCollectedDataTypeTracking,
    };
  }).sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));

  const accessed = manifest.NSPrivacyAccessedAPITypes ?? [];
  if (!Array.isArray(accessed)) reject(code);
  const accessedApiTypes = accessed.map((entry) => {
    if (!exactObject(entry) || typeof entry.NSPrivacyAccessedAPIType !== 'string') reject(code);
    return {
      apiType: entry.NSPrivacyAccessedAPIType,
      reasons: sortedUniqueStrings(entry.NSPrivacyAccessedAPITypeReasons, code),
    };
  }).sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));

  return {
    relativePath,
    sha256: sha256(bytes),
    tracking,
    trackingDomains,
    dataTypes: collectedDataTypes,
    apis: accessedApiTypes,
  };
}

function inventoryPrivacyManifests(appPath, files) {
  const manifests = files.filter((path) => basename(path) === 'PrivacyInfo.xcprivacy');
  const rootManifest = join(appPath, 'PrivacyInfo.xcprivacy');
  if (!manifests.includes(rootManifest)) reject('IPA_ROOT_PRIVACY_MANIFEST_MISSING');
  const inventory = manifests.map((path) => normalizePrivacyManifest(
    readBoundRegularFile(path, { code: 'IPA_PRIVACY_MANIFEST_INVALID' }),
    relative(appPath, path),
  )).sort((left, right) => compareStrings(left.relativePath, right.relativePath));
  const firebaseAuth = inventory.find((entry) => (
    entry.relativePath === 'FirebaseAuth_Privacy.bundle/PrivacyInfo.xcprivacy'
  ));
  const expectedFirebaseAuthDataTypes = [{
    dataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
    linked: false,
    purposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
    tracking: false,
  }, {
    dataType: 'NSPrivacyCollectedDataTypeUserID',
    linked: true,
    purposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    tracking: false,
  }].sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));
  if (!firebaseAuth
    || firebaseAuth.tracking !== false
    || firebaseAuth.trackingDomains.length !== 0
    || !isDeepStrictEqual(firebaseAuth.dataTypes, expectedFirebaseAuthDataTypes)) {
    reject('IPA_FIREBASE_AUTH_PRIVACY_MANIFEST_MISMATCH');
  }
  return inventory;
}

function containsMarker(bytes, lowerLatin1, marker) {
  const ascii = Buffer.from(marker, 'utf8');
  const utf16 = Buffer.from(marker, 'utf16le');
  if (bytes.includes(ascii) || bytes.includes(utf16)) return true;
  return lowerLatin1.includes(marker.toLowerCase());
}

function protectedCategoryCode(category) {
  return `IPA_FORBIDDEN_${category.replace(/([a-z])([A-Z])/gu, '$1_$2').toUpperCase()}_REFERENCE`;
}

function scanForbiddenReferences(appPath, files) {
  const categoryNames = Object.keys(FORBIDDEN_MARKERS).sort();
  for (const path of files) {
    const relativePath = relative(appPath, path);
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const bytes = readBoundRegularFile(path, { code: 'IPA_SCAN_INPUT_INVALID' });
    const lowerPath = pathBytes.toString('latin1').toLowerCase();
    const lowerBytes = bytes.toString('latin1').toLowerCase();
    for (const category of categoryNames) {
      for (const marker of FORBIDDEN_MARKERS[category]) {
        if (containsMarker(pathBytes, lowerPath, marker)
          || containsMarker(bytes, lowerBytes, marker)) {
          reject(protectedCategoryCode(category));
        }
      }
    }
  }
  return Object.fromEntries(categoryNames.map((category) => [category, {
    markersChecked: FORBIDDEN_MARKERS[category].length,
    matches: 0,
  }]));
}

function findExactlyOneFile(files, appPath, basename_, missingCode, duplicateCode) {
  const matches = files.filter((path) => basename(path) === basename_);
  if (matches.length === 0) reject(missingCode);
  if (matches.length !== 1 || matches[0] !== join(appPath, basename_)) reject(duplicateCode);
  return matches[0];
}

function writeExclusivePrivateFile(path, bytes, code = 'IPA_AUDIT_OUTPUT_INVALID') {
  if (!Buffer.isBuffer(bytes) || typeof path !== 'string' || !isAbsolute(path)) reject(code);
  const parent = dirname(path);
  let parentStat;
  try {
    parentStat = lstatSync(parent);
  } catch {
    reject(code);
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) reject(code);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : parentStat.uid;
  if ((parentStat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE || parentStat.uid !== currentUid) {
    reject(code);
  }
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(
      path,
      FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    created = true;
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    chmodSync(path, PRIVATE_FILE_MODE);
  } catch {
    if (created) {
      try {
        rmSync(path, { force: false });
      } catch {
        // The caller still receives a fail-closed result; never replace an existing path.
      }
    }
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fsyncPrivateDirectory(path, code) {
  let descriptor;
  try {
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_DIRECTORY ?? 0));
    if (!fstatSync(descriptor).isDirectory()) reject(code);
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof IpaAuditError) throw error;
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function materializeAuditOutputs({ outputPath, evidenceBytes, directory, artifacts }) {
  const entries = [[outputPath, evidenceBytes, 'IPA_AUDIT_OUTPUT_INVALID']];
  if (directory !== undefined) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) {
      reject('IPA_ATTESTATION_OUTPUT_INVALID');
    }
    let stat;
    try {
      stat = lstatSync(directory);
    } catch {
      reject('IPA_ATTESTATION_OUTPUT_INVALID');
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isDirectory()
      || stat.isSymbolicLink()
      || stat.uid !== currentUid
      || (stat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
      reject('IPA_ATTESTATION_OUTPUT_INVALID');
    }
    entries.unshift(...[
    ['signed-entitlements.plist', artifacts.entitlements],
    ['embedded-GoogleService-Info.plist', artifacts.embeddedGoogleServicesPlist],
    ['signing-certificate.der', artifacts.signingCertificate],
    ['embedded.mobileprovision', artifacts.provisioningProfile],
    ].map(([name, bytes]) => [join(directory, name), bytes, 'IPA_ATTESTATION_OUTPUT_INVALID']));
  }
  for (const [path, , code] of entries) {
    try {
      lstatSync(path);
      reject(code);
    } catch (error) {
      if (error instanceof IpaAuditError) throw error;
      if (error?.code !== 'ENOENT') reject(code);
    }
  }
  const created = [];
  try {
    for (const [path, bytes, code] of entries) {
      writeExclusivePrivateFile(path, bytes, code);
      created.push(path);
    }
    for (const parent of [...new Set(entries.map(([path]) => dirname(path)))].sort()) {
      fsyncPrivateDirectory(parent, 'IPA_AUDIT_OUTPUT_INVALID');
    }
  } catch (error) {
    for (const path of created.reverse()) {
      try {
        rmSync(path, { force: false });
      } catch {
        // Preserve the original fail-closed error; these files were created by this invocation only.
      }
    }
    for (const parent of [...new Set(entries.map(([path]) => dirname(path)))].sort()) {
      try {
        fsyncPrivateDirectory(parent, 'IPA_AUDIT_OUTPUT_INVALID');
      } catch {
        // The original error remains authoritative; the canonical report is absent.
      }
    }
    throw error;
  }
}

export function auditExtractedApplication({
  ipaBytes,
  sourceGoogleServicesPlistBytes,
  extractionRoot,
  expected: rawExpected,
  generatedAt: rawGeneratedAt,
  commandRunner = defaultCommandRunner,
}) {
  if (!Buffer.isBuffer(ipaBytes) || !Buffer.isBuffer(sourceGoogleServicesPlistBytes)) {
    reject('IPA_AUDIT_INPUT_INVALID');
  }
  const expected = validateExpected(rawExpected);
  const generatedAt = validateGeneratedAt(rawGeneratedAt);
  const files = walkPrivateTree(extractionRoot);
  const appPath = locateApplication(extractionRoot);
  const appFiles = files.filter((path) => path.startsWith(`${appPath}${sep}`));
  const infoPath = join(appPath, 'Info.plist');
  const infoBytes = readBoundRegularFile(infoPath, { code: 'IPA_INFO_PLIST_INVALID' });
  const info = parsePlistDictionary(infoBytes, 'IPA_INFO_PLIST_INVALID');
  const candidate = validateBundleInfo(info, expected);
  const executablePath = join(appPath, candidate.executable);
  if (!appFiles.includes(executablePath)) reject('IPA_EXECUTABLE_MISSING');

  runRequired(
    commandRunner,
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    'IPA_CODE_SIGNATURE_INVALID',
  );
  const detailsResult = runRequired(
    commandRunner,
    '/usr/bin/codesign',
    ['-d', '--verbose=4', appPath],
    'IPA_CODESIGN_DETAILS_INVALID',
  );
  const details = parseCodesignDetails(Buffer.concat([detailsResult.stdout, detailsResult.stderr]));
  if (details.values.get('Identifier') !== expected.bundleIdentifier
    || details.values.get('TeamIdentifier') !== expected.teamIdentifier
    || details.authorities.length === 0
    || !/^(?:Apple|iPhone) Distribution:/u.test(details.authorities[0])) {
    reject('IPA_CODESIGN_IDENTITY_MISMATCH');
  }

  const entitlementsResult = runRequired(
    commandRunner,
    '/usr/bin/codesign',
    ['-d', '--xml', '--entitlements', '-', appPath],
    'IPA_SIGNED_ENTITLEMENTS_INVALID',
  );
  const entitlementsBytes = entitlementsResult.stdout;
  const entitlements = parsePlistDictionary(entitlementsBytes, 'IPA_SIGNED_ENTITLEMENTS_INVALID');
  const entitlementKeys = validateSignedEntitlements(entitlements, expected);

  const certificateRoot = mkdtempSync(join(extractionRoot, '.signing-certificates.'));
  chmodSync(certificateRoot, PRIVATE_DIRECTORY_MODE);
  const certificatePrefix = join(certificateRoot, 'certificate-');
  runRequired(
    commandRunner,
    '/usr/bin/codesign',
    ['-d', `--extract-certificates=${certificatePrefix}`, appPath],
    'IPA_SIGNING_CERTIFICATE_INVALID',
  );
  const signingCertificate = readBoundRegularFile(`${certificatePrefix}0`, {
    code: 'IPA_SIGNING_CERTIFICATE_INVALID',
    maxBytes: 1024 * 1024,
  });

  const provisioningPath = findExactlyOneFile(
    appFiles,
    appPath,
    'embedded.mobileprovision',
    'IPA_PROVISIONING_PROFILE_MISSING',
    'IPA_PROVISIONING_PROFILE_DUPLICATE',
  );
  const provisioningBytes = readBoundRegularFile(provisioningPath, {
    code: 'IPA_PROVISIONING_PROFILE_INVALID',
    maxBytes: 4 * 1024 * 1024,
  });
  const profileResult = runRequired(
    commandRunner,
    '/usr/bin/security',
    ['cms', '-D', '-i', provisioningPath],
    'IPA_PROVISIONING_PROFILE_INVALID',
  );
  const profile = parsePlistDictionary(
    profileResult.stdout,
    'IPA_PROVISIONING_PROFILE_INVALID',
  );
  const profileEvidence = validateProvisioningProfile(profile, expected, signingCertificate);

  const embeddedPlistPath = findExactlyOneFile(
    appFiles,
    appPath,
    'GoogleService-Info.plist',
    'IPA_FIREBASE_PLIST_MISSING',
    'IPA_FIREBASE_PLIST_DUPLICATE',
  );
  const embeddedGoogleServicesPlist = readBoundRegularFile(embeddedPlistPath, {
    code: 'IPA_FIREBASE_PLIST_INVALID',
    maxBytes: 256 * 1024,
  });
  const firebase = validateFirebasePlists(
    sourceGoogleServicesPlistBytes,
    embeddedGoogleServicesPlist,
    expected,
  );

  const privacyManifests = inventoryPrivacyManifests(appPath, appFiles);
  const protectedResources = scanForbiddenReferences(appPath, appFiles);
  const fileInventory = appFiles.map((path) => {
    const bytes = readBoundRegularFile(path, { code: 'IPA_INVENTORY_INVALID' });
    return {
      relativePath: relative(appPath, path),
      size: bytes.length,
      sha256: sha256(bytes),
    };
  }).sort((left, right) => compareStrings(left.relativePath, right.relativePath));
  const evidence = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ipa-privacy-report',
    status: 'passed',
    generatedAt,
    candidate: {
      bundleIdentifier: candidate.bundleIdentifier,
      marketingVersion: candidate.marketingVersion,
      buildNumber: candidate.buildNumber,
      teamIdentifier: expected.teamIdentifier,
      appAttestEnvironment: expected.appAttestEnvironment,
      associatedDomains: expected.associatedDomains,
      appBoundDomains: candidate.appBoundDomains,
    },
    ipaSha256: sha256(ipaBytes),
    signature: {
      verified: true,
      identifier: expected.bundleIdentifier,
      teamIdentifier: expected.teamIdentifier,
      distributionAuthoritySha256: sha256(Buffer.from(details.authorities[0], 'utf8')),
      signedEntitlementsSha256: sha256(entitlementsBytes),
      signedEntitlementKeys: entitlementKeys,
      signingCertificateSha256: sha256(signingCertificate),
      provisioningProfileSha256: sha256(provisioningBytes),
      provisioningProfile: profileEvidence,
    },
    firebase,
    sensitivePermissions: {
      photos: false,
      camera: false,
      microphone: false,
      location: false,
      healthKit: false,
    },
    sensitiveFrameworks: [],
    forbiddenPayloadStrings: [],
    protectedResources: {
      forbiddenInfoPlistKeysChecked: [...FORBIDDEN_INFO_PLIST_KEYS].sort(),
      forbiddenEntitlementKeysChecked: [...FORBIDDEN_ENTITLEMENT_KEYS].sort(),
      binaryAndResourceScan: protectedResources,
    },
    privacyManifests,
    inventory: {
      fileCount: fileInventory.length,
      privacyManifestCount: privacyManifests.length,
      files: fileInventory,
    },
    tracking: false,
    failures: [],
  };
  return {
    evidence,
    artifacts: {
      embeddedGoogleServicesPlist,
      entitlements: entitlementsBytes,
      provisioningProfile: provisioningBytes,
      signingCertificate,
    },
  };
}

export function auditIpa({
  ipaPath,
  googleServicesPlistPath,
  outputPath,
  attestationInputDirectory,
  expected,
  generatedAt,
}, dependencies = {}) {
  if (![ipaPath, googleServicesPlistPath, outputPath].every((path) => (
    typeof path === 'string' && isAbsolute(path)
  )) || (attestationInputDirectory !== undefined
    && (typeof attestationInputDirectory !== 'string'
      || !isAbsolute(attestationInputDirectory)))) reject('IPA_AUDIT_PATH_INVALID');
  const absoluteIpaPath = resolve(ipaPath);
  const ipaBytes = ensureAbsoluteFile(absoluteIpaPath, 'IPA_INPUT_INVALID', {
    maxBytes: MAX_IPA_BYTES,
    requirePrivate: true,
  });
  const sourceGoogleServicesPlistBytes = ensureAbsoluteFile(
    resolve(googleServicesPlistPath),
    'IPA_SOURCE_FIREBASE_PLIST_INVALID',
    { maxBytes: 256 * 1024, requirePrivate: true },
  );
  const temporaryParent = dependencies.temporaryRootParent ?? tmpdir();
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  const extractArchive = dependencies.extractArchive ?? ((source, destination) => (
    defaultExtractArchive(source, destination, commandRunner)
  ));
  let extractionRoot;
  try {
    extractionRoot = mkdtempSync(join(temporaryParent, TEMPORARY_PREFIX));
    chmodSync(extractionRoot, PRIVATE_DIRECTORY_MODE);
    extractArchive(absoluteIpaPath, extractionRoot);
    const rootStat = statSync(extractionRoot);
    if ((rootStat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) reject('IPA_TEMPORARY_ROOT_INVALID');
    const result = auditExtractedApplication({
      ipaBytes,
      sourceGoogleServicesPlistBytes,
      extractionRoot,
      expected,
      generatedAt,
      commandRunner,
    });
    const evidenceBytes = canonicalJsonBytes(result.evidence);
    materializeAuditOutputs({
      outputPath: resolve(outputPath),
      evidenceBytes,
      directory: attestationInputDirectory === undefined
        ? undefined
        : resolve(attestationInputDirectory),
      artifacts: result.artifacts,
    });
    return Object.freeze({
      evidence: result.evidence,
      evidenceSha256: sha256(evidenceBytes),
      outputPath: resolve(outputPath),
    });
  } finally {
    if (extractionRoot !== undefined) {
      rmSync(extractionRoot, { recursive: true, force: true });
    }
  }
}

export function parseCliArguments(arguments_) {
  if (!Array.isArray(arguments_)) reject('IPA_AUDIT_ARGUMENTS_INVALID');
  const parsed = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (typeof flag !== 'string' || !flag.startsWith('--')
      || !OPTION_NAMES.has(flag.slice(2))
      || typeof value !== 'string' || value.length === 0
      || parsed.has(flag.slice(2))) {
      reject('IPA_AUDIT_ARGUMENTS_INVALID');
    }
    parsed.set(flag.slice(2), value);
  }
  if (arguments_.length % 2 !== 0
    || REQUIRED_OPTIONS.some((option) => !parsed.has(option))) {
    reject('IPA_AUDIT_ARGUMENTS_INVALID');
  }
  return {
    ipaPath: parsed.get('ipa'),
    googleServicesPlistPath: parsed.get('google-services-plist'),
    outputPath: parsed.get('output'),
    attestationInputDirectory: parsed.get('attestation-input-dir'),
    generatedAt: parsed.get('generated-at'),
    expected: {
      bundleIdentifier: parsed.get('bundle-id'),
      marketingVersion: parsed.get('version'),
      buildNumber: parsed.get('build'),
      teamIdentifier: parsed.get('team-id'),
      firebaseProjectId: parsed.get('firebase-project-id'),
      appAttestEnvironment: parsed.get('app-attest-environment'),
      associatedDomains: [parsed.get('associated-domain')],
    },
  };
}

function main() {
  const input = parseCliArguments(process.argv.slice(2));
  const result = auditIpa(input);
  process.stdout.write(`IPA_AUDIT_PASS ${result.evidenceSha256}\n`);
}

const invokedAsCli = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  try {
    main();
  } catch (error) {
    const code = error instanceof IpaAuditError ? error.message : 'IPA_AUDIT_INTERNAL_ERROR';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
