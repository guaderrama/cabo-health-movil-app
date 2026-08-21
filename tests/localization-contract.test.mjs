import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAIN_NAV_ITEMS,
  MESSAGES,
  resolveMainNavigationSelection,
  translateMessage,
} from '../.test-build/i18n/messages.js';
import {
  getEditorialMetadata,
  PUBLIC_MINIAPPS,
} from '../.test-build/constants/publicMiniapps.js';
import {
  buildCatalogCardAccessibilityLabel,
  formatEditorialDate,
  resolveCatalogCardColumns,
} from '../.test-build/features/catalog/catalogPresentation.js';

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
  assert.equal(MESSAGES.en['recipes.subtitle'], 'Twelve original food ideas bundled with this app.');
  assert.equal(MESSAGES['es-MX']['recipes.subtitle'], 'Doce ideas originales de alimentación incluidas en esta app.');
  assert.equal(MESSAGES.en['recipes.beverage'], 'Beverage');
  assert.equal(MESSAGES['es-MX']['recipes.beverage'], 'Bebida');
});

test('approved simplified home has matching English and Spanish copy', () => {
  const keys = [
    'home.resources',
    'home.tools',
    'home.clinicSummary',
    'home.recipesSummary',
    'home.planVisit',
    'home.visitChecklist',
  ];
  assert.deepEqual(
    keys.map((key) => translateMessage('en', key)),
    [
      'Resources',
      'Tools',
      'Plan your visit and contact the clinic.',
      'Practical recipes for everyday wellbeing.',
      'Plan your visit',
      'Visit checklist',
    ],
  );
  assert.deepEqual(
    keys.map((key) => translateMessage('es-MX', key)),
    [
      'Recursos',
      'Herramientas',
      'Planea tu visita y contacta a la clínica.',
      'Recetas prácticas para el bienestar diario.',
      'Planea tu visita',
      'Lista para tu visita',
    ],
  );
});

test('main navigation is exactly Home, Saved, and Settings in both languages', () => {
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
    ['Home', 'Saved', 'Settings'],
  );
  assert.deepEqual(
    MAIN_NAV_ITEMS.map(({ labelKey }) => translateMessage('es-MX', labelKey)),
    ['Inicio', 'Guardado', 'Ajustes'],
  );
});

test('each catalog card exposes public editorial facts and the verified Apple age rating', () => {
  for (const miniapp of PUBLIC_MINIAPPS) {
    assert.notEqual(miniapp.summary.en.trim(), '');
    assert.notEqual(miniapp.summary.es.trim(), '');
    assert.notEqual(miniapp.editorialSource.en.trim(), '');
    assert.notEqual(miniapp.editorialSource['es-MX'].trim(), '');
    assert.match(miniapp.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);

    assert.deepEqual(getEditorialMetadata(miniapp), {
      access: 'public',
      contentDescriptor: 'health-and-wellness-information',
      dataUse: 'technical-request-logs',
      permissions: [],
      source: miniapp.editorialSource,
      reviewedOn: miniapp.reviewedOn,
      appStoreAgeRating: 9,
    });
  }
});

test('catalog card accessibility narration includes every localized required fact', () => {
  const label = buildCatalogCardAccessibilityLabel(
    PUBLIC_MINIAPPS[0],
    'es-MX',
    (key) => translateMessage('es-MX', key),
  );

  assert.equal(label.includes('Recetas Saludables'), true);
  assert.equal(label.includes('Público'), true);
  assert.equal(label.includes('Fuente: Equipo editorial de CaboHealth'), true);
  assert.equal(label.includes('Revisado: 16 de agosto de 2026'), true);
  assert.equal(label.includes('Información de salud y bienestar'), true);
  assert.equal(label.includes('registros técnicos de solicitudes'), true);
  assert.equal(label.includes('Sin permisos del dispositivo'), true);
});

test('editorial dates and utility tab ancestry are deliberate for both locales', () => {
  assert.equal(formatEditorialDate('2026-08-16', 'en'), 'August 16, 2026');
  assert.equal(formatEditorialDate('2026-08-16', 'es-MX'), '16 de agosto de 2026');
  assert.equal(resolveMainNavigationSelection('/recipes'), 'apps');
  assert.equal(resolveMainNavigationSelection('/visit-checklist'), 'apps');
  assert.equal(resolveMainNavigationSelection('/saved'), 'saved');
});

test('catalog stacks cards for narrow widths or large Dynamic Type only', () => {
  assert.equal(resolveCatalogCardColumns({ width: 390, fontScale: 1 }), 2);
  assert.equal(resolveCatalogCardColumns({ width: 320, fontScale: 1 }), 1);
  assert.equal(resolveCatalogCardColumns({ width: 430, fontScale: 1.8 }), 1);
});
