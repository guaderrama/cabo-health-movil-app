import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CLINIC_GUIDE,
  RECIPE_CONTENT,
  isApprovedCitationUrl,
} from '../.test-build/features/resources/publicContent.js';

function read(path) {
  return readFileSync(path, 'utf8');
}

test('every reachable native wellness surface renders its exact dated citations', () => {
  const recipes = read('features/resources/RecipeBrowser.tsx');
  const visit = read('features/resources/VisitChecklist.tsx');
  const citationList = read('features/resources/CitationList.tsx');

  assert.match(recipes, /<CitationList[\s\S]*sources=\{RECIPE_CONTENT\.sources\}[\s\S]*reviewedOn=\{RECIPE_CONTENT\.reviewedOn\}/u);
  assert.match(visit, /<CitationList[\s\S]*sources=\{CLINIC_GUIDE\.sources\}[\s\S]*reviewedOn=\{CLINIC_GUIDE\.reviewedOn\}/u);
  assert.match(citationList, /accessibilityRole="link"/u);
  assert.match(citationList, /isApprovedCitationUrl/u);
  assert.match(citationList, /Linking\.openURL/u);
});

test('native citation links fail closed outside the exact reviewed source set', () => {
  const reviewed = [
    ...RECIPE_CONTENT.sources.map(({ url }) => url),
    ...CLINIC_GUIDE.sources.map(({ url }) => url),
  ];
  assert.ok(reviewed.length > 0);
  for (const url of reviewed) assert.equal(isApprovedCitationUrl(url), true, url);

  for (const url of [
    'http://www.who.int/news-room/fact-sheets/detail/healthy-diet',
    'https://evil.example/',
    `${reviewed[0]}?redirect=https://evil.example/`,
    `${reviewed[0]}#unreviewed`,
    'not a URL',
  ]) {
    assert.equal(isApprovedCitationUrl(url), false, url);
  }
});

test('the consumer binary does not expose the owner-only Staff portal', () => {
  const settings = read('app/(main)/settings.tsx');
  const config = read('constants/config.ts');
  const messages = read('i18n/messages.ts');
  const manifest = JSON.parse(read('release/app-store/3.0/release-manifest.json'));
  const storyboard = read('release/app-store/3.0/screenshots/storyboard.md');
  const testFlight = read('release/app-store/3.0/testflight-what-to-test.md');
  const reviewNotes = read('release/app-store/3.0/review-notes.md');

  assert.doesNotMatch(settings, /openStaffPortal|settings\.staffAccess|staffPortal/u);
  assert.doesNotMatch(config, /staffPortal/u);
  assert.doesNotMatch(messages, /settings\.staffAccess/u);
  assert.equal(manifest.scope.staffAdministration.visibleSettingsEntry, false);
  assert.equal(manifest.scope.staffAdministration.consumerBinaryReachable, false);
  assert.equal(manifest.scope.staffAdministration.ownerDirectUrlOnly, true);
  assert.doesNotMatch(storyboard, /visible Staff Access|Staff row visible/iu);
  assert.doesNotMatch(testFlight, /Settings visibly opens/iu);
  assert.match(reviewNotes, /Staff Portal is not linked or reachable from the consumer binary/iu);
});
