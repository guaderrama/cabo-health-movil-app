import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  captureReleaseV3,
  inspectReleasePhaseTruth,
  privacyAuthorityForSemanticValidation,
} from '../scripts/verify-release-v3.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const verifierPath = join(projectRoot, 'scripts/verify-release-v3.mjs');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const pendingReviewNotesWrapper = '# App Review Notes — CaboHealth 3.0 (build 14)\n\nFreeze role: **PHASE-CONTROLLED PENDING FORM — DO NOT PASTE YET.** This wrapper is the exact pending baseline for pre-input/input and the pre-finalization artifact phase. The final two-file metadata transition removes this wrapper and the heading below without changing one byte of the build-14 body. Final live completion comes only from the RC-bound App Store Connect evidence and `reviewNotesSha256`, never from this pending wording.\n\n## Paste-ready body after all gates are resolved\n\n';

function pendingPrivacyBytes(authorityBytes) {
  const privacy = JSON.parse(authorityBytes.toString('utf8'));
  const form = Object.hasOwn(privacy, 'finalAppleDisclosure') ? 'final' : 'pending';
  return Buffer.from(`${JSON.stringify(privacyAuthorityForSemanticValidation(privacy, form), null, 2)}\n`);
}

function reviewNotesBodyFromBytes(authorityBytes) {
  const source = authorityBytes.toString('utf8');
  const marker = '## Paste-ready body after all gates are resolved\n\n';
  const body = (source.includes(marker) ? source.split(marker)[1] : source).replace(/\n+$/u, '');
  assert.equal([...body].length, 4000, 'Review Notes authority must retain the exact 4,000-character body');
  return body;
}

function pendingReviewNotesBytes(authorityBytes) {
  return Buffer.from(`${pendingReviewNotesWrapper}${reviewNotesBodyFromBytes(authorityBytes)}\n`);
}

function pendingScreenshotsBytes(authorityBytes) {
  const screenshots = JSON.parse(authorityBytes.toString('utf8'));
  screenshots.status = 'pending-exact-rc-capture';
  screenshots.captures = [];
  screenshots.requiredEvidence = {
    testFlightBuildId: null,
    sourceSha: null,
    imageHashes: null,
    ocrExcludedScopeCheck: null,
    humanVisualSignOff: null,
  };
  return Buffer.from(`${JSON.stringify(screenshots, null, 2)}\n`);
}

function currentSemanticPrivacyAuthority() {
  const files = captureReleaseV3(projectRoot);
  const phaseTruth = inspectReleasePhaseTruth(files);
  const privacy = JSON.parse(files.get('release/app-store/3.0/app-privacy.json').toString('utf8'));
  return privacyAuthorityForSemanticValidation(privacy, phaseTruth.metadataForm);
}

function withGuardPin(source, name, value) {
  const declaration = new RegExp(`^const ${name} = [^\r\n]*;$`, 'mu');
  assert.match(source, declaration, `${name} fixture must target one declaration`);
  return source.replace(declaration, `const ${name} = ${value};`);
}

function finalizedPrivacyBytes(pendingBytes) {
  const privacy = JSON.parse(pendingBytes.toString('utf8'));
  privacy.status = 'final-apple-disclosure-mapped';
  privacy.architectureStatus = 'production-architecture-reconciled-for-final-apple-mapping';
  privacy.clientAccount.status = 'final-apple-linkage-mapped';
  privacy.thirdPartyNetworkRequests.finalAppleMappingStatus = 'independent-destination-processing-disclosed-separately';
  privacy.cloudRunRequestLogs.linkedToIdentity = true;
  privacy.reviewSandbox.status = 'included-in-final-apple-disclosure-mapping';
  privacy.hostedTechnicalRequestLogs.linkedToIdentity = true;
  delete privacy.conditionalRecommendation;
  privacy.finalAppleDisclosure = {
    collectionAnswer: 'Yes, we collect data from this app',
    tracking: false,
    dataUsedForTracking: [],
    linkedData: [
      { dataType: 'User ID', purposes: ['App Functionality'], tracking: false },
      { dataType: 'Device ID', purposes: ['App Functionality'], tracking: false },
      { dataType: 'Product Interaction', purposes: ['App Functionality'], tracking: false },
      { dataType: 'Coarse Location', purposes: ['App Functionality'], tracking: false },
      { dataType: 'Performance Data', purposes: ['App Functionality'], tracking: false },
      { dataType: 'Other Diagnostic Data', purposes: ['App Functionality', 'Analytics'], tracking: false },
    ],
    sourceSpecificFacts: [
      {
        dataType: 'Other Diagnostic Data',
        purposes: ['Analytics'],
        source: 'FirebaseAuth signed privacy manifest',
        linkage: 'not linked',
        appLevelAnswer: 'linked',
        tracking: false,
      },
    ],
  };
  return Buffer.from(`${JSON.stringify(privacy, null, 2)}\n`);
}

function finalizedReviewNotesBytes(pendingBytes) {
  return Buffer.from(`${reviewNotesBodyFromBytes(pendingBytes)}\n`);
}

function finalizedScreenshotsBytes(pendingBytes) {
  const screenshots = JSON.parse(pendingBytes.toString('utf8'));
  screenshots.status = 'exact-rc-captured-and-approved';
  const testFlightBuildId = '987654321';
  const sourceSha = 'a'.repeat(64);
  screenshots.captures = screenshots.locales.flatMap((locale) => (
    screenshots.sceneIds.map((sceneId) => ({
      locale,
      sceneId,
      relativePath: `screenshots/${locale}/iphone-6.9/${sceneId}.png`,
      sha256: sha256(Buffer.from(`${locale}:${sceneId}`)),
      width: 1320,
      height: 2868,
      format: 'png',
      capturedAt: '2026-08-25T17:00:00.000Z',
      testFlightBuildId,
    }))
  ));
  screenshots.requiredEvidence = {
    testFlightBuildId,
    sourceSha,
    imageHashes: screenshots.captures.map((capture) => capture.sha256),
    ocrExcludedScopeCheck: true,
    humanVisualSignOff: true,
  };
  return Buffer.from(`${JSON.stringify(screenshots, null, 2)}\n`);
}

function phaseFiles(baseFiles, phase, {
  metadata = 'pending',
  screenshots = ['rc', 'submit-tool'].includes(phase) ? 'final' : 'pending',
  rcMetadataBindings = 'current',
} = {}) {
  const files = new Map(baseFiles);
  const privacyPath = 'release/app-store/3.0/app-privacy.json';
  const notesPath = 'release/app-store/3.0/review-notes.md';
  const screenshotsPath = 'release/app-store/3.0/screenshots-manifest.json';
  files.set(privacyPath, pendingPrivacyBytes(files.get(privacyPath)));
  files.set(notesPath, pendingReviewNotesBytes(files.get(notesPath)));
  files.set(screenshotsPath, pendingScreenshotsBytes(files.get(screenshotsPath)));
  for (const path of [
    'release/app-store/3.0/build-input-attestation.json',
    'release/app-store/3.0/build-artifact-attestation.json',
    'release/app-store/3.0/rc-attestation.json',
  ]) files.delete(path);
  let guard = files.get('scripts/release-command-guard.mjs').toString('utf8');
  for (const name of [
    'BUILD_INPUT_ATTESTATION_SHA256',
    'BUILD_ARTIFACT_ATTESTATION_SHA256',
    'RC_ATTESTATION_SHA256',
    'PINNED_EAS_CLI',
    'PINNED_APP_STORE_SUBMIT_ADAPTER',
  ]) guard = withGuardPin(guard, name, 'null');
  const input = Buffer.from('{"phase":"input"}\n');
  const artifact = Buffer.from('{"phase":"artifact","sourceTreeSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n');
  if (metadata === 'final' || metadata === 'mixed-privacy') {
    files.set(privacyPath, finalizedPrivacyBytes(files.get(privacyPath)));
  }
  if (metadata === 'final' || metadata === 'mixed-notes') {
    files.set(notesPath, finalizedReviewNotesBytes(files.get(notesPath)));
  }
  if (screenshots === 'final') {
    files.set(screenshotsPath, finalizedScreenshotsBytes(files.get(screenshotsPath)));
  }
  if (phase !== 'pre-input') {
    guard = withGuardPin(guard, 'BUILD_INPUT_ATTESTATION_SHA256', `'${sha256(input)}'`);
    files.set('release/app-store/3.0/build-input-attestation.json', input);
  }
  if (['artifact', 'rc', 'submit-tool'].includes(phase)) {
    guard = withGuardPin(guard, 'BUILD_ARTIFACT_ATTESTATION_SHA256', `'${sha256(artifact)}'`);
    files.set('release/app-store/3.0/build-artifact-attestation.json', artifact);
  }
  if (['rc', 'submit-tool'].includes(phase)) {
    const currentPrivacySha256 = sha256(files.get(privacyPath));
    const currentNotesSha256 = sha256(files.get(notesPath));
    const rc = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      artifactKind: 'cabohealth-ios-exact-rc-attestation',
      sourceTreeSha256: 'a'.repeat(64),
      testFlightBuildId: '987654321',
      testFlightProcessedAt: '2026-08-25T16:00:00.000Z',
      screenshotsManifestSha256: sha256(files.get(screenshotsPath)),
      appPrivacySha256: rcMetadataBindings === 'current' ? currentPrivacySha256 : 'b'.repeat(64),
      reviewNotesSha256: rcMetadataBindings === 'current' ? currentNotesSha256 : 'c'.repeat(64),
    })}\n`);
    guard = withGuardPin(guard, 'RC_ATTESTATION_SHA256', `'${sha256(rc)}'`);
    files.set('release/app-store/3.0/rc-attestation.json', rc);
  }
  if (phase === 'submit-tool') {
    guard = withGuardPin(guard, 'PINNED_APP_STORE_SUBMIT_ADAPTER', "'QQ=='");
  }
  files.set('scripts/release-command-guard.mjs', Buffer.from(guard));
  return files;
}

function runVerifier(root = projectRoot) {
  return spawnSync(process.execPath, [verifierPath, root], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-release-v3-'));
  for (const path of [
    'app',
    'components',
    'constants',
    'context',
    'features',
    'release',
    'scripts',
    'web-hosting',
  ]) {
    cpSync(join(projectRoot, path), join(root, path), { recursive: true });
  }
  for (const path of ['app.json', 'eas.json', 'package.json', 'firebase.json', 'firestore.rules']) {
    cpSync(join(projectRoot, path), join(root, path));
  }
  const pendingFiles = phaseFiles(captureReleaseV3(root), 'pre-input');
  for (const [relativePath, bytes] of pendingFiles) {
    writeFileSync(join(root, relativePath), bytes);
  }
  for (const relativePath of [
    'release/app-store/3.0/build-input-attestation.json',
    'release/app-store/3.0/build-artifact-attestation.json',
    'release/app-store/3.0/rc-attestation.json',
  ]) rmSync(join(root, relativePath), { force: true });
  return root;
}

function mutateJson(root, relativePath, mutate) {
  const path = join(root, relativePath);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function withFixture(mutate, assertion) {
  const root = makeFixture();
  try {
    mutate(root);
    assertion(runVerifier(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('release v3 verifier accepts the phase-neutral 3.0/build 14 authority package', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Release 3\.0\/build 14 verified: phase-neutral authority sequence configured\./u);
});

test('captured release verifier enforces the exact phase-aware metadata transition tuple', async () => {
  const { captureReleaseV3, verifyCapturedReleaseV3 } = await import('../scripts/verify-release-v3.mjs');
  const baseline = captureReleaseV3(projectRoot);
  baseline.set(
    'release/app-store/3.0/review-notes.md',
    readFileSync(join(projectRoot, 'release/app-store/3.0/review-notes.md')),
  );

  for (const phase of ['pre-input', 'input']) {
    assert.deepEqual(
      verifyCapturedReleaseV3(phaseFiles(baseline, phase)),
      [],
      `${phase} must accept the exact pending metadata baseline`,
    );
    assert.match(
      verifyCapturedReleaseV3(phaseFiles(baseline, phase, { metadata: 'final' })).join('\n'),
      /pre-input and input phases require the exact pending metadata baseline/iu,
    );
  }

  assert.deepEqual(
    verifyCapturedReleaseV3(phaseFiles(baseline, 'artifact')),
    [],
    'artifact phase must accept pending screenshots with the pending metadata pair',
  );
  assert.deepEqual(
    verifyCapturedReleaseV3(phaseFiles(baseline, 'artifact', { screenshots: 'final' })),
    [],
    'artifact phase must accept final screenshots with the pending metadata pair',
  );
  assert.deepEqual(
    verifyCapturedReleaseV3(phaseFiles(baseline, 'artifact', {
      screenshots: 'final',
      metadata: 'final',
    })),
    [],
    'artifact phase must accept final screenshots with the exact final metadata pair',
  );
  assert.match(
    verifyCapturedReleaseV3(phaseFiles(baseline, 'artifact', { metadata: 'final' })).join('\n'),
    /finalized metadata requires the exact finalized screenshot authority/iu,
  );
  for (const metadata of ['mixed-privacy', 'mixed-notes']) {
    assert.match(
      verifyCapturedReleaseV3(phaseFiles(baseline, 'artifact', {
        screenshots: 'final',
        metadata,
      })).join('\n'),
      /App Privacy and Review Notes must transition as one exact pair/iu,
    );
  }

  assert.match(
    verifyCapturedReleaseV3(phaseFiles(baseline, 'rc')).join('\n'),
    /RC and submit-tool phases require the exact finalized metadata pair/iu,
  );
  for (const phase of ['rc', 'submit-tool']) {
    assert.deepEqual(
      verifyCapturedReleaseV3(phaseFiles(baseline, phase, { metadata: 'final' })),
      [],
      `${phase} must accept finalized metadata bound by the RC`,
    );
  }
  assert.match(
    verifyCapturedReleaseV3(phaseFiles(baseline, 'rc', {
      metadata: 'final',
      rcMetadataBindings: 'stale',
    })).join('\n'),
    /RC metadata hashes must bind the exact finalized App Privacy and Review Notes bytes/iu,
  );
});

test('captured release verifier derives phases only from contiguous pins and matching attestation bytes', async () => {
  const { captureReleaseV3, verifyCapturedReleaseV3 } = await import('../scripts/verify-release-v3.mjs');
  const baseline = captureReleaseV3(projectRoot);
  baseline.set(
    'release/app-store/3.0/review-notes.md',
    readFileSync(join(projectRoot, 'release/app-store/3.0/review-notes.md')),
  );
  const files = phaseFiles(baseline, 'input');
  files.delete('release/app-store/3.0/build-input-attestation.json');
  assert.match(
    verifyCapturedReleaseV3(files).join('\n'),
    /input pin requires matching current build-input attestation bytes/iu,
  );
});

test('release v3 verifier rejects a non-array ASC build list without throwing', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.ascEvidence.testFlightBuilds = {};
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.doesNotMatch(result.stderr, /TypeError|RELEASE_V3_INTERNAL_ERROR/u);
      assert.match(result.stderr, /release manifest must retain the exact (?:authority )?schema/iu);
    },
  );
});

test('release v3 capture rejects a symbolic link for every pinned authority', async (t) => {
  for (const relativePath of [
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
  ]) {
    await t.test(relativePath, () => withFixture(
      (root) => {
        const authority = join(root, relativePath);
        const target = join(root, `authority-${relativePath.replaceAll('/', '-')}`);
        cpSync(authority, target);
        unlinkSync(authority);
        symlinkSync(target, authority);
      },
      (result) => {
        assert.equal(result.status, 1, `${relativePath} symlink bypassed capture`);
        assert.match(result.stderr, /must be a regular non-symbolic-link file/iu);
      },
    ));
  }
});

test('release v3 authorities record the complete age, sanitized audit, and App Review contracts', () => {
  const age = JSON.parse(readFileSync(join(projectRoot, 'release/app-store/3.0/age-rating.json'), 'utf8'));
  const privacy = currentSemanticPrivacyAuthority();
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'release/app-store/3.0/release-manifest.json'), 'utf8'));

  assert.equal(privacy.schemaVersion, 6);
  assert.equal(privacy.recommendedAppPrivacyAnswer, 'Yes, we collect data from this app');
  assert.equal(age.conditions.unrestrictedWebAccess.requiredAnswer, true);
  assert.equal(age.projectedRating, '16+');
  assert.equal(age.legacyOperatingSystemsRating, '17+');
  assert.equal(privacy.backend.resourceUrlsReturnedToNative, true);
  assert.deepEqual(privacy.resourceUrlHandling, {
    publicV3CatalogRecordsContainExternalUrl: true,
    authorizedVipV2LaunchMayReturnExternalUrlTransiently: true,
    vipPreviewsContainExternalUrl: false,
    vipGrantsContainExternalUrl: false,
    nativeStorageContainsExternalUrl: false,
    applicationAuditContainsExternalUrl: false,
  });
  assert.deepEqual(privacy.thirdPartyNetworkRequests, {
    behavior: 'third-party-network-request',
    destinationHostReceivesNormalNetworkData: true,
    destinationOperatesIndependently: true,
    finalAppleMappingStatus: 'pending-final-destination-provider-and-category-review',
  });
  assert.deepEqual(manifest.scope.externalHttpsMiniapps, {
    ownerManaged: true,
    accessModes: ['public', 'vip'],
    opensInsideApp: true,
    sameOriginNavigationOnly: true,
    vipControlsInAppEntryOnly: true,
    thirdPartyContentAuthoredByCaboHealth: false,
    thirdPartyContentMadePrivateByCaboHealth: false,
    rightsVerificationRequiredBeforeActivation: true,
    permanentCatalogItemsListedInReleaseMetadata: false,
  });
  assert.deepEqual(age.otherSupportedAnswers, {
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
  });
  assert.deepEqual(privacy.applicationAudit, {
    purpose: 'security and operational accountability',
    deletionDeadlineDays: 30,
    physicalTtlDeletionAsynchronous: true,
    actorLabel: 'Staff',
    containsActorUid: false,
    containsCodes: false,
    containsResourceUrls: false,
    containsClientNames: false,
  });
  assert.deepEqual(privacy.deletion, {
    durable: true,
    mechanism: 'transactional deletion tombstone plus idempotent retry worker',
    activeUserPath: 'Home > Client Resources > Delete access account and data',
    responseStatuses: ['pending', 'completed'],
    authorizationRevokedWhenAccepted: true,
    grantExpiryQueuesDeletion: true,
    administratorRevocationQueuesDeletion: true,
    retryWorkerMinutes: 5,
    completionTimeGuaranteed: false,
  });
  assert.deepEqual(privacy.deletionReceiptStatus, {
    receiptEntropyBits: 256,
    receiptEncoding: 'base64url',
    receiptEncodedLength: 43,
    nativeStorage: 'SecureStore',
    localStates: ['prepared', 'accepted'],
    preparedBeforeDeletionRequest: true,
    deleteRequestFields: ['installationId', 'deletionReceipt'],
    productionStatusCallable: 'getClientAccountDeletionStatus',
    reviewStatusCallable: 'getAppReviewAccountDeletionStatus',
    statusRequestFields: ['deletionReceipt'],
    statusResponse: {
      schemaVersion: 1,
      exactFields: [
        'schemaVersion',
        'status',
        'requestedAtMs',
        'expectedCompletionByMs',
        'completedAtMs',
      ],
      statuses: ['pending', 'completed'],
      pendingCompletedAtMs: null,
      timestampsAreIntegers: true,
    },
    limitedUseAppCheckRequired: true,
    firebaseAuthenticationRequired: false,
    rawReceiptStoredServerSide: false,
    serverLookupRepresentation: 'versioned keyed HMAC lookup only',
    productionCollection: '_private_account_deletion_receipts',
    reviewCollection: 'review_sandbox_account_deletion_receipts',
    separateRealmPeppers: true,
    statusRecordContainsUid: false,
    statusRecordContainsCode: false,
    statusRecordContainsResourceUrl: false,
    expectedCompletionDays: 30,
    expectedCompletionGuaranteed: false,
    retryWorkerMinutes: 5,
    pendingHasTtl: false,
    pendingRetention: 'until cleanup completes',
    completedRecordContainsOnlyStatusTimestamps: true,
    completedRetentionDays: 30,
    completedRetentionStartsAt: 'completedAtMs',
    completedPhysicalTtlDeletionAsynchronous: true,
    checksOnClientResourcesReopen: true,
    completionConfirmationInApp: true,
    localReceiptClearedAfterCompletedAcknowledgement: true,
    preparedNotFoundClearsReceipt: false,
    preparedNotFoundRestoresAccess: false,
    preparedNotFoundResubmitsSameReceipt: true,
    acceptedNotFoundRestoresAccess: false,
  });
  assert.deepEqual(privacy.reviewSandbox, {
    separateNamespace: true,
    multiDevice: true,
    fixedNonClientSample: true,
    productionClientRecordsExposed: false,
    userInitiatedDeletion: true,
    activeUserPath: 'Home > Client Resources > Delete review access and data',
    responseStatuses: ['pending', 'completed'],
    authorizationRevokedWhenAccepted: true,
    currentIdentityInactivityEligibilityDays: 30,
    staleGenerationEligibility: 'immediate',
    retryWorkerMinutes: 5,
    completionTimeGuaranteed: false,
    status: 'infrastructure-deployed-pending-credential-valid-flow-and-device-e2e',
  });
  assert.deepEqual(privacy.cloudFunctionRequestSecurity, {
    rawSourceIpProcessedTransiently: true,
    rawSourceIpStoredInFirestore: false,
    providerRequestLoggingDocumentedSeparately: true,
    storedRateLimitRepresentation: 'versioned keyed HMAC lookup only',
    purpose: ['rate limiting', 'abuse prevention'],
    rateLimitBucketDeletionDeadlineMinutes: 30,
    physicalTtlDeletionAsynchronous: true,
    tracking: false,
  });
  assert.deepEqual(privacy.cloudRunRequestLogs, {
    provider: 'Google Cloud Logging',
    automatic: true,
    observedFields: [
      'source IP address',
      'HTTP method',
      'requested URL',
      'user-agent',
      'HTTP status',
      'latency',
      'request and response sizes',
      'protocol',
    ],
    purpose: ['service delivery', 'security and troubleshooting'],
    retentionDays: 30,
    defaultSinkExclusionConfigured: false,
    deletionProcess: 'Google Cloud Logging applies the unlocked _Default bucket retention; expiration is provider-enforced and may be eventually consistent.',
    linkedToIdentity: null,
    tracking: false,
    verifiedDate: '2026-08-24',
  });
  assert.deepEqual(privacy.accessArtifacts, {
    redemptionRequestDigestDeadlineMinutes: 5,
    launchNonceDeadlineSeconds: 60,
    webSessionMaximumMinutes: 60,
    brokerReplayDigestDeadlineMinutes: 2,
    deletionTombstoneHasTtl: false,
    deletionTombstoneRetention: 'until linked-data and Firebase Auth cleanup completes',
    containsPlaintextSecrets: false,
  });
  assert.deepEqual(privacy.conditionalRecommendation.provisionalCategoryMapping, [
    'User ID — linked to the user; App Functionality; not used for tracking (exact signed FirebaseAuth privacy manifest)',
    'Other Diagnostic Data — not linked to the user; Analytics; not used for tracking (exact signed FirebaseAuth privacy manifest)',
    'Device ID, if the app-installation identifier is retained off device and disclosure is required',
    'Coarse Location, Device ID, or Other Diagnostic Data as required by Apple\'s final mapping of retained IP addresses',
    'Product Interaction, if retained requested-resource activity is in disclosure scope',
    'Performance Data, if retained latency or response-byte measurements are in disclosure scope',
    'Other Diagnostic Data, if retained HTTP method, user-agent, or technical-error records are in disclosure scope',
    'Other Data Types, only if a retained field cannot be accurately mapped to another Apple data type',
  ]);
  assert.deepEqual(
    privacy.conditionalRecommendation.provisionalPurpose,
    ['App Functionality', 'Analytics'],
  );
  assert.deepEqual(manifest.reviewCredential, {
    namespace: 'review_sandbox',
    purpose: 'app_review',
    credentialPrefix: 'AR',
    uidRealm: 'review_*',
    multiDevice: true,
    credentialInRepository: false,
    status: 'pending-activation',
    fixedReviewedResourceId: 'review-sandbox-app-review-sample-v1',
    launchMethod: 'POST',
    launchPath: '/apps/app-review/launch/',
  });
});

test('release v3 verifier rejects every non-object JSON authority', async (t) => {
  const authorities = [
    'eas.json',
    'release/app-store/3.0/release-manifest.json',
    'release/app-store/3.0/age-rating.json',
    'release/app-store/3.0/app-privacy.json',
  ];
  const scalars = ['null', 'false', '0', '[]', '"text"'];
  for (const relativePath of authorities) {
    for (const source of scalars) {
      await t.test(`${relativePath}=${source}`, () => withFixture(
        (root) => writeFileSync(join(root, relativePath), `${source}\n`),
        (result) => {
          assert.equal(result.status, 1, `${relativePath}=${source} bypassed authority validation`);
          assert.match(result.stderr, /must be a JSON object/iu);
        },
      ));
    }
  }
});

test('release v3 verifier rejects rollback from the ASC-confirmed native version authorities', () => {
  withFixture(
    (root) => mutateJson(root, 'app.json', (app) => {
      app.expo.version = '2.0.0';
      app.expo.ios.buildNumber = '3';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /app\.json must remain 3\.0\/build 14/iu);
    },
  );
});

test('release v3 verifier rejects non-version app config drift before RC', () => {
  withFixture(
    (root) => mutateJson(root, 'app.json', (app) => {
      app.expo.ios.associatedDomains.push('applinks:unreviewed.example');
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /app\.json must retain the exact reviewed pre-build bytes/iu);
    },
  );
});

test('release v3 verifier rejects drift in the exact EAS production environment', async (t) => {
  for (const [name, mutate] of [
    ['environment', (profile) => { profile.environment = 'preview'; }],
    ['node', (profile) => { profile.node = '20.19.4'; }],
    ['app environment', (profile) => { profile.env.APP_ENV = 'staging'; }],
  ]) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'eas.json', (eas) => mutate(eas.build.production)),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed EAS production validation`);
        assert.match(result.stderr, /eas\.json (?:must retain the exact reviewed production-build bytes|production must pin)/iu);
      },
    ));
  }
});

test('release v3 verifier rejects executable config drift hidden behind stale comments', () => {
  withFixture(
    (root) => {
      const path = join(root, 'constants/config.ts');
      const source = readFileSync(path, 'utf8')
        .replace("version: '3.0',", "version: '3.0.0',")
        .replace("buildNumber: '14',", "buildNumber: '15',");
      writeFileSync(
        path,
        `${source}\n// Stale reviewed values: version: '3.0'; buildNumber: '14'\n`,
      );
    },
    (result) => {
      assert.equal(result.status, 1, `stale comments bypassed config authority:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /constants\/config\.ts.*exact reviewed bytes/iu);
    },
  );
});

test('release v3 verifier rejects executable catalog drift hidden from slug-only checks', async (t) => {
  const mutations = [
    ['allowed path widened', (source) => source
      .replace('allowedPathPrefix: `/apps/${PublicMiniappSlug}/`;', 'allowedPathPrefix: string;')
      .replace("allowedPathPrefix: '/apps/healthy-recipes/',", "allowedPathPrefix: '/',")],
    ['permission and purchase enabled', (source) => source
      .replace('permissions: [];', 'permissions: string[];')
      .replace('hasPurchases: false;', 'hasPurchases: boolean;')
      .replace(
        'permissions: [],\n    hasUserGeneratedContent: false,\n    hasPurchases: false,',
        "permissions: ['camera'],\n    hasUserGeneratedContent: false,\n    hasPurchases: true,",
      )],
    ['third slug hidden behind stale comment', (source) => source.replace(
      "export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const;",
      "// PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const\nexport const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide', 'third-public'] as const;",
    )],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => {
        const path = join(root, 'constants/publicMiniapps.ts');
        writeFileSync(path, mutate(readFileSync(path, 'utf8')));
      },
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed catalog authority:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /constants\/publicMiniapps\.ts.*exact reviewed bytes/iu);
      },
    ));
  }
});

test('release v3 verifier fixes two public miniapps plus one protected client resource', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.scope.publicMiniapps.push({
        slug: 'third-public',
        title: 'Third',
        canonicalUrl: 'https://cabohealth.org/apps/third-public/',
        universalLink: 'https://cabohealth.org/apps/third-public/',
      });
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /exactly two public miniapps/iu);
    },
  );
});

test('release v3 verifier rejects protected-resource title or authority drift', async (t) => {
  const mutations = [
    ['title', (resource) => { resource.title = 'Paid Premium Area'; }],
    ['arbitrary links', (resource) => { resource.arbitraryExternalLinksPublished = true; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
        mutate(manifest.scope.protectedResources[0]);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed protected-resource authority`);
        assert.match(result.stderr, /one server-protected Client Resources surface/iu);
      },
    ));
  }
});

test('release v3 verifier rejects commerce, pricing, checkout, IAP, purchase CTAs, and digital tiers', async (t) => {
  const mutations = [
    ['sale', (model) => { model.sale = true; }],
    ['price', (model) => { model.price = '$9.99'; }],
    ['checkout', (model) => { model.checkout = true; }],
    ['iap', (model) => { model.inAppPurchase = true; }],
    ['cta', (model) => { model.purchaseCta = 'Buy now'; }],
    ['tier', (model) => { model.digitalTier = 'premium'; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
        mutate(manifest.scope.commercialModel);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /commercial model must remain complimentary/iu);
      },
    ));
  }
});

test('release v3 verifier requires owner-issued individual access without a fixed business-count limit', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.scope.commercialModel.maximumActiveClientCodes = 4;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /maximumActiveClientCodes must remain null/iu);
    },
  );
});

test('release v3 verifier requires isolated pending multi-device App Review access', async (t) => {
  const mutations = [
    ['production namespace', (credential) => { credential.namespace = 'production_client'; }],
    ['production credential prefix', (credential) => { credential.credentialPrefix = 'CH'; }],
    ['production UID realm', (credential) => { credential.uidRealm = 'client_*'; }],
    ['single device', (credential) => { credential.multiDevice = false; }],
    ['real credential committed', (credential) => { credential.credentialInRepository = true; }],
    ['premature readiness', (credential) => { credential.status = 'ready'; }],
    ['mutable resource', (credential) => { credential.fixedReviewedResourceId = null; }],
    ['GET launch', (credential) => { credential.launchMethod = 'GET'; }],
    ['production launch path', (credential) => { credential.launchPath = '/apps/client-resources/launch/'; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
        mutate(manifest.reviewCredential);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /App Review credential must remain isolated.*pending-activation/iu);
      },
    ));
  }
});

test('release v3 verifier requires 16+/legacy 17+ reconfirmation rather than reusing the historical saved result', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/age-rating.json', (age) => {
      age.status = 'saved-app-store-calculated';
      age.calculatedRating = '9+';
      age.ownerConfirmationRequired = false;
      age.appStoreCalculationRequired = false;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Age rating must remain projected 16\+ with legacy 17\+, owner reconfirmation, and App Store recalculation required/iu);
    },
  );
});

test('release v3 verifier requires pseudonymous Firebase, SecureStore, App Check, durable deletion, and an asynchronous 30-day audit deadline', async (t) => {
  const mutations = [
    ['identified account', (privacy) => { privacy.clientAccount.pseudonymous = false; }],
    ['plain installation', (privacy) => { privacy.installation.storage = 'AsyncStorage'; }],
    ['App Check off', (privacy) => { privacy.appCheck.required = false; }],
    ['non-durable deletion', (privacy) => { privacy.deletion.durable = false; }],
    ['wrong audit deadline', (privacy) => { privacy.applicationAudit.deletionDeadlineDays = 31; }],
    ['variable audit actor', (privacy) => { privacy.applicationAudit.actorLabel = 'Admin Name'; }],
    ['audit actor UID', (privacy) => { privacy.applicationAudit.containsActorUid = true; }],
    ['missing signed FirebaseAuth Analytics purpose', (privacy) => { privacy.conditionalRecommendation.provisionalPurpose = ['App Functionality']; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/app-privacy.json', mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /privacy architecture must retain/iu);
      },
    ));
  }
});

test('release v3 verifier requires the exact production account-deletion contract', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/app-privacy.json', (privacy) => {
      privacy.deletion.responseStatuses = ['completed'];
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /privacy architecture must retain/iu);
    },
  );
});

test('captured release verifier rejects every structured App Privacy lifecycle drift', async (t) => {
  const { captureReleaseV3, verifyCapturedReleaseV3 } = await import('../scripts/verify-release-v3.mjs');
  const baseFiles = phaseFiles(captureReleaseV3(projectRoot), 'pre-input');
  const mutations = [
    ['schema version', (privacy) => { privacy.schemaVersion = 3; }],
    ['production deletion mechanism', (privacy) => { privacy.deletion.mechanism = 'best effort'; }],
    ['production deletion path', (privacy) => { privacy.deletion.activeUserPath = 'Settings'; }],
    ['production deletion response', (privacy) => { privacy.deletion.responseStatuses = ['completed']; }],
    ['production deletion authorization timing', (privacy) => { privacy.deletion.authorizationRevokedWhenAccepted = false; }],
    ['production expiry enqueue', (privacy) => { privacy.deletion.grantExpiryQueuesDeletion = false; }],
    ['production admin-revocation enqueue', (privacy) => { privacy.deletion.administratorRevocationQueuesDeletion = false; }],
    ['production retry worker', (privacy) => { privacy.deletion.retryWorkerMinutes = 10; }],
    ['production completion guarantee', (privacy) => { privacy.deletion.completionTimeGuaranteed = true; }],
    ['receipt entropy', (privacy) => { privacy.deletionReceiptStatus.receiptEntropyBits = 128; }],
    ['receipt encoding', (privacy) => { privacy.deletionReceiptStatus.receiptEncoding = 'hex'; }],
    ['receipt encoded length', (privacy) => { privacy.deletionReceiptStatus.receiptEncodedLength = 42; }],
    ['receipt native storage', (privacy) => { privacy.deletionReceiptStatus.nativeStorage = 'AsyncStorage'; }],
    ['receipt local states', (privacy) => { privacy.deletionReceiptStatus.localStates = ['accepted']; }],
    ['receipt prepared timing', (privacy) => { privacy.deletionReceiptStatus.preparedBeforeDeletionRequest = false; }],
    ['receipt delete request', (privacy) => { privacy.deletionReceiptStatus.deleteRequestFields = ['deletionReceipt']; }],
    ['production status callable', (privacy) => { privacy.deletionReceiptStatus.productionStatusCallable = 'unknown'; }],
    ['review status callable', (privacy) => { privacy.deletionReceiptStatus.reviewStatusCallable = 'unknown'; }],
    ['status request fields', (privacy) => { privacy.deletionReceiptStatus.statusRequestFields = ['uid']; }],
    ['status response schema', (privacy) => { privacy.deletionReceiptStatus.statusResponse.schemaVersion = 2; }],
    ['status response fields', (privacy) => { privacy.deletionReceiptStatus.statusResponse.exactFields = ['status']; }],
    ['status response statuses', (privacy) => { privacy.deletionReceiptStatus.statusResponse.statuses = ['completed']; }],
    ['pending completion timestamp', (privacy) => { privacy.deletionReceiptStatus.statusResponse.pendingCompletedAtMs = 0; }],
    ['timestamp types', (privacy) => { privacy.deletionReceiptStatus.statusResponse.timestampsAreIntegers = false; }],
    ['receipt App Check', (privacy) => { privacy.deletionReceiptStatus.limitedUseAppCheckRequired = false; }],
    ['receipt Auth independence', (privacy) => { privacy.deletionReceiptStatus.firebaseAuthenticationRequired = true; }],
    ['raw receipt storage', (privacy) => { privacy.deletionReceiptStatus.rawReceiptStoredServerSide = true; }],
    ['receipt lookup representation', (privacy) => { privacy.deletionReceiptStatus.serverLookupRepresentation = 'plaintext'; }],
    ['receipt production collection', (privacy) => { privacy.deletionReceiptStatus.productionCollection = 'shared'; }],
    ['receipt review collection', (privacy) => { privacy.deletionReceiptStatus.reviewCollection = 'shared'; }],
    ['receipt realm peppers', (privacy) => { privacy.deletionReceiptStatus.separateRealmPeppers = false; }],
    ['receipt UID content', (privacy) => { privacy.deletionReceiptStatus.statusRecordContainsUid = true; }],
    ['receipt code content', (privacy) => { privacy.deletionReceiptStatus.statusRecordContainsCode = true; }],
    ['receipt URL content', (privacy) => { privacy.deletionReceiptStatus.statusRecordContainsResourceUrl = true; }],
    ['receipt expected completion', (privacy) => { privacy.deletionReceiptStatus.expectedCompletionDays = 31; }],
    ['receipt completion guarantee', (privacy) => { privacy.deletionReceiptStatus.expectedCompletionGuaranteed = true; }],
    ['receipt retry worker', (privacy) => { privacy.deletionReceiptStatus.retryWorkerMinutes = 10; }],
    ['pending receipt TTL', (privacy) => { privacy.deletionReceiptStatus.pendingHasTtl = true; }],
    ['pending receipt retention', (privacy) => { privacy.deletionReceiptStatus.pendingRetention = '30 days'; }],
    ['completed receipt contents', (privacy) => { privacy.deletionReceiptStatus.completedRecordContainsOnlyStatusTimestamps = false; }],
    ['completed receipt retention', (privacy) => { privacy.deletionReceiptStatus.completedRetentionDays = 31; }],
    ['completed receipt retention start', (privacy) => { privacy.deletionReceiptStatus.completedRetentionStartsAt = 'requestedAtMs'; }],
    ['completed receipt TTL promise', (privacy) => { privacy.deletionReceiptStatus.completedPhysicalTtlDeletionAsynchronous = false; }],
    ['receipt reopen check', (privacy) => { privacy.deletionReceiptStatus.checksOnClientResourcesReopen = false; }],
    ['receipt completion confirmation', (privacy) => { privacy.deletionReceiptStatus.completionConfirmationInApp = false; }],
    ['local receipt clearing', (privacy) => { privacy.deletionReceiptStatus.localReceiptClearedAfterCompletedAcknowledgement = false; }],
    ['prepared missing receipt clearing', (privacy) => { privacy.deletionReceiptStatus.preparedNotFoundClearsReceipt = true; }],
    ['prepared missing receipt access', (privacy) => { privacy.deletionReceiptStatus.preparedNotFoundRestoresAccess = true; }],
    ['prepared missing receipt resubmission', (privacy) => { privacy.deletionReceiptStatus.preparedNotFoundResubmitsSameReceipt = false; }],
    ['accepted missing receipt access', (privacy) => { privacy.deletionReceiptStatus.acceptedNotFoundRestoresAccess = true; }],
    ['audit purpose', (privacy) => { privacy.applicationAudit.purpose = 'analytics'; }],
    ['audit deadline', (privacy) => { privacy.applicationAudit.deletionDeadlineDays = 31; }],
    ['audit physical TTL promise', (privacy) => { privacy.applicationAudit.physicalTtlDeletionAsynchronous = false; }],
    ['audit actor label', (privacy) => { privacy.applicationAudit.actorLabel = 'Admin Name'; }],
    ['audit actor UID', (privacy) => { privacy.applicationAudit.containsActorUid = true; }],
    ['audit codes', (privacy) => { privacy.applicationAudit.containsCodes = true; }],
    ['audit resource URLs', (privacy) => { privacy.applicationAudit.containsResourceUrls = true; }],
    ['audit client names', (privacy) => { privacy.applicationAudit.containsClientNames = true; }],
    ['review namespace', (privacy) => { privacy.reviewSandbox.separateNamespace = false; }],
    ['review multi-device contract', (privacy) => { privacy.reviewSandbox.multiDevice = false; }],
    ['review sample type', (privacy) => { privacy.reviewSandbox.fixedNonClientSample = false; }],
    ['review production isolation', (privacy) => { privacy.reviewSandbox.productionClientRecordsExposed = true; }],
    ['review self-deletion', (privacy) => { privacy.reviewSandbox.userInitiatedDeletion = false; }],
    ['review deletion path', (privacy) => { privacy.reviewSandbox.activeUserPath = 'Settings'; }],
    ['review deletion response', (privacy) => { privacy.reviewSandbox.responseStatuses = ['pending']; }],
    ['review deletion authorization timing', (privacy) => { privacy.reviewSandbox.authorizationRevokedWhenAccepted = false; }],
    ['review inactivity eligibility', (privacy) => { privacy.reviewSandbox.currentIdentityInactivityEligibilityDays = 31; }],
    ['review stale-generation eligibility', (privacy) => { privacy.reviewSandbox.staleGenerationEligibility = 'after 30 days'; }],
    ['review retry worker', (privacy) => { privacy.reviewSandbox.retryWorkerMinutes = 10; }],
    ['review completion guarantee', (privacy) => { privacy.reviewSandbox.completionTimeGuaranteed = true; }],
    ['review activation status', (privacy) => { privacy.reviewSandbox.status = 'active'; }],
    ['source IP processing', (privacy) => { privacy.cloudFunctionRequestSecurity.rawSourceIpProcessedTransiently = false; }],
    ['raw source IP Firestore storage', (privacy) => { privacy.cloudFunctionRequestSecurity.rawSourceIpStoredInFirestore = true; }],
    ['request-log retention', (privacy) => { privacy.cloudRunRequestLogs.retentionDays = 31; }],
    ['request-log exclusion claim', (privacy) => { privacy.cloudRunRequestLogs.defaultSinkExclusionConfigured = true; }],
    ['rate-limit representation', (privacy) => { privacy.cloudFunctionRequestSecurity.storedRateLimitRepresentation = 'raw IP address'; }],
    ['rate-limit purpose', (privacy) => { privacy.cloudFunctionRequestSecurity.purpose = ['analytics']; }],
    ['rate-limit deadline', (privacy) => { privacy.cloudFunctionRequestSecurity.rateLimitBucketDeletionDeadlineMinutes = 31; }],
    ['rate-limit physical TTL promise', (privacy) => { privacy.cloudFunctionRequestSecurity.physicalTtlDeletionAsynchronous = false; }],
    ['rate-limit tracking', (privacy) => { privacy.cloudFunctionRequestSecurity.tracking = true; }],
    ['redemption request deadline', (privacy) => { privacy.accessArtifacts.redemptionRequestDigestDeadlineMinutes = 6; }],
    ['launch nonce deadline', (privacy) => { privacy.accessArtifacts.launchNonceDeadlineSeconds = 61; }],
    ['web session maximum', (privacy) => { privacy.accessArtifacts.webSessionMaximumMinutes = 61; }],
    ['broker replay deadline', (privacy) => { privacy.accessArtifacts.brokerReplayDigestDeadlineMinutes = 3; }],
    ['tombstone TTL', (privacy) => { privacy.accessArtifacts.deletionTombstoneHasTtl = true; }],
    ['tombstone retention', (privacy) => { privacy.accessArtifacts.deletionTombstoneRetention = 'forever'; }],
    ['plaintext artifact', (privacy) => { privacy.accessArtifacts.containsPlaintextSecrets = true; }],
    ['missing signed FirebaseAuth Analytics purpose', (privacy) => { privacy.conditionalRecommendation.provisionalPurpose = ['App Functionality']; }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const files = new Map(baseFiles);
      const path = 'release/app-store/3.0/app-privacy.json';
      const privacy = JSON.parse(files.get(path).toString('utf8'));
      mutate(privacy);
      files.set(path, Buffer.from(`${JSON.stringify(privacy, null, 2)}\n`));
      assert.match(
        verifyCapturedReleaseV3(files).join('\n'),
        /privacy architecture must retain/iu,
        `${name} was rejected only by its raw pin`,
      );
    });
  }
});

test('captured release verifier rejects unknown keys in every new App Privacy object', async (t) => {
  const { captureReleaseV3, verifyCapturedReleaseV3 } = await import('../scripts/verify-release-v3.mjs');
  const baseFiles = phaseFiles(captureReleaseV3(projectRoot), 'pre-input');
  for (const objectName of [
    'cloudFunctionRequestSecurity',
    'cloudRunRequestLogs',
    'accessArtifacts',
    'deletion',
    'deletionReceiptStatus',
    'applicationAudit',
    'reviewSandbox',
  ]) {
    await t.test(objectName, () => {
      const files = new Map(baseFiles);
      const path = 'release/app-store/3.0/app-privacy.json';
      const privacy = JSON.parse(files.get(path).toString('utf8'));
      privacy[objectName].unexpected = true;
      files.set(path, Buffer.from(`${JSON.stringify(privacy, null, 2)}\n`));
      assert.match(
        verifyCapturedReleaseV3(files).join('\n'),
        /privacy must retain the exact authority schema/iu,
      );
    });
  }
});

test('captured release verifier keeps the App Privacy raw-byte pin independent from semantic validation', async () => {
  const { captureReleaseV3, verifyCapturedReleaseV3 } = await import('../scripts/verify-release-v3.mjs');
  const files = captureReleaseV3(projectRoot);
  const path = 'release/app-store/3.0/app-privacy.json';
  files.set(path, Buffer.from(JSON.stringify(JSON.parse(files.get(path).toString('utf8')))));

  const errors = verifyCapturedReleaseV3(files).join('\n');
  assert.match(errors, /privacy must retain one exact phase-aware App Privacy authority form/iu);
  assert.doesNotMatch(errors, /privacy must retain the exact authority schema/iu);
  assert.doesNotMatch(errors, /privacy architecture must retain/iu);
});

test('release v3 verifier requires explicit negative answers for every supported age category', async (t) => {
  const categories = [
    ['parentalControls', true],
    ['ageAssurance', true],
    ['userGeneratedContent', true],
    ['socialMedia', true],
    ['socialMediaAgeRestricted', true],
    ['messagingAndChat', true],
    ['advertising', true],
    ['profanityOrCrudeHumor', 'INFREQUENT'],
    ['horrorOrFearThemes', 'INFREQUENT'],
    ['alcoholTobaccoOrDrugUseOrReferences', 'INFREQUENT'],
    ['matureOrSuggestiveThemes', 'INFREQUENT'],
    ['sexualContentOrNudity', 'INFREQUENT'],
    ['sexualContentGraphicAndNudity', 'INFREQUENT'],
    ['violenceCartoonOrFantasy', 'INFREQUENT'],
    ['violenceRealistic', 'INFREQUENT'],
    ['violenceRealisticProlongedGraphicOrSadistic', 'INFREQUENT'],
    ['gunsOrOtherWeapons', 'INFREQUENT'],
    ['gamblingSimulated', 'INFREQUENT'],
    ['contests', 'INFREQUENT'],
    ['gambling', true],
    ['lootBox', true],
  ];
  for (const [category, changedAnswer] of categories) {
    await t.test(category, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/age-rating.json', (age) => {
        age.otherSupportedAnswers[category] = changedAnswer;
      }),
      (result) => {
        assert.equal(result.status, 1, `${category}=${changedAnswer} bypassed the age authority`);
        assert.match(result.stderr, /exact age-rating authority|age rating must retain the exact authority schema/iu);
      },
    ));
  }
});

test('release v3 verifier pins the current Apple age questionnaire and override contract', async (t) => {
  const mutations = [
    ['frequency scale', (age) => { age.questionnaireReference.frequencyScale = ['NONE', 'FREQUENT']; }],
    ['health topics presence', (age) => { age.conditions.healthOrWellnessTopics.requiredAnswer = 'FREQUENT'; }],
    ['kids age band', (age) => { age.ageCategoryAndOverride.kidsAgeBand = 'FIVE_AND_UNDER'; }],
    ['age override', (age) => { age.ageCategoryAndOverride.ageRatingOverrideV2 = 'NINE_PLUS'; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/age-rating.json', mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed the age authority`);
        assert.match(result.stderr, /exact age-rating authority|age rating must retain the exact authority schema|Age rating must remain/iu);
      },
    ));
  }
});

test('release v3 verifier keeps every external gate at its exact truthful state', () => {
  const manifest = JSON.parse(readFileSync(
    join(projectRoot, 'release/app-store/3.0/release-manifest.json'),
    'utf8',
  ));
  assert.equal(
    manifest.gates.staffReviewAccess,
    'owner-portal-not-consumer-reachable-pending-exact-ipa-proof-and-apple-direction-if-requested',
  );
  assert.equal(
    manifest.appStoreDraft.unresolvedExternalGates.staffReviewAccess,
    'owner-portal-not-consumer-reachable-pending-exact-ipa-proof-and-apple-direction-if-requested',
  );
  assert.equal(
    manifest.gates.firebaseAndHosting,
    'dynamic-public-and-protected-brokers-deployed-and-verified-pending-physical-app-attest-valid-flow-and-exact-rc-e2e',
  );
  assert.equal(
    manifest.appStoreDraft.unresolvedExternalGates.firebaseAndHosting,
    'dynamic-public-and-protected-brokers-deployed-and-verified-pending-physical-app-attest-valid-flow-and-exact-rc-e2e',
  );
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.gates.firebaseAndHosting = 'ready';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /release gates must retain every exact truthful state/iu);
    },
  );
});

test('release v3 verifier requires the ordered dynamic-catalog AASA authority', () => {
  const manifest = JSON.parse(readFileSync(
    join(projectRoot, 'release/app-store/3.0/release-manifest.json'),
    'utf8',
  ));
  assert.deepEqual(manifest.aasaPlan.components, [
    { '/': '/apps/client-resources/launch/', exclude: true },
    { '/': '/apps/client-resources/launch/*', exclude: true },
    { '/': '/apps/client-resources/api/', exclude: true },
    { '/': '/apps/client-resources/api/*', exclude: true },
    { '/': '/apps/app-review/', exclude: true },
    { '/': '/apps/app-review/*', exclude: true },
    { '/': '/apps/client-resources/' },
    { '/': '/apps/client-resources/*', exclude: true },
    { '/': '/apps/*/' },
  ]);
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.aasaPlan.components.splice(1, 1);
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /AASA plan must retain the ordered protected-route exclusions and dynamic canonical-root include/iu);
    },
  );
});

test('captured release verifier allows reviewed client imports but rejects a third public slug', async () => {
  const { verifyCapturedReleaseV3 } = await import('../scripts/verify-release-v3.mjs');
  const files = phaseFiles(new Map([
    ['app.json', Buffer.from(readFileSync(join(projectRoot, 'app.json')))],
    ['eas.json', Buffer.from(readFileSync(join(projectRoot, 'eas.json')))],
    ['constants/config.ts', Buffer.from(readFileSync(join(projectRoot, 'constants/config.ts')))],
    ['constants/publicMiniapps.ts', Buffer.from(readFileSync(join(projectRoot, 'constants/publicMiniapps.ts')))],
    ['release/app-store/3.0/release-manifest.json', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/release-manifest.json')))],
    ['release/app-store/3.0/age-rating.json', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/age-rating.json')))],
    ['release/app-store/3.0/app-privacy.json', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/app-privacy.json')))],
    ['release/app-store/3.0/review-notes.md', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/review-notes.md')))],
    ['release/app-store/3.0/screenshots-manifest.json', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/screenshots-manifest.json')))],
    ['scripts/release-command-guard.mjs', Buffer.from(readFileSync(join(projectRoot, 'scripts/release-command-guard.mjs')))],
    ['features/clientAccess/clientAccessRuntime.native.ts', Buffer.from("import '@react-native-firebase/auth';\nimport * as SecureStore from 'expo-secure-store';\n")],
  ]), 'pre-input');

  assert.deepEqual(verifyCapturedReleaseV3(files), []);
  files.set(
    'constants/publicMiniapps.ts',
    Buffer.from("export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide', 'third-public'] as const;\n"),
  );
  assert.match(verifyCapturedReleaseV3(files).join('\n'), /exactly two public miniapps/iu);
});

test('captured release verifier rejects unknown authority fields and public-alias drift', async (t) => {
  const mutations = [
    ['manifest root key', 'release/app-store/3.0/release-manifest.json', (value) => {
      value.unreviewed = true;
    }],
    ['public alias drift', 'release/app-store/3.0/release-manifest.json', (value) => {
      value.scope.miniapps[0].title = 'Changed alias';
    }],
    ['age nested key', 'release/app-store/3.0/age-rating.json', (value) => {
      value.conditions.unrestrictedWebAccess.unreviewed = true;
    }],
    ['privacy root key', 'release/app-store/3.0/app-privacy.json', (value) => {
      value.unreviewed = true;
    }],
  ];

  for (const [name, relativePath, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, relativePath, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed captured authority:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /exact authority schema|public miniapp aliases/iu);
      },
    ));
  }
});

test('captured release verifier rejects semantic drift across every release authority', async (t) => {
  const mutations = [
    ['native bridge', 'release/app-store/3.0/release-manifest.json', (value) => { value.scope.nativeWebBridge = true; }],
    ['staff publishing', 'release/app-store/3.0/release-manifest.json', (value) => { value.scope.staffAdministration.directPublishing = true; }],
    ['staff URL', 'release/app-store/3.0/release-manifest.json', (value) => { value.urls.staff = 'https://evil.example/'; }],
    ['organization seller', 'release/app-store/3.0/release-manifest.json', (value) => { value.ownerSeller.registeredOrganization = true; }],
    ['Apple ID', 'release/app-store/3.0/release-manifest.json', (value) => { value.candidate.appleId = '1'; }],
    ['premature App Store save', 'release/app-store/3.0/release-manifest.json', (value) => { value.appStoreDraft.status = 'saved'; }],
    ['native resource URL omitted', 'release/app-store/3.0/app-privacy.json', (value) => { value.backend.resourceUrlsReturnedToNative = false; }],
    ['VIP preview URL exposed', 'release/app-store/3.0/app-privacy.json', (value) => {
      value.resourceUrlHandling ??= {
        publicV3CatalogRecordsContainExternalUrl: true,
        authorizedVipV2LaunchMayReturnExternalUrlTransiently: true,
        vipPreviewsContainExternalUrl: false,
        vipGrantsContainExternalUrl: false,
        nativeStorageContainsExternalUrl: false,
        applicationAuditContainsExternalUrl: false,
      };
      value.resourceUrlHandling.vipPreviewsContainExternalUrl = true;
    }],
    ['third-party destination network data denied', 'release/app-store/3.0/app-privacy.json', (value) => {
      value.thirdPartyNetworkRequests ??= {
        behavior: 'third-party-network-request',
        destinationHostReceivesNormalNetworkData: true,
        destinationOperatesIndependently: true,
        finalAppleMappingStatus: 'pending-final-destination-provider-and-category-review',
      };
      value.thirdPartyNetworkRequests.destinationHostReceivesNormalNetworkData = false;
    }],
    ['debug App Check', 'release/app-store/3.0/app-privacy.json', (value) => { value.appCheck.providers = ['debug']; }],
    ['best-effort deletion', 'release/app-store/3.0/app-privacy.json', (value) => { value.deletion.mechanism = 'best effort'; }],
    ['saved privacy linkage', 'release/app-store/3.0/app-privacy.json', (value) => { value.clientAccount.status = 'saved'; }],
    ['advertising category', 'release/app-store/3.0/app-privacy.json', (value) => { value.conditionalRecommendation.provisionalCategoryMapping = ['Advertising']; }],
    ['advertising age answer', 'release/app-store/3.0/age-rating.json', (value) => { value.otherSupportedAnswers.advertising = true; }],
  ];

  for (const [name, relativePath, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, relativePath, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} semantic drift bypassed captured authority`);
        assert.match(result.stderr, /exact v3 phase-neutral authority semantics|exact phase-aware App Privacy authority|exact age-rating authority/iu);
      },
    ));
  }
});
