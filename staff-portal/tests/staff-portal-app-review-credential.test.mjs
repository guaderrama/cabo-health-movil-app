import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAppReviewCredentialGateway,
  createAppReviewCredentialModel,
} from '../.test-build/domain/appReviewCredential.js';
import {
  parseServerStaffSession,
} from '../.test-build/domain/staffGateway.js';

test('App Review status and rotation use exact production callables with optimistic generation', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['app_review_credential'],
  });
  const gateway = createAppReviewCredentialGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      if (name === 'adminGetAppReviewCredentialStatus') {
        return {
          configured: false,
          generation: null,
          purpose: 'app_review',
          rotatedAtMs: null,
        };
      }
      return {
        generation: 1,
        oneTimeCredential: 'AR-00112233-44556677-8899AABB-CCDDEEFF',
        purpose: 'app_review',
        rotatedAtMs: 1_800_000_000_000,
      };
    },
  });

  assert.deepEqual(await gateway.status(), {
    configured: false,
    generation: null,
    purpose: 'app_review',
    rotatedAtMs: null,
  });
  assert.deepEqual(await gateway.rotate(null), {
    generation: 1,
    oneTimeCredential: 'AR-00112233-44556677-8899AABB-CCDDEEFF',
    purpose: 'app_review',
    rotatedAtMs: 1_800_000_000_000,
  });
  assert.deepEqual(calls, [
    { name: 'adminGetAppReviewCredentialStatus', payload: {} },
    { name: 'adminRotateAppReviewCredential', payload: { expectedGeneration: null } },
  ]);
});

test('the App Review plaintext exists only until verified copy and explicit acknowledgment', async () => {
  const rotations = [];
  const model = createAppReviewCredentialModel({
    async status() {
      return {
        configured: false,
        generation: null,
        purpose: 'app_review',
        rotatedAtMs: null,
      };
    },
    async rotate(expectedGeneration) {
      rotations.push(expectedGeneration);
      return {
        generation: 1,
        oneTimeCredential: 'AR-00112233-44556677-8899AABB-CCDDEEFF',
        purpose: 'app_review',
        rotatedAtMs: 1_800_000_000_000,
      };
    },
  });

  await model.load();
  await model.rotate();
  assert.equal(model.getSnapshot().oneTimeCredential, 'AR-00112233-44556677-8899AABB-CCDDEEFF');
  assert.equal(model.getSnapshot().copied, false);
  assert.deepEqual(rotations, [null]);
  await assert.rejects(model.rotate(), /app_review_credential_pending_acknowledgment/u);
  assert.throws(() => model.acknowledgeHidden(), /app_review_copy_required/u);

  model.markCopied();
  assert.equal(model.getSnapshot().copied, true);
  model.acknowledgeHidden();
  assert.equal(model.getSnapshot().oneTimeCredential, null);
  assert.equal(model.getSnapshot().copied, false);
});

test('App Review administration rejects response extensions and every non-production staff scope', async () => {
  let calls = 0;
  const reviewSession = parseServerStaffSession({
    scope: 'review-sandbox',
    permissions: ['app_review_credential'],
  });
  const reviewGateway = createAppReviewCredentialGateway({
    session: reviewSession,
    transport: async () => {
      calls += 1;
      return {};
    },
  });
  await assert.rejects(reviewGateway.status(), /staff_capability_unavailable/u);
  assert.equal(calls, 0);

  const productionSession = parseServerStaffSession({
    scope: 'production',
    permissions: ['app_review_credential'],
  });
  const extended = createAppReviewCredentialGateway({
    session: productionSession,
    transport: async () => ({
      configured: false,
      generation: null,
      purpose: 'app_review',
      rotatedAtMs: null,
      credentialHash: 'must-not-be-exposed',
    }),
  });
  await assert.rejects(extended.status(), /app_review_response_invalid/u);

  const malformedRotation = createAppReviewCredentialGateway({
    session: productionSession,
    transport: async () => ({
      generation: 1,
      oneTimeCredential: 'AR-00112233-44556677-8899aabb-CCDDEEFF',
      purpose: 'app_review',
      rotatedAtMs: 1_800_000_000_000,
    }),
  });
  await assert.rejects(malformedRotation.rotate(null), /app_review_response_invalid/u);
});

test('concurrent App Review rotation is blocked before a second one-time credential can be requested', async () => {
  let resolveRotation;
  let rotationCalls = 0;
  const model = createAppReviewCredentialModel({
    async status() {
      return {
        configured: true,
        generation: 4,
        purpose: 'app_review',
        rotatedAtMs: 1_799_000_000_000,
      };
    },
    async rotate() {
      rotationCalls += 1;
      return await new Promise((resolve) => { resolveRotation = resolve; });
    },
  });
  await model.load();

  const first = model.rotate();
  await assert.rejects(model.rotate(), /app_review_rotation_in_progress/u);
  assert.equal(rotationCalls, 1);
  resolveRotation({
    generation: 5,
    oneTimeCredential: 'AR-00112233-44556677-8899AABB-CCDDEEFF',
    purpose: 'app_review',
    rotatedAtMs: 1_800_000_000_000,
  });
  await first;
  assert.equal(model.getSnapshot().oneTimeCredential, 'AR-00112233-44556677-8899AABB-CCDDEEFF');
});
