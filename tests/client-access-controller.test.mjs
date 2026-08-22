import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createClientAccessController,
  createOpaqueClientSession,
  normalizeClientAccessCode,
} from '../.test-build/features/clientAccess/clientAccessController.js';

const future = Date.now() + 60_000;
const grant = Object.freeze({
  schemaVersion: 1,
  status: 'active',
  expiresAtMs: future,
  resources: Object.freeze([
    Object.freeze({
      id: 'microbiota-guide',
      title: Object.freeze({ en: 'Microbiota Guide', es: 'Guía de microbiota' }),
      summary: Object.freeze({
        en: 'Evidence-based guidance for CaboHealth clients.',
        es: 'Orientación basada en evidencia para clientes de CaboHealth.',
      }),
      iconKey: 'leaf-outline',
      access: 'client',
    }),
  ]),
});

test('a valid code establishes access while storage sees only an opaque session', async () => {
  const code = 'CH-ABCDEF01-23456789-A1B2C3D4-E5F60718';
  const session = createOpaqueClientSession();
  const persisted = [];
  const gateway = {
    redeem: async (submittedCode) => {
      assert.equal(submittedCode, code);
      return { session, grant };
    },
    refresh: async () => null,
    removeAccess: async () => {},
    deleteAccount: async () => {},
    signOut: async () => {},
  };
  const sessionStore = {
    restore: async () => null,
    commit: async (value) => { persisted.push(value); },
    clear: async () => {},
  };
  const controller = createClientAccessController({ gateway, sessionStore });

  assert.equal(await controller.redeem(code), true);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'unlocked',
    grant,
    error: null,
  });
  assert.deepEqual(persisted, [session]);
  assert.notEqual(persisted[0], code);
  assert.deepEqual(Object.keys(persisted[0]), []);
});

test('malformed codes fail locally without reaching the gateway or storage', async () => {
  const effects = [];
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => { effects.push('gateway'); return null; },
      refresh: async () => null,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => null,
      commit: async () => { effects.push('storage'); },
      clear: async () => {},
    },
  });

  assert.equal(await controller.redeem('not a cabohealth code'), false);
  assert.deepEqual(effects, []);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: 'invalid-code',
  });
});

test('an expired grant is rejected and its newly established session is cleared', async () => {
  const effects = [];
  const session = createOpaqueClientSession();
  const controller = createClientAccessController({
    now: () => future,
    gateway: {
      redeem: async () => ({
        session,
        grant: { ...grant, expiresAtMs: future - 1 },
      }),
      refresh: async () => null,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => { effects.push('sign-out'); },
    },
    sessionStore: {
      restore: async () => null,
      commit: async () => { effects.push('commit'); },
      clear: async () => { effects.push('clear'); },
    },
  });

  assert.equal(await controller.redeem('CH-ABCDEF01-23456789-A1B2C3D4-E5F60718'), false);
  assert.deepEqual(effects, ['sign-out', 'clear']);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: 'invalid-code',
  });
});

test('a session commit failure never exposes client resources and signs out locally', async () => {
  const effects = [];
  const session = createOpaqueClientSession();
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => ({ session, grant }),
      refresh: async () => null,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => { effects.push('sign-out'); },
    },
    sessionStore: {
      restore: async () => null,
      commit: async () => { effects.push('commit'); throw new Error('unavailable'); },
      clear: async () => { effects.push('clear'); },
    },
  });

  assert.equal(await controller.redeem('CH-ABCDEF01-23456789-A1B2C3D4-E5F60718'), false);
  assert.deepEqual(effects, ['commit', 'sign-out', 'clear']);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'error',
    grant: null,
    error: 'unavailable',
  });
});

test('cold start restores an opaque session and refreshes the grant before unlocking', async () => {
  const session = createOpaqueClientSession();
  const effects = [];
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => null,
      refresh: async (value) => { effects.push(['refresh', value]); return grant; },
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => { effects.push(['restore']); return session; },
      commit: async () => {},
      clear: async () => {},
    },
  });

  await controller.initialize();

  assert.deepEqual(effects, [['restore'], ['refresh', session]]);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'unlocked',
    grant,
    error: null,
  });
});

test('cold start rejects a malformed restored session before calling the gateway', async () => {
  const effects = [];
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => null,
      refresh: async () => { effects.push('refresh'); return grant; },
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => { effects.push('sign-out'); },
    },
    sessionStore: {
      restore: async () => ({ credential: 'must-not-leak' }),
      commit: async () => {},
      clear: async () => { effects.push('clear'); },
    },
  });

  await controller.initialize();

  assert.deepEqual(effects, ['sign-out', 'clear']);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: null,
  });
});

test('a revoked foreground refresh clears the session and locks resources', async () => {
  const session = createOpaqueClientSession();
  const effects = [];
  let refreshCount = 0;
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => null,
      refresh: async () => (refreshCount++ === 0 ? grant : null),
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => { effects.push('sign-out'); },
    },
    sessionStore: {
      restore: async () => session,
      commit: async () => {},
      clear: async () => { effects.push('clear'); },
    },
  });

  await controller.initialize();
  assert.equal(controller.getSnapshot().status, 'unlocked');
  await controller.refresh();

  assert.deepEqual(effects, ['sign-out', 'clear']);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: null,
  });
});

for (const action of ['removeAccess', 'deleteAccount']) {
  test(`${action} locks immediately and clears local access even when the server fails`, async () => {
    const session = createOpaqueClientSession();
    const effects = [];
    const gateway = {
      redeem: async () => null,
      refresh: async () => grant,
      removeAccess: async () => { effects.push('remove-remote'); throw new Error('offline'); },
      deleteAccount: async () => { effects.push('delete-remote'); throw new Error('offline'); },
      signOut: async () => { effects.push('sign-out'); },
    };
    const controller = createClientAccessController({
      gateway,
      sessionStore: {
        restore: async () => session,
        commit: async () => {},
        clear: async () => { effects.push('clear'); },
      },
    });
    await controller.initialize();

    const operation = controller[action]();
    assert.equal(controller.getSnapshot().grant, null);
    assert.notEqual(controller.getSnapshot().status, 'unlocked');
    assert.equal(await operation, false);
    assert.deepEqual(effects, [
      action === 'removeAccess' ? 'remove-remote' : 'delete-remote',
      'sign-out',
      'clear',
    ]);
    assert.deepEqual(controller.getSnapshot(), {
      status: 'error',
      grant: null,
      error: 'unavailable',
    });
  });
}

test('gateway grants fail closed when a client resource contains an unapproved field', async () => {
  const session = createOpaqueClientSession();
  const effects = [];
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => ({
        session,
        grant: {
          ...grant,
          resources: [{ ...grant.resources[0], url: 'https://private.example/resource' }],
        },
      }),
      refresh: async () => null,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => { effects.push('sign-out'); },
    },
    sessionStore: {
      restore: async () => null,
      commit: async () => { effects.push('commit'); },
      clear: async () => { effects.push('clear'); },
    },
  });

  assert.equal(await controller.redeem('CH-ABCDEF01-23456789-A1B2C3D4-E5F60718'), false);
  assert.deepEqual(effects, ['sign-out', 'clear']);
  assert.equal(controller.getSnapshot().grant, null);
});

test('subscribers observe redeeming before unlocked and can unsubscribe', async () => {
  const session = createOpaqueClientSession();
  const statuses = [];
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => ({ session, grant }),
      refresh: async () => null,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => null,
      commit: async () => {},
      clear: async () => {},
    },
  });
  const unsubscribe = controller.subscribe((snapshot) => statuses.push(snapshot.status));

  await controller.redeem('CH-ABCDEF01-23456789-A1B2C3D4-E5F60718');
  unsubscribe();
  await controller.refresh();

  assert.deepEqual(statuses, ['redeeming', 'unlocked']);
});

test('remove access wins over an older in-flight redemption', async () => {
  const session = createOpaqueClientSession();
  let resolveRedeem;
  const pendingRedeem = new Promise((resolve) => { resolveRedeem = resolve; });
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => pendingRedeem,
      refresh: async () => null,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => null,
      commit: async () => {},
      clear: async () => {},
    },
  });

  const redemption = controller.redeem('CH-ABCDEF01-23456789-A1B2C3D4-E5F60718');
  await controller.removeAccess();
  resolveRedeem({ session, grant });

  assert.equal(await redemption, false);
  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: null,
  });
});

test('remove access wins over an older in-flight foreground refresh', async () => {
  const session = createOpaqueClientSession();
  let resolveRefresh;
  const pendingRefresh = new Promise((resolve) => { resolveRefresh = resolve; });
  let calls = 0;
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => null,
      refresh: async () => (calls++ === 0 ? grant : pendingRefresh),
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => session,
      commit: async () => {},
      clear: async () => {},
    },
  });
  await controller.initialize();

  const refresh = controller.refresh();
  await controller.removeAccess();
  resolveRefresh(grant);
  await refresh;

  assert.deepEqual(controller.getSnapshot(), {
    status: 'locked',
    grant: null,
    error: null,
  });
});

test('a foreground event does not cancel an in-flight user redemption', async () => {
  const session = createOpaqueClientSession();
  let resolveRedeem;
  const pendingRedeem = new Promise((resolve) => { resolveRedeem = resolve; });
  const controller = createClientAccessController({
    gateway: {
      redeem: async () => pendingRedeem,
      refresh: async () => null,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => null,
      commit: async () => {},
      clear: async () => {},
    },
  });

  const redemption = controller.redeem('CH-ABCDEF01-23456789-A1B2C3D4-E5F60718');
  await controller.refresh();
  resolveRedeem({ session, grant });

  assert.equal(await redemption, true);
  assert.equal(controller.getSnapshot().status, 'unlocked');
});

test('access codes contain 128 bits of hex entropy and normalize only presentation separators', () => {
  assert.equal(
    normalizeClientAccessCode(' ch abcdef01 23456789 a1b2c3d4 e5f60718 '),
    'CH-ABCDEF01-23456789-A1B2C3D4-E5F60718',
  );
  assert.equal(normalizeClientAccessCode('CH-ABCD-EF01-2345-6789'), null);
  assert.equal(normalizeClientAccessCode('CH-GBCDEF01-23456789-A1B2C3D4-E5F60718'), null);
});

test('an unlocked assigned resource creates only a short-lived CaboHealth POST launch', async () => {
  const session = createOpaqueClientSession();
  const effects = [];
  const controller = createClientAccessController({
    now: () => future - 30_000,
    gateway: {
      redeem: async () => null,
      refresh: async () => grant,
      createLaunch: async (receivedSession, resourceId) => {
        effects.push([receivedSession, resourceId]);
        return {
          launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
          method: 'POST',
          nonce: '8m3Vtw10f7A0W6U7uDiRAHs6og3LL5dckSDzbOqrnDs',
          expiresAtMs: future,
        };
      },
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => session,
      commit: async () => {},
      clear: async () => {},
    },
  });
  await controller.initialize();

  const launch = await controller.createLaunch('microbiota-guide');

  assert.deepEqual(effects, [[session, 'microbiota-guide']]);
  assert.deepEqual(launch, {
    source: {
      uri: 'https://cabohealth.org/apps/client-resources/launch/',
      method: 'POST',
      body: 'nonce=8m3Vtw10f7A0W6U7uDiRAHs6og3LL5dckSDzbOqrnDs',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    },
    expiresAtMs: future,
  });
  assert.deepEqual(controller.getSnapshot(), {
    status: 'unlocked',
    grant,
    error: null,
  });
});

test('launches fail closed for unassigned resources and malformed or overlong responses', async () => {
  const session = createOpaqueClientSession();
  const effects = [];
  const responses = [
    {
      launchUrl: 'https://cabohealth.org/apps/client-resources/launch/?resource=secret',
      method: 'POST',
      nonce: '8m3Vtw10f7A0W6U7uDiRAHs6og3LL5dckSDzbOqrnDs',
      expiresAtMs: future,
    },
    {
      launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
      method: 'GET',
      nonce: '8m3Vtw10f7A0W6U7uDiRAHs6og3LL5dckSDzbOqrnDs',
      expiresAtMs: future,
    },
    {
      launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
      method: 'POST',
      nonce: 'too-short',
      expiresAtMs: future,
    },
    {
      launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
      method: 'POST',
      nonce: '8m3Vtw10f7A0W6U7uDiRAHs6og3LL5dckSDzbOqrnDs',
      expiresAtMs: future + 300_000,
    },
    {
      launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
      method: 'POST',
      nonce: '8m3Vtw10f7A0W6U7uDiRAHs6og3LL5dckSDzbOqrnDs',
      expiresAtMs: future,
      targetUrl: 'https://private.example/resource',
    },
  ];
  const controller = createClientAccessController({
    now: () => future - 30_000,
    gateway: {
      redeem: async () => null,
      refresh: async () => grant,
      createLaunch: async (_receivedSession, resourceId) => {
        effects.push(resourceId);
        return responses.shift();
      },
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => session,
      commit: async () => {},
      clear: async () => {},
    },
  });
  await controller.initialize();

  assert.equal(await controller.createLaunch('not-assigned'), null);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(await controller.createLaunch('microbiota-guide'), null);
  }
  assert.deepEqual(effects, Array(5).fill('microbiota-guide'));
  assert.equal(controller.getSnapshot().status, 'unlocked');
});

test('an expired grant is cleared instead of launching a client resource', async () => {
  const session = createOpaqueClientSession();
  const effects = [];
  let nowMs = future - 30_000;
  const controller = createClientAccessController({
    now: () => nowMs,
    gateway: {
      redeem: async () => null,
      refresh: async () => grant,
      createLaunch: async () => { effects.push('launch'); return null; },
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => { effects.push('sign-out'); },
    },
    sessionStore: {
      restore: async () => session,
      commit: async () => {},
      clear: async () => { effects.push('clear'); },
    },
  });
  await controller.initialize();
  nowMs = future;

  assert.equal(await controller.createLaunch('microbiota-guide'), null);
  assert.deepEqual(effects, ['sign-out', 'clear']);
  assert.equal(controller.getSnapshot().status, 'locked');
});

test('removing access invalidates an older in-flight launch nonce', async () => {
  const session = createOpaqueClientSession();
  let resolveLaunch;
  const pendingLaunch = new Promise((resolve) => { resolveLaunch = resolve; });
  const controller = createClientAccessController({
    now: () => future - 30_000,
    gateway: {
      redeem: async () => null,
      refresh: async () => grant,
      createLaunch: async () => pendingLaunch,
      removeAccess: async () => {},
      deleteAccount: async () => {},
      signOut: async () => {},
    },
    sessionStore: {
      restore: async () => session,
      commit: async () => {},
      clear: async () => {},
    },
  });
  await controller.initialize();

  const launch = controller.createLaunch('microbiota-guide');
  await controller.removeAccess();
  resolveLaunch({
    launchUrl: 'https://cabohealth.org/apps/client-resources/launch/',
    method: 'POST',
    nonce: '8m3Vtw10f7A0W6U7uDiRAHs6og3LL5dckSDzbOqrnDs',
    expiresAtMs: future,
  });

  assert.equal(await launch, null);
  assert.equal(controller.getSnapshot().status, 'locked');
});
