import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatalogDraftGateway,
} from '../.test-build/domain/catalogDrafts.js';
import {
  createAuditGateway,
} from '../.test-build/domain/auditLog.js';
import {
  parseServerStaffSession,
} from '../.test-build/domain/staffGateway.js';

const draft = Object.freeze({
  access: 'clients',
  draftId: 'dr_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH',
  icon: 'nutrition',
  revision: 2,
  status: 'draft',
  summary: Object.freeze({ en: 'Science-backed nutrition.', 'es-MX': 'Nutrición basada en ciencia.' }),
  title: Object.freeze({ en: 'Nutrition guide', 'es-MX': 'Guía de nutrición' }),
  updatedAtMs: 1_800_000_000_000,
  url: 'https://resources.example.test/nutrition',
});

test('production draft listing uses the exact callable and rejects response extensions', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_drafts'],
  });
  const gateway = createCatalogDraftGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { drafts: [draft] };
    },
  });

  assert.deepEqual(await gateway.list(), [draft]);
  assert.deepEqual(calls, [{ name: 'adminListCatalogDrafts', payload: {} }]);

  const extended = createCatalogDraftGateway({
    session,
    transport: async () => ({ drafts: [{ ...draft, published: true }] }),
  });
  await assert.rejects(extended.list(), /catalog_draft_response_invalid/u);
});

test('draft create, update, and archive send exact optimistic-revision contracts with no publication operation', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_drafts'],
  });
  const transport = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'adminArchiveCatalogDraft') return { archived: true, draft: { ...draft, revision: 3, status: 'archived' } };
    return { draft };
  };
  const gateway = createCatalogDraftGateway({ session, transport });
  const input = {
    access: draft.access,
    icon: draft.icon,
    summary: draft.summary,
    title: draft.title,
    url: draft.url,
  };

  await gateway.create(input);
  await gateway.update(draft.draftId, draft.revision, input);
  await gateway.archive(draft.draftId, draft.revision);

  assert.deepEqual(calls, [
    { name: 'adminCreateCatalogDraft', payload: input },
    {
      name: 'adminUpdateCatalogDraft',
      payload: { draftId: draft.draftId, revision: draft.revision, ...input },
    },
    {
      name: 'adminArchiveCatalogDraft',
      payload: { draftId: draft.draftId, revision: draft.revision },
    },
  ]);
  assert.equal('publish' in gateway, false);

  const extendedMutation = createCatalogDraftGateway({
    session,
    transport: async () => ({ draft, published: true }),
  });
  await assert.rejects(extendedMutation.create(input), /catalog_draft_response_invalid/u);
});

test('audit listing uses the exact read-only callable and accepts only backend action names', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_drafts'],
  });
  const event = Object.freeze({
    action: 'draft.updated',
    actorLabel: 'Staff',
    eventId: 'evt_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH',
    occurredAtMs: 1_800_000_000_000,
    outcome: 'success',
    targetSuffix: 'BwcHBwcH',
  });
  const gateway = createAuditGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { events: [event] };
    },
  });

  assert.deepEqual(await gateway.list(), [event]);
  assert.deepEqual(calls, [{ name: 'adminListAudit', payload: {} }]);
  assert.equal('create' in gateway, false);

  const legacyAction = createAuditGateway({
    session,
    transport: async () => ({ events: [{ ...event, action: 'catalog_draft.updated' }] }),
  });
  await assert.rejects(legacyAction.list(), /audit_response_invalid/u);
});

test('review-sandbox or unpermitted staff get fail-closed gateways that never address production', async () => {
  let calls = 0;
  const transport = async () => {
    calls += 1;
    assert.fail('an unavailable staff capability must not call production');
  };
  const reviewSession = parseServerStaffSession({
    scope: 'review-sandbox',
    permissions: ['client_resource_drafts', 'app_review_credential'],
  });
  const codesOnlySession = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_codes'],
  });
  const reviewDrafts = createCatalogDraftGateway({ session: reviewSession, transport });
  const reviewAudit = createAuditGateway({ session: reviewSession, transport });
  const unpermittedDrafts = createCatalogDraftGateway({ session: codesOnlySession, transport });

  await assert.rejects(reviewDrafts.list(), /staff_capability_unavailable/u);
  await assert.rejects(reviewAudit.list(), /staff_capability_unavailable/u);
  await assert.rejects(unpermittedDrafts.list(), /staff_capability_unavailable/u);
  assert.equal(calls, 0);
});
