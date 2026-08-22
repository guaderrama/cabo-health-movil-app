import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNativeClientAccessRuntime,
  parseNativeClientAccessEnvironment,
} from '../.test-build/features/clientAccess/nativeClientAccessRuntime.js';

test('unsupported or unconfigured runtimes stay locked without loading Firebase', async () => {
  let bridgeLoads = 0;
  const loadBridge = async () => {
    bridgeLoads += 1;
    throw new Error('Firebase must not load');
  };

  const common = {
    loadBridge,
    secureStorage: {
      getItem: async () => null,
      setItem: async () => {},
      deleteItem: async () => {},
    },
    randomBytes: async (length) => new Uint8Array(length),
    createRequestId: () => 'request_abcdefghijklmnop',
  };

  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    environment: {
      platform: 'web',
      isExpoGo: false,
      enabled: true,
      appEnvironment: 'production',
      expectedProjectId: 'cabohealth-prod',
    },
  }), null);
  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    environment: {
      platform: 'ios',
      isExpoGo: true,
      enabled: true,
      appEnvironment: 'production',
      expectedProjectId: 'cabohealth-prod',
    },
  }), null);
  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    environment: {
      platform: 'ios',
      isExpoGo: false,
      enabled: false,
      appEnvironment: 'development',
      expectedProjectId: null,
    },
  }), null);
  assert.equal(bridgeLoads, 0);
});

test('a configured production build initializes real attestation before exposing access', async () => {
  const events = [];
  const bridge = {
    projectId: 'cabohealth-prod',
    initializeAppCheck: async (options) => { events.push(['appCheck', options]); },
    auth: {
      waitForReady: async () => null,
      currentUser: () => null,
      signInWithCustomToken: async () => ({ uid: 'client_abcdefghijklmnopqrstuvwxyz123456' }),
      signOut: async () => {},
    },
    functionsForRegion: (region) => {
      events.push(['functions', region]);
      return { call: async () => { throw new Error('not used'); } };
    },
  };

  const runtime = await createNativeClientAccessRuntime({
    environment: {
      platform: 'ios',
      isExpoGo: false,
      enabled: true,
      appEnvironment: 'production',
      expectedProjectId: 'cabohealth-prod',
      functionsRegion: 'us-central1',
    },
    loadBridge: async () => bridge,
    secureStorage: {
      getItem: async () => null,
      setItem: async () => {},
      deleteItem: async () => {},
    },
    randomBytes: async (length) => new Uint8Array(length),
    createRequestId: () => 'request_abcdefghijklmnop',
  });

  assert.ok(runtime);
  assert.deepEqual(events, [
    ['appCheck', {
      androidProvider: 'playIntegrity',
      appleProvider: 'appAttestWithDeviceCheckFallback',
      tokenAutoRefreshEnabled: true,
    }],
    ['functions', 'us-central1'],
  ]);
});

test('a mismatched or non-CaboHealth native Firebase project fails closed before App Check', async () => {
  let appCheckCalls = 0;
  const makeBridge = (projectId) => ({
    projectId,
    initializeAppCheck: async () => { appCheckCalls += 1; },
    auth: {
      waitForReady: async () => null,
      currentUser: () => null,
      signInWithCustomToken: async () => ({ uid: 'client_abcdefghijklmnopqrstuvwxyz123456' }),
      signOut: async () => {},
    },
    functionsForRegion: () => ({ call: async () => null }),
  });
  const common = {
    secureStorage: {
      getItem: async () => null,
      setItem: async () => {},
      deleteItem: async () => {},
    },
    randomBytes: async (length) => new Uint8Array(length),
    createRequestId: () => 'request_abcdefghijklmnop',
  };
  const environment = {
    platform: 'ios',
    isExpoGo: false,
    enabled: true,
    appEnvironment: 'production',
    expectedProjectId: 'cabohealth-prod',
  };

  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    environment,
    loadBridge: async () => makeBridge('another-project'),
  }), null);
  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    environment: { ...environment, expectedProjectId: 'unrelated-prod' },
    loadBridge: async () => makeBridge('unrelated-prod'),
  }), null);
  assert.equal(appCheckCalls, 0);
});

test('the debug App Check provider requires an explicit development-only setting', async () => {
  const appCheckOptions = [];
  let bridgeLoads = 0;
  const bridge = {
    projectId: 'cabohealth-dev',
    initializeAppCheck: async (options) => { appCheckOptions.push(options); },
    auth: {
      waitForReady: async () => null,
      currentUser: () => null,
      signInWithCustomToken: async () => ({ uid: 'client_abcdefghijklmnopqrstuvwxyz123456' }),
      signOut: async () => {},
    },
    functionsForRegion: () => ({ call: async () => null }),
  };
  const common = {
    loadBridge: async () => { bridgeLoads += 1; return bridge; },
    secureStorage: {
      getItem: async () => null,
      setItem: async () => {},
      deleteItem: async () => {},
    },
    randomBytes: async (length) => new Uint8Array(length),
    createRequestId: () => 'request_abcdefghijklmnop',
  };

  assert.ok(await createNativeClientAccessRuntime({
    ...common,
    environment: {
      platform: 'ios',
      isExpoGo: false,
      enabled: true,
      appEnvironment: 'development',
      expectedProjectId: 'cabohealth-dev',
      appCheckDebugEnabled: true,
    },
  }));
  assert.deepEqual(appCheckOptions, [{
    androidProvider: 'debug',
    appleProvider: 'debug',
    tokenAutoRefreshEnabled: true,
  }]);

  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    environment: {
      platform: 'ios',
      isExpoGo: false,
      enabled: true,
      appEnvironment: 'production',
      expectedProjectId: 'cabohealth-prod',
      appCheckDebugEnabled: true,
    },
  }), null);
  assert.equal(bridgeLoads, 1);
});

test('native module or App Check initialization failures resolve to the locked runtime', async () => {
  const common = {
    environment: {
      platform: 'ios',
      isExpoGo: false,
      enabled: true,
      appEnvironment: 'production',
      expectedProjectId: 'cabohealth-prod',
    },
    secureStorage: {
      getItem: async () => null,
      setItem: async () => {},
      deleteItem: async () => {},
    },
    randomBytes: async (length) => new Uint8Array(length),
    createRequestId: () => 'request_abcdefghijklmnop',
  };

  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    loadBridge: async () => { throw new Error('native module unavailable'); },
  }), null);
  assert.equal(await createNativeClientAccessRuntime({
    ...common,
    loadBridge: async () => ({
      projectId: 'cabohealth-prod',
      initializeAppCheck: async () => { throw new Error('attestation unavailable'); },
      auth: {
        waitForReady: async () => null,
        currentUser: () => null,
        signInWithCustomToken: async () => ({ uid: 'client_abcdefghijklmnopqrstuvwxyz123456' }),
        signOut: async () => {},
      },
      functionsForRegion: () => ({ call: async () => null }),
    }),
  }), null);
});

test('runtime configuration parsing disables malformed or incomplete Expo extras', () => {
  assert.deepEqual(parseNativeClientAccessEnvironment({
    platform: 'ios',
    isExpoGo: false,
    extra: null,
  }), {
    platform: 'ios',
    isExpoGo: false,
    enabled: false,
    appEnvironment: 'development',
    expectedProjectId: null,
    appCheckDebugEnabled: false,
    functionsRegion: 'us-central1',
  });
  assert.deepEqual(parseNativeClientAccessEnvironment({
    platform: 'ios',
    isExpoGo: false,
    extra: { clientAccessRuntime: {
      enabled: true,
      appEnvironment: 'production',
      expectedProjectId: null,
    } },
  }), {
    platform: 'ios',
    isExpoGo: false,
    enabled: false,
    appEnvironment: 'development',
    expectedProjectId: null,
    appCheckDebugEnabled: false,
    functionsRegion: 'us-central1',
  });
});
