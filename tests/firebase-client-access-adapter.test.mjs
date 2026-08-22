import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFirebaseClientAccessAdapter,
} from '../.test-build/features/clientAccess/firebaseClientAccessAdapter.js';

const ACTIVE_GRANT = Object.freeze({
  schemaVersion: 1,
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

function makeHarness({
  currentUid = null,
  signedInUid = 'client_abcdefghijklmnopqrstuvwxyz123456',
  installationId = 'installation_abcdefghijklmnopqrstuvwxyz123456',
} = {}) {
  let uid = currentUid;
  const calls = [];
  const auth = {
    waitForReady: async () => uid === null ? null : { uid },
    currentUser: () => uid === null ? null : { uid },
    signInWithCustomToken: async (customToken) => {
      calls.push(['signIn', customToken]);
      uid = signedInUid;
      return { uid };
    },
    signOut: async () => { calls.push(['signOut']); uid = null; },
  };
  let callImpl = async (name, data) => {
      calls.push(['call', name, data]);
      if (name === 'redeemClientAccessCode') {
        return { customToken: 'firebase-custom-token', grant: ACTIVE_GRANT };
      }
      if (name === 'refreshClientAccess') return { grant: ACTIVE_GRANT };
      if (name === 'redeemAppReviewCredential') {
        return { customToken: 'firebase-review-custom-token', grant: REVIEW_GRANT };
      }
      if (name === 'refreshAppReviewAccess') return { grant: REVIEW_GRANT };
      if (name === 'createClientLaunch') {
        return {
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
      if (name === 'deleteClientAccount') return { status: 'pending' };
      throw new Error(`Unexpected function ${name}`);
  };
  const functions = { call: (name, data) => callImpl(name, data) };
  const installation = {
    getOrCreate: async () => installationId,
    clear: async () => { calls.push(['clearInstallation']); },
  };
  const requestIds = ['request_abcdefghijklmnop', 'request_qrstuvwxyz123456'];
  const adapter = createFirebaseClientAccessAdapter({
    auth,
    functions,
    installation,
    createRequestId: () => requestIds.shift() ?? 'request_fallback1234',
    now: () => 1_900_000_000_000,
  });
  return {
    adapter,
    calls,
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
    ['call', 'redeemClientAccessCode', {
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
    ['client_abcdefghijklmnopqrstuvwxyz123456', REVIEW_GRANT, 'refreshClientAccess'],
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
    ['call', 'refreshClientAccess', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
    ['call', 'createClientLaunch', {
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
  assert.deepEqual(deletion.calls, [
    ['call', 'deleteClientAccount', {
      installationId: 'installation_abcdefghijklmnopqrstuvwxyz123456',
    }],
    ['clearInstallation'],
  ]);
});

test('review removal and deletion never cross into production account callables', async () => {
  const harness = makeHarness({
    currentUid: 'review_abcdefghijklmnopqrstuvwxyz123456',
  });
  const session = await harness.adapter.sessionStore.restore();
  assert.ok(session);

  await harness.adapter.gateway.removeAccess(session);
  await harness.adapter.gateway.deleteAccount(session);

  assert.deepEqual(harness.calls, [['clearInstallation']]);
  assert.equal(harness.calls.some((entry) => (
    entry.includes('removeClientAccess') || entry.includes('deleteClientAccount')
  )), false);
});

test('account deletion accepts only the durable pending or completed backend contract', async () => {
  for (const status of ['pending', 'completed']) {
    const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
    harness.replaceCall(async () => ({ status }));
    const session = await harness.adapter.sessionStore.restore();
    await harness.adapter.gateway.deleteAccount(session);
    assert.deepEqual(harness.calls, [['clearInstallation']]);
  }

  for (const response of [
    { deleted: true },
    { status: 'queued' },
    { status: 'pending', extra: true },
  ]) {
    const harness = makeHarness({ currentUid: 'client_abcdefghijklmnopqrstuvwxyz123456' });
    harness.replaceCall(async () => response);
    const session = await harness.adapter.sessionStore.restore();
    await assert.rejects(
      harness.adapter.gateway.deleteAccount(session),
      /invalid_backend_response/u,
    );
    assert.deepEqual(harness.calls, []);
  }
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
