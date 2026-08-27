import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClientResourceRoute,
  getClientResourceRouteExpiryDelay,
  normalizeClientResourceRouteParam,
  requestClientResourceRouteLaunch,
  resolveClientResourceRouteResource,
  resolveClientResourceRouteLaunchFailure,
} from '../.test-build/features/clientAccess/clientResourceRoute.js';

const resource = Object.freeze({
  access: 'client',
  iconKey: 'flask-outline',
  id: 'mitochondria',
  summary: Object.freeze({ en: 'Private summary.', es: 'Resumen privado.' }),
  title: Object.freeze({ en: 'Mitochondria', es: 'Mitocondrias' }),
});

const grant = Object.freeze({
  expiresAtMs: 1_900_000_000_000,
  resources: Object.freeze([resource]),
  schemaVersion: 1,
  status: 'active',
});

const launch = Object.freeze({
  expiresAtMs: 1_900_000_000_000,
  realm: 'production_client',
  source: Object.freeze({
    body: 'nonce=opaque',
    headers: Object.freeze({
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    }),
    method: 'POST',
    uri: 'https://cabohealth.org/apps/client-resources/launch/',
  }),
});

test('the internal route serializes only the exact resource id', () => {
  const route = buildClientResourceRoute('mitochondria');

  assert.deepEqual(route, {
    pathname: '/client-resource/[resourceId]',
    params: { resourceId: 'mitochondria' },
  });
  assert.deepEqual(Object.keys(route), ['pathname', 'params']);
  assert.deepEqual(Object.keys(route.params), ['resourceId']);
  assert.doesNotMatch(
    JSON.stringify(route),
    /https?:|"(?:url|uri|nonce|method|body|headers|source|realm|expiresAtMs)"\s*:/iu,
  );

  for (const invalid of [
    '',
    'Mitochondria',
    'mitochondria/extra',
    'mitochondria?nonce=secret',
    'a'.repeat(65),
  ]) {
    assert.throws(() => buildClientResourceRoute(invalid), /invalid_client_resource_id/u);
  }
});

test('route parameters and grants resolve only one exact assigned resource', () => {
  assert.equal(normalizeClientResourceRouteParam('mitochondria'), 'mitochondria');
  for (const malformed of [
    ['mitochondria'],
    '',
    ' mitochondria',
    'mitochondria ',
    'Mitochondria',
    'mitochondria/extra',
    'mitochondria?nonce=secret',
    'https://cabohealth.org/apps/client-resources/',
    'a'.repeat(65),
  ]) {
    assert.equal(normalizeClientResourceRouteParam(malformed), null);
  }

  assert.equal(resolveClientResourceRouteResource('mitochondria', 'unlocked', grant), resource);
  assert.equal(resolveClientResourceRouteResource('mitochondri', 'unlocked', grant), null);
  assert.equal(resolveClientResourceRouteResource('Mitochondria', 'unlocked', grant), null);
  assert.equal(resolveClientResourceRouteResource('mitochondria', 'checking', grant), null);
  assert.equal(resolveClientResourceRouteResource('mitochondria', 'locked', null), null);
});

test('production access expires on the exact clock boundary while App Review remains timer-free', () => {
  assert.equal(resolveClientResourceRouteResource(
    'mitochondria',
    'unlocked',
    grant,
    1_899_999_999_999,
  ), resource);
  assert.equal(resolveClientResourceRouteResource(
    'mitochondria',
    'unlocked',
    grant,
    1_900_000_000_000,
  ), null);
  assert.equal(getClientResourceRouteExpiryDelay(2_000, 1_250), 750);
  assert.equal(getClientResourceRouteExpiryDelay(1_250, 1_250), 0);
  assert.equal(getClientResourceRouteExpiryDelay(1_000, 1_250), 0);
  assert.equal(getClientResourceRouteExpiryDelay(null, 1_250), null);
  assert.equal(getClientResourceRouteExpiryDelay(3_000_000_000, 0), 2_147_000_000);

  const reviewGrant = Object.freeze({
    credentialGeneration: 1,
    expiresAtMs: null,
    purpose: 'app_review',
    resources: Object.freeze([resource]),
    schemaVersion: 1,
    scope: 'review_sandbox',
    status: 'active',
  });
  assert.equal(resolveClientResourceRouteResource(
    'mitochondria',
    'unlocked',
    reviewGrant,
    Number.MAX_SAFE_INTEGER,
  ), resource);
});

test('a launch refreshes access first and requests only the exact resource id', async () => {
  const effects = [];
  const result = await requestClientResourceRouteLaunch({
    resourceId: 'mitochondria',
    refresh: async () => { effects.push('refresh'); },
    createLaunch: async (resourceId) => {
      effects.push(`launch:${resourceId}`);
      return launch;
    },
    isCurrent: () => true,
  });

  assert.equal(result, launch);
  assert.deepEqual(effects, ['refresh', 'launch:mitochondria']);
});

test('leaving during refresh prevents the launch request', async () => {
  let current = true;
  let launchRequested = false;
  const result = await requestClientResourceRouteLaunch({
    resourceId: 'mitochondria',
    refresh: async () => { current = false; },
    createLaunch: async () => {
      launchRequested = true;
      return launch;
    },
    isCurrent: () => current,
  });

  assert.equal(result, null);
  assert.equal(launchRequested, false);
});

test('leaving while the nonce is in flight discards the late launch', async () => {
  let current = true;
  let finishLaunch;
  const deferredLaunch = new Promise((resolve) => { finishLaunch = resolve; });
  const pending = requestClientResourceRouteLaunch({
    resourceId: 'mitochondria',
    refresh: async () => {},
    createLaunch: async () => deferredLaunch,
    isCurrent: () => current,
  });

  await Promise.resolve();
  current = false;
  finishLaunch(launch);

  assert.equal(await pending, null);
});

test('an overlapped foreground refresh resumes once, while true access loss returns home', () => {
  assert.equal(resolveClientResourceRouteLaunchFailure({
    automaticRetryUsed: false,
    deletionTrackingKind: 'checking',
    resourceAvailable: false,
    status: 'checking',
  }), 'wait-for-revalidation');
  assert.equal(resolveClientResourceRouteLaunchFailure({
    automaticRetryUsed: false,
    deletionTrackingKind: 'none',
    resourceAvailable: true,
    status: 'unlocked',
  }), 'retry-once');
  assert.equal(resolveClientResourceRouteLaunchFailure({
    automaticRetryUsed: true,
    deletionTrackingKind: 'none',
    resourceAvailable: true,
    status: 'unlocked',
  }), 'show-unavailable');

  for (const accessLoss of [
    { deletionTrackingKind: 'pending', resourceAvailable: true, status: 'unlocked' },
    { deletionTrackingKind: 'none', resourceAvailable: false, status: 'unlocked' },
    { deletionTrackingKind: 'none', resourceAvailable: false, status: 'locked' },
    { deletionTrackingKind: 'none', resourceAvailable: false, status: 'error' },
  ]) {
    assert.equal(resolveClientResourceRouteLaunchFailure({
      automaticRetryUsed: false,
      ...accessLoss,
    }), 'return-home');
  }
});
