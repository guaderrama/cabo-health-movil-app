import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { captureReleaseV3, verifyCapturedReleaseV3 } from './verify-release-v3.mjs';

const root = resolve(process.argv[2] ?? process.cwd());
const releaseRoot = join(root, 'release/app-store/3.0');
const errors = [];

const approvedMiniapps = Object.freeze([
  Object.freeze({
    slug: 'healthy-recipes',
    title: 'Healthy Recipes',
    url: 'https://cabohealth.org/apps/healthy-recipes/',
  }),
  Object.freeze({
    slug: 'clinic-guide',
    title: 'CaboHealth Clinic Guide',
    url: 'https://cabohealth.org/apps/clinic-guide/',
  }),
]);

const protectedClientResource = Object.freeze({
  id: 'client-resources',
  title: 'Client Resources',
  url: 'https://cabohealth.org/apps/client-resources/',
});

const expectedAasaComponents = Object.freeze([
  Object.freeze({ '/': '/apps/client-resources/launch/', exclude: true }),
  Object.freeze({ '/': '/apps/client-resources/launch/*', exclude: true }),
  Object.freeze({ '/': '/apps/client-resources/api/', exclude: true }),
  Object.freeze({ '/': '/apps/client-resources/api/*', exclude: true }),
  Object.freeze({ '/': '/apps/healthy-recipes/' }),
  Object.freeze({ '/': '/apps/clinic-guide/' }),
  Object.freeze({ '/': '/apps/client-resources/' }),
]);

const expectedUrls = Object.freeze({
  support: 'https://cabohealth.org/app/support/',
  privacy: 'https://cabohealth.org/app/privacy/',
  terms: 'https://cabohealth.org/app/terms/',
  reportContent: 'https://cabohealth.org/app/report-content/',
  marketing: 'https://cabohealth.org/app/',
  staff: 'https://cabohealth.org/staff/',
});

const expectedGateStates = Object.freeze({
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
  firebaseAndHosting: 'core-deployed-pending-app-attest-valid-flow-and-exact-rc-e2e',
  hostedLegalClientAccess: 'deployed-and-verified-revised-public-payload',
  aasa: 'deployed-and-verified-origin-and-apple-cdn',
  appReviewCredential: 'pending-credential-valid-flow-and-device-e2e',
  staffReviewAccess: 'pending-isolated-review-access-or-written-apple-direction',
  clientAccessModel: 'pending-apple-review-determination',
  ageRating: 'pending-owner-reconfirmation-and-app-store-recalculation',
  privacyMapping: 'pending-final-linkage-category-review-and-save',
  brandAndContentRights: 'pending-owner-reconfirmation-signed-declaration-and-per-family-rights-basis',
  exactReleaseCandidate: 'pending-version-bump-build-and-qa',
  testFlight: 'pending-build-upload-selection-and-physical-iphone-qa',
  accessibilityLabels: 'pending-exact-rc-evidence',
  screenshots: 'pending-exact-rc-capture',
  appStoreConnect: 'pending-final-save',
  submission: 'blocked-pending-release-gates-and-final-explicit-owner-confirmation',
});

const expectedOwnerSeller = Object.freeze({
  sellerType: 'individual',
  legalSeller: 'Ivan Guaderrama',
  publicBrand: 'Cabo Health',
  brandIsSeparateLegalEntity: false,
  registeredOrganization: false,
  dunsApplicable: false,
  dunsNumber: null,
  relationship: 'trade brand owned and operated by Ivan Guaderrama',
  releaseTerritories: ['MEX', 'USA'],
});

const expectedReviewRisk = Object.freeze({
  level: 'high',
  basis: 'general-wellness/editorial content plus complimentary eligibility-gated resources for existing in-person clients',
  appleApprovalGuaranteed: false,
  fallback: 'Obtain written Apple direction before submission; if Apple treats the app as a healthcare-service or digital-unlock product, revise the model or later migrate to an eligible registered organization.',
  healthcareSellerEntityRisk: 'requires-honest-review-note-and-apple-determination',
  externalEligibilityCredentialRisk: 'complimentary-existing-client-model-requires-apple-determination',
});

const expectedUnresolvedExternalGates = Object.freeze({
  regulatedMedicalDevice: 'owner-confirmed-pending-exact-rc-review',
  exportCompliance: 'owner-confirmed-pending-exact-rc-review',
  finalPrivacyDisclosure: 'pending-final-linkage-category-review-and-save',
  hostingLogRetention: 'owner-authorized-disclosure',
  hostingLogDeletion: 'owner-authorized-disclosure',
  supportResponseSla: 'owner-confirmed',
  ageRating: 'pending-owner-reconfirmation-and-app-store-recalculation',
  allContentRights: 'inventory-revised-pending-owner-reconfirmation-and-per-family-basis',
  brandEvidenceAttachment: 'pending-signed-owner-declaration',
  firebaseAndHosting: 'core-deployed-pending-app-attest-valid-flow-and-exact-rc-e2e',
  hostedLegalClientAccess: 'deployed-and-verified-revised-public-payload',
  aasa: 'deployed-and-verified-origin-and-apple-cdn',
  appReviewCredential: 'pending-credential-valid-flow-and-device-e2e',
  staffReviewAccess: 'pending-isolated-review-access-or-written-apple-direction',
  clientAccessModel: 'pending-apple-review-determination',
  exactReleaseCandidate: 'pending-version-bump-build-and-qa',
  screenshots: 'pending-exact-rc-capture',
  appStoreConnectSave: 'pending-final-save',
});

const expectedSceneIds = Object.freeze([
  '01-launch',
  '02-resource-catalog',
  '03-healthy-recipes',
  '04-clinic-guide',
  '05-client-resources-locked',
  '06-eligibility-code-entry',
  '07-saved',
  '08-settings-and-legal',
]);

const excludedNamedScope = /\b(?:Sleep Lab|Service Hub|Health Advisor|AI Cosmetic Scan)\b/iu;

const EXACT_REVIEWED_PROSE_SHA256 = Object.freeze({
  'age-rating.md': 'a6f11c4ab2005ec58498931571a2212b3804db2dcfb081d91aa8e40ce07bd023',
  'app-privacy.md': '5a7f7208dc4325ba58bf4227ce62d71be940cba51239d45a1661bdce7a81e29b',
  'content-rights-inventory.md': '61c1554019b352042eac0aa9ab18f0f7c08385c92fac82f387f2110247794c07',
});

const CONTENT_RIGHTS_SOURCE_GROUPS = Object.freeze([
  Object.freeze({
    sha256: 'e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117',
    paths: Object.freeze(['assets/logo.png', 'miniapps/shared/logo.png']),
  }),
  Object.freeze({
    sha256: '42012a5550f332e531c8d6ea7a99bb06b9c0bd9f0c0c6a45249106dc940f592d',
    paths: Object.freeze(['assets/logo-wordmark.png', 'miniapps/shared/logo-wordmark.png']),
  }),
  Object.freeze({
    sha256: '6e619093c7b7c43d9444086386796726757397ba19ee6cad0d95502bec4b4deb',
    paths: Object.freeze(['assets/logo-white.png', 'assets/splash-icon.png']),
  }),
  Object.freeze({
    sha256: '18e6aadb5e1e13ab0ad0207869bd9323d36cd3c892d4286a9838b03a2f705416',
    paths: Object.freeze(['assets/icon.png']),
  }),
  Object.freeze({
    sha256: '5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8',
    paths: Object.freeze(['assets/adaptive-icon.png', 'assets/splash.png']),
  }),
  Object.freeze({
    sha256: '24272cdaeff82cc5facdaccd982a6f05b60c4504704bbf94c19a6388659880bb',
    paths: Object.freeze(['assets/favicon.png']),
  }),
  Object.freeze({
    sha256: '4b569f0da0cffb9a54dedd93ce672cf7592ae4516dd12663e3b34d731df237c4',
    paths: Object.freeze(['miniapps/shared/clinic-map-texture.png']),
  }),
  Object.freeze({
    sha256: '85a305124862d9522f70df5bfdff8282ef95d14b6d2dd149a75361330eb4840b',
    paths: Object.freeze(['staff-portal/public/favicon.svg']),
  }),
  Object.freeze({
    sha256: '238c3c4fd1c9c6a782bc4f4b02f826134fafe01b7b72e6b852ef7ae30ce9541d',
    paths: Object.freeze(['content/recipes.json']),
  }),
  Object.freeze({
    sha256: '1c1b85c54ec94a31d8bef59ce2253dc9f9b6628684658439e1e6bec9e9586916',
    paths: Object.freeze(['content/clinic-guide.json']),
  }),
  Object.freeze({
    sha256: 'ed2be1dc101ff8237b0ced8b0fe58894a6f70e46dfb527e01442c22049d17c49',
    paths: Object.freeze(['i18n/messages.ts']),
  }),
  Object.freeze({
    sha256: 'fb60620a37efac4e4deb265ddc3a4e89642ecded2643a5cb25006da3dd14e720',
    paths: Object.freeze(['features/onboarding/IntroScreen.tsx']),
  }),
  Object.freeze({
    sha256: '803818464ef0663340d557b28fefd4dd6860abc3203fcbee7cbb14e7ef775a5e',
    paths: Object.freeze(['constants/publicMiniapps.ts']),
  }),
  Object.freeze({
    sha256: 'b04f3cf2e9446cee78e1473ba421059ba2d536829c39cdde9bf806aa172c65ba',
    paths: Object.freeze(['miniapps/healthy-recipes/index.html']),
  }),
  Object.freeze({
    sha256: '7f1b25f055b0dbc3c4587787046e94108ab75f7105cb1e13faa93a6ffda3ff38',
    paths: Object.freeze(['miniapps/clinic-guide/index.html']),
  }),
  Object.freeze({
    sha256: 'e3ebb6e0d7e94ffa04f123c2f2fe8cd746bf0dba80f3824746fdd7d9492f6593',
    paths: Object.freeze(['client-resources-private/content/en.json']),
  }),
  Object.freeze({
    sha256: 'e29960ae5490c90ffb3e869a040d3c2bf970465215065cb4debc4f97b1363555',
    paths: Object.freeze(['client-resources-private/content/es-MX.json']),
  }),
  Object.freeze({
    sha256: '03b558d9c0afc6a405f6fddf1d06fd67915170444baa596b713a150e9e8d0911',
    paths: Object.freeze(['app-review-private/content/sample.json']),
  }),
  Object.freeze({
    sha256: '90d3b21014dfb456c54029433875811e5727c4fc4b930934cfa4c5b77e9ae6ba',
    paths: Object.freeze(['staff-portal/src/i18n/messages.ts']),
  }),
  Object.freeze({
    sha256: '8ca9c36be228bbcc96234e1ee228debfa423de11924b7f1adc8384bfad15d147',
    paths: Object.freeze(['web-hosting/cabohealth.org/app/index.html']),
  }),
  Object.freeze({
    sha256: 'bee0eaebf10afe3ded626da45a15ee11368e67f11e7d1dc170222405702fbb80',
    paths: Object.freeze(['web-hosting/cabohealth.org/app/privacy/index.html']),
  }),
  Object.freeze({
    sha256: 'b1c2a7f2ab3bc1907d8d64b9eda2f712b2810270345f91b8e96033561e5adb22',
    paths: Object.freeze(['web-hosting/cabohealth.org/app/terms/index.html']),
  }),
  Object.freeze({
    sha256: '06fa373c7c59a705348e7bd236f02dec221223577018db161c249428db6883fa',
    paths: Object.freeze(['web-hosting/cabohealth.org/app/support/index.html']),
  }),
  Object.freeze({
    sha256: 'f38f162f51aa4f882da4fa8f35e03bf0efa37308b3a1e4c7e2a6bc1d31886f7c',
    paths: Object.freeze(['web-hosting/cabohealth.org/app/report-content/index.html']),
  }),
]);

function read(relativePath) {
  const absolutePath = join(releaseRoot, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`Missing App Store metadata artifact: ${relativePath}`);
    return '';
  }
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    errors.push(`App Store metadata artifact must be a regular non-symbolic-link file: ${relativePath}`);
    return '';
  }
  const source = readFileSync(absolutePath, 'utf8');
  if (source.length === 0) errors.push(`App Store metadata artifact must not be empty: ${relativePath}`);
  return source;
}

function readProject(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`Missing authoritative project artifact: ${relativePath}`);
    return '';
  }
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    errors.push(`Authoritative project artifact must be a regular non-symbolic-link file: ${relativePath}`);
    return '';
  }
  const source = readFileSync(absolutePath, 'utf8');
  if (source.length === 0) errors.push(`Authoritative project artifact must not be empty: ${relativePath}`);
  return source;
}

function readJson(relativePath) {
  const source = read(relativePath);
  if (!source) return undefined;
  try {
    const value = JSON.parse(source);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${relativePath} must be a JSON object`);
      return undefined;
    }
    return value;
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${error.message}`);
    return undefined;
  }
}

function readProjectJson(relativePath) {
  const source = readProject(relativePath);
  if (!source) return undefined;
  try {
    const value = JSON.parse(source);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`Authoritative ${relativePath} must be a JSON object`);
      return undefined;
    }
    return value;
  } catch (error) {
    errors.push(`Invalid JSON in authoritative ${relativePath}: ${error.message}`);
    return undefined;
  }
}

function equalJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function parseLevelTwoSections(source, locale) {
  const sections = new Map();
  const matches = [...source.matchAll(/^## ([^\n]+)\n/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const name = match[1].trim();
    if (sections.has(name)) errors.push(`${locale} duplicates section ${name}`);
    sections.set(name, source.slice(start, end).trim());
  }
  return sections;
}

function countCharacters(value) {
  return [...value].length;
}

function readExactReviewedProse(relativePath) {
  const source = read(relativePath);
  const expected = EXACT_REVIEWED_PROSE_SHA256[relativePath];
  const actual = createHash('sha256').update(source, 'utf8').digest('hex');
  if (actual !== expected) errors.push(`${relativePath} must retain the exact reviewed prose`);
  return source;
}

function verifyContentRightsInventory() {
  const inventory = readExactReviewedProse('content-rights-inventory.md');
  if (!inventory) return;
  requireText(
    inventory,
    /REVISED ITEMIZED DRAFT — OWNER RECONFIRMATION, PER-FAMILY BASIS, SIGNED DECLARATION, AND PRIVATE EVIDENCE PENDING/u,
    'Content-rights inventory must remain revised and pending owner reconfirmation and per-family evidence',
  );

  for (const group of CONTENT_RIGHTS_SOURCE_GROUPS) {
    if (!inventory.includes(group.sha256)) {
      errors.push(`Content-rights inventory is missing source SHA-256 ${group.sha256}`);
    }
    for (const relativePath of group.paths) {
      if (!inventory.includes(`\`${relativePath}\``)) {
        errors.push(`Content-rights inventory is missing exact source ${relativePath}`);
      }
      const absolutePath = join(root, relativePath);
      if (!existsSync(absolutePath)) {
        errors.push(`Missing content-rights source artifact: ${relativePath}`);
        continue;
      }
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        errors.push(`Content-rights source must be a regular non-symbolic-link file: ${relativePath}`);
        continue;
      }
      const bytes = readFileSync(absolutePath);
      if (bytes.length === 0) {
        errors.push(`Content-rights source must not be empty: ${relativePath}`);
        continue;
      }
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== group.sha256) {
        errors.push(`Content-rights source SHA-256 mismatch: ${relativePath}`);
      }
    }
  }
}

function requireText(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

function hasExactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && equalJson(Object.keys(value).sort(), [...expected].sort());
}

function containsCanonicalAccessCode(source) {
  return /\b(?:CH|AR)(?:[\s\p{Pd}_]*[A-F0-9]){32}\b/iu.test(source);
}

function verifyNoVersionedAccessCodes(directory = join(root, 'release'), relativeRoot = 'release') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(`App Store metadata artifact must not be a symbolic link: ${relativePath}`);
    } else if (entry.isDirectory()) {
      verifyNoVersionedAccessCodes(absolutePath, relativePath);
    } else if (/\.(?:json|md|txt)$/iu.test(entry.name)) {
      if (containsCanonicalAccessCode(readFileSync(absolutePath, 'utf8'))) {
        errors.push(`${relativePath} appears to contain a CH or AR credential`);
      }
    }
  }
}

function rejectUnapprovedHostedResourceUrls(source, label) {
  const approvedSlugs = new Set([
    ...approvedMiniapps.map((miniapp) => miniapp.slug),
    protectedClientResource.id,
  ]);
  for (const match of source.matchAll(/https:\/\/cabohealth\.org\/apps\/([a-z0-9-]+)\//gu)) {
    if (!approvedSlugs.has(match[1])) {
      errors.push(`${label} contain an unapproved hosted-resource URL: ${match[0]}`);
    }
  }
}

function rejectContradictoryCaboHealthEntityClaims(source, label) {
  const normalized = source.replace(/[`*_]/gu, '');
  const entityTerms = '(?:legal\\s+entity|company|organization|corporation)';
  const entityQualifiers = '(?:(?:separate|registered|legal)\\s+){0,2}';
  const predicateClaim = new RegExp(
    `\\bCabo\\s+Health\\b\\s+(?:is|acts|operates|functions|serves|constitutes|represents|exists|has\\s+been\\s+registered|was\\s+registered)\\s+(?:as\\s+)?(?:an?\\s+|the\\s+)?${entityQualifiers}${entityTerms}\\b`,
    'iu',
  );
  const appositiveClaim = new RegExp(
    `\\bCabo\\s+Health\\b\\s*,\\s*(?:an?\\s+|the\\s+)?${entityQualifiers}${entityTerms}\\b`,
    'iu',
  );
  const nameAsEntityClaim = new RegExp(
    `\\bCabo\\s+Health\\b\\s+${entityQualifiers}(?:company|organization|corporation)\\b`,
    'iu',
  );
  const spanishEntityTerms = '(?:entidad(?:\\s+legal)?|empresa|organizaci[oó]n|corporaci[oó]n|compa[ñn][ií]a|sociedad|persona\\s+moral)';
  const spanishEntityQualifiers = '(?:(?:separada|registrada|legal)\\s+){0,2}';
  const spanishPredicateClaim = new RegExp(
    `\\bCabo\\s+Health\\b\\s+(?:es|act[uú]a|opera|funciona|sirve|constituye|representa|existe|ha\\s+sido\\s+registrada|fue\\s+registrada)\\s+(?:como\\s+)?(?:un(?:a)?\\s+|la\\s+)?${spanishEntityQualifiers}${spanishEntityTerms}\\b`,
    'iu',
  );
  const spanishAppositiveClaim = new RegExp(
    `\\bCabo\\s+Health\\b\\s*,\\s*(?:un(?:a)?\\s+|la\\s+)?${spanishEntityQualifiers}${spanishEntityTerms}\\b`,
    'iu',
  );
  if (
    predicateClaim.test(normalized)
    || appositiveClaim.test(normalized)
    || nameAsEntityClaim.test(normalized)
    || spanishPredicateClaim.test(normalized)
    || spanishAppositiveClaim.test(normalized)
  ) {
    errors.push(`${label} contradicts the individual trade-brand disclosure by claiming Cabo Health is a legal entity, company, or organization`);
  }
}

function rejectContradictoryCommercialClaims(source, label) {
  const normalized = source.replace(/[`*_]/gu, '');
  const paidAccessClaim = /\b(?:clinic|client|protected|premium|digital|app)\s+(?:access|resources?|tier|subscription)?\s*(?:costs?|is\s+(?:sold|priced)|requires?\s+(?:payment|a\s+fee)|has\s+a\s+price)\b/iu;
  const explicitPriceClaim = /\b(?:price|cost|fee)\s*(?:is|:|of)?\s*(?:USD|MXN|US\$|MX\$|\$)\s*\d/iu;
  if (paidAccessClaim.test(normalized) || explicitPriceClaim.test(normalized)) {
    errors.push(`${label} contradicts the complimentary no-sale model`);
  }
}

function verifyManifest() {
  const manifest = readJson('release-manifest.json');
  if (!manifest) return;

  const {
    candidate,
    ascEvidence,
    ownerSeller,
    reviewRisk,
    scope,
    reviewCredential,
    aasaPlan,
    urls,
    copyright,
    appStoreDraft,
    gates,
  } = manifest;
  if (!hasExactKeys(manifest, [
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
  ])) {
    errors.push('Release manifest must contain the exact versioned App Store draft schema');
  }
  if (manifest.schemaVersion !== 2 || manifest.artifactKind !== 'app-store-metadata-candidate') {
    errors.push('Release manifest schema or artifact kind is invalid');
  }
  if (
    candidate?.appleId !== '6758285327'
    || candidate?.bundleIdentifier !== 'com.cabohealth.app'
    || candidate?.marketingVersion !== '3.0'
    || candidate?.buildNumber !== '4'
    || candidate?.status !== 'draft-blocked'
    || candidate?.appJsonUpdated !== false
    || candidate?.rcSourceSha !== null
    || candidate?.testFlightBuildId !== null
  ) {
    errors.push('Candidate must remain an unbuilt, app.json-untouched 3.0 build 4 draft');
  }
  if (
    ascEvidence?.currentRejectedVersion !== '3.0'
    || ascEvidence?.selectedRejectedBuild !== '2'
    || ascEvidence?.highestTestFlightBuild !== '3'
    || ascEvidence?.highestTestFlightBuildStatus !== 'expired'
    || ascEvidence?.nextCandidateBuild !== '4'
  ) {
    errors.push('ASC read-only evidence must reserve the next candidate as build 4');
  }
  if (!hasExactKeys(ownerSeller, Object.keys(expectedOwnerSeller))) {
    errors.push('Owner/seller record must contain the exact individual and trade-brand fields');
  }
  if (ownerSeller?.sellerType !== 'individual' || ownerSeller?.registeredOrganization !== false) {
    errors.push('App Store seller must remain an individual and not a registered organization');
  }
  if (ownerSeller?.legalSeller !== 'Ivan Guaderrama') {
    errors.push('App Store legal seller must remain Ivan Guaderrama');
  }
  if (ownerSeller?.publicBrand !== 'Cabo Health') errors.push('Public brand must remain Cabo Health');
  if (ownerSeller?.brandIsSeparateLegalEntity !== false) {
    errors.push('Cabo Health brand must not be represented as a separate legal entity');
  }
  if (ownerSeller?.dunsApplicable !== false || ownerSeller?.dunsNumber !== null) {
    errors.push('D-U-N-S must remain not applicable with no number for the individual seller');
  }
  if (ownerSeller?.relationship !== expectedOwnerSeller.relationship) {
    errors.push('Brand relationship must remain the owner-confirmed trade-brand relationship');
  }
  if (!equalJson(ownerSeller?.releaseTerritories, ['MEX', 'USA'])) {
    errors.push('Owner release territories must be exactly MEX and USA');
  }
  if (!equalJson(reviewRisk, expectedReviewRisk)) {
    errors.push('Seller gate must remain a documented high review risk with the Apple-direction/organization fallback and no approval guarantee');
  }

  if (!Array.isArray(scope?.miniapps) || scope.miniapps.length !== 2) {
    errors.push('Release scope must contain exactly two approved miniapps');
  } else {
    const normalized = scope.miniapps.map((miniapp) => ({
      slug: miniapp.slug,
      title: miniapp.title,
      url: miniapp.canonicalUrl,
      universalLink: miniapp.universalLink,
    }));
    const expected = approvedMiniapps.map((miniapp) => ({ ...miniapp, universalLink: miniapp.url }));
    if (!equalJson(normalized, expected)) {
      errors.push('Release scope must contain exactly two approved miniapps with canonical URLs and Universal Links');
    }
  }
  if (!equalJson(scope?.publicMiniapps, scope?.miniapps)) {
    errors.push('Release public miniapp aliases must remain byte-semantically identical');
  }
  const protectedResource = scope?.protectedResources?.[0];
  if (
    !Array.isArray(scope?.protectedResources)
    || scope.protectedResources.length !== 1
    || protectedResource?.id !== 'client-resources'
    || protectedResource?.title !== 'Client Resources'
    || protectedResource?.canonicalUrl !== protectedClientResource.url
    || protectedResource?.access !== 'existing-client-eligibility'
    || protectedResource?.serverProtectionRequired !== true
    || protectedResource?.arbitraryExternalLinksPublished !== false
  ) {
    errors.push('Release scope must contain exactly one protected Client Resources entry');
  }
  if (
    scope?.access !== 'mixed-public-and-existing-client-eligibility'
    || !equalJson(scope?.accountRequired, {
      publicResources: false,
      protectedClientResources: true,
      staffPortal: true,
      appReviewSandbox: true,
    })
    || scope?.demoCredentialRequired !== true
    || scope?.purchases !== false
    || scope?.userGeneratedContent !== false
    || scope?.nativeWebBridge !== false
    || scope?.remoteCatalog !== false
    || !Array.isArray(scope?.sensitivePermissions)
    || scope.sensitivePermissions.length !== 0
  ) {
    errors.push('Release scope access, data, and platform capabilities do not match the exact v3 candidate');
  }
  const commercial = scope?.commercialModel;
  if (
    commercial?.complimentary !== true
    || commercial?.existingInPersonClientsOnly !== true
    || commercial?.maximumActiveClientCodes !== null
    || commercial?.separatelySold !== false
    || commercial?.sale !== false
    || commercial?.price !== null
    || commercial?.checkout !== false
    || commercial?.inAppPurchase !== false
    || commercial?.purchaseCta !== null
    || commercial?.digitalTier !== null
  ) errors.push('Commercial model must remain complimentary, owner-issued for existing clients without a fixed business-count limit, and contain no digital sale mechanism');
  if (
    scope?.staffAdministration?.visibleSettingsEntry !== true
    || scope?.staffAdministration?.draftOnlyCatalogChanges !== true
    || scope?.staffAdministration?.directPublishing !== false
    || scope?.staffAdministration?.arbitraryRuntimeCatalog !== false
  ) errors.push('Staff administration must remain visible, draft-only, and unable to publish the runtime catalog');
  if (
    !hasExactKeys(reviewCredential, [
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
    || reviewCredential?.namespace !== 'review_sandbox'
    || reviewCredential?.purpose !== 'app_review'
    || reviewCredential?.credentialPrefix !== 'AR'
    || reviewCredential?.uidRealm !== 'review_*'
    || reviewCredential?.multiDevice !== true
    || reviewCredential?.credentialInRepository !== false
    || reviewCredential?.status !== 'pending-activation'
    || reviewCredential?.fixedReviewedResourceId !== 'review-sandbox-app-review-sample-v1'
    || reviewCredential?.launchMethod !== 'POST'
    || reviewCredential?.launchPath !== '/apps/app-review/launch/'
  ) errors.push('App Review credential must remain isolated and pending activation');
  if (!hasExactKeys(aasaPlan, ['components', 'status'])
    || !equalJson(aasaPlan?.components, expectedAasaComponents)
    || aasaPlan?.status !== 'deployed-and-verified-origin-and-apple-cdn') {
    errors.push('AASA plan must retain the ordered launch/api exclusions and three exact app roots');
  }
  if (!equalJson(urls, expectedUrls)) errors.push('Release manifest URLs do not match the exact canonical URLs');
  if (
    copyright?.value !== '2026 Ivan Guaderrama'
    || copyright?.status !== 'owner-confirmed-draft-pending-save'
  ) {
    errors.push('Copyright draft must remain 2026 Ivan Guaderrama and pending-save');
  }

  const categories = appStoreDraft?.categories;
  if (!hasExactKeys(appStoreDraft, [
    'status',
    'categories',
    'copyright',
    'availability',
    'dsa',
    'contentRights',
    'unresolvedExternalGates',
  ])) {
    errors.push('App Store draft must contain the exact pending-save metadata fields');
  }
  if (
    !hasExactKeys(categories, ['primary', 'secondary', 'legacyPrimary', 'legacyPrimaryAction'])
    || categories?.primary !== 'Health & Fitness'
    || categories?.secondary !== 'Food & Drink'
    || categories?.legacyPrimary !== 'Medical'
    || categories?.legacyPrimaryAction !== 'replace'
  ) {
    errors.push('App Store categories must replace Medical with Health & Fitness and Food & Drink');
  }
  if (appStoreDraft?.status !== 'pending-save') errors.push('App Store draft must remain pending-save');
  if (appStoreDraft?.copyright !== '2026 Ivan Guaderrama') {
    errors.push('App Store draft copyright must remain 2026 Ivan Guaderrama');
  }

  const availability = appStoreDraft?.availability;
  if (!hasExactKeys(availability, [
    'territories',
    'automaticFutureTerritories',
    'macAppleSiliconAvailable',
    'visionProAvailable',
    'status',
  ])) errors.push('Availability draft must contain the exact territory and platform fields');
  if (!equalJson(availability?.territories, ['MEX', 'USA'])) {
    errors.push('Initial App Store territories must be exactly MEX and USA');
  }
  if (availability?.automaticFutureTerritories !== false) {
    errors.push('Automatic future territories must remain disabled');
  }
  if (availability?.macAppleSiliconAvailable !== false) {
    errors.push('Mac Apple Silicon availability must remain off');
  }
  if (availability?.visionProAvailable !== false) {
    errors.push('Vision Pro availability must remain off');
  }
  if (availability?.status !== 'pending-save') errors.push('Availability must remain pending-save');

  const dsa = appStoreDraft?.dsa;
  if (!hasExactKeys(dsa, [
    'scope',
    'traderStatus',
    'releaseTerritories',
    'reassessBeforeAddingEuTerritory',
    'globalAccountState',
    'status',
  ])) errors.push('DSA draft must contain the exact app-level fields');
  if (dsa?.status !== 'pending-save') errors.push('DSA status must remain pending-save');
  if (dsa?.scope !== 'app-level' || dsa?.traderStatus !== 'non-trader/outside-EU-scope') {
    errors.push('App-level DSA status must remain non-trader/outside-EU-scope');
  }
  if (!equalJson(dsa?.releaseTerritories, ['MEX', 'USA'])) {
    errors.push('DSA release territories must be exactly MEX and USA');
  }
  if (dsa?.reassessBeforeAddingEuTerritory !== true) {
    errors.push('DSA must require reassessment before adding any EU territory');
  }
  if (dsa?.globalAccountState !== 'unchanged') {
    errors.push('DSA draft must not change global account state');
  }

  const contentRights = appStoreDraft?.contentRights;
  if (!hasExactKeys(contentRights, ['recommendedAnswer', 'usesThirdPartyMaterial', 'status'])) {
    errors.push('Content Rights draft must contain the exact recommendation fields');
  }
  if (
    contentRights?.recommendedAnswer !== 'Yes'
    || contentRights?.usesThirdPartyMaterial !== true
    || contentRights?.status !== 'inventory-revised-pending-owner-reconfirmation-and-per-family-basis'
  ) {
    errors.push('Content Rights recommendation must remain Yes while the revised inventory awaits owner reconfirmation and per-family rights basis');
  }
  const unresolved = appStoreDraft?.unresolvedExternalGates;
  if (!hasExactKeys(unresolved, Object.keys(expectedUnresolvedExternalGates))) {
    errors.push('Unresolved external App Store gate set is incomplete or contains unknown gates');
  } else {
    for (const [name, expected] of Object.entries(expectedUnresolvedExternalGates)) {
      if (unresolved[name] !== expected) errors.push(`${name} must remain ${expected}`);
    }
  }
  if (!gates || !equalJson(Object.keys(gates).sort(), Object.keys(expectedGateStates).sort())) {
    errors.push('Release manifest gate set is incomplete or contains unknown gates');
  } else {
    for (const [name, expected] of Object.entries(expectedGateStates)) {
      if (gates[name] !== expected) {
        errors.push(`${name} must remain ${expected} in this local metadata draft`);
      }
    }
  }
}

function verifyAuthoritativeProjectState() {
  const app = readProjectJson('app.json');
  if (app) {
    if (
      app.expo?.version !== '2.0.0'
      || app.expo?.ios?.buildNumber !== '3'
      || app.expo?.ios?.bundleIdentifier !== 'com.cabohealth.app'
    ) {
      errors.push('Manifest says appJsonUpdated=false, but authoritative app.json no longer matches the untouched 2.0.0/build 3 state');
    }
  }

  const configSource = readProject('constants/config.ts');
  if (
    !/\bversion:\s*'2\.0\.0'/u.test(configSource)
    || !/\bbuildNumber:\s*'1'/u.test(configSource)
  ) {
    errors.push('Authoritative constants/config.ts no longer matches the untouched pre-RC state');
  }

  const catalogSource = readProject('constants/publicMiniapps.ts');
  const canonicalSlugs = catalogSource.match(/\bPUBLIC_MINIAPP_SLUGS\s*=\s*\[([^\]]*)\]\s*as const/u);
  const slugs = canonicalSlugs
    ? [...canonicalSlugs[1].matchAll(/['"]([a-z0-9-]+)['"]/gu)].map((match) => match[1])
    : [];
  const canonicalUrls = [...catalogSource.matchAll(/\bcanonicalUrl:\s*['"](https:\/\/cabohealth\.org\/apps\/[a-z0-9-]+\/?)['"]/gu)]
    .map((match) => match[1]);
  const savedRatings = [...catalogSource.matchAll(/\bappStoreAgeRating:\s*9\b/gu)].length;
  if (
    !equalJson(slugs, approvedMiniapps.map((miniapp) => miniapp.slug))
    || !equalJson(canonicalUrls, approvedMiniapps.map((miniapp) => miniapp.url))
    || savedRatings !== 2
  ) {
    errors.push('Authoritative catalog must contain exactly the two approved slugs/URLs with the saved 9+ rating');
  }

  const compliance = readProjectJson('release/compliance-facts.json');
  if (compliance) {
    if (compliance.legalEntity?.legalSignOffStatus !== 'approved') {
      errors.push('Authoritative legal sign-off status no longer matches the approved owner confirmation');
    }
    const ownerConfirmedGates = [
      [['hosting', 'logTypes'], {
        value: ['IP address', 'browser or user-agent', 'requested URL', 'technical errors'],
        status: 'verified',
      }],
      [['hosting', 'retention'], {
        value: {
          description: 'Owner authorized 2026-08-17: hPanel visibility is up to 7 days; any additional retention is controlled by Hostinger.',
        },
        status: 'verified',
      }],
      [['hosting', 'deletionProcess'], {
        value: {
          description: 'Owner authorized 2026-08-17: deletion beyond hPanel visibility is controlled by Hostinger.',
        },
        status: 'verified',
      }],
      [['support', 'responseSla'], {
        value: {
          description: 'Owner confirmed 2026-08-17: respond within 2 business days, Monday-Friday, 10:00 AM-4:00 PM.',
        },
        status: 'verified',
      }],
      [['contentRights'], {
        value: {
          approved: true,
          scope: 'Owner confirmed 2026-08-17: ownership or authorization for the Cabo Health logo, domain, texts, recipes, and images used by public v1.',
        },
        status: 'verified',
      }],
      [['exportCompliance'], {
        value: {
          approved: true,
          determination: 'Owner confirmed 2026-08-17: standard iOS platform encryption and HTTPS only; no proprietary or custom cryptography.',
        },
        status: 'verified',
      }],
      [['medicalDevice'], {
        value: {
          isMedicalDevice: false,
          basis: 'Owner confirmed 2026-08-17: educational only; no diagnosis, treatment, or medical-device function.',
        },
        status: 'verified',
      }],
    ];
    for (const [path, expected] of ownerConfirmedGates) {
      let gate = compliance;
      for (const key of path) gate = gate?.[key];
      if (!equalJson(gate, expected)) {
        errors.push(`Authoritative verified owner confirmation changed: ${path.join('.')}`);
      }
    }
    const verifiedAgeGatePaths = [
      ['ageRating', 'host'],
      ['ageRating', 'miniapps', 'healthy-recipes'],
      ['ageRating', 'miniapps', 'clinic-guide'],
    ];
    for (const path of verifiedAgeGatePaths) {
      let gate = compliance;
      for (const key of path) gate = gate?.[key];
      if (gate?.status !== 'verified' || gate?.value !== 9) {
        errors.push(`Authoritative age rating no longer matches the saved Apple 9+ result: ${path.join('.')}`);
      }
    }
    if (
      compliance.schemaVersion !== 1
      || compliance.brand !== 'Cabo Health'
      || compliance.releaseReady !== true
      || compliance.slice !== 'task-7f-age-rating-saved'
      || compliance.legalEntity?.name !== 'Ivan Guaderrama'
      || compliance.legalEntity?.nameStatus !== 'owner-confirmed'
      || compliance.legalEntity?.sellerType !== 'individual'
      || compliance.legalEntity?.registeredOrganization !== false
      || compliance.legalEntity?.dunsApplicable !== false
      || compliance.legalEntity?.dunsNumber !== null
    ) {
      errors.push('Authoritative owner-confirmation and saved-age root/legal facts do not match this draft');
    }
    if (
      compliance.appStore?.seller?.status !== 'verified'
      || !equalJson(compliance.appStore.seller.value, {
        sellerType: 'individual',
        legalSeller: 'Ivan Guaderrama',
      })
      || compliance.appStore?.sellerRelationship?.status !== 'verified'
      || !equalJson(compliance.appStore.sellerRelationship.value, {
        publicBrand: 'Cabo Health',
        brandIsSeparateLegalEntity: false,
        relationship: 'trade brand owned and operated by Ivan Guaderrama',
      })
    ) {
      errors.push('Authoritative individual seller and trade-brand relationship do not match this draft');
    }
    if (
      compliance.phiRemediation?.status !== 'verified'
      || compliance.phiRemediation?.value?.completed !== true
      || compliance.phiRemediation?.value?.evidenceRef !== 'private-evidence:owner-authorized-phi-remediation'
    ) {
      errors.push('Authoritative PHI remediation must retain the sanitized verified private-evidence reference');
    }
  }

  const contacts = readProjectJson('release/public-contact-facts.json');
  if (contacts && contacts.status !== 'owner-confirmed') {
    errors.push('Authoritative public contact facts are no longer owner-confirmed');
  }
  for (const relativePath of ['release/content-rights.md', 'release/data-inventory.md']) {
    const source = readProject(relativePath);
    if (!/Status:\s*Draft\s*[—-]\s*not release-approved/iu.test(source)) {
      errors.push(`Authoritative ${relativePath} no longer matches this pending metadata draft`);
    }
  }
  const inventory = readProject('release/data-inventory.md');
  if (!/fixed `actorLabel: Staff`/u.test(inventory)
    || !/no actor UID, codes, client names, or resource URLs/iu.test(inventory)) {
    errors.push('Authoritative data inventory must describe the sanitized fixed Staff actor label without an actor UID');
  }
}

function verifyLocalization(locale) {
  const source = read(`${locale}.md`);
  if (!source) return;
  rejectContradictoryCaboHealthEntityClaims(source, `${locale} public metadata`);
  const sections = parseLevelTwoSections(source, locale);
  const required = [
    'Name',
    'Subtitle',
    'Promotional Text',
    'Description',
    'Keywords',
    'Support URL',
    'Privacy URL',
    'Marketing URL',
    'Copyright',
  ];
  if (!equalJson([...sections.keys()], required)) {
    errors.push(`${locale} must contain the exact ordered App Store metadata sections`);
    return;
  }

  const name = sections.get('Name');
  const subtitle = sections.get('Subtitle');
  const promotionalText = sections.get('Promotional Text');
  const description = sections.get('Description');
  const keywords = sections.get('Keywords');
  for (const field of ['Name', 'Subtitle', 'Promotional Text', 'Description', 'Keywords']) {
    if (sections.get(field).trim() === '') errors.push(`${locale} ${field} must not be empty`);
  }
  if (countCharacters(name) > 30) errors.push(`${locale} name exceeds 30 characters`);
  if (countCharacters(subtitle) > 30) errors.push(`${locale} subtitle exceeds 30 characters`);
  if (countCharacters(promotionalText) > 170) errors.push(`${locale} promotional text exceeds 170 characters`);
  if (countCharacters(description) > 4000) errors.push(`${locale} description exceeds 4,000 characters`);
  if (countCharacters(keywords) > 100) errors.push(`${locale} keywords exceed 100 characters`);
  if (name !== 'CaboHealth') errors.push(`${locale} name must remain CaboHealth`);
  if (sections.get('Support URL') !== expectedUrls.support) errors.push(`${locale} Support URL is not canonical`);
  if (sections.get('Privacy URL') !== expectedUrls.privacy) errors.push(`${locale} Privacy URL is not canonical`);
  if (sections.get('Marketing URL') !== expectedUrls.marketing) errors.push(`${locale} Marketing URL is not canonical`);
  if (sections.get('Copyright') !== '2026 Ivan Guaderrama') {
    errors.push(`${locale} copyright must remain 2026 Ivan Guaderrama`);
  }

  const publicCopy = [name, subtitle, promotionalText, description, keywords].join('\n');
  rejectUnapprovedHostedResourceUrls(publicCopy, `${locale} public metadata`);
  const marketplaceFraming = /\b(?:marketplace|app\s*store|install|download|tienda\s+de\s+apps|mercado\s+de\s+apps|instalar|descargar)\b/iu;
  if (marketplaceFraming.test(publicCopy)) {
    errors.push(`${locale} public metadata contains forbidden marketplace framing`);
  }
  const excludedScope = /\b(?:Sleep Lab|Service Hub|Health Advisor|AI Cosmetic Scan|patient records?|expedientes? de pacientes|analytics|anal[ií]tica)\b/iu;
  if (excludedScope.test(publicCopy)) errors.push(`${locale} public metadata names excluded release scope`);
}

function verifyReviewNotes() {
  const notes = read('review-notes.md');
  if (!notes) return;
  const marker = '## Paste-ready body after all gates are resolved';
  const markerIndex = notes.indexOf(marker);
  if (markerIndex === -1) {
    errors.push('Review Notes are missing the gated paste-ready body');
    return;
  }
  const body = notes.slice(markerIndex + marker.length).trim();
  if (countCharacters(body) > 4000) errors.push('Review Notes paste-ready body exceeds 4,000 characters');
  rejectUnapprovedHostedResourceUrls(body, 'Review Notes');
  const resourceList = body.match(/GUIDELINE 4\.7 — HOSTED RESOURCES\n([\s\S]*?)\n\nOnly these Universal Links enter\./u)?.[1]?.trim();
  const expectedResourceList = [
    ...approvedMiniapps.map((miniapp, index) => `${index + 1}. ${miniapp.title} — public — ${miniapp.url}`),
    `3. ${protectedClientResource.title} — protected existing-client eligibility — ${protectedClientResource.url}`,
  ].join('\n');
  if (resourceList !== expectedResourceList) {
    errors.push('Guideline 4.7 resource list must contain exactly two public entries and one protected Client Resources entry');
  }
  if (excludedNamedScope.test(body)) errors.push('Review Notes name excluded release scope');
  rejectContradictoryCaboHealthEntityClaims(notes, 'Review Notes');
  rejectContradictoryCommercialClaims(notes, 'Review Notes');
  if (
    /(?:password|passcode|secret|api[-_ ]?key|token|contrase[ñn]a|clave|access code|demo code|reviewer code|credential)\s*[:=]\s*\S+/iu.test(notes)
    || containsCanonicalAccessCode(notes)
  ) {
    errors.push('Review Notes appear to contain a credential');
  }
  if (/\[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS/iu.test(body)) {
    errors.push('Review Notes still contain the obsolete hosting blocker placeholder');
  }
  if (/continues automatically|about 1\.6 seconds/iu.test(body)) {
    errors.push('Review Notes describe obsolete automatic introduction timing');
  }
  for (const miniapp of approvedMiniapps) {
    requireText(body, new RegExp(miniapp.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `Review Notes missing ${miniapp.title}`);
    if (body.split(miniapp.url).length - 1 < 2) {
      errors.push(`Review Notes missing canonical URL/Universal Link for ${miniapp.slug}`);
    }
  }
  if (body.split(protectedClientResource.url).length - 1 !== 1) {
    errors.push('Review Notes missing canonical URL/Universal Link for client-resources');
  }
  for (const [name, url] of Object.entries(expectedUrls)) {
    if (name !== 'marketing' && !body.includes(url)) errors.push(`Review Notes missing ${name} URL`);
  }
  const requiredPatterns = [
    [/CaboHealth 3\.0 \(build 4\)/u, 'Review Notes missing exact version/build'],
    [/two public wellness\/editorial resources plus protected Client Resources/u, 'Review Notes must describe the exact public and protected resource scope'],
    [/This app is submitted by Ivan Guaderrama, an individual Apple Developer Program member\. Cabo Health is a trade brand owned and operated by Ivan Guaderrama and is not represented as a separate legal entity\./u, 'Review Notes missing the individual seller and trade-brand disclosure'],
    [/GUIDELINE 4\.2/u, 'Review Notes missing Guideline 4.2 native value'],
    [/GUIDELINE 4\.7/u, 'Review Notes missing Guideline 4.7 hosted-resource disclosure'],
    [/PRIOR REVIEW RESOLUTION/u, 'Review Notes missing prior-review resolution'],
    [/Former advisory and camera-based AI resources are excluded/iu, 'Review Notes missing prior advisory/camera-AI removal'],
    [/No third-party AI is implemented\/invoked; app code sends no data to an AI provider/iu, 'Review Notes missing no-third-party-AI and no-AI-data disclosure'],
    [/No camera, Photos, HealthKit, microphone, or location access; WebViews deny media\/geolocation/iu, 'Review Notes missing exact sensitive-permission exclusion'],
    [/Both public resources show dated Sources\/Fuentes with official links/iu, 'Review Notes missing official editorial-source disclosure'],
    [/does not ask clients for a name, email address, phone number, or profile registration/iu, 'Review Notes missing pseudonymous client-account disclosure'],
    [/separate multi-device App Review credential/iu, 'Review Notes missing isolated App Review credential disclosure'],
    [/complimentary.*existing in-person clients/isu, 'Review Notes missing complimentary existing-client eligibility disclosure'],
    [/No price, checkout, in-app purchase, subscription, paid digital tier, advertising/iu, 'Review Notes missing monetization disclosure'],
    [/Each client receives a separate revocable code/iu, 'Review Notes missing individual revocable-code model'],
    [/no shared master code or fixed four-client business limit/iu, 'Review Notes missing no-master/no-fixed-limit disclosure'],
    [/user-generated content/iu, 'Review Notes missing UGC disclosure'],
    [/native message bridge/iu, 'Review Notes missing native-bridge disclosure'],
    [/drafts cannot publish or change the submitted runtime catalog/iu, 'Review Notes missing draft-only Staff Access disclosure'],
    [/Staff Access is an owner[/]operator surface; reviewer access, if required, is supplied separately in App Store Connect/iu, 'Review Notes must retain the Staff Access review-access disclosure'],
    [/No health information or sensitive device permission is requested/iu, 'Review Notes missing permission disclosure'],
    [/remains on the introduction until the reviewer taps “Enter CaboHealth”/iu, 'Review Notes missing current manual-entry behavior'],
    [/Hostinger verification observed IP, timestamp, method, resource, device\/user-agent, country, bytes, and latency/iu, 'Review Notes missing observed Hostinger log fields'],
    [/Authorized logs include IP, user-agent, URL, and errors/iu, 'Review Notes missing owner-authorized Hostinger log fields'],
    [/for delivery\/security\/troubleshooting/iu, 'Review Notes missing Hostinger log purpose'],
    [/hPanel shows up to 7 days/iu, 'Review Notes missing owner-authorized hPanel visibility'],
    [/added retention\/deletion is Hostinger-controlled/iu, 'Review Notes missing owner-authorized retention/deletion disclosure'],
    [/; no tracking\./iu, 'Review Notes missing non-tracking disclosure'],
    [/pseudonymous Firebase UID/iu, 'Review Notes missing pseudonymous Firebase identifier disclosure'],
    [/SecureStore/iu, 'Review Notes missing SecureStore installation disclosure'],
    [/App Check/iu, 'Review Notes missing App Check disclosure'],
    [/Launch nonces and hosted sessions are short-lived/iu, 'Review Notes missing short-lived launch and hosted-session disclosure'],
    [/Home > Client Resources > “Delete review access and data”/iu, 'Review Notes missing exact App Review deletion path'],
    [/Confirm pending\/completed; if pending, reopen it without signing in for completion confirmation/iu, 'Review Notes missing deletion status and completion-confirmation review step'],
    [/Durable deletion revokes access on acceptance; expiry\/admin revocation queues cleanup/iu, 'Review Notes missing exact deletion lifecycle disclosure'],
    [/random 256-bit receipt stays in SecureStore/iu, 'Review Notes missing durable deletion receipt disclosure'],
    [/server keeps only a keyed-HMAC lookup and status timestamps/iu, 'Review Notes missing deletion receipt server-boundary disclosure'],
    [/expects completion within 30 days/iu, 'Review Notes missing non-guaranteed expected deletion window'],
    [/retries every five minutes/iu, 'Review Notes missing deletion retry interval'],
    [/confirms after reopening/iu, 'Review Notes missing in-app deletion completion confirmation'],
    [/Staff-audit deletion deadline is 30 days; Firestore TTL is asynchronous/iu, 'Review Notes missing asynchronous audit-deletion disclosure'],
    [/Cloud Functions writes no raw IP to Firestore; only keyed-HMAC rate-limit buckets with a 30-minute deadline/iu, 'Review Notes missing Firestore source-IP rate-limit boundary'],
    [/Google Cloud Logging retains automatic Cloud Run request logs—source IP, method\/URL, user-agent, status, latency, sizes, protocol—for 30 days in `_Default`; no exclusion/iu, 'Review Notes missing automatic Cloud Run request-log retention disclosure'],
    [/durable deletion/iu, 'Review Notes missing durable deletion disclosure'],
    [/30 days/iu, 'Review Notes missing audit retention disclosure'],
  ];
  for (const [pattern, message] of requiredPatterns) requireText(body, pattern, message);
}

function verifyPrivacy() {
  const privacy = readJson('app-privacy.json');
  if (!privacy) return;
  const nativeBehavior = privacy.nativeBehavior;
  const logs = privacy.hostedTechnicalRequestLogs;
  const cloudRunLogs = privacy.cloudRunRequestLogs;
  const conditionalRecommendation = privacy.conditionalRecommendation;
  const schemaAndPurposesAreExact = (
    hasExactKeys(privacy, [
      'schemaVersion',
      'status',
      'architectureStatus',
      'recommendedAppPrivacyAnswer',
      'nativeBehavior',
      'clientAccount',
      'installation',
      'appCheck',
      'backend',
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
    && hasExactKeys(nativeBehavior, [
      'account',
      'healthInformationRequested',
      'appGeneratedIdentifier',
      'analytics',
      'advertising',
      'tracking',
      'sensitivePermissions',
      'localOnlyState',
    ])
    && hasExactKeys(logs, [
      'provider',
      'observedFields',
      'ownerAuthorizedFields',
      'purpose',
      'retention',
      'deletionProcess',
      'linkedToIdentity',
      'tracking',
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
    && hasExactKeys(cloudRunLogs, [
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
    && hasExactKeys(conditionalRecommendation, [
      'dataNotCollectedPath',
      'dataCollectedPath',
      'provisionalPurpose',
      'provisionalCategoryMapping',
    ])
    && equalJson(logs?.purpose, ['page delivery', 'security and troubleshooting'])
  );
  if (!schemaAndPurposesAreExact) {
    errors.push('App Privacy schemas and hosting purposes must be exact');
  }
  if (
    privacy.schemaVersion !== 5
    || privacy.status !== 'pending-final-linkage-category-review-and-save'
    || privacy.architectureStatus !== 'core-infrastructure-deployed-pending-app-attest-valid-flow-and-exact-rc-e2e'
    || privacy.recommendedAppPrivacyAnswer !== 'Yes, we collect data from this app'
  ) {
    errors.push('App Privacy collection answer must remain Yes, we collect data from this app while linkage, categories, and exact-RC review remain pending');
  }
  if (
    nativeBehavior?.account !== true
    || nativeBehavior?.healthInformationRequested !== false
    || nativeBehavior?.appGeneratedIdentifier !== true
    || nativeBehavior?.analytics !== false
    || nativeBehavior?.advertising !== false
    || nativeBehavior?.tracking !== false
    || !equalJson(nativeBehavior?.sensitivePermissions, [])
    || !equalJson(nativeBehavior?.localOnlyState, [
      'saved public-resource slugs and order',
      'language, appearance, haptics, and effects preferences',
      'recipe favorite keys',
      'visit-checklist completion state',
    ])
  ) {
    errors.push('App Privacy native behavior does not match the exact v3 candidate');
  }
  if (
    privacy.clientAccount?.provider !== 'Firebase Authentication'
    || privacy.clientAccount?.pseudonymous !== true
    || privacy.clientAccount?.nameEmailPhoneRequestedFromClient !== false
    || privacy.installation?.storage !== 'SecureStore'
    || privacy.installation?.deviceBound !== true
    || privacy.appCheck?.required !== true
    || !equalJson(privacy.backend?.providers, [
      'Firebase Authentication',
      'Cloud Functions',
      'Cloud Firestore',
      'Firebase App Check',
      'Google Cloud Logging',
      'Hostinger',
    ])
    || privacy.backend?.codesStoredPlaintext !== false
    || privacy.backend?.clientNamesStored !== false
    || privacy.cloudFunctionRequestSecurity?.rawSourceIpProcessedTransiently !== true
    || privacy.cloudFunctionRequestSecurity?.rawSourceIpStoredInFirestore !== false
    || privacy.cloudFunctionRequestSecurity?.providerRequestLoggingDocumentedSeparately !== true
    || privacy.cloudFunctionRequestSecurity?.storedRateLimitRepresentation !== 'versioned keyed HMAC lookup only'
    || !equalJson(privacy.cloudFunctionRequestSecurity?.purpose, ['rate limiting', 'abuse prevention'])
    || privacy.cloudFunctionRequestSecurity?.rateLimitBucketDeletionDeadlineMinutes !== 30
    || privacy.cloudFunctionRequestSecurity?.physicalTtlDeletionAsynchronous !== true
    || privacy.cloudFunctionRequestSecurity?.tracking !== false
    || cloudRunLogs?.provider !== 'Google Cloud Logging'
    || cloudRunLogs?.automatic !== true
    || !equalJson(cloudRunLogs?.observedFields, [
      'source IP address',
      'HTTP method',
      'requested URL',
      'user-agent',
      'HTTP status',
      'latency',
      'request and response sizes',
      'protocol',
    ])
    || !equalJson(cloudRunLogs?.purpose, ['service delivery', 'security and troubleshooting'])
    || cloudRunLogs?.retentionDays !== 30
    || cloudRunLogs?.defaultSinkExclusionConfigured !== false
    || cloudRunLogs?.deletionProcess !== 'Google Cloud Logging applies the unlocked _Default bucket retention; expiration is provider-enforced and may be eventually consistent.'
    || cloudRunLogs?.linkedToIdentity !== null
    || cloudRunLogs?.tracking !== false
    || cloudRunLogs?.verifiedDate !== '2026-08-24'
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
    || !equalJson(privacy.deletion?.responseStatuses, ['pending', 'completed'])
    || privacy.deletion?.authorizationRevokedWhenAccepted !== true
    || privacy.deletion?.grantExpiryQueuesDeletion !== true
    || privacy.deletion?.administratorRevocationQueuesDeletion !== true
    || privacy.deletion?.retryWorkerMinutes !== 5
    || privacy.deletion?.completionTimeGuaranteed !== false
    || privacy.deletionReceiptStatus?.receiptEntropyBits !== 256
    || privacy.deletionReceiptStatus?.receiptEncoding !== 'base64url'
    || privacy.deletionReceiptStatus?.receiptEncodedLength !== 43
    || privacy.deletionReceiptStatus?.nativeStorage !== 'SecureStore'
    || !equalJson(privacy.deletionReceiptStatus?.localStates, ['prepared', 'accepted'])
    || privacy.deletionReceiptStatus?.preparedBeforeDeletionRequest !== true
    || !equalJson(privacy.deletionReceiptStatus?.deleteRequestFields, ['installationId', 'deletionReceipt'])
    || privacy.deletionReceiptStatus?.productionStatusCallable !== 'getClientAccountDeletionStatus'
    || privacy.deletionReceiptStatus?.reviewStatusCallable !== 'getAppReviewAccountDeletionStatus'
    || !equalJson(privacy.deletionReceiptStatus?.statusRequestFields, ['deletionReceipt'])
    || privacy.deletionReceiptStatus?.statusResponse?.schemaVersion !== 1
    || !equalJson(privacy.deletionReceiptStatus?.statusResponse?.exactFields, [
      'schemaVersion',
      'status',
      'requestedAtMs',
      'expectedCompletionByMs',
      'completedAtMs',
    ])
    || !equalJson(privacy.deletionReceiptStatus?.statusResponse?.statuses, ['pending', 'completed'])
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
    || !equalJson(privacy.reviewSandbox?.responseStatuses, ['pending', 'completed'])
    || privacy.reviewSandbox?.authorizationRevokedWhenAccepted !== true
    || privacy.reviewSandbox?.currentIdentityInactivityEligibilityDays !== 30
    || privacy.reviewSandbox?.staleGenerationEligibility !== 'immediate'
    || privacy.reviewSandbox?.retryWorkerMinutes !== 5
    || privacy.reviewSandbox?.completionTimeGuaranteed !== false
    || privacy.reviewSandbox?.status !== 'infrastructure-deployed-pending-credential-valid-flow-and-device-e2e'
  ) errors.push('App Privacy client-access architecture must remain pseudonymous, device-bound, App-Check protected, transiently HMAC rate-limited, durably deletable in both realms, short-lived, and sanitized');
  if (
    logs?.provider !== 'Hostinger'
    || !equalJson(logs.observedFields, [
      'IP address',
      'timestamp',
      'HTTP method',
      'requested resource',
      'device and user-agent details',
      'country',
      'response bytes',
      'latency',
    ])
    || !equalJson(logs.ownerAuthorizedFields, [
      'IP address',
      'browser or user-agent',
      'requested URL',
      'technical errors',
    ])
    || logs.retention !== 'hPanel visibility up to 7 days; any additional retention is controlled by Hostinger.'
    || logs.deletionProcess !== 'Deletion beyond hPanel visibility is controlled by Hostinger.'
    || logs.linkedToIdentity !== null
    || logs.tracking !== false
  ) {
    errors.push('Hosting request-log facts must retain the owner-authorized retention/deletion disclosure, unresolved linkage, and non-tracking status');
  }
  if (
    conditionalRecommendation?.dataNotCollectedPath !== 'Not applicable to this v3 architecture: pseudonymous identifiers and provider request records are retained off device beyond real-time request servicing.'
    || conditionalRecommendation?.dataCollectedPath !== 'Required. Map the final verified production data types, purposes, linkage, and retention in App Store Connect after the exact RC and hosting configuration are tested.'
    || !equalJson(conditionalRecommendation?.provisionalPurpose, [
      'App Functionality',
    ])
    || !equalJson(conditionalRecommendation?.provisionalCategoryMapping, [
      'User ID, if the pseudonymous Firebase UID is retained and disclosure is required',
      'Device ID, if the app-installation identifier is retained off device and disclosure is required',
      'Coarse Location, Device ID, or Other Diagnostic Data as required by Apple\'s final mapping of retained IP addresses',
      'Product Interaction, if retained requested-resource activity is in disclosure scope',
      'Performance Data, if retained latency or response-byte measurements are in disclosure scope',
      'Other Diagnostic Data, if retained HTTP method, user-agent, or technical-error records are in disclosure scope',
      'Other Data Types, only if a retained field cannot be accurately mapped to another Apple data type',
    ])
  ) {
    errors.push('App Privacy draft must retain the exact conditional App Privacy mapping');
  }
  const privacyDraft = readExactReviewedProse('app-privacy.md');
  rejectContradictoryCaboHealthEntityClaims(privacyDraft, 'App Privacy draft');
}

function verifyAgeRating() {
  const age = readJson('age-rating.json');
  if (!age) return;
  const expectedConditionKeys = [
    'unrestrictedWebAccess',
    'medicalOrTreatmentInformation',
    'healthOrWellnessTopics',
  ];
  const expectedOtherAnswers = {
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
  };
  if (
    !hasExactKeys(age, [
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
    || !hasExactKeys(age.questionnaireReference, [
      'provider',
      'url',
      'verifiedDate',
      'frequencyScale',
    ])
    || !hasExactKeys(age.conditions, expectedConditionKeys)
    || !Object.values(age.conditions ?? {}).every((condition) => hasExactKeys(condition, [
      'requiredAnswer',
      'basis',
    ]))
    || !equalJson(age.otherSupportedAnswers, expectedOtherAnswers)
    || !hasExactKeys(age.ageCategoryAndOverride, [
      'kidsAgeBand',
      'ageRatingOverrideV2',
      'koreaAgeRatingOverride',
      'developerAgeRatingInfoUrl',
      'status',
    ])
  ) {
    errors.push('Age-rating condition and supported-answer schemas must be exact');
  }
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
    || !equalJson(age.questionnaireReference?.frequencyScale, ['NONE', 'INFREQUENT', 'FREQUENT'])
    || age.ageCategoryAndOverride?.kidsAgeBand !== null
    || age.ageCategoryAndOverride?.ageRatingOverrideV2 !== 'NONE'
    || age.ageCategoryAndOverride?.koreaAgeRatingOverride !== 'NONE'
    || age.ageCategoryAndOverride?.developerAgeRatingInfoUrl !== null
    || age.ageCategoryAndOverride?.status !== 'pending-app-store-confirmation'
  ) {
    errors.push('Age rating must remain projected 9+ with owner reconfirmation and App Store recalculation required');
  }
  if (age.conditions?.unrestrictedWebAccess?.requiredAnswer !== false) {
    errors.push('Projected 9+ rating requires unrestrictedWebAccess=false');
  }
  if (age.conditions?.medicalOrTreatmentInformation?.requiredAnswer !== 'NONE') {
    errors.push('Projected 9+ rating requires medicalOrTreatmentInformation=NONE');
  }
  if (age.conditions?.healthOrWellnessTopics?.requiredAnswer !== true) {
    errors.push('Projected 9+ rating requires healthOrWellnessTopics=true');
  }
  const ageRatingDraft = readExactReviewedProse('age-rating.md');
  rejectContradictoryCaboHealthEntityClaims(ageRatingDraft, 'age-rating draft');
}

function verifyScreenshots() {
  const screenshots = readJson('screenshots-manifest.json');
  if (!screenshots) return;
  const requiredEvidenceKeys = [
    'testFlightBuildId',
    'sourceSha',
    'imageHashes',
    'ocrExcludedScopeCheck',
    'humanVisualSignOff',
  ];
  if (
    !hasExactKeys(screenshots, [
      'schemaVersion',
      'status',
      'marketingVersion',
      'buildNumber',
      'deviceClass',
      'locales',
      'sceneIds',
      'captures',
      'requiredEvidence',
    ])
    || !hasExactKeys(screenshots.requiredEvidence, requiredEvidenceKeys)
    || screenshots.schemaVersion !== 2
  ) errors.push('Screenshot manifest must retain the exact authority schema');
  if (
    screenshots.status !== 'pending-exact-rc-capture'
    || screenshots.marketingVersion !== '3.0'
    || screenshots.buildNumber !== '4'
    || screenshots.deviceClass !== 'iPhone 6.9-inch'
  ) {
    errors.push('Screenshot manifest must target 3.0 build 4 on the 6.9-inch iPhone class');
  }
  if (!equalJson(screenshots.locales, ['en-US', 'es-MX'])) errors.push('Screenshot locales must be exactly en-US and es-MX');
  if (!equalJson(screenshots.sceneIds, expectedSceneIds)) errors.push('Screenshot storyboard must contain the exact eight approved scenes');
  if (!Array.isArray(screenshots.captures) || screenshots.captures.length !== 0) {
    errors.push('Screenshot captures must remain empty before exact-RC capture');
  }
  if (Object.values(screenshots.requiredEvidence ?? {}).some((value) => value !== null)) {
    errors.push('Screenshot evidence must remain null before exact-RC capture');
  }
  const screenshotStoryboard = read('screenshots/storyboard.md');
  rejectContradictoryCaboHealthEntityClaims(screenshotStoryboard, 'screenshot storyboard');
}

function verifyHumanChecklists() {
  const completedOwnerE2eGate = '- [x] Run a controlled production end-to-end check proving verified-email password-only sign-in, App Check, recent authentication, server-side permission enforcement, and no second-factor challenge.';
  const completedPublicWebGates = [
    '- [x] Deploy the ordered AASA authority with four launch/API exclusions followed by the three exact allowed roots; verify origin bytes and Apple CDN bytes before Universal Link QA.',
  ];
  const completedRevisedPublicWebGates = [
    '- [x] Promote and origin-verify the revised Healthy Recipes and Clinic Guide citation bytes plus the updated Privacy disclosure, then regenerate the exact public-release evidence. Marketing, Terms, Support, Report Content, and AASA remained byte-identical to the preceding 17-file release.',
    '- [x] Verify the revised two-miniapp/Privacy payload is exact and no WordPress or unrelated file changes occurred during promotion. The preceding release remains retained as rollback.',
  ];
  const required = [
    'testflight-what-to-test.md',
    'accessibility-nutrition-label-evidence.md',
    'content-rights-and-brand.md',
    'unsigned-ownership-declaration.md',
    'declarations.md',
    'submission-gates.md',
  ];
  const labels = {
    'testflight-what-to-test.md': 'TestFlight draft',
    'accessibility-nutrition-label-evidence.md': 'accessibility draft',
    'content-rights-and-brand.md': 'brand rights draft',
    'unsigned-ownership-declaration.md': 'ownership declaration',
    'declarations.md': 'declarations draft',
    'submission-gates.md': 'submission gates',
  };
  for (const file of required) {
    const source = read(file);
    rejectContradictoryCaboHealthEntityClaims(source, labels[file]);
    let unsupportedCompletedEvidence = source;
    if (file === 'submission-gates.md') {
      if (!source.includes(completedOwnerE2eGate)) {
        errors.push('submission-gates.md must retain the exact completed owner Staff Access E2E checkbox');
      }
      for (const completedPublicWebGate of completedPublicWebGates) {
        if (!source.includes(completedPublicWebGate)) {
          errors.push('submission-gates.md must retain the exact completed AASA public-web evidence checkbox');
        }
      }
      for (const completedRevisedPublicWebGate of completedRevisedPublicWebGates) {
        if (!source.includes(completedRevisedPublicWebGate)) {
          errors.push('submission-gates.md must retain every exact completed revised public-web checkbox');
        }
      }
      unsupportedCompletedEvidence = [
        completedOwnerE2eGate,
        ...completedPublicWebGates,
        ...completedRevisedPublicWebGates,
      ]
        .reduce((remaining, completedGate) => remaining.replace(completedGate, ''), source);
    }
    if (/\[[xX]\]/u.test(unsupportedCompletedEvidence)) {
      errors.push(`${file} contains an unsupported completed evidence checkbox`);
    }
  }
  const accessibility = read('accessibility-nutrition-label-evidence.md');
  requireText(accessibility, /NO ACCESSIBILITY SUPPORT CLAIM IS APPROVED YET/u, 'Accessibility Nutrition Label checklist must remain unapproved');
  const rights = read('content-rights-and-brand.md');
  requireText(rights, /Apple ID `6758285327`/u, 'Brand attachment checklist missing Apple ID');
  requireText(rights, /bundle ID `com\.cabohealth\.app`/u, 'Brand attachment checklist missing bundle ID');
  requireText(rights, /signed and dated ownership declaration/iu, 'Brand attachment checklist missing signed and dated individual ownership declaration');
  requireText(rights, /domain-control proof/iu, 'Brand attachment checklist missing domain-control evidence');
  requireText(rights, /brand\/logo\/content rights schedule/iu, 'Brand attachment checklist missing brand/logo/content rights schedule');
  requireText(rights, /Mexico and United States only/iu, 'Brand attachment checklist missing Mexico/US scope');
  requireText(rights, /do not guarantee acceptance/iu, 'Brand attachment checklist must not guarantee Apple acceptance');
  requireText(rights, /do not replace trademark registration/iu, 'Brand attachment checklist must not present self-declaration as trademark registration');
  requireText(rights, /Yes — uses third-party material/iu, 'Brand attachment checklist missing the truthful Content Rights recommendation');
  const ownership = read('unsigned-ownership-declaration.md');
  requireText(ownership, /^# UNSIGNED DRAFT\b/u, 'Ownership declaration must remain unsigned');
  requireText(ownership, /Cabo Health is a trade brand owned and operated by me/u, 'Ownership declaration missing individual trade-brand ownership');
  requireText(ownership, /not a separate legal entity or registered organization/u, 'Ownership declaration must not claim a Cabo Health legal entity or organization');
  requireText(ownership, /Apple ID `6758285327`/u, 'Ownership declaration missing Apple ID');
  requireText(ownership, /bundle ID `com\.cabohealth\.app`/u, 'Ownership declaration missing bundle ID');
  requireText(ownership, /Mexico and United States only/iu, 'Ownership declaration missing Mexico/US scope');
  if (/Cabo Health is (?:a )?(?:registered organization|legal entity)/iu.test(ownership)) {
    errors.push('Ownership declaration must not claim Cabo Health is a registered organization or legal entity');
  }
  if (/\b(?:street address|passport|driver'?s license|SSH|password|tax ID|bank account)\s*:/iu.test(ownership)) {
    errors.push('Ownership declaration contains prohibited private or invented registration data');
  }
  const declarations = read('declarations.md');
  requireText(declarations, /Regulated medical device/u, 'Medical-device declaration checklist missing');
  requireText(declarations, /Encryption and export compliance/u, 'Export declaration checklist missing');
  const gates = read('submission-gates.md');
  requireText(gates, /Individual/u, 'Seller/legal-entity external gate is missing');
  requireText(gates, /high review risk/iu, 'Seller gate must document high review risk');
  requireText(gates, /does not resolve or guarantee Apple approval/iu, 'Seller gate must not claim the wellness scope guarantees approval');
  requireText(gates, /written Apple direction[\s\S]*later migrate to a registered organization/iu, 'Seller gate missing the required fallback');
  requireText(gates, /blocked/iu, 'Submission gates must remain blocked');
}

function verifyReleaseV3Package() {
  try {
    errors.push(...verifyCapturedReleaseV3(captureReleaseV3(root)));
  } catch (error) {
    errors.push(`Release v3 authority could not be captured: ${error instanceof Error ? error.message : String(error)}`);
  }
}

verifyReleaseV3Package();
verifyNoVersionedAccessCodes();
verifyManifest();
verifyAuthoritativeProjectState();
verifyLocalization('en-US');
verifyLocalization('es-MX');
verifyReviewNotes();
verifyPrivacy();
verifyAgeRating();
verifyScreenshots();
verifyHumanChecklists();
verifyContentRightsInventory();

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('App Store metadata draft verified; submission remains blocked.\n');
}
