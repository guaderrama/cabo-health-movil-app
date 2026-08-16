import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAIN_NAV_ITEMS,
  MESSAGES,
  translateMessage,
} from '../.test-build/i18n/messages.js';
import {
  getEditorialMetadata,
  PUBLIC_MINIAPPS,
} from '../.test-build/constants/publicMiniapps.js';

test('English and Mexican Spanish expose the same non-empty public message contract', () => {
  const englishKeys = Object.keys(MESSAGES.en).sort();
  const spanishKeys = Object.keys(MESSAGES['es-MX']).sort();

  assert.deepEqual(spanishKeys, englishKeys);
  assert.ok(englishKeys.length >= 60);
  for (const key of englishKeys) {
    assert.notEqual(MESSAGES.en[key].trim(), '');
    assert.notEqual(MESSAGES['es-MX'][key].trim(), '');
  }

  assert.equal(translateMessage('en', 'catalog.title'), 'Explore CaboHealth');
  assert.equal(translateMessage('es-MX', 'catalog.title'), 'Explora CaboHealth');
});

test('main navigation is exactly Apps, Saved, and Settings in both languages', () => {
  assert.deepEqual(
    MAIN_NAV_ITEMS.map(({ id, route }) => ({ id, route })),
    [
      { id: 'apps', route: '/(main)' },
      { id: 'saved', route: '/(main)/saved' },
      { id: 'settings', route: '/(main)/settings' },
    ],
  );
  assert.deepEqual(
    MAIN_NAV_ITEMS.map(({ labelKey }) => translateMessage('en', labelKey)),
    ['Apps', 'Saved', 'Settings'],
  );
  assert.deepEqual(
    MAIN_NAV_ITEMS.map(({ labelKey }) => translateMessage('es-MX', labelKey)),
    ['Apps', 'Guardado', 'Ajustes'],
  );
});

test('each catalog card exposes public editorial facts and omits an unverified age label', () => {
  for (const miniapp of PUBLIC_MINIAPPS) {
    assert.notEqual(miniapp.summary.en.trim(), '');
    assert.notEqual(miniapp.summary.es.trim(), '');
    assert.notEqual(miniapp.editorialSource.trim(), '');
    assert.match(miniapp.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);

    assert.deepEqual(getEditorialMetadata(miniapp), {
      access: 'public',
      contentDescriptor: 'health-and-wellness-information',
      dataUse: 'technical-request-logs',
      permissions: [],
      source: miniapp.editorialSource,
      reviewedOn: miniapp.reviewedOn,
    });
  }
});
