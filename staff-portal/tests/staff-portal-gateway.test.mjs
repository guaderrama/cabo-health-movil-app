import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScopedStaffGateway,
  parseServerStaffSession,
} from '../.test-build/domain/staffGateway.js';

test('a server-granted review session cannot address production callables', async () => {
  const calls = [];
  const production = async (name, payload) => {
    calls.push({ transport: 'production', name, payload });
    return { codes: [] };
  };
  const review = async (name, payload) => {
    calls.push({ transport: 'review', name, payload });
    return { codes: [] };
  };

  const session = parseServerStaffSession({
    scope: 'review-sandbox',
    permissions: ['client_codes'],
  });
  const gateway = createScopedStaffGateway({ production, review, session });

  await gateway.listCodes();

  assert.deepEqual(calls, [{
    transport: 'review',
    name: 'reviewSandboxListClientAccessCodes',
    payload: {},
  }]);
  assert.equal(gateway.scope, 'review-sandbox');
});

test('production code administration uses only the implemented callables and never sends scope', async () => {
  const calls = [];
  const production = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'adminCreateClientAccessCode') {
      return {
        oneTimeCode: 'TEST-ONE-TIME',
        summary: {
          codeId: 'code_123',
          displaySuffix: 'TIME',
          expiresAtMs: 1_800_000_000_000,
          resourceIds: ['client-resources'],
          status: 'active',
        },
      };
    }
    if (name === 'adminRevokeClientAccessCode') return { revoked: true };
    return { codes: [] };
  };
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_codes'],
  });
  const gateway = createScopedStaffGateway({
    production,
    review: async () => assert.fail('review transport must stay isolated'),
    session,
  });

  await gateway.listCodes();
  const created = await gateway.createCode({
    expiresAtMs: 1_800_000_000_000,
    resourceIds: ['client-resources'],
  });
  await gateway.revokeCode('code_123');

  assert.equal(created.oneTimeCode, 'TEST-ONE-TIME');
  assert.deepEqual(calls, [
    { name: 'adminListClientAccessCodes', payload: {} },
    {
      name: 'adminCreateClientAccessCode',
      payload: {
        expiresAtMs: 1_800_000_000_000,
        resourceIds: ['client-resources'],
      },
    },
    { name: 'adminRevokeClientAccessCode', payload: { codeId: 'code_123' } },
  ]);
  assert.equal(calls.some(({ payload }) => 'scope' in payload), false);
});
