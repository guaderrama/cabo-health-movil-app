import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAuditModel,
  parseAuditEvents,
} from '../.test-build/domain/auditLog.js';

test('the audit view is read-only and rejects sensitive or unexpected event fields', async () => {
  const events = parseAuditEvents({
    events: [{
      eventId: 'evt_1',
      action: 'client_code.revoked',
      actorLabel: 'Staff',
      targetSuffix: 'A2B2',
      occurredAtMs: 1_800_000_000_000,
      outcome: 'success',
    }],
  });
  const model = createAuditModel({ async list() { return events; } });

  await model.load();

  assert.equal(model.getSnapshot().events[0].targetSuffix, 'A2B2');
  assert.equal('create' in model, false);
  assert.equal('delete' in model, false);
  assert.throws(() => parseAuditEvents({
    events: [{ ...events[0], oneTimeCode: 'DO-NOT-LOG' }],
  }), /audit_response_invalid/u);
});

test('the audit view accepts every owner miniapp mutation emitted by the catalog backend', () => {
  for (const action of [
    'miniapp.created',
    'miniapp.updated',
    'miniapp.activated',
    'miniapp.deactivated',
    'miniapp.deleted',
  ]) {
    const parsed = parseAuditEvents({
      events: [{
        action,
        actorLabel: 'Staff',
        eventId: `evt_${action}`,
        occurredAtMs: 1_800_000_000_000,
        outcome: 'success',
        targetSuffix: 'guide',
      }],
    });
    assert.equal(parsed[0].action, action);
  }
});
