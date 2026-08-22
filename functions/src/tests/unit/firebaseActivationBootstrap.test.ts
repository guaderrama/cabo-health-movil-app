import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyFirebaseBootstrapPlan,
  createFirebaseBootstrapPlan,
  hashFirebaseBootstrapPlan,
  parseFirebaseBootstrapPlan,
  sanitizeFirebaseBootstrapEvidence,
} from '../../domain/firebaseActivationBootstrap.js';

const input = Object.freeze({
  environment: 'production' as const,
  ownerUid: 'owner_uid_0123456789',
  projectId: 'cabohealth-owner-prod',
  reviewDatabaseId: 'cabohealth-review-production',
});

test('bootstrap plan contains only the fixed owner authority and reviewed client-resources record', () => {
  const plan = createFirebaseBootstrapPlan(input);

  assert.deepEqual(plan, {
    artifactKind: 'cabohealth-firebase-bootstrap-plan',
    schemaVersion: 1,
    environment: 'production',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
    owner: {
      uid: 'owner_uid_0123456789',
      requiredFactorId: 'totp',
      customClaims: { catalogAdmin: true },
      adminDocument: {
        path: '_private_admins/owner_uid_0123456789',
        value: {
          active: true,
          permissions: [
            'client_codes',
            'client_resource_drafts',
            'app_review_credential',
          ],
          schemaVersion: 1,
          scope: 'production',
        },
      },
    },
    clientResourceDocument: {
      path: '_private_client_resources/client-resources',
      value: {
        access: 'client',
        iconKey: 'featured',
        id: 'client-resources',
        schemaVersion: 1,
        status: 'active',
        summary: {
          en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
          es: 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
        },
        title: {
          en: 'Client Resources',
          es: 'Recursos para clientes',
        },
      },
    },
  });
  assert.match(hashFirebaseBootstrapPlan(plan), /^[a-f0-9]{64}$/u);
  assert.equal(hashFirebaseBootstrapPlan(plan), hashFirebaseBootstrapPlan(plan));
});

test('dry-run evidence is useful but omits the owner UID and document contents', () => {
  const plan = createFirebaseBootstrapPlan(input);
  const evidence = sanitizeFirebaseBootstrapEvidence(plan, 'dry-run');
  const serialized = JSON.stringify(evidence);

  assert.deepEqual(evidence.operations, [
    'verify-owner-enabled-and-totp',
    'ensure-production-admin-document',
    'ensure-client-resources-document',
    'ensure-catalogAdmin-claim',
  ]);
  assert.equal(evidence.status, 'dry-run');
  assert.equal(evidence.containsSensitiveValues, false);
  assert.equal(serialized.includes(input.ownerUid), false);
  assert.equal(serialized.includes('Complimentary educational resources'), false);
});

test('bootstrap plan rejects ambiguous topology, unsafe owner paths, and any caller-shaped resource data', () => {
  for (const candidate of [
    { ...input, environment: 'prod' },
    { ...input, projectId: 'cabohealth-owner-staging' },
    { ...input, reviewDatabaseId: 'cabohealth-review-staging' },
    { ...input, reviewDatabaseId: '(default)' },
    { ...input, ownerUid: 'owners/second-owner' },
    { ...input, ownerUid: '' },
  ]) {
    assert.throws(
      () => createFirebaseBootstrapPlan(candidate as typeof input),
      /firebase_bootstrap_plan_invalid/u,
    );
  }

  const plan = createFirebaseBootstrapPlan(input);
  assert.deepEqual(parseFirebaseBootstrapPlan(JSON.parse(JSON.stringify(plan))), plan);
  for (const candidate of [
    { ...plan, arbitraryUrl: 'https://example.org/' },
    {
      ...plan,
      clientResourceDocument: {
        ...plan.clientResourceDocument,
        value: { ...plan.clientResourceDocument.value, url: 'https://example.org/' },
      },
    },
    {
      ...plan,
      owner: {
        ...plan.owner,
        adminDocument: {
          ...plan.owner.adminDocument,
          value: { ...plan.owner.adminDocument.value, permissions: ['client_codes'] },
        },
      },
    },
  ]) {
    assert.throws(() => parseFirebaseBootstrapPlan(candidate), /firebase_bootstrap_plan_invalid/u);
  }
});

test('bootstrap is dry-run by default and never initializes the Admin boundary', async () => {
  const plan = createFirebaseBootstrapPlan(input);
  let boundaryLoads = 0;

  const evidence = await applyFirebaseBootstrapPlan({
    apply: false,
    boundary: async () => {
      boundaryLoads += 1;
      throw new Error('must_not_load');
    },
    expectedEnvironment: input.environment,
    expectedProjectId: input.projectId,
    expectedReviewDatabaseId: input.reviewDatabaseId,
    plan,
    reviewedPlanSha256: undefined,
  });

  assert.equal(evidence.status, 'dry-run');
  assert.equal(boundaryLoads, 0);
});

test('apply requires the reviewed plan hash and exact repeated environment identity before Admin SDK use', async () => {
  const plan = createFirebaseBootstrapPlan(input);
  let boundaryLoads = 0;
  const base = {
    apply: true,
    boundary: async () => {
      boundaryLoads += 1;
      throw new Error('must_not_load');
    },
    expectedEnvironment: input.environment,
    expectedProjectId: input.projectId,
    expectedReviewDatabaseId: input.reviewDatabaseId,
    plan,
    reviewedPlanSha256: hashFirebaseBootstrapPlan(plan),
  } as const;

  for (const candidate of [
    { ...base, reviewedPlanSha256: '0'.repeat(64) },
    { ...base, expectedEnvironment: 'staging' as const },
    { ...base, expectedProjectId: 'cabohealth-other-prod' },
    { ...base, expectedReviewDatabaseId: 'cabohealth-review-other-production' },
  ]) {
    await assert.rejects(
      applyFirebaseBootstrapPlan(candidate),
      /firebase_bootstrap_apply_not_authorized/u,
    );
  }
  assert.equal(boundaryLoads, 0);
});

test('apply verifies an enabled TOTP owner, creates exact documents, and preserves unrelated claims', async () => {
  const plan = createFirebaseBootstrapPlan(input);
  const calls: string[] = [];

  const evidence = await applyFirebaseBootstrapPlan({
    apply: true,
    boundary: async (projectId) => {
      assert.equal(projectId, input.projectId);
      calls.push('boundary');
      return {
        projectId,
        loadOwner: async (uid) => {
          assert.equal(uid, input.ownerUid);
          calls.push('owner');
          return {
            customClaims: { existingClaim: 'preserved' },
            disabled: false,
            factorIds: ['totp'],
          };
        },
        ensureDocumentsExact: async (documents) => {
          assert.deepEqual(documents, [
            plan.owner.adminDocument,
            plan.clientResourceDocument,
          ]);
          calls.push('documents');
        },
        setCustomClaims: async (uid, claims) => {
          assert.equal(uid, input.ownerUid);
          assert.deepEqual(claims, {
            catalogAdmin: true,
            existingClaim: 'preserved',
          });
          calls.push('claims');
        },
      };
    },
    expectedEnvironment: input.environment,
    expectedProjectId: input.projectId,
    expectedReviewDatabaseId: input.reviewDatabaseId,
    plan,
    reviewedPlanSha256: hashFirebaseBootstrapPlan(plan),
  });

  assert.deepEqual(calls, ['boundary', 'owner', 'documents', 'claims']);
  assert.equal(evidence.status, 'applied');
  assert.equal(JSON.stringify(evidence).includes(input.ownerUid), false);
});
