import assert from 'node:assert/strict';
import test from 'node:test';

const {
  createPublicCatalogState,
  getFavoriteSnapshot,
  normalizeRememberedPublicFavorites,
  setFavoriteSnapshot,
  settleFavoritePersistence,
  subscribeFavoriteSnapshot,
  toggleFavoriteSnapshot,
  toggleRememberedPublicFavorite,
} = await import('../.test-build/features/catalog/publicCatalogState.js');

const MINIAPPS = [
  {
    slug: 'healthy-recipes',
    title: { en: 'Healthy Recipes' },
    summary: { en: 'Practical recipes.' },
    canonicalUrl: 'https://cabohealth.org/apps/healthy-recipes/',
    destinationKind: 'cabohealth',
  },
  {
    slug: 'clinic-guide',
    title: { en: 'CaboHealth Clinic Guide' },
    summary: { en: 'Plan a clinic visit.' },
    canonicalUrl: 'https://cabohealth.org/apps/clinic-guide/',
    destinationKind: 'cabohealth',
  },
];

const EXTERNAL_MINIAPP = {
  slug: 'external-0123456789abcdef0123456789abcdef',
  title: { en: 'Sleep Resource' },
  summary: { en: 'Third-party sleep information.' },
  destinationKind: 'external_https',
  destinationUrl: 'https://www.eightsleep.com/mx/',
  destinationOrigin: 'https://www.eightsleep.com',
};

test('favorite toggle synchronously propagates to a mounted catalog consumer', () => {
  setFavoriteSnapshot([]);
  let catalog = createPublicCatalogState(MINIAPPS, getFavoriteSnapshot());
  const unsubscribe = subscribeFavoriteSnapshot(() => {
    catalog = createPublicCatalogState(MINIAPPS, getFavoriteSnapshot());
  });

  toggleFavoriteSnapshot('healthy-recipes');

  assert.deepEqual(catalog.favoriteApps.map(({ id }) => id), ['healthy-recipes']);
  assert.deepEqual(catalog.nonFavoriteApps.map(({ id }) => id), ['clinic-guide']);
  assert.equal(catalog.apps.find(({ id }) => id === 'healthy-recipes').isFavorite, true);
  unsubscribe();
});

test('public catalog uses a synchronous timer-free initial connectivity state', () => {
  const catalog = createPublicCatalogState(MINIAPPS, []);

  assert.equal(catalog.isLoading, false);
  assert.equal(catalog.error, null);
  assert.equal(catalog.isOffline, false);
  assert.deepEqual(catalog.apps.map(({ id }) => id), ['healthy-recipes', 'clinic-guide']);
});

test('public catalog state preserves internal and external destination contracts', () => {
  const catalog = createPublicCatalogState([...MINIAPPS, EXTERNAL_MINIAPP], [EXTERNAL_MINIAPP.slug]);

  assert.deepEqual(catalog.apps.map(({ id, url, destinationKind }) => ({
    id,
    url,
    destinationKind,
  })), [
    {
      id: 'healthy-recipes',
      url: 'https://cabohealth.org/apps/healthy-recipes/',
      destinationKind: 'cabohealth',
    },
    {
      id: 'clinic-guide',
      url: 'https://cabohealth.org/apps/clinic-guide/',
      destinationKind: 'cabohealth',
    },
    {
      id: 'external-0123456789abcdef0123456789abcdef',
      url: 'https://www.eightsleep.com/mx/',
      destinationKind: 'external_https',
    },
  ]);
  assert.deepEqual(catalog.favoriteApps.map(({ id }) => id), [EXTERNAL_MINIAPP.slug]);
});

test('offline web capability does not hide the synchronous local catalog', () => {
  const catalog = createPublicCatalogState(MINIAPPS, [], true);

  assert.equal(catalog.isOffline, true);
  assert.deepEqual(catalog.apps.map(({ id }) => id), ['healthy-recipes', 'clinic-guide']);
});

test('favorite persistence rejection settles without reverting optimistic state or exposing values', async () => {
  setFavoriteSnapshot(['healthy-recipes']);
  const reports = [];
  let settled = false;

  await settleFavoritePersistence(
    async () => Promise.reject(new Error('private favorite storage detail')),
    (...args) => reports.push(args),
  ).then(() => {
    settled = true;
  });

  assert.equal(settled, true);
  assert.deepEqual(getFavoriteSnapshot(), ['healthy-recipes']);
  assert.deepEqual(reports, [[]]);
});

test('remote public favorites stay remembered while absent catalog items remain hidden', () => {
  const remembered = normalizeRememberedPublicFavorites([
    'healthy-recipes',
    'sun-care',
    'sun-care',
    'client-resources',
    'health-advisor',
    'ai-cosmetic-scan',
    'service-hub',
    'sleep-lab',
    'Unsafe Slug',
  ]);
  assert.deepEqual(remembered, ['healthy-recipes', 'sun-care']);
  assert.deepEqual(
    toggleRememberedPublicFavorite(remembered, 'travel-health'),
    ['healthy-recipes', 'sun-care', 'travel-health'],
  );
  assert.deepEqual(
    toggleRememberedPublicFavorite(remembered, 'health-advisor'),
    remembered,
  );

  const visible = createPublicCatalogState(MINIAPPS, remembered);
  assert.deepEqual(visible.favoriteApps.map(({ id }) => id), ['healthy-recipes']);
});
