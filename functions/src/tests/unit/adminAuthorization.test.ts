import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  authorizeProductionAdmin,
  authorizeProductionStaff,
} from '../../security/adminAuthorization.js';

const nowMs = Date.UTC(2026, 7, 21);
const validAuth = Object.freeze({
  token: Object.freeze({
    auth_time: Math.floor(nowMs / 1_000) - 60,
    catalogAdmin: true,
    firebase: Object.freeze({ sign_in_second_factor: 'totp' }),
  }),
  uid: 'owner_uid',
});
const validDocument = Object.freeze({
  active: true,
  permissions: Object.freeze(['client_codes']),
  schemaVersion: 1,
  scope: 'production',
});

test('production admin authorization rejects stale auth and every incomplete server-side role', async () => {
  await assert.doesNotReject(authorizeProductionAdmin({
    auth: validAuth, loadAdmin: async () => validDocument, nowMs, requiredPermission: 'client_codes',
  }));

  const cases = [
    { auth: { ...validAuth, token: { ...validAuth.token, auth_time: Math.floor(nowMs / 1_000) - 901 } }, document: validDocument },
    { auth: validAuth, document: undefined },
    { auth: validAuth, document: { ...validDocument, active: false } },
    { auth: validAuth, document: { ...validDocument, permissions: ['drafts'] } },
    { auth: validAuth, document: { ...validDocument, scope: 'review_sandbox' } },
    { auth: { ...validAuth, token: { ...validAuth.token, catalogAdmin: false } }, document: validDocument },
    {
      auth: {
        ...validAuth,
        token: {
          ...validAuth.token,
          firebase: { sign_in_second_factor: 'phone' },
        },
      },
      document: validDocument,
    },
  ] as const;

  for (const candidate of cases) {
    await assert.rejects(
      authorizeProductionAdmin({
        auth: candidate.auth,
        loadAdmin: async () => candidate.document,
        nowMs,
        requiredPermission: 'client_codes',
      }),
      /admin_authorization_failed/u,
    );
  }
});

test('staff bootstrap returns only known permissions from the active production document', async () => {
  assert.deepEqual(await authorizeProductionStaff({
    auth: validAuth,
    loadAdmin: async () => ({
      ...validDocument,
      permissions: ['client_resource_drafts', 'client_codes'],
    }),
    nowMs,
  }), {
    permissions: ['client_codes', 'client_resource_drafts'],
    scope: 'production',
    uid: 'owner_uid',
  });

  await assert.rejects(authorizeProductionStaff({
    auth: validAuth,
    loadAdmin: async () => ({ ...validDocument, permissions: ['owner'] }),
    nowMs,
  }), /admin_authorization_failed/u);
});

test('App Review rotation requires its exact permission in the active production staff document', async () => {
  await assert.doesNotReject(authorizeProductionAdmin({
    auth: validAuth,
    loadAdmin: async () => ({
      ...validDocument,
      permissions: ['app_review_credential'],
    }),
    nowMs,
    requiredPermission: 'app_review_credential',
  }));
  await assert.rejects(authorizeProductionAdmin({
    auth: validAuth,
    loadAdmin: async () => validDocument,
    nowMs,
    requiredPermission: 'app_review_credential',
  }), /admin_authorization_failed/u);
});
