import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePublishedCatalog,
} from '../.test-build/features/catalog/publishedCatalog.js';
import {
  PUBLISHED_CATALOG_CACHE_KEY,
  readPublishedCatalogCache,
  writePublishedCatalogCache,
} from '../.test-build/features/catalog/publishedCatalogCache.js';
import {
  createPublishedCatalogRepository,
} from '../.test-build/features/catalog/publishedCatalogRepository.js';
import {
  resolvePublicCatalogMiniapps,
  toPublicCatalogMiniapps,
} from '../.test-build/features/catalog/publicCatalogMiniapp.js';
import {
  createNativePublishedCatalogFetcher,
} from '../.test-build/features/catalog/nativePublishedCatalogRuntime.js';

const publishedItem = (overrides = {}) => ({
  access: 'public',
  active: true,
  icon: 'wellness',
  id: 'sun-care',
  summary: {
    en: 'Practical sun-care information.',
    'es-MX': 'Información práctica para cuidarse del sol.',
  },
  title: {
    en: 'Sun Care',
    'es-MX': 'Cuidado Solar',
  },
  url: 'https://cabohealth.org/apps/sun-care/',
  revision: 3,
  createdAtMs: 1_780_000_000_000,
  updatedAtMs: 1_780_000_100_000,
  ...overrides,
});

const clientPreview = (overrides = {}) => ({
  access: 'clients',
  icon: 'featured',
  id: 'client-resources',
  summary: {
    en: 'Educational resources for eligible CaboHealth clients.',
    'es-MX': 'Recursos incluidos para clientes elegibles de CaboHealth.',
  },
  title: {
    en: 'Client Resources',
    'es-MX': 'Recursos para clientes',
  },
  ...overrides,
});

const publishedCatalog = (overrides = {}) => ({
  clientPreviews: [clientPreview()],
  revision: 8,
  updatedAtMs: 1_780_000_100_000,
  items: [publishedItem()],
  ...overrides,
});

test('a strict published response becomes an immutable public and client-preview snapshot', () => {
  const parsed = parsePublishedCatalog(publishedCatalog());

  assert.deepEqual(parsed, publishedCatalog());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed?.items), true);
  assert.equal(Object.isFrozen(parsed?.items[0]), true);
  assert.equal(Object.isFrozen(parsed?.clientPreviews), true);
  assert.equal(Object.isFrozen(parsed?.clientPreviews[0]), true);
  assert.equal(Object.isFrozen(parsed?.clientPreviews[0]?.title), true);
  assert.equal(Object.isFrozen(parsed?.clientPreviews[0]?.summary), true);
  assert.deepEqual(Object.keys(parsed?.clientPreviews[0] ?? {}).sort(), [
    'access',
    'icon',
    'id',
    'summary',
    'title',
  ]);
});

test('the legacy response without clientPreviews is rejected instead of cached as complete', async () => {
  const legacyResponse = {
    revision: 8,
    updatedAtMs: 1_780_000_100_000,
    items: [publishedItem()],
  };
  assert.equal(parsePublishedCatalog(legacyResponse), null);

  const values = new Map([[PUBLISHED_CATALOG_CACHE_KEY, JSON.stringify(legacyResponse)]]);
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  assert.equal(await readPublishedCatalogCache(storage), null);

  const repository = createPublishedCatalogRepository({
    storage: {
      getItem: async () => null,
      setItem: async (key, value) => { values.set(`remote:${key}`, value); },
    },
    fetchPublishedCatalog: async () => legacyResponse,
  });
  assert.equal(await repository.refresh(), null);
  assert.equal(values.has(`remote:${PUBLISHED_CATALOG_CACHE_KEY}`), false);
});

test('a snapshot cannot claim to predate one of its published items', () => {
  assert.equal(parsePublishedCatalog(publishedCatalog({
    updatedAtMs: 1_780_000_050_000,
  })), null);
});

test('catalog timestamps must remain representable as stable calendar dates', () => {
  assert.equal(parsePublishedCatalog(publishedCatalog({
    updatedAtMs: Number.MAX_SAFE_INTEGER,
    items: [publishedItem({
      createdAtMs: Number.MAX_SAFE_INTEGER,
      updatedAtMs: Number.MAX_SAFE_INTEGER,
    })],
  })), null);
});

test('published bilingual copy respects the backend 80/240 character limits', () => {
  for (const item of [
    publishedItem({ title: { en: 'T'.repeat(81), 'es-MX': 'Título' } }),
    publishedItem({ summary: { en: 'S'.repeat(241), 'es-MX': 'Resumen' } }),
  ]) {
    assert.equal(parsePublishedCatalog(publishedCatalog({
      items: [item],
    })), null);
  }
});

test('one malformed or non-public item rejects the whole remote snapshot', () => {
  const valid = publishedItem();
  const invalidItemSets = [
    [{ ...valid, access: 'clients' }],
    [{ ...valid, active: false }],
    [{ ...valid, unexpected: true }],
    [{ ...valid, url: `${valid.url}?redirect=1` }],
    [publishedItem({
      id: 'sun--care',
      url: 'https://cabohealth.org/apps/sun--care/',
    })],
    [valid, valid],
    Array.from({ length: 13 }, (_, index) => publishedItem({
      id: `item-${index + 1}`,
      url: `https://cabohealth.org/apps/item-${index + 1}/`,
    })),
  ];

  for (const items of invalidItemSets) {
    assert.equal(parsePublishedCatalog(publishedCatalog({
      items,
    })), null);
  }
});

test('one malformed or unsafe client preview rejects the whole remote snapshot', () => {
  const valid = clientPreview();
  const invalidPreviewSets = [
    [{ ...valid, access: 'public' }],
    [{ ...valid, active: true }],
    [{ ...valid, url: 'https://cabohealth.org/apps/client-resources/' }],
    [{ ...valid, content: { en: 'private' } }],
    [{ ...valid, icon: 'logo-apple' }],
    [{ ...valid, id: 'client--resources' }],
    [{ ...valid, id: 'app-review' }],
    [{ ...valid, id: 'review-sandbox-app-review-sample-v1' }],
    [{ ...valid, id: 'review-sandbox-future-sample' }],
    [{ ...valid, id: 'shared' }],
    [{ ...valid, id: 'health-advisor' }],
    [{ ...valid, title: { en: 'T'.repeat(81), 'es-MX': 'Título' } }],
    [{ ...valid, summary: { en: 'S'.repeat(241), 'es-MX': 'Resumen' } }],
    [valid, valid],
    [clientPreview({
      id: 'sun-care',
      title: { en: 'Private Sun Care', 'es-MX': 'Cuidado Solar Privado' },
    })],
    Array.from({ length: 13 }, (_, index) => clientPreview({ id: `client-${index + 1}` })),
  ];

  for (const clientPreviews of invalidPreviewSets) {
    assert.equal(parsePublishedCatalog(publishedCatalog({ clientPreviews })), null);
  }
});

test('client preview copy rejects operational details without blocking benign private language', () => {
  const unsafeCopy = [
    ['title', 'en', 'Visit https://cabohealth.org/apps/client-resources/'],
    ['summary', 'es-MX', 'Visita http://cabohealth.org/apps/client-resources/'],
    ['summary', 'en', 'Contact mailto:vip@cabohealth.org.'],
    ['summary', 'es-MX', 'Llama a tel:+526241234567.'],
    ['summary', 'en', 'Run javascript:alert(1).'],
    ['summary', 'en', 'Open api/client/session after access.'],
    ['summary', 'en', 'Continue at broker/session after access.'],
    ['summary', 'en', 'Open client-resources/launch after access.'],
    ['summary', 'en', 'Open launch/session after access.'],
    ['summary', 'en', 'Open vip-library/launch after access.'],
    ['summary', 'en', 'Open app-review/launch after access.'],
    ['summary', 'en', 'Continue at client-resources?token=abc.'],
    ['summary', 'en', 'Continue at app-review?token=abc.'],
    ['summary', 'en', 'Open x:private-token.'],
    ['summary', 'en', 'Learn more at www.cabohealth.org.'],
    ['summary', 'en', 'Connect to [::1].'],
    ['summary', 'en', 'Connect to ::1.'],
    ['summary', 'en', 'Connect to [::].'],
    ['summary', 'en', 'Connect to 0:0:0:0:0:0:0:1.'],
    ['summary', 'en', 'Connect to [0:0:0:0:0:0:0:0].'],
    ['summary', 'en', 'Connect to fd00::1.'],
    ['summary', 'en', 'Connect to fe80::1.'],
    ['summary', 'es-MX', 'Consulta cabohealth.org para continuar.'],
    ['summary', 'en', 'Open /apps/client-resources/launch/ after access.'],
    ['summary', 'es-MX', 'Consulta /api/client/session para continuar.'],
    ['summary', 'en', 'Load private/production/client-resources/content.json.'],
    ['summary', 'es-MX', 'Carga /Users/owner/private/client.json.'],
    ['summary', 'en', 'Load \\private\\production\\client-resources\\content.json.'],
    ['summary', 'en', 'Load C:\\deploy\\vip.json.'],
    ['summary', 'es-MX', 'Carga /secrets/client.json.'],
    ['summary', 'en', 'Load /Volumes/Private/client.json.'],
    ['summary', 'es-MX', 'Carga /root/private/catalog.json.'],
    ['summary', 'en', 'Load /usr/local/private/catalog.json.'],
    ['summary', 'es-MX', 'Carga /Library/Application Support/private.json.'],
    ['summary', 'en', 'Use CH-ABCDEF01-23456789-A1B2C3D4-E5F60718.'],
    ['summary', 'es-MX', 'Usa ar\u20100123 4567\u201189AB CDEF\u20120123 4567\u221289AB CDEF.'],
    ['summary', 'en', 'Available for $99.'],
    ['summary', 'en', 'Available for 99 pounds.'],
    ['summary', 'en', 'Available for 99 dinars.'],
    ['summary', 'en', 'Available for 99 rials.'],
    ['summary', 'en', 'Available for 99 krone.'],
    ['summary', 'en', 'Available for 99 quetzal.'],
    ['summary', 'en', 'Available for 99 soles.'],
    ['summary', 'en', 'Available for 99 shillings.'],
    ['summary', 'en', 'Available for 99 naira.'],
    ['summary', 'en', 'Available for 99 cedis.'],
    ['summary', 'es-MX', 'Disponible por 99 bolivianos.'],
    ['summary', 'es-MX', 'Disponible por 99 colones.'],
    ['summary', 'en', 'Available for 99 BRL.'],
    ['summary', 'en', 'Available for 99 QAR.'],
    ['summary', 'en', 'Membership 99 qar.'],
    ['summary', 'en', 'Membership 99 xof.'],
    ['summary', 'en', 'Membership currency: XOF.'],
    ['summary', 'en', 'Membership 99 KWD.'],
    ['summary', 'en', 'BHD 20 membership.'],
    ['summary', 'en', 'Available for 99 USD.'],
    ['summary', 'es-MX', 'Disponible por MXN 1,500.'],
    ['summary', 'es-MX', 'Disponible por 99 libras.'],
    ['summary', 'es-MX', 'Disponible por 99 quetzales.'],
    ['summary', 'es-MX', 'Disponible por 1,500 reales.'],
    ['summary', 'en', 'Available for €20.'],
    ['summary', 'es-MX', 'Precio 999.'],
    ['summary', 'en', 'Price: 99 per month.'],
    ['summary', 'es-MX', 'Disponible por mes.'],
    ['summary', 'en', 'Monthly membership.'],
    ['summary', 'es-MX', 'Membresía mensual.'],
    ['summary', 'es-MX', 'Beneficios mensuales.'],
    ['summary', 'en', 'Membership available.'],
    ['summary', 'en', 'Subscribe for access.'],
    ['summary', 'en', 'Purchase access.'],
    ['summary', 'en', 'Buy access.'],
    ['summary', 'en', 'Payment required.'],
    ['summary', 'en', 'Paid membership.'],
    ['summary', 'es-MX', 'Suscripción disponible.'],
    ['summary', 'es-MX', 'Comprar acceso.'],
    ['summary', 'es-MX', 'Pago requerido.'],
    ['summary', 'es-MX', 'Pagar para acceder.'],
    ['summary', 'en', 'Checkout available.'],
    ['summary', 'en', 'Billing available.'],
    ['summary', 'en', 'Billed annually.'],
    ['summary', 'en', 'No charge for access.'],
    ['summary', 'en', 'Sale available.'],
    ['summary', 'en', 'Sales available.'],
    ['summary', 'en', 'Resource for sale.'],
    ['summary', 'en', 'IAP available.'],
    ['summary', 'en', 'IAP enabled.'],
    ['summary', 'en', 'Available IAP.'],
    ['summary', 'en', 'Free VIP access.'],
    ['summary', 'en', 'Complimentary client access.'],
    ['summary', 'en', 'Free resource access.'],
    ['summary', 'en', 'Access is free.'],
    ['summary', 'es-MX', 'Acceso gratis.'],
    ['summary', 'es-MX', 'Cobro anual.'],
    ['summary', 'es-MX', 'Venta disponible.'],
    ['summary', 'es-MX', 'Ventas disponibles.'],
    ['summary', 'es-MX', 'Facturación disponible.'],
    ['title', 'en', 'VIP\u200B Library'],
    ['title', 'es-MX', 'Biblioteca\u00ad VIP'],
    ['summary', 'en', 'VIP\u061C resources.'],
  ];

  for (const [field, locale, text] of unsafeCopy) {
    const base = clientPreview();
    const preview = clientPreview({
      [field]: { ...base[field], [locale]: text },
    });
    assert.equal(
      parsePublishedCatalog(publishedCatalog({ clientPreviews: [preview] })),
      null,
      `${field}.${locale}: ${text}`,
    );
  }

  const safe = publishedCatalog({
    clientPreviews: [
      clientPreview({
        id: 'private-vip-test',
        summary: {
          en: 'CHF Guide for CAD prevention, CRC screening, INR monitoring, and care related to SLE, SLL, or STD. GHS reference. Available for 10 minutes per day; use 10 min at 100 bpm for up to 10 hrs and lose 10 pounds safely. Client access is VIP.',
          'es-MX': 'Disponible por 10 minutos al día; entrena con pesos libres una vez por semana.',
        },
        title: { en: 'Private VIP Test: AED Training', 'es-MX': 'Prueba VIP privada' },
      }),
      clientPreview({
        id: 'free-weights-guide',
        summary: {
          en: 'Free weights for VIP clients and sugar-free nutrition support clinical care.',
          'es-MX': 'Consejos para cuando sales a caminar. Pesos libres para clientes VIP apoyan el cuidado clínico.',
        },
        title: { en: 'Free weights guide', 'es-MX': 'Guía de pesos libres' },
      }),
      clientPreview({
        id: 'strength-training-guide',
        summary: {
          en: 'A resource about free weights. Try 10 minutes of 10 real-world exercises. Ratios 1:2 and times 10:30 or 10:30:00 support clinical guidance.',
          'es-MX': 'Un recurso sobre ejercicios con pesos libres.',
        },
        title: { en: 'Free weights resource', 'es-MX': 'Recurso de pesos libres' },
      }),
      clientPreview({
        id: 'pressure-monitoring-guide',
        summary: {
          en: 'IAP monitoring guide for intra-abdominal pressure.',
          'es-MX': 'Guía de monitoreo de presión intraabdominal.',
        },
        title: { en: 'IAP Monitoring', 'es-MX': 'Monitoreo de presión' },
      }),
    ],
  });
  assert.deepEqual(parsePublishedCatalog(safe), safe);
});

test('client preview ids reject credential and pricing side channels', () => {
  const unsafeIds = [
    'ch-abcdef01-23456789-a1b2c3d4-e5f60718',
    `ar${'0123456789abcdef'.repeat(2)}`,
    'ch-abcd-ef01-2345-6789-a1b2-c3d4-e5f6-0718',
    'vip-99-usd',
    'vip-mxn-1500',
    'vip-99-brl',
    'vip-inr-1500',
    'vip-99-qar',
    'vip-kwd-1500',
    'vip-bhd-20',
    'vip-omr-9',
    'vip-99-xof',
    'vip-99-dollars',
    'vip-dollars-99',
    'vip-99-pesos',
    'vip-99-euros',
    'vip-99-rials',
    'vip-99-krone',
    'vip-99-quetzal',
    'vip-99-soles',
    'vip-99-shillings',
    'vip-99-naira',
    'vip-99-cedis',
    'vip-99-bolivianos',
    'vip-99-colones',
    'vip-99usd',
    'vip-usd99',
    'vip-99dollars',
    'vip-dollars99',
    'vip-price99',
    'vip-99price',
    'vip-monthly99',
    'vip-checkout99',
    'vip-99-pen',
    'vip-try-1500',
    'vip-currency-xof',
    'vip-moneda-mxn',
    'vip-ngn-membership',
    'mxn-membership',
    'vip-subscription',
    'vip-subscribed',
    'vip-purchasing',
    'vip-buy-access',
    'vip-buys',
    'vip-buying',
    'vip-payment',
    'membresia-vip',
    'vip-suscripcion',
    'vip-pago',
    'vip-checkout',
    'vip-billing',
    'vip-billed',
    'vip-charge',
    'vip-charging',
    'vip-sale',
    'vip-sales',
    'vip-cobro',
    'vip-venta',
    'vip-facturacion',
    'iap-purchase',
    'iap-payment',
    'iap-checkout',
    'iap-available',
    'iap-enabled',
    'available-iap',
    'enabled-iap',
    'vip-free-access',
    'resource-free',
    'vip-price-99',
    'vip-precio-99',
    'vip-cost-monthly',
    'vip-costo-mensual',
    'vip-fee-tarifa',
  ];

  for (const id of unsafeIds) {
    assert.equal(
      parsePublishedCatalog(publishedCatalog({ clientPreviews: [clientPreview({ id })] })),
      null,
      id,
    );
  }

  for (const id of [
    'try-this-guide',
    'pen-and-paper',
    'inr-guide',
    'aed-training',
    'vip-usd',
    'free-weights-guide',
    'vip-free-weights-guide',
    'client-free-weights-guide',
    'vip-gratis',
    'client-complimentary',
    'iap-monitoring',
    'vip-iap',
    'lose-10-pounds',
    '10-pesos-libres',
    '10pesos-libres',
    'priceless99-guide',
    'costume99-guide',
    '10min-guide',
    '100bpm-guide',
    '10hrs-guide',
    'colon-care-guide',
    'sol-care-guide',
    'real-world-guide',
    '10-real-world-exercises',
    'sugar-free-guide',
  ]) {
    const response = publishedCatalog({ clientPreviews: [clientPreview({ id })] });
    assert.deepEqual(parsePublishedCatalog(response), response, id);
  }
});

test('public catalog copy keeps its existing parser policy', () => {
  const response = publishedCatalog({
    items: [publishedItem({
      id: 'vip-99-usd',
      summary: {
        en: 'Visit https://cabohealth.org/apps/sun-care/; price: $99 per month.',
        'es-MX': 'Visita cabohealth.org; precio MXN 1,500 por mes.',
      },
      title: { en: 'Private VIP Test', 'es-MX': 'Prueba VIP privada' },
      url: 'https://cabohealth.org/apps/vip-99-usd/',
    })],
  });

  assert.deepEqual(parsePublishedCatalog(response), response);
});

test('the public and client preview arrays cannot exceed the backend catalog limit together', () => {
  const items = Array.from({ length: 7 }, (_, index) => publishedItem({
    id: `public-${index + 1}`,
    url: `https://cabohealth.org/apps/public-${index + 1}/`,
  }));
  const clientPreviews = Array.from({ length: 6 }, (_, index) => clientPreview({
    id: `client-${index + 1}`,
  }));

  assert.equal(parsePublishedCatalog(publishedCatalog({ items, clientPreviews })), null);
});

test('reserved infrastructure and historical App Review ids are never public miniapps', () => {
  for (const id of [
    'app-review',
    'review-sandbox-app-review-sample-v1',
    'review-sandbox-future-sample',
    'shared',
    'client-resources',
    'health-advisor',
    'ai-cosmetic-scan',
    'service-hub',
    'sleep-lab',
  ]) {
    assert.equal(parsePublishedCatalog(publishedCatalog({
      items: [publishedItem({
        id,
        url: `https://cabohealth.org/apps/${id}/`,
      })],
    })), null, id);
  }
});

test('a validated published snapshot round-trips through the local cache', async () => {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const snapshot = parsePublishedCatalog(publishedCatalog());
  assert.ok(snapshot);

  await writePublishedCatalogCache(storage, snapshot);

  assert.equal(values.has(PUBLISHED_CATALOG_CACHE_KEY), true);
  assert.deepEqual(await readPublishedCatalogCache(storage), snapshot);
});

test('a valid remote catalog is returned and persisted as the latest safe snapshot', async () => {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const response = publishedCatalog();
  const repository = createPublishedCatalogRepository({
    storage,
    fetchPublishedCatalog: async () => response,
  });

  const refreshed = await repository.refresh();

  assert.deepEqual(refreshed, parsePublishedCatalog(response));
  assert.deepEqual(await repository.readCached(), refreshed);
});

test('a stale remote response cannot roll the cached catalog revision backward', async () => {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const newest = parsePublishedCatalog(publishedCatalog({
    revision: 9,
    updatedAtMs: 1_780_000_200_000,
    items: [publishedItem({ revision: 4, updatedAtMs: 1_780_000_200_000 })],
  }));
  assert.ok(newest);
  await writePublishedCatalogCache(storage, newest);
  const repository = createPublishedCatalogRepository({
    storage,
    fetchPublishedCatalog: async () => publishedCatalog({
      revision: 8,
      updatedAtMs: 1_780_000_100_000,
      items: [publishedItem()],
    }),
  });

  assert.deepEqual(await repository.refresh(), newest);
  assert.deepEqual(await repository.readCached(), newest);
});

test('a reused catalog revision cannot replace different cached content', async () => {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const trusted = parsePublishedCatalog(publishedCatalog({
    revision: 9,
    updatedAtMs: 1_780_000_200_000,
    items: [publishedItem({ revision: 4, updatedAtMs: 1_780_000_200_000 })],
  }));
  assert.ok(trusted);
  await writePublishedCatalogCache(storage, trusted);
  const repository = createPublishedCatalogRepository({
    storage,
    fetchPublishedCatalog: async () => publishedCatalog({
      revision: 9,
      updatedAtMs: 1_780_000_300_000,
      items: [publishedItem({
        revision: 4,
        updatedAtMs: 1_780_000_300_000,
        title: { en: 'Changed Without Revision', 'es-MX': 'Cambio sin revisión' },
      })],
    }),
  });

  assert.deepEqual(await repository.refresh(), trusted);
  assert.deepEqual(await repository.readCached(), trusted);
});

test('published items become same-origin native miniapps with bilingual presentation', () => {
  const snapshot = parsePublishedCatalog(publishedCatalog());
  assert.ok(snapshot);

  const [miniapp] = toPublicCatalogMiniapps(snapshot);

  assert.equal(miniapp.slug, 'sun-care');
  assert.equal(miniapp.canonicalUrl, 'https://cabohealth.org/apps/sun-care/');
  assert.equal(miniapp.allowedPathPrefix, '/apps/sun-care/');
  assert.deepEqual(miniapp.title, { en: 'Sun Care', es: 'Cuidado Solar' });
  assert.deepEqual(miniapp.summary, {
    en: 'Practical sun-care information.',
    es: 'Información práctica para cuidarse del sol.',
  });
  assert.equal(miniapp.iconKey, 'wellness');
  assert.equal(miniapp.reviewedOn, '2026-05-28');
});

test('the native catalog fetcher uses App Check and the exact read-only callable', async () => {
  const events = [];
  const response = publishedCatalog();
  const fetcher = await createNativePublishedCatalogFetcher({
    environment: {
      platform: 'ios',
      isExpoGo: false,
      enabled: true,
      appEnvironment: 'production',
      expectedProjectId: 'cabohealth-owner-prod',
      appCheckDebugEnabled: false,
      functionsRegion: 'us-central1',
    },
    loadBridge: async () => ({
      projectId: 'cabohealth-owner-prod',
      auth: {},
      initializeAppCheck: async (options) => { events.push(['app-check', options]); },
      functionsForRegion: (region) => ({
        call: async (name, data) => {
          events.push(['call', region, name, data]);
          return response;
        },
      }),
    }),
  });
  assert.ok(fetcher);

  assert.equal(await fetcher(), response);
  assert.deepEqual(events, [
    ['app-check', {
      appleProvider: 'appAttestWithDeviceCheckFallback',
      androidProvider: 'playIntegrity',
      tokenAutoRefreshEnabled: true,
    }],
    ['call', 'us-central1', 'getPublishedCatalogV2', {}],
  ]);
});

test('native clean installs fail closed without a valid catalog; only web preview may use the bundle', () => {
  const fallback = [{ slug: 'healthy-recipes' }, { slug: 'clinic-guide' }];

  assert.deepEqual(resolvePublicCatalogMiniapps(null, fallback, 'ios'), []);
  assert.deepEqual(resolvePublicCatalogMiniapps(null, fallback, 'android'), []);
  assert.equal(resolvePublicCatalogMiniapps(null, fallback, 'web'), fallback);

  const emptyPublishedSnapshot = parsePublishedCatalog(publishedCatalog({
    clientPreviews: [],
    revision: 9,
    updatedAtMs: 1_780_000_200_000,
    items: [],
  }));
  assert.ok(emptyPublishedSnapshot);
  assert.deepEqual(resolvePublicCatalogMiniapps(emptyPublishedSnapshot, fallback, 'web'), []);
});
