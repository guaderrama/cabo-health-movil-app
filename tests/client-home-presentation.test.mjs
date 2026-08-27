import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClientHomeCards,
} from '../.test-build/features/clientAccess/clientHomePresentation.js';

const preview = (overrides = {}) => ({
  access: 'clients',
  icon: 'guide',
  id: 'client-guide',
  summary: { en: 'Preview summary.', 'es-MX': 'Resumen preliminar.' },
  title: { en: 'Client Guide', 'es-MX': 'Guía para clientes' },
  ...overrides,
});

const resource = (overrides = {}) => ({
  access: 'client',
  iconKey: 'book-outline',
  id: 'client-guide',
  summary: { en: 'Granted summary.', es: 'Resumen concedido.' },
  title: { en: 'Granted Guide', es: 'Guía concedida' },
  ...overrides,
});

const grant = (resources) => ({
  schemaVersion: 1,
  status: 'active',
  expiresAtMs: 1_900_000_000_000,
  resources,
});

test('locked previews normalize es-MX copy and every catalog icon to existing card icons', () => {
  const previews = Object.freeze([
    preview({ id: 'laboratory-preview', icon: 'laboratory' }),
    preview({ id: 'guide-preview', icon: 'guide' }),
    preview({ id: 'nutrition-preview', icon: 'nutrition' }),
    preview({ id: 'recipes-preview', icon: 'recipes' }),
    preview({ id: 'wellness-preview', icon: 'wellness' }),
    preview({ id: 'location-preview', icon: 'location' }),
    preview({ id: 'contact-preview', icon: 'contact' }),
    preview({ id: 'featured-preview', icon: 'featured' }),
  ]);

  const cards = buildClientHomeCards(previews, { status: 'locked', grant: null });

  assert.deepEqual(cards.map((card) => card.iconKey), [
    'flask-outline',
    'book-outline',
    'leaf-outline',
    'restaurant-outline',
    'heart-outline',
    'map-outline',
    'chatbubble-ellipses-outline',
    'sparkles-outline',
  ]);
  assert.deepEqual(cards[0], {
    access: 'client',
    iconKey: 'flask-outline',
    id: 'laboratory-preview',
    locked: true,
    summary: { en: 'Preview summary.', es: 'Resumen preliminar.' },
    title: { en: 'Client Guide', es: 'Guía para clientes' },
  });
  assert.equal(cards.every((card) => card.locked), true);
  assert.equal(Object.isFrozen(cards), true);
  assert.equal(Object.isFrozen(cards[0]), true);
  assert.equal(Object.isFrozen(cards[0]?.title), true);
  assert.equal(Object.isFrozen(cards[0]?.summary), true);
});

test('grant metadata stays hidden until the access status is unlocked', () => {
  const previews = [preview()];
  const staleGrant = grant([
    resource({
      iconKey: 'sparkles-outline',
      summary: { en: 'Private granted summary.', es: 'Resumen privado concedido.' },
      title: { en: 'Private Granted Guide', es: 'Guía privada concedida' },
    }),
    resource({
      id: 'grant-only-resource',
      title: { en: 'Grant Only', es: 'Sólo en permiso' },
    }),
  ]);

  const cards = buildClientHomeCards(previews, { status: 'checking', grant: staleGrant });

  assert.deepEqual(cards, [{
    access: 'client',
    iconKey: 'book-outline',
    id: 'client-guide',
    locked: true,
    summary: { en: 'Preview summary.', es: 'Resumen preliminar.' },
    title: { en: 'Client Guide', es: 'Guía para clientes' },
  }]);
});

test('an unlocked grant replaces matching preview metadata and appends missing resources in stable order', () => {
  const previews = [
    preview({
      id: 'preview-only',
      icon: 'nutrition',
      title: { en: 'Preview Only', 'es-MX': 'Sólo vista previa' },
    }),
    preview({
      id: 'shared-resource',
      title: { en: 'Public Teaser', 'es-MX': 'Avance público' },
    }),
  ];
  const activeGrant = grant([
    resource({
      id: 'shared-resource',
      iconKey: 'heart-outline',
      summary: { en: 'Safe grant summary.', es: 'Resumen seguro del permiso.' },
      title: { en: 'Secure Client Resource', es: 'Recurso seguro para clientes' },
    }),
    resource({
      id: 'grant-extra-z',
      iconKey: 'map-outline',
      summary: { en: 'First extra summary.', es: 'Resumen del primer extra.' },
      title: { en: 'First Grant Extra', es: 'Primer extra concedido' },
    }),
    resource({
      id: 'grant-extra-a',
      iconKey: 'flask-outline',
      summary: { en: 'Second extra summary.', es: 'Resumen del segundo extra.' },
      title: { en: 'Second Grant Extra', es: 'Segundo extra concedido' },
    }),
  ]);

  const cards = buildClientHomeCards(previews, { status: 'unlocked', grant: activeGrant });

  assert.deepEqual(cards, [
    {
      access: 'client',
      iconKey: 'leaf-outline',
      id: 'preview-only',
      locked: true,
      summary: { en: 'Preview summary.', es: 'Resumen preliminar.' },
      title: { en: 'Preview Only', es: 'Sólo vista previa' },
    },
    {
      access: 'client',
      iconKey: 'heart-outline',
      id: 'shared-resource',
      locked: false,
      summary: { en: 'Safe grant summary.', es: 'Resumen seguro del permiso.' },
      title: { en: 'Secure Client Resource', es: 'Recurso seguro para clientes' },
    },
    {
      access: 'client',
      iconKey: 'map-outline',
      id: 'grant-extra-z',
      locked: false,
      summary: { en: 'First extra summary.', es: 'Resumen del primer extra.' },
      title: { en: 'First Grant Extra', es: 'Primer extra concedido' },
    },
    {
      access: 'client',
      iconKey: 'flask-outline',
      id: 'grant-extra-a',
      locked: false,
      summary: { en: 'Second extra summary.', es: 'Resumen del segundo extra.' },
      title: { en: 'Second Grant Extra', es: 'Segundo extra concedido' },
    },
  ]);
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
});

test('an inconsistent unlocked state without a grant fails closed', () => {
  const cards = buildClientHomeCards([preview()], { status: 'unlocked', grant: null });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].locked, true);
  assert.equal(cards[0].title.en, 'Client Guide');
});

test('the safe App Review grant icon is normalized before its missing-preview card is appended', () => {
  const appReviewGrant = {
    credentialGeneration: 2,
    expiresAtMs: null,
    purpose: 'app_review',
    resources: [{
      access: 'client',
      iconKey: 'featured',
      id: 'review-sandbox-app-review-sample-v1',
      summary: {
        en: 'A fixed, non-clinical sample prepared only for App Review.',
        es: 'Una muestra fija y no clínica preparada sólo para App Review.',
      },
      title: { en: 'App Review Sample', es: 'Muestra para App Review' },
    }],
    schemaVersion: 1,
    scope: 'review_sandbox',
    status: 'active',
  };

  const cards = buildClientHomeCards([], { status: 'unlocked', grant: appReviewGrant });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].iconKey, 'sparkles-outline');
  assert.equal(cards[0].locked, false);
});
