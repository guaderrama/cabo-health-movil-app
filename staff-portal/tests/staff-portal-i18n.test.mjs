import assert from 'node:assert/strict';
import test from 'node:test';

import { STAFF_MESSAGES } from '../.test-build/i18n/messages.js';

test('the staff portal has the same complete contract in English and Mexican Spanish', () => {
  const enKeys = Object.keys(STAFF_MESSAGES.en).sort();
  const esKeys = Object.keys(STAFF_MESSAGES['es-MX']).sort();

  assert.deepEqual(esKeys, enKeys);
  assert.ok(enKeys.length >= 45);
  for (const key of enKeys) {
    assert.notEqual(STAFF_MESSAGES.en[key].trim(), '');
    assert.notEqual(STAFF_MESSAGES['es-MX'][key].trim(), '');
  }
  assert.equal(STAFF_MESSAGES.en['drafts.reviewGate'], 'Draft only. Release review is required before it can appear in the app.');
  assert.equal(STAFF_MESSAGES['es-MX']['drafts.reviewGate'], 'Sólo borrador. Requiere revisión de lanzamiento antes de aparecer en la app.');
});
