import { lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AASA_COMPONENTS } from './generate-aasa.mjs';

const REQUIRED_CAPTURE_PATHS = [
  'app.json',
  'eas.json',
  'constants/config.ts',
  'constants/publicMiniapps.ts',
  'release/app-store/3.0/release-manifest.json',
  'release/app-store/3.0/age-rating.json',
  'release/app-store/3.0/app-privacy.json',
];

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
];
const EXACT_ASC_REVIEW_GUIDELINES = ['1.4.1', '2.1', '4.1'];
const EXACT_AUTHORITY_SHA256 = Object.freeze({
  'app.json': '2498a015b7ec5b266ccccbb71d2a6d47cfe17184a85aa0b03d89fe32bd801601',
  'eas.json': '834e82554d40114ae3e0ea754d9e174bf1cce821150819b9a91dd56401692ac2',
  'constants/config.ts': 'a2b8453caa2f6be0c065f226bf84edc59e12b9b3a42523321fcb173388ec8a90',
  'constants/publicMiniapps.ts': '7306d82fd7de694b16de85401a8aab431c5408037f5038ce95fc5f79edef9dda',
  'release/app-store/3.0/release-manifest.json': '471e227ee6ea5c6db497f4f6cc2bdc6f55e77333277dd0dcabe6f04bf027e28d',
  'release/app-store/3.0/age-rating.json': '2b8de835b2e1ef794c28310a1699e101a7d604652b14945538c70e26df6e1259',
  'release/app-store/3.0/app-privacy.json': 'ea62eeb774718f7378cfb4edbc18dfb8fa8f90afadb3c61d2ef6b214a1da4349',
});

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

export function verifyCapturedReleaseV3(files) {
  const errors = [];
  const appJson = parseJson(files, 'app.json', errors);
  const easJson = parseJson(files, 'eas.json', errors);
  const manifest = parseJson(
    files,
    'release/app-store/3.0/release-manifest.json',
    errors,
  );
  const age = parseJson(files, 'release/app-store/3.0/age-rating.json', errors);
  const privacy = parseJson(files, 'release/app-store/3.0/app-privacy.json', errors);
  const config = files.get('constants/config.ts')?.toString('utf8') ?? '';
  const publicSource = files.get('constants/publicMiniapps.ts')?.toString('utf8') ?? '';

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
          ? 'release manifest must retain the exact v3 pre-build semantics'
          : path.endsWith('age-rating.json')
            ? 'age rating must retain the exact age-rating authority'
            : 'privacy must retain the exact privacy authority';
      errors.push(label);
    }
  }

  if (appJson && (
    appJson.expo?.version !== '3.0'
    || appJson.expo?.ios?.buildNumber !== '11'
  )) {
    errors.push('app.json must remain 3.0/build 11 after the build-11 rebaseline');
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
    || !/buildNumber:\s*['"]11['"]/u.test(config)) {
    errors.push('constants/config.ts must remain 3.0/build 11 after the build-11 rebaseline');
  }

  const sourceSlugs = extractPublicSlugs(publicSource);
  if (!sameArray(sourceSlugs, EXACT_PUBLIC_SLUGS)) {
    errors.push('release must contain exactly two public miniapps');
  }

  if (manifest) {
    const manifestSchemaIsExact = hasExactKeys(manifest, [
      'schemaVersion',
      'artifactKind',
      'candidate',
      'ascEvidence',
      'historicalCandidateEvidence',
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
      && hasExactKeys(manifest.candidate, [
        'appleId',
        'bundleIdentifier',
        'marketingVersion',
        'buildNumber',
        'status',
        'appJsonUpdated',
        'configUpdated',
        'rcSourceSha',
        'testFlightBuildId',
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
      || manifest.artifactKind !== 'app-store-metadata-candidate') {
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
      exactReleaseCandidate: 'build-11-pending-build-input-attestation-eas-build-and-qa',
      testFlight: 'builds-4-through-8-obsolete-source-build-9-aborted-pre-provider-build-10-processed-internal-testflight-history-build-11-pending-build-upload-selection-and-physical-iphone-qa',
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
      || manifest.candidate?.buildNumber !== '11'
      || manifest.candidate?.status !== 'pre-build-configured'
      || manifest.candidate?.appJsonUpdated !== true
      || manifest.candidate?.configUpdated !== true
      || manifest.candidate?.rcSourceSha !== null
      || manifest.candidate?.testFlightBuildId !== null) {
      errors.push('candidate must remain truthful pre-build-configured 3.0/build 11 without premature RC evidence');
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
      errors.push('dated ASC read-only evidence must retain its exact build-8-era snapshot without becoming current build-11 authority');
    }
    if (!sameJson(manifest.historicalCandidateEvidence, EXACT_HISTORICAL_CANDIDATE_EVIDENCE)) {
      errors.push('release history must retain builds 4 through 8 as obsolete-source evidence, build 9 as aborted pre-provider, build 10 as processed internal-TestFlight history, and build 11 as the sole new candidate');
    }
    if (manifest.reviewRisk?.appleApprovalGuaranteed !== false) {
      errors.push('Apple approval must never be represented as guaranteed');
    }
  }

  if (age) {
    const ageSchemaIsExact = hasExactKeys(age, [
      'schemaVersion',
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
  return new Map(REQUIRED_CAPTURE_PATHS.map((path) => {
    const absolutePath = join(root, path);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${path} must be a regular non-symbolic-link file`);
    }
    return [path, Buffer.from(readFileSync(absolutePath))];
  }));
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
  process.stdout.write('Release 3.0/build 11 verified: pre-build-configured.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
