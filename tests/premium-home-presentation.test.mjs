import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLIC_MINIAPPS } from '../.test-build/constants/publicMiniapps.js';
import { buildPremiumHomeModel } from '../.test-build/features/home/premiumHomePresentation.js';

test('approved home shows exactly two reviewed resources and one useful offline tool', () => {
  const model = buildPremiumHomeModel(PUBLIC_MINIAPPS);

  assert.deepEqual(model.resources.map((miniapp) => miniapp.slug), [
    'clinic-guide',
    'healthy-recipes',
  ]);
  assert.deepEqual(model.tools, [
    { id: 'visit-checklist', kind: 'route', destination: '/(main)/visit-checklist' },
  ]);
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
    () => buildPremiumHomeModel([...PUBLIC_MINIAPPS, third]),
    /exactly the two reviewed modules/u,
  );
});
