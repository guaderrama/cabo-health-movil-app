import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('Home and Saved render the active runtime catalog while retaining one client folio', () => {
  const home = read('app/(main)/index.tsx');
  const saved = read('app/(main)/saved.tsx');

  assert.match(home, /const \{ catalogMiniapps,[^}]*refresh \} = useWebApps\(\)/u);
  assert.match(home, /resources: catalogMiniapps/u);
  assert.match(home, /<RefreshControl/u);
  assert.equal((home.match(/<ClientAccessFolio/g) ?? []).length, 1);
  assert.doesNotMatch(home, /buildPremiumHomeModel\(PUBLIC_MINIAPPS\)/u);
  assert.match(saved, /catalogMiniapps\.filter\(\(miniapp\) => favorites\.includes\(miniapp\.slug\)\)/u);
  assert.doesNotMatch(saved, /PUBLIC_MINIAPPS\.filter/u);
});

test('the public route resolves only against currently active runtime miniapps', () => {
  const route = read('app/apps/[slug].tsx');

  assert.match(route, /resolvePublicMiniappRouteSlug\(slug, miniapps\)/u);
  assert.match(route, /getMiniapp\(resolvedSlug\)/u);
  assert.match(route, /if \(!miniapp\) return <NotFoundScreen/u);
  assert.doesNotMatch(route, /client-resources|ClientAccess/u);
});
