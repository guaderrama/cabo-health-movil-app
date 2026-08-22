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

test('public miniapps render as editorial covers with full-card navigation and a separate 44-point favorite action', () => {
  const tile = read('components/PremiumMiniappTile.tsx');
  const cover = read('components/EditorialMiniappCover.tsx');

  assert.match(tile, /EditorialMiniappCover/u);
  assert.match(tile, /buildCatalogCardAccessibilityLabel/u);
  assert.match(tile, /accessibilityHint=\{t\('catalog\.open'\)\}/u);
  assert.match(cover, /accessibilityState=\{\{ selected: favorite\.selected \}\}/u);
  assert.match(cover, /width: 44/u);
  assert.match(cover, /height: 44/u);
  assert.match(cover, /numberOfLines=\{2\}/u);
  assert.match(tile, /catalog\.publicBadge/u);
  assert.match(cover, /useEditorialTileMotion/u);
  assert.match(cover, /fontFamily: 'Georgia'/u);
  assert.match(cover, /EditorialNetwork/u);
});

test('test miniapps reuse the editorial cover but remain visually subordinate while Tools stay quiet rows', () => {
  const home = read('app/(main)/index.tsx');
  const tile = read('features/devMiniapps/DevMiniappTile.tsx');

  assert.match(tile, /EditorialMiniappCover/u);
  assert.match(tile, /devPanel\.testOnly/u);
  assert.match(tile, /devPanel\.clients/u);
  assert.match(tile, /devPanel\.public/u);
  assert.match(read('components/EditorialMiniappCover.tsx'), /numberOfLines=\{2\}/u);
  assert.match(tile, /tone="test"/u);
  assert.match(home, /<ToolRow/u);
  assert.match(home, /styles\.toolsSurface/u);
  assert.match(home, /colors\.editorialSurface/u);
});

test('the premium system reaches Saved, Settings, and bottom navigation', () => {
  const saved = read('app/(main)/saved.tsx');
  const settings = read('app/(main)/settings.tsx');
  const navigation = read('components/BottomNavigation.tsx');

  assert.match(saved, /colors\.editorialSurface/u);
  assert.match(settings, /colors\.editorialSurface/u);
  assert.match(settings, /styles\.sectionRule/u);
  assert.match(navigation, /styles\.activeMarker/u);
  assert.match(navigation, /colors\.accent/u);
});
