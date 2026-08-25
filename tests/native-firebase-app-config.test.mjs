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
  parseGoogleServicesPlistIdentity,
} = require('../config/nativeFirebaseExpoConfig.cjs');

const BASE_CONFIG = Object.freeze({
  name: 'CaboHealth',
  slug: 'cabohealth',
  ios: Object.freeze({ bundleIdentifier: 'com.cabohealth.app' }),
  plugins: Object.freeze(['expo-router']),
  extra: Object.freeze({ eas: Object.freeze({ projectId: 'eas-project' }) }),
});
const APP_ATTEST_ENTITLEMENT = 'com.apple.developer.devicecheck.appattest-environment';

function googleServicesPlist({
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
  const plist = googleServicesPlist();
  const config = buildNativeFirebaseExpoConfig({
    baseConfig: BASE_CONFIG,
    env: {
      APP_ENV: 'production',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-owner-prod',
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
    expectedProjectId: 'cabohealth-owner-prod',
    functionsRegion: 'us-central1',
  });
  assert.deepEqual(config.plugins, [
    'expo-router',
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/app-check',
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-build-properties', { ios: {
      privacyManifestAggregationEnabled: true,
      useFrameworks: 'static',
    } }],
  ]);
  assert.equal(JSON.stringify(config).includes('debugToken'), false);
});

test('only credential-enabled staging and production configs receive the App Attest entitlement', () => {
  const serviceFile = '/secure/GoogleService-Info.plist';
  const projectIdFor = (appEnvironment) => (
    appEnvironment === 'production' ? 'cabohealth-owner-prod' : `cabohealth-${appEnvironment}`
  );
  const makeConfig = (appEnvironment) => buildNativeFirebaseExpoConfig({
    baseConfig: BASE_CONFIG,
    env: {
      APP_ENV: appEnvironment,
      CABOHEALTH_FIREBASE_PROJECT_ID: projectIdFor(appEnvironment),
      CABOHEALTH_GOOGLE_SERVICES_PLIST: serviceFile,
    },
    fileExists: () => true,
    readFile: () => googleServicesPlist({ projectId: projectIdFor(appEnvironment) }),
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
  writeFileSync(serviceFile, googleServicesPlist(), 'utf8');
  try {
    const productionResult = resolveExpoConfig({
      APP_ENV: 'production',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-owner-prod',
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
  const plist = googleServicesPlist({ projectId: 'cabohealth-dev' });
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
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-owner-prod',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: '/secure/production.plist',
    },
    readFile: () => plist.replaceAll('cabohealth-dev', 'cabohealth-owner-prod'),
  }), /debug.+development/iu);
});

test('Expo config rejects service files whose project or bundle identity does not match', () => {
  const common = {
    baseConfig: BASE_CONFIG,
    env: {
      APP_ENV: 'production',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-owner-prod',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: '/secure/production.plist',
    },
    fileExists: () => true,
    projectRoot: '/project',
  };
  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    readFile: () => googleServicesPlist({ projectId: 'cabohealth-other' }),
  }), /PROJECT_ID/u);
  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    readFile: () => googleServicesPlist({ bundleId: 'com.someone.else' }),
  }), /BUNDLE_ID/u);
  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    env: { ...common.env, CABOHEALTH_FIREBASE_PROJECT_ID: 'unrelated-prod' },
    readFile: () => '',
  }), /dedicated CaboHealth project/u);
  assert.throws(() => buildNativeFirebaseExpoConfig({
    ...common,
    env: { ...common.env, CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-other' },
    readFile: () => googleServicesPlist({ projectId: 'cabohealth-other' }),
  }), /must be cabohealth-owner-prod for production/u);
});

test('strict Firebase plist parsing follows the root dictionary and XML text semantics', () => {
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<!-- comments between dictionary entries are inert -->',
    '<key>PROJECT_ID</key><!-- comment --><string>cabohealth-owner-pr&#111;d</string>',
    '<key>BUNDLE_ID</key><string>com.cabohealth.&#97;pp</string>',
    '<key>OPTIONAL_FLAG</key><true/>',
    '</dict></plist>',
  ].join('\n');

  assert.deepEqual(parseGoogleServicesPlistIdentity(plist), {
    bundleId: 'com.cabohealth.app',
    projectId: 'cabohealth-owner-prod',
  });
});

test('strict Firebase plist parsing rejects ambiguous and structurally invalid identities', () => {
  const validProject = '<key>PROJECT_ID</key><string>cabohealth-owner-prod</string>';
  const wrongProject = '<key>PROJECT_ID</key><string>cabohealth-other</string>';
  const validBundle = '<key>BUNDLE_ID</key><string>com.cabohealth.app</string>';
  const wrongBundle = '<key>BUNDLE_ID</key><string>com.someone.else</string>';
  const wrap = (entries, prefix = '') => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    prefix,
    '<plist version="1.0"><dict>',
    entries,
    '</dict></plist>',
  ].join('\n');
  const invalidPlists = [
    wrap(`${validProject}${wrongProject}${validBundle}`),
    wrap(`${wrongProject}${validProject}${validBundle}`),
    wrap(`${validProject}${validBundle}${wrongBundle}`),
    wrap(`<key>DECOY</key><dict>${validProject}${validBundle}</dict>${wrongProject}${validBundle}`),
    wrap('<key>PROJECT_ID</key><integer>7</integer><key>DECOY</key><dict>'
      + `${validProject}</dict>${validBundle}`),
    wrap('<key>PROJECT_ID<![CDATA[_DECOY]]></key><string>cabohealth-other</string>'
      + '<key>PROJ<![CDATA[ECT_ID]]></key><string>cabohealth-owner-prod</string>'
      + validBundle),
    wrap(`${validProject}`
      + '<key>BUNDLE_ID<![CDATA[_DECOY]]></key><string>com.other.app</string>'
      + '<key>BUNDLE<![CDATA[_ID]]></key><string>com.cabohealth.app</string>'),
    `<?xml version="1.0"?><plist><dict>${validProject}${validBundle}</dict>`,
    `<plist><dict>${validProject}${validBundle}</dict></plist><plist><dict/></plist>`,
    wrap(`${validProject}${validBundle}`, '<!DOCTYPE plist [<!ENTITY decoy "value">]>'),
    '<not-plist><dict/></not-plist>',
  ];

  for (const plist of invalidPlists) {
    assert.throws(
      () => parseGoogleServicesPlistIdentity(plist),
      /Invalid GoogleService-Info\.plist XML structure/u,
    );
  }
});

test('commented identity decoys do not override the actual root identity', () => {
  const plist = googleServicesPlist({ projectId: 'cabohealth-other' }).replace(
    '<plist version="1.0"><dict>',
    '<plist version="1.0"><dict><!-- <key>PROJECT_ID</key>'
      + '<string>cabohealth-owner-prod</string> -->',
  );
  assert.deepEqual(parseGoogleServicesPlistIdentity(plist), {
    bundleId: 'com.cabohealth.app',
    projectId: 'cabohealth-other',
  });
  assert.throws(() => buildNativeFirebaseExpoConfig({
    baseConfig: BASE_CONFIG,
    env: {
      APP_ENV: 'production',
      CABOHEALTH_FIREBASE_PROJECT_ID: 'cabohealth-owner-prod',
      CABOHEALTH_GOOGLE_SERVICES_PLIST: '/secure/production.plist',
    },
    fileExists: () => true,
    readFile: () => plist,
  }), /PROJECT_ID/u);
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
