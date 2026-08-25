import { isDeepStrictEqual } from 'node:util';
import { posix } from 'node:path';
import {
  APP_STORE_CONNECT_UUID_PATTERN,
  CANDIDATE,
  INITIAL_VERSION_STATES,
  METADATA_CHECK_IDS,
  QA_CHECK_IDS,
  RESOURCE_ID_PATTERN,
  SCREENSHOT_LOCALES,
  SCREENSHOT_SCENE_IDS,
  SCREENSHOT_SIZES,
  SHA256_PATTERN,
  TESTFLIGHT_BUILD_ID_PATTERN,
  UUID_PATTERN,
} from './constants.mjs';
import { readBoundJson } from './files.mjs';
import { reject } from './errors.mjs';

const RC_KEYS = Object.freeze([
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
]);
const BUILD_ARTIFACT_KEYS = Object.freeze([
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
]);
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

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function exactCandidate(value) {
  return exactKeys(value, Object.keys(CANDIDATE)) && isDeepStrictEqual(value, CANDIDATE);
}

function exactBooleanChecks(value, keys) {
  return exactKeys(value, keys) && keys.every((key) => value[key] === true);
}

function timestamp(value, code, now) {
  if (typeof value !== 'string') reject(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString() !== value
    || milliseconds > now + 5 * 60 * 1000) reject(code);
  return milliseconds;
}

function allSha256(value, keys) {
  return keys.every((key) => SHA256_PATTERN.test(value[key] ?? ''));
}

export function validateBuildArtifact(value, { now = Date.now() } = {}) {
  const code = 'BUILD_ARTIFACT_EVIDENCE_INVALID';
  const hashKeys = BUILD_ARTIFACT_KEYS.filter((key) => key.endsWith('Sha256'));
  if (!exactKeys(value, BUILD_ARTIFACT_KEYS)
    || value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-ios-build-artifact-attestation'
    || !exactCandidate(value.candidate)
    || !allSha256(value, hashKeys)
    || !UUID_PATTERN.test(value.easBuildId ?? '')) reject(code);
  timestamp(value.reviewedAt, code, now);
  return value;
}

export function validateRcAttestation(value, { now = Date.now() } = {}) {
  const code = 'RC_ATTESTATION_EVIDENCE_INVALID';
  const hashKeys = RC_KEYS.filter((key) => key.endsWith('Sha256'));
  if (!exactKeys(value, RC_KEYS)
    || value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-ios-exact-rc-attestation'
    || !exactCandidate(value.candidate)
    || !allSha256(value, hashKeys)
    || !TESTFLIGHT_BUILD_ID_PATTERN.test(value.testFlightBuildId ?? '')) reject(code);
  const processedAt = timestamp(value.testFlightProcessedAt, code, now);
  const reviewedAt = timestamp(value.reviewedAt, code, now);
  if (reviewedAt < processedAt) reject(code);
  return value;
}

export function validatePhysicalIphoneQa(value, bindings, { now = Date.now() } = {}) {
  const code = 'PHYSICAL_IPHONE_QA_INVALID';
  if (!exactKeys(value, PHYSICAL_QA_KEYS)
    || value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-physical-iphone-qa'
    || !exactCandidate(value.candidate)
    || value.testFlightBuildId !== bindings.testFlightBuildId
    || value.sourceTreeSha256 !== bindings.sourceTreeSha256
    || value.status !== 'passed'
    || !Array.isArray(value.devices) || value.devices.length !== 2
    || !exactBooleanChecks(value.checks, QA_CHECK_IDS)
    || !Array.isArray(value.failures) || value.failures.length !== 0
    || value.humanSignOff !== true) reject(code);
  const performedAt = timestamp(value.performedAt, code, now);
  const reviewedAt = timestamp(value.reviewedAt, code, now);
  if (reviewedAt < performedAt || performedAt < bindings.testFlightProcessedAtMs) reject(code);
  const installations = [];
  const opaqueIds = new Set();
  for (const device of value.devices) {
    if (!exactKeys(device, DEVICE_KEYS)
      || !SHA256_PATTERN.test(device.opaqueId ?? '')
      || opaqueIds.has(device.opaqueId)
      || typeof device.model !== 'string' || !/^[A-Za-z0-9 .()+-]{2,80}$/u.test(device.model)
      || typeof device.osVersion !== 'string' || !/^\d+(?:\.\d+){0,2}$/u.test(device.osVersion)
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

export function validateAppStoreConnectEvidence(value, bindings, { now = Date.now() } = {}) {
  const code = 'APP_STORE_CONNECT_EVIDENCE_INVALID';
  if (!exactKeys(value, APP_STORE_EVIDENCE_KEYS)
    || value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-app-store-connect-evidence'
    || !exactCandidate(value.candidate)
    || value.testFlightBuildId !== bindings.testFlightBuildId
    || value.status !== 'ready-for-review'
    || value.appResourceId !== CANDIDATE.appleId
    || !RESOURCE_ID_PATTERN.test(value.appStoreVersionId ?? '')
    || !APP_STORE_CONNECT_UUID_PATTERN.test(value.buildResourceId ?? '')
    || !INITIAL_VERSION_STATES.includes(value.appStoreVersionState)
    || value.buildProcessingState !== 'VALID'
    || !exactBooleanChecks(value.metadataChecks, METADATA_CHECK_IDS)
    || !Array.isArray(value.failures) || value.failures.length !== 0
    || !SHA256_PATTERN.test(value.evidenceSnapshotSha256 ?? '')) reject(code);
  const capturedAt = timestamp(value.capturedAt, code, now);
  const reviewedAt = timestamp(value.reviewedAt, code, now);
  if (reviewedAt < capturedAt || capturedAt < bindings.testFlightProcessedAtMs) reject(code);
  return value;
}

function safeScreenshotPath(value, locale, format) {
  if (typeof value !== 'string' || value.length > 240 || value.includes('\\')
    || value.startsWith('/') || value !== posix.normalize(value)
    || value.split('/').some((part) => part === '..' || part === '.' || part.length === 0)
    || !value.startsWith(`screenshots/${locale}/iphone-6.9/`)) return false;
  const extension = posix.extname(value).slice(1).toLowerCase();
  return extension === format || (format === 'jpeg' && extension === 'jpg')
    || (format === 'jpg' && extension === 'jpeg');
}

export function validateScreenshotsManifest(value, bindings, { now = Date.now() } = {}) {
  const code = 'SCREENSHOTS_MANIFEST_INVALID';
  if (!exactKeys(value, SCREENSHOT_KEYS)
    || value.schemaVersion !== 2
    || value.status !== 'exact-rc-captured-and-approved'
    || value.marketingVersion !== CANDIDATE.marketingVersion
    || value.buildNumber !== CANDIDATE.buildNumber
    || value.deviceClass !== 'iPhone 6.9-inch'
    || !isDeepStrictEqual(value.locales, SCREENSHOT_LOCALES)
    || !isDeepStrictEqual(value.sceneIds, SCREENSHOT_SCENE_IDS)
    || !Array.isArray(value.captures) || value.captures.length !== 16
    || !exactKeys(value.requiredEvidence, SCREENSHOT_EVIDENCE_KEYS)
    || value.requiredEvidence.testFlightBuildId !== bindings.testFlightBuildId
    || value.requiredEvidence.sourceSha !== bindings.sourceTreeSha256
    || value.requiredEvidence.ocrExcludedScopeCheck !== true
    || value.requiredEvidence.humanVisualSignOff !== true
    || !Array.isArray(value.requiredEvidence.imageHashes)
    || value.requiredEvidence.imageHashes.length !== 16) reject(code);
  const expectedPairs = SCREENSHOT_LOCALES.flatMap(
    (locale) => SCREENSHOT_SCENE_IDS.map((sceneId) => `${locale}\0${sceneId}`),
  );
  const paths = new Set();
  const hashes = [];
  for (const [index, capture] of value.captures.entries()) {
    if (!exactKeys(capture, CAPTURE_KEYS)
      || !SCREENSHOT_LOCALES.includes(capture.locale)
      || !SCREENSHOT_SCENE_IDS.includes(capture.sceneId)
      || !['png', 'jpg', 'jpeg'].includes(capture.format)
      || !safeScreenshotPath(capture.relativePath, capture.locale, capture.format)
      || paths.has(capture.relativePath)
      || !SHA256_PATTERN.test(capture.sha256 ?? '')
      || !SCREENSHOT_SIZES.some(([width, height]) => (
        capture.width === width && capture.height === height
      ))
      || capture.testFlightBuildId !== bindings.testFlightBuildId) reject(code);
    const capturedAt = timestamp(capture.capturedAt, code, now);
    if (capturedAt < bindings.testFlightProcessedAtMs) reject(code);
    const pair = `${capture.locale}\0${capture.sceneId}`;
    if (pair !== expectedPairs[index]) reject(code);
    paths.add(capture.relativePath);
    hashes.push(capture.sha256);
  }
  if (!isDeepStrictEqual(value.requiredEvidence.imageHashes, hashes)) reject(code);
  return value;
}

export function readAndValidateEvidence(args, { now = Date.now() } = {}) {
  const rcAttestation = validateRcAttestation(readBoundJson(args['rc-attestation'], {
    expectedSha256: args['rc-attestation-sha256'],
    privateFile: false,
    code: 'RC_ATTESTATION_FILE_INVALID',
  }), { now });
  const buildArtifact = validateBuildArtifact(readBoundJson(args['build-artifact-attestation'], {
    expectedSha256: args['build-artifact-attestation-sha256'],
    privateFile: false,
    code: 'BUILD_ARTIFACT_FILE_INVALID',
  }), { now });
  if (rcAttestation.candidate.appleId !== args['apple-id']
    || rcAttestation.candidate.bundleIdentifier !== args['bundle-identifier']
    || rcAttestation.candidate.marketingVersion !== args['marketing-version']
    || rcAttestation.candidate.buildNumber !== args['build-number']
    || rcAttestation.testFlightBuildId !== args['testflight-build-id']
    || rcAttestation.buildArtifactAttestationSha256 !== args['build-artifact-attestation-sha256']
    || buildArtifact.candidate.appleId !== args['apple-id']
    || buildArtifact.candidate.bundleIdentifier !== args['bundle-identifier']
    || buildArtifact.candidate.marketingVersion !== args['marketing-version']
    || buildArtifact.candidate.buildNumber !== args['build-number']
    || buildArtifact.sourceTreeSha256 !== rcAttestation.sourceTreeSha256) {
    reject('ATTESTATION_CROSS_BINDING_INVALID');
  }
  const testFlightProcessedAtMs = Date.parse(rcAttestation.testFlightProcessedAt);
  const bindings = {
    testFlightBuildId: rcAttestation.testFlightBuildId,
    sourceTreeSha256: rcAttestation.sourceTreeSha256,
    testFlightProcessedAtMs,
  };
  const physicalIphoneQa = validatePhysicalIphoneQa(readBoundJson(args['physical-iphone-qa'], {
    expectedSha256: args['physical-iphone-qa-sha256'],
    privateFile: true,
    code: 'PHYSICAL_IPHONE_QA_FILE_INVALID',
    sortKeys: true,
  }), bindings, { now });
  const appStoreConnectEvidence = validateAppStoreConnectEvidence(readBoundJson(
    args['app-store-connect-evidence'],
    {
      expectedSha256: args['app-store-connect-evidence-sha256'],
      privateFile: true,
      code: 'APP_STORE_CONNECT_EVIDENCE_FILE_INVALID',
      sortKeys: true,
    },
  ), bindings, { now });
  const screenshotsManifest = validateScreenshotsManifest(readBoundJson(
    args['screenshots-manifest'],
    {
      expectedSha256: args['screenshots-manifest-sha256'],
      privateFile: false,
      code: 'SCREENSHOTS_MANIFEST_FILE_INVALID',
      sortKeys: true,
    },
  ), bindings, { now });
  if (rcAttestation.physicalIphoneQaSha256 !== args['physical-iphone-qa-sha256']
    || rcAttestation.appStoreMetadataEvidenceSha256
      !== args['app-store-connect-evidence-sha256']
    || rcAttestation.screenshotsManifestSha256 !== args['screenshots-manifest-sha256']) {
    reject('RC_EVIDENCE_CROSS_BINDING_INVALID');
  }
  return Object.freeze({
    rcAttestation,
    buildArtifact,
    physicalIphoneQa,
    appStoreConnectEvidence,
    screenshotsManifest,
  });
}
