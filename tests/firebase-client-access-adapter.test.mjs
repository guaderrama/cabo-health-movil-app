import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFirebaseClientAccessAdapter,
} from '../.test-build/features/clientAccess/firebaseClientAccessAdapter.js';
import {
  createClientDeletionReceiptStore,
} from '../.test-build/features/clientAccess/clientDeletionReceiptStore.js';
import {
  createClientAccessController,
} from '../.test-build/features/clientAccess/clientAccessController.js';

const ACTIVE_GRANT = Object.freeze({
  schemaVersion: 2,
  status: 'active',
  expiresAtMs: 2_000_000_000_000,
  resources: Object.freeze([Object.freeze({
    id: 'client-resources',
    title: Object.freeze({ en: 'Client Resources', es: 'Recursos para clientes' }),
    summary: Object.freeze({ en: 'General education.', es: 'Educación general.' }),
    iconKey: 'heart-outline',
    access: 'client',
  })]),
});

const REVIEW_GRANT = Object.freeze({
  schemaVersion: 1,
  status: 'active',
  scope: 'review_sandbox',
  purpose: 'app_review',
  credentialGeneration: 1,
  expiresAtMs: null,
  resources: Object.freeze([Object.freeze({
    id: 'review-sandbox-app-review-sample-v1',
    title: Object.freeze({ en: 'App Review Sample', es: 'Muestra para App Review' }),
    summary: Object.freeze({
      en: 'A fixed, non-clinical sample prepared only for App Review.',
      es: 'Una muestra fija y no clínica preparada sólo para App Review.',
    }),
    iconKey: 'featured',
    access: 'client',
  })]),
});

const DELETION_REQUESTED_AT_MS = 1_900_000_000_000;
const DELETION_PENDING = Object.freeze({
  completedAtMs: null,
  expectedCompletionByMs: DELETION_REQUESTED_AT_MS + 30 * 24 * 60 * 60 * 1_000,
  requestedAtMs: DELETION_REQUESTED_AT_MS,
  schemaVersion: 1,
  status: 'pending',
});
const DELETION_COMPLETED = Object.freeze({
  ...DELETION_PENDING,
  completedAtMs: DELETION_REQUESTED_AT_MS + 5_000,
  status: 'completed',
});

function makeHarness({
  currentUid = null,
  signedInUid = 'client_abcdefghijklmnopqrstuvwxyz123456',
  installationId = 'installation_abcdefghijklmnopqrstuvwxyz123456',
  failInstallationClear = false,
  signOutFailures = 0,
  cleanupState = null,
  secureValues = new Map(),
} = {}) {
  let uid = currentUid;
  let signOutAttempts = 0;
  const calls = [];
  const auth = {
    waitForReady: async () => uid === null ? null : { uid },
    currentUser: () => uid === null ? null : { uid },
    signInWithCustomToken: async (customToken) => {
      calls.push(['signIn', customToken]);
      uid = signedInUid;
      return { uid };
    },
    signOut: async () => {
      calls.push(['signOut']);
      signOutAttempts += 1;
      if (signOutAttempts <= signOutFailures) throw new Error('sign_out_failed');
      uid = null;
    },
  };
  let callImpl = async (name, data) => {
      calls.push(['call', name, data]);
      if (name === 'redeemClientAccessCodeV2') {
        return { customToken: 'firebase-custom-token', grant: ACTIVE_GRANT };
      }
      if (name === 'refreshClientAccessV2') return { grant: ACTIVE_GRANT };
      if (name === 'redeemAppReviewCredential') {
        return { customToken: 'firebase-review-custom-token', grant: REVIEW_GRANT };
      }
      if (name === 'refreshAppReviewAccess') return { grant: REVIEW_GRANT };
      if (name === 'createClientLaunchV2') {
        return {
          kind: 'broker',
          expiresAtMs: 1_900_000_060_000,
          launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
          method: 'POST',
          nonce: 'abcdefghijklmnopqrstuvwxyz123456',
        };
      }
      if (name === 'createAppReviewLaunch') {
        return {
          expiresAtMs: 1_900_000_060_000,
          launchUrl: 'https://cabohealth.org/apps/app-review/launch/',
          method: 'POST',
          nonce: 'review_nonce_abcdefghijklmnopqrs',
        };
      }
      if (name === 'removeClientAccess') return { removed: true };
      if (name === 'deleteClientAccount') return DELETION_PENDING;
      throw new Error(`Unexpected function ${name}`);
  };
  const functions = { call: (name, data) => callImpl(name, data) };
  const installation = {
    getOrCreate: async () => installationId,
    clear: async () => {
      calls.push(['clearInstallation']);
      if (cleanupState) {
        cleanupState.clearAttempts += 1;
        if (cleanupState.clearFailures > 0) {
          cleanupState.clearFailures -= 1;
          throw new Error('clear_failed');
        }
      }
      if (failInstallationClear) throw new Error('clear_failed');
    },
    markDeletionCleanupPending: async () => {
      if (cleanupState?.markerFailures > 0) {
        cleanupState.markerFailures -= 1;
        throw new Error('marker_failed');
      }
      if (cleanupState) cleanupState.pending = true;
    },
    hasDeletionCleanupPending: async () => cleanupState?.pending ?? false,
    clearDeletionCleanupPending: async () => {
      if (cleanupState) cleanupState.pending = false;
    },
  };
  const requestIds = ['request_abcdefghijklmnop', 'request_qrstuvwxyz123456'];
  const deletionReceipts = createClientDeletionReceiptStore({
    storage: {
      getItem: async (key) => secureValues.get(key) ?? null,
      setItem: async (key, value) => { secureValues.set(key, value); },
      deleteItem: async (key) => { secureValues.delete(key); },
    },
    randomBytes: async (length) => Uint8Array.from({ length }, (_, index) => index + 1),
    now: () => DELETION_REQUESTED_AT_MS - 1_000,
  });
  const adapter = createFirebaseClientAccessAdapter({
    auth,
    deletionReceipts,
    functions,
    installation,
    createRequestId: () => requestIds.shift() ?? 'request_fallback1234',
    now: () => 1_900_000_000_000,
  });
  return {
    adapter,
    calls,
    deletionReceipts,
    secureValues,
    auth,
    replaceCall(next) { callImpl = next; },
  };
}

test('redeem sends the code once, signs in, and exposes only an opaque session plus grant', async () => {
  const { adapter, calls } = makeHarness();
  const code = 'CH-01234567-89ABCDEF-01234567-89ABCDEF';
  const result = await adapter.gateway.redeem(code);

  assert.ok(result);
  assert.deepEqual(result.grant, ACTIVE_GRANT);
  assert.deepEqual(Object.keys(result.session), []);
  assert.deepEqual(calls, [
    ['call', 'redeemClientAccessCodeV2', {
      code,
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
      requestId: 'request_abcdefghijklmnop',
    }],
    ['signIn', 'firebase-custom-token'],
  ]);
  assert.equal(JSON.stringify(result).includes(code), false);
  assert.equal(JSON.stringify(result).includes('firebase-custom-token'), false);
});

test('an AR credential selects only the App Review callable and validates its review principal', async () => {
  const { adapter, calls } = makeHarness({
    signedInUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  const credential = 'AR-01234567-89ABCDEF-01234567-89ABCDEF';
  const result = await adapter.gateway.redeem(credential);

  assert.ok(result);
  assert.deepEqual(result.grant, REVIEW_GRANT);
  assert.deepEqual(Object.keys(result.session), []);
  assert.deepEqual(calls, [
    ['call', 'redeemAppReviewCredential', {
      credential,
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
      requestId: 'request_abcdefghijklmnop',
    }],
    ['signIn', 'firebase-review-custom-token'],
  ]);
  assert.equal(JSON.stringify(result).includes(credential), false);
  assert.equal(calls.some((entry) => entry.includes('redeemClientAccessCode')), false);
});

test('the App Review credential can redeem on independent installations without local credential storage', async () => {
  const credential = 'AR-01234567-89ABCDEF-01234567-89ABCDEF';
  const installations = [
    'installation_abcdefghijklmnopqrstuvwxyz123456',
    'installation_zyxwvutsrqponmlkjihgfedcba654321',
  ];
  const harnesses = installations.map((installationId) => makeHarness({
    installationId,
    signedInUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  }));

  const results = await Promise.all(harnesses.map(({ adapter }) => (
    adapter.gateway.redeem(credential)
  )));

  assert.equal(results.every(Boolean), true);
  assert.deepEqual(harnesses.map(({ calls }) => calls[0][2].installationId), installations);
  assert.equal(JSON.stringify(results).includes(credential), false);
});

test('redeem rejects every grant or Firebase UID that crosses CH and AR realms', async () => {
  const wrongUid = makeHarness({ signedInUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  await assert.rejects(
    wrongUid.adapter.gateway.redeem('AR-01234567-89ABCDEF-01234567-89ABCDEF'),
    /invalid_backend_response/u,
  );
  assert.deepEqual(wrongUid.calls.map((entry) => entry[0]), ['call', 'signIn', 'signOut']);

  const wrongGrant = makeHarness({ signedInUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  wrongGrant.replaceCall(async () => ({
    customToken: 'firebase-custom-token',
    grant: REVIEW_GRANT,
  }));
  await assert.rejects(
    wrongGrant.adapter.gateway.redeem('CH-01234567-89ABCDEF-01234567-89ABCDEF'),
    /invalid_backend_response/u,
  );
  assert.deepEqual(wrongGrant.calls, [['signOut']]);
});

test('a malformed redeem envelope fails closed and signs out without returning a session', async () => {
  const harness = makeHarness();
  harness.replaceCall(async () => ({
    customToken: 'firebase-custom-token',
    grant: ACTIVE_GRANT,
    unexpected: true,
  }));

  await assert.rejects(
    harness.adapter.gateway.redeem('CH-01234567-89ABCDEF-01234567-89ABCDEF'),
    /invalid_backend_response/u,
  );
  assert.deepEqual(harness.calls.at(-1), ['signOut']);
});

test('the backend generic invalid-access error maps to a null redemption without exposing detail', async () => {
  const harness = makeHarness();
  harness.replaceCall(async () => {
    const error = new Error('invalid_access');
    error.code = 'functions/permission-denied';
    throw error;
  });

  const result = await harness.adapter.gateway.redeem(
    'CH-01234567-89ABCDEF-01234567-89ABCDEF',
  );
  assert.equal(result, null);
  assert.deepEqual(harness.calls, [['signOut']]);
});

test('invalid or unavailable replacement codes preserve an existing production or review principal', async () => {
  for (const [currentUid, credential] of [
    ['client_abcdefghijklmnopqrstuvwxyz123456', 'CH-01234567-89ABCDEF-01234567-89ABCDEF'],
    ['review_abcdefghijklmnopqrstuvwxyz123456', 'AR-01234567-89ABCDEF-01234567-89ABCDEF'],
  ]) {
    const denied = makeHarness({ currentUid });
    denied.replaceCall(async (name, data) => {
      denied.calls.push(['call', name, data]);
      const error = new Error('invalid_access');
      error.code = 'functions/permission-denied';
      throw error;
    });

    assert.equal(await denied.adapter.gateway.redeem(credential), null);
    assert.equal(denied.auth.currentUser()?.uid, currentUid);
    assert.equal(denied.calls.some(([kind]) => kind === 'signOut'), false);

    const offline = makeHarness({ currentUid });
    offline.replaceCall(async (name, data) => {
      offline.calls.push(['call', name, data]);
      throw new Error('offline');
    });

    await assert.rejects(offline.adapter.gateway.redeem(credential), /offline/u);
    assert.equal(offline.auth.currentUser()?.uid, currentUid);
    assert.equal(offline.calls.some(([kind]) => kind === 'signOut'), false);

    const signInOffline = makeHarness({ currentUid });
    signInOffline.auth.signInWithCustomToken = async (customToken) => {
      signInOffline.calls.push(['signIn', customToken]);
      throw new Error('sign-in-offline');
    };

    await assert.rejects(signInOffline.adapter.gateway.redeem(credential), /sign-in-offline/u);
    assert.equal(signInOffline.auth.currentUser()?.uid, currentUid);
    assert.equal(signInOffline.calls.some(([kind]) => kind === 'signOut'), false);
  }
});

test('a wrong-realm replacement principal clears the prior controller grant and session', async () => {
  const harness = makeHarness({
    currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456',
    signedInUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  const controller = createClientAccessController({
    gateway: harness.adapter.gateway,
    sessionStore: harness.adapter.sessionStore,
  });
  await controller.initialize();
  assert.equal(controller.getSnapshot().status, 'unlocked');

  assert.equal(await controller.redeem('CH-01234567-89ABCDEF-01234567-89ABCDEF'), false);
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().grant, null);
  assert.equal(harness.auth.currentUser(), null);
  assert.equal(harness.calls.filter(([kind]) => kind === 'signOut').length >= 1, true);
});

test('restore accepts only a ready client Firebase principal', async () => {
  const valid = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  assert.deepEqual(Object.keys(await valid.adapter.sessionStore.restore()), []);

  const anonymous = makeHarness({ currentUid: null });
  assert.equal(await anonymous.adapter.sessionStore.restore(), null);

  const wrongPrincipal = makeHarness({ currentUid: 'staff_abcdefghijklmnopqrstuvwxyz123456' });
  assert.equal(await wrongPrincipal.adapter.sessionStore.restore(), null);
  assert.deepEqual(wrongPrincipal.calls, [['signOut']]);
});

test('a restored review principal refreshes only through the review realm', async () => {
  const { adapter, calls } = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  const session = await adapter.sessionStore.restore();
  assert.ok(session);

  assert.deepEqual(await adapter.gateway.refresh(session), REVIEW_GRANT);
  assert.deepEqual(calls, [[
    'call',
    'refreshAppReviewAccess',
    { installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456' },
  ]]);
  assert.equal(calls.some((entry) => entry.includes('refreshClientAccess')), false);
});

test('a rotated or revoked review grant signs out and returns locked refresh semantics', async () => {
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    const error = new Error('invalid_access');
    error.code = 'functions/permission-denied';
    throw error;
  });
  const session = await harness.adapter.sessionStore.restore();

  assert.equal(await harness.adapter.gateway.refresh(session), null);
  assert.deepEqual(harness.calls, [
    ['call', 'refreshAppReviewAccess', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
    ['signOut'],
  ]);
});

test('refresh fails closed when either backend crosses the authenticated realm', async () => {
  for (const [currentUid, crossedGrant, expectedCallable] of [
    ['review_abcdefghijklmnopqrstuvwxyz123456', ACTIVE_GRANT, 'refreshAppReviewAccess'],
    ['client_abcdefghijklmnopqrstuvwxyz123456', REVIEW_GRANT, 'refreshClientAccessV2'],
  ]) {
    const harness = makeHarness({ currentUid });
    harness.replaceCall(async (name, data) => {
      harness.calls.push(['call', name, data]);
      return { grant: crossedGrant };
    });
    const session = await harness.adapter.sessionStore.restore();

    await assert.rejects(
      harness.adapter.gateway.refresh(session),
      /invalid_backend_response/u,
    );
    assert.equal(harness.calls[0][1], expectedCallable);
    assert.deepEqual(harness.calls.at(-1), ['signOut']);
  }
});

test('refresh and launch use only the live Firebase principal and installation identifier', async () => {
  const { adapter, calls } = makeHarness({
    currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456',
  });
  const session = await adapter.sessionStore.restore();
  assert.ok(session);

  assert.deepEqual(await adapter.gateway.refresh(session), ACTIVE_GRANT);
  const launch = await adapter.gateway.createLaunch(session, 'client-resources');
  assert.equal(launch.launchUrl, 'https://cabohealth.org/apps/client-resources/launch/');
  assert.equal(launch.method, 'POST');
  assert.deepEqual(calls, [
    ['call', 'refreshClientAccessV2', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
    ['call', 'createClientLaunchV2', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
      resourceId: 'client-resources',
    }],
  ]);
});

test('review launch has no caller-selected resource and never calls the production launch endpoint', async () => {
  const { adapter, calls } = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  const session = await adapter.sessionStore.restore();
  assert.ok(session);

  const launch = await adapter.gateway.createLaunch(
    session,
    'review-sandbox-app-review-sample-v1',
  );
  assert.deepEqual(launch, {
    expiresAtMs: 1_900_000_060_000,
    launchUrl: 'https://cabohealth.org/apps/app-review/launch/',
    method: 'POST',
    nonce: 'review_nonce_abcdefghijklmnopqrs',
  });
  assert.deepEqual(calls, [[
    'call',
    'createAppReviewLaunch',
    { installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456' },
  ]]);

  await assert.rejects(
    adapter.gateway.createLaunch(session, 'client-resources'),
    /invalid_review_resource/u,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls.some((entry) => entry.includes('createClientLaunch')), false);
});

test('a review launch outside the device clock window cannot destroy valid client access', async () => {
  const harness = makeHarness({ signedInUid: 'review_abcdefghijklmnopqrstuvwxyz123456' });
  const controller = createClientAccessController({
    gateway: harness.adapter.gateway,
    sessionStore: harness.adapter.sessionStore,
    now: () => 1_900_000_000_000,
  });
  await controller.initialize();
  assert.equal(await controller.redeem('AR-01234567-89ABCDEF-01234567-89ABCDEF'), true);
  for (const expiresAtMs of [1_899_999_460_000, 1_900_000_660_000]) {
    harness.replaceCall(async (name) => {
      if (name === 'refreshAppReviewAccess') return { grant: REVIEW_GRANT };
      assert.equal(name, 'createAppReviewLaunch');
      return {
        expiresAtMs,
        launchUrl: 'https://cabohealth.org/apps/app-review/launch/',
        method: 'POST',
        nonce: 'abcdefghijklmnopqrstuvwxyz123456',
      };
    });
    // The expired/future launch must stay blocked, but retrying a confirmed
    // grant must not become an unrelated "access could not be verified" error.
    assert.equal(await controller.createLaunch('review-sandbox-app-review-sample-v1'), null);
    await controller.refresh();
    assert.equal(controller.getSnapshot().status, 'unlocked');
    assert.equal(controller.getSnapshot().error, null);
  }
  harness.replaceCall(async (name) => {
    assert.equal(name, 'createAppReviewLaunch');
    return {
      expiresAtMs: 1_900_000_060_000,
      launchUrl: 'https://cabohealth.org/apps/app-review/launch/',
      method: 'POST',
      nonce: 'abcdefghijklmnopqrstuvwxyz123456',
    };
  });
  const recovered = await controller.createLaunch('review-sandbox-app-review-sample-v1');
  assert.equal(recovered?.source.uri, 'https://cabohealth.org/apps/app-review/launch/');
  assert.equal(recovered?.source.method, 'POST');
});

test('production uses only V2 callables and sends no URL to launch', async () => {
  const { adapter, calls } = makeHarness({
    currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456',
  });
  const session = await adapter.sessionStore.restore();
  assert.ok(session);

  await adapter.gateway.refresh(session);
  await adapter.gateway.createLaunch(session, 'external-0123456789abcdef0123456789abcdef');

  assert.deepEqual(calls, [
    ['call', 'refreshClientAccessV2', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
    ['call', 'createClientLaunchV2', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
      resourceId: 'external-0123456789abcdef0123456789abcdef',
    }],
  ]);
  assert.equal(JSON.stringify(calls).includes('https://'), false);
  assert.equal(calls.some((entry) => entry.includes('refreshClientAccess')), false);
  assert.equal(calls.some((entry) => entry.includes('createClientLaunch')), false);
});

test('production accepts the exact external launch branch and rejects malformed or unsafe variants', async () => {
  const valid = {
    kind: 'external_https',
    expiresAtMs: 1_900_000_060_000,
    url: 'https://www.eightsleep.com/mx/',
  };
  const invalid = [
    { ...valid, extra: true },
    { ...valid, nonce: 'forbidden' },
    { ...valid, url: 'http://www.eightsleep.com/mx/' },
    { ...valid, url: 'https://WWW.eightsleep.com:443/mx/' },
    { ...valid, kind: 'unknown' },
  ];

  const accepted = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  accepted.replaceCall(async (name, data) => {
    accepted.calls.push(['call', name, data]);
    return valid;
  });
  const acceptedSession = await accepted.adapter.sessionStore.restore();
  assert.deepEqual(
    await accepted.adapter.gateway.createLaunch(
      acceptedSession,
      'external-0123456789abcdef0123456789abcdef',
    ),
    valid,
  );

  for (const response of invalid) {
    const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
    harness.replaceCall(async (name, data) => {
      harness.calls.push(['call', name, data]);
      return response;
    });
    const session = await harness.adapter.sessionStore.restore();
    await assert.rejects(
      harness.adapter.gateway.createLaunch(
        session,
        'external-0123456789abcdef0123456789abcdef',
      ),
      /invalid_backend_response/u,
    );
    assert.deepEqual(harness.calls.at(-1), ['signOut']);
  }
});

test('an out-of-window production launch is rejected without signing out its valid principal', async () => {
  for (const expiresAtMs of [1_900_000_000_000, 1_900_000_120_001]) {
    const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
    harness.replaceCall(async () => ({
      kind: 'external_https',
      expiresAtMs,
      url: 'https://www.eightsleep.com/mx/',
    }));
    const session = await harness.adapter.sessionStore.restore();
    await assert.rejects(harness.adapter.gateway.createLaunch(session, 'test-resource'));
    assert.equal(harness.auth.currentUser()?.uid, 'client_abcdefghijklmnopqrstuvwxyz123456');
  }
});

test('App Review rejects the external launch union without changing its fixed V1 broker path', async () => {
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    return {
      kind: 'external_https',
      expiresAtMs: 1_900_000_060_000,
      url: 'https://www.eightsleep.com/mx/',
    };
  });
  const session = await harness.adapter.sessionStore.restore();

  await assert.rejects(
    harness.adapter.gateway.createLaunch(session, 'review-sandbox-app-review-sample-v1'),
    /invalid_backend_response/u,
  );
  assert.equal(harness.calls[0][1], 'createAppReviewLaunch');
  assert.deepEqual(harness.calls.at(-1), ['signOut']);
});

test('launch rejects a response URL from the other realm before a WebView can open', async () => {
  for (const [currentUid, resourceId, crossedUrl] of [
    [
      'review_abcdefghijklmnopqrstuvwxyz123456',
      'review-sandbox-app-review-sample-v1',
      'https://cabohealth.org/apps/client-resources/launch/',
    ],
    [
      'client_abcdefghijklmnopqrstuvwxyz123456',
      'client-resources',
      'https://cabohealth.org/apps/app-review/launch/',
    ],
  ]) {
    const harness = makeHarness({ currentUid });
    harness.replaceCall(async (name, data) => {
      harness.calls.push(['call', name, data]);
      return {
        ...(currentUid.startsWith('client_') ? { kind: 'broker' } : {}),
        expiresAtMs: 1_900_000_060_000,
        launchUrl: crossedUrl,
        method: 'POST',
        nonce: 'abcdefghijklmnopqrstuvwxyz123456',
      };
    });
    const session = await harness.adapter.sessionStore.restore();

    await assert.rejects(
      harness.adapter.gateway.createLaunch(session, resourceId),
      /invalid_backend_response/u,
    );
    assert.deepEqual(harness.calls.at(-1), ['signOut']);
  }
});

test('review launch accepts only the broker-compatible 32-character nonce', async () => {
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    return {
      expiresAtMs: 1_900_000_060_000,
      launchUrl: 'https://cabohealth.org/apps/app-review/launch/',
      method: 'POST',
      nonce: 'abcdefghijklmnopqrstuvwxyz123456extra',
    };
  });
  const session = await harness.adapter.sessionStore.restore();

  await assert.rejects(
    harness.adapter.gateway.createLaunch(session, 'review-sandbox-app-review-sample-v1'),
    /invalid_backend_response/u,
  );
  assert.deepEqual(harness.calls.at(-1), ['signOut']);
});

test('remove and delete require the live principal, clear Firebase auth, and deletion clears installation state', async () => {
  const removal = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  const removalSession = await removal.adapter.sessionStore.restore();
  await removal.adapter.gateway.removeAccess(removalSession);
  assert.deepEqual(removal.calls, [
    ['call', 'removeClientAccess', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
  ]);
  await removal.adapter.gateway.signOut();
  assert.deepEqual(removal.calls.at(-1), ['signOut']);

  const deletion = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  const deletionSession = await deletion.adapter.sessionStore.restore();
  await deletion.adapter.gateway.deleteAccount(deletionSession);
  await deletion.adapter.gateway.cleanupAccountDeletion('begin');
  const deletionReceipt = deletion.calls[0][2].deletionReceipt;
  assert.match(deletionReceipt, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(deletion.calls, [
    ['call', 'deleteClientAccount', {
      deletionReceipt,
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
    ['clearInstallation'],
    ['signOut'],
  ]);
});

test('review deletion uses only its realm-specific callable and returns the durable acknowledgement', async () => {
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    return DELETION_PENDING;
  });
  const session = await harness.adapter.sessionStore.restore();
  assert.ok(session);

  const result = await harness.adapter.gateway.deleteAccount(session);
  const cleanup = await harness.adapter.gateway.cleanupAccountDeletion('begin');

  assert.deepEqual(result, DELETION_PENDING);
  assert.equal(cleanup, 'completed');
  const deletionReceipt = harness.calls[0][2].deletionReceipt;
  assert.match(deletionReceipt, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(harness.calls, [
    ['call', 'deleteAppReviewAccount', {
      deletionReceipt,
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
    ['clearInstallation'],
    ['signOut'],
  ]);
  assert.equal(harness.calls.some((entry) => (
    entry.includes('removeClientAccess') || entry.includes('deleteClientAccount')
  )), false);
});

test('an acknowledged review deletion locks locally and signs out even when installation cleanup fails', async () => {
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
    failInstallationClear: true,
  });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'refreshAppReviewAccess') return { grant: REVIEW_GRANT };
    if (name === 'deleteAppReviewAccount') return DELETION_PENDING;
    throw new Error('wrong_realm');
  });
  const controller = createClientAccessController({
    gateway: harness.adapter.gateway,
    sessionStore: harness.adapter.sessionStore,
  });
  await controller.initialize();
  assert.equal(controller.getSnapshot().status, 'unlocked');

  assert.deepEqual(await controller.deleteAccount(), DELETION_PENDING);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: null,
  });
  assert.equal(harness.calls.filter(([kind]) => kind === 'clearInstallation').length, 1);
  assert.equal(harness.calls.filter(([kind]) => kind === 'signOut').length, 1);
});

test('foreground refresh retries failed local cleanup without repeating an acknowledged deletion', async () => {
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
    signOutFailures: 1,
  });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'refreshAppReviewAccess') return { grant: REVIEW_GRANT };
    if (name === 'deleteAppReviewAccount') return DELETION_PENDING;
    throw new Error('wrong_realm');
  });
  const controller = createClientAccessController({
    gateway: harness.adapter.gateway,
    sessionStore: harness.adapter.sessionStore,
  });
  await controller.initialize();
  assert.deepEqual(await controller.deleteAccount(), DELETION_PENDING);

  await controller.refresh();

  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: null,
  });
  assert.equal(harness.calls.filter(([kind]) => kind === 'clearInstallation').length, 2);
  assert.equal(harness.calls.filter(([kind]) => kind === 'signOut').length, 2);
  assert.equal(harness.calls.filter(([, name]) => name === 'deleteAppReviewAccount').length, 1);
});

test('a fresh runtime resumes durable local cleanup without repeating the backend deletion', async () => {
  const cleanupState = { pending: false, clearAttempts: 0, clearFailures: 1 };
  const firstRuntime = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
    cleanupState,
  });
  firstRuntime.replaceCall(async (name, data) => {
    firstRuntime.calls.push(['call', name, data]);
    if (name === 'refreshAppReviewAccess') return { grant: REVIEW_GRANT };
    if (name === 'deleteAppReviewAccount') return DELETION_PENDING;
    throw new Error('wrong_realm');
  });
  const firstController = createClientAccessController({
    gateway: firstRuntime.adapter.gateway,
    sessionStore: firstRuntime.adapter.sessionStore,
  });
  await firstController.initialize();
  assert.deepEqual(await firstController.deleteAccount(), DELETION_PENDING);
  assert.equal(cleanupState.pending, true);

  const nextRuntime = makeHarness({ cleanupState });
  nextRuntime.replaceCall(async () => { throw new Error('backend_must_not_repeat'); });
  const nextController = createClientAccessController({
    gateway: nextRuntime.adapter.gateway,
    sessionStore: nextRuntime.adapter.sessionStore,
  });
  await nextController.initialize();

  assert.equal(cleanupState.pending, false);
  assert.equal(cleanupState.clearAttempts, 2);
  assert.equal(nextRuntime.calls.some(([kind]) => kind === 'call'), false);
  assert.deepEqual(nextController.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: null,
  });
});

test('a failed cleanup-marker write remains pending until a safe in-process retry', async () => {
  const cleanupState = {
    pending: false,
    clearAttempts: 0,
    clearFailures: 0,
    markerFailures: 1,
  };
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
    cleanupState,
  });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'deleteAppReviewAccount') return DELETION_PENDING;
    throw new Error('wrong_realm');
  });
  const session = await harness.adapter.sessionStore.restore();

  assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), DELETION_PENDING);
  assert.equal(await harness.adapter.gateway.cleanupAccountDeletion('begin'), 'pending');
  assert.equal(await harness.adapter.gateway.cleanupAccountDeletion('retry'), 'completed');
  assert.equal(harness.calls.filter(([, name]) => name === 'deleteAppReviewAccount').length, 1);
});

test('account deletion accepts only the durable pending or completed backend contract', async () => {
  for (const status of [DELETION_PENDING, DELETION_COMPLETED]) {
    const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
    harness.replaceCall(async () => status);
    const session = await harness.adapter.sessionStore.restore();
    assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), status);
    assert.deepEqual(harness.calls, []);
  }

  for (const response of [
    { deleted: true },
    { status: 'queued' },
    { status: 'pending', extra: true },
  ]) {
    const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
    harness.replaceCall(async () => response);
    const session = await harness.adapter.sessionStore.restore();
    assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), {
      status: 'unavailable',
    });
    assert.deepEqual(await harness.adapter.deletionTracker.check(), {
      kind: 'unavailable',
      phase: 'prepared',
      realm: 'production_client',
    });
    assert.equal(harness.secureValues.size, 1);
    assert.deepEqual(harness.calls, []);
  }
});

test('a lost delete response is resolved by the Auth-free realm status callable', async () => {
  const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'deleteClientAccount') throw new Error('response_lost');
    if (name === 'getClientAccountDeletionStatus') return DELETION_PENDING;
    throw new Error('wrong_callable');
  });
  const session = await harness.adapter.sessionStore.restore();

  assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), DELETION_PENDING);
  assert.equal(harness.calls.length, 4);
  assert.equal(harness.calls[0][1], 'deleteClientAccount');
  assert.equal(harness.calls[1][1], 'getClientAccountDeletionStatus');
  assert.equal(harness.calls[0][2].deletionReceipt, harness.calls[1][2].deletionReceipt);
  assert.equal('installationId' in harness.calls[1][2], false);
  assert.equal(harness.calls.filter(([kind]) => kind === 'signOut').length, 1);
});

test('foreground status polling waits for an in-flight deletion submission to settle', async () => {
  const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  let accepted = false;
  let resolveDeletion;
  const pendingDeletion = new Promise((resolve) => { resolveDeletion = resolve; });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'deleteClientAccount') return pendingDeletion;
    if (name === 'getClientAccountDeletionStatus' && !accepted) {
      const error = new Error('invalid_access');
      error.code = 'functions/not-found';
      throw error;
    }
    if (name === 'getClientAccountDeletionStatus') return DELETION_PENDING;
    throw new Error('wrong_callable');
  });
  const session = await harness.adapter.sessionStore.restore();
  const deletion = harness.adapter.gateway.deleteAccount(session);
  while (!harness.calls.some(([, name]) => name === 'deleteClientAccount')) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const check = harness.adapter.deletionTracker.check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    harness.calls.some(([, name]) => name === 'getClientAccountDeletionStatus'),
    false,
  );

  accepted = true;
  resolveDeletion(DELETION_PENDING);
  assert.deepEqual(await deletion, DELETION_PENDING);
  assert.equal((await check).kind, 'pending');
  assert.equal(harness.secureValues.size, 1);
});

test('offline uncertainty keeps a prepared receipt and locks without clearing Auth or installation', async () => {
  const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    throw new Error('offline');
  });
  const controller = createClientAccessController({
    gateway: harness.adapter.gateway,
    sessionStore: harness.adapter.sessionStore,
  });
  await controller.initialize();

  assert.deepEqual(await controller.deleteAccount(), { status: 'unavailable' });
  assert.equal(controller.getSnapshot().status, 'locked');
  assert.equal(harness.calls.some(([kind]) => kind === 'signOut'), false);
  assert.equal(harness.calls.some(([kind]) => kind === 'clearInstallation'), false);
  assert.deepEqual(await harness.adapter.deletionTracker.check(), {
    kind: 'unavailable',
    phase: 'prepared',
    realm: 'production_client',
  });
});

test('not-found cannot discard an ambiguous prepared receipt or restore the old session', async () => {
  const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  let offline = true;
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'refreshClientAccessV2') return { grant: ACTIVE_GRANT };
    if (name === 'deleteClientAccount' || offline) throw new Error('offline');
    const error = new Error('invalid_access');
    error.code = 'functions/not-found';
    throw error;
  });
  const controller = createClientAccessController({
    gateway: harness.adapter.gateway,
    sessionStore: harness.adapter.sessionStore,
  });
  await controller.initialize();
  assert.deepEqual(await controller.deleteAccount(), { status: 'unavailable' });

  offline = false;
  assert.deepEqual(await harness.adapter.deletionTracker.check(), {
    kind: 'unavailable',
    phase: 'prepared',
    realm: 'production_client',
  });
  assert.equal(harness.secureValues.size, 1);
  await controller.initialize();
  assert.equal(controller.getSnapshot().status, 'locked');
});

test('prepared not-found retries the exact idempotent deletion request before staying locked', async () => {
  const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  let deletionCalls = 0;
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'deleteClientAccount') {
      deletionCalls += 1;
      if (deletionCalls === 1) throw new Error('response_lost');
      return DELETION_PENDING;
    }
    if (name === 'getClientAccountDeletionStatus') {
      if (deletionCalls >= 2) return DELETION_PENDING;
      const error = new Error('invalid_access');
      error.code = 'functions/not-found';
      throw error;
    }
    throw new Error('wrong_callable');
  });
  const session = await harness.adapter.sessionStore.restore();

  assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), DELETION_PENDING);
  const deletionRequests = harness.calls.filter(([, name]) => name === 'deleteClientAccount');
  assert.equal(deletionRequests.length, 2);
  assert.equal(deletionRequests[0][2].deletionReceipt, deletionRequests[1][2].deletionReceipt);
  assert.equal((await harness.adapter.deletionTracker.check()).kind, 'pending');
});

test('accepted not-found never restores access and requires explicit safe archival', async () => {
  const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  let completedTtlExpired = false;
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'deleteClientAccount') return DELETION_PENDING;
    if (completedTtlExpired) {
      const error = new Error('invalid_access');
      error.code = 'functions/not-found';
      throw error;
    }
    return DELETION_PENDING;
  });
  const session = await harness.adapter.sessionStore.restore();
  assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), DELETION_PENDING);

  completedTtlExpired = true;
  assert.deepEqual(await harness.adapter.deletionTracker.check(), {
    kind: 'unavailable',
    phase: 'accepted',
    realm: 'production_client',
  });
  assert.equal(harness.secureValues.size, 1);
  assert.equal(await harness.adapter.deletionTracker.archiveAccepted(), true);
  assert.equal(harness.secureValues.size, 0);
  assert.equal(harness.calls.some(([kind]) => kind === 'signOut'), true);
});

test('an accepted receipt remains cleanup authority when the status response is malformed', async () => {
  const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'deleteClientAccount') return DELETION_PENDING;
    if (name === 'getClientAccountDeletionStatus') return { status: 'pending' };
    throw new Error('wrong_callable');
  });
  const session = await harness.adapter.sessionStore.restore();
  assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), DELETION_PENDING);

  assert.deepEqual(await harness.adapter.deletionTracker.check(), {
    kind: 'unavailable',
    phase: 'accepted',
    realm: 'production_client',
  });
  assert.equal(harness.calls.some(([kind]) => kind === 'clearInstallation'), true);
  assert.equal(harness.calls.some(([kind]) => kind === 'signOut'), true);
  assert.equal(harness.secureValues.size, 1);
});

test('manual polling advances pending to completed and Done clears only after confirmation', async () => {
  const harness = makeHarness({ currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456' });
  let status = DELETION_PENDING;
  harness.replaceCall(async (name, data) => {
    harness.calls.push(['call', name, data]);
    if (name === 'deleteAppReviewAccount') return DELETION_PENDING;
    if (name === 'getAppReviewAccountDeletionStatus') return status;
    throw new Error('wrong_realm');
  });
  const session = await harness.adapter.sessionStore.restore();
  assert.deepEqual(await harness.adapter.gateway.deleteAccount(session), DELETION_PENDING);

  assert.equal((await harness.adapter.deletionTracker.check()).kind, 'pending');
  status = DELETION_COMPLETED;
  const completed = await harness.adapter.deletionTracker.check();
  assert.equal(completed.kind, 'completed');
  assert.equal(harness.secureValues.size, 1);
  assert.equal(await harness.adapter.deletionTracker.acknowledgeCompleted(), true);
  assert.deepEqual(await harness.adapter.deletionTracker.check(), { kind: 'none' });
});

test('all authenticated operations fail closed when Firebase has no live client principal', async () => {
  const { adapter, calls } = makeHarness();
  const fakeSession = Object.freeze({});
  await assert.rejects(adapter.gateway.refresh(fakeSession), /client_session_unavailable/u);
  await assert.rejects(adapter.gateway.createLaunch(fakeSession, 'client-resources'), /client_session_unavailable/u);
  await assert.rejects(adapter.gateway.removeAccess(fakeSession), /client_session_unavailable/u);
  await assert.rejects(adapter.gateway.deleteAccount(fakeSession), /client_session_unavailable/u);
  assert.deepEqual(calls, []);
});
