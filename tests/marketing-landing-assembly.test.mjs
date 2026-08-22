import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createWebReleaseTransport,
  assertReviewedMarketingLanding,
  WEB_PROMOTE_TARGETS,
  WEB_RELEASE_PATHS,
} from '../scripts/assemble-web-release.mjs';

const marketingLandingPath = new URL('../web-hosting/cabohealth.org/app/index.html', import.meta.url);

const expectedPublicPaths = Object.freeze([
  '.well-known/apple-app-site-association',
  'app/index.html',
  'app/privacy/index.html',
  'app/report-content/index.html',
  'app/support/index.html',
  'app/terms/index.html',
  'apps/.htaccess',
  'apps/clinic-guide/app.js',
  'apps/clinic-guide/index.html',
  'apps/healthy-recipes/app.js',
  'apps/healthy-recipes/index.html',
  'apps/shared/clinic-map-texture.png',
  'apps/shared/logo-wordmark.png',
  'apps/shared/logo.png',
  'apps/shared/motion.js',
  'apps/shared/shell.js',
  'apps/shared/styles.css',
]);

test('the public web transport versions only the marketing landing beside the existing reviewed resources', () => {
  const captured = new Map(expectedPublicPaths.map((path) => [
    path,
    Buffer.from(`fixture:${path}\n`, 'utf8'),
  ]));

  const transport = createWebReleaseTransport(captured);

  assert.deepEqual(WEB_RELEASE_PATHS, expectedPublicPaths);
  assert.deepEqual(transport.entrySlugs, ['healthy-recipes', 'clinic-guide']);
  assert.equal(transport.files.find(({ path }) => path === 'app/index.html')?.kind, 'marketing-landing');
  assert.ok(WEB_PROMOTE_TARGETS.includes('public_html/app/index.html'));
  assert.equal(transport.files.some(({ path }) => /(?:staff|app-review|client-resources|private)/u.test(path)), false);
});

test('the reviewed marketing landing is byte-pinned and rejects source drift', () => {
  const reviewed = readFileSync(marketingLandingPath);

  assert.equal(assertReviewedMarketingLanding(reviewed), true);
  assert.throws(
    () => assertReviewedMarketingLanding(Buffer.concat([reviewed, Buffer.from('\n')])),
    /MARKETING_LANDING_PIN_MISMATCH/u,
  );
});
