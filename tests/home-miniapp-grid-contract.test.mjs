import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('Home presents public and test miniapps as the same responsive tile grid', () => {
  const home = read('app/(main)/index.tsx');

  assert.match(home, /useWindowDimensions/u);
  assert.match(home, /resolveCatalogCardColumns/u);
  assert.match(home, /<PremiumMiniappTile/u);
  assert.match(home, /<DevMiniappTile/u);
  assert.match(home, /styles\.miniappGrid/u);
  assert.match(home, /columns === 2/u);
  assert.doesNotMatch(home, /<PremiumResourceRow/u);
  assert.doesNotMatch(home, /<DevMiniappRow/u);
});

test('public miniapp tiles keep full-card navigation and a separate 44-point favorite action', () => {
  const tile = read('components/PremiumMiniappTile.tsx');

  assert.match(tile, /buildCatalogCardAccessibilityLabel/u);
  assert.match(tile, /accessibilityHint=\{t\('catalog\.open'\)\}/u);
  assert.match(tile, /accessibilityState=\{\{ selected: favorite \}\}/u);
  assert.match(tile, /width: 44/u);
  assert.match(tile, /height: 44/u);
  assert.match(tile, /numberOfLines=\{2\}/u);
  assert.match(tile, /catalog\.publicBadge/u);
  assert.match(tile, /backgroundColor: colors\.cardBackground/u);
});

test('test miniapps use matching tiles while Tools remain full-width rows', () => {
  const home = read('app/(main)/index.tsx');
  const tile = read('features/devMiniapps/DevMiniappTile.tsx');

  assert.match(tile, /devPanel\.testOnly/u);
  assert.match(tile, /devPanel\.clients/u);
  assert.match(tile, /devPanel\.public/u);
  assert.match(tile, /numberOfLines=\{2\}/u);
  assert.match(tile, /backgroundColor: colors\.cardBackground/u);
  assert.match(home, /<ToolRow/u);
  assert.match(home, /styles\.toolsSurface/u);
});
