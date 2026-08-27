import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CLIENT_RESOURCE_REJECTED_PATH,
  classifyClientResourceDeepLink,
  redirectClientResourceSystemPath,
} from '../.test-build/features/clientAccess/clientResourceDeepLink.js';

const read = (path) => readFileSync(path, 'utf8');

const opensNativeAccess = (href, expectedPath) => assert.deepEqual(
  classifyClientResourceDeepLink(href),
  { decision: 'open-native-client-access', path: expectedPath },
);

const isNotFound = (href) => assert.equal(
  classifyClientResourceDeepLink(href).decision,
  'not-found',
);

test('clean Client Resources universal links resolve to the native access gate', () => {
  opensNativeAccess('/apps/client-resources', '/apps/client-resources/');
  opensNativeAccess('/apps/client-resources/', '/apps/client-resources/');
  opensNativeAccess(
    '/apps/client-resources/microbiota-guide/',
    '/apps/client-resources/microbiota-guide/',
  );
  opensNativeAccess(
    'https://cabohealth.org/apps/client-resources/microbiota-guide/chapter-1.html',
    '/apps/client-resources/microbiota-guide/chapter-1.html',
  );
});

test('launch, api, traversal, ambiguous paths, query, and fragment fail closed', () => {
  for (const href of [
    '/apps/client-resources/launch/',
    '/apps/client-resources/api/',
    '/apps/client-resources/guide/api/',
    '/apps/client-resources/../healthy-recipes/',
    '/apps/client-resources/%2e%2e/healthy-recipes/',
    '/apps/client-resources//microbiota-guide/',
    '/apps/client-resources/space here/',
    '/apps/client-resources/evil\\path/',
    '/apps/client-resources/microbiota-guide/?token=leak',
    '/apps/client-resources/microbiota-guide/#chapter-1',
    '/apps/client%2dresources/microbiota-guide/',
    '/apps/client%252dresources/microbiota-guide/',
    '/apps/other/../client-resources/',
    'https://evil.example/apps/client-resources/',
    'https://www.cabohealth.org/apps/client-resources/',
  ]) isNotFound(href);

  assert.equal(
    redirectClientResourceSystemPath('/apps/client-resources/launch/'),
    CLIENT_RESOURCE_REJECTED_PATH,
  );
});

test('the two public miniapp routes pass through ingress unchanged', () => {
  for (const href of [
    '/apps/clinic-guide/',
    '/apps/healthy-recipes/',
    'https://cabohealth.org/apps/clinic-guide/',
    'https://cabohealth.org/apps/healthy-recipes/',
  ]) {
    assert.deepEqual(classifyClientResourceDeepLink(href), { decision: 'unrelated' });
    assert.equal(redirectClientResourceSystemPath(href), href);
  }
});

test('native routes reuse the existing context folio and modal without preloading private web content', () => {
  const nativeIntent = read('app/+native-intent.tsx');
  const layout = read('app/apps/client-resources/_layout.tsx');
  const indexRoute = read('app/apps/client-resources/index.tsx');
  const subroute = read('app/apps/client-resources/[...path].tsx');
  const gate = read('features/clientAccess/ClientResourceDeepLinkGate.tsx');
  const modal = read('features/clientAccess/ClientAccessModal.tsx');
  const protectedRoute = read('app/client-resource/[resourceId].tsx');
  const publicRoute = read('app/apps/[slug].tsx');

  assert.match(nativeIntent, /redirectClientResourceSystemPath\(path\)/u);
  assert.doesNotMatch(nativeIntent, /\basync\b|fetch\(/u);
  assert.match(layout, /useUnstableGlobalHref\(\)/u);
  assert.match(layout, /<NotFoundScreen\s*\/>/u);
  assert.match(indexRoute, /<ClientResourceDeepLinkGate\s*\/>/u);
  assert.match(subroute, /<ClientResourceDeepLinkGate\s*\/>/u);
  assert.match(gate, /<ClientAccessFolio/u);
  assert.match(gate, /<ClientAccessModal\s+visible/u);
  assert.match(gate, /buildClientResourceRoute\(resourceId\)/u);
  assert.doesNotMatch(
    `${nativeIntent}\n${layout}\n${indexRoute}\n${subroute}\n${gate}`,
    /WebView|RestrictedWebView|fetch\(|createLaunch\(|onMessage|injectedJavaScript/u,
  );

  assert.match(modal, /const unlocked = status === 'unlocked' && grant !== null/u);
  assert.match(modal, /grant\.resources\.map/u);
  assert.match(modal, /secureTextEntry/u);
  assert.match(modal, /onOpenResource\(resource\.id\)/u);
  assert.doesNotMatch(modal, /createLaunch\(|ClientResourceWebView/u);
  assert.match(protectedRoute, /<ClientResourceWebView/u);
  assert.doesNotMatch(protectedRoute, /<Modal\b/u);

  assert.match(publicRoute, /getPublicMiniapp\(resolvedSlug\)/u);
  assert.match(publicRoute, /<RestrictedWebView miniapp=\{miniapp\}/u);
  assert.doesNotMatch(publicRoute, /client-resources|ClientAccess/u);
});
