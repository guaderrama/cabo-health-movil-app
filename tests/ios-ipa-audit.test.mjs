import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  IpaAuditError,
  auditExtractedApplication,
  auditIpa,
  canonicalJsonBytes,
  parseCliArguments,
} from '../scripts/audit-ios-ipa.mjs';
import { validateIpaPrivacyReport } from '../scripts/apple-post-build-evidence.mjs';

const require = createRequire(import.meta.url);
const { stringify: stringifyPlist } = require('simple-plist');

const EXPECTED = Object.freeze({
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '5',
  teamIdentifier: 'DQ8PH2DZ3R',
  firebaseProjectId: 'cabohealth-owner-prod',
  appAttestEnvironment: 'production',
  associatedDomains: ['applinks:cabohealth.org'],
});

const CERTIFICATE = Buffer.from('synthetic-distribution-certificate');
const GENERATED_AT = '2026-08-25T22:00:00.000Z';

function plist(value) {
  return Buffer.from(stringifyPlist(value), 'utf8');
}

function googleServicesPlist(overrides = {}) {
  return plist({
    API_KEY: 'synthetic-not-a-secret',
    BUNDLE_ID: EXPECTED.bundleIdentifier,
    CLIENT_ID: 'synthetic.apps.example.invalid',
    GOOGLE_APP_ID: '1:000000000000:ios:0000000000000000',
    GCM_SENDER_ID: '000000000000',
    PROJECT_ID: EXPECTED.firebaseProjectId,
    ...overrides,
  });
}

function signedEntitlements(overrides = {}) {
  return {
    'application-identifier': `${EXPECTED.teamIdentifier}.${EXPECTED.bundleIdentifier}`,
    'beta-reports-active': true,
    'com.apple.developer.associated-domains': [...EXPECTED.associatedDomains],
    'com.apple.developer.devicecheck.appattest-environment': 'production',
    'com.apple.developer.team-identifier': EXPECTED.teamIdentifier,
    'get-task-allow': false,
    ...overrides,
  };
}

function provisioningProfile(overrides = {}) {
  return {
    ApplicationIdentifierPrefix: [EXPECTED.teamIdentifier],
    DeveloperCertificates: [CERTIFICATE],
    Entitlements: {
      'application-identifier': `${EXPECTED.teamIdentifier}.${EXPECTED.bundleIdentifier}`,
      'beta-reports-active': true,
      'com.apple.developer.associated-domains': '*',
      'com.apple.developer.devicecheck.appattest-environment': ['development', 'production'],
      'com.apple.developer.team-identifier': EXPECTED.teamIdentifier,
      'get-task-allow': false,
    },
    ExpirationDate: new Date('2030-01-01T00:00:00.000Z'),
    Name: 'Synthetic App Store profile',
    Platform: ['iOS'],
    TeamIdentifier: [EXPECTED.teamIdentifier],
    UUID: '00000000-0000-4000-8000-000000000004',
    ...overrides,
  };
}

function privacyManifest() {
  return {
    NSPrivacyAccessedAPITypes: [{
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    }],
    NSPrivacyCollectedDataTypes: [{
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypePurposes: [
        'NSPrivacyCollectedDataTypePurposeAppFunctionality',
      ],
      NSPrivacyCollectedDataTypeTracking: false,
    }],
    NSPrivacyTracking: false,
    NSPrivacyTrackingDomains: [],
  };
}

function createFixtureTree(root, {
  binary = Buffer.from('synthetic signed executable without protected APIs'),
  embeddedGoogleServices = googleServicesPlist(),
  infoOverrides = {},
  includeRootPrivacyManifest = true,
} = {}) {
  const app = join(root, 'Payload', 'CaboHealth.app');
  mkdirSync(join(app, 'Frameworks', 'Synthetic.framework'), { recursive: true, mode: 0o700 });
  mkdirSync(join(app, 'FirebaseAuth_Privacy.bundle'), { recursive: true, mode: 0o700 });
  writeFileSync(join(app, 'Info.plist'), plist({
    CFBundleExecutable: 'CaboHealth',
    CFBundleIdentifier: EXPECTED.bundleIdentifier,
    CFBundleShortVersionString: EXPECTED.marketingVersion,
    CFBundleVersion: EXPECTED.buildNumber,
    WKAppBoundDomains: ['cabohealth.org'],
    ...infoOverrides,
  }), { mode: 0o600 });
  writeFileSync(join(app, 'CaboHealth'), binary, { mode: 0o700 });
  writeFileSync(join(app, 'GoogleService-Info.plist'), embeddedGoogleServices, { mode: 0o600 });
  writeFileSync(join(app, 'embedded.mobileprovision'), Buffer.from('synthetic cms'), {
    mode: 0o600,
  });
  if (includeRootPrivacyManifest) {
    writeFileSync(join(app, 'PrivacyInfo.xcprivacy'), plist(privacyManifest()), { mode: 0o600 });
  }
  writeFileSync(
    join(app, 'Frameworks', 'Synthetic.framework', 'PrivacyInfo.xcprivacy'),
    plist({
      NSPrivacyAccessedAPITypes: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(app, 'FirebaseAuth_Privacy.bundle', 'PrivacyInfo.xcprivacy'),
    plist({
      NSPrivacyAccessedAPITypes: [{
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
        NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
      }],
      NSPrivacyCollectedDataTypes: [{
        NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
        NSPrivacyCollectedDataTypeLinked: false,
        NSPrivacyCollectedDataTypePurposes: [
          'NSPrivacyCollectedDataTypePurposeAnalytics',
        ],
        NSPrivacyCollectedDataTypeTracking: false,
      }, {
        NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypePurposes: [
          'NSPrivacyCollectedDataTypePurposeAppFunctionality',
        ],
        NSPrivacyCollectedDataTypeTracking: false,
      }],
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
    }),
    { mode: 0o600 },
  );
  return app;
}

function commandRunner({
  entitlements = signedEntitlements(),
  profile = provisioningProfile(),
  details = [
    `Identifier=${EXPECTED.bundleIdentifier}`,
    'Authority=Apple Distribution: Synthetic Reviewer (DQ8PH2DZ3R)',
    'Authority=Apple Worldwide Developer Relations Certification Authority',
    `TeamIdentifier=${EXPECTED.teamIdentifier}`,
    '',
  ].join('\n'),
} = {}) {
  return (command, arguments_) => {
    if (command === '/usr/bin/codesign' && arguments_[0] === '--verify') {
      return { ok: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    if (command === '/usr/bin/codesign' && arguments_.includes('--verbose=4')) {
      return { ok: true, stdout: Buffer.alloc(0), stderr: Buffer.from(details) };
    }
    if (command === '/usr/bin/codesign' && arguments_.includes('--entitlements')) {
      return { ok: true, stdout: plist(entitlements), stderr: Buffer.alloc(0) };
    }
    const certificateArgument = arguments_.find((argument) => (
      argument.startsWith('--extract-certificates=')
    ));
    if (command === '/usr/bin/codesign' && certificateArgument) {
      const prefix = certificateArgument.slice('--extract-certificates='.length);
      writeFileSync(`${prefix}0`, CERTIFICATE, { mode: 0o600 });
      return { ok: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    if (command === '/usr/bin/security' && arguments_[0] === 'cms') {
      return { ok: true, stdout: plist(profile), stderr: Buffer.alloc(0) };
    }
    return { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
}

function withFixture(options, callback) {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-ipa-audit-test.'));
  chmodSync(root, 0o700);
  try {
    createFixtureTree(root, options);
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function auditFixture(root, overrides = {}) {
  return auditExtractedApplication({
    ipaBytes: Buffer.from('synthetic ipa bytes'),
    sourceGoogleServicesPlistBytes: googleServicesPlist(),
    extractionRoot: root,
    expected: EXPECTED,
    generatedAt: GENERATED_AT,
    commandRunner: commandRunner(),
    ...overrides,
  });
}

test('a conforming extracted app produces the exact canonical, secret-free evidence contract', () => {
  withFixture({}, (root) => {
    const first = auditFixture(root);
    const evidenceBytes = canonicalJsonBytes(first.evidence);
    const evidenceText = evidenceBytes.toString('utf8');
    assert.deepEqual(Object.keys(first.evidence).sort(), [
      'artifactKind',
      'candidate',
      'failures',
      'firebase',
      'forbiddenPayloadStrings',
      'generatedAt',
      'inventory',
      'ipaSha256',
      'privacyManifests',
      'protectedResources',
      'schemaVersion',
      'sensitiveFrameworks',
      'sensitivePermissions',
      'signature',
      'status',
      'tracking',
    ].sort());
    assert.equal(first.evidence.artifactKind, 'cabohealth-ipa-privacy-report');
    assert.equal(first.evidence.status, 'passed');
    assert.equal(first.evidence.generatedAt, GENERATED_AT);
    assert.equal(first.evidence.candidate.bundleIdentifier, EXPECTED.bundleIdentifier);
    assert.equal(first.evidence.signature.verified, true);
    assert.equal(first.evidence.firebase.semanticEquality, true);
    assert.equal(first.evidence.inventory.privacyManifestCount, 3);
    assert.equal(first.evidence.inventory.files.length, first.evidence.inventory.fileCount);
    assert.deepEqual(Object.keys(first.evidence.inventory).sort(), [
      'fileCount', 'files', 'privacyManifestCount',
    ]);
    assert.ok(first.evidence.inventory.files.every((entry) => (
      JSON.stringify(Object.keys(entry).sort())
        === JSON.stringify(['relativePath', 'sha256', 'size'].sort())
      && Number.isSafeInteger(entry.size)
      && /^[a-f0-9]{64}$/u.test(entry.sha256)
    )));
    assert.deepEqual(
      first.evidence.inventory.files.map((entry) => entry.relativePath),
      first.evidence.inventory.files.map((entry) => entry.relativePath).toSorted(),
    );
    assert.deepEqual(first.evidence.sensitivePermissions, {
      photos: false,
      camera: false,
      microphone: false,
      location: false,
      healthKit: false,
    });
    assert.deepEqual(first.evidence.sensitiveFrameworks, []);
    assert.deepEqual(first.evidence.forbiddenPayloadStrings, []);
    assert.deepEqual(first.evidence.failures, []);
    assert.equal(first.evidence.tracking, false);
    assert.deepEqual(
      first.evidence.privacyManifests.map((entry) => entry.relativePath),
      [
        'FirebaseAuth_Privacy.bundle/PrivacyInfo.xcprivacy',
        'Frameworks/Synthetic.framework/PrivacyInfo.xcprivacy',
        'PrivacyInfo.xcprivacy',
      ],
    );
    const firebaseAuth = first.evidence.privacyManifests[0];
    assert.ok(first.evidence.privacyManifests.every((entry) => (
      JSON.stringify(Object.keys(entry).sort()) === JSON.stringify([
        'apis', 'dataTypes', 'relativePath', 'sha256', 'tracking', 'trackingDomains',
      ].sort())
    )));
    assert.deepEqual(firebaseAuth.dataTypes, [{
      dataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
      linked: false,
      purposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
      tracking: false,
    }, {
      dataType: 'NSPrivacyCollectedDataTypeUserID',
      linked: true,
      purposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      tracking: false,
    }]);
    assert.match(evidenceText, /cabohealth-ipa-privacy-report/u);
    assert.doesNotMatch(evidenceText, /synthetic-not-a-secret|GOOGLE_APP_ID|API_KEY/u);
    assert.deepEqual(evidenceBytes, canonicalJsonBytes(first.evidence));
    assert.equal(validateIpaPrivacyReport(first.evidence, {}, {
      now: Date.parse(GENERATED_AT) + 1,
    }), first.evidence);
  });
});

test('Firebase plist comparison is semantic and rejects any dictionary drift', () => {
  withFixture({
    embeddedGoogleServices: googleServicesPlist({ API_KEY: 'different-value' }),
  }, (root) => {
    assert.throws(() => auditFixture(root), (error) => (
      error instanceof IpaAuditError && error.message === 'IPA_FIREBASE_PLIST_CONTENT_MISMATCH'
    ));
  });
});

test('signature identities, App Attest, and associated domains fail closed', () => {
  withFixture({ infoOverrides: { CFBundleVersion: '6' } }, (root) => {
    assert.throws(() => auditFixture(root), /IPA_BUNDLE_IDENTITY_MISMATCH/u);
  });
  withFixture({}, (root) => {
    const validRunner = commandRunner();
    assert.throws(() => auditFixture(root, {
      commandRunner: (command, arguments_) => (
        command === '/usr/bin/codesign' && arguments_[0] === '--verify'
          ? { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.from('not exposed') }
          : validRunner(command, arguments_)
      ),
    }), /IPA_CODE_SIGNATURE_INVALID/u);
  });
  withFixture({}, (root) => {
    assert.throws(() => auditFixture(root, {
      commandRunner: commandRunner({
        entitlements: signedEntitlements({
          'com.apple.developer.devicecheck.appattest-environment': 'development',
        }),
      }),
    }), /IPA_SIGNED_ENTITLEMENTS_MISMATCH/u);
  });
  withFixture({}, (root) => {
    assert.throws(() => auditFixture(root, {
      commandRunner: commandRunner({
        entitlements: signedEntitlements({
          'com.apple.developer.associated-domains': ['applinks:evil.example'],
        }),
      }),
    }), /IPA_SIGNED_ENTITLEMENTS_MISMATCH/u);
  });
  withFixture({}, (root) => {
    assert.throws(() => auditFixture(root, {
      commandRunner: commandRunner({
        details: 'Identifier=com.cabohealth.other\nAuthority=Apple Distribution: Synthetic\nTeamIdentifier=DQ8PH2DZ3R\n',
      }),
    }), /IPA_CODESIGN_IDENTITY_MISMATCH/u);
  });
  withFixture({}, (root) => {
    assert.throws(() => auditFixture(root, {
      commandRunner: commandRunner({
        profile: provisioningProfile({ TeamIdentifier: ['AAAAAAAAAA'] }),
      }),
    }), /IPA_PROVISIONING_PROFILE_MISMATCH/u);
  });
});

test('purpose strings and protected-resource references are independently rejected', () => {
  withFixture({ infoOverrides: { NSCameraUsageDescription: 'not allowed' } }, (root) => {
    assert.throws(() => auditFixture(root), /IPA_PROTECTED_RESOURCE_PURPOSE_STRING_PRESENT/u);
  });
  for (const [marker, code] of [
    ['Photos.framework', 'IPA_FORBIDDEN_PHOTOS_REFERENCE'],
    ['AVCaptureDevice', 'IPA_FORBIDDEN_CAMERA_REFERENCE'],
    ['AVAudioRecorder', 'IPA_FORBIDDEN_MICROPHONE_REFERENCE'],
    ['CLLocationManager', 'IPA_FORBIDDEN_LOCATION_REFERENCE'],
    ['HKHealthStore', 'IPA_FORBIDDEN_HEALTH_KIT_REFERENCE'],
    ['PodsDummy_ExpoFileSystem', 'IPA_FORBIDDEN_EXPO_FILE_SYSTEM_REFERENCE'],
    ['Miniapp test panel', 'IPA_FORBIDDEN_DEV_PANEL_REFERENCE'],
    ['https://cabohealth.org/staff/', 'IPA_FORBIDDEN_STAFF_URL_REFERENCE'],
  ]) {
    withFixture({ binary: Buffer.from(`binary:${marker}`) }, (root) => {
      assert.throws(() => auditFixture(root), (error) => (
        error instanceof IpaAuditError && error.message === code
      ), marker);
    });
  }
});

test('concrete Expo FileSystem module signatures are independently rejected', () => {
  for (const marker of [
    'EXFileSystemLocalFileHandler',
    'ExponentFileSystem',
    'ExpoFileSystem/FileSystemModule.swift',
    'ExpoFileSystem_privacy.bundle',
    'PodsDummy_ExpoFileSystem',
    '_TtC14ExpoFileSystem16FileSystemModule',
  ]) {
    withFixture({ binary: Buffer.from(`binary:${marker}`) }, (root) => {
      assert.throws(() => auditFixture(root), (error) => (
        error instanceof IpaAuditError
          && error.message === 'IPA_FORBIDDEN_EXPO_FILE_SYSTEM_REFERENCE'
      ), marker);
    });
  }
});

test('ExpoModulesCore filesystem interfaces do not impersonate the excluded module', () => {
  const coreOnlyMarkers = [
    'EXFileSystemInterface',
    'EXFileSystemLegacyUtilities',
    "FileSystem module not found, make sure 'expo-file-system' is linked correctly",
    'FileSystemModuleNotFound',
    'So21EXFileSystemInterface_p',
    '_TtCV15ExpoModulesCore10Exceptions24FileSystemModuleNotFound',
  ];
  withFixture({ binary: Buffer.from(coreOnlyMarkers.join('\0')) }, (root) => {
    assert.equal(auditFixture(root).evidence.status, 'passed');
  });
});

test('privacy inventory rejects tracking and protected-resource data declarations', () => {
  withFixture({}, (root) => {
    const privacyPath = join(root, 'Payload', 'CaboHealth.app', 'PrivacyInfo.xcprivacy');
    writeFileSync(privacyPath, plist({ ...privacyManifest(), NSPrivacyTracking: true }));
    assert.throws(() => auditFixture(root), /IPA_PRIVACY_TRACKING_PRESENT/u);
  });
  withFixture({}, (root) => {
    const privacyPath = join(root, 'Payload', 'CaboHealth.app', 'PrivacyInfo.xcprivacy');
    const manifest = privacyManifest();
    manifest.NSPrivacyCollectedDataTypes[0].NSPrivacyCollectedDataType =
      'NSPrivacyCollectedDataTypePreciseLocation';
    writeFileSync(privacyPath, plist(manifest));
    assert.throws(() => auditFixture(root), /IPA_FORBIDDEN_LOCATION_PRIVACY_DATA/u);
  });
  withFixture({ includeRootPrivacyManifest: false }, (root) => {
    assert.throws(() => auditFixture(root), /IPA_ROOT_PRIVACY_MANIFEST_MISSING/u);
  });
  withFixture({}, (root) => {
    const privacyPath = join(
      root,
      'Payload',
      'CaboHealth.app',
      'FirebaseAuth_Privacy.bundle',
      'PrivacyInfo.xcprivacy',
    );
    writeFileSync(privacyPath, plist({
      NSPrivacyAccessedAPITypes: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
    }));
    assert.throws(() => auditFixture(root), /IPA_FIREBASE_AUTH_PRIVACY_MANIFEST_MISMATCH/u);
  });
});

test('auditIpa uses a mode-0700 temporary root, cleans it, and atomically writes 0600 inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-ipa-audit-operation.'));
  chmodSync(root, 0o700);
  const fixture = join(root, 'fixture');
  mkdirSync(fixture, { mode: 0o700 });
  createFixtureTree(fixture);
  const ipaPath = join(root, 'candidate.ipa');
  const plistPath = join(root, 'GoogleService-Info.plist');
  const evidencePath = join(root, 'privacy-report.json');
  const inputs = join(root, 'inputs');
  mkdirSync(inputs, { mode: 0o700 });
  writeFileSync(ipaPath, 'synthetic ipa bytes', { mode: 0o600 });
  writeFileSync(plistPath, googleServicesPlist(), { mode: 0o600 });
  let extractionRoot;
  try {
    const result = auditIpa({
      ipaPath,
      googleServicesPlistPath: plistPath,
      outputPath: evidencePath,
      attestationInputDirectory: inputs,
      expected: EXPECTED,
      generatedAt: GENERATED_AT,
    }, {
      temporaryRootParent: root,
      commandRunner: commandRunner(),
      extractArchive: (_source, destination) => {
        extractionRoot = destination;
        assert.equal(statSync(destination).mode & 0o777, 0o700);
        cpSync(join(fixture, 'Payload'), join(destination, 'Payload'), { recursive: true });
      },
    });
    assert.equal(existsSync(extractionRoot), false);
    assert.deepEqual(readFileSync(evidencePath), canonicalJsonBytes(result.evidence));
    for (const name of [
      'privacy-report.json',
      'inputs/signed-entitlements.plist',
      'inputs/embedded-GoogleService-Info.plist',
      'inputs/signing-certificate.der',
      'inputs/embedded.mobileprovision',
    ]) {
      assert.equal(statSync(join(root, name)).mode & 0o777, 0o600, name);
    }
    assert.throws(() => auditIpa({
      ipaPath,
      googleServicesPlistPath: plistPath,
      outputPath: evidencePath,
      expected: EXPECTED,
      generatedAt: GENERATED_AT,
    }, {
      temporaryRootParent: root,
      commandRunner: commandRunner(),
      extractArchive: (_source, destination) => {
        cpSync(join(fixture, 'Payload'), join(destination, 'Payload'), { recursive: true });
      },
    }), /IPA_AUDIT_OUTPUT_INVALID/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the production extractor rejects traversal and symlink archive entries before extraction', () => {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-ipa-archive-preflight.'));
  chmodSync(root, 0o700);
  const ipaPath = join(root, 'candidate.ipa');
  const plistPath = join(root, 'GoogleService-Info.plist');
  writeFileSync(ipaPath, 'synthetic ipa bytes', { mode: 0o600 });
  writeFileSync(plistPath, googleServicesPlist(), { mode: 0o600 });
  const baseInput = {
    ipaPath,
    googleServicesPlistPath: plistPath,
    outputPath: join(root, 'privacy-report.json'),
    expected: EXPECTED,
    generatedAt: GENERATED_AT,
  };
  let extractionAttempted = false;
  try {
    assert.throws(() => auditIpa(baseInput, {
      temporaryRootParent: root,
      commandRunner: (command, arguments_) => {
        if (command === '/usr/bin/unzip' && arguments_[0] === '-Z1') {
          return { ok: true, stdout: Buffer.from('../outside\n'), stderr: Buffer.alloc(0) };
        }
        extractionAttempted = true;
        return { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    }), /IPA_ARCHIVE_ENTRY_INVALID/u);
    assert.equal(extractionAttempted, false);
    assert.equal(readdirSync(root).some((name) => name.startsWith('cabohealth-ipa-audit.')), false);

    assert.throws(() => auditIpa(baseInput, {
      temporaryRootParent: root,
      commandRunner: (command, arguments_) => {
        if (command === '/usr/bin/unzip' && arguments_[0] === '-Z1') {
          return { ok: true, stdout: Buffer.from('Payload/link\n'), stderr: Buffer.alloc(0) };
        }
        if (command === '/usr/bin/unzip' && arguments_[0] === '-Z') {
          return {
            ok: true,
            stdout: Buffer.from(
              'Archive: candidate.ipa\nlrwxr-xr-x  2.1 unx  7 b-  7 stor 26-Aug-25 00:00 Payload/link\n',
            ),
            stderr: Buffer.alloc(0),
          };
        }
        extractionAttempted = true;
        return { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    }), /IPA_ARCHIVE_ENTRY_TYPE_OR_SIZE_INVALID/u);
    assert.equal(extractionAttempted, false);
    assert.equal(readdirSync(root).some((name) => name.startsWith('cabohealth-ipa-audit.')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI parsing requires explicit absolute-path inputs and release identities', () => {
  const parsed = parseCliArguments([
    '--ipa', '/private/candidate.ipa',
    '--google-services-plist', '/private/GoogleService-Info.plist',
    '--bundle-id', EXPECTED.bundleIdentifier,
    '--version', EXPECTED.marketingVersion,
    '--build', EXPECTED.buildNumber,
    '--team-id', EXPECTED.teamIdentifier,
    '--firebase-project-id', EXPECTED.firebaseProjectId,
    '--app-attest-environment', EXPECTED.appAttestEnvironment,
    '--associated-domain', EXPECTED.associatedDomains[0],
    '--generated-at', GENERATED_AT,
    '--output', '/private/privacy-report.json',
  ]);
  assert.equal(parsed.expected.teamIdentifier, EXPECTED.teamIdentifier);
  assert.equal(parsed.generatedAt, GENERATED_AT);
  assert.throws(() => auditExtractedApplication({
    ipaBytes: Buffer.from('synthetic ipa bytes'),
    sourceGoogleServicesPlistBytes: googleServicesPlist(),
    extractionRoot: '/not-read-because-timestamp-is-invalid',
    expected: EXPECTED,
    generatedAt: '2026-08-25',
    commandRunner: commandRunner(),
  }), /IPA_GENERATED_AT_INVALID/u);
  assert.throws(() => parseCliArguments(['--ipa', '/private/candidate.ipa']), (
    error,
  ) => error instanceof IpaAuditError && error.message === 'IPA_AUDIT_ARGUMENTS_INVALID');
});
