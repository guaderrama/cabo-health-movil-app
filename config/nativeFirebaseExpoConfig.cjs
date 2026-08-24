'use strict';

const STRICT_NATIVE_ENVIRONMENTS = new Set(['staging', 'production']);
const APP_ATTEST_ENTITLEMENT = 'com.apple.developer.devicecheck.appattest-environment';

function buildNativeFirebaseExpoConfig({
  baseConfig,
  env,
  fileExists,
  readFile,
}) {
  const appEnvironment = env.APP_ENV || 'development';
  if (!['development', 'staging', 'production'].includes(appEnvironment)) {
    throw new Error(`Unsupported APP_ENV: ${appEnvironment}`);
  }
  const appCheckDebugEnabled = env.CABOHEALTH_APP_CHECK_DEBUG === 'true';
  if (appCheckDebugEnabled && appEnvironment !== 'development') {
    throw new Error('App Check debug mode is allowed only in development builds');
  }
  const serviceFile = env.CABOHEALTH_GOOGLE_SERVICES_PLIST || null;
  if (
    STRICT_NATIVE_ENVIRONMENTS.has(appEnvironment)
    && !serviceFile
  ) {
    throw new Error(
      `CABOHEALTH_GOOGLE_SERVICES_PLIST is required for ${appEnvironment} builds`,
    );
  }
  if (!serviceFile) {
    return {
      ...baseConfig,
      extra: {
        ...(baseConfig.extra || {}),
        clientAccessRuntime: {
          appCheckDebugEnabled,
          appEnvironment,
          enabled: false,
          functionsRegion: 'us-central1',
        },
      },
    };
  }
  if (!fileExists(serviceFile)) {
    throw new Error(`CABOHEALTH_GOOGLE_SERVICES_PLIST does not exist for ${appEnvironment}`);
  }
  const expectedProjectId = env.CABOHEALTH_FIREBASE_PROJECT_ID || '';
  if (!isDedicatedCaboHealthProjectId(expectedProjectId)) {
    throw new Error('CABOHEALTH_FIREBASE_PROJECT_ID must identify a dedicated CaboHealth project');
  }
  const plist = readFile(serviceFile);
  const plistProjectId = readPlistString(plist, 'PROJECT_ID');
  const plistBundleId = readPlistString(plist, 'BUNDLE_ID');
  if (plistProjectId !== expectedProjectId) {
    throw new Error('GoogleService-Info.plist PROJECT_ID does not match this build environment');
  }
  if (plistBundleId !== baseConfig.ios?.bundleIdentifier) {
    throw new Error('GoogleService-Info.plist BUNDLE_ID does not match the iOS bundle identifier');
  }

  return {
    ...baseConfig,
    ios: {
      ...(baseConfig.ios || {}),
      googleServicesFile: serviceFile,
      ...(STRICT_NATIVE_ENVIRONMENTS.has(appEnvironment) ? {
        entitlements: {
          ...(baseConfig.ios?.entitlements || {}),
          [APP_ATTEST_ENTITLEMENT]: 'production',
        },
      } : {}),
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
      },
    },
    plugins: [
      ...(baseConfig.plugins || []),
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      '@react-native-firebase/app-check',
      ['expo-secure-store', { faceIDPermission: false }],
      ['expo-build-properties', { ios: {
        privacyManifestAggregationEnabled: true,
        useFrameworks: 'static',
      } }],
    ],
    extra: {
      ...(baseConfig.extra || {}),
      clientAccessRuntime: {
        appCheckDebugEnabled,
        appEnvironment,
        enabled: true,
        expectedProjectId,
        functionsRegion: 'us-central1',
      },
    },
  };
}

function isDedicatedCaboHealthProjectId(value) {
  return /^cabohealth-[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/u.test(value);
}

function readPlistString(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(
    `<key>\\s*${escapedKey}\\s*</key>\\s*<string>\\s*([^<]+?)\\s*</string>`,
    'u',
  ).exec(source);
  return match?.[1] ?? null;
}

module.exports = { buildNativeFirebaseExpoConfig };
