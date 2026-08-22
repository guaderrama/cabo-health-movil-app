import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STAFF_SESSION_MAX_AGE_MS,
  calculateStaffSessionExpiryMs,
  createAuthorizationBoundTransport,
  isStaffAuthorizationBoundaryError,
} from '../.test-build/domain/authBoundary.js';

test('the browser session expires exactly 15 minutes after the server-authenticated sign-in', () => {
  assert.equal(STAFF_SESSION_MAX_AGE_MS, 15 * 60 * 1000);
  assert.equal(calculateStaffSessionExpiryMs(1_700_000_000), 1_700_000_000_000 + (15 * 60 * 1000));
  for (const invalid of [undefined, null, 0, -1, 1.25, Number.NaN, '1700000000']) {
    assert.throws(() => calculateStaffSessionExpiryMs(invalid), /staff_auth_time_invalid/u);
  }
});

test('expired or denied callable authorization invalidates the session and preserves the server error', async () => {
  for (const code of [
    'functions/unauthenticated',
    'functions/permission-denied',
    'auth/id-token-expired',
    'auth/user-token-expired',
    'auth/requires-recent-login',
  ]) {
    const serverError = Object.assign(new Error('closed'), { code });
    let invalidations = 0;
    const transport = createAuthorizationBoundTransport(async () => {
      throw serverError;
    }, async () => { invalidations += 1; });

    await assert.rejects(() => transport('adminListClientAccessCodes', {}), (error) => error === serverError);
    assert.equal(invalidations, 1);
    assert.equal(isStaffAuthorizationBoundaryError(serverError), true);
  }
});

test('non-authorization callable failures do not sign staff out', async () => {
  const serverError = Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });
  let invalidations = 0;
  const transport = createAuthorizationBoundTransport(async () => {
    throw serverError;
  }, async () => { invalidations += 1; });

  await assert.rejects(() => transport('adminListClientAccessCodes', {}), (error) => error === serverError);
  assert.equal(invalidations, 0);
  assert.equal(isStaffAuthorizationBoundaryError({ code: 'permission-denied' }), false);
  assert.equal(isStaffAuthorizationBoundaryError(null), false);
});
