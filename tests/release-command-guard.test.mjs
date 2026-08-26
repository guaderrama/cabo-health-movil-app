import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  APPLE_RELEASE_CANDIDATE,
  APP_STORE_METADATA_CHECK_IDS,
  PHYSICAL_IPHONE_QA_CHECK_IDS,
  SCREENSHOT_LOCALES,
  SCREENSHOT_SCENE_IDS,
  canonicalAppleEvidenceBytes,
} from '../scripts/apple-post-build-evidence.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const guardPath = join(projectRoot, 'scripts/release-command-guard.mjs');
const require = createRequire(import.meta.url);
const { bplistCreator, parse: parsePlist } = require('simple-plist');

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function write(root, relativePath, value) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function canonicalGoogleServicesPlist({
  bundleId = 'com.cabohealth.app',
  projectId = 'cabohealth-owner-prod',
} = {}) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>PROJECT_ID</key><string>${projectId}</string>`,
    `<key>BUNDLE_ID</key><string>${bundleId}</string>`,
    '</dict></plist>',
    '',
  ].join('\n');
}

function allPassed(keys) {
  return Object.fromEntries(keys.map((key) => [key, true]));
}

function fakePng(width, height, suffix) {
  const bytes = Buffer.alloc(24 + Buffer.byteLength(suffix));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write(suffix, 24, 'utf8');
  return bytes;
}

function exactPrivacyReport({
  ipaSha256,
  signedEntitlementsSha256,
  signingCertificateSha256,
  provisioningProfileSha256,
  sourceGoogleServicesPlistSha256,
  embeddedGoogleServicesPlistSha256,
}) {
  const firebaseManifestSha256 = '7'.repeat(64);
  const rootManifestSha256 = '8'.repeat(64);
  const privacyManifests = [{
    relativePath: 'FirebaseAuth_Privacy.bundle/PrivacyInfo.xcprivacy',
    sha256: firebaseManifestSha256,
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
    sha256: rootManifestSha256,
    tracking: false,
    trackingDomains: [],
    dataTypes: [],
    apis: [],
  }];
  const inventoryFiles = [{
    relativePath: 'FirebaseAuth_Privacy.bundle/PrivacyInfo.xcprivacy',
    size: 2102,
    sha256: firebaseManifestSha256,
  }, {
    relativePath: 'Info.plist',
    size: 1024,
    sha256: '9'.repeat(64),
  }, {
    relativePath: 'PrivacyInfo.xcprivacy',
    size: 1386,
    sha256: rootManifestSha256,
  }];
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ipa-privacy-report',
    status: 'passed',
    generatedAt: '2026-08-22T08:30:00.000Z',
    candidate: {
      bundleIdentifier: APPLE_RELEASE_CANDIDATE.bundleIdentifier,
      marketingVersion: APPLE_RELEASE_CANDIDATE.marketingVersion,
      buildNumber: APPLE_RELEASE_CANDIDATE.buildNumber,
      teamIdentifier: 'DQ8PH2DZ3R',
      appAttestEnvironment: 'production',
      associatedDomains: ['applinks:cabohealth.org'],
      appBoundDomains: ['cabohealth.org'],
    },
    ipaSha256,
    signature: {
      verified: true,
      identifier: APPLE_RELEASE_CANDIDATE.bundleIdentifier,
      teamIdentifier: 'DQ8PH2DZ3R',
      distributionAuthoritySha256: 'a'.repeat(64),
      signedEntitlementsSha256,
      signedEntitlementKeys: [
        'application-identifier',
        'beta-reports-active',
        'com.apple.developer.associated-domains',
        'com.apple.developer.devicecheck.appattest-environment',
        'com.apple.developer.team-identifier',
        'get-task-allow',
      ],
      signingCertificateSha256,
      provisioningProfileSha256,
      provisioningProfile: {
        expiration: '2030-01-01T00:00:00.000Z',
        name: 'Synthetic App Store profile',
        uuid: 'ABCDEF12-3456-4789-ABCD-ABCDEF123456',
      },
    },
    firebase: {
      bundleIdentifier: APPLE_RELEASE_CANDIDATE.bundleIdentifier,
      projectIdentifier: 'cabohealth-owner-prod',
      sourceSha256: sourceGoogleServicesPlistSha256,
      embeddedSha256: embeddedGoogleServicesPlistSha256,
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
      ].map((key) => [key, { markersChecked: 1, matches: 0 }])),
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

function exactRcEvidence(root, { sourceTreeSha256, testFlightBuildId }) {
  const physicalIphoneQa = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-physical-iphone-qa',
    candidate: { ...APPLE_RELEASE_CANDIDATE },
    testFlightBuildId,
    sourceTreeSha256,
    status: 'passed',
    performedAt: '2026-08-22T10:30:00.000Z',
    reviewedAt: '2026-08-22T10:45:00.000Z',
    devices: [{
      opaqueId: '1'.repeat(64),
      model: 'iPhone 16 Pro Max',
      osVersion: '18.6',
      installation: 'clean',
      locales: [...SCREENSHOT_LOCALES],
      result: 'passed',
      evidenceSha256: '2'.repeat(64),
    }, {
      opaqueId: '3'.repeat(64),
      model: 'iPhone 15 Pro Max',
      osVersion: '18.5',
      installation: 'upgrade',
      locales: [...SCREENSHOT_LOCALES],
      result: 'passed',
      evidenceSha256: '4'.repeat(64),
    }],
    checks: allPassed(PHYSICAL_IPHONE_QA_CHECK_IDS),
    failures: [],
    humanSignOff: true,
  };
  const captures = [];
  for (const locale of SCREENSHOT_LOCALES) {
    for (const sceneId of SCREENSHOT_SCENE_IDS) {
      const relativePath = `screenshots/${locale}/iphone-6.9/${sceneId}.png`;
      const bytes = fakePng(1320, 2868, `${locale}:${sceneId}`);
      write(root, `release/private/rc/${relativePath}`, bytes);
      chmodSync(join(root, `release/private/rc/${relativePath}`), 0o600);
      captures.push({
        locale,
        sceneId,
        relativePath,
        sha256: hash(bytes),
        width: 1320,
        height: 2868,
        format: 'png',
        capturedAt: '2026-08-22T10:30:00.000Z',
        testFlightBuildId,
      });
    }
  }
  const screenshotsManifest = {
    schemaVersion: 2,
    status: 'exact-rc-captured-and-approved',
    marketingVersion: '3.0',
    buildNumber: '4',
    deviceClass: 'iPhone 6.9-inch',
    locales: [...SCREENSHOT_LOCALES],
    sceneIds: [...SCREENSHOT_SCENE_IDS],
    captures,
    requiredEvidence: {
      testFlightBuildId,
      sourceSha: sourceTreeSha256,
      imageHashes: captures.map((capture) => capture.sha256),
      ocrExcludedScopeCheck: true,
      humanVisualSignOff: true,
    },
  };
  const appStoreConnectEvidence = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-app-store-connect-evidence',
    candidate: { ...APPLE_RELEASE_CANDIDATE },
    testFlightBuildId,
    status: 'ready-for-review',
    capturedAt: '2026-08-22T10:30:00.000Z',
    reviewedAt: '2026-08-22T10:45:00.000Z',
    appResourceId: APPLE_RELEASE_CANDIDATE.appleId,
    appStoreVersionId: 'app-store-version-123',
    buildResourceId: '123e4567-e89b-42d3-a456-426614174001',
    appStoreVersionState: 'PREPARE_FOR_SUBMISSION',
    buildProcessingState: 'VALID',
    metadataChecks: allPassed(APP_STORE_METADATA_CHECK_IDS),
    failures: [],
    evidenceSnapshotSha256: '5'.repeat(64),
  };
  return {
    physicalIphoneQa: canonicalAppleEvidenceBytes(physicalIphoneQa),
    screenshotsManifest: canonicalAppleEvidenceBytes(screenshotsManifest),
    appStoreConnectEvidence: canonicalAppleEvidenceBytes(appStoreConnectEvidence),
  };
}

test('production build and submit scripts cannot bypass the release guard', () => {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  assert.match(readFileSync(join(projectRoot, '.gitignore'), 'utf8'), /^\/release\/private\/$/mu);
  assert.equal(packageJson.scripts['build:prod'], 'node scripts/release-command-guard.mjs build');
  assert.equal(
    packageJson.scripts['upload:testflight'],
    'node scripts/release-command-guard.mjs upload-testflight',
  );
  assert.equal(packageJson.scripts.submit, 'node scripts/release-command-guard.mjs submit-review');
  assert.doesNotMatch(packageJson.scripts['build:prod'], /\beas\s+build\b/u);
  assert.doesNotMatch(packageJson.scripts['upload:testflight'], /\beas\s+submit\b/u);
  assert.doesNotMatch(packageJson.scripts.submit, /\beas\s+submit\b/u);
});

test('release tooling pins EAS CLI and both plist parsers exactly', () => {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
  const easJson = JSON.parse(readFileSync(join(projectRoot, 'eas.json'), 'utf8'));

  assert.equal(packageJson.devDependencies['eas-cli'], '22.2.0');
  assert.equal(easJson.cli.version, packageJson.devDependencies['eas-cli']);
  assert.equal(packageJson.devDependencies['simple-plist'], '1.3.1');
  assert.equal(packageJson.dependencies['@xmldom/xmldom'], '0.8.15');
  assert.equal(packageLock.packages[''].devDependencies['eas-cli'], '22.2.0');
  assert.equal(packageLock.packages[''].devDependencies['simple-plist'], '1.3.1');
  assert.equal(packageLock.packages[''].dependencies['@xmldom/xmldom'], '0.8.15');
  assert.equal(packageLock.packages['node_modules/@xmldom/xmldom'].version, '0.8.15');
  assert.equal(packageLock.packages['node_modules/eas-cli'].version, '22.2.0');
  assert.equal(packageLock.packages['node_modules/simple-plist'].version, '1.3.1');
  assert.deepEqual(packageJson.overrides['eas-cli'], {
    ajv: '8.20.0',
    joi: '17.13.6',
    'minimatch@5.1.2': '5.1.8',
    nanoid: '3.3.18',
    tar: '7.5.22',
    yaml: '2.9.0',
  });
  assert.equal(packageLock.packages['node_modules/ajv'].version, '8.20.0');
  assert.equal(packageLock.packages['node_modules/joi'].version, '17.13.6');
  assert.equal(
    packageLock.packages['node_modules/eas-cli/node_modules/minimatch'].version,
    '5.1.8',
  );
  assert.equal(
    packageLock.packages['node_modules/eas-cli/node_modules/glob/node_modules/minimatch'].version,
    '10.2.6',
  );
  assert.equal(
    packageLock.packages['node_modules/eas-cli/node_modules/@expo/prebuild-config/node_modules/minimatch'].version,
    '9.0.9',
  );
  assert.equal(packageLock.packages['node_modules/nanoid'].version, '3.3.18');
  assert.equal(packageLock.packages['node_modules/tar'].version, '7.5.22');
  assert.equal(packageLock.packages['node_modules/yaml'].version, '2.9.0');
});

test('the installed EAS parser dependency tree is valid', () => {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ls', '@xmldom/xmldom', 'minimatch', '--all', '--depth=6'],
    { cwd: projectRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('release guard rejects ambiguous Firebase plist identities with the exact guard code', async (t) => {
  const { readProductionGoogleServicesPlist } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-strict-plist-')));
  const plistPath = join(root, 'GoogleService-Info.plist');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = {
    CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-owner-prod',
    CABOHEALTH_GOOGLE_SERVICES_PLIST: plistPath,
  };
  const validProject = '<key>PROJECT_ID</key><string>cabohealth-owner-prod</string>';
  const wrongProject = '<key>PROJECT_ID</key><string>cabohealth-other</string>';
  const validBundle = '<key>BUNDLE_ID</key><string>com.cabohealth.app</string>';
  const wrap = (entries) => `<?xml version="1.0"?><plist version="1.0"><dict>${entries}</dict></plist>`;
  const invalidPlists = [
    wrap(`${validProject}${wrongProject}${validBundle}`),
    wrap(`${wrongProject}${validProject}${validBundle}`),
    wrap(`<key>DECOY</key><dict>${validProject}</dict>${wrongProject}${validBundle}`),
    wrap(`<key>PROJECT_ID</key><integer>1</integer>${validBundle}`),
    wrap('<key>PROJECT_ID<![CDATA[_DECOY]]></key><string>cabohealth-other</string>'
      + '<key>PROJ<![CDATA[ECT_ID]]></key><string>cabohealth-owner-prod</string>'
      + validBundle),
    `<?xml version="1.0"?><plist><dict>${validProject}${validBundle}</dict>`,
  ];

  for (const plist of invalidPlists) {
    writeFileSync(plistPath, plist, { mode: 0o600 });
    chmodSync(plistPath, 0o600);
    assert.throws(
      () => readProductionGoogleServicesPlist(environment),
      /EXACT_BUILD_INPUT_GOOGLE_SERVICES_PLIST_INVALID/u,
    );
  }

  const canonicalBytes = Buffer.from(canonicalGoogleServicesPlist(), 'utf8');
  writeFileSync(plistPath, canonicalBytes, { mode: 0o600 });
  chmodSync(plistPath, 0o600);
  const result = readProductionGoogleServicesPlist(environment);
  assert.equal(result.path, plistPath);
  assert.equal(result.sha256, hash(canonicalBytes));
  assert.deepEqual(result.bytes, canonicalBytes);
});

test('artifact verification compares complete plist content across XML and binary encodings', async () => {
  const { googleServicesPlistsHaveSameContent } = await import(guardPath);
  const xml = Buffer.from(canonicalGoogleServicesPlist(), 'utf8');
  const parsed = parsePlist(xml);
  const binary = bplistCreator(parsed);
  const changedBinary = bplistCreator({ ...parsed, STORAGE_BUCKET: 'wrong.example.invalid' });

  assert.notEqual(hash(xml), hash(binary));
  assert.equal(googleServicesPlistsHaveSameContent(xml, binary), true);
  assert.equal(googleServicesPlistsHaveSameContent(xml, changedBinary), false);
  assert.equal(googleServicesPlistsHaveSameContent(xml, Buffer.from('not-a-plist')), false);
});

test('release authorities remain valid as the build, artifact, and RC phases advance', async () => {
  const {
    decodePinnedNodeToolAuthority,
    resolvePinnedNodeTool,
    verifyBuildArtifactAttestation,
    verifyRcAttestation,
  } = await import(guardPath);
  const source = readFileSync(guardPath, 'utf8');
  const optionalShaPin = (name) => {
    const value = source.match(
      new RegExp(`^const ${name} = (null|'[a-f0-9]{64}');$`, 'mu'),
    )?.[1];
    assert.ok(value, `${name} must be null or one exact SHA-256`);
    return value === 'null' ? null : value.slice(1, -1);
  };
  const optionalToolPin = (name) => {
    const value = source.match(
      new RegExp(`^const ${name} = (null|'[A-Za-z0-9+/]+={0,2}');$`, 'mu'),
    )?.[1];
    assert.ok(value, `${name} must be null or one canonical base64 authority`);
    return value === 'null' ? null : value.slice(1, -1);
  };
  const buildInputPin = source.match(
    /^const BUILD_INPUT_ATTESTATION_SHA256 = '([a-f0-9]{64})';$/mu,
  )?.[1];
  const easPin = source.match(
    /^const PINNED_EAS_CLI = '([A-Za-z0-9+/]+={0,2})';$/mu,
  )?.[1];
  assert.match(buildInputPin ?? '', /^[a-f0-9]{64}$/u);
  assert.match(easPin ?? '', /^[A-Za-z0-9+/]+={0,2}$/u);
  assert.equal(
    hash(readFileSync(join(
      projectRoot,
      'release/app-store/3.0/build-input-attestation.json',
    ))),
    buildInputPin,
  );
  const decodedEasPin = decodePinnedNodeToolAuthority(
    easPin,
    'EAS_CLI_NOT_PINNED',
    'EAS_CLI_PIN_INVALID',
  );
  assert.equal(decodedEasPin.packageVersion, '22.2.0');
  assert.ok(resolvePinnedNodeTool(
    projectRoot,
    decodedEasPin,
    'EAS_CLI_NOT_PINNED',
    'EAS_CLI_PIN_INVALID',
  ).executable.endsWith('/node_modules/eas-cli/bin/run'));
  const buildArtifactPin = optionalShaPin('BUILD_ARTIFACT_ATTESTATION_SHA256');
  const rcPin = optionalShaPin('RC_ATTESTATION_SHA256');
  const adapterPin = optionalToolPin('PINNED_APP_STORE_SUBMIT_ADAPTER');

  if (buildArtifactPin === null) {
    assert.throws(
      () => verifyBuildArtifactAttestation(projectRoot, {
        buildInputSha256: buildInputPin,
        buildArtifactSha256: null,
      }),
      /EXACT_BUILD_ARTIFACT_ATTESTATION_MISSING/u,
    );
  } else {
    assert.equal(hash(readFileSync(join(
      projectRoot,
      'release/app-store/3.0/build-artifact-attestation.json',
    ))), buildArtifactPin);
  }

  if (rcPin === null) {
    assert.throws(
      () => verifyRcAttestation(projectRoot, {
        buildInputSha256: buildInputPin,
        buildArtifactSha256: buildArtifactPin,
        rcSha256: null,
      }),
      /EXACT_RC_ATTESTATION_MISSING/u,
    );
  } else {
    assert.notEqual(buildArtifactPin, null, 'an RC authority requires a build-artifact authority');
    assert.equal(hash(readFileSync(join(
      projectRoot,
      'release/app-store/3.0/rc-attestation.json',
    ))), rcPin);
  }

  if (adapterPin !== null) {
    const decodedAdapterPin = decodePinnedNodeToolAuthority(
      adapterPin,
      'APP_STORE_SUBMIT_ADAPTER_NOT_PINNED',
      'APP_STORE_SUBMIT_ADAPTER_PIN_INVALID',
    );
    assert.ok(resolvePinnedNodeTool(
      projectRoot,
      decodedAdapterPin,
      'APP_STORE_SUBMIT_ADAPTER_NOT_PINNED',
      'APP_STORE_SUBMIT_ADAPTER_PIN_INVALID',
    ).executable.startsWith(projectRoot));
  }
});

test('release guard separates source, built artifact, and final reviewed RC authorities', () => {
  const source = readFileSync(guardPath, 'utf8');
  assert.match(source, /BUILD_INPUT_ATTESTATION_SHA256/u);
  assert.match(source, /BUILD_ARTIFACT_ATTESTATION_SHA256/u);
  assert.match(source, /computeTrackedSourceSha256/u);
  assert.match(source, /ipaSha256/u);
  assert.match(source, /--path/u);
  assert.doesNotMatch(source, /\['submit', '--platform', 'ios'\]/u);
});

test('tracked source includes guard behavior while normalizing only reviewed pin values', async (t) => {
  const { computeTrackedSourceSha256, normalizeReleaseGuardAuthority } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-guard-authority-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'scripts/release-command-guard.mjs', [
    'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
    'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
    'const RC_ATTESTATION_SHA256 = null;',
    'const PINNED_EAS_CLI = null;',
    'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
    "export const guardedBehavior = 'v1';",
    '',
  ].join('\n'));
  write(root, 'release/app-store/3.0/screenshots-manifest.json', '{"captures":[]}\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'guard fixture');
  const initial = computeTrackedSourceSha256(root);

  write(root, 'release/app-store/3.0/screenshots-manifest.json', '{"captures":["exact-rc"]}\n');
  git(root, 'add', 'release/app-store/3.0/screenshots-manifest.json');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'post-build screenshot evidence');
  assert.equal(
    computeTrackedSourceSha256(root),
    initial,
    'post-build screenshot evidence must not mutate the reviewed build-input digest',
  );

  const source = readFileSync(join(root, 'scripts/release-command-guard.mjs'), 'utf8');
  write(root, 'scripts/release-command-guard.mjs', source.replace(
    'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
    `const BUILD_INPUT_ATTESTATION_SHA256 = '${'a'.repeat(64)}';`,
  ));
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'reviewed pin only');
  assert.equal(computeTrackedSourceSha256(root), initial);

  write(root, 'scripts/release-command-guard.mjs', readFileSync(
    join(root, 'scripts/release-command-guard.mjs'),
    'utf8',
  ).replace("guardedBehavior = 'v1'", "guardedBehavior = 'v2'"));
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'behavior drift');
  assert.notEqual(computeTrackedSourceSha256(root), initial);

  assert.throws(() => normalizeReleaseGuardAuthority(Buffer.from(guardFixtureForAttack())),
    /BUILD_SOURCE_GUARD_AUTHORITY_INVALID/u);

  function guardFixtureForAttack() {
    return [
      'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
      'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
      'const RC_ATTESTATION_SHA256 = null;',
      'const PINNED_EAS_CLI = (globalThis.compromised = true, null);',
      'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
      '',
    ].join('\n');
  }
});

test('a pinned Node tool authority covers its complete runtime tree and Node binary', async (t) => {
  const {
    computeRuntimeTreeSha256,
    decodePinnedNodeToolAuthority,
    resolvePinnedNodeTool,
  } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-tool-closure-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'tool-runtime/eas-cli/bin/run.mjs', "import '../dependency.mjs';\n");
  write(root, 'tool-runtime/eas-cli/dependency.mjs', "export const reviewed = 'v1';\n");
  write(root, 'tool-runtime/eas-cli/package.json', '{"name":"eas-cli","version":"99.1.0"}\n');

  const pin = {
    entryRelativePath: 'eas-cli/bin/run.mjs',
    nodeExecutableSha256: hash(readFileSync(process.execPath)),
    nodeVersion: process.version,
    packageJsonRelativePath: 'eas-cli/package.json',
    packageVersion: '99.1.0',
    runtimeRootRelativePath: 'tool-runtime',
    runtimeTreeSha256: computeRuntimeTreeSha256(join(root, 'tool-runtime')),
  };
  const encodedPin = Buffer.from(JSON.stringify(pin), 'utf8').toString('base64');
  assert.deepEqual(
    decodePinnedNodeToolAuthority(encodedPin, 'TOOL_MISSING', 'TOOL_INVALID'),
    pin,
  );
  const resolved = resolvePinnedNodeTool(root, pin, 'TOOL_MISSING', 'TOOL_INVALID');
  assert.equal(resolved.executable, join(root, 'tool-runtime/eas-cli/bin/run.mjs'));
  assert.equal(resolved.nodeExecutable, process.execPath);

  write(root, 'tool-runtime/eas-cli/dependency.mjs', "export const reviewed = 'drifted';\n");
  assert.throws(
    () => resolvePinnedNodeTool(root, pin, 'TOOL_MISSING', 'TOOL_INVALID'),
    /TOOL_INVALID/u,
  );
  write(root, 'tool-runtime/eas-cli/dependency.mjs', "export const reviewed = 'v1';\n");
  assert.throws(
    () => resolvePinnedNodeTool(root, {
      ...pin,
      nodeExecutableSha256: '0'.repeat(64),
    }, 'TOOL_MISSING', 'TOOL_INVALID'),
    /TOOL_INVALID/u,
  );
});

test('build and upload use unique private snapshots whose exact bytes survive Dropbox drift', async (t) => {
  const {
    computeTrackedSourceSha256,
    createPrivateBuildSnapshot,
    createPrivateUploadSnapshot,
    removePrivateOperationSnapshot,
    verifyPrivateBuildSnapshot,
    verifyPrivateUploadIpa,
  } = await import(guardPath);
  const sourceContainer = realpathSync(mkdtempSync(
    join(tmpdir(), 'cabohealth-release-snapshot-source-'),
  ));
  mkdirSync(join(sourceContainer, 'Dropbox/project'), { recursive: true });
  const root = realpathSync(join(sourceContainer, 'Dropbox/project'));
  const privateParent = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-snapshot-parent-')));
  t.after(() => rmSync(sourceContainer, { recursive: true, force: true }));
  t.after(() => rmSync(privateParent, { recursive: true, force: true }));
  const guardFixture = [
    'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
    'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
    'const RC_ATTESTATION_SHA256 = null;',
    'const PINNED_EAS_CLI = null;',
    'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
    "export const guardedBehavior = 'reviewed';",
    '',
  ].join('\n');
  write(root, 'scripts/release-command-guard.mjs', guardFixture);
  write(root, 'app.json', '{"expo":{"version":"3.0"}}\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'snapshot fixture');
  const expectedSourceSha256 = computeTrackedSourceSha256(root);

  assert.throws(() => createPrivateBuildSnapshot(root, expectedSourceSha256, {
    privateParent: join(sourceContainer, 'Dropbox'),
  }), /PRIVATE_BUILD_SNAPSHOT_INVALID/u);
  const build = createPrivateBuildSnapshot(root, expectedSourceSha256, { privateParent });
  assert.notEqual(build.operationRoot, root);
  assert.equal(build.operationRoot.startsWith(join(sourceContainer, 'Dropbox')), false);
  assert.equal((statSync(build.operationRoot).mode & 0o777), 0o700);
  assert.equal(readFileSync(join(build.workspaceRoot, 'app.json'), 'utf8'),
    '{"expo":{"version":"3.0"}}\n');
  write(root, 'app.json', '{"expo":{"version":"drifted"}}\n');
  assert.equal(readFileSync(join(build.workspaceRoot, 'app.json'), 'utf8'),
    '{"expo":{"version":"3.0"}}\n');
  assert.equal(verifyPrivateBuildSnapshot(build.workspaceRoot, expectedSourceSha256),
    expectedSourceSha256);
  writeFileSync(join(build.workspaceRoot, 'app.json'), '{"expo":{"version":"private drift"}}\n');
  assert.throws(
    () => verifyPrivateBuildSnapshot(build.workspaceRoot, expectedSourceSha256),
    /PRIVATE_BUILD_SNAPSHOT_INVALID/u,
  );
  removePrivateOperationSnapshot(build.operationRoot, { privateParent });
  assert.equal(existsSync(build.operationRoot), false);

  const ipa = join(root, 'CaboHealth.ipa');
  writeFileSync(ipa, 'reviewed ipa bytes', { mode: 0o600 });
  chmodSync(ipa, 0o600);
  const expectedIpaSha256 = hash(Buffer.from('reviewed ipa bytes'));
  const upload = createPrivateUploadSnapshot(ipa, expectedIpaSha256, { privateParent });
  assert.notEqual(upload.ipaPath, ipa);
  assert.equal((statSync(upload.ipaPath).mode & 0o777), 0o600);
  writeFileSync(ipa, 'Dropbox drift after private copy', { mode: 0o600 });
  assert.equal(verifyPrivateUploadIpa(upload.ipaPath, expectedIpaSha256), expectedIpaSha256);
  writeFileSync(upload.ipaPath, 'private drift', { mode: 0o600 });
  assert.throws(
    () => verifyPrivateUploadIpa(upload.ipaPath, expectedIpaSha256),
    /PRIVATE_UPLOAD_IPA_INVALID/u,
  );
  removePrivateOperationSnapshot(upload.operationRoot, { privateParent });
  assert.equal(existsSync(upload.operationRoot), false);
});

test('the executable Node tool closure is copied and rehashed inside the private operation', async (t) => {
  const {
    computeRuntimeTreeSha256,
    createPrivateUploadSnapshot,
    removePrivateOperationSnapshot,
    resolvePinnedNodeTool,
    snapshotPinnedNodeTool,
    verifyPrivateNodeToolSnapshot,
  } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-tool-source-')));
  const privateParent = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-tool-parent-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(privateParent, { recursive: true, force: true }));
  write(root, 'runtime/tool/bin/run.mjs', "import '../dependency.mjs';\n");
  write(root, 'runtime/tool/dependency.mjs', "export const value = 'reviewed';\n");
  write(root, 'runtime/tool/package.json', '{"version":"1.0.0"}\n');
  const pin = {
    entryRelativePath: 'tool/bin/run.mjs',
    nodeExecutableSha256: hash(readFileSync(process.execPath)),
    nodeVersion: process.version,
    packageJsonRelativePath: 'tool/package.json',
    packageVersion: '1.0.0',
    runtimeRootRelativePath: 'runtime',
    runtimeTreeSha256: computeRuntimeTreeSha256(join(root, 'runtime')),
  };
  const resolved = resolvePinnedNodeTool(root, pin, 'TOOL_MISSING', 'TOOL_INVALID');
  const ipa = join(root, 'fixture.ipa');
  writeFileSync(ipa, 'ipa', { mode: 0o600 });
  chmodSync(ipa, 0o600);
  const operation = createPrivateUploadSnapshot(ipa, hash(Buffer.from('ipa')), { privateParent });
  const privateTool = snapshotPinnedNodeTool(operation.operationRoot, resolved, pin);
  assert.equal(privateTool.runtimeRoot, join(operation.operationRoot, 'node_modules'));
  assert.ok(privateTool.executable.startsWith(operation.operationRoot));
  assert.ok(privateTool.nodeExecutable.startsWith(operation.operationRoot));
  const privateExecution = spawnSync(privateTool.nodeExecutable, [privateTool.executable], {
    encoding: 'utf8',
  });
  assert.equal(privateExecution.status, 0, privateExecution.stderr);

  const privateWorkspace = join(operation.operationRoot, 'workspace');
  mkdirSync(privateWorkspace, { mode: 0o700 });
  const resolution = spawnSync(
    privateTool.nodeExecutable,
    ['-e', "process.stdout.write(require.resolve('tool/package.json'))"],
    { cwd: privateWorkspace, encoding: 'utf8' },
  );
  assert.equal(resolution.status, 0, resolution.stderr);
  assert.equal(resolution.stdout, join(privateTool.runtimeRoot, 'tool/package.json'));

  write(root, 'runtime/tool/dependency.mjs', "export const value = 'Dropbox drift';\n");
  assert.deepEqual(verifyPrivateNodeToolSnapshot(privateTool, pin), privateTool);
  writeFileSync(privateTool.executable, 'private drift\n');
  assert.throws(
    () => verifyPrivateNodeToolSnapshot(privateTool, pin),
    /PRIVATE_TOOL_SNAPSHOT_INVALID/u,
  );
  removePrivateOperationSnapshot(operation.operationRoot, { privateParent });
});

test('the final adapter receives every exact ASC build identity and reviewed evidence binding', async () => {
  const { appStoreSubmitArguments } = await import(guardPath);
  const rcSha256 = 'a'.repeat(64);
  const rcAttestation = {
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '4',
    },
    buildArtifactAttestationSha256: 'b'.repeat(64),
    testFlightBuildId: '987654321',
    physicalIphoneQaSha256: 'c'.repeat(64),
    screenshotsManifestSha256: 'd'.repeat(64),
    appStoreMetadataEvidenceSha256: 'e'.repeat(64),
  };
  const authorization = { nonce: 'F'.repeat(32) };
  const args = appStoreSubmitArguments(projectRoot, {
    rcAttestation,
    rcAttestationSha256: rcSha256,
    authorization,
  });
  assert.deepEqual(args, [
    '--operation', 'submit-for-review',
    '--apple-id', '6758285327',
    '--bundle-identifier', 'com.cabohealth.app',
    '--marketing-version', '3.0',
    '--build-number', '4',
    '--testflight-build-id', '987654321',
    '--rc-attestation', join(projectRoot, 'release/app-store/3.0/rc-attestation.json'),
    '--rc-attestation-sha256', rcSha256,
    '--build-artifact-attestation', join(
      projectRoot,
      'release/app-store/3.0/build-artifact-attestation.json',
    ),
    '--build-artifact-attestation-sha256', 'b'.repeat(64),
    '--app-store-connect-evidence', join(
      projectRoot,
      'release/private/rc/app-store-connect-evidence.json',
    ),
    '--app-store-connect-evidence-sha256', 'e'.repeat(64),
    '--physical-iphone-qa', join(projectRoot, 'release/private/rc/physical-iphone-qa.json'),
    '--physical-iphone-qa-sha256', 'c'.repeat(64),
    '--screenshots-manifest', join(
      projectRoot,
      'release/app-store/3.0/screenshots-manifest.json',
    ),
    '--screenshots-manifest-sha256', 'd'.repeat(64),
    '--authorization-nonce', 'F'.repeat(32),
  ]);
});

test('release guard requires a recent one-time authorization bound to the reviewed RC', () => {
  const source = readFileSync(guardPath, 'utf8');
  assert.match(source, /SUBMIT_AUTHORIZATION_REQUIRED/u);
  assert.match(source, /authorization\.rcAttestationSha256 !== RC_ATTESTATION_SHA256/u);
  assert.match(source, /now - issuedAtMs > 10 \* 60 \* 1000/u);
  assert.match(source, /expiresAtMs - issuedAtMs > 10 \* 60 \* 1000/u);
  assert.match(source, /expiresAtMs - now > 10 \* 60 \* 1000/u);
  assert.match(source, /privateMode: 0o600/u);
  assert.match(source, /mode & 0o777\) !== privateMode/u);
  assert.match(source, /consumeAuthorizationNonce/u);
});

test('authorization validation rejects stale, overlong, wrong-RC, and replayed grants', async () => {
  const {
    confirmationChallengeForAuthorization,
    consumeAuthorizationNonce,
    validateAuthorization,
  } = await import(guardPath);
  const requestedRoot = join(tmpdir(), `cabohealth-release-authorization-${process.pid}-${Date.now()}`);
  mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  const root = realpathSync(requestedRoot);
  const store = join(root, 'release/private/submit-authorizations');
  mkdirSync(store, { recursive: true, mode: 0o700 });
  chmodSync(store, 0o700);
  const now = 1_800_000_000_000;
  const rc = 'a'.repeat(64);
  const valid = {
    schemaVersion: 1,
    action: 'submit-for-review',
    rcAttestationSha256: rc,
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 60_000,
    nonce: 'A'.repeat(32),
    confirmationMethod: 'codex-explicit-user-confirmation',
    identityAssurance: 'operational-only-not-cryptographic',
    confirmationChallenge: '',
  };
  valid.confirmationChallenge = confirmationChallengeForAuthorization(valid);

  assert.deepEqual(validateAuthorization(valid, {
    expectedAction: 'submit-for-review',
    expectedRcSha256: rc,
    now,
  }), valid);
  assert.throws(() => validateAuthorization({ ...valid, issuedAtMs: now - 600_001 }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);
  assert.throws(() => validateAuthorization({ ...valid, expiresAtMs: valid.issuedAtMs + 600_001 }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);
  assert.throws(() => validateAuthorization({ ...valid, rcAttestationSha256: 'b'.repeat(64) }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);
  assert.throws(() => validateAuthorization({ ...valid, confirmationChallenge: '0'.repeat(32) }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);

  const authorizationPath = join(root, 'authorization.json');
  writeFileSync(authorizationPath, `${JSON.stringify(valid)}\n`, { mode: 0o600 });
  chmodSync(authorizationPath, 0o600);
  consumeAuthorizationNonce({
    authorizationPath,
    authorization: valid,
    projectRoot: root,
  });
  writeFileSync(authorizationPath, `${JSON.stringify(valid)}\n`, { mode: 0o600 });
  chmodSync(authorizationPath, 0o600);
  assert.throws(() => consumeAuthorizationNonce({
    authorizationPath,
    authorization: valid,
    projectRoot: root,
  }), /SUBMIT_AUTHORIZATION_REPLAYED/u);
});

test('submission authorization is documented as an operational challenge, not identity proof', () => {
  const gates = readFileSync(
    join(projectRoot, 'release/app-store/3.0/submission-gates.md'),
    'utf8',
  );
  assert.match(gates, /cannot cryptographically authenticate Ivan's identity/iu);
  assert.match(gates, /Codex must ask Ivan.*separate explicit confirmation/isu);
  assert.match(gates, /confirmation challenge.*RC-bound/iu);
  assert.match(gates, /submit adapter.*independently reviewed and recursively pinned/iu);
});

test('phase attestations recompute tracked source and exact IPA bytes', async (t) => {
  const {
    computeResolvedProductionExpoConfigSha256,
    computeTrackedSourceSha256,
    verifyBuildArtifactAttestation,
    verifyBuildInputAttestation,
    verifyRcAttestation,
  } = await import(guardPath);
  const requestedRoot = mkdtempSync(join(tmpdir(), 'cabohealth-release-phases-'));
  const root = realpathSync(requestedRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const privatePlistRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-private-plist-')));
  const privatePlistPath = join(privatePlistRoot, 'GoogleService-Info.plist');
  const privatePlistBytes = Buffer.from(canonicalGoogleServicesPlist());
  writeFileSync(privatePlistPath, privatePlistBytes, { mode: 0o600 });
  chmodSync(privatePlistPath, 0o600);
  t.after(() => rmSync(privatePlistRoot, { recursive: true, force: true }));
  const previousPlist = process.env.CABOHEALTH_GOOGLE_SERVICES_PLIST;
  const previousProject = process.env.CABOHEALTH_FIREBASE_PROJECT_ID;
  process.env.CABOHEALTH_GOOGLE_SERVICES_PLIST = privatePlistPath;
  process.env.CABOHEALTH_FIREBASE_PROJECT_ID = 'cabohealth-owner-prod';
  t.after(() => {
    if (previousPlist === undefined) delete process.env.CABOHEALTH_GOOGLE_SERVICES_PLIST;
    else process.env.CABOHEALTH_GOOGLE_SERVICES_PLIST = previousPlist;
    if (previousProject === undefined) delete process.env.CABOHEALTH_FIREBASE_PROJECT_ID;
    else process.env.CABOHEALTH_FIREBASE_PROJECT_ID = previousProject;
  });

  const initial = {
    '.gitignore': 'release/private/\nnode_modules\n',
    'app.json': '{"expo":{"version":"3.0","ios":{"buildNumber":"4","bundleIdentifier":"com.cabohealth.app"}}}\n',
    'config/nativeFirebaseExpoConfig.cjs': readFileSync(
      join(projectRoot, 'config/nativeFirebaseExpoConfig.cjs'),
      'utf8',
    ),
    'constants/config.ts': "export const version = '3.0';\nexport const buildNumber = '4';\n",
    'package-lock.json': '{"lockfileVersion":3}\n',
    'release/app-store/3.0/release-manifest.json': '{"status":"ready-for-build"}\n',
    'scripts/verify-release-v3.mjs': 'process.exitCode = 0;\n',
    'scripts/verify-app-store-metadata.mjs': 'process.exitCode = 0;\n',
    'scripts/release-command-guard.mjs': [
      'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
      'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
      'const RC_ATTESTATION_SHA256 = null;',
      'const PINNED_EAS_CLI = null;',
      'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
      "export const guardedBehavior = 'reviewed';",
      '',
    ].join('\n'),
    'release/app-store/3.0/build-input-attestation.json': '{}\n',
    'release/app-store/3.0/build-artifact-attestation.json': '{}\n',
    'release/app-store/3.0/rc-attestation.json': '{}\n',
    'release/app-store/3.0/screenshots-manifest.json': '{"captures":[]}\n',
  };
  for (const [path, value] of Object.entries(initial)) write(root, path, value);
  symlinkSync(join(projectRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'fixture');

  const sourceTreeSha256 = computeTrackedSourceSha256(root);
  const buildInput = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-attestation',
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '4',
    },
    sourceTreeSha256,
    appJsonSha256: hash(readFileSync(join(root, 'app.json'))),
    configSha256: hash(readFileSync(join(root, 'constants/config.ts'))),
    packageLockSha256: hash(readFileSync(join(root, 'package-lock.json'))),
    releaseManifestSha256: hash(readFileSync(
      join(root, 'release/app-store/3.0/release-manifest.json'),
    )),
    releaseVerifierSha256: hash(readFileSync(join(root, 'scripts/verify-release-v3.mjs'))),
    metadataVerifierSha256: hash(readFileSync(
      join(root, 'scripts/verify-app-store-metadata.mjs'),
    )),
    firebaseProjectId: 'cabohealth-owner-prod',
    googleServicesPlistSha256: hash(privatePlistBytes),
    resolvedProductionExpoConfigSha256: computeResolvedProductionExpoConfigSha256(
      root,
      privatePlistBytes,
    ),
    reviewedAt: '2026-08-22T08:00:00.000Z',
  };
  const buildInputBytes = Buffer.from(`${JSON.stringify(buildInput)}\n`);
  write(root, 'release/app-store/3.0/build-input-attestation.json', buildInputBytes);
  git(root, 'add', 'release/app-store/3.0/build-input-attestation.json');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'pin build input');
  const buildInputSha256 = hash(buildInputBytes);
  assert.deepEqual(
    verifyBuildInputAttestation(root, buildInputSha256),
    buildInput,
  );
  writeFileSync(
    privatePlistPath,
    privatePlistBytes.toString('utf8').replace('cabohealth-owner-prod', 'cabohealth-other'),
    { mode: 0o600 },
  );
  assert.throws(
    () => verifyBuildInputAttestation(root, buildInputSha256),
    /EXACT_BUILD_INPUT_GOOGLE_SERVICES_PLIST_INVALID/u,
  );
  writeFileSync(privatePlistPath, privatePlistBytes, { mode: 0o600 });
  chmodSync(privatePlistPath, 0o600);

  const evidence = {
    'release/private/rc/CaboHealth-3.0-build-4.ipa': Buffer.from('exact ipa bytes'),
    'release/private/rc/signed-entitlements.plist': Buffer.from('<plist>exact</plist>'),
    'release/private/rc/embedded-GoogleService-Info.plist': bplistCreator(
      parsePlist(privatePlistBytes),
    ),
    'release/private/rc/signing-certificate.der': Buffer.from('exact signing certificate'),
    'release/private/rc/embedded.mobileprovision': Buffer.from('exact provisioning profile'),
  };
  evidence['release/private/rc/privacy-report.json'] = canonicalAppleEvidenceBytes(
    exactPrivacyReport({
      ipaSha256: hash(evidence['release/private/rc/CaboHealth-3.0-build-4.ipa']),
      signedEntitlementsSha256: hash(
        evidence['release/private/rc/signed-entitlements.plist'],
      ),
      signingCertificateSha256: hash(evidence['release/private/rc/signing-certificate.der']),
      provisioningProfileSha256: hash(
        evidence['release/private/rc/embedded.mobileprovision'],
      ),
      sourceGoogleServicesPlistSha256: hash(privatePlistBytes),
      embeddedGoogleServicesPlistSha256: hash(
        evidence['release/private/rc/embedded-GoogleService-Info.plist'],
      ),
    }),
  );
  for (const [path, value] of Object.entries(evidence)) write(root, path, value);
  for (const path of Object.keys(evidence)) chmodSync(join(root, path), 0o600);
  const buildArtifact = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-artifact-attestation',
    candidate: buildInput.candidate,
    buildInputAttestationSha256: buildInputSha256,
    sourceTreeSha256,
    easBuildId: '123e4567-e89b-42d3-a456-426614174000',
    ipaSha256: hash(evidence['release/private/rc/CaboHealth-3.0-build-4.ipa']),
    signedEntitlementsSha256: hash(evidence['release/private/rc/signed-entitlements.plist']),
    privacyReportSha256: hash(evidence['release/private/rc/privacy-report.json']),
    embeddedGoogleServicesPlistSha256: hash(
      evidence['release/private/rc/embedded-GoogleService-Info.plist'],
    ),
    signingCertificateSha256: hash(evidence['release/private/rc/signing-certificate.der']),
    embeddedProvisioningProfileSha256: hash(
      evidence['release/private/rc/embedded.mobileprovision'],
    ),
    reviewedAt: '2026-08-22T09:00:00.000Z',
  };
  const buildArtifactBytes = Buffer.from(`${JSON.stringify(buildArtifact)}\n`);
  write(root, 'release/app-store/3.0/build-artifact-attestation.json', buildArtifactBytes);
  git(root, 'add', 'release/app-store/3.0/build-artifact-attestation.json');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'pin build artifact');
  const buildArtifactSha256 = hash(buildArtifactBytes);
  assert.deepEqual(verifyBuildArtifactAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
  }), buildArtifact);

  const finalEvidence = exactRcEvidence(root, {
    sourceTreeSha256,
    testFlightBuildId: '987654321',
  });
  write(
    root,
    'release/private/rc/physical-iphone-qa.json',
    finalEvidence.physicalIphoneQa,
  );
  write(
    root,
    'release/private/rc/app-store-connect-evidence.json',
    finalEvidence.appStoreConnectEvidence,
  );
  write(
    root,
    'release/app-store/3.0/screenshots-manifest.json',
    finalEvidence.screenshotsManifest,
  );
  chmodSync(join(root, 'release/private/rc/physical-iphone-qa.json'), 0o600);
  chmodSync(join(root, 'release/private/rc/app-store-connect-evidence.json'), 0o600);
  const rcAttestation = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-exact-rc-attestation',
    candidate: buildInput.candidate,
    buildArtifactAttestationSha256: buildArtifactSha256,
    sourceTreeSha256,
    testFlightBuildId: '987654321',
    testFlightProcessedAt: '2026-08-22T10:00:00.000Z',
    physicalIphoneQaSha256: hash(readFileSync(
      join(root, 'release/private/rc/physical-iphone-qa.json'),
    )),
    screenshotsManifestSha256: hash(readFileSync(
      join(root, 'release/app-store/3.0/screenshots-manifest.json'),
    )),
    appStoreMetadataEvidenceSha256: hash(readFileSync(
      join(root, 'release/private/rc/app-store-connect-evidence.json'),
    )),
    reviewedAt: '2026-08-22T11:00:00.000Z',
  };
  const rcBytes = Buffer.from(`${JSON.stringify(rcAttestation)}\n`);
  write(root, 'release/app-store/3.0/rc-attestation.json', rcBytes);
  git(
    root,
    'add',
    'release/app-store/3.0/rc-attestation.json',
    'release/app-store/3.0/screenshots-manifest.json',
  );
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'pin exact RC');
  const rcSha256 = hash(rcBytes);
  assert.deepEqual(verifyRcAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
    rcSha256,
  }), rcAttestation);

  write(root, 'release/app-store/3.0/screenshots-manifest.json', '{"captures":["drift"]}\n');
  git(root, 'add', 'release/app-store/3.0/screenshots-manifest.json');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'drift screenshot evidence');
  assert.throws(() => verifyRcAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
    rcSha256,
  }), /EXACT_RC_ATTESTATION_INVALID/u);

  write(root, 'release/private/rc/CaboHealth-3.0-build-4.ipa', 'drifted ipa bytes');
  assert.throws(() => verifyBuildArtifactAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
  }), /EXACT_BUILD_ARTIFACT_ATTESTATION_INVALID/u);

  write(root, 'app.json', '{"expo":{"version":"9.9"}}\n');
  assert.throws(
    () => verifyBuildInputAttestation(root, buildInputSha256),
    /BUILD_SOURCE_NOT_CLEAN|EXACT_BUILD_INPUT_ATTESTATION_INVALID/u,
  );
});

test('the pinned CLI runner receives the exact build and local-IPA upload arguments', async (t) => {
  const { easArgumentsForAction, executeNodeProgram } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeCli = join(root, 'fake-eas.mjs');
  const output = join(root, 'argv.json');
  writeFileSync(fakeCli, [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.CABOHEALTH_FAKE_EAS_OUTPUT, JSON.stringify(process.argv.slice(2)));",
  ].join('\n'));
  const previous = process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
  process.env.CABOHEALTH_FAKE_EAS_OUTPUT = output;
  t.after(() => {
    if (previous === undefined) delete process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
    else process.env.CABOHEALTH_FAKE_EAS_OUTPUT = previous;
  });

  const buildArgs = easArgumentsForAction('build');
  executeNodeProgram(root, fakeCli, buildArgs, 'EAS');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), [
    'build',
    '--platform', 'ios',
    '--profile', 'production',
    '--freeze-credentials',
    '--non-interactive',
  ]);

  const privateIpaPath = join(root, 'private-upload/CaboHealth-3.0-build-4.ipa');
  const uploadArgs = easArgumentsForAction('upload-testflight', { ipaPath: privateIpaPath });
  executeNodeProgram(root, fakeCli, uploadArgs, 'EAS');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), [
    'submit',
    '--platform', 'ios',
    '--path', privateIpaPath,
    '--non-interactive',
  ]);
  assert.ok(!uploadArgs.includes('--id'));
});

test('the pinned Node runner removes preload and module-path injection variables', async (t) => {
  const { executeNodeProgram } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-clean-env-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeCli = join(root, 'capture-env.mjs');
  const output = join(root, 'env.json');
  writeFileSync(fakeCli, [
    "import { writeFileSync } from 'node:fs';",
    "const keys = ['NODE_OPTIONS','NODE_PATH','npm_config_node_options','DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH','LD_PRELOAD','LD_LIBRARY_PATH'];",
    "writeFileSync(process.env.CABOHEALTH_FAKE_EAS_OUTPUT, JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));",
  ].join('\n'));
  const keys = [
    'NODE_OPTIONS',
    'NODE_PATH',
    'npm_config_node_options',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousOutput = process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
  for (const key of keys) process.env[key] = '/unreviewed/injection';
  process.env.CABOHEALTH_FAKE_EAS_OUTPUT = output;
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (previousOutput === undefined) delete process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
    else process.env.CABOHEALTH_FAKE_EAS_OUTPUT = previousOutput;
  });

  executeNodeProgram(root, fakeCli, [], 'Pinned tool');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')),
    Object.fromEntries(keys.map((key) => [key, null])));
});
