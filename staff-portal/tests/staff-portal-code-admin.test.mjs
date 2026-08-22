import assert from 'node:assert/strict';
import test from 'node:test';

import { createCodeAdminModel } from '../.test-build/domain/codeAdminModel.js';
import { REVIEWED_CLIENT_RESOURCE_IDS } from '../.test-build/domain/staffGateway.js';

test('the release candidate grants only the fixed reviewed client resource', () => {
  assert.deepEqual(REVIEWED_CLIENT_RESOURCE_IDS, ['client-resources']);
  assert.equal(Object.isFrozen(REVIEWED_CLIENT_RESOURCE_IDS), true);
});

test('a newly issued code is held only until staff acknowledges copying it', async () => {
  let listCalls = 0;
  let createCalls = 0;
  const gateway = {
    scope: 'production',
    async listCodes() {
      listCalls += 1;
      return [];
    },
    async createCode() {
      createCalls += 1;
      return {
        oneTimeCode: 'CABO-ONLY-ONCE',
        summary: {
          codeId: 'code_1',
          displaySuffix: 'ONCE',
          expiresAtMs: 1_800_000_000_000,
          resourceIds: ['client-resources'],
          status: 'active',
        },
      };
    },
    async revokeCode() {},
  };
  const model = createCodeAdminModel(gateway);

  await model.load();
  await model.create({
    slot: 1,
    expiresAtMs: 1_800_000_000_000,
    resourceIds: ['client-resources'],
  });

  assert.equal(model.getSnapshot().oneTimeCode, 'CABO-ONLY-ONCE');
  assert.equal(listCalls, 2);
  await assert.rejects(model.create({
    slot: 2,
    expiresAtMs: 1_800_000_000_000,
    resourceIds: ['client-resources'],
  }), /code_acknowledgment_required/u);
  assert.equal(createCalls, 1);
  assert.equal(model.getSnapshot().oneTimeCode, 'CABO-ONLY-ONCE');

  model.acknowledgeCodeCopied();

  assert.equal(model.getSnapshot().oneTimeCode, null);
});

test('code administration always exposes four slots and a revoked slot becomes available', async () => {
  let codes = [{
    codeId: 'code_2',
    slot: 2,
    displaySuffix: 'A2B2',
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: 1_800_000_000_000,
    status: 'active',
  }];
  const gateway = {
    scope: 'production',
    async listCodes() { return codes; },
    async createCode() { throw new Error('not used'); },
    async revokeCode(codeId) {
      codes = codes.map((code) => code.codeId === codeId ? { ...code, status: 'revoked' } : code);
    },
  };
  const model = createCodeAdminModel(gateway);

  await model.load();
  assert.deepEqual(model.getSlots().map(({ slot, availability }) => ({ slot, availability })), [
    { slot: 1, availability: 'available' },
    { slot: 2, availability: 'active' },
    { slot: 3, availability: 'available' },
    { slot: 4, availability: 'available' },
  ]);

  await model.revoke('code_2');
  assert.equal(model.getSlots()[1].availability, 'available');
});

test('concurrent issuance is rejected so one-time plaintext can never be overwritten', async () => {
  let finishCreate;
  const gateway = {
    scope: 'production',
    async listCodes() { return []; },
    createCode() {
      return new Promise((resolve) => { finishCreate = resolve; });
    },
    async revokeCode() {},
  };
  const model = createCodeAdminModel(gateway);
  const request = {
    slot: 1,
    expiresAtMs: 1_800_000_000_000,
    resourceIds: ['client-resources'],
  };

  const first = model.create(request);
  await assert.rejects(model.create({ ...request, slot: 2 }), /code_creation_in_progress/u);
  finishCreate({
    oneTimeCode: 'FIRST-ONLY',
    summary: {
      codeId: 'code_1',
      displaySuffix: 'ONLY',
      expiresAtMs: request.expiresAtMs,
      resourceIds: request.resourceIds,
      status: 'active',
    },
  });
  await first;

  assert.equal(model.getSnapshot().oneTimeCode, 'FIRST-ONLY');
});

test('a successful one-time code remains revealable if the follow-up list refresh fails', async () => {
  const gateway = {
    scope: 'production',
    async listCodes() { throw new Error('refresh_unavailable'); },
    async createCode() {
      return {
        oneTimeCode: 'KEEP-ME-VISIBLE',
        summary: {
          codeId: 'code_1',
          displaySuffix: 'IBLE',
          expiresAtMs: 1_800_000_000_000,
          resourceIds: ['client-resources'],
          status: 'active',
        },
      };
    },
    async revokeCode() {},
  };
  const model = createCodeAdminModel(gateway);

  await model.create({
    slot: 1,
    expiresAtMs: 1_800_000_000_000,
    resourceIds: ['client-resources'],
  });

  assert.equal(model.getSnapshot().oneTimeCode, 'KEEP-ME-VISIBLE');
});
