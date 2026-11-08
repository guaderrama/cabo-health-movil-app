#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as FS_CONSTANTS,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPLE_RELEASE_CANDIDATE = Object.freeze({
  appleId: '6758285327',
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '15',
});

export const PHYSICAL_IPHONE_QA_CHECK_IDS = Object.freeze([
  'firstLaunch',
  'homeCatalogAndSaved',
  'nativeToolsClinicalSafety',
  'publicHosting',
  'productionClientAccess',
  'appReviewAccess',
  'protectedWebView',
  'externalWebView',
  'ownerPortalExclusion',
  'universalLinks',
  'localizationAppearanceAccessibility',
  'platformSecurityAndPrivacy',
  'scopeAudit',
]);

export const APP_STORE_METADATA_CHECK_IDS = Object.freeze([
  'localizations',
  'privacy',
  'ageRating',
  'categories',
  'availability',
  'contentRights',
  'exportCompliance',
  'appReviewInfo',
  'reviewNotes',
  'screenshots',
  'buildSelected',
  'dsa',
]);

export const APP_STORE_AGE_RATING_RESULT = Object.freeze({
  questionnaireMatchedFreezeBaseline: true,
  unrestrictedWebAccess: true,
  updatedGlobalRating: '16+',
  legacyGlobalRating: '17+',
  regionalResultsStatus: 'not-asserted',
});

export const SCREENSHOT_LOCALES = Object.freeze(['en-US', 'es-MX']);
export const SCREENSHOT_SCENE_IDS = Object.freeze([
  '01-launch',
  '02-resource-catalog',
  '03-healthy-recipes',
  '04-clinic-guide',
  '05-client-resources-locked',
  '06-eligibility-code-entry',
  '07-saved',
  '08-settings-and-legal',
]);
export const APPLE_PORTRAIT_69_SCREENSHOT_SIZES = Object.freeze([
  Object.freeze([1260, 2736]),
  Object.freeze([1290, 2796]),
  Object.freeze([1320, 2868]),
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROFILE_UUID_PATTERN = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[1-5][A-Fa-f0-9]{3}-[89AaBb][A-Fa-f0-9]{3}-[A-Fa-f0-9]{12}$/u;
const APP_STORE_CONNECT_UUID_PATTERN = /^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/u;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/u;
const TESTFLIGHT_BUILD_ID_PATTERN = /^\d+$/u;
const PRIVATE_MODE = 0o600;
const PUBLIC_MODE = 0o644;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

const PHYSICAL_QA_KEYS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'candidate',
  'testFlightBuildId',
  'sourceTreeSha256',
  'status',
  'performedAt',
  'reviewedAt',
  'devices',
  'checks',
  'failures',
  'humanSignOff',
]);
const DEVICE_KEYS = Object.freeze([
  'opaqueId',
  'model',
  'osVersion',
  'installation',
  'locales',
  'result',
  'evidenceSha256',
]);
const APP_STORE_EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'candidate',
  'testFlightBuildId',
  'status',
  'capturedAt',
  'reviewedAt',
  'appResourceId',
  'appStoreVersionId',
  'buildResourceId',
  'appStoreVersionState',
  'buildProcessingState',
  'metadataChecks',
  'ageRatingResult',
  'failures',
  'evidenceSnapshotSha256',
]);
const SCREENSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'status',
  'marketingVersion',
  'buildNumber',
  'deviceClass',
  'locales',
  'sceneIds',
  'captures',
  'requiredEvidence',
]);
const CAPTURE_KEYS = Object.freeze([
  'locale',
  'sceneId',
  'relativePath',
  'sha256',
  'width',
  'height',
  'format',
  'capturedAt',
  'testFlightBuildId',
]);
const SCREENSHOT_EVIDENCE_KEYS = Object.freeze([
  'testFlightBuildId',
  'sourceSha',
  'imageHashes',
  'ocrExcludedScopeCheck',
  'humanVisualSignOff',
]);

const PRIVACY_REPORT_KEYS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'status',
  'generatedAt',
  'candidate',
  'ipaSha256',
  'signature',
  'firebase',
  'sensitivePermissions',
  'sensitiveFrameworks',
  'forbiddenPayloadStrings',
  'protectedResources',
  'privacyManifests',
  'inventory',
  'tracking',
  'failures',
]);
const PRIVACY_CANDIDATE = Object.freeze({
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '15',
  teamIdentifier: 'DQ8PH2DZ3R',
  appAttestEnvironment: 'production',
  associatedDomains: ['applinks:cabohealth.org'],
  appBoundDomains: ['cabohealth.org'],
});
const SIGNATURE_KEYS = Object.freeze([
  'verified',
  'identifier',
  'teamIdentifier',
  'distributionAuthoritySha256',
  'signedEntitlementsSha256',
  'signedEntitlementKeys',
  'signingCertificateSha256',
  'provisioningProfileSha256',
  'provisioningProfile',
]);
const SIGNED_ENTITLEMENT_KEYS = Object.freeze([
  'application-identifier',
  'beta-reports-active',
  'com.apple.developer.associated-domains',
  'com.apple.developer.devicecheck.appattest-environment',
  'com.apple.developer.team-identifier',
  'get-task-allow',
]);
const FIREBASE_KEYS = Object.freeze([
  'bundleIdentifier',
  'projectIdentifier',
  'sourceSha256',
  'embeddedSha256',
  'semanticEquality',
]);
const SENSITIVE_PERMISSION_KEYS = Object.freeze([
  'photos',
  'camera',
  'microphone',
  'location',
  'healthKit',
]);
const PROTECTED_RESOURCE_KEYS = Object.freeze([
  'forbiddenInfoPlistKeysChecked',
  'forbiddenEntitlementKeysChecked',
  'binaryAndResourceScan',
]);
const BINARY_SCAN_KEYS = Object.freeze([
  'camera',
  'devPanel',
  'expoFileSystem',
  'healthKit',
  'location',
  'microphone',
  'photos',
  'staffUrl',
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
].sort());
const FORBIDDEN_ENTITLEMENT_KEYS = Object.freeze([
  'aps-environment',
  'com.apple.developer.healthkit',
  'com.apple.developer.healthkit.access',
  'com.apple.developer.healthkit.background-delivery',
  'com.apple.developer.location.push',
  'com.apple.developer.location.push.service',
  'com.apple.security.application-groups',
  'keychain-access-groups',
].sort());
const PRIVACY_MANIFEST_KEYS = Object.freeze([
  'relativePath',
  'sha256',
  'tracking',
  'trackingDomains',
  'dataTypes',
  'apis',
]);
const DATA_TYPE_KEYS = Object.freeze([
  'dataType',
  'linked',
  'purposes',
  'tracking',
]);
const API_KEYS = Object.freeze(['apiType', 'reasons']);
const INVENTORY_KEYS = Object.freeze(['fileCount', 'privacyManifestCount', 'files']);
const INVENTORY_FILE_KEYS = Object.freeze(['relativePath', 'size', 'sha256']);
const FORBIDDEN_PRIVACY_DATA_TYPES = new Set([
  'NSPrivacyCollectedDataTypeAudioData',
  'NSPrivacyCollectedDataTypeCoarseLocation',
  'NSPrivacyCollectedDataTypeFitness',
  'NSPrivacyCollectedDataTypeHealth',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypePreciseLocation',
]);
const FIREBASE_AUTH_DATA_TYPES = Object.freeze([
  Object.freeze({
    dataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
    linked: false,
    purposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
    tracking: false,
  }),
  Object.freeze({
    dataType: 'NSPrivacyCollectedDataTypeUserID',
    linked: true,
    purposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    tracking: false,
  }),
]);

export class ApplePostBuildEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ApplePostBuildEvidenceError';
  }
}

function reject(code) {
  throw new ApplePostBuildEvidenceError(code);
}

function exactObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return exactObject(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function exactCandidate(value) {
  return exactKeys(value, Object.keys(APPLE_RELEASE_CANDIDATE))
    && isDeepStrictEqual(value, APPLE_RELEASE_CANDIDATE);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

export function canonicalAppleEvidenceBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value))}\n`, 'utf8');
}

function timestamp(value, code, now = Date.now()) {
  if (typeof value !== 'string') reject(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString() !== value
    || milliseconds > now + 5 * 60 * 1000) reject(code);
  return milliseconds;
}

function processedAt(binding, code, now) {
  if (binding === undefined) return null;
  return timestamp(binding, code, now);
}

function exactTrueChecks(value, keys) {
  return exactKeys(value, keys) && keys.every((key) => value[key] === true);
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !value.includes('\\')
    && !value.includes('\0')
    && !value.startsWith('/')
    && value === posix.normalize(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function isSortedUniqueStrings(values) {
  return Array.isArray(values)
    && values.every((value) => typeof value === 'string' && value.length > 0)
    && isDeepStrictEqual(values, [...new Set(values)].sort());
}

function sameOptionalBinding(value, expected, pattern, code) {
  if (!pattern.test(value ?? '')) reject(code);
  if (expected !== undefined && value !== expected) reject(code);
}

export function validatePhysicalIphoneQaEvidence(value, bindings = {}, {
  now = Date.now(),
} = {}) {
  const code = 'PHYSICAL_IPHONE_QA_INVALID';
  if (!exactKeys(value, PHYSICAL_QA_KEYS)
    || value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-physical-iphone-qa'
    || !exactCandidate(value.candidate)
    || value.status !== 'passed'
    || !Array.isArray(value.devices)
    || value.devices.length !== 2
    || !exactTrueChecks(value.checks, PHYSICAL_IPHONE_QA_CHECK_IDS)
    || !Array.isArray(value.failures)
    || value.failures.length !== 0
    || value.humanSignOff !== true) reject(code);
  sameOptionalBinding(
    value.testFlightBuildId,
    bindings.testFlightBuildId,
    TESTFLIGHT_BUILD_ID_PATTERN,
    code,
  );
  sameOptionalBinding(
    value.sourceTreeSha256,
    bindings.sourceTreeSha256,
    SHA256_PATTERN,
    code,
  );
  const performedAt = timestamp(value.performedAt, code, now);
  const reviewedAt = timestamp(value.reviewedAt, code, now);
  const minimum = processedAt(bindings.testFlightProcessedAt, code, now);
  if (reviewedAt < performedAt || (minimum !== null && performedAt < minimum)) reject(code);

  const opaqueIds = new Set();
  const installations = [];
  for (const device of value.devices) {
    if (!exactKeys(device, DEVICE_KEYS)
      || !SHA256_PATTERN.test(device.opaqueId ?? '')
      || opaqueIds.has(device.opaqueId)
      || typeof device.model !== 'string'
      || !/^[A-Za-z0-9 .()+-]{2,80}$/u.test(device.model)
      || typeof device.osVersion !== 'string'
      || !/^\d+(?:\.\d+){0,2}$/u.test(device.osVersion)
      || !['clean', 'upgrade'].includes(device.installation)
      || !isDeepStrictEqual(device.locales, SCREENSHOT_LOCALES)
      || device.result !== 'passed'
      || !SHA256_PATTERN.test(device.evidenceSha256 ?? '')) reject(code);
    opaqueIds.add(device.opaqueId);
    installations.push(device.installation);
  }
  if (!isDeepStrictEqual(installations.sort(), ['clean', 'upgrade'])) reject(code);
  return value;
}

export function validateAppStoreConnectEvidence(value, bindings = {}, {
  now = Date.now(),
} = {}) {
  const code = 'APP_STORE_CONNECT_EVIDENCE_INVALID';
  if (!exactKeys(value, APP_STORE_EVIDENCE_KEYS)
    || value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-app-store-connect-evidence'
    || !exactCandidate(value.candidate)
    || value.status !== 'ready-for-review'
    || value.appResourceId !== APPLE_RELEASE_CANDIDATE.appleId
    || !RESOURCE_ID_PATTERN.test(value.appStoreVersionId ?? '')
    || !APP_STORE_CONNECT_UUID_PATTERN.test(value.buildResourceId ?? '')
    || value.buildResourceId === value.testFlightBuildId
    || !['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(value.appStoreVersionState)
    || value.buildProcessingState !== 'VALID'
    || !exactTrueChecks(value.metadataChecks, APP_STORE_METADATA_CHECK_IDS)
    || !exactKeys(value.ageRatingResult, Object.keys(APP_STORE_AGE_RATING_RESULT))
    || !isDeepStrictEqual(value.ageRatingResult, APP_STORE_AGE_RATING_RESULT)
    || !Array.isArray(value.failures)
    || value.failures.length !== 0
    || !SHA256_PATTERN.test(value.evidenceSnapshotSha256 ?? '')) reject(code);
  sameOptionalBinding(
    value.testFlightBuildId,
    bindings.testFlightBuildId,
    TESTFLIGHT_BUILD_ID_PATTERN,
    code,
  );
  const capturedAt = timestamp(value.capturedAt, code, now);
  const reviewedAt = timestamp(value.reviewedAt, code, now);
  const minimum = processedAt(bindings.testFlightProcessedAt, code, now);
  if (reviewedAt < capturedAt || (minimum !== null && capturedAt < minimum)) reject(code);
  return value;
}

function safeScreenshotPath(value, locale, format) {
  if (!safeRelativePath(value)
    || !value.startsWith(`screenshots/${locale}/iphone-6.9/`)) return false;
  const extension = posix.extname(value).slice(1).toLowerCase();
  return extension === format
    || (format === 'jpeg' && extension === 'jpg')
    || (format === 'jpg' && extension === 'jpeg');
}

function pngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24
    || !bytes.subarray(0, 8).equals(signature)
    || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    format: 'png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda || offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (startOfFrame.has(marker)) {
      if (length < 7) return null;
      return {
        format: 'jpeg',
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function imageIdentity(bytes) {
  return pngDimensions(bytes) ?? jpegDimensions(bytes);
}

function readBoundFile(path, {
  code,
  mode = null,
  maxBytes = Number.MAX_SAFE_INTEGER,
} = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) reject(code);
  let descriptor;
  try {
    descriptor = openSync(path, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isFile()
      || stat.isSymbolicLink?.()
      || stat.nlink !== 1
      || stat.uid !== currentUid
      || stat.size > maxBytes
      || (mode !== null && (stat.mode & 0o777) !== mode)
      || realpathSync(path) !== path) reject(code);
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof ApplePostBuildEvidenceError) throw error;
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function screenshotBytes(evidenceRoot, relativePath, code) {
  if (typeof evidenceRoot !== 'string' || !isAbsolute(evidenceRoot)) reject(code);
  const root = realpathSync(resolve(evidenceRoot));
  const path = resolve(root, relativePath);
  const difference = relative(root, path);
  if (difference.startsWith('..') || isAbsolute(difference)) reject(code);
  return readBoundFile(path, { code, mode: PRIVATE_MODE, maxBytes: 100 * 1024 * 1024 });
}

function validateScreenshotHeader(value, code) {
  if (!exactKeys(value, SCREENSHOT_KEYS)
    || value.schemaVersion !== 2
    || value.marketingVersion !== APPLE_RELEASE_CANDIDATE.marketingVersion
    || value.buildNumber !== APPLE_RELEASE_CANDIDATE.buildNumber
    || value.deviceClass !== 'iPhone 6.9-inch'
    || !isDeepStrictEqual(value.locales, SCREENSHOT_LOCALES)
    || !isDeepStrictEqual(value.sceneIds, SCREENSHOT_SCENE_IDS)
    || !Array.isArray(value.captures)
    || !exactKeys(value.requiredEvidence, SCREENSHOT_EVIDENCE_KEYS)) reject(code);
}

function validatePendingScreenshots(value, code) {
  if (value.status !== 'pending-exact-rc-capture'
    || value.captures.length !== 0
    || !SCREENSHOT_EVIDENCE_KEYS.every((key) => value.requiredEvidence[key] === null)) {
    reject(code);
  }
  return value;
}

function validateFinalScreenshots(value, bindings, { now, evidenceRoot, requireFiles }, code) {
  if (value.status !== 'exact-rc-captured-and-approved'
    || value.captures.length !== 16
    || !TESTFLIGHT_BUILD_ID_PATTERN.test(value.requiredEvidence.testFlightBuildId ?? '')
    || !SHA256_PATTERN.test(value.requiredEvidence.sourceSha ?? '')
    || value.requiredEvidence.ocrExcludedScopeCheck !== true
    || value.requiredEvidence.humanVisualSignOff !== true
    || !Array.isArray(value.requiredEvidence.imageHashes)
    || value.requiredEvidence.imageHashes.length !== 16) reject(code);
  if (bindings.testFlightBuildId !== undefined
    && value.requiredEvidence.testFlightBuildId !== bindings.testFlightBuildId) reject(code);
  if (bindings.sourceTreeSha256 !== undefined
    && value.requiredEvidence.sourceSha !== bindings.sourceTreeSha256) reject(code);
  const minimum = processedAt(bindings.testFlightProcessedAt, code, now);
  if (requireFiles && evidenceRoot === undefined) reject(code);

  const expectedPairs = SCREENSHOT_LOCALES.flatMap(
    (locale) => SCREENSHOT_SCENE_IDS.map((sceneId) => [locale, sceneId]),
  );
  const paths = new Set();
  const hashes = [];
  for (let index = 0; index < expectedPairs.length; index += 1) {
    const capture = value.captures[index];
    const [locale, sceneId] = expectedPairs[index];
    if (!exactKeys(capture, CAPTURE_KEYS)
      || capture.locale !== locale
      || capture.sceneId !== sceneId
      || !['png', 'jpg', 'jpeg'].includes(capture.format)
      || !safeScreenshotPath(capture.relativePath, locale, capture.format)
      || paths.has(capture.relativePath)
      || !SHA256_PATTERN.test(capture.sha256 ?? '')
      || !APPLE_PORTRAIT_69_SCREENSHOT_SIZES.some(([width, height]) => (
        capture.width === width && capture.height === height
      ))
      || capture.testFlightBuildId !== value.requiredEvidence.testFlightBuildId) reject(code);
    const capturedAt = timestamp(capture.capturedAt, code, now);
    if (minimum !== null && capturedAt < minimum) reject(code);
    paths.add(capture.relativePath);
    hashes.push(capture.sha256);
    if (evidenceRoot !== undefined) {
      const bytes = screenshotBytes(evidenceRoot, capture.relativePath, code);
      const identity = imageIdentity(bytes);
      const expectedFormat = capture.format === 'png' ? 'png' : 'jpeg';
      if (sha256(bytes) !== capture.sha256
        || identity?.format !== expectedFormat
        || identity.width !== capture.width
        || identity.height !== capture.height) reject(code);
    }
  }
  if (!isDeepStrictEqual(value.requiredEvidence.imageHashes, hashes)) reject(code);
  return value;
}

export function validateScreenshotsManifest(value, {
  phase = 'either',
  testFlightBuildId,
  sourceTreeSha256,
  testFlightProcessedAt,
  now = Date.now(),
  evidenceRoot,
  requireFiles = false,
} = {}) {
  const code = 'SCREENSHOTS_MANIFEST_INVALID';
  if (!['pending', 'final', 'either'].includes(phase)) reject(code);
  validateScreenshotHeader(value, code);
  if (value.status === 'pending-exact-rc-capture' && phase !== 'final') {
    return validatePendingScreenshots(value, code);
  }
  if (phase === 'pending') reject(code);
  return validateFinalScreenshots(value, {
    testFlightBuildId,
    sourceTreeSha256,
    testFlightProcessedAt,
  }, { now, evidenceRoot, requireFiles }, code);
}

function validatePrivacySignature(signature, bindings, code, now) {
  const profile = signature?.provisioningProfile;
  if (!exactKeys(signature, SIGNATURE_KEYS)
    || signature.verified !== true
    || signature.identifier !== PRIVACY_CANDIDATE.bundleIdentifier
    || signature.teamIdentifier !== PRIVACY_CANDIDATE.teamIdentifier
    || !SHA256_PATTERN.test(signature.distributionAuthoritySha256 ?? '')
    || !SHA256_PATTERN.test(signature.signedEntitlementsSha256 ?? '')
    || !isDeepStrictEqual(signature.signedEntitlementKeys, SIGNED_ENTITLEMENT_KEYS)
    || !SHA256_PATTERN.test(signature.signingCertificateSha256 ?? '')
    || !SHA256_PATTERN.test(signature.provisioningProfileSha256 ?? '')
    || !exactKeys(profile, ['expiration', 'name', 'uuid'])
    || !(profile.name === null
      || (typeof profile.name === 'string' && profile.name.length > 0 && profile.name.length <= 256))
    || !PROFILE_UUID_PATTERN.test(profile.uuid ?? '')) reject(code);
  const expiration = timestamp(profile.expiration, code, Number.MAX_SAFE_INTEGER);
  if (expiration <= now) reject(code);
  for (const [key, expected] of [
    ['signedEntitlementsSha256', bindings.signedEntitlementsSha256],
    ['signingCertificateSha256', bindings.signingCertificateSha256],
    ['provisioningProfileSha256', bindings.embeddedProvisioningProfileSha256],
  ]) {
    if (expected !== undefined && signature[key] !== expected) reject(code);
  }
}

function validatePrivacyFirebase(firebase, bindings, code) {
  if (!exactKeys(firebase, FIREBASE_KEYS)
    || firebase.bundleIdentifier !== PRIVACY_CANDIDATE.bundleIdentifier
    || firebase.projectIdentifier !== 'cabohealth-owner-prod'
    || !SHA256_PATTERN.test(firebase.sourceSha256 ?? '')
    || !SHA256_PATTERN.test(firebase.embeddedSha256 ?? '')
    || firebase.semanticEquality !== true) reject(code);
  if (bindings.sourceGoogleServicesPlistSha256 !== undefined
    && firebase.sourceSha256 !== bindings.sourceGoogleServicesPlistSha256) reject(code);
  if (bindings.embeddedGoogleServicesPlistSha256 !== undefined
    && firebase.embeddedSha256 !== bindings.embeddedGoogleServicesPlistSha256) reject(code);
}

function validateProtectedResources(value, code) {
  if (!exactKeys(value, PROTECTED_RESOURCE_KEYS)
    || !isDeepStrictEqual(value.forbiddenInfoPlistKeysChecked, FORBIDDEN_INFO_PLIST_KEYS)
    || !isDeepStrictEqual(value.forbiddenEntitlementKeysChecked, FORBIDDEN_ENTITLEMENT_KEYS)
    || !exactKeys(value.binaryAndResourceScan, BINARY_SCAN_KEYS)) reject(code);
  for (const key of BINARY_SCAN_KEYS) {
    const result = value.binaryAndResourceScan[key];
    if (!exactKeys(result, ['markersChecked', 'matches'])
      || !Number.isSafeInteger(result.markersChecked)
      || result.markersChecked <= 0
      || result.matches !== 0) reject(code);
  }
}

function validatePrivacyManifests(manifests, code) {
  if (!Array.isArray(manifests) || manifests.length === 0) reject(code);
  const paths = [];
  for (const manifest of manifests) {
    if (!exactKeys(manifest, PRIVACY_MANIFEST_KEYS)
      || !safeRelativePath(manifest.relativePath)
      || posix.basename(manifest.relativePath) !== 'PrivacyInfo.xcprivacy'
      || !SHA256_PATTERN.test(manifest.sha256 ?? '')
      || manifest.tracking !== false
      || !isDeepStrictEqual(manifest.trackingDomains, [])
      || !Array.isArray(manifest.dataTypes)
      || !Array.isArray(manifest.apis)) reject(code);
    paths.push(manifest.relativePath);
    let previousData = null;
    for (const dataType of manifest.dataTypes) {
      if (!exactKeys(dataType, DATA_TYPE_KEYS)
        || typeof dataType.dataType !== 'string'
        || dataType.dataType.length === 0
        || typeof dataType.linked !== 'boolean'
        || !isSortedUniqueStrings(dataType.purposes)
        || dataType.tracking !== false
        || FORBIDDEN_PRIVACY_DATA_TYPES.has(dataType.dataType)) reject(code);
      const canonical = JSON.stringify(dataType);
      if (previousData !== null && canonical <= previousData) reject(code);
      previousData = canonical;
    }
    let previousApi = null;
    for (const api of manifest.apis) {
      if (!exactKeys(api, API_KEYS)
        || typeof api.apiType !== 'string'
        || api.apiType.length === 0
        || !isSortedUniqueStrings(api.reasons)) reject(code);
      const canonical = JSON.stringify(api);
      if (previousApi !== null && canonical <= previousApi) reject(code);
      previousApi = canonical;
    }
  }
  if (!isDeepStrictEqual(paths, [...new Set(paths)].sort())) reject(code);
  const firebaseAuth = manifests.find((manifest) => (
    manifest.relativePath === 'FirebaseAuth_Privacy.bundle/PrivacyInfo.xcprivacy'
  ));
  const rootManifest = manifests.find((manifest) => manifest.relativePath === 'PrivacyInfo.xcprivacy');
  if (!rootManifest
    || !firebaseAuth
    || !isDeepStrictEqual(firebaseAuth.dataTypes, FIREBASE_AUTH_DATA_TYPES)) reject(code);
}

function validatePrivacyInventory(inventory, manifests, code) {
  if (!exactKeys(inventory, INVENTORY_KEYS)
    || !Number.isSafeInteger(inventory.fileCount)
    || inventory.fileCount <= 0
    || !Number.isSafeInteger(inventory.privacyManifestCount)
    || !Array.isArray(inventory.files)
    || inventory.fileCount !== inventory.files.length
    || inventory.privacyManifestCount !== manifests.length) reject(code);
  const paths = [];
  const inventoryByPath = new Map();
  for (const file of inventory.files) {
    if (!exactKeys(file, INVENTORY_FILE_KEYS)
      || !safeRelativePath(file.relativePath)
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !SHA256_PATTERN.test(file.sha256 ?? '')) reject(code);
    paths.push(file.relativePath);
    inventoryByPath.set(file.relativePath, file);
  }
  if (!isDeepStrictEqual(paths, [...new Set(paths)].sort())) reject(code);
  for (const manifest of manifests) {
    const file = inventoryByPath.get(manifest.relativePath);
    if (!file || file.sha256 !== manifest.sha256) reject(code);
  }
}

export function validateIpaPrivacyReport(value, bindings = {}, {
  now = Date.now(),
} = {}) {
  const code = 'IPA_PRIVACY_REPORT_INVALID';
  if (!exactKeys(value, PRIVACY_REPORT_KEYS)
    || value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-ipa-privacy-report'
    || value.status !== 'passed'
    || !exactKeys(value.candidate, Object.keys(PRIVACY_CANDIDATE))
    || !isDeepStrictEqual(value.candidate, PRIVACY_CANDIDATE)
    || !SHA256_PATTERN.test(value.ipaSha256 ?? '')
    || value.tracking !== false
    || !Array.isArray(value.failures)
    || value.failures.length !== 0
    || !exactKeys(value.sensitivePermissions, SENSITIVE_PERMISSION_KEYS)
    || !SENSITIVE_PERMISSION_KEYS.every((key) => value.sensitivePermissions[key] === false)
    || !isDeepStrictEqual(value.sensitiveFrameworks, [])
    || !isDeepStrictEqual(value.forbiddenPayloadStrings, [])) reject(code);
  const generatedAt = timestamp(value.generatedAt, code, now);
  if (bindings.ipaSha256 !== undefined && value.ipaSha256 !== bindings.ipaSha256) reject(code);
  validatePrivacySignature(value.signature, bindings, code, generatedAt);
  validatePrivacyFirebase(value.firebase, bindings, code);
  validateProtectedResources(value.protectedResources, code);
  validatePrivacyManifests(value.privacyManifests, code);
  validatePrivacyInventory(value.inventory, value.privacyManifests, code);
  return value;
}

function parseJsonBytes(bytes, code) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!exactObject(value)) reject(code);
    return value;
  } catch (error) {
    if (error instanceof ApplePostBuildEvidenceError) throw error;
    reject(code);
  }
}

function writeExclusive(path, bytes, mode, code) {
  if (!isAbsolute(path) || resolve(path) !== path) reject(code);
  const parent = realpathSync(dirname(path));
  if (parent !== dirname(path)) reject(code);
  const parentStat = lstatSync(parent);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : parentStat.uid;
  if (!parentStat.isDirectory()
    || parentStat.isSymbolicLink()
    || parentStat.uid !== currentUid
    || (mode === PRIVATE_MODE && (parentStat.mode & 0o777) !== 0o700)) reject(code);
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(
      path,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      mode,
    );
    created = true;
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    chmodSync(path, mode);
  } catch (error) {
    if (created) {
      // An incomplete exclusive output is left in place for inspection. The
      // producer never replaces an existing authority or silently retries.
    }
    if (error instanceof ApplePostBuildEvidenceError) throw error;
    reject(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const CLI_COMMON_OPTIONS = Object.freeze(['input', 'output']);
const CLI_KIND_OPTIONS = Object.freeze({
  'privacy-report': Object.freeze([
    'ipa-sha256',
    'signed-entitlements-sha256',
    'signing-certificate-sha256',
    'embedded-provisioning-profile-sha256',
    'source-google-services-plist-sha256',
    'embedded-google-services-plist-sha256',
  ]),
  'physical-iphone-qa': Object.freeze([
    'testflight-build-id',
    'source-tree-sha256',
    'testflight-processed-at',
  ]),
  'app-store-connect': Object.freeze([
    'testflight-build-id',
    'testflight-processed-at',
  ]),
  screenshots: Object.freeze([
    'testflight-build-id',
    'source-tree-sha256',
    'testflight-processed-at',
    'evidence-root',
  ]),
});

export function parseAppleEvidenceCliArguments(arguments_) {
  const code = 'APPLE_EVIDENCE_ARGUMENTS_INVALID';
  if (!Array.isArray(arguments_) || arguments_.length < 1) reject(code);
  const [kind, ...rest] = arguments_;
  const kindOptions = CLI_KIND_OPTIONS[kind];
  if (!kindOptions || rest.length % 2 !== 0) reject(code);
  const allowed = new Set([...CLI_COMMON_OPTIONS, ...kindOptions]);
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    const name = typeof flag === 'string' && flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.has(name)
      || values.has(name)
      || typeof value !== 'string'
      || value.length === 0) reject(code);
    values.set(name, value);
  }
  if ([...allowed].some((name) => !values.has(name))) reject(code);
  for (const name of ['input', 'output', ...(kind === 'screenshots' ? ['evidence-root'] : [])]) {
    if (!isAbsolute(values.get(name)) || resolve(values.get(name)) !== values.get(name)) reject(code);
  }
  return Object.freeze({ kind, values });
}

export function createApplePostBuildEvidence({ kind, values }, { now = Date.now() } = {}) {
  const code = 'APPLE_EVIDENCE_PRODUCTION_INVALID';
  const input = parseJsonBytes(readBoundFile(values.get('input'), {
    code,
    maxBytes: MAX_JSON_BYTES,
  }), code);
  let validated;
  let mode;
  if (kind === 'privacy-report') {
    const bindingNames = [
      'ipa-sha256',
      'signed-entitlements-sha256',
      'signing-certificate-sha256',
      'embedded-provisioning-profile-sha256',
      'source-google-services-plist-sha256',
      'embedded-google-services-plist-sha256',
    ];
    if (bindingNames.some((name) => !SHA256_PATTERN.test(values.get(name)))) reject(code);
    validated = validateIpaPrivacyReport(input, {
      ipaSha256: values.get('ipa-sha256'),
      signedEntitlementsSha256: values.get('signed-entitlements-sha256'),
      signingCertificateSha256: values.get('signing-certificate-sha256'),
      embeddedProvisioningProfileSha256: values.get('embedded-provisioning-profile-sha256'),
      sourceGoogleServicesPlistSha256: values.get('source-google-services-plist-sha256'),
      embeddedGoogleServicesPlistSha256: values.get('embedded-google-services-plist-sha256'),
    }, { now });
    mode = PRIVATE_MODE;
  } else if (kind === 'physical-iphone-qa') {
    validated = validatePhysicalIphoneQaEvidence(input, {
      testFlightBuildId: values.get('testflight-build-id'),
      sourceTreeSha256: values.get('source-tree-sha256'),
      testFlightProcessedAt: values.get('testflight-processed-at'),
    }, { now });
    mode = PRIVATE_MODE;
  } else if (kind === 'app-store-connect') {
    validated = validateAppStoreConnectEvidence(input, {
      testFlightBuildId: values.get('testflight-build-id'),
      testFlightProcessedAt: values.get('testflight-processed-at'),
    }, { now });
    mode = PRIVATE_MODE;
  } else if (kind === 'screenshots') {
    validated = validateScreenshotsManifest(input, {
      phase: 'final',
      testFlightBuildId: values.get('testflight-build-id'),
      sourceTreeSha256: values.get('source-tree-sha256'),
      testFlightProcessedAt: values.get('testflight-processed-at'),
      evidenceRoot: values.get('evidence-root'),
      requireFiles: true,
      now,
    });
    mode = PUBLIC_MODE;
  } else {
    reject(code);
  }
  const bytes = canonicalAppleEvidenceBytes(validated);
  writeExclusive(values.get('output'), bytes, mode, code);
  return Object.freeze({ bytes, mode, sha256: sha256(bytes) });
}

function main() {
  const input = parseAppleEvidenceCliArguments(process.argv.slice(2));
  const result = createApplePostBuildEvidence(input);
  process.stdout.write(`APPLE_EVIDENCE_CREATED ${result.sha256}\n`);
}

const invokedAsCli = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  try {
    main();
  } catch (error) {
    const code = error instanceof ApplePostBuildEvidenceError
      ? error.message
      : 'APPLE_EVIDENCE_INTERNAL_ERROR';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
