import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUnavailableAuditGateway,
  createUnavailableCatalogDraftGateway,
} from '../.test-build/domain/unavailableGateways.js';

test('deferred draft and audit backends fail closed and never simulate data', async () => {
  const drafts = createUnavailableCatalogDraftGateway();
  const audit = createUnavailableAuditGateway();

  await assert.rejects(drafts.list(), /staff_capability_unavailable/u);
  await assert.rejects(audit.list(), /staff_capability_unavailable/u);
  await assert.rejects(drafts.create({}), /staff_capability_unavailable/u);
  assert.equal('publish' in drafts, false);
});
