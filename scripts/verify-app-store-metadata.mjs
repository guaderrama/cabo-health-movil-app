import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

const expectedUrls = Object.freeze({
  support: 'https://cabohealth.org/app/support/',
  privacy: 'https://cabohealth.org/app/privacy/',
  terms: 'https://cabohealth.org/app/terms/',
  reportContent: 'https://cabohealth.org/app/report-content/',
  marketing: 'https://cabohealth.org/',
});

const expectedGateStates = Object.freeze({
  legalEntitySignOff: 'pending-owner-legal',
  sellerLegalEntity: 'owner-confirmed-individual',
  sellerRelationship: 'owner-confirmed-trade-brand',
  brandAuthorization: 'pending-signed-owner-declaration',
  contentRights: 'pending-final-rights-inventory-owner-confirmation',
  hostedRoutes: 'pending-deployment',
  hostingLogTypes: 'pending-task-7b',
  hostingLogRetention: 'pending-owner-legal',
  hostingLogDeletion: 'pending-owner-legal',
  supportResponseSla: 'pending-owner',
  phiRemediation: 'verified-owner-authorized',
  ageRating: 'pending-app-store-calculation',
  medicalDevice: 'pending-account-holder',
  exportCompliance: 'pending-account-holder',
  exactReleaseCandidate: 'pending-build-and-qa',
  accessibilityLabels: 'pending-exact-rc-evidence',
  screenshots: 'pending-exact-rc-capture',
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
});

const expectedReviewRisk = Object.freeze({
  level: 'medium',
  basis: 'general-wellness/editorial-only',
  appleApprovalGuaranteed: false,
  fallback: 'If Apple determines the app provides healthcare services, obtain written Apple direction or later migrate to a registered organization.',
});

const expectedUnresolvedExternalGates = Object.freeze({
  regulatedMedicalDevice: 'pending-account-holder',
  exportCompliance: 'pending-account-holder',
  finalPrivacyDisclosure: 'pending-owner-legal',
  hostingLogRetention: 'pending-owner-legal',
  hostingLogDeletion: 'pending-owner-legal',
  supportResponseSla: 'pending-owner',
  ageRating: 'pending-app-store-calculation',
  allContentRights: 'pending-owner-confirmation',
  brandEvidenceAttachment: 'pending-signed-owner-declaration',
  exactReleaseCandidate: 'pending-build-and-qa',
  screenshots: 'pending-exact-rc-capture',
  appStoreConnectSave: 'pending-save',
});

const expectedSceneIds = Object.freeze([
  '01-curated-catalog',
  '02-native-recipe-browser',
  '03-healthy-recipes',
  '04-native-visit-checklist',
  '05-clinic-guide',
  '06-saved',
  '07-settings-and-legal',
]);

const excludedNamedScope = /\b(?:Sleep Lab|Service Hub|Health Advisor|AI Cosmetic Scan|Client Resources|Staff Sign In|admin(?:istrative)? panel|panel administrativo)\b/iu;

function read(relativePath) {
  const absolutePath = join(releaseRoot, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`Missing App Store metadata artifact: ${relativePath}`);
    return '';
  }
  return readFileSync(absolutePath, 'utf8');
}

function readProject(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`Missing authoritative project artifact: ${relativePath}`);
    return '';
  }
  return readFileSync(absolutePath, 'utf8');
}

function readJson(relativePath) {
  const source = read(relativePath);
  if (!source) return undefined;
  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${error.message}`);
    return undefined;
  }
}

function readProjectJson(relativePath) {
  const source = readProject(relativePath);
  if (!source) return undefined;
  try {
    return JSON.parse(source);
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

function requireText(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

function hasExactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && equalJson(Object.keys(value).sort(), [...expected].sort());
}

function rejectUnapprovedHostedResourceUrls(source, label) {
  const approvedSlugs = new Set(approvedMiniapps.map((miniapp) => miniapp.slug));
  for (const match of source.matchAll(/https:\/\/cabohealth\.org\/apps\/([a-z0-9-]+)\//gu)) {
    if (!approvedSlugs.has(match[1])) {
      errors.push(`${label} contain an unapproved hosted-resource URL: ${match[0]}`);
    }
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
    'reviewRisk',
    'scope',
    'urls',
    'copyright',
    'appStoreDraft',
    'gates',
  ])) {
    errors.push('Release manifest must contain the exact versioned App Store draft schema');
  }
  if (manifest.schemaVersion !== 1 || manifest.artifactKind !== 'app-store-metadata-candidate') {
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
  if (!equalJson(reviewRisk, expectedReviewRisk)) {
    errors.push('Seller gate must remain a documented medium review risk with the Apple-direction/organization fallback and no approval guarantee');
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
  if (
    scope?.access !== 'public'
    || scope?.accountRequired !== false
    || scope?.demoCredentialRequired !== false
    || scope?.purchases !== false
    || scope?.userGeneratedContent !== false
    || scope?.nativeWebBridge !== false
    || scope?.remoteCatalog !== false
    || !Array.isArray(scope?.sensitivePermissions)
    || scope.sensitivePermissions.length !== 0
  ) {
    errors.push('Release scope access, data, and platform capabilities do not match the exact public MVP');
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
  if (
    dsa?.scope !== 'app-level'
    || dsa?.traderStatus !== 'non-trader/outside-EU-scope'
    || !equalJson(dsa?.releaseTerritories, ['MEX', 'USA'])
    || dsa?.reassessBeforeAddingEuTerritory !== true
    || dsa?.globalAccountState !== 'unchanged'
  ) {
    errors.push('App-level DSA facts must match the Mexico/US-only release, preserve global state, and require EU reassessment');
  }

  const contentRights = appStoreDraft?.contentRights;
  if (!hasExactKeys(contentRights, ['recommendedAnswer', 'usesThirdPartyMaterial', 'status'])) {
    errors.push('Content Rights draft must contain the exact recommendation fields');
  }
  if (
    contentRights?.recommendedAnswer !== 'Yes'
    || contentRights?.usesThirdPartyMaterial !== true
    || contentRights?.status !== 'pending-final-rights-inventory-and-owner-confirmation'
  ) {
    errors.push('Content Rights recommendation must remain Yes for uses third-party material pending final inventory and owner confirmation');
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
  const nullRatings = [...catalogSource.matchAll(/\bappStoreAgeRating:\s*null\b/gu)].length;
  if (
    !equalJson(slugs, approvedMiniapps.map((miniapp) => miniapp.slug))
    || !equalJson(canonicalUrls, approvedMiniapps.map((miniapp) => miniapp.url))
    || nullRatings !== 2
  ) {
    errors.push('Authoritative catalog must contain exactly the two approved slugs/URLs with pending null ratings');
  }

  const compliance = readProjectJson('release/compliance-facts.json');
  if (compliance) {
    if (compliance.legalEntity?.legalSignOffStatus !== 'pending') {
      errors.push('Authoritative legal sign-off status no longer matches this pending metadata draft');
    }
    const pendingGatePaths = [
      ['hosting', 'logTypes'],
      ['hosting', 'retention'],
      ['hosting', 'deletionProcess'],
      ['support', 'responseSla'],
      ['contentRights'],
      ['exportCompliance'],
      ['medicalDevice'],
      ['ageRating', 'host'],
      ['ageRating', 'miniapps', 'healthy-recipes'],
      ['ageRating', 'miniapps', 'clinic-guide'],
    ];
    for (const path of pendingGatePaths) {
      let gate = compliance;
      for (const key of path) gate = gate?.[key];
      if (gate?.status !== 'pending' || gate?.value !== null) {
        errors.push(`Authoritative Task 7 gate no longer matches pending draft: ${path.join('.')}`);
      }
    }
    if (
      compliance.schemaVersion !== 1
      || compliance.brand !== 'Cabo Health'
      || compliance.releaseReady !== false
      || compliance.slice !== 'task-7d-owner-seller'
      || compliance.legalEntity?.name !== 'Ivan Guaderrama'
      || compliance.legalEntity?.nameStatus !== 'owner-confirmed'
      || compliance.legalEntity?.sellerType !== 'individual'
      || compliance.legalEntity?.registeredOrganization !== false
      || compliance.legalEntity?.dunsApplicable !== false
      || compliance.legalEntity?.dunsNumber !== null
    ) {
      errors.push('Authoritative Task 7 root/legal facts do not match this draft');
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
}

function verifyLocalization(locale) {
  const source = read(`${locale}.md`);
  if (!source) return;
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
  const excludedScope = /\b(?:Sleep Lab|Service Hub|Health Advisor|AI Cosmetic Scan|Client Resources|Staff Sign In|admin(?:istrative)? panel|panel administrativo|login|access code|c[oó]digo de acceso|patient records?|expedientes? de pacientes|analytics|anal[ií]tica)\b/iu;
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
  const resourceList = body.match(/GUIDELINE 4\.7 — HOSTED RESOURCES\n([\s\S]*?)\n\nThose are also the only Universal Links\./u)?.[1]?.trim();
  const expectedResourceList = approvedMiniapps
    .map((miniapp, index) => `${index + 1}. ${miniapp.title} — public — ${miniapp.url}`)
    .join('\n');
  if (resourceList !== expectedResourceList) {
    errors.push('Guideline 4.7 resource list must contain exactly the two approved entries');
  }
  if (excludedNamedScope.test(body)) errors.push('Review Notes name excluded release scope');
  if (/(?:password|passcode|secret|api[-_ ]?key|token|contrase[ñn]a|clave|access code|demo code|reviewer code)\s*[:=]\s*\S+/iu.test(body)) {
    errors.push('Review Notes appear to contain a credential');
  }
  for (const miniapp of approvedMiniapps) {
    requireText(body, new RegExp(miniapp.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `Review Notes missing ${miniapp.title}`);
    if (body.split(miniapp.url).length - 1 < 2) {
      errors.push(`Review Notes missing canonical URL/Universal Link for ${miniapp.slug}`);
    }
  }
  for (const [name, url] of Object.entries(expectedUrls)) {
    if (name !== 'marketing' && !body.includes(url)) errors.push(`Review Notes missing ${name} URL`);
  }
  const requiredPatterns = [
    [/CaboHealth 3\.0 \(build 4\)/u, 'Review Notes missing exact version/build'],
    [/exactly two free public general-wellness\/editorial resources/u, 'Review Notes must describe exactly two free public general-wellness/editorial resources'],
    [/This app is submitted by Ivan Guaderrama, an individual Apple Developer Program member\. Cabo Health is a trade brand owned and operated by Ivan Guaderrama and is not represented as a separate legal entity\./u, 'Review Notes missing the individual seller and trade-brand disclosure'],
    [/GUIDELINE 4\.2/u, 'Review Notes missing Guideline 4.2 native value'],
    [/GUIDELINE 4\.7/u, 'Review Notes missing Guideline 4.7 hosted-resource disclosure'],
    [/no account/iu, 'Review Notes missing no-account disclosure'],
    [/demo credential/iu, 'Review Notes missing demo-credential disclosure'],
    [/purchase/iu, 'Review Notes missing monetization disclosure'],
    [/user-generated content/iu, 'Review Notes missing UGC disclosure'],
    [/native message bridge/iu, 'Review Notes missing native-bridge disclosure'],
    [/no server setting can add another resource/iu, 'Review Notes missing immutable-catalog disclosure'],
    [/sensitive permission/iu, 'Review Notes missing permission disclosure'],
    [/\[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS/iu, 'Review Notes must retain the hosting blocker placeholder in this draft'],
  ];
  for (const [pattern, message] of requiredPatterns) requireText(body, pattern, message);
}

function verifyPrivacy() {
  const privacy = readJson('app-privacy.json');
  if (!privacy) return;
  if (
    privacy.status !== 'pending-hosting-retention-and-owner-approval'
    || privacy.recommendedAppPrivacyAnswer !== null
  ) {
    errors.push('App Privacy recommendation must remain conditional until retention and owner approval are resolved');
  }
  if (
    privacy.nativeBehavior?.account !== false
    || privacy.nativeBehavior?.healthInformationRequested !== false
    || privacy.nativeBehavior?.appGeneratedIdentifier !== false
    || privacy.nativeBehavior?.analytics !== false
    || privacy.nativeBehavior?.advertising !== false
    || privacy.nativeBehavior?.tracking !== false
    || !Array.isArray(privacy.nativeBehavior?.sensitivePermissions)
    || privacy.nativeBehavior.sensitivePermissions.length !== 0
  ) {
    errors.push('App Privacy native behavior does not match the exact MVP');
  }
  const logs = privacy.hostedTechnicalRequestLogs;
  if (
    logs?.provider !== 'Hostinger'
    || !Array.isArray(logs.observedFields)
    || logs.observedFields.length === 0
    || logs.retention !== null
    || logs.deletionProcess !== null
    || logs.linkedToIdentity !== null
    || logs.tracking !== false
  ) {
    errors.push('Hosting request-log facts must stay observed-but-unresolved and non-tracking');
  }
  if (
    typeof privacy.conditionalRecommendation?.dataNotCollectedPath !== 'string'
    || typeof privacy.conditionalRecommendation?.dataCollectedPath !== 'string'
  ) {
    errors.push('App Privacy draft must retain both conditional recommendation paths');
  }
  read('app-privacy.md');
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
    socialMediaDisabledUnder13: false,
    messagingOrChat: false,
    advertising: false,
  };
  if (
    !hasExactKeys(age.conditions, expectedConditionKeys)
    || !equalJson(age.otherSupportedAnswers, expectedOtherAnswers)
  ) {
    errors.push('Age-rating condition and supported-answer schemas must be exact');
  }
  if (
    age.status !== 'draft-conditional'
    || age.calculatedRating !== null
    || age.projectedRating !== '9+'
    || age.ownerConfirmationRequired !== true
    || age.appStoreCalculationRequired !== true
  ) {
    errors.push('Age rating must remain a conditional 9+ projection with no calculated value');
  }
  if (age.conditions?.unrestrictedWebAccess?.requiredAnswer !== false) {
    errors.push('9+ projection requires unrestrictedWebAccess=false');
  }
  if (age.conditions?.medicalOrTreatmentInformation?.requiredAnswer !== 'None') {
    errors.push('9+ projection requires medicalOrTreatmentInformation=None');
  }
  if (age.conditions?.healthOrWellnessTopics?.requiredAnswer !== 'Yes') {
    errors.push('9+ projection requires healthOrWellnessTopics=Yes');
  }
  read('age-rating.md');
}

function verifyScreenshots() {
  const screenshots = readJson('screenshots-manifest.json');
  if (!screenshots) return;
  if (
    screenshots.status !== 'pending-exact-rc-capture'
    || screenshots.marketingVersion !== '3.0'
    || screenshots.buildNumber !== '4'
    || screenshots.deviceClass !== 'iPhone 6.9-inch'
  ) {
    errors.push('Screenshot manifest must target 3.0 build 4 on the 6.9-inch iPhone class');
  }
  if (!equalJson(screenshots.locales, ['en-US', 'es-MX'])) errors.push('Screenshot locales must be exactly en-US and es-MX');
  if (!equalJson(screenshots.sceneIds, expectedSceneIds)) errors.push('Screenshot storyboard must contain the exact seven approved scenes');
  if (!Array.isArray(screenshots.captures) || screenshots.captures.length !== 0) {
    errors.push('Screenshot captures must remain empty before exact-RC capture');
  }
  if (Object.values(screenshots.requiredEvidence ?? {}).some((value) => value !== null)) {
    errors.push('Screenshot evidence must remain null before exact-RC capture');
  }
  read('screenshots/storyboard.md');
}

function verifyHumanChecklists() {
  const required = [
    'testflight-what-to-test.md',
    'accessibility-nutrition-label-evidence.md',
    'content-rights-and-brand.md',
    'unsigned-ownership-declaration.md',
    'declarations.md',
    'submission-gates.md',
  ];
  for (const file of required) {
    const source = read(file);
    if (/\[[xX]\]/u.test(source)) errors.push(`${file} contains an unsupported completed evidence checkbox`);
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
  requireText(gates, /medium review risk/iu, 'Seller gate must document medium review risk');
  requireText(gates, /does not resolve or guarantee Apple approval/iu, 'Seller gate must not claim the wellness scope guarantees approval');
  requireText(gates, /written Apple direction or later migrate to a registered organization/iu, 'Seller gate missing the required fallback');
  requireText(gates, /blocked/iu, 'Submission gates must remain blocked');
}

verifyManifest();
verifyAuthoritativeProjectState();
verifyLocalization('en-US');
verifyLocalization('es-MX');
verifyReviewNotes();
verifyPrivacy();
verifyAgeRating();
verifyScreenshots();
verifyHumanChecklists();

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('App Store metadata draft verified; submission remains blocked.\n');
}
