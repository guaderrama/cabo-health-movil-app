import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AASA_COMPONENTS } from './generate-aasa.mjs';
import { validateScreenshotsManifest } from './apple-post-build-evidence.mjs';

const REQUIRED_CAPTURE_PATHS = [
  'app.json',
  'eas.json',
  'constants/config.ts',
  'constants/publicMiniapps.ts',
  'release/app-store/3.0/release-manifest.json',
  'release/app-store/3.0/age-rating.json',
  'release/app-store/3.0/app-privacy.json',
  'release/app-store/3.0/review-notes.md',
  'release/app-store/3.0/screenshots-manifest.json',
  'scripts/release-command-guard.mjs',
];

const OPTIONAL_PHASE_ATTESTATION_PATHS = Object.freeze([
  'release/app-store/3.0/build-input-attestation.json',
  'release/app-store/3.0/build-artifact-attestation.json',
  'release/app-store/3.0/rc-attestation.json',
]);

const EXACT_PUBLIC_SLUGS = ['healthy-recipes', 'clinic-guide'];
const EXACT_PUBLIC_URLS = EXACT_PUBLIC_SLUGS.map(
  (slug) => `https://cabohealth.org/apps/${slug}/`,
);
const EXACT_AASA_COMPONENTS = AASA_COMPONENTS;
const EXACT_ASC_TESTFLIGHT_BUILDS = [
  { marketingVersion: '2.0.0', buildNumber: '1', status: 'expired' },
  { marketingVersion: '2.0.0', buildNumber: '2', status: 'expired' },
  { marketingVersion: '2.0.0', buildNumber: '3', status: 'expired' },
  { marketingVersion: '3.0', buildNumber: '4', status: 'ready-to-submit-obsolete-source' },
  { marketingVersion: '3.0', buildNumber: '5', status: 'ready-to-submit-obsolete-source' },
  { marketingVersion: '3.0', buildNumber: '6', status: 'ready-to-test-obsolete-source' },
];
const EXACT_HISTORICAL_CANDIDATE_EVIDENCE = [
  { marketingVersion: '3.0', buildNumber: '4', status: 'testflight-ready-to-submit-obsolete-source', appStoreObserved: true },
  { marketingVersion: '3.0', buildNumber: '5', status: 'testflight-ready-to-submit-obsolete-source', appStoreObserved: true },
  { marketingVersion: '3.0', buildNumber: '6', status: 'testflight-ready-to-test-obsolete-source', appStoreObserved: true },
  {
    marketingVersion: '3.0',
    buildNumber: '7',
    status: 'eas-finished-and-attested-not-observed-in-app-store-connect-obsolete-source',
    appStoreObserved: false,
    trackedHistoryRoot: 'release/app-store/3.0/history/build-7',
    privateHistoryRoot: 'release/private/rc-build-7',
  },
  {
    marketingVersion: '3.0',
    buildNumber: '8',
    status: 'testflight-ready-to-submit-internal-available-obsolete-source',
    appStoreObserved: true,
    trackedHistoryRoot: 'release/app-store/3.0/history/build-8',
    privateHistoryRoot: 'release/private/rc-build-8',
  },
  {
    marketingVersion: '3.0',
    buildNumber: '9',
    status: 'input-attested-aborted-pre-provider',
    appStoreObserved: false,
    trackedHistoryRoot: 'release/app-store/3.0/history/build-9-aborted',
    privateHistoryRoot: null,
  },
  {
    marketingVersion: '3.0',
    buildNumber: '10',
    status: 'processed-internal-testflight-history',
    appStoreObserved: true,
    trackedHistoryRoot: 'release/app-store/3.0/history/build-10',
    privateHistoryRoot: 'release/private/rc-build-10',
  },
  {
    marketingVersion: '3.0',
    buildNumber: '11',
    status: 'eas-finished-attested-not-uploaded-invalidated-by-post-pin-gate-failure',
    appStoreObserved: false,
    trackedHistoryRoot: 'release/app-store/3.0/history/build-11',
    privateHistoryRoot: 'release/private/rc-build-11',
  },
];
const EXACT_HISTORICAL_INPUT_AUTHORITY_EVIDENCE = [
  {
    attempt: 1,
    status: 'input-attested-invalidated-pre-provider-source-drift',
    trackedHistoryRoot: 'release/app-store/3.0/history/build-11-input-attempt-1-aborted',
    providerOperationInitiated: false,
  },
  {
    attempt: 2,
    status: 'input-attested-invalidated-pre-provider-post-pin-gate-failure',
    trackedHistoryRoot: 'release/app-store/3.0/history/build-11-input-attempt-2-aborted',
    providerOperationInitiated: false,
  },
];
const EXACT_ASC_REVIEW_GUIDELINES = ['1.4.1', '2.1', '4.1'];
const EXACT_AUTHORITY_SHA256 = Object.freeze({
  'app.json': '24b1e958d8867f66158af415369eefb4e168f378c40ca56c22924a9a9a21369c',
  'eas.json': '834e82554d40114ae3e0ea754d9e174bf1cce821150819b9a91dd56401692ac2',
  'constants/config.ts': '5e5e48764adff924880b5b4811419570ad0a7b28c9b03bd10774c498750c1d65',
  'constants/publicMiniapps.ts': '7306d82fd7de694b16de85401a8aab431c5408037f5038ce95fc5f79edef9dda',
  'release/app-store/3.0/release-manifest.json': '45d9795648f41f3f73edc1fa42c855aba8301e392692f64624d95df093cc59b2',
  'release/app-store/3.0/age-rating.json': '2e0b8345d7f223dc28b97539c31470eaa5e57101dc564948b31b73211bf15a89',
});
const PENDING_APP_PRIVACY_SHA256 = '87ea881af75bebeb27945f6fd1bc35daec189597b81510ec498aeacddce1ab30';
const FINAL_APP_PRIVACY_SHA256 = '51287eb24455e64ce605bcd0b896d025f236f53cd1c2e2c27014a079e1192862';
const PENDING_REVIEW_NOTES_SHA256 = '13ef12a3b661275975cfaa612d0d2205787b88b5d7beab0bfebe6bdc6b7d7692';
const FINAL_REVIEW_NOTES_SHA256 = 'f40830ac93e2a5a302e357a160ebe37776eeb1b604113df4a8c808a1d85523de';
const PENDING_SCREENSHOTS_MANIFEST_SHA256 = '3536da50da96c4e45e016b36afac98ef7eff47814e9af4b8c22d97b1b07c9e28';

const PHASE_PIN_RULES = Object.freeze([
  Object.freeze({
    name: 'BUILD_INPUT_ATTESTATION_SHA256',
    path: 'release/app-store/3.0/build-input-attestation.json',
    label: 'input',
  }),
  Object.freeze({
    name: 'BUILD_ARTIFACT_ATTESTATION_SHA256',
    path: 'release/app-store/3.0/build-artifact-attestation.json',
    label: 'artifact',
  }),
  Object.freeze({
    name: 'RC_ATTESTATION_SHA256',
    path: 'release/app-store/3.0/rc-attestation.json',
    label: 'RC',
  }),
]);

function parseJson(files, path, errors) {
  const bytes = files.get(path);
  if (!Buffer.isBuffer(bytes)) {
    errors.push(`${path} is required`);
    return null;
  }
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path} must be a JSON object`);
      return null;
    }
    return value;
  } catch {
    errors.push(`${path} must be valid JSON`);
    return null;
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function extractPublicSlugs(source) {
  const match = source.match(/PUBLIC_MINIAPP_SLUGS\s*=\s*\[([^\]]*)\]/u);
  if (!match) return null;
  return [...match[1].matchAll(/['"]([^'"]+)['"]/gu)].map((entry) => entry[1]);
}

function hasExactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && sameArray(Object.keys(value).sort(), [...expected].sort());
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parsePinnedLiteral(source, name, errors) {
  const pattern = new RegExp(`^const ${name} = (null|'[^']*');$`, 'gmu');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    errors.push(`release command guard must contain one exact ${name} declaration`);
    return undefined;
  }
  const literal = matches[0][1];
  if (literal === 'null') return null;
  const value = literal.slice(1, -1);
  const expectedPattern = name.endsWith('_SHA256')
    ? /^[a-f0-9]{64}$/u
    : /^[A-Za-z0-9+/]+={0,2}$/u;
  if (!expectedPattern.test(value)) {
    errors.push(`release command guard ${name} pin has an invalid exact value`);
    return undefined;
  }
  return value;
}

export function deriveReleaseAuthorityPhase(files) {
  const errors = [];
  const guardBytes = files.get('scripts/release-command-guard.mjs');
  if (!Buffer.isBuffer(guardBytes)) {
    return {
      phase: null,
      errors: ['scripts/release-command-guard.mjs is required to derive the live release phase'],
    };
  }
  const guard = guardBytes.toString('utf8');
  const pins = Object.fromEntries([
    ...PHASE_PIN_RULES.map(({ name }) => [name, parsePinnedLiteral(guard, name, errors)]),
    ['PINNED_EAS_CLI', parsePinnedLiteral(guard, 'PINNED_EAS_CLI', errors)],
    [
      'PINNED_APP_STORE_SUBMIT_ADAPTER',
      parsePinnedLiteral(guard, 'PINNED_APP_STORE_SUBMIT_ADAPTER', errors),
    ],
  ]);
  if (pins.PINNED_EAS_CLI !== null) {
    errors.push('legacy PINNED_EAS_CLI must remain null in every build-12 phase');
  }

  let sawNull = false;
  let completed = 0;
  for (const rule of PHASE_PIN_RULES) {
    const pin = pins[rule.name];
    if (pin === null) {
      sawNull = true;
      if (Buffer.isBuffer(files.get(rule.path))) {
        errors.push(`unpinned current ${rule.label} attestation bytes are forbidden`);
      }
      continue;
    }
    if (typeof pin !== 'string') continue;
    if (sawNull) {
      errors.push('release authority phase pins must be contiguous in input, artifact, RC order');
    }
    completed += 1;
    const bytes = files.get(rule.path);
    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== pin) {
      const authorityLabel = rule.label === 'RC' ? 'RC' : `build-${rule.label}`;
      errors.push(`${rule.label} pin requires matching current ${authorityLabel} attestation bytes`);
    }
  }

  const submitPin = pins.PINNED_APP_STORE_SUBMIT_ADAPTER;
  if (typeof submitPin === 'string' && completed !== PHASE_PIN_RULES.length) {
    errors.push('submit-tool pin requires contiguous input, artifact, and RC authority pins');
  }
  if (errors.length > 0) return { phase: null, errors };
  if (typeof submitPin === 'string') return { phase: 'submit-tool', errors };
  return { phase: ['pre-input', 'input', 'artifact', 'rc'][completed], errors };
}

export function privacyAuthorityForSemanticValidation(privacyAuthority, form) {
  if (form !== 'final') return privacyAuthority;
  const finalPrivacy = privacyAuthority;
  const privacy = structuredClone(finalPrivacy);
  privacy.status = 'pending-final-linkage-category-review-and-save';
  privacy.architectureStatus = 'core-infrastructure-deployed-pending-app-attest-valid-flow-and-exact-rc-e2e';
  privacy.clientAccount.status = 'pending-final-apple-linkage-mapping';
  privacy.thirdPartyNetworkRequests.finalAppleMappingStatus = 'pending-final-destination-provider-and-category-review';
  privacy.cloudRunRequestLogs.linkedToIdentity = null;
  privacy.reviewSandbox.status = 'infrastructure-deployed-pending-credential-valid-flow-and-device-e2e';
  privacy.hostedTechnicalRequestLogs.linkedToIdentity = null;
  delete privacy.finalAppleDisclosure;
  privacy.conditionalRecommendation = {
    dataNotCollectedPath: 'Not applicable to this v3 architecture: pseudonymous identifiers and provider request records are retained off device beyond real-time request servicing.',
    dataCollectedPath: 'Required. Map the final verified production data types, purposes, linkage, and retention in App Store Connect after the exact RC and hosting configuration are tested.',
    provisionalPurpose: ['App Functionality', 'Analytics'],
    provisionalCategoryMapping: [
      'User ID — linked to the user; App Functionality; not used for tracking (exact signed FirebaseAuth privacy manifest)',
      'Other Diagnostic Data — not linked to the user; Analytics; not used for tracking (exact signed FirebaseAuth privacy manifest)',
      'Device ID, if the app-installation identifier is retained off device and disclosure is required',
      'Coarse Location, Device ID, or Other Diagnostic Data as required by Apple\'s final mapping of retained IP addresses',
      'Product Interaction, if retained requested-resource activity is in disclosure scope',
      'Performance Data, if retained latency or response-byte measurements are in disclosure scope',
      'Other Diagnostic Data, if retained HTTP method, user-agent, or technical-error records are in disclosure scope',
      'Other Data Types, only if a retained field cannot be accurately mapped to another Apple data type',
    ],
  };
  return privacy;
}

function metadataAuthorityForm(files, errors) {
  const privacyBytes = files.get('release/app-store/3.0/app-privacy.json');
  const notesBytes = files.get('release/app-store/3.0/review-notes.md');
  const privacyHash = Buffer.isBuffer(privacyBytes) ? sha256(privacyBytes) : null;
  const notesHash = Buffer.isBuffer(notesBytes) ? sha256(notesBytes) : null;
  const privacyForm = privacyHash === PENDING_APP_PRIVACY_SHA256
    ? 'pending'
    : privacyHash === FINAL_APP_PRIVACY_SHA256
      ? 'final'
      : 'invalid';
  const notesForm = notesHash === PENDING_REVIEW_NOTES_SHA256
    ? 'pending'
    : notesHash === FINAL_REVIEW_NOTES_SHA256
      ? 'final'
      : 'invalid';
  if (privacyForm === 'invalid') errors.push('privacy must retain one exact phase-aware App Privacy authority form');
  if (notesForm === 'invalid') errors.push('Review Notes must retain one exact phase-aware authority form');
  if (privacyForm !== 'invalid' && notesForm !== 'invalid' && privacyForm !== notesForm) {
    errors.push('App Privacy and Review Notes must transition as one exact pair');
  }
  return {
    form: privacyForm === notesForm ? privacyForm : 'mixed',
    privacyHash,
    notesHash,
  };
}

function screenshotAuthorityForm(files, errors) {
  const bytes = files.get('release/app-store/3.0/screenshots-manifest.json');
  if (!Buffer.isBuffer(bytes)) {
    errors.push('release/app-store/3.0/screenshots-manifest.json is required');
    return 'invalid';
  }
  if (sha256(bytes) === PENDING_SCREENSHOTS_MANIFEST_SHA256) return 'pending';
  const screenshots = parseJson(files, 'release/app-store/3.0/screenshots-manifest.json', errors);
  if (screenshots?.status === 'exact-rc-captured-and-approved') return 'final';
  errors.push('Screenshot manifest must retain the exact pending authority or an exact finalized authority');
  return 'invalid';
}

export function inspectReleasePhaseTruth(files) {
  const errors = [];
  const phaseAuthority = deriveReleaseAuthorityPhase(files);
  errors.push(...phaseAuthority.errors);
  const metadata = metadataAuthorityForm(files, errors);
  const screenshotsForm = screenshotAuthorityForm(files, errors);
  return {
    phase: phaseAuthority.phase,
    metadataForm: metadata.form,
    screenshotsForm,
    appPrivacySha256: metadata.privacyHash,
    reviewNotesSha256: metadata.notesHash,
    errors,
  };
}

function verifyFinalScreenshotPhaseBinding(files, phaseTruth, errors) {
  if (phaseTruth.screenshotsForm !== 'final') return;
  const screenshots = parseJson(files, 'release/app-store/3.0/screenshots-manifest.json', errors);
  if (!screenshots) return;
  try {
    if (phaseTruth.phase === 'artifact') {
      const artifact = parseJson(
        files,
        'release/app-store/3.0/build-artifact-attestation.json',
        errors,
      );
      if (!artifact || typeof artifact.sourceTreeSha256 !== 'string') {
        throw new Error('SCREENSHOTS_FINAL_ARTIFACT_BINDING_INVALID');
      }
      validateScreenshotsManifest(screenshots, {
        phase: 'final',
        sourceTreeSha256: artifact.sourceTreeSha256,
      });
      return;
    }
    if (phaseTruth.phase === 'rc' || phaseTruth.phase === 'submit-tool') {
      const rc = parseJson(files, 'release/app-store/3.0/rc-attestation.json', errors);
      const manifestBytes = files.get('release/app-store/3.0/screenshots-manifest.json');
      if (!rc
        || !Buffer.isBuffer(manifestBytes)
        || rc.screenshotsManifestSha256 !== sha256(manifestBytes)) {
        throw new Error('SCREENSHOTS_FINAL_RC_BINDING_INVALID');
      }
      validateScreenshotsManifest(screenshots, {
        phase: 'final',
        testFlightBuildId: rc.testFlightBuildId,
        sourceTreeSha256: rc.sourceTreeSha256,
        testFlightProcessedAt: rc.testFlightProcessedAt,
      });
      return;
    }
    throw new Error('SCREENSHOTS_FINAL_PHASE_INVALID');
  } catch {
    errors.push('Final screenshot authority must contain the exact 16-capture build-12 schema and bind the live artifact or RC phase');
  }
}

export function verifyCapturedReleaseV3(files) {
  const errors = [];
  const phaseTruth = inspectReleasePhaseTruth(files);
  errors.push(...phaseTruth.errors);
  const appJson = parseJson(files, 'app.json', errors);
  const easJson = parseJson(files, 'eas.json', errors);
  const manifest = parseJson(
    files,
    'release/app-store/3.0/release-manifest.json',
    errors,
  );
  const age = parseJson(files, 'release/app-store/3.0/age-rating.json', errors);
  const parsedPrivacy = parseJson(files, 'release/app-store/3.0/app-privacy.json', errors);
  const privacy = parsedPrivacy
    ? privacyAuthorityForSemanticValidation(parsedPrivacy, phaseTruth.metadataForm)
    : parsedPrivacy;
  const config = files.get('constants/config.ts')?.toString('utf8') ?? '';
  const publicSource = files.get('constants/publicMiniapps.ts')?.toString('utf8') ?? '';

  if (phaseTruth.phase === 'pre-input' || phaseTruth.phase === 'input') {
    if (phaseTruth.screenshotsForm !== 'pending' || phaseTruth.metadataForm !== 'pending') {
      errors.push('pre-input and input phases require the exact pending metadata baseline and pending screenshot authority');
    }
  } else if (phaseTruth.phase === 'artifact') {
    if (phaseTruth.metadataForm === 'final' && phaseTruth.screenshotsForm !== 'final') {
      errors.push('finalized metadata requires the exact finalized screenshot authority');
    }
  } else if (phaseTruth.phase === 'rc' || phaseTruth.phase === 'submit-tool') {
    if (phaseTruth.screenshotsForm !== 'final' || phaseTruth.metadataForm !== 'final') {
      errors.push('RC and submit-tool phases require the exact finalized metadata pair and finalized screenshot authority');
    }
    const rc = parseJson(files, 'release/app-store/3.0/rc-attestation.json', errors);
    if (rc && (
      rc.appPrivacySha256 !== phaseTruth.appPrivacySha256
      || rc.reviewNotesSha256 !== phaseTruth.reviewNotesSha256
    )) {
      errors.push('RC metadata hashes must bind the exact finalized App Privacy and Review Notes bytes');
    }
  }
  verifyFinalScreenshotPhaseBinding(files, phaseTruth, errors);

  for (const [path, expected] of Object.entries(EXACT_AUTHORITY_SHA256)) {
    const bytes = files.get(path);
    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== expected) {
      const label = path === 'app.json'
        ? 'app.json must retain the exact reviewed pre-build bytes'
        : path === 'eas.json'
          ? 'eas.json must retain the exact reviewed production-build bytes'
        : path.startsWith('constants/')
        ? `${path} must retain the exact reviewed bytes`
        : path.endsWith('release-manifest.json')
          ? 'release manifest must retain the exact v3 phase-neutral authority semantics'
          : path.endsWith('age-rating.json')
            ? 'age rating must retain the exact age-rating authority'
            : 'privacy must retain the exact privacy authority';
      errors.push(label);
    }
  }

  if (appJson && (
    appJson.expo?.version !== '3.0'
    || appJson.expo?.ios?.buildNumber !== '12'
  )) {
    errors.push('app.json must remain 3.0/build 12 after the build-12 rebaseline');
  }
  const productionProfile = easJson?.build?.production;
  if (!hasExactKeys(productionProfile, ['environment', 'node', 'env', 'ios'])
    || productionProfile.environment !== 'production'
    || productionProfile.node !== '22.22.3'
    || !hasExactKeys(productionProfile.env, ['APP_ENV'])
    || productionProfile.env.APP_ENV !== 'production'
    || !hasExactKeys(productionProfile.ios, ['resourceClass'])
    || productionProfile.ios.resourceClass !== 'm-medium') {
    errors.push('eas.json production must pin environment production, Node 22.22.3, APP_ENV production, and m-medium');
  }
  if (!/version:\s*['"]3\.0['"]/u.test(config)
    || !/buildNumber:\s*['"]12['"]/u.test(config)) {
    errors.push('constants/config.ts must remain 3.0/build 12 after the build-12 rebaseline');
  }

  const sourceSlugs = extractPublicSlugs(publicSource);
  if (!sameArray(sourceSlugs, EXACT_PUBLIC_SLUGS)) {
    errors.push('release must contain exactly two public miniapps');
  }

  if (manifest) {
    const manifestSchemaIsExact = hasExactKeys(manifest, [
      'schemaVersion',
      'artifactKind',
      'authoritySemantics',
      'candidate',
      'ascEvidence',
      'historicalCandidateEvidence',
      'historicalInputAuthorityEvidence',
      'ownerSeller',
      'scope',
      'reviewCredential',
      'aasaPlan',
      'urls',
      'copyright',
      'appStoreDraft',
      'gates',
      'reviewRisk',
    ])
      && hasExactKeys(manifest.authoritySemantics, [
        'documentRole',
        'livePhaseSource',
        'finalReleaseStateSource',
        'requiredRcHashBindings',
        'postInputMutationAllowed',
      ])
      && hasExactKeys(manifest.candidate, [
        'appleId',
        'bundleIdentifier',
        'marketingVersion',
        'buildNumber',
        'status',
        'appJsonUpdated',
        'configUpdated',
        'liveAuthorityPhaseSource',
      ])
      && hasExactKeys(manifest.ascEvidence, [
        'observedAt',
        'inspectionMode',
        'currentRejectedVersion',
        'currentRejectedVersionStatus',
        'versionEditable',
        'selectedRejectedBinaryVersion',
        'selectedRejectedBuild',
        'testFlightBuilds',
        'highestTestFlightBuild',
        'highestTestFlightBuildStatus',
        'nextCandidateBuild',
        'nextCandidateBuildAvailable',
        'latestReviewDate',
        'latestReviewGuidelines',
        'informationRequested',
      ])
      && Array.isArray(manifest.ascEvidence.testFlightBuilds)
      && manifest.ascEvidence.testFlightBuilds
        .every((build) => hasExactKeys(build, ['marketingVersion', 'buildNumber', 'status']))
      && Array.isArray(manifest.historicalCandidateEvidence)
      && manifest.historicalCandidateEvidence.every((build, index) => hasExactKeys(
        build,
        index >= 3
          ? ['marketingVersion', 'buildNumber', 'status', 'appStoreObserved', 'trackedHistoryRoot', 'privateHistoryRoot']
          : ['marketingVersion', 'buildNumber', 'status', 'appStoreObserved'],
      ))
      && hasExactKeys(manifest.ownerSeller, [
        'sellerType',
        'legalSeller',
        'publicBrand',
        'brandIsSeparateLegalEntity',
        'registeredOrganization',
        'dunsApplicable',
        'dunsNumber',
        'relationship',
        'releaseTerritories',
      ])
      && hasExactKeys(manifest.scope, [
        'publicMiniapps',
        'miniapps',
        'protectedResources',
        'commercialModel',
        'staffAdministration',
        'externalHttpsMiniapps',
        'access',
        'accountRequired',
        'demoCredentialRequired',
        'purchases',
        'userGeneratedContent',
        'nativeWebBridge',
        'remoteCatalog',
        'sensitivePermissions',
      ])
      && [...(manifest.scope?.publicMiniapps ?? []), ...(manifest.scope?.miniapps ?? [])]
        .every((item) => hasExactKeys(item, ['slug', 'title', 'canonicalUrl', 'universalLink']))
      && (manifest.scope?.protectedResources ?? [])
        .every((item) => hasExactKeys(item, [
          'id',
          'title',
          'canonicalUrl',
          'access',
          'serverProtectionRequired',
          'arbitraryExternalLinksPublished',
        ]))
      && hasExactKeys(manifest.scope?.staffAdministration, [
        'visibleSettingsEntry',
        'consumerBinaryReachable',
        'ownerDirectUrlOnly',
        'draftOnlyCatalogChanges',
        'directPublishing',
        'arbitraryRuntimeCatalog',
      ])
      && hasExactKeys(manifest.scope?.externalHttpsMiniapps, [
        'ownerManaged',
        'accessModes',
        'opensInsideApp',
        'sameOriginNavigationOnly',
        'vipControlsInAppEntryOnly',
        'thirdPartyContentAuthoredByCaboHealth',
        'thirdPartyContentMadePrivateByCaboHealth',
        'rightsVerificationRequiredBeforeActivation',
        'permanentCatalogItemsListedInReleaseMetadata',
      ])
      && hasExactKeys(manifest.reviewCredential, [
        'namespace',
        'purpose',
        'credentialPrefix',
        'uidRealm',
        'multiDevice',
        'credentialInRepository',
        'status',
        'fixedReviewedResourceId',
        'launchMethod',
        'launchPath',
      ])
      && hasExactKeys(manifest.aasaPlan, ['components', 'status'])
      && hasExactKeys(manifest.urls, [
        'support',
        'privacy',
        'terms',
        'reportContent',
        'marketing',
        'staff',
      ])
      && hasExactKeys(manifest.copyright, ['value', 'status'])
      && hasExactKeys(manifest.appStoreDraft, [
        'status',
        'categories',
        'copyright',
        'availability',
        'dsa',
        'contentRights',
        'unresolvedExternalGates',
      ])
      && hasExactKeys(manifest.reviewRisk, [
        'level',
        'basis',
        'appleApprovalGuaranteed',
        'fallback',
        'healthcareSellerEntityRisk',
        'externalEligibilityCredentialRisk',
      ]);
    if (!manifestSchemaIsExact
      || manifest.schemaVersion !== 3
      || manifest.artifactKind !== 'app-store-metadata-candidate'
      || !sameJson(manifest.authoritySemantics, {
        documentRole: 'immutable-freeze-baseline',
        livePhaseSource: 'release-command-guard-pins-and-required-attestation-bytes',
        finalReleaseStateSource: 'rc-attestation-and-bound-private-evidence',
        requiredRcHashBindings: [
          'physicalIphoneQaSha256',
          'screenshotsManifestSha256',
          'appStoreMetadataEvidenceSha256',
          'appPrivacySha256',
          'reviewNotesSha256',
        ],
        postInputMutationAllowed: false,
      })) {
      errors.push('release manifest must retain the exact authority schema');
    }
    if (!sameArray(manifest.ownerSeller?.releaseTerritories, ['MEX', 'USA'])) {
      errors.push('owner release territories must remain exactly MEX and USA');
    }

    const publicMiniapps = manifest.scope?.publicMiniapps;
    const publicSlugs = Array.isArray(publicMiniapps)
      ? publicMiniapps.map((item) => item?.slug)
      : null;
    const publicUrls = Array.isArray(publicMiniapps)
      ? publicMiniapps.map((item) => item?.canonicalUrl)
      : null;
    if (!sameArray(publicSlugs, EXACT_PUBLIC_SLUGS)
      || !sameArray(publicUrls, EXACT_PUBLIC_URLS)
      || !publicMiniapps.every((item) => item.universalLink === item.canonicalUrl)) {
      errors.push('release manifest must contain exactly two public miniapps');
    }
    if (!sameJson(manifest.scope?.miniapps, publicMiniapps)) {
      errors.push('public miniapp aliases must remain byte-semantically identical');
    }
    if (!sameJson(manifest.scope?.accountRequired, {
      publicResources: false,
      protectedClientResources: true,
      staffPortal: true,
      appReviewSandbox: true,
    })) {
      errors.push('account requirements must distinguish public, protected-client, staff, and App Review surfaces');
    }

    const protectedResources = manifest.scope?.protectedResources;
    if (!Array.isArray(protectedResources)
      || protectedResources.length !== 1
      || protectedResources[0]?.id !== 'client-resources'
      || protectedResources[0]?.title !== 'Client Resources'
      || protectedResources[0]?.canonicalUrl !== 'https://cabohealth.org/apps/client-resources/'
      || protectedResources[0]?.access !== 'existing-client-eligibility'
      || protectedResources[0]?.serverProtectionRequired !== true
      || protectedResources[0]?.arbitraryExternalLinksPublished !== false) {
      errors.push('release must contain one server-protected Client Resources surface');
    }

    const commercial = manifest.scope?.commercialModel;
    if (!hasExactKeys(commercial, [
      'complimentary',
      'existingInPersonClientsOnly',
      'maximumActiveClientCodes',
      'separatelySold',
      'sale',
      'price',
      'checkout',
      'inAppPurchase',
      'purchaseCta',
      'digitalTier',
    ])
      || commercial.complimentary !== true
      || commercial.existingInPersonClientsOnly !== true
      || commercial.separatelySold !== false
      || commercial.sale !== false
      || commercial.price !== null
      || commercial.checkout !== false
      || commercial.inAppPurchase !== false
      || commercial.purchaseCta !== null
      || commercial.digitalTier !== null) {
      errors.push('commercial model must remain complimentary with no sale, price, checkout, IAP, purchase CTA, or digital tier');
    }
    if (commercial?.maximumActiveClientCodes !== null) {
      errors.push('maximumActiveClientCodes must remain null: owner-issued individual access has no fixed business-count limit');
    }

    const staff = manifest.scope?.staffAdministration;
    if (staff?.visibleSettingsEntry !== false
      || staff?.consumerBinaryReachable !== false
      || staff?.ownerDirectUrlOnly !== true
      || staff?.draftOnlyCatalogChanges !== false
      || staff?.directPublishing !== true
      || staff?.arbitraryRuntimeCatalog !== true) {
      errors.push('owner Staff Portal must remain direct-URL-only, consumer-unreachable, and authorized for the deployed runtime catalog');
    }
    if (!sameJson(manifest.scope?.externalHttpsMiniapps, {
      ownerManaged: true,
      accessModes: ['public', 'vip'],
      opensInsideApp: true,
      sameOriginNavigationOnly: true,
      vipControlsInAppEntryOnly: true,
      thirdPartyContentAuthoredByCaboHealth: false,
      thirdPartyContentMadePrivateByCaboHealth: false,
      rightsVerificationRequiredBeforeActivation: true,
      permanentCatalogItemsListedInReleaseMetadata: false,
    })) {
      errors.push('external HTTPS scope must retain owner control, in-app same-origin navigation, VIP entry-only gating, third-party authorship/privacy limits, and pre-activation rights review');
    }

    const review = manifest.reviewCredential;
    if (!hasExactKeys(review, [
      'namespace',
      'purpose',
      'credentialPrefix',
      'uidRealm',
      'multiDevice',
      'credentialInRepository',
      'status',
      'fixedReviewedResourceId',
      'launchMethod',
      'launchPath',
    ])
      || review.namespace !== 'review_sandbox'
      || review.purpose !== 'app_review'
      || review.credentialPrefix !== 'AR'
      || review.uidRealm !== 'review_*'
      || review.multiDevice !== true
      || review.credentialInRepository !== false
      || review.status !== 'pending-activation'
      || review.fixedReviewedResourceId !== 'review-sandbox-app-review-sample-v1'
      || review.launchMethod !== 'POST'
      || review.launchPath !== '/apps/app-review/launch/') {
      errors.push('App Review credential must remain isolated, multi-device, fixed-resource, secret-free, and pending-activation');
    }

    const gates = manifest.gates;
    const requiredGates = {
      legalEntitySignOff: 'owner-approved',
      sellerLegalEntity: 'owner-confirmed-individual',
      sellerRelationship: 'owner-confirmed-trade-brand',
      brandAuthorization: 'owner-confirmed-pending-signed-declaration',
      contentRights: 'inventory-revised-pending-owner-reconfirmation-and-per-family-basis',
      hostingLogTypes: 'owner-authorized-disclosure',
      hostingLogRetention: 'owner-authorized-disclosure',
      hostingLogDeletion: 'owner-authorized-disclosure',
      supportResponseSla: 'owner-confirmed',
      phiRemediation: 'verified-owner-authorized',
      medicalDevice: 'owner-confirmed-pending-exact-rc-review',
      exportCompliance: 'owner-confirmed-pending-exact-rc-review',
      firebaseAndHosting: 'dynamic-public-and-protected-brokers-deployed-and-verified-pending-physical-app-attest-valid-flow-and-exact-rc-e2e',
      hostedLegalClientAccess: 'deployed-and-verified-revised-public-payload',
      aasa: 'dynamic-authority-verified-origin-and-apple-cdn',
      appReviewCredential: 'pending-credential-valid-flow-and-device-e2e',
      staffReviewAccess: 'owner-portal-not-consumer-reachable-pending-exact-ipa-proof-and-apple-direction-if-requested',
      clientAccessModel: 'pending-apple-review-determination',
      ageRating: 'pending-owner-reconfirmation-and-app-store-recalculation',
      privacyMapping: 'pending-final-linkage-category-review-and-save',
      brandAndContentRights: 'pending-owner-reconfirmation-signed-declaration-and-per-family-rights-basis',
      exactReleaseCandidate: 'build-12-live-phase-defined-by-exact-current-pins-and-required-attestation-bytes',
      testFlight: 'builds-4-through-8-obsolete-source-build-9-aborted-pre-provider-build-10-processed-internal-testflight-history-build-11-eas-finished-attested-not-uploaded-history-build-12-live-phase-defined-by-exact-current-pins-and-required-attestation-bytes',
      screenshots: 'pending-exact-rc-capture',
      accessibilityLabels: 'pending-exact-rc-evidence',
      appStoreConnect: 'pending-final-save',
      submission: 'blocked-pending-release-gates-and-final-explicit-owner-confirmation',
    };
    if (!hasExactKeys(gates, Object.keys(requiredGates))
      || Object.entries(requiredGates).some(([key, value]) => gates[key] !== value)) {
      errors.push('release gates must retain every exact truthful state');
    }

    const aasa = manifest.aasaPlan;
    if (!sameJson(aasa?.components, EXACT_AASA_COMPONENTS)
      || aasa?.status !== 'dynamic-authority-verified-origin-and-apple-cdn') {
      errors.push('AASA plan must retain the ordered protected-route exclusions and dynamic canonical-root include');
    }

    if (manifest.candidate?.marketingVersion !== '3.0'
      || manifest.candidate?.buildNumber !== '12'
      || manifest.candidate?.status !== 'authority-sequence-configured'
      || manifest.candidate?.appJsonUpdated !== true
      || manifest.candidate?.configUpdated !== true
      || manifest.candidate?.liveAuthorityPhaseSource !== 'release-command-guard-pins-and-required-attestation-bytes') {
      errors.push('candidate must retain the phase-neutral 3.0/build 12 identity and live authority source');
    }
    const asc = manifest.ascEvidence;
    if (asc?.observedAt !== '2026-08-27T20:35:04.000Z'
      || asc?.inspectionMode !== 'read-only'
      || asc?.currentRejectedVersion !== '3.0'
      || asc?.currentRejectedVersionStatus !== 'prepare-for-submission-with-unresolved-rejection'
      || asc?.versionEditable !== true
      || asc?.selectedRejectedBinaryVersion !== '3.0'
      || asc?.selectedRejectedBuild !== '5'
      || !sameJson(asc?.testFlightBuilds, EXACT_ASC_TESTFLIGHT_BUILDS)
      || asc?.highestTestFlightBuild !== '6'
      || asc?.highestTestFlightBuildStatus !== 'ready-to-test-obsolete-source'
      || asc?.nextCandidateBuild !== '8'
      || asc?.nextCandidateBuildAvailable !== true
      || asc?.latestReviewDate !== '2026-02-24'
      || !sameArray(asc?.latestReviewGuidelines, EXACT_ASC_REVIEW_GUIDELINES)
      || asc?.informationRequested !== true) {
      errors.push('dated ASC read-only evidence must retain its exact build-8-era snapshot without becoming current build-12 authority');
    }
    if (!sameJson(manifest.historicalCandidateEvidence, EXACT_HISTORICAL_CANDIDATE_EVIDENCE)) {
      errors.push('release history must retain builds 4 through 8 as obsolete-source evidence, build 9 as aborted pre-provider, build 10 as processed internal-TestFlight history, and build 11 as EAS-finished attested non-uploaded history');
    }
    if (!sameJson(
      manifest.historicalInputAuthorityEvidence,
      EXACT_HISTORICAL_INPUT_AUTHORITY_EVIDENCE,
    )) {
      errors.push('build 11 invalidated input authority must remain separate pre-provider history, not a historical candidate');
    }
    if (manifest.reviewRisk?.appleApprovalGuaranteed !== false) {
      errors.push('Apple approval must never be represented as guaranteed');
    }
  }

  if (age) {
    const ageSchemaIsExact = hasExactKeys(age, [
      'schemaVersion',
      'authoritySemantics',
      'status',
      'previousSavedRating',
      'calculatedRating',
      'projectedRating',
      'legacyOperatingSystemsRating',
      'basis',
      'questionnaireReference',
      'conditions',
      'otherSupportedAnswers',
      'ageCategoryAndOverride',
      'ownerConfirmationRequired',
      'appStoreCalculationRequired',
    ])
      && hasExactKeys(age.authoritySemantics, [
        'documentRole',
        'finalSavedResultSource',
        'postInputMutationAllowed',
      ])
      && hasExactKeys(age.questionnaireReference, [
        'provider',
        'url',
        'definitionUrl',
        'verifiedDate',
        'frequencyScale',
      ])
      && hasExactKeys(age.conditions, [
        'unrestrictedWebAccess',
        'medicalOrTreatmentInformation',
        'healthOrWellnessTopics',
      ])
      && Object.values(age.conditions ?? {})
        .every((condition) => hasExactKeys(condition, ['requiredAnswer', 'basis']))
      && hasExactKeys(age.otherSupportedAnswers, [
        'parentalControls',
        'ageAssurance',
        'userGeneratedContent',
        'socialMedia',
        'socialMediaAgeRestricted',
        'messagingAndChat',
        'advertising',
        'profanityOrCrudeHumor',
        'horrorOrFearThemes',
        'alcoholTobaccoOrDrugUseOrReferences',
        'matureOrSuggestiveThemes',
        'sexualContentOrNudity',
        'sexualContentGraphicAndNudity',
        'violenceCartoonOrFantasy',
        'violenceRealistic',
        'violenceRealisticProlongedGraphicOrSadistic',
        'gunsOrOtherWeapons',
        'gamblingSimulated',
        'contests',
        'gambling',
        'lootBox',
      ])
      && sameJson(age.otherSupportedAnswers, {
        parentalControls: false,
        ageAssurance: false,
        userGeneratedContent: false,
        socialMedia: false,
        socialMediaAgeRestricted: false,
        messagingAndChat: false,
        advertising: false,
        profanityOrCrudeHumor: 'NONE',
        horrorOrFearThemes: 'NONE',
        alcoholTobaccoOrDrugUseOrReferences: 'NONE',
        matureOrSuggestiveThemes: 'NONE',
        sexualContentOrNudity: 'NONE',
        sexualContentGraphicAndNudity: 'NONE',
        violenceCartoonOrFantasy: 'NONE',
        violenceRealistic: 'NONE',
        violenceRealisticProlongedGraphicOrSadistic: 'NONE',
        gunsOrOtherWeapons: 'NONE',
        gamblingSimulated: 'NONE',
        contests: 'NONE',
        gambling: false,
        lootBox: false,
      })
      && hasExactKeys(age.ageCategoryAndOverride, [
        'kidsAgeBand',
        'ageRatingOverrideV2',
        'koreaAgeRatingOverride',
        'developerAgeRatingInfoUrl',
        'status',
      ]);
    if (!ageSchemaIsExact) errors.push('age rating must retain the exact authority schema');
    if (
      age.schemaVersion !== 3
      || !sameJson(age.authoritySemantics, {
        documentRole: 'immutable-freeze-baseline',
        finalSavedResultSource: 'rc-attestation.appStoreMetadataEvidenceSha256',
        postInputMutationAllowed: false,
      })
      || age.status !== 'reconfirmation-required'
      || age.previousSavedRating !== '9+'
      || age.calculatedRating !== null
      || age.projectedRating !== '16+'
      || age.legacyOperatingSystemsRating !== '17+'
      || age.ownerConfirmationRequired !== true
      || age.appStoreCalculationRequired !== true
      || age.questionnaireReference?.provider !== 'Apple'
      || age.questionnaireReference?.url !== 'https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/'
      || age.questionnaireReference?.definitionUrl !== 'https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/'
      || age.questionnaireReference?.verifiedDate !== '2026-08-28'
      || !sameArray(age.questionnaireReference?.frequencyScale, ['NONE', 'INFREQUENT', 'FREQUENT'])
      || age.conditions?.unrestrictedWebAccess?.requiredAnswer !== true
      || age.conditions?.medicalOrTreatmentInformation?.requiredAnswer !== 'NONE'
      || age.conditions?.healthOrWellnessTopics?.requiredAnswer !== true
      || age.ageCategoryAndOverride?.kidsAgeBand !== null
      || age.ageCategoryAndOverride?.ageRatingOverrideV2 !== 'NONE'
      || age.ageCategoryAndOverride?.koreaAgeRatingOverride !== 'NONE'
      || age.ageCategoryAndOverride?.developerAgeRatingInfoUrl !== null
      || age.ageCategoryAndOverride?.status !== 'pending-app-store-confirmation'
    ) {
      errors.push('Age rating must remain projected 16+ with legacy 17+, owner reconfirmation, and App Store recalculation required');
    }
  }

  if (privacy) {
    const privacySchemaIsExact = hasExactKeys(privacy, [
      'schemaVersion',
      'authoritySemantics',
      'status',
      'architectureStatus',
      'recommendedAppPrivacyAnswer',
      'nativeBehavior',
      'clientAccount',
      'installation',
      'appCheck',
      'backend',
      'resourceUrlHandling',
      'thirdPartyNetworkRequests',
      'cloudFunctionRequestSecurity',
      'cloudRunRequestLogs',
      'accessArtifacts',
      'deletion',
      'deletionReceiptStatus',
      'applicationAudit',
      'reviewSandbox',
      'hostedTechnicalRequestLogs',
      'conditionalRecommendation',
    ])
      && hasExactKeys(privacy.authoritySemantics, [
        'documentRole',
        'pendingFormPhases',
        'finalFormPhases',
        'transitionRequiresFinalScreenshots',
        'finalStateBinding',
      ])
      && hasExactKeys(privacy.nativeBehavior, [
        'account',
        'healthInformationRequested',
        'appGeneratedIdentifier',
        'analytics',
        'advertising',
        'tracking',
        'sensitivePermissions',
        'localOnlyState',
      ])
      && hasExactKeys(privacy.clientAccount, [
        'provider',
        'pseudonymous',
        'nameEmailPhoneRequestedFromClient',
        'purpose',
        'status',
      ])
      && hasExactKeys(privacy.installation, ['identifier', 'storage', 'deviceBound', 'purpose'])
      && hasExactKeys(privacy.appCheck, ['required', 'providers', 'purpose'])
      && hasExactKeys(privacy.backend, [
        'providers',
        'codesStoredPlaintext',
        'codeDigests',
        'clientNamesStored',
        'resourceUrlsReturnedToNative',
      ])
      && hasExactKeys(privacy.resourceUrlHandling, [
        'publicV3CatalogRecordsContainExternalUrl',
        'authorizedVipV2LaunchMayReturnExternalUrlTransiently',
        'vipPreviewsContainExternalUrl',
        'vipGrantsContainExternalUrl',
        'nativeStorageContainsExternalUrl',
        'applicationAuditContainsExternalUrl',
      ])
      && hasExactKeys(privacy.thirdPartyNetworkRequests, [
        'behavior',
        'destinationHostReceivesNormalNetworkData',
        'destinationOperatesIndependently',
        'finalAppleMappingStatus',
      ])
      && hasExactKeys(privacy.cloudFunctionRequestSecurity, [
        'rawSourceIpProcessedTransiently',
        'rawSourceIpStoredInFirestore',
        'providerRequestLoggingDocumentedSeparately',
        'storedRateLimitRepresentation',
        'purpose',
        'rateLimitBucketDeletionDeadlineMinutes',
        'physicalTtlDeletionAsynchronous',
        'tracking',
      ])
      && hasExactKeys(privacy.cloudRunRequestLogs, [
        'provider',
        'automatic',
        'observedFields',
        'purpose',
        'retentionDays',
        'defaultSinkExclusionConfigured',
        'deletionProcess',
        'linkedToIdentity',
        'tracking',
        'verifiedDate',
      ])
      && hasExactKeys(privacy.accessArtifacts, [
        'redemptionRequestDigestDeadlineMinutes',
        'launchNonceDeadlineSeconds',
        'webSessionMaximumMinutes',
        'brokerReplayDigestDeadlineMinutes',
        'deletionTombstoneHasTtl',
        'deletionTombstoneRetention',
        'containsPlaintextSecrets',
      ])
      && hasExactKeys(privacy.deletion, [
        'durable',
        'mechanism',
        'activeUserPath',
        'responseStatuses',
        'authorizationRevokedWhenAccepted',
        'grantExpiryQueuesDeletion',
        'administratorRevocationQueuesDeletion',
        'retryWorkerMinutes',
        'completionTimeGuaranteed',
      ])
      && hasExactKeys(privacy.deletionReceiptStatus, [
        'receiptEntropyBits',
        'receiptEncoding',
        'receiptEncodedLength',
        'nativeStorage',
        'localStates',
        'preparedBeforeDeletionRequest',
        'deleteRequestFields',
        'productionStatusCallable',
        'reviewStatusCallable',
        'statusRequestFields',
        'statusResponse',
        'limitedUseAppCheckRequired',
        'firebaseAuthenticationRequired',
        'rawReceiptStoredServerSide',
        'serverLookupRepresentation',
        'productionCollection',
        'reviewCollection',
        'separateRealmPeppers',
        'statusRecordContainsUid',
        'statusRecordContainsCode',
        'statusRecordContainsResourceUrl',
        'expectedCompletionDays',
        'expectedCompletionGuaranteed',
        'retryWorkerMinutes',
        'pendingHasTtl',
        'pendingRetention',
        'completedRecordContainsOnlyStatusTimestamps',
        'completedRetentionDays',
        'completedRetentionStartsAt',
        'completedPhysicalTtlDeletionAsynchronous',
        'checksOnClientResourcesReopen',
        'completionConfirmationInApp',
        'localReceiptClearedAfterCompletedAcknowledgement',
        'preparedNotFoundClearsReceipt',
        'preparedNotFoundRestoresAccess',
        'preparedNotFoundResubmitsSameReceipt',
        'acceptedNotFoundRestoresAccess',
      ])
      && hasExactKeys(privacy.deletionReceiptStatus?.statusResponse, [
        'schemaVersion',
        'exactFields',
        'statuses',
        'pendingCompletedAtMs',
        'timestampsAreIntegers',
      ])
      && hasExactKeys(privacy.applicationAudit, [
        'purpose',
        'deletionDeadlineDays',
        'physicalTtlDeletionAsynchronous',
        'actorLabel',
        'containsActorUid',
        'containsCodes',
        'containsResourceUrls',
        'containsClientNames',
      ])
      && hasExactKeys(privacy.reviewSandbox, [
        'separateNamespace',
        'multiDevice',
        'fixedNonClientSample',
        'productionClientRecordsExposed',
        'userInitiatedDeletion',
        'activeUserPath',
        'responseStatuses',
        'authorizationRevokedWhenAccepted',
        'currentIdentityInactivityEligibilityDays',
        'staleGenerationEligibility',
        'retryWorkerMinutes',
        'completionTimeGuaranteed',
        'status',
      ])
      && hasExactKeys(privacy.hostedTechnicalRequestLogs, [
        'provider',
        'observedFields',
        'ownerAuthorizedFields',
        'purpose',
        'retention',
        'deletionProcess',
        'linkedToIdentity',
        'tracking',
      ])
      && hasExactKeys(privacy.conditionalRecommendation, [
        'dataNotCollectedPath',
        'dataCollectedPath',
        'provisionalPurpose',
        'provisionalCategoryMapping',
      ]);
    if (!privacySchemaIsExact) errors.push('privacy must retain the exact authority schema');
    if (
      privacy.schemaVersion !== 6
      || !sameJson(privacy.authoritySemantics, {
        documentRole: 'phase-controlled-app-store-privacy-authority',
        pendingFormPhases: ['pre-input', 'input', 'artifact'],
        finalFormPhases: ['artifact', 'rc', 'submit-tool'],
        transitionRequiresFinalScreenshots: true,
        finalStateBinding: 'rc-attestation.appPrivacySha256',
      })
      || privacy.status !== 'pending-final-linkage-category-review-and-save'
      || privacy.architectureStatus !== 'core-infrastructure-deployed-pending-app-attest-valid-flow-and-exact-rc-e2e'
      || privacy.recommendedAppPrivacyAnswer !== 'Yes, we collect data from this app'
      || privacy.clientAccount?.pseudonymous !== true
      || privacy.installation?.storage !== 'SecureStore'
      || privacy.installation?.deviceBound !== true
      || privacy.appCheck?.required !== true
      || privacy.backend?.resourceUrlsReturnedToNative !== true
      || !sameJson(privacy.resourceUrlHandling, {
        publicV3CatalogRecordsContainExternalUrl: true,
        authorizedVipV2LaunchMayReturnExternalUrlTransiently: true,
        vipPreviewsContainExternalUrl: false,
        vipGrantsContainExternalUrl: false,
        nativeStorageContainsExternalUrl: false,
        applicationAuditContainsExternalUrl: false,
      })
      || !sameJson(privacy.thirdPartyNetworkRequests, {
        behavior: 'third-party-network-request',
        destinationHostReceivesNormalNetworkData: true,
        destinationOperatesIndependently: true,
        finalAppleMappingStatus: 'pending-final-destination-provider-and-category-review',
      })
      || !sameArray(privacy.backend?.providers, [
        'Firebase Authentication',
        'Cloud Functions',
        'Cloud Firestore',
        'Firebase App Check',
        'Google Cloud Logging',
        'Hostinger',
      ])
      || privacy.cloudFunctionRequestSecurity?.rawSourceIpProcessedTransiently !== true
      || privacy.cloudFunctionRequestSecurity?.rawSourceIpStoredInFirestore !== false
      || privacy.cloudFunctionRequestSecurity?.providerRequestLoggingDocumentedSeparately !== true
      || privacy.cloudFunctionRequestSecurity?.storedRateLimitRepresentation !== 'versioned keyed HMAC lookup only'
      || !sameArray(privacy.cloudFunctionRequestSecurity?.purpose, ['rate limiting', 'abuse prevention'])
      || privacy.cloudFunctionRequestSecurity?.rateLimitBucketDeletionDeadlineMinutes !== 30
      || privacy.cloudFunctionRequestSecurity?.physicalTtlDeletionAsynchronous !== true
      || privacy.cloudFunctionRequestSecurity?.tracking !== false
      || privacy.cloudRunRequestLogs?.provider !== 'Google Cloud Logging'
      || privacy.cloudRunRequestLogs?.automatic !== true
      || !sameArray(privacy.cloudRunRequestLogs?.observedFields, [
        'source IP address',
        'HTTP method',
        'requested URL',
        'user-agent',
        'HTTP status',
        'latency',
        'request and response sizes',
        'protocol',
      ])
      || !sameArray(privacy.cloudRunRequestLogs?.purpose, ['service delivery', 'security and troubleshooting'])
      || privacy.cloudRunRequestLogs?.retentionDays !== 30
      || privacy.cloudRunRequestLogs?.defaultSinkExclusionConfigured !== false
      || privacy.cloudRunRequestLogs?.deletionProcess !== 'Google Cloud Logging applies the unlocked _Default bucket retention; expiration is provider-enforced and may be eventually consistent.'
      || privacy.cloudRunRequestLogs?.linkedToIdentity !== null
      || privacy.cloudRunRequestLogs?.tracking !== false
      || privacy.cloudRunRequestLogs?.verifiedDate !== '2026-08-24'
      || privacy.accessArtifacts?.redemptionRequestDigestDeadlineMinutes !== 5
      || privacy.accessArtifacts?.launchNonceDeadlineSeconds !== 60
      || privacy.accessArtifacts?.webSessionMaximumMinutes !== 60
      || privacy.accessArtifacts?.brokerReplayDigestDeadlineMinutes !== 2
      || privacy.accessArtifacts?.deletionTombstoneHasTtl !== false
      || privacy.accessArtifacts?.deletionTombstoneRetention !== 'until linked-data and Firebase Auth cleanup completes'
      || privacy.accessArtifacts?.containsPlaintextSecrets !== false
      || privacy.deletion?.durable !== true
      || privacy.deletion?.mechanism !== 'transactional deletion tombstone plus idempotent retry worker'
      || privacy.deletion?.activeUserPath !== 'Home > Client Resources > Delete access account and data'
      || !sameArray(privacy.deletion?.responseStatuses, ['pending', 'completed'])
      || privacy.deletion?.authorizationRevokedWhenAccepted !== true
      || privacy.deletion?.grantExpiryQueuesDeletion !== true
      || privacy.deletion?.administratorRevocationQueuesDeletion !== true
      || privacy.deletion?.retryWorkerMinutes !== 5
      || privacy.deletion?.completionTimeGuaranteed !== false
      || privacy.deletionReceiptStatus?.receiptEntropyBits !== 256
      || privacy.deletionReceiptStatus?.receiptEncoding !== 'base64url'
      || privacy.deletionReceiptStatus?.receiptEncodedLength !== 43
      || privacy.deletionReceiptStatus?.nativeStorage !== 'SecureStore'
      || !sameArray(privacy.deletionReceiptStatus?.localStates, ['prepared', 'accepted'])
      || privacy.deletionReceiptStatus?.preparedBeforeDeletionRequest !== true
      || !sameArray(privacy.deletionReceiptStatus?.deleteRequestFields, ['installationId', 'deletionReceipt'])
      || privacy.deletionReceiptStatus?.productionStatusCallable !== 'getClientAccountDeletionStatus'
      || privacy.deletionReceiptStatus?.reviewStatusCallable !== 'getAppReviewAccountDeletionStatus'
      || !sameArray(privacy.deletionReceiptStatus?.statusRequestFields, ['deletionReceipt'])
      || privacy.deletionReceiptStatus?.statusResponse?.schemaVersion !== 1
      || !sameArray(privacy.deletionReceiptStatus?.statusResponse?.exactFields, [
        'schemaVersion',
        'status',
        'requestedAtMs',
        'expectedCompletionByMs',
        'completedAtMs',
      ])
      || !sameArray(privacy.deletionReceiptStatus?.statusResponse?.statuses, ['pending', 'completed'])
      || privacy.deletionReceiptStatus?.statusResponse?.pendingCompletedAtMs !== null
      || privacy.deletionReceiptStatus?.statusResponse?.timestampsAreIntegers !== true
      || privacy.deletionReceiptStatus?.limitedUseAppCheckRequired !== true
      || privacy.deletionReceiptStatus?.firebaseAuthenticationRequired !== false
      || privacy.deletionReceiptStatus?.rawReceiptStoredServerSide !== false
      || privacy.deletionReceiptStatus?.serverLookupRepresentation !== 'versioned keyed HMAC lookup only'
      || privacy.deletionReceiptStatus?.productionCollection !== '_private_account_deletion_receipts'
      || privacy.deletionReceiptStatus?.reviewCollection !== 'review_sandbox_account_deletion_receipts'
      || privacy.deletionReceiptStatus?.separateRealmPeppers !== true
      || privacy.deletionReceiptStatus?.statusRecordContainsUid !== false
      || privacy.deletionReceiptStatus?.statusRecordContainsCode !== false
      || privacy.deletionReceiptStatus?.statusRecordContainsResourceUrl !== false
      || privacy.deletionReceiptStatus?.expectedCompletionDays !== 30
      || privacy.deletionReceiptStatus?.expectedCompletionGuaranteed !== false
      || privacy.deletionReceiptStatus?.retryWorkerMinutes !== 5
      || privacy.deletionReceiptStatus?.pendingHasTtl !== false
      || privacy.deletionReceiptStatus?.pendingRetention !== 'until cleanup completes'
      || privacy.deletionReceiptStatus?.completedRecordContainsOnlyStatusTimestamps !== true
      || privacy.deletionReceiptStatus?.completedRetentionDays !== 30
      || privacy.deletionReceiptStatus?.completedRetentionStartsAt !== 'completedAtMs'
      || privacy.deletionReceiptStatus?.completedPhysicalTtlDeletionAsynchronous !== true
      || privacy.deletionReceiptStatus?.checksOnClientResourcesReopen !== true
      || privacy.deletionReceiptStatus?.completionConfirmationInApp !== true
      || privacy.deletionReceiptStatus?.localReceiptClearedAfterCompletedAcknowledgement !== true
      || privacy.deletionReceiptStatus?.preparedNotFoundClearsReceipt !== false
      || privacy.deletionReceiptStatus?.preparedNotFoundRestoresAccess !== false
      || privacy.deletionReceiptStatus?.preparedNotFoundResubmitsSameReceipt !== true
      || privacy.deletionReceiptStatus?.acceptedNotFoundRestoresAccess !== false
      || privacy.applicationAudit?.purpose !== 'security and operational accountability'
      || privacy.applicationAudit?.deletionDeadlineDays !== 30
      || privacy.applicationAudit?.physicalTtlDeletionAsynchronous !== true
      || privacy.applicationAudit?.actorLabel !== 'Staff'
      || privacy.applicationAudit?.containsActorUid !== false
      || privacy.applicationAudit?.containsCodes !== false
      || privacy.applicationAudit?.containsResourceUrls !== false
      || privacy.applicationAudit?.containsClientNames !== false
      || privacy.reviewSandbox?.separateNamespace !== true
      || privacy.reviewSandbox?.multiDevice !== true
      || privacy.reviewSandbox?.fixedNonClientSample !== true
      || privacy.reviewSandbox?.productionClientRecordsExposed !== false
      || privacy.reviewSandbox?.userInitiatedDeletion !== true
      || privacy.reviewSandbox?.activeUserPath !== 'Home > Client Resources > Delete review access and data'
      || !sameArray(privacy.reviewSandbox?.responseStatuses, ['pending', 'completed'])
      || privacy.reviewSandbox?.authorizationRevokedWhenAccepted !== true
      || privacy.reviewSandbox?.currentIdentityInactivityEligibilityDays !== 30
      || privacy.reviewSandbox?.staleGenerationEligibility !== 'immediate'
      || privacy.reviewSandbox?.retryWorkerMinutes !== 5
      || privacy.reviewSandbox?.completionTimeGuaranteed !== false
      || privacy.reviewSandbox?.status !== 'infrastructure-deployed-pending-credential-valid-flow-and-device-e2e'
      || privacy.backend?.codesStoredPlaintext !== false
      || privacy.backend?.clientNamesStored !== false
      || privacy.conditionalRecommendation?.dataNotCollectedPath !== 'Not applicable to this v3 architecture: pseudonymous identifiers and provider request records are retained off device beyond real-time request servicing.'
      || privacy.conditionalRecommendation?.dataCollectedPath !== 'Required. Map the final verified production data types, purposes, linkage, and retention in App Store Connect after the exact RC and hosting configuration are tested.'
      || !sameArray(privacy.conditionalRecommendation?.provisionalPurpose, [
        'App Functionality',
        'Analytics',
      ])
      || !sameArray(privacy.conditionalRecommendation?.provisionalCategoryMapping, [
        'User ID — linked to the user; App Functionality; not used for tracking (exact signed FirebaseAuth privacy manifest)',
        'Other Diagnostic Data — not linked to the user; Analytics; not used for tracking (exact signed FirebaseAuth privacy manifest)',
        'Device ID, if the app-installation identifier is retained off device and disclosure is required',
        'Coarse Location, Device ID, or Other Diagnostic Data as required by Apple\'s final mapping of retained IP addresses',
        'Product Interaction, if retained requested-resource activity is in disclosure scope',
        'Performance Data, if retained latency or response-byte measurements are in disclosure scope',
        'Other Diagnostic Data, if retained HTTP method, user-agent, or technical-error records are in disclosure scope',
        'Other Data Types, only if a retained field cannot be accurately mapped to another Apple data type',
      ])
    ) {
      errors.push('privacy architecture must retain pseudonymous Firebase access, transient HMAC-only request security, exact short-lived artifacts, durable production and review deletion, an asynchronous 30-day audit deadline, and the exact signed FirebaseAuth App Functionality/Analytics mapping');
    }
  }

  return errors;
}

export function captureReleaseV3(root) {
  const files = new Map(REQUIRED_CAPTURE_PATHS.map((path) => {
    const absolutePath = join(root, path);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${path} must be a regular non-symbolic-link file`);
    }
    return [path, Buffer.from(readFileSync(absolutePath))];
  }));
  for (const path of OPTIONAL_PHASE_ATTESTATION_PATHS) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) continue;
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${path} must be a regular non-symbolic-link file`);
    }
    files.set(path, Buffer.from(readFileSync(absolutePath)));
  }
  return files;
}

function main() {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  let files;
  try {
    files = captureReleaseV3(root);
  } catch (error) {
    process.stderr.write(`RELEASE_V3_INVALID: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const errors = verifyCapturedReleaseV3(files);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Release 3.0/build 12 verified: phase-neutral authority sequence configured.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
