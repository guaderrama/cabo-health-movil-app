// Acceptance tests for the App Review / client launch clock defect found in
// build 3.0 (14) (Apple rejection of 2026-11-05, guideline 2.1(a)).
//
// Real code under test, no network, no credentials:
//   server: AppReviewCredentialService, AppReviewAccessRedeemer,
//           AppReviewSessionManager, AppReviewLaunchService, WebSessionBroker,
//           FirestoreAppReviewSandboxStore over the in-memory document database
//   client: firebaseClientAccessAdapter, clientAccessController, route policy
// Test boundaries: Firebase Auth (custom token -> uid), secure storage, and the
// callable transport, which dispatches straight into the server services.
//
// Build prerequisites (see npm script test:acceptance:launch):
//   node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json
//   npm --prefix functions test   (produces functions/test-build)
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const required = [
  '.test-build/features/clientAccess/firebaseClientAccessAdapter.js',
  'functions/test-build/domain/appReviewAccess.js',
  'functions/test-build/tests/support/inMemoryDocumentDatabase.js',
];
for (const file of required) {
  assert.ok(
    existsSync(path.join(root, file)),
    `Missing ${file}. Run: npm run test:acceptance:launch`,
  );
}
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const { createFirebaseClientAccessAdapter } = await load('.test-build/features/clientAccess/firebaseClientAccessAdapter.js');
const {
  CLIENT_LAUNCH_RESPONSE_BUDGET_MS,
  createClientAccessController,
} = await load('.test-build/features/clientAccess/clientAccessController.js');
const {
  beginClientResourceRouteRetry,
  describeClientResourceLaunchFailure,
  requestClientResourceRouteLaunch,
  resolveClientResourceRouteLaunchFailure,
} = await load('.test-build/features/clientAccess/clientResourceRoute.js');
const {
  APP_REVIEW_SAMPLE_RESOURCE,
  AppReviewAccessRedeemer,
  AppReviewCredentialService,
  AppReviewLaunchService,
  AppReviewSessionManager,
} = await load('functions/test-build/domain/appReviewAccess.js');
const { WebSessionBroker } = await load('functions/test-build/domain/webSessionBroker.js');
const { FirestoreAppReviewSandboxStore } = await load('functions/test-build/repositories/firestoreAppReviewSandboxStore.js');
const { VersionedHmac } = await load('functions/test-build/security/versionedHmac.js');
const { InMemoryDocumentDatabase } = await load('functions/test-build/tests/support/inMemoryDocumentDatabase.js');

const SERVER_EPOCH_MS = Date.parse('2026-11-05T08:24:53Z');
const RESOURCE_ID = APP_REVIEW_SAMPLE_RESOURCE.id;

function hasher(namespace) {
  return VersionedHmac.fromTestKeys({
    currentVersion: 'v1',
    keys: { v1: `${namespace}-app-review-acceptance-pepper-at-least-32-bytes` },
  });
}

/**
 * A world with one server clock, a device wall clock that is `skewMs` off and
 * may jump, and a device monotonic clock that only moves forward.
 */
async function createWorld({ skewMs = 0 } = {}) {
  let serverMs = SERVER_EPOCH_MS;
  let deviceWallOffsetMs = skewMs;
  let monotonicMs = 10_000;
  const advance = (ms) => { serverMs += ms; monotonicMs += ms; };
  const database = new InMemoryDocumentDatabase();
  const store = new FirestoreAppReviewSandboxStore(database);
  let randomByte = 1;
  const randomSource = (size) => Buffer.alloc(size, (randomByte++ % 250) + 1);
  const credentials = new AppReviewCredentialService({
    credentialHasher: hasher('credential'),
    nowMs: () => serverMs,
    randomSource,
    store,
  });
  const { oneTimeCredential } = await credentials.rotate({ expectedGeneration: null });
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasher('credential'),
    installationHasher: hasher('installation'),
    nowMs: () => serverMs,
    rateLimitHasher: hasher('rate'),
    store,
    tokenIssuer: { async createCustomToken(subjectUid) { return subjectUid; } },
  });
  const sessions = new AppReviewSessionManager({
    installationHasher: hasher('installation'),
    nowMs: () => serverMs,
    store,
  });
  const launches = new AppReviewLaunchService({
    installationHasher: hasher('installation'),
    nonceHasher: hasher('nonce'),
    nowMs: () => serverMs,
    randomSource,
    store,
  });
  const broker = new WebSessionBroker({
    csrfHasher: hasher('csrf'),
    nonceHasher: hasher('nonce'),
    nowMs: () => serverMs,
    randomSource,
    sessionHasher: hasher('session'),
    store,
  });

  let principal = null;
  let launchLatencyMs = 400;
  let onLaunchServed = null;
  const counters = { launches: 0, refreshes: 0, signOuts: 0 };
  const functions = {
    call: async (name, data) => {
      if (name === 'redeemAppReviewCredential') {
        return redeemer.redeem({ ...data, sourceAddress: '203.0.113.10' });
      }
      assert.ok(principal, `${name} requires an authenticated principal`);
      if (name === 'refreshAppReviewAccess') {
        counters.refreshes += 1;
        advance(250);
        return { grant: await sessions.refresh({ ...data, subjectUid: principal.uid }) };
      }
      assert.equal(name, 'createAppReviewLaunch');
      counters.launches += 1;
      const response = await launches.create({ ...data, subjectUid: principal.uid });
      advance(launchLatencyMs);
      if (onLaunchServed) await onLaunchServed();
      return response;
    },
  };
  const secure = new Map();
  const adapter = createFirebaseClientAccessAdapter({
    auth: {
      waitForReady: async () => principal,
      currentUser: () => principal,
      signInWithCustomToken: async (token) => { principal = { uid: token }; return principal; },
      signOut: async () => { counters.signOuts += 1; principal = null; },
    },
    deletionReceipts: { load: async () => ({ kind: 'none' }) },
    installation: {
      getOrCreate: async () => {
        if (!secure.has('installation')) secure.set('installation', 'installation_' + 'a'.repeat(32));
        return secure.get('installation');
      },
      clear: async () => { secure.delete('installation'); },
      markDeletionCleanupPending: async () => {},
      hasDeletionCleanupPending: async () => false,
      clearDeletionCleanupPending: async () => {},
    },
    createRequestId: () => `request_${String(randomByte).padStart(12, '0')}`,
    functions,
    now: () => serverMs + deviceWallOffsetMs,
  });
  const controller = createClientAccessController({
    gateway: adapter.gateway,
    sessionStore: adapter.sessionStore,
    now: () => serverMs + deviceWallOffsetMs,
    monotonicNow: () => monotonicMs,
  });
  await controller.initialize();
  assert.equal(await controller.redeem(oneTimeCredential), true);
  assert.equal(controller.getSnapshot().status, 'unlocked');

  /** What the route screen does: refresh, launch, one automatic retry. */
  const openFromRoute = async () => {
    let automaticRetryUsed = false;
    for (;;) {
      const launch = await requestClientResourceRouteLaunch({
        resourceId: RESOURCE_ID,
        refresh: () => controller.refresh(),
        createLaunch: (id) => controller.createLaunch(id),
        isCurrent: () => true,
      });
      if (launch) return { kind: 'open-webview', launch };
      const snapshot = controller.getSnapshot();
      const action = resolveClientResourceRouteLaunchFailure({
        automaticRetryUsed,
        deletionTrackingKind: 'none',
        resourceAvailable: snapshot.status === 'unlocked'
          && snapshot.grant?.resources.some((resource) => resource.id === RESOURCE_ID) === true,
        status: snapshot.status,
      });
      if (action !== 'retry-once') {
        return {
          kind: action,
          reference: describeClientResourceLaunchFailure(controller.getLastLaunchFailure()),
        };
      }
      automaticRetryUsed = true;
    }
  };

  /** What the WebView POST to the Hostinger broker does, on the server clock. */
  const postNonceToBroker = (launch, brokerRequestFill = 'r') => {
    const nonce = new URLSearchParams(launch.source.body).get('nonce');
    return broker.redeemLaunch({ brokerRequestHash: brokerRequestFill.repeat(43), nonce });
  };

  return {
    advance,
    counters,
    controller,
    openFromRoute,
    postNonceToBroker,
    setLaunchLatency: (ms) => { launchLatencyMs = ms; },
    jumpDeviceWallClock: (ms) => { deviceWallOffsetMs += ms; },
    onLaunchServed: (fn) => { onLaunchServed = fn; },
  };
}

for (const skewMs of [0, 59_000, 60_000, -61_000, 5 * 60_000, -24 * 60 * 60_000, 365 * 24 * 60 * 60_000]) {
  test(`a fresh review sample opens with the device clock ${skewMs >= 0 ? '+' : ''}${skewMs / 1000}s off`, async () => {
    const world = await createWorld({ skewMs });
    const outcome = await world.openFromRoute();
    assert.equal(outcome.kind, 'open-webview', JSON.stringify(outcome));
    assert.equal(world.counters.launches, 1);
    assert.equal(world.counters.signOuts, 0);
    const session = await world.postNonceToBroker(outcome.launch);
    assert.ok(session.sessionId, 'the broker must accept the fresh nonce');
  });
}

test('a 4.4 s cold-start launch (as logged on 2026-11-05) opens with a skewed clock', async () => {
  const world = await createWorld({ skewMs: 90_000 });
  world.setLaunchLatency(4_348);
  const outcome = await world.openFromRoute();
  assert.equal(outcome.kind, 'open-webview');
  assert.ok((await world.postNonceToBroker(outcome.launch)).sessionId);
});

test('a device wall-clock change during the call does not block the launch', async () => {
  const world = await createWorld();
  world.onLaunchServed(async () => world.jumpDeviceWallClock(-3 * 60 * 60_000));
  const outcome = await world.openFromRoute();
  assert.equal(outcome.kind, 'open-webview');
  assert.ok((await world.postNonceToBroker(outcome.launch)).sessionId);
});

test('a response slower than the local budget is refused, access kept, reason visible', async () => {
  const world = await createWorld();
  world.setLaunchLatency(CLIENT_LAUNCH_RESPONSE_BUDGET_MS + 1);
  const outcome = await world.openFromRoute();
  assert.deepEqual(outcome, { kind: 'show-unavailable', reference: 'L-T1' });
  assert.equal(world.counters.launches, 2);
  assert.equal(world.controller.getSnapshot().status, 'unlocked');
  assert.equal(world.counters.signOuts, 0);
  // Recovers once the network is normal again.
  world.setLaunchLatency(400);
  assert.equal((await world.openFromRoute()).kind, 'open-webview');
});

test('the server, not the device, rejects an expired nonce', async () => {
  const world = await createWorld({ skewMs: -10 * 60_000 });
  const outcome = await world.openFromRoute();
  assert.equal(outcome.kind, 'open-webview');
  world.advance(60_001);
  await assert.rejects(world.postNonceToBroker(outcome.launch));
});

test('the server rejects a reused nonce', async () => {
  const world = await createWorld({ skewMs: 120_000 });
  const outcome = await world.openFromRoute();
  assert.equal(outcome.kind, 'open-webview');
  assert.ok((await world.postNonceToBroker(outcome.launch, 'r')).sessionId);
  await assert.rejects(world.postNonceToBroker(outcome.launch, 's'));
});

for (const failure of ['consumed', 'expired']) {
  test(`retry recovers a ${failure} review launch with a fresh server nonce`, async () => {
    const world = await createWorld({ skewMs: 120_000 });
    const first = await world.openFromRoute();
    assert.equal(first.kind, 'open-webview');
    if (failure === 'consumed') {
      assert.ok((await world.postNonceToBroker(first.launch, 'a')).sessionId);
    } else {
      world.advance(60_001);
    }
    await assert.rejects(world.postNonceToBroker(first.launch, 'b'));
    const retry = beginClientResourceRouteRetry({
      activeLaunch: first.launch,
      attempt: 0,
      operationGeneration: 1,
    });
    assert.equal(retry.activeLaunch, null, 'unmount the failed POST before requesting another');
    const refreshedBefore = world.counters.refreshes;
    const replacement = await world.openFromRoute();
    assert.equal(replacement.kind, 'open-webview');
    assert.equal(world.counters.refreshes, refreshedBefore + 1);
    assert.notEqual(replacement.launch.source.body, first.launch.source.body);
    assert.ok((await world.postNonceToBroker(replacement.launch, 'c')).sessionId);
    await assert.rejects(world.postNonceToBroker(first.launch, 'd'));
    assert.equal(world.counters.signOuts, 0);
  });
}

test('a refresh that overlaps the first launch is reported and the retry opens', async () => {
  const world = await createWorld({ skewMs: 75_000 });
  let overlapped = false;
  world.onLaunchServed(async () => {
    if (!overlapped) { overlapped = true; await world.controller.refresh(); }
  });
  const outcome = await world.openFromRoute();
  assert.equal(outcome.kind, 'open-webview');
  assert.equal(world.counters.launches, 2);
});

test('a malformed launch response still fails closed', async () => {
  const world = await createWorld();
  world.onLaunchServed(async () => { throw Object.assign(new Error('internal'), { code: 'internal' }); });
  const outcome = await world.openFromRoute();
  assert.equal(outcome.kind, 'show-unavailable');
  assert.equal(outcome.reference, 'L-C1');
});
