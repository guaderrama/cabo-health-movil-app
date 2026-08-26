import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  APPLE_RELEASE_CANDIDATE,
  APP_STORE_METADATA_CHECK_IDS,
  ApplePostBuildEvidenceError,
  PHYSICAL_IPHONE_QA_CHECK_IDS,
  SCREENSHOT_LOCALES,
  SCREENSHOT_SCENE_IDS,
  canonicalAppleEvidenceBytes,
  createApplePostBuildEvidence,
  parseAppleEvidenceCliArguments,
  validateAppStoreConnectEvidence,
  validateIpaPrivacyReport,
  validatePhysicalIphoneQaEvidence,
  validateScreenshotsManifest,
} from '../scripts/apple-post-build-evidence.mjs';

const SOURCE_SHA = '1'.repeat(64);
const TESTFLIGHT_BUILD_ID = '987654321';
const PROCESSED_AT = '2026-08-25T12:00:00.000Z';
const NOW = Date.parse('2026-08-26T00:00:00.000Z');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function checks(keys) {
  return Object.fromEntries(keys.map((key) => [key, true]));
}

function physicalQa() {
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-physical-iphone-qa',
    candidate: { ...APPLE_RELEASE_CANDIDATE },
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    sourceTreeSha256: SOURCE_SHA,
    status: 'passed',
    performedAt: '2026-08-25T13:00:00.000Z',
    reviewedAt: '2026-08-25T14:00:00.000Z',
    devices: [{
      opaqueId: '2'.repeat(64),
      model: 'iPhone 16 Pro Max',
      osVersion: '18.6',
      installation: 'clean',
      locales: [...SCREENSHOT_LOCALES],
      result: 'passed',
      evidenceSha256: '3'.repeat(64),
    }, {
      opaqueId: '4'.repeat(64),
      model: 'iPhone 15 Pro Max',
      osVersion: '18.5.1',
      installation: 'upgrade',
      locales: [...SCREENSHOT_LOCALES],
      result: 'passed',
      evidenceSha256: '5'.repeat(64),
    }],
    checks: checks(PHYSICAL_IPHONE_QA_CHECK_IDS),
    failures: [],
    humanSignOff: true,
  };
}

function appStoreConnectEvidence() {
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-app-store-connect-evidence',
    candidate: { ...APPLE_RELEASE_CANDIDATE },
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    status: 'ready-for-review',
    capturedAt: '2026-08-25T15:00:00.000Z',
    reviewedAt: '2026-08-25T16:00:00.000Z',
    appResourceId: APPLE_RELEASE_CANDIDATE.appleId,
    appStoreVersionId: 'app-store-version-123',
    buildResourceId: '123e4567-e89b-42d3-a456-426614174001',
    appStoreVersionState: 'PREPARE_FOR_SUBMISSION',
    buildProcessingState: 'VALID',
    metadataChecks: checks(APP_STORE_METADATA_CHECK_IDS),
    failures: [],
    evidenceSnapshotSha256: '6'.repeat(64),
  };
}

function pendingScreenshots() {
  return {
    schemaVersion: 2,
    status: 'pending-exact-rc-capture',
    marketingVersion: '3.0',
    buildNumber: '5',
    deviceClass: 'iPhone 6.9-inch',
    locales: [...SCREENSHOT_LOCALES],
    sceneIds: [...SCREENSHOT_SCENE_IDS],
    captures: [],
    requiredEvidence: {
      testFlightBuildId: null,
      sourceSha: null,
      imageHashes: null,
      ocrExcludedScopeCheck: null,
      humanVisualSignOff: null,
    },
  };
}

function png(width, height, suffix) {
  const bytes = Buffer.alloc(24 + Buffer.byteLength(suffix));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write(suffix, 24, 'utf8');
  return bytes;
}

function finalScreenshots(root) {
  const captures = [];
  for (const locale of SCREENSHOT_LOCALES) {
    for (const sceneId of SCREENSHOT_SCENE_IDS) {
      const relativePath = `screenshots/${locale}/iphone-6.9/${sceneId}.png`;
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const bytes = png(1320, 2868, `${locale}:${sceneId}`);
      writeFileSync(path, bytes, { mode: 0o600 });
      chmodSync(path, 0o600);
      captures.push({
        locale,
        sceneId,
        relativePath,
        sha256: sha256(bytes),
        width: 1320,
        height: 2868,
        format: 'png',
        capturedAt: '2026-08-25T17:00:00.000Z',
        testFlightBuildId: TESTFLIGHT_BUILD_ID,
      });
    }
  }
  return {
    schemaVersion: 2,
    status: 'exact-rc-captured-and-approved',
    marketingVersion: '3.0',
    buildNumber: '5',
    deviceClass: 'iPhone 6.9-inch',
    locales: [...SCREENSHOT_LOCALES],
    sceneIds: [...SCREENSHOT_SCENE_IDS],
    captures,
    requiredEvidence: {
      testFlightBuildId: TESTFLIGHT_BUILD_ID,
      sourceSha: SOURCE_SHA,
      imageHashes: captures.map((capture) => capture.sha256),
      ocrExcludedScopeCheck: true,
      humanVisualSignOff: true,
    },
  };
}

function privacyReport() {
  const firebaseManifestHash = '7'.repeat(64);
  const rootManifestHash = '8'.repeat(64);
  const privacyManifests = [{
    relativePath: 'FirebaseAuth_Privacy.bundle/PrivacyInfo.xcprivacy',
    sha256: firebaseManifestHash,
    tracking: false,
    trackingDomains: [],
    dataTypes: [{
      dataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
      linked: false,
      purposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
      tracking: false,
    }, {
      dataType: 'NSPrivacyCollectedDataTypeUserID',
      linked: true,
      purposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      tracking: false,
    }],
    apis: [{
      apiType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      reasons: ['CA92.1'],
    }],
  }, {
    relativePath: 'PrivacyInfo.xcprivacy',
    sha256: rootManifestHash,
    tracking: false,
    trackingDomains: [],
    dataTypes: [],
    apis: [],
  }];
  const inventoryFiles = [{
    relativePath: 'FirebaseAuth_Privacy.bundle/PrivacyInfo.xcprivacy',
    size: 2102,
    sha256: firebaseManifestHash,
  }, {
    relativePath: 'Info.plist',
    size: 1024,
    sha256: '9'.repeat(64),
  }, {
    relativePath: 'PrivacyInfo.xcprivacy',
    size: 1386,
    sha256: rootManifestHash,
  }];
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ipa-privacy-report',
    status: 'passed',
    generatedAt: '2026-08-25T11:00:00.000Z',
    candidate: {
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '5',
      teamIdentifier: 'DQ8PH2DZ3R',
      appAttestEnvironment: 'production',
      associatedDomains: ['applinks:cabohealth.org'],
      appBoundDomains: ['cabohealth.org'],
    },
    ipaSha256: 'a'.repeat(64),
    signature: {
      verified: true,
      identifier: 'com.cabohealth.app',
      teamIdentifier: 'DQ8PH2DZ3R',
      distributionAuthoritySha256: 'b'.repeat(64),
      signedEntitlementsSha256: 'c'.repeat(64),
      signedEntitlementKeys: [
        'application-identifier',
        'beta-reports-active',
        'com.apple.developer.associated-domains',
        'com.apple.developer.devicecheck.appattest-environment',
        'com.apple.developer.team-identifier',
        'get-task-allow',
      ],
      signingCertificateSha256: 'd'.repeat(64),
      provisioningProfileSha256: 'e'.repeat(64),
      provisioningProfile: {
        expiration: '2030-01-01T00:00:00.000Z',
        name: 'CaboHealth App Store',
        uuid: 'ABCDEF12-3456-4789-ABCD-ABCDEF123456',
      },
    },
    firebase: {
      bundleIdentifier: 'com.cabohealth.app',
      projectIdentifier: 'cabohealth-owner-prod',
      sourceSha256: 'f'.repeat(64),
      embeddedSha256: '0'.repeat(64),
      semanticEquality: true,
    },
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
      forbiddenInfoPlistKeysChecked: [
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
      ],
      forbiddenEntitlementKeysChecked: [
        'aps-environment',
        'com.apple.developer.healthkit',
        'com.apple.developer.healthkit.access',
        'com.apple.developer.healthkit.background-delivery',
        'com.apple.developer.location.push',
        'com.apple.developer.location.push.service',
        'com.apple.security.application-groups',
        'keychain-access-groups',
      ],
      binaryAndResourceScan: Object.fromEntries([
        'camera',
        'devPanel',
        'expoFileSystem',
        'healthKit',
        'location',
        'microphone',
        'photos',
        'staffUrl',
      ].map((key) => [key, { markersChecked: 2, matches: 0 }])),
    },
    privacyManifests,
    inventory: {
      fileCount: inventoryFiles.length,
      privacyManifestCount: privacyManifests.length,
      files: inventoryFiles,
    },
    tracking: false,
    failures: [],
  };
}

function expectEvidenceError(callback, code) {
  assert.throws(callback, (error) => (
    error instanceof ApplePostBuildEvidenceError && error.message === code
  ));
}

test('physical iPhone evidence requires two distinct devices and all twelve rows', () => {
  const evidence = physicalQa();
  assert.equal(validatePhysicalIphoneQaEvidence(evidence, {
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    sourceTreeSha256: SOURCE_SHA,
    testFlightProcessedAt: PROCESSED_AT,
  }, { now: NOW }), evidence);

  const missingCheck = structuredClone(evidence);
  delete missingCheck.checks.scopeAudit;
  expectEvidenceError(
    () => validatePhysicalIphoneQaEvidence(missingCheck, {}, { now: NOW }),
    'PHYSICAL_IPHONE_QA_INVALID',
  );
  const duplicateInstallation = structuredClone(evidence);
  duplicateInstallation.devices[1].installation = 'clean';
  expectEvidenceError(
    () => validatePhysicalIphoneQaEvidence(duplicateInstallation, {}, { now: NOW }),
    'PHYSICAL_IPHONE_QA_INVALID',
  );
  const inventedFailure = structuredClone(evidence);
  inventedFailure.failures.push('ignored');
  expectEvidenceError(
    () => validatePhysicalIphoneQaEvidence(inventedFailure, {}, { now: NOW }),
    'PHYSICAL_IPHONE_QA_INVALID',
  );
});

test('App Store Connect evidence binds the exact resource and twelve saved metadata checks', () => {
  const evidence = appStoreConnectEvidence();
  assert.equal(validateAppStoreConnectEvidence(evidence, {
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    testFlightProcessedAt: PROCESSED_AT,
  }, { now: NOW }), evidence);

  for (const mutate of [
    (copy) => { copy.buildResourceId = ''; },
    (copy) => { copy.buildResourceId = copy.testFlightBuildId; },
    (copy) => { copy.metadataChecks.privacy = false; },
    (copy) => { copy.appStoreVersionState = 'WAITING_FOR_REVIEW'; },
    (copy) => { copy.unreviewed = true; },
  ]) {
    const copy = structuredClone(evidence);
    mutate(copy);
    expectEvidenceError(
      () => validateAppStoreConnectEvidence(copy, {}, { now: NOW }),
      'APP_STORE_CONNECT_EVIDENCE_INVALID',
    );
  }
});

test('screenshot authority accepts the exact pending phase and a file-backed final phase only', (t) => {
  assert.equal(validateScreenshotsManifest(pendingScreenshots(), { phase: 'pending' }).status,
    'pending-exact-rc-capture');
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-screenshots.'));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const final = finalScreenshots(root);
  const bindings = {
    phase: 'final',
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    sourceTreeSha256: SOURCE_SHA,
    testFlightProcessedAt: PROCESSED_AT,
    evidenceRoot: root,
    requireFiles: true,
    now: NOW,
  };
  assert.equal(validateScreenshotsManifest(final, bindings), final);

  const wrongOrder = structuredClone(final);
  [wrongOrder.captures[0], wrongOrder.captures[1]] = [
    wrongOrder.captures[1],
    wrongOrder.captures[0],
  ];
  expectEvidenceError(
    () => validateScreenshotsManifest(wrongOrder, bindings),
    'SCREENSHOTS_MANIFEST_INVALID',
  );
  const selfAuthoredHash = structuredClone(final);
  selfAuthoredHash.captures[0].sha256 = 'f'.repeat(64);
  selfAuthoredHash.requiredEvidence.imageHashes[0] = 'f'.repeat(64);
  expectEvidenceError(
    () => validateScreenshotsManifest(selfAuthoredHash, bindings),
    'SCREENSHOTS_MANIFEST_INVALID',
  );
  expectEvidenceError(
    () => validateScreenshotsManifest(pendingScreenshots(), { phase: 'final' }),
    'SCREENSHOTS_MANIFEST_INVALID',
  );
});

test('IPA privacy evidence binds inventory, signature, Firebase, protected scope, and SDK manifests', () => {
  const evidence = privacyReport();
  const bindings = {
    ipaSha256: 'a'.repeat(64),
    signedEntitlementsSha256: 'c'.repeat(64),
    signingCertificateSha256: 'd'.repeat(64),
    embeddedProvisioningProfileSha256: 'e'.repeat(64),
    sourceGoogleServicesPlistSha256: 'f'.repeat(64),
    embeddedGoogleServicesPlistSha256: '0'.repeat(64),
  };
  assert.equal(validateIpaPrivacyReport(evidence, bindings, { now: NOW }), evidence);

  for (const mutate of [
    (copy) => { copy.sensitivePermissions.photos = true; },
    (copy) => { copy.privacyManifests[0].dataTypes[0].purposes = []; },
    (copy) => { copy.inventory.files[0].sha256 = '1'.repeat(64); },
    (copy) => { copy.protectedResources.binaryAndResourceScan.devPanel.matches = 1; },
    (copy) => { copy.unreviewed = true; },
  ]) {
    const copy = structuredClone(evidence);
    mutate(copy);
    expectEvidenceError(
      () => validateIpaPrivacyReport(copy, bindings, { now: NOW }),
      'IPA_PRIVACY_REPORT_INVALID',
    );
  }
});

test('producer writes canonical private evidence once and refuses missing bindings or overwrite', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-evidence-producer.')));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'physical-input.json');
  const output = join(root, 'physical-output.json');
  const evidence = physicalQa();
  writeFileSync(input, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  chmodSync(input, 0o600);

  const parsed = parseAppleEvidenceCliArguments([
    'physical-iphone-qa',
    '--input', input,
    '--output', output,
    '--testflight-build-id', TESTFLIGHT_BUILD_ID,
    '--source-tree-sha256', SOURCE_SHA,
    '--testflight-processed-at', PROCESSED_AT,
  ]);
  const produced = createApplePostBuildEvidence(parsed, { now: NOW });
  assert.deepEqual(readFileSync(output), canonicalAppleEvidenceBytes(evidence));
  assert.equal((statSync(output).mode & 0o777), 0o600);
  assert.equal(produced.sha256, sha256(readFileSync(output)));
  expectEvidenceError(
    () => createApplePostBuildEvidence(parsed, { now: NOW }),
    'APPLE_EVIDENCE_PRODUCTION_INVALID',
  );
  expectEvidenceError(
    () => parseAppleEvidenceCliArguments([
      'physical-iphone-qa', '--input', input, '--output', join(root, 'other.json'),
    ]),
    'APPLE_EVIDENCE_ARGUMENTS_INVALID',
  );
});
