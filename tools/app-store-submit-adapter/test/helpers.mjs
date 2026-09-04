import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CANDIDATE,
  METADATA_CHECK_IDS,
  QA_CHECK_IDS,
  SCREENSHOT_LOCALES,
  SCREENSHOT_SCENE_IDS,
} from '../src/constants.mjs';
import { apiPaths, requestBodies } from '../src/api.mjs';
import { canonicalJsonBytes } from '../src/files.mjs';

export const NOW = Date.parse('2026-08-25T20:00:00.000Z');
export const TESTFLIGHT_BUILD_ID = '987654321';
export const VERSION_ID = 'aaaaaaaa-1234-4234-8234-123456789abc';
export const BUILD_RESOURCE_ID = 'bbbbbbbb-1234-4234-8234-123456789abc';
export const SOURCE_SHA = 'a'.repeat(64);

export function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function writeJson(path, value, mode = 0o644, sortKeys = false) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, canonicalJsonBytes(value, { sortKeys }), { mode });
  chmodSync(path, mode);
  return hash(readFileSync(path));
}

export function validPhysicalQa() {
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-physical-iphone-qa',
    candidate: { ...CANDIDATE },
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    sourceTreeSha256: SOURCE_SHA,
    status: 'passed',
    performedAt: '2026-08-25T18:00:00.000Z',
    reviewedAt: '2026-08-25T18:30:00.000Z',
    devices: [
      {
        opaqueId: '1'.repeat(64),
        model: 'iPhone 16 Pro Max',
        osVersion: '26.0',
        installation: 'clean',
        locales: [...SCREENSHOT_LOCALES],
        result: 'passed',
        evidenceSha256: '2'.repeat(64),
      },
      {
        opaqueId: '3'.repeat(64),
        model: 'iPhone 15 Pro Max',
        osVersion: '18.6.2',
        installation: 'upgrade',
        locales: [...SCREENSHOT_LOCALES],
        result: 'passed',
        evidenceSha256: '4'.repeat(64),
      },
    ],
    checks: Object.fromEntries(QA_CHECK_IDS.map((key) => [key, true])),
    failures: [],
    humanSignOff: true,
  };
}

export function validAppStoreEvidence({ state = 'PREPARE_FOR_SUBMISSION' } = {}) {
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-app-store-connect-evidence',
    candidate: { ...CANDIDATE },
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    status: 'ready-for-review',
    capturedAt: '2026-08-25T18:45:00.000Z',
    reviewedAt: '2026-08-25T19:00:00.000Z',
    appResourceId: CANDIDATE.appleId,
    appStoreVersionId: VERSION_ID,
    buildResourceId: BUILD_RESOURCE_ID,
    appStoreVersionState: state,
    buildProcessingState: 'VALID',
    metadataChecks: Object.fromEntries(METADATA_CHECK_IDS.map((key) => [key, true])),
    failures: [],
    evidenceSnapshotSha256: '5'.repeat(64),
  };
}

export function validScreenshots() {
  const captures = SCREENSHOT_LOCALES.flatMap((locale) => (
    SCREENSHOT_SCENE_IDS.map((sceneId, index) => ({
      locale,
      sceneId,
      relativePath: `screenshots/${locale}/iphone-6.9/${sceneId}.png`,
      sha256: hash(`${locale}:${sceneId}`),
      width: [1260, 1290, 1320][index % 3],
      height: [2736, 2796, 2868][index % 3],
      format: 'png',
      capturedAt: '2026-08-25T18:40:00.000Z',
      testFlightBuildId: TESTFLIGHT_BUILD_ID,
    }))
  ));
  return {
    schemaVersion: 2,
    status: 'exact-rc-captured-and-approved',
    marketingVersion: CANDIDATE.marketingVersion,
    buildNumber: CANDIDATE.buildNumber,
    deviceClass: 'iPhone 6.9-inch',
    locales: [...SCREENSHOT_LOCALES],
    sceneIds: [...SCREENSHOT_SCENE_IDS],
    captures,
    requiredEvidence: {
      testFlightBuildId: TESTFLIGHT_BUILD_ID,
      sourceSha: SOURCE_SHA,
      imageHashes: captures.map(({ sha256 }) => sha256),
      ocrExcludedScopeCheck: true,
      humanVisualSignOff: true,
    },
  };
}

export function createEvidenceFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-asc-adapter-')));
  const physical = validPhysicalQa();
  const appStore = validAppStoreEvidence();
  const screenshots = validScreenshots();
  const physicalPath = join(root, 'private', 'physical-iphone-qa.json');
  const appStorePath = join(root, 'private', 'app-store-connect-evidence.json');
  const screenshotsPath = join(root, 'public', 'screenshots-manifest.json');
  const appPrivacyPath = join(root, 'public', 'app-privacy.json');
  const reviewNotesPath = join(root, 'public', 'review-notes.md');
  const physicalHash = writeJson(physicalPath, physical, 0o600, true);
  const appStoreHash = writeJson(appStorePath, appStore, 0o600, true);
  const screenshotsHash = writeJson(screenshotsPath, screenshots, 0o644, true);
  const appPrivacyHash = writeJson(appPrivacyPath, {
    schemaVersion: 1,
    status: 'final',
  }, 0o644, true);
  writeFileSync(reviewNotesPath, 'Final App Review notes.\n', { mode: 0o644 });
  chmodSync(reviewNotesPath, 0o644);
  const reviewNotesHash = hash(readFileSync(reviewNotesPath));
  const buildArtifact = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-artifact-attestation',
    candidate: { ...CANDIDATE },
    buildInputAttestationSha256: '6'.repeat(64),
    sourceTreeSha256: SOURCE_SHA,
    easBuildId: '12345678-1234-4234-8234-123456789abc',
    easArtifactAssociation: {
      evidenceType: 'independently-reviewed-procedural',
      buildId: '12345678-1234-4234-8234-123456789abc',
      buildStatus: 'FINISHED',
      downloadedIpaSha256: '7'.repeat(64),
      associationGuardProven: false,
      reviewedAt: '2026-08-25T17:00:00.000Z',
    },
    ipaSha256: '7'.repeat(64),
    signedEntitlementsSha256: '8'.repeat(64),
    privacyReportSha256: '9'.repeat(64),
    embeddedGoogleServicesPlistSha256: 'b'.repeat(64),
    signingCertificateSha256: 'c'.repeat(64),
    embeddedProvisioningProfileSha256: 'd'.repeat(64),
    reviewedAt: '2026-08-25T17:00:00.000Z',
  };
  const buildPath = join(root, 'public', 'build-artifact-attestation.json');
  const buildHash = writeJson(buildPath, buildArtifact, 0o644);
  const rc = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-exact-rc-attestation',
    candidate: { ...CANDIDATE },
    buildArtifactAttestationSha256: buildHash,
    sourceTreeSha256: SOURCE_SHA,
    testFlightBuildId: TESTFLIGHT_BUILD_ID,
    testFlightProcessedAt: '2026-08-25T17:30:00.000Z',
    physicalIphoneQaSha256: physicalHash,
    screenshotsManifestSha256: screenshotsHash,
    appPrivacySha256: appPrivacyHash,
    reviewNotesSha256: reviewNotesHash,
    appStoreMetadataEvidenceSha256: appStoreHash,
    reviewedAt: '2026-08-25T19:30:00.000Z',
  };
  const rcPath = join(root, 'public', 'rc-attestation.json');
  const rcHash = writeJson(rcPath, rc, 0o644);
  const values = {
    operation: 'submit-for-review',
    'apple-id': CANDIDATE.appleId,
    'bundle-identifier': CANDIDATE.bundleIdentifier,
    'marketing-version': CANDIDATE.marketingVersion,
    'build-number': CANDIDATE.buildNumber,
    'testflight-build-id': TESTFLIGHT_BUILD_ID,
    'rc-attestation': rcPath,
    'rc-attestation-sha256': rcHash,
    'build-artifact-attestation': buildPath,
    'build-artifact-attestation-sha256': buildHash,
    'app-store-connect-evidence': appStorePath,
    'app-store-connect-evidence-sha256': appStoreHash,
    'physical-iphone-qa': physicalPath,
    'physical-iphone-qa-sha256': physicalHash,
    'screenshots-manifest': screenshotsPath,
    'screenshots-manifest-sha256': screenshotsHash,
    'app-privacy': appPrivacyPath,
    'app-privacy-sha256': appPrivacyHash,
    'review-notes': reviewNotesPath,
    'review-notes-sha256': reviewNotesHash,
    'authorization-nonce': 'F'.repeat(32),
  };
  const args = Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
  return {
    root,
    args,
    values,
    rc,
    buildArtifact,
    physical,
    appStore,
    screenshots,
  };
}

function page(data) {
  return { data, links: { self: 'fixture' }, meta: { paging: { total: data.length, limit: 200 } } };
}

export function appResource() {
  return {
    type: 'apps',
    id: CANDIDATE.appleId,
    attributes: { bundleId: CANDIDATE.bundleIdentifier },
  };
}

export function versionResource(state = 'PREPARE_FOR_SUBMISSION', buildId = BUILD_RESOURCE_ID) {
  return {
    type: 'appStoreVersions',
    id: VERSION_ID,
    attributes: {
      platform: 'IOS',
      versionString: CANDIDATE.marketingVersion,
      appVersionState: state,
    },
    relationships: { build: { data: { type: 'builds', id: buildId } } },
  };
}

export function buildResource(id = BUILD_RESOURCE_ID) {
  return {
    type: 'builds',
    id,
    attributes: { version: CANDIDATE.buildNumber, processingState: 'VALID', expired: false },
  };
}

export function submissionResource(id, state, { versionForReview = VERSION_ID } = {}) {
  return {
    type: 'reviewSubmissions',
    id,
    attributes: { platform: 'IOS', submittedDate: state === 'READY_FOR_REVIEW' ? null : '2026-08-25T19:50:00.000Z', state },
    relationships: {
      app: { data: { type: 'apps', id: CANDIDATE.appleId } },
      appStoreVersionForReview: {
        data: versionForReview === null ? null : { type: 'appStoreVersions', id: versionForReview },
      },
    },
  };
}

export function itemResource(id, submissionId, versionId = VERSION_ID) {
  return {
    type: 'reviewSubmissionItems',
    id,
    attributes: { state: 'READY_FOR_REVIEW' },
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
    },
  };
}

export function expectation(method, path, status, response, body) {
  return { method, path, status, response, ...(body === undefined ? {} : { body }) };
}

export function liveExpectations({ state = 'PREPARE_FOR_SUBMISSION', buildId = BUILD_RESOURCE_ID } = {}) {
  return [
    expectation('GET', apiPaths.app(), 200, { data: appResource() }),
    expectation('GET', apiPaths.versions(), 200, page([versionResource(state, buildId)])),
    expectation('GET', apiPaths.versionBuild(VERSION_ID), 200, { data: buildResource(buildId) }),
    expectation('GET', apiPaths.buildApp(buildId), 200, { data: appResource() }),
  ];
}

export function itemsExpectation(submissionId, items) {
  return expectation('GET', apiPaths.submissionItems(submissionId), 200, page(items));
}

export function activeExpectation(submissions) {
  return expectation('GET', apiPaths.activeSubmissions(), 200, page(submissions));
}

export function readSubmissionExpectation(submission) {
  return expectation('GET', apiPaths.submission(submission.id), 200, { data: submission });
}

export function successfulNewSubmissionExpectations({ finalState = 'WAITING_FOR_REVIEW' } = {}) {
  const submissionId = 'submission-one';
  const item = itemResource('item-one', submissionId);
  const draft = submissionResource(submissionId, 'READY_FOR_REVIEW', { versionForReview: VERSION_ID });
  const submitted = submissionResource(submissionId, finalState);
  return [
    ...liveExpectations(),
    activeExpectation([]),
    expectation('POST', '/v1/reviewSubmissions', 201, {
      data: { type: 'reviewSubmissions', id: submissionId },
    }, requestBodies.createSubmission()),
    activeExpectation([draft]),
    itemsExpectation(submissionId, []),
    expectation(
      'POST',
      '/v1/reviewSubmissionItems',
      201,
      { data: { type: 'reviewSubmissionItems', id: item.id } },
      requestBodies.createItem(submissionId, VERSION_ID),
    ),
    itemsExpectation(submissionId, [item]),
    ...liveExpectations({ state: 'READY_FOR_REVIEW' }),
    readSubmissionExpectation(draft),
    expectation(
      'PATCH',
      `/v1/reviewSubmissions/${submissionId}`,
      200,
      { data: submitted },
      requestBodies.submit(submissionId),
    ),
    readSubmissionExpectation(submitted),
    itemsExpectation(submissionId, [item]),
  ];
}
