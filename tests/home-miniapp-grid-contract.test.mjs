import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { darkColors, lightColors } from '../.test-build/constants/colors.js';

const read = (path) => readFileSync(path, 'utf8');

const luminance = (hex) => {
  const channels = hex.slice(1).match(/.{2}/gu).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrast = (first, second) => {
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
};

test('Home presents public and client preview resources in responsive editorial grids', () => {
  const home = read('app/(main)/index.tsx');

  assert.match(home, /useWindowDimensions/u);
  assert.match(home, /resolveCatalogCardColumns/u);
  assert.match(home, /<PremiumMiniappTile/u);
  assert.match(home, /<ClientMiniappTile/u);
  assert.match(home, /<ClientAccessFolio/u);
  assert.match(home, /buildClientHomeCards/u);
  assert.match(home, /useClientAccess/u);
  assert.doesNotMatch(home, /<DevMiniappTile|features\/devMiniapps/u);
  assert.match(home, /styles\.miniappGrid/u);
  assert.match(home, /columns === 2/u);
  assert.doesNotMatch(home, /<PremiumResourceRow/u);
  assert.doesNotMatch(home, /<DevMiniappRow/u);
});

test('Home refreshes both public previews and secure client grants', () => {
  const home = read('app/(main)/index.tsx');

  assert.match(home, /refreshClientAccess/u);
  assert.match(home, /refreshPublicCatalog/u);
  assert.match(home, /Promise\.all/u);
  assert.match(home, /refreshing=\{isRefreshing/u);
});

test('Home and Saved delegate Public navigation to the destination-discriminated route builder', () => {
  const home = read('app/(main)/index.tsx');
  const saved = read('app/(main)/saved.tsx');

  assert.match(home, /router\.push\(buildPublicMiniappRoute\(miniapp\)\)/u);
  assert.match(saved, /router\.push\(buildPublicMiniappRoute\(miniapp\)\)/u);
  assert.doesNotMatch(`${home}\n${saved}`, /params:\s*\{[^}]*destinationUrl/u);
});

test('the Manage access action uses readable bronze in light and dark mode', () => {
  const home = read('app/(main)/index.tsx');

  assert.match(home, /isDark \? colors\.accentLight : colors\.accentDark/u);
  assert.ok(contrast(lightColors.accentDark, lightColors.cardBackground) >= 4.5);
  assert.ok(contrast(darkColors.accentLight, darkColors.background) >= 4.5);
});

test('public miniapps render as editorial covers with full-card navigation and a separate 44-point favorite action', () => {
  const tile = read('components/PremiumMiniappTile.tsx');
  const cover = read('components/EditorialMiniappCover.tsx');
  const colors = read('constants/colors.ts');

  assert.match(tile, /EditorialMiniappCover/u);
  assert.match(tile, /buildCatalogCardAccessibilityLabel/u);
  assert.match(tile, /accessibilityHint=\{t\('catalog\.openResource'\)\}/u);
  assert.match(cover, /accessibilityState=\{\{ selected: favorite\.selected \}\}/u);
  assert.match(cover, /width: 44/u);
  assert.match(cover, /height: 44/u);
  assert.match(cover, /numberOfLines=\{2\}/u);
  assert.match(tile, /catalog\.publicBadge/u);
  assert.match(cover, /useEditorialTileMotion/u);
  assert.match(cover, /fontFamily: 'Georgia'/u);
  assert.match(cover, /styles\.accessTab/u);
  assert.match(cover, /styles\.accessTabShape/u);
  assert.match(cover, /styles\.backLayerNear/u);
  assert.match(cover, /styles\.backLayerMid/u);
  assert.match(cover, /styles\.backLayerFar/u);
  assert.match(cover, /pointerEvents="none"/u);
  assert.match(cover, /importantForAccessibility="no-hide-descendants"/u);
  assert.match(cover, /miniappCardSurface/u);
  assert.match(cover, /actionLabel/u);
  assert.match(cover, /boxShadow/u);
  assert.match(cover, /badgeIcon/u);
  assert.doesNotMatch(cover, /EditorialCoverArt|LinearGradient/u);
  assert.doesNotMatch(cover, /styles\.cover|styles\.openAction/u);
  assert.doesNotMatch(cover, /borderStyle:\s*'dashed'/u);
  assert.match(colors, /miniappFolioLayerNear/u);
  assert.match(colors, /miniappFolioLayerFar/u);
  assert.match(colors, /miniappFolioTabClient/u);
  assert.match(colors, /miniappCardBorderClient/u);
  assert.match(tile, /catalog\.openResource/u);
  assert.match(tile, /accessibilityHint=\{t\('catalog\.openResource'\)\}/u);
  assert.match(cover, /accessibilityRole="button"/u);
  assert.match(cover, /accessibilityLabel=\{accessibilityLabel\}/u);
  assert.match(cover, /accessibilityHint=\{accessibilityHint\}/u);
  assert.match(cover, /onPressIn=\{motion\.onPressIn\}/u);
  assert.match(cover, /onPressOut=\{motion\.onPressOut\}/u);
});

test('development-only miniapp source retains its editorial cover while production Tools stay quiet rows', () => {
  const home = read('app/(main)/index.tsx');
  const tile = read('features/devMiniapps/DevMiniappTile.tsx');

  assert.match(tile, /EditorialMiniappCover/u);
  assert.match(tile, /devPanel\.testOnly/u);
  assert.match(tile, /devPanel\.clients/u);
  assert.match(tile, /devPanel\.public/u);
  assert.match(tile, /miniapp\.access === 'client' \? 'client' : 'test'/u);
  assert.match(tile, /lock-closed-outline/u);
  assert.match(tile, /globe-outline/u);
  assert.match(tile, /catalog\.openResource/u);
  assert.doesNotMatch(tile, /favorite=/u);
  assert.match(read('components/EditorialMiniappCover.tsx'), /numberOfLines=\{2\}/u);
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
