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

test('a strict published response becomes an immutable public catalog snapshot', () => {
  const parsed = parsePublishedCatalog({
    revision: 8,
    updatedAtMs: 1_780_000_100_000,
    items: [publishedItem()],
  });

  assert.deepEqual(parsed, {
    revision: 8,
    updatedAtMs: 1_780_000_100_000,
    items: [publishedItem()],
  });
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed?.items), true);
  assert.equal(Object.isFrozen(parsed?.items[0]), true);
});

test('a snapshot cannot claim to predate one of its published items', () => {
  assert.equal(parsePublishedCatalog({
    revision: 8,
    updatedAtMs: 1_780_000_050_000,
    items: [publishedItem()],
  }), null);
});

test('catalog timestamps must remain representable as stable calendar dates', () => {
  assert.equal(parsePublishedCatalog({
    revision: 8,
    updatedAtMs: Number.MAX_SAFE_INTEGER,
    items: [publishedItem({
      createdAtMs: Number.MAX_SAFE_INTEGER,
      updatedAtMs: Number.MAX_SAFE_INTEGER,
    })],
  }), null);
});

test('published bilingual copy respects the backend 80/240 character limits', () => {
  for (const item of [
    publishedItem({ title: { en: 'T'.repeat(81), 'es-MX': 'Título' } }),
    publishedItem({ summary: { en: 'S'.repeat(241), 'es-MX': 'Resumen' } }),
  ]) {
    assert.equal(parsePublishedCatalog({
      revision: 8,
      updatedAtMs: 1_780_000_100_000,
      items: [item],
    }), null);
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
    assert.equal(parsePublishedCatalog({
      revision: 8,
      updatedAtMs: 1_780_000_100_000,
      items,
    }), null);
  }
});

test('reserved review, shared, and client namespaces are never public miniapps', () => {
  for (const id of ['app-review', 'shared', 'client-resources']) {
    assert.equal(parsePublishedCatalog({
      revision: 8,
      updatedAtMs: 1_780_000_100_000,
      items: [publishedItem({
        id,
        url: `https://cabohealth.org/apps/${id}/`,
      })],
    }), null, id);
  }
});

test('a validated published snapshot round-trips through the local cache', async () => {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const snapshot = parsePublishedCatalog({
    revision: 8,
    updatedAtMs: 1_780_000_100_000,
    items: [publishedItem()],
  });
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
  const response = {
    revision: 8,
    updatedAtMs: 1_780_000_100_000,
    items: [publishedItem()],
  };
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
  const newest = parsePublishedCatalog({
    revision: 9,
    updatedAtMs: 1_780_000_200_000,
    items: [publishedItem({ revision: 4, updatedAtMs: 1_780_000_200_000 })],
  });
  assert.ok(newest);
  await writePublishedCatalogCache(storage, newest);
  const repository = createPublishedCatalogRepository({
    storage,
    fetchPublishedCatalog: async () => ({
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
  const trusted = parsePublishedCatalog({
    revision: 9,
    updatedAtMs: 1_780_000_200_000,
    items: [publishedItem({ revision: 4, updatedAtMs: 1_780_000_200_000 })],
  });
  assert.ok(trusted);
  await writePublishedCatalogCache(storage, trusted);
  const repository = createPublishedCatalogRepository({
    storage,
    fetchPublishedCatalog: async () => ({
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
  const snapshot = parsePublishedCatalog({
    revision: 8,
    updatedAtMs: 1_780_000_100_000,
    items: [publishedItem()],
  });
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
  const response = {
    revision: 8,
    updatedAtMs: 1_780_000_100_000,
    items: [publishedItem()],
  };
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
    ['call', 'us-central1', 'getPublishedCatalog', {}],
  ]);
});

test('native clean installs fail closed without a valid catalog; only web preview may use the bundle', () => {
  const fallback = [{ slug: 'healthy-recipes' }, { slug: 'clinic-guide' }];

  assert.deepEqual(resolvePublicCatalogMiniapps(null, fallback, 'ios'), []);
  assert.deepEqual(resolvePublicCatalogMiniapps(null, fallback, 'android'), []);
  assert.equal(resolvePublicCatalogMiniapps(null, fallback, 'web'), fallback);

  const emptyPublishedSnapshot = parsePublishedCatalog({
    revision: 9,
    updatedAtMs: 1_780_000_200_000,
    items: [],
  });
  assert.ok(emptyPublishedSnapshot);
  assert.deepEqual(resolvePublicCatalogMiniapps(emptyPublishedSnapshot, fallback, 'web'), []);
});
