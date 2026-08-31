export const CANDIDATE = Object.freeze({
  appleId: '6758285327',
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '9',
});

export const ARGUMENT_NAMES = Object.freeze([
  'operation',
  'apple-id',
  'bundle-identifier',
  'marketing-version',
  'build-number',
  'testflight-build-id',
  'rc-attestation',
  'rc-attestation-sha256',
  'build-artifact-attestation',
  'build-artifact-attestation-sha256',
  'app-store-connect-evidence',
  'app-store-connect-evidence-sha256',
  'physical-iphone-qa',
  'physical-iphone-qa-sha256',
  'screenshots-manifest',
  'screenshots-manifest-sha256',
  'authorization-nonce',
]);

export const QA_CHECK_IDS = Object.freeze([
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

export const METADATA_CHECK_IDS = Object.freeze([
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
export const SCREENSHOT_SIZES = Object.freeze([
  Object.freeze([1260, 2736]),
  Object.freeze([1290, 2796]),
  Object.freeze([1320, 2868]),
]);

export const INITIAL_VERSION_STATES = Object.freeze([
  'PREPARE_FOR_SUBMISSION',
  'READY_FOR_REVIEW',
]);
export const SUBMITTED_REVIEW_STATES = Object.freeze([
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
]);
export const ACTIVE_REVIEW_STATES = Object.freeze([
  'READY_FOR_REVIEW',
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
  'UNRESOLVED_ISSUES',
  'CANCELING',
  'COMPLETING',
]);

export const API_ORIGIN = 'https://api.appstoreconnect.apple.com';
export const MAX_JSON_BYTES = 1024 * 1024;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const APP_STORE_CONNECT_UUID_PATTERN = /^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/u;
export const RESOURCE_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/u;
export const TESTFLIGHT_BUILD_ID_PATTERN = /^\d+$/u;
export const AUTHORIZATION_NONCE_PATTERN = /^[A-F0-9]{32}$/u;
