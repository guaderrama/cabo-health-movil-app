import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFirebaseBootstrapPlan } from '../../domain/firebaseActivationBootstrap.js';
import { AdminFirebaseBootstrapBoundary } from '../../infrastructure/adminFirebaseBootstrapBoundary.js';
import { InMemoryDocumentDatabase } from '../support/inMemoryDocumentDatabase.js';

const plan = createFirebaseBootstrapPlan({
  environment: 'production',
  ownerUid: 'owner_uid_0123456789',
  projectId: 'cabohealth-owner-prod',
  reviewDatabaseId: 'cabohealth-review-production',
});

test('Admin boundary maps the existing Auth owner and creates both fixed documents atomically', async () => {
  const database = new InMemoryDocumentDatabase();
  const claimWrites: unknown[] = [];
  const boundary = new AdminFirebaseBootstrapBoundary({
    auth: {
      getUser: async () => ({
        customClaims: { existingClaim: 'preserved' },
        disabled: false,
        factorIds: ['totp'],
      }),
      setCustomClaims: async (uid, claims) => {
        claimWrites.push({ uid, claims });
      },
    },
    database,
    projectId: plan.projectId,
  });

  assert.deepEqual(await boundary.loadOwner(plan.owner.uid), {
    customClaims: { existingClaim: 'preserved' },
    disabled: false,
    factorIds: ['totp'],
  });
  await boundary.ensureDocumentsExact([
    plan.owner.adminDocument,
    plan.clientResourceDocument,
  ]);
  await boundary.setCustomClaims(plan.owner.uid, {
    catalogAdmin: true,
    existingClaim: 'preserved',
  });

  assert.deepEqual(JSON.parse(database.serializedState()), {
    [plan.owner.adminDocument.path]: plan.owner.adminDocument.value,
    [plan.clientResourceDocument.path]: plan.clientResourceDocument.value,
  });
  assert.deepEqual(claimWrites, [{
    uid: plan.owner.uid,
    claims: { catalogAdmin: true, existingClaim: 'preserved' },
  }]);
});

test('Admin boundary is idempotent for exact documents and aborts all writes on any drift', async () => {
  const exact = new InMemoryDocumentDatabase({
    [plan.owner.adminDocument.path]: plan.owner.adminDocument.value,
    [plan.clientResourceDocument.path]: plan.clientResourceDocument.value,
  });
  const exactBoundary = new AdminFirebaseBootstrapBoundary({
    auth: inertAuth(),
    database: exact,
    projectId: plan.projectId,
  });
  await assert.doesNotReject(exactBoundary.ensureDocumentsExact([
    plan.owner.adminDocument,
    plan.clientResourceDocument,
  ]));

  const drifted = new InMemoryDocumentDatabase({
    [plan.clientResourceDocument.path]: {
      ...plan.clientResourceDocument.value,
      status: 'archived',
    },
  });
  const driftedBoundary = new AdminFirebaseBootstrapBoundary({
    auth: inertAuth(),
    database: drifted,
    projectId: plan.projectId,
  });
  await assert.rejects(
    driftedBoundary.ensureDocumentsExact([
      plan.owner.adminDocument,
      plan.clientResourceDocument,
    ]),
    /firebase_bootstrap_document_drift/u,
  );
  assert.equal(JSON.parse(drifted.serializedState())[plan.owner.adminDocument.path], undefined);
});

function inertAuth() {
  return {
    getUser: async () => undefined,
    setCustomClaims: async () => {},
  };
}
