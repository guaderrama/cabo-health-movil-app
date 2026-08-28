import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReactNativeFirebaseBridge,
} from '../.test-build/features/clientAccess/reactNativeFirebaseBridge.js';

function makeModules() {
  const callableCreations = [];
  const app = { options: { projectId: 'cabohealth-prod' } };
  const auth = { currentUser: null };
  return {
    callableCreations,
    modules: {
      app: { getApp: () => app },
      auth: {
        getAuth: () => auth,
        onAuthStateChanged: (_auth, callback) => { callback(null); return () => {}; },
        signInWithCustomToken: async () => ({ user: { uid: 'client_abcdefghijklmnopqrstuvwxyz123456' } }),
        signOut: async () => {},
      },
      functions: {
        getFunctions: (_app, region) => ({ region }),
        httpsCallable: (instance, name, options) => {
          callableCreations.push({ instance, name, options });
          return async (data) => ({ data: { name, data } });
        },
      },
      appCheck: {
        createProvider: () => ({ configure: () => {} }),
        initializeAppCheck: async () => {},
      },
    },
  };
}

test('every callable opts into limited-use App Check tokens for replay protection', async () => {
  const { callableCreations, modules } = makeModules();
  const bridge = createReactNativeFirebaseBridge(modules);
  const port = bridge.functionsForRegion('us-central1');

  await port.call('redeemClientAccessCodeV2', { requestId: 'request_one_123456' });
  await port.call('refreshClientAccessV2', { installationId: 'installation_12345678901234567890' });
  await port.call('createClientLaunchV2', {
    installationId: 'installation_12345678901234567890',
    resourceId: 'external-0123456789abcdef0123456789abcdef',
  });

  assert.deepEqual(callableCreations, [
    {
      instance: { region: 'us-central1' },
      name: 'redeemClientAccessCodeV2',
      options: { limitedUseAppCheckTokens: true },
    },
    {
      instance: { region: 'us-central1' },
      name: 'refreshClientAccessV2',
      options: { limitedUseAppCheckTokens: true },
    },
    {
      instance: { region: 'us-central1' },
      name: 'createClientLaunchV2',
      options: { limitedUseAppCheckTokens: true },
    },
  ]);
});

test('the bridge configures App Attest with DeviceCheck fallback and token refresh', async () => {
  const { modules } = makeModules();
  const events = [];
  const provider = { configure: (options) => { events.push(['configure', options]); } };
  modules.appCheck = {
    createProvider: () => provider,
    initializeAppCheck: async (app, options) => {
      events.push(['initialize', app, options]);
    },
  };
  const bridge = createReactNativeFirebaseBridge(modules);

  await bridge.initializeAppCheck({
    appleProvider: 'appAttestWithDeviceCheckFallback',
    androidProvider: 'playIntegrity',
    tokenAutoRefreshEnabled: true,
  });

  assert.deepEqual(events, [
    ['configure', {
      apple: { provider: 'appAttestWithDeviceCheckFallback' },
      android: { provider: 'playIntegrity' },
    }],
    ['initialize', { options: { projectId: 'cabohealth-prod' } }, {
      provider,
      isTokenAutoRefreshEnabled: true,
    }],
  ]);
});

test('catalog and client adapters share one App Check initialization for the native app', async () => {
  const { modules } = makeModules();
  let initializations = 0;
  modules.appCheck.initializeAppCheck = async () => {
    initializations += 1;
    await new Promise((resolve) => setImmediate(resolve));
  };
  const first = createReactNativeFirebaseBridge(modules);
  const second = createReactNativeFirebaseBridge(modules);
  const options = {
    appleProvider: 'appAttestWithDeviceCheckFallback',
    androidProvider: 'playIntegrity',
    tokenAutoRefreshEnabled: true,
  };

  await Promise.all([
    first.initializeAppCheck(options),
    second.initializeAppCheck(options),
  ]);

  assert.equal(initializations, 1);
});
