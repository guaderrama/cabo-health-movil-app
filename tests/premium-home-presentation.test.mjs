import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLIC_CONTACT_URLS } from '../.test-build/constants/publicContacts.js';
import { PUBLIC_MINIAPPS } from '../.test-build/constants/publicMiniapps.js';
import { buildPremiumHomeModel } from '../.test-build/features/home/premiumHomePresentation.js';

test('premium home keeps the approved featured guide, three quick actions, and exactly two modules', () => {
  const model = buildPremiumHomeModel(PUBLIC_MINIAPPS, PUBLIC_CONTACT_URLS);

  assert.equal(model.featured.slug, 'clinic-guide');
  assert.deepEqual(model.quickActions, [
    { id: 'visit', kind: 'route', destination: '/(main)/visit-checklist' },
    { id: 'contact', kind: 'external', destination: 'https://wa.me/526241224865' },
    {
      id: 'map',
      kind: 'external',
      destination: PUBLIC_CONTACT_URLS.find((url) => url.startsWith('https://maps.apple.com/')),
    },
  ]);
  assert.deepEqual(model.available.map((miniapp) => miniapp.slug), ['healthy-recipes']);
  assert.deepEqual(
    [model.featured.slug, ...model.available.map((miniapp) => miniapp.slug)].sort(),
    ['clinic-guide', 'healthy-recipes'],
  );
});

test('premium home fails closed if an unreviewed third module reaches the release catalog', () => {
  const third = {
    ...PUBLIC_MINIAPPS[0],
    slug: 'unreviewed-module',
    canonicalUrl: 'https://cabohealth.org/apps/unreviewed-module/',
    universalLink: 'https://cabohealth.org/apps/unreviewed-module/',
    allowedPathPrefix: '/apps/unreviewed-module/',
  };

  assert.throws(
    () => buildPremiumHomeModel([...PUBLIC_MINIAPPS, third], PUBLIC_CONTACT_URLS),
    /exactly the two reviewed modules/u,
  );
});
