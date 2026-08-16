import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizePublicFavorites,
  togglePublicFavorite,
} from '../.test-build/features/catalog/publicCatalogState.js';
import {
  CLINIC_GUIDE,
  PUBLIC_CONTACT_FACTS,
  RECIPES,
  canUseContactActions,
  createVisitChecklistState,
  filterRecipes,
  getRecipeBySlug,
  resetVisitChecklist,
  searchRecipes,
  setVisitChecklistItem,
} from '../.test-build/features/resources/publicContent.js';
import {
  normalizeLanguage,
  normalizeReducedEffectsOverride,
  parseStoredBoolean,
  resolveReducedEffects,
} from '../.test-build/features/preferences/preferencesPolicy.js';

test('favorites discard unknown and duplicate values and unknown toggles are inert', () => {
  assert.deepEqual(
    normalizePublicFavorites([
      'legacy-module',
      'clinic-guide',
      'healthy-recipes',
      'clinic-guide',
      42,
    ]),
    ['healthy-recipes', 'clinic-guide'],
  );
  assert.deepEqual(togglePublicFavorite(['healthy-recipes'], 'unknown-module'), ['healthy-recipes']);
  assert.deepEqual(
    togglePublicFavorite(['healthy-recipes'], 'clinic-guide'),
    ['healthy-recipes', 'clinic-guide'],
  );
});

test('bundled recipe model searches Spanish copy, filters, and returns complete detail offline', () => {
  assert.equal(RECIPES.length, 6);

  const spanishMatches = searchRecipes('frijoles negros', 'es-MX');
  assert.deepEqual(spanishMatches.map((recipe) => recipe.slug), ['black-bean-corn-skillet']);
  assert.deepEqual(
    filterRecipes(RECIPES, { category: 'dinner', tags: ['plant-based'] })
      .map((recipe) => recipe.slug),
    ['black-bean-corn-skillet', 'lentil-rice-tomato-bowl'],
  );

  const detail = getRecipeBySlug('black-bean-corn-skillet');
  assert.equal(detail?.title.en, 'Warm Black Bean & Corn Skillet');
  assert.ok(detail.ingredients.en.length >= 5);
  assert.ok(detail.steps['es-MX'].length >= 3);
  assert.notEqual(detail.foodSafety.en.trim(), '');
  assert.equal(getRecipeBySlug('missing-recipe'), undefined);
});

test('visit checklist updates and resets idempotently without collecting health data', () => {
  assert.deepEqual(
    CLINIC_GUIDE.groups.map((group) => group.id),
    [
      'appointment-confirmation',
      'questions',
      'travel-access',
      'accessibility-language',
      'what-to-bring',
      'privacy',
    ],
  );
  const initial = createVisitChecklistState(CLINIC_GUIDE);
  const checked = setVisitChecklistItem(initial, 'confirm-appointment', true);
  const checkedAgain = setVisitChecklistItem(checked, 'confirm-appointment', true);

  assert.deepEqual(checkedAgain, checked);
  assert.equal(checked['confirm-appointment'], true);
  assert.deepEqual(setVisitChecklistItem(checked, 'unknown-item', true), checked);
  assert.deepEqual(resetVisitChecklist(checked, CLINIC_GUIDE), initial);
  assert.deepEqual(resetVisitChecklist(initial, CLINIC_GUIDE), initial);

  const serialized = JSON.stringify(CLINIC_GUIDE).toLowerCase();
  for (const forbidden of ['symptom', 'diagnosis', 'medication', 'patient name']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('unconfirmed owner facts keep contact, map, address, hours, and language actions unavailable', () => {
  assert.equal(PUBLIC_CONTACT_FACTS.status, 'awaiting-owner-confirmation');
  assert.equal(PUBLIC_CONTACT_FACTS.ownerConfirmedAt, null);
  assert.equal(canUseContactActions(PUBLIC_CONTACT_FACTS), false);
  assert.deepEqual(Object.keys(PUBLIC_CONTACT_FACTS.facts), [
    'publicEmail',
    'phone',
    'whatsApp',
    'address',
    'hours',
    'appleMapsDestination',
    'serviceLanguages',
  ]);
  for (const fact of Object.values(PUBLIC_CONTACT_FACTS.facts)) {
    assert.equal(fact.value, null);
    assert.equal(fact.sourceUrl, null);
    assert.equal(fact.sourceStatus, 'owner-confirmation-required');
  }
});

test('contact actions reject partial, blank, malformed, and stale-looking confirmed records', () => {
  const completeFacts = Object.fromEntries(
    Object.keys(PUBLIC_CONTACT_FACTS.facts).map((key) => [key, {
      value: key === 'serviceLanguages' ? ['English', 'Español'] : `verified ${key}`,
      sourceUrl: 'https://cabohealth.org/owner-confirmed-source/',
      sourceStatus: 'owner-confirmed-source',
    }]),
  );
  const confirmed = {
    status: 'owner-confirmed',
    ownerConfirmedAt: '2026-08-16T18:30:00.000Z',
    facts: completeFacts,
  };

  assert.equal(canUseContactActions(confirmed), true);
  assert.equal(canUseContactActions({ ...confirmed, facts: {} }), false);
  assert.equal(canUseContactActions({
    ...confirmed,
    facts: Object.fromEntries(Object.entries(completeFacts).slice(0, 6)),
  }), false);
  assert.equal(canUseContactActions({
    ...confirmed,
    facts: { ...completeFacts, publicEmail: { ...completeFacts.publicEmail, value: '   ' } },
  }), false);
  assert.equal(canUseContactActions({
    ...confirmed,
    facts: { ...completeFacts, serviceLanguages: { ...completeFacts.serviceLanguages, value: [] } },
  }), false);
  assert.equal(canUseContactActions({
    ...confirmed,
    facts: { ...completeFacts, hours: { ...completeFacts.hours, sourceUrl: 'not a URL' } },
  }), false);
  assert.equal(canUseContactActions({ ...confirmed, ownerConfirmedAt: 'not a timestamp' }), false);
  assert.equal(canUseContactActions({ ...confirmed, ownerConfirmedAt: '2026-08-16' }), false);
  assert.equal(canUseContactActions({
    ...confirmed,
    facts: { ...completeFacts, phone: { ...completeFacts.phone, sourceUrl: '  https://cabohealth.org/source/  ' } },
  }), false);
});

test('preference policy validates persisted values and never overrides OS Reduce Motion', () => {
  assert.equal(normalizeLanguage('es-MX'), 'es-MX');
  assert.equal(normalizeLanguage('fr'), 'en');
  assert.equal(normalizeReducedEffectsOverride(true), true);
  assert.equal(normalizeReducedEffectsOverride('true'), false);
  assert.equal(resolveReducedEffects(false, false), false);
  assert.equal(resolveReducedEffects(false, true), true);
  assert.equal(resolveReducedEffects(true, false), true);
});

test('persisted boolean preferences accept only explicit JSON booleans', () => {
  assert.equal(parseStoredBoolean('true', false), true);
  assert.equal(parseStoredBoolean('false', true), false);
  assert.equal(parseStoredBoolean(null, true), true);
  assert.equal(parseStoredBoolean('1', false), false);
  assert.equal(parseStoredBoolean('"true"', false), false);
});
