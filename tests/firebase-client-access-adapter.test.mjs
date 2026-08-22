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

function makeHarness({ currentUid = null } = {}) {
  let uid = currentUid;
  const calls = [];
  const auth = {
    waitForReady: async () => uid === null ? null : { uid },
    currentUser: () => uid === null ? null : { uid },
    signInWithCustomToken: async (customToken) => {
      calls.push(['signIn', customToken]);
      uid = 'client_abcdefghijklmnopqrstuvwxyz123456';
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
      if (name === 'createClientLaunch') {
        return {
          expiresAtMs: 1_900_000_060_000,
          launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
          method: 'POST',
          nonce: 'abcdefghijklmnopqrstuvwxyz123456',
        };
      }
      if (name === 'removeClientAccess') return { removed: true };
      if (name === 'deleteClientAccount') return { deleted: true };
      throw new Error(`Unexpected function ${name}`);
  };
  const functions = { call: (name, data) => callImpl(name, data) };
  const installation = {
    getOrCreate: async () => 'installation_abcdefghijklmnopqrstuvwxyz123456',
    clear: async () => { calls.push(['clearInstallation']); },
  };
  const requestIds = ['request_abcdefghijklmnop', 'request_qrstuvwxyz123456'];
  const adapter = createFirebaseClientAccessAdapter({
    auth,
    functions,
    installation,
    createRequestId: () => requestIds.shift() ?? 'request_fallback1234',
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

test('all authenticated operations fail closed when Firebase has no live client principal', async () => {
  const { adapter, calls } = makeHarness();
  const fakeSession = Object.freeze({});
  await assert.rejects(adapter.gateway.refresh(fakeSession), /client_session_unavailable/u);
  await assert.rejects(adapter.gateway.createLaunch(fakeSession, 'client-resources'), /client_session_unavailable/u);
  await assert.rejects(adapter.gateway.removeAccess(fakeSession), /client_session_unavailable/u);
  await assert.rejects(adapter.gateway.deleteAccount(fakeSession), /client_session_unavailable/u);
  assert.deepEqual(calls, []);
});
