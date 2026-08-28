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
  assert.equal(MESSAGES.en['recipes.subtitle'], 'Twelve practical food ideas bundled with this app.');
  assert.equal(MESSAGES['es-MX']['recipes.subtitle'], 'Doce ideas prácticas de alimentación incluidas en esta app.');
  assert.equal(MESSAGES.en['recipes.beverage'], 'Beverage');
  assert.equal(MESSAGES['es-MX']['recipes.beverage'], 'Bebida');
});

test('approved simplified home has matching English and Spanish copy', () => {
  const keys = [
    'home.brandPromise',
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
      'Longevity, grounded in science.',
      'Mini apps',
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
      'Longevidad con base científica.',
      'Mini apps',
      'Herramientas',
      'Planea tu visita y contacta a la clínica.',
      'Recetas prácticas para el bienestar diario.',
      'Planea tu visita',
      'Lista para tu visita',
    ],
  );
});

test('the folio action is explicit and localized', () => {
  assert.equal(MESSAGES.en['catalog.openResource'], 'Open resource');
  assert.equal(MESSAGES['es-MX']['catalog.openResource'], 'Abrir recurso');
});

test('catalog copy stays truthful for a dynamic catalog and external resources', () => {
  assert.equal(MESSAGES.en['catalog.subtitle'], 'Curated public resources, plus useful tools that work offline.');
  assert.equal(MESSAGES['es-MX']['catalog.subtitle'], 'Recursos públicos seleccionados y herramientas útiles que funcionan sin conexión.');
  assert.equal(MESSAGES.en['catalog.externalContent'], 'External web resource');
  assert.equal(MESSAGES['es-MX']['catalog.externalContent'], 'Recurso web externo');
  assert.equal(MESSAGES.en['catalog.thirdPartyNetwork'], 'Opening contacts a third-party website');
  assert.equal(MESSAGES['es-MX']['catalog.thirdPartyNetwork'], 'Al abrirlo se contacta un sitio web de terceros');
});

test('client launch failures use truthful generic copy for broker and external resources', () => {
  assert.equal(
    MESSAGES.en['clientAccess.launchUnavailable'],
    'This resource is unavailable right now. Return to your resources and try again.',
  );
  assert.equal(
    MESSAGES['es-MX']['clientAccess.launchUnavailable'],
    'Este recurso no está disponible en este momento. Regresa a tus recursos e inténtalo de nuevo.',
  );
  assert.equal(
    MESSAGES.en['clientAccess.navigationBlocked'],
    'This resource tried to open an unsupported page, so CaboHealth blocked the navigation.',
  );
  assert.equal(
    MESSAGES['es-MX']['clientAccess.navigationBlocked'],
    'Este recurso intentó abrir una página no compatible, por lo que CaboHealth bloqueó la navegación.',
  );
  assert.equal(MESSAGES.en['clientAccess.navigationBlocked'].includes('protected CaboHealth client area'), false);
  assert.equal(MESSAGES['es-MX']['clientAccess.navigationBlocked'].includes('área protegida'), false);
  assert.equal(JSON.stringify(MESSAGES).includes('https://www.eightsleep.com/mx/'), false);
});

test('account deletion acknowledgements are explicit and localized for App Review', () => {
  assert.equal(
    MESSAGES.en['clientAccess.deleteReviewAccount'],
    'Delete review access and data',
  );
  assert.equal(
    MESSAGES['es-MX']['clientAccess.deleteReviewAccount'],
    'Eliminar acceso de revisión y datos',
  );
  assert.equal(
    MESSAGES.en['clientAccess.confirmDeleteReviewTitle'],
    'Delete review access and data?',
  );
  assert.equal(
    MESSAGES['es-MX']['clientAccess.confirmDeleteReviewTitle'],
    '¿Eliminar acceso de revisión y datos?',
  );
  assert.match(MESSAGES.en['clientAccess.deletionPendingBody'], /accepted[^]*server[^]*retr(?:y|ies)/iu);
  assert.match(MESSAGES['es-MX']['clientAccess.deletionPendingBody'], /aceptada[^]*servidor[^]*reintenta/iu);
  assert.match(MESSAGES.en['clientAccess.deletionCompletedBody'], /removed/iu);
  assert.match(MESSAGES['es-MX']['clientAccess.deletionCompletedBody'], /eliminaron/iu);
  assert.match(MESSAGES.en['clientAccess.deleteUnavailable'], /not accepted[^]*try again/iu);
  assert.match(MESSAGES['es-MX']['clientAccess.deleteUnavailable'], /no fue aceptada[^]*inténtalo de nuevo/iu);
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
  assert.equal(label.includes('Revisado: 24 de agosto de 2026'), true);
  assert.equal(label.includes('Información de salud y bienestar'), true);
  assert.equal(label.includes('registros técnicos de solicitudes'), true);
  assert.equal(label.includes('Sin permisos del dispositivo'), true);
});

test('external catalog narration and metadata identify the third-party hostname truthfully', () => {
  const external = {
    slug: 'external-0123456789abcdef0123456789abcdef',
    title: { en: 'Sleep Resource', es: 'Recurso de sueño' },
    summary: {
      en: 'Third-party sleep information.',
      es: 'Información de sueño de un tercero.',
    },
    destinationKind: 'external_https',
    destinationUrl: 'https://www.eightsleep.com/mx/',
    destinationOrigin: 'https://www.eightsleep.com',
    access: 'public',
    contentDescriptors: ['external-web-resource'],
    appStoreAgeRating: null,
    dataUse: ['third-party-network-request'],
    permissions: [],
    hasUserGeneratedContent: false,
    hasPurchases: false,
    editorialSource: { en: 'www.eightsleep.com', 'es-MX': 'www.eightsleep.com' },
    reviewedOn: '2026-05-28',
    contentVersion: '3',
    legalUrls: PUBLIC_MINIAPPS[0].legalUrls,
  };

  assert.deepEqual(getEditorialMetadata(external), {
    access: 'public',
    contentDescriptor: 'external-web-resource',
    dataUse: 'third-party-network-request',
    permissions: [],
    source: { en: 'www.eightsleep.com', 'es-MX': 'www.eightsleep.com' },
    reviewedOn: '2026-05-28',
  });
  const label = buildCatalogCardAccessibilityLabel(
    external,
    'en',
    (key) => translateMessage('en', key),
  );
  assert.match(label, /Source: www\.eightsleep\.com/u);
  assert.match(label, /External web resource/u);
  assert.match(label, /third-party website/u);
  assert.equal(label.includes('CaboHealth editorial team'), false);
  assert.equal(label.includes('Age rating'), false);
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
  assert.equal(resolveCatalogCardColumns({ width: 390, fontScale: 1.19 }), 2);
  assert.equal(resolveCatalogCardColumns({ width: 390, fontScale: 1.2 }), 1);
  assert.equal(resolveCatalogCardColumns({ width: 320, fontScale: 1 }), 1);
  assert.equal(resolveCatalogCardColumns({ width: 430, fontScale: 1.8 }), 1);
});
