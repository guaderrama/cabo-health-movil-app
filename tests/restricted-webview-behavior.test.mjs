import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getPublicMiniapp } from '../.test-build/constants/publicMiniapps.js';
import {
  applyNavigationDecision,
  applyPopupNavigation,
  getRestrictedSharePayload,
  getRestrictedWebViewSource,
  handleRestrictedWebViewBack,
  RESTRICTED_WEBVIEW_SECURITY_PROPS,
} from '../.test-build/features/launch/restrictedWebViewBehavior.js';

const miniapp = getPublicMiniapp('healthy-recipes');
if (!miniapp) throw new Error('Expected frozen Healthy Recipes fixture.');

function createEffects() {
  const opened = [];
  let errors = 0;
  return {
    effects: {
      openExternal: (url) => { opened.push(url); },
      showError: () => { errors += 1; },
    },
    opened,
    get errors() { return errors; },
  };
}

test('decision application allows WebView navigation without external or error effects', () => {
  const observed = createEffects();
  const allowed = applyNavigationDecision(
    { decision: 'allow-webview', reason: 'selected-miniapp-path' },
    miniapp.canonicalUrl,
    observed.effects,
  );

  assert.equal(allowed, true);
  assert.deepEqual(observed.opened, []);
  assert.equal(observed.errors, 0);
});

test('decision application opens one exact external URL and cancels WebView navigation', () => {
  const observed = createEffects();
  const legalUrl = 'https://cabohealth.org/app/privacy/';
  const allowed = applyNavigationDecision(
    { decision: 'open-external', reason: 'approved-legal-click' },
    legalUrl,
    observed.effects,
  );

  assert.equal(allowed, false);
  assert.deepEqual(observed.opened, [legalUrl]);
  assert.equal(observed.errors, 0);
});

test('decision application blocks with one generic error and never opens a destination', () => {
  const observed = createEffects();
  const allowed = applyNavigationDecision(
    { decision: 'block', reason: 'host-not-allowed' },
    'https://example.test/unsafe',
    observed.effects,
  );

  assert.equal(allowed, false);
  assert.deepEqual(observed.opened, []);
  assert.equal(observed.errors, 1);
});

test('popup application always cancels and reports an error without Linking', () => {
  const observed = createEffects();
  const allowed = applyPopupNavigation({
    slug: miniapp.slug,
    targetUrl: 'https://cabohealth.org/app/privacy/',
    platform: 'ios',
    effects: observed.effects,
  });

  assert.equal(allowed, false);
  assert.deepEqual(observed.opened, []);
  assert.equal(observed.errors, 1);
});

test('header Back returns through history or replaces a cold Universal Link with the catalog', () => {
  const calls = [];
  handleRestrictedWebViewBack({
    canGoBack: () => true,
    back: () => calls.push('back'),
    replace: (route) => calls.push(`replace:${route}`),
  });
  assert.deepEqual(calls, ['back']);

  calls.length = 0;
  handleRestrictedWebViewBack({
    canGoBack: () => false,
    back: () => calls.push('back'),
    replace: (route) => calls.push(`replace:${route}`),
  });
  assert.deepEqual(calls, ['replace:/(main)']);
});

test('security config is exact, fail-closed, and contains no bridge or injection surface', () => {
  assert.deepEqual(RESTRICTED_WEBVIEW_SECURITY_PROPS, {
    originWhitelist: ['*'],
    javaScriptEnabled: true,
    domStorageEnabled: true,
    mixedContentMode: 'never',
    allowFileAccess: false,
    allowFileAccessFromFileURLs: false,
    allowUniversalAccessFromFileURLs: false,
    javaScriptCanOpenWindowsAutomatically: false,
    setSupportMultipleWindows: true,
    sharedCookiesEnabled: false,
    thirdPartyCookiesEnabled: false,
    limitsNavigationsToAppBoundDomains: true,
    mediaCapturePermissionGrantType: 'deny',
    geolocationEnabled: false,
  });
  assert.equal(Object.hasOwn(RESTRICTED_WEBVIEW_SECURITY_PROPS, 'onMessage'), false);
  assert.equal(Object.hasOwn(RESTRICTED_WEBVIEW_SECURITY_PROPS, 'injectedJavaScript'), false);
  assert.equal(Object.hasOwn(RESTRICTED_WEBVIEW_SECURITY_PROPS, 'injectedJavaScriptBeforeContentLoaded'), false);
});

test('source and share payload always use frozen canonical catalog values', () => {
  assert.deepEqual(getRestrictedWebViewSource(miniapp), {
    uri: 'https://cabohealth.org/apps/healthy-recipes/',
  });
  assert.deepEqual(getRestrictedSharePayload(miniapp, 'Healthy Recipes'), {
    title: 'Healthy Recipes',
    message: 'Healthy Recipes: https://cabohealth.org/apps/healthy-recipes/',
    url: 'https://cabohealth.org/apps/healthy-recipes/',
  });
});

test('native component wires the tested config, callbacks, and flex-bounded scrollable error state', () => {
  const source = readFileSync('features/launch/RestrictedWebView.tsx', 'utf8');
  assert.match(source, /\.\.\.RESTRICTED_WEBVIEW_SECURITY_PROPS/u);
  assert.match(source, /source=\{getRestrictedWebViewSource\(miniapp\)\}/u);
  assert.match(source, /onOpenWindow=\{handleOpenWindow\}/u);
  assert.match(source, /onShouldStartLoadWithRequest=\{handleNavigationRequest\}/u);
  assert.match(source, /getRestrictedSharePayload\(miniapp, title\)/u);
  assert.match(source, /<View style=\{styles\.content\}>/u);
  assert.match(source, /<ScrollView/u);
  assert.match(source, /errorOverlay: \{ position: 'absolute', inset: 0 \}/u);
  assert.doesNotMatch(source, /\bonMessage\s*=/u);
  assert.doesNotMatch(source, /\binjectedJavaScript(?:BeforeContentLoaded)?\s*=/u);
  assert.doesNotMatch(source, /errorOverlay:[^\n]*(?:top|bottom):/u);
});
