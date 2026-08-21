import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  darkColors,
  introColors,
  lightColors,
} from '../.test-build/constants/colors.js';

test('the approved intro palette is the light-theme authority', () => {
  assert.equal(lightColors.primary, introColors.sea);
  assert.equal(lightColors.primaryDark, introColors.ink);
  assert.equal(lightColors.background, introColors.paper);
  assert.equal(lightColors.text, introColors.ink);
  assert.equal(lightColors.textSecondary, introColors.soft);
  assert.equal(lightColors.favorite, introColors.bronze);
  assert.equal(lightColors.gradientStart, introColors.gradientTop);
  assert.equal(lightColors.gradientMiddle, introColors.gradientMiddle);
  assert.equal(lightColors.gradientEnd, introColors.gradientBottom);
});

test('dark mode stays inside the CaboHealth ink, sea, paper, and bronze family', () => {
  assert.equal(darkColors.background, introColors.ink);
  assert.equal(darkColors.accent, introColors.bronze);
  assert.equal(darkColors.text, introColors.paper);
  assert.match(darkColors.primary, /^#[0-9A-F]{6}$/u);
  assert.notEqual(darkColors.primary, '#14B8A6');
  assert.notEqual(darkColors.accent, '#38BDF8');
});

test('the approved light presentation is the first-launch theme', () => {
  const context = readFileSync('context/ThemeContext.tsx', 'utf8');
  const storage = readFileSync('services/storage.ts', 'utf8');

  assert.match(context, /useState<ThemeMode>\('light'\)/u);
  assert.match(
    storage,
    /getThemePreference[\s\S]*?readStoredValue\([\s\S]*?'light',\s*\n\s*\);/u,
  );
});

test('all primary native destinations use the same branded background surface', () => {
  const files = [
    'app/(main)/index.tsx',
    'app/(main)/saved.tsx',
    'app/(main)/settings.tsx',
    'app/(main)/recipes.tsx',
    'app/(main)/visit-checklist.tsx',
    'app/+not-found.tsx',
  ];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /BrandedBackground/u, `${file} must render BrandedBackground`);
  }
});

test('Saved reuses the same compact resource surface instead of the retired catalog card', () => {
  const source = readFileSync('app/(main)/saved.tsx', 'utf8');
  assert.match(source, /PremiumResourceRow/u);
  assert.doesNotMatch(source, /\bAppCard\b/u);
  assert.doesNotMatch(source, /resolveCatalogCardColumns/u);
});

test('the approved Home removes the repeated welcome hero and keeps rich edge motion', () => {
  const source = readFileSync('app/(main)/index.tsx', 'utf8');
  assert.doesNotMatch(source, /home\.welcome|catalog\.title|catalog\.subtitle/u);
  assert.doesNotMatch(source, /FeaturedGuide|QuickActionCard/u);
  assert.match(source, /density="rich"/u);
  assert.match(source, /home\.brandPromise/u);
  assert.match(source, /styles\.brandLockup/u);
  assert.match(source, /home\.resources/u);
  assert.match(source, /home\.tools/u);
  assert.match(source, /home\.prepareVisit/u);
  assert.doesNotMatch(source, /color=\{colors\.primaryDark\}/u);
});

test('hosted miniapps retain the same approved public palette', () => {
  const css = readFileSync('miniapps/shared/styles.css', 'utf8').toLowerCase();
  for (const expected of [
    '--ink: #082a3c',
    '--sea: #0e5876',
    '--paper: #fbfaf7',
    '--bronze: #b8956a',
    '--soft: #4f7785',
  ]) {
    assert.match(css, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});
