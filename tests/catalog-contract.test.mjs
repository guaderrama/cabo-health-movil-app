import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPublicMiniapp,
  PUBLIC_MINIAPPS,
  PUBLIC_MINIAPP_SLUGS,
} from '../.test-build/constants/publicMiniapps.js';

const EXPECTED_MINIAPPS = [
  {
    slug: 'healthy-recipes',
    canonicalUrl: 'https://cabohealth.org/apps/healthy-recipes/',
    universalLink: 'https://cabohealth.org/apps/healthy-recipes/',
    allowedPathPrefix: '/apps/healthy-recipes/',
  },
  {
    slug: 'clinic-guide',
    canonicalUrl: 'https://cabohealth.org/apps/clinic-guide/',
    universalLink: 'https://cabohealth.org/apps/clinic-guide/',
    allowedPathPrefix: '/apps/clinic-guide/',
  },
];

test('frozen public catalog exposes only the two approved miniapps', () => {
  assert.deepEqual(PUBLIC_MINIAPP_SLUGS, ['healthy-recipes', 'clinic-guide']);
  assert.equal(PUBLIC_MINIAPPS.length, 2);
  assert.deepEqual(
    PUBLIC_MINIAPPS.map(({ slug, canonicalUrl, universalLink, allowedPathPrefix }) => ({
      slug,
      canonicalUrl,
      universalLink,
      allowedPathPrefix,
    })),
    EXPECTED_MINIAPPS,
  );
});

test('each public miniapp has the approved privacy and content boundary', () => {
  for (const miniapp of PUBLIC_MINIAPPS) {
    assert.equal(miniapp.access, 'public');
    assert.deepEqual(miniapp.contentDescriptors, ['health-and-wellness-information']);
    assert.equal(miniapp.appStoreAgeRating, null);
    assert.deepEqual(miniapp.dataUse, ['technical-request-logs']);
    assert.deepEqual(miniapp.permissions, []);
    assert.equal(miniapp.hasUserGeneratedContent, false);
    assert.equal(miniapp.hasPurchases, false);
    assert.deepEqual(miniapp.legalUrls, {
      privacy: 'https://cabohealth.org/app/privacy/',
      terms: 'https://cabohealth.org/app/terms/',
      support: 'https://cabohealth.org/app/support/',
      reportContent: 'https://cabohealth.org/app/report-content/',
    });
  }
});

test('catalog lookup rejects legacy modules and no legal URL uses the retired domain', () => {
  assert.equal(getPublicMiniapp('healthy-recipes')?.slug, 'healthy-recipes');
  assert.equal(getPublicMiniapp('client-resources'), undefined);

  const serializedCatalog = JSON.stringify(PUBLIC_MINIAPPS);
  for (const forbiddenSlug of [
    'client-resources',
    'sleep-lab',
    'gut-health',
    'service-hub',
    'ai-cosmetic-scan',
    'health-advisor',
  ]) {
    assert.equal(serializedCatalog.includes(forbiddenSlug), false);
  }
  assert.equal(serializedCatalog.includes('cabohealth.com'), false);
});
