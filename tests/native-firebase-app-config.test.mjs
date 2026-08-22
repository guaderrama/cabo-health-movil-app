import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  buildNativeFirebaseExpoConfig,
} = require('../config/nativeFirebaseExpoConfig.cjs');

const BASE_CONFIG = Object.freeze({
  name: 'CaboHealth',
  slug: 'cabohealth',
  ios: Object.freeze({ bundleIdentifier: 'com.cabohealth.app' }),
  plugins: Object.freeze(['expo-router']),
  extra: Object.freeze({ eas: Object.freeze({ projectId: 'eas-project' }) }),
});
const APP_ATTEST_ENTITLEMENT = 'com.apple.developer.devicecheck.appattest-environment';

test('staging and production Expo configs fail before build when the service plist is missing', () => {
  for (const appEnvironment of ['staging', 'production']) {
    assert.throws(() => buildNativeFirebaseExpoConfig({
      baseConfig: BASE_CONFIG,
      env: { APP_ENV: appEnvironment },
      fileExists: () => false,
      readFile: () => { throw new Error('must not read'); },
      projectRoot: '/project',
    }), /CABOHEALTH_GOOGLE_SERVICES_PLIST/u);
  }
});

test('a matching dedicated service plist enables the native plugins and runtime contract', () => {
  const serviceFile = '/secure/production/GoogleService-Info.plist';
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
  <plist><dict>
    <key>PROJECT_ID</key><string>cabohealth-prod</string>
    <key>BUNDLE_ID</key><string>com.cabohealth.app</string>
  </dict></plist>`;
  const config = buildNativeFirebaseExpoConfig({
    baseConfig: BASE_CONFIG,
    env: {
      APP_ENV: 'production',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-prod',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: serviceFile,
    },
    fileExists: (path) => path === serviceFile,
    readFile: (path) => {
      assert.equal(path, serviceFile);
      return plist;
    },
    projectRoot: '/project',
  });

  assert.equal(config.ios.googleServicesFile, serviceFile);
  assert.equal(config.ios.entitlements[APP_ATTEST_ENTITLEMENT], 'production');
  assert.deepEqual(config.ios.privacyManifests, {
    NSPrivacyTracking: false,
    NSPrivacyTrackingDomains: [],
  });
  assert.deepEqual(config.extra.clientAccessRuntime, {
    appCheckDebugEnabled: false,
    appEnvironment: 'production',
    enabled: true,
    expectedProjectId: 'cabohealth-prod',
    functionsRegion: 'us-central1',
  });
  assert.deepEqual(config.plugins, [
    'expo-router',
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/app-check',
    'expo-secure-store',
    ['expo-build-properties', { ios: {
      privacyManifestAggregationEnabled: true,
      useFrameworks: 'static',
    } }],
  ]);
  assert.equal(JSON.stringify(config).includes('debugToken'), false);
});

test('only credential-enabled staging and production configs receive the App Attest entitlement', () => {
  const serviceFile = '/secure/GoogleService-Info.plist';
  const makeConfig = (appEnvironment) => buildNativeFirebaseExpoConfig({
    baseConfig: BASE_CONFIG,
    env: {
      APP_ENV: appEnvironment,
      CABOHEALTH_FIREBASE_PROJECT_ID: `cabohealth-${appEnvironment}`,
      CABOHEALTH_GOOGLE_SERVICES_PLIST: serviceFile,
    },
    fileExists: () => true,
    readFile: () => `
      <key>PROJECT_ID</key><string>cabohealth-${appEnvironment}</string>
      <key>BUNDLE_ID</key><string>com.cabohealth.app</string>`,
  });

  for (const appEnvironment of ['staging', 'production']) {
    assert.equal(
      makeConfig(appEnvironment).ios.entitlements[APP_ATTEST_ENTITLEMENT],
      'production',
    );
  }
  assert.equal(makeConfig('development').ios.entitlements?.[APP_ATTEST_ENTITLEMENT], undefined);
  const disabled = buildNativeFirebaseExpoConfig({
    baseConfig: BASE_CONFIG,
    env: { APP_ENV: 'development' },
    fileExists: () => false,
    readFile: () => { throw new Error('must not read'); },
  });
  assert.equal(disabled.ios.entitlements?.[APP_ATTEST_ENTITLEMENT], undefined);
});

test('resolved Expo configs expose App Attest only for credential-enabled production', () => {
  const publicResult = resolveExpoConfig({
    APP_ENV: 'development',
    CABOHEALTH_FIREBASE_PROJECT_ID: '',
    CABOHEALTH_GOOGLE_SERVICES_PLIST: '',
  });
  assert.equal(publicResult.status, 0, publicResult.stderr);
  const publicConfig = JSON.parse(publicResult.stdout);
  assert.equal(publicConfig.ios.entitlements?.[APP_ATTEST_ENTITLEMENT], undefined);

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'cabohealth-app-attest-'));
  const serviceFile = join(fixtureRoot, 'GoogleService-Info.plist');
  writeFileSync(serviceFile, `
    <key>PROJECT_ID</key><string>cabohealth-prod</string>
    <key>BUNDLE_ID</key><string>com.cabohealth.app</string>`, 'utf8');
  try {
    const productionResult = resolveExpoConfig({
      APP_ENV: 'production',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-prod',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: serviceFile,
    });
    assert.equal(productionResult.status, 0, productionResult.stderr);
    const productionConfig = JSON.parse(productionResult.stdout);
    assert.equal(
      productionConfig.ios.entitlements[APP_ATTEST_ENTITLEMENT],
      'production',
    );
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test('App Check debug mode is explicit, development-only, and stores no token in Expo config', () => {
  const plist = `
    <key>PROJECT_ID</key><string>cabohealth-dev</string>
    <key>BUNDLE_ID</key><string>com.cabohealth.app</string>`;
  const common = {
    baseConfig: BASE_CONFIG,
    fileExists: () => true,
    readFile: () => plist,
    projectRoot: '/project',
  };
  const development = buildNativeFirebaseExpoConfig({
    ...common,
    env: {
      APP_ENV: 'development',
      CABOHEALTH_APP_CHECK_DEBUG: 'true',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-dev',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: '/secure/development.plist',
    },
  });
  assert.equal(development.extra.clientAccessRuntime.appCheckDebugEnabled, true);
  assert.equal(JSON.stringify(development).includes('debugToken'), false);

  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    env: {
      APP_ENV: 'production',
      CABOHEALTH_APP_CHECK_DEBUG: 'true',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-prod',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: '/secure/production.plist',
    },
    readFile: () => plist.replaceAll('cabohealth-dev', 'cabohealth-prod'),
  }), /debug.+development/iu);
});

test('Expo config rejects service files whose project or bundle identity does not match', () => {
  const common = {
    baseConfig: BASE_CONFIG,
    env: {
      APP_ENV: 'production',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-prod',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: '/secure/production.plist',
    },
    fileExists: () => true,
    projectRoot: '/project',
  };
  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    readFile: () => `
      <key>PROJECT_ID</key><string>cabohealth-other</string>
      <key>BUNDLE_ID</key><string>com.cabohealth.app</string>`,
  }), /PROJECT_ID/u);
  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    readFile: () => `
      <key>PROJECT_ID</key><string>cabohealth-prod</string>
      <key>BUNDLE_ID</key><string>com.someone.else</string>`,
  }), /BUNDLE_ID/u);
  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    env: { ...common.env, CABOHEALTH_FIREBASE_PROJECT_ID: 'unrelated-prod' },
    readFile: () => '',
  }), /dedicated CaboHealth project/u);
});

function resolveExpoConfig(environment) {
  return spawnSync(
    process.execPath,
    ['node_modules/expo/bin/cli', 'config', '--type', 'prebuild', '--json'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...environment },
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}
