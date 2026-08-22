import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_CAPTURE_PATHS = [
  'app.json',
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
const EXACT_AASA_COMPONENTS = [
  { '/': '/apps/client-resources/launch/', exclude: true },
  { '/': '/apps/client-resources/launch/*', exclude: true },
  { '/': '/apps/client-resources/api/', exclude: true },
  { '/': '/apps/client-resources/api/*', exclude: true },
  { '/': '/apps/healthy-recipes/' },
  { '/': '/apps/clinic-guide/' },
  { '/': '/apps/client-resources/' },
];
const EXACT_AUTHORITY_SHA256 = Object.freeze({
  'app.json': '4b9e83ac28c05b229531570f4ddfd3acac916f8f79337a7a5e8fff1ffae82eab',
  'constants/config.ts': '7495a095c508f09fcc0b9fb1283ccfbaa5fea3db672a989ef3ff5d4087df22db',
  'constants/publicMiniapps.ts': 'ca15483cf00b864878d7df7a003be5cf946b2565b60e6581dc3676c529c9af20',
  'release/app-store/3.0/release-manifest.json': 'e9a00247f4689bd25226d9b49c74df06a5d16ce43c5db101988f5ebd4922d057',
  'release/app-store/3.0/age-rating.json': 'b2bd2fdd9a5109a600923dee82eb0186df99a446128f3b05a37d54e2428e19bb',
  'release/app-store/3.0/app-privacy.json': '9c6edbb028d27ac9233e7aa7c852a943583a78f5fad8c8fef9cd8cbfe520b998',
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
        ? 'app.json must retain the exact reviewed pre-RC bytes'
        : path.startsWith('constants/')
        ? `${path} must retain the exact reviewed bytes`
        : path.endsWith('release-manifest.json')
          ? 'release manifest must retain the exact v3 draft semantics'
          : path.endsWith('age-rating.json')
            ? 'age rating must retain the exact age-rating authority'
            : 'privacy must retain the exact privacy authority';
      errors.push(label);
    }
  }

  if (appJson && (
    appJson.expo?.version !== '2.0.0'
    || appJson.expo?.ios?.buildNumber !== '3'
  )) {
    errors.push('app.json must remain 2.0.0/build 3 until the exact RC is frozen');
  }
  if (!/version:\s*['"]2\.0\.0['"]/u.test(config)
    || !/buildNumber:\s*['"]1['"]/u.test(config)) {
    errors.push('constants/config.ts must remain 2.0.0/build 1 until RC reconciliation');
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
        'rcSourceSha',
        'testFlightBuildId',
      ])
      && hasExactKeys(manifest.ascEvidence, [
        'currentRejectedVersion',
        'selectedRejectedBuild',
        'highestTestFlightBuild',
        'highestTestFlightBuildStatus',
        'nextCandidateBuild',
      ])
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
        'draftOnlyCatalogChanges',
        'directPublishing',
        'arbitraryRuntimeCatalog',
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
      || manifest.schemaVersion !== 2
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
    if (commercial?.maximumActiveClientCodes !== 4) {
      errors.push('maximumActiveClientCodes must remain 4');
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
      contentRights: 'owner-confirmed-scoped-pending-third-party-inventory',
      hostingLogTypes: 'owner-authorized-disclosure',
      hostingLogRetention: 'owner-authorized-disclosure',
      hostingLogDeletion: 'owner-authorized-disclosure',
      supportResponseSla: 'owner-confirmed',
      phiRemediation: 'verified-owner-authorized',
      medicalDevice: 'owner-confirmed-pending-exact-rc-review',
      exportCompliance: 'owner-confirmed-pending-exact-rc-review',
      firebaseAndHosting: 'pending-external-configuration',
      hostedLegalClientAccess: 'pending-reviewed-update-and-deployment',
      aasa: 'pending-reviewed-update-and-deployment',
      appReviewCredential: 'pending-activation-and-staging-e2e',
      staffReviewAccess: 'pending-isolated-review-access-or-written-apple-direction',
      clientAccessModel: 'pending-apple-review-determination',
      ageRating: 'pending-owner-reconfirmation-and-app-store-recalculation',
      privacyMapping: 'pending-final-linkage-category-review-and-save',
      brandAndContentRights: 'pending-signed-owner-declaration-and-third-party-inventory',
      exactReleaseCandidate: 'pending-version-bump-build-and-qa',
      testFlight: 'pending-build-upload-selection-and-physical-iphone-qa',
      screenshots: 'pending-exact-rc-capture',
      accessibilityLabels: 'pending-exact-rc-evidence',
      appStoreConnect: 'pending-final-save',
      submission: 'blocked-pending-explicit-owner-confirmation',
    };
    if (!hasExactKeys(gates, Object.keys(requiredGates))
      || Object.entries(requiredGates).some(([key, value]) => gates[key] !== value)) {
      errors.push('release gates must retain every required pending state');
    }

    const aasa = manifest.aasaPlan;
    if (!sameJson(aasa?.components, EXACT_AASA_COMPONENTS)
      || aasa?.status !== 'pending-reviewed-update-and-deployment') {
      errors.push('AASA plan must retain the ordered launch/api exclusions and three exact app roots');
    }

    if (manifest.candidate?.marketingVersion !== '3.0'
      || manifest.candidate?.buildNumber !== '4'
      || manifest.candidate?.status !== 'draft-blocked'
      || manifest.candidate?.appJsonUpdated !== false
      || manifest.candidate?.rcSourceSha !== null
      || manifest.candidate?.testFlightBuildId !== null) {
      errors.push('candidate must remain truthful draft-blocked 3.0/build 4 before RC');
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
      || age.projectedRating !== '9+'
      || age.ownerConfirmationRequired !== true
      || age.appStoreCalculationRequired !== true
      || age.questionnaireReference?.provider !== 'Apple'
      || age.questionnaireReference?.url !== 'https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/'
      || age.questionnaireReference?.verifiedDate !== '2026-08-22'
      || !sameArray(age.questionnaireReference?.frequencyScale, ['NONE', 'INFREQUENT', 'FREQUENT'])
      || age.conditions?.unrestrictedWebAccess?.requiredAnswer !== false
      || age.conditions?.medicalOrTreatmentInformation?.requiredAnswer !== 'NONE'
      || age.conditions?.healthOrWellnessTopics?.requiredAnswer !== true
      || age.ageCategoryAndOverride?.kidsAgeBand !== null
      || age.ageCategoryAndOverride?.ageRatingOverrideV2 !== 'NONE'
      || age.ageCategoryAndOverride?.koreaAgeRatingOverride !== 'NONE'
      || age.ageCategoryAndOverride?.developerAgeRatingInfoUrl !== null
      || age.ageCategoryAndOverride?.status !== 'pending-app-store-confirmation'
    ) {
      errors.push('Age rating must remain 9+ reconfirmation-required until ASC recalculates the changed scope');
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
      'deletion',
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
      && hasExactKeys(privacy.deletion, [
        'durable',
        'mechanism',
        'availableAfterGrantRevocationOrExpiry',
      ])
      && hasExactKeys(privacy.applicationAudit, [
        'retentionDays',
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
      privacy.schemaVersion !== 2
      || privacy.architectureStatus !== 'implemented-locally-pending-external-configuration-and-e2e'
      || privacy.recommendedAppPrivacyAnswer !== 'Yes, we collect data from this app'
      || privacy.clientAccount?.pseudonymous !== true
      || privacy.installation?.storage !== 'SecureStore'
      || privacy.installation?.deviceBound !== true
      || privacy.appCheck?.required !== true
      || privacy.deletion?.durable !== true
      || privacy.deletion?.availableAfterGrantRevocationOrExpiry !== true
      || privacy.applicationAudit?.retentionDays !== 30
      || privacy.applicationAudit?.actorLabel !== 'Staff'
      || privacy.applicationAudit?.containsActorUid !== false
      || privacy.applicationAudit?.containsCodes !== false
      || privacy.applicationAudit?.containsResourceUrls !== false
      || privacy.applicationAudit?.containsClientNames !== false
      || privacy.reviewSandbox?.separateNamespace !== true
      || privacy.reviewSandbox?.multiDevice !== true
      || privacy.reviewSandbox?.fixedNonClientSample !== true
      || privacy.reviewSandbox?.productionClientRecordsExposed !== false
      || privacy.reviewSandbox?.status !== 'pending-activation-and-staging-e2e'
      || privacy.backend?.codesStoredPlaintext !== false
      || privacy.backend?.clientNamesStored !== false
      || privacy.conditionalRecommendation?.dataNotCollectedPath !== 'Not applicable to this v3 architecture: pseudonymous identifiers and hosted request records are retained off device beyond real-time request servicing.'
      || privacy.conditionalRecommendation?.dataCollectedPath !== 'Required. Map the final verified production data types, purposes, linkage, and retention in App Store Connect after the exact RC and hosting configuration are tested.'
      || !sameArray(privacy.conditionalRecommendation?.provisionalPurpose, [
        'App Functionality',
      ])
      || !sameArray(privacy.conditionalRecommendation?.provisionalCategoryMapping, [
        'User ID, if the pseudonymous Firebase UID is retained and disclosure is required',
        'Device ID, if the app-installation identifier is retained off device and disclosure is required',
        'Coarse Location, if retained country derived from an IP address is in disclosure scope',
        'Product Interaction, if retained requested-resource activity is in disclosure scope',
        'Performance Data, if retained latency or response-byte measurements are in disclosure scope',
        'Other Diagnostic Data, if retained HTTP method, user-agent, or technical-error records are in disclosure scope',
        'Other Data Types, only if a retained field cannot be accurately mapped to another Apple data type',
      ])
    ) {
      errors.push('privacy architecture must retain pseudonymous Firebase access, SecureStore, App Check, durable deletion, and 30-day audit');
    }
  }

  return errors;
}

export function captureReleaseV3(root) {
  return new Map(REQUIRED_CAPTURE_PATHS.map((path) => [
    path,
    Buffer.from(readFileSync(join(root, path))),
  ]));
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
  process.stdout.write('Release 3.0/build 4 verified: draft-blocked.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
