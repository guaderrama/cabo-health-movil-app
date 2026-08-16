import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { getPublicMiniapp } from '../.test-build/constants/publicMiniapps.js';
import {
  applyNavigationDecision,
  applyPopupNavigation,
  getRestrictedSharePayload,
  getRestrictedWebViewPolicyProps,
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

const POLICY_CONTROLLED_WEBVIEW_PROPS = new Set([
  'source',
  'onShouldStartLoadWithRequest',
  'onOpenWindow',
  'originWhitelist',
  'javaScriptEnabled',
  'domStorageEnabled',
  'mixedContentMode',
  'allowFileAccess',
  'allowFileAccessFromFileURLs',
  'allowUniversalAccessFromFileURLs',
  'javaScriptCanOpenWindowsAutomatically',
  'setSupportMultipleWindows',
  'sharedCookiesEnabled',
  'thirdPartyCookiesEnabled',
  'limitsNavigationsToAppBoundDomains',
  'mediaCapturePermissionGrantType',
  'geolocationEnabled',
]);

function assertPolicyPropsAreFinalWebViewAuthority(source) {
  const sourceFile = ts.createSourceFile(
    'RestrictedWebView.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const webViews = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'WebView') {
      webViews.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(webViews.length, 1, 'Expected exactly one native WebView.');

  const attributes = webViews[0].attributes.properties;
  const policySpreadIndexes = [];
  attributes.forEach((attribute, index) => {
    if (ts.isJsxSpreadAttribute(attribute)) {
      const expression = attribute.expression.getText(sourceFile);
      assert.equal(expression, 'restrictedWebViewPolicyProps',
        `Uncontrolled WebView prop spread is forbidden: ${expression}`);
      policySpreadIndexes.push(index);
      return;
    }

    const name = attribute.name.getText(sourceFile);
    assert.equal(
      POLICY_CONTROLLED_WEBVIEW_PROPS.has(name),
      false,
      `Direct policy-controlled WebView prop is forbidden: ${name}`,
    );
    assert.equal(name === 'onMessage' || name.startsWith('injectedJavaScript'), false,
      `Direct WebView bridge/injection prop is forbidden: ${name}`);
  });

  assert.deepEqual(policySpreadIndexes, [attributes.length - 1],
    'The single restricted policy-props spread must be the final WebView authority.');
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

test('effective policy props bind canonical source and callbacks to the exact security config', () => {
  const onShouldStartLoadWithRequest = () => true;
  const onOpenWindow = () => undefined;

  assert.deepEqual(getRestrictedWebViewPolicyProps(miniapp, {
    onShouldStartLoadWithRequest,
    onOpenWindow,
  }), {
    source: { uri: 'https://cabohealth.org/apps/healthy-recipes/' },
    onShouldStartLoadWithRequest,
    onOpenWindow,
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

test('native WebView makes one final policy spread authoritative over effective props', () => {
  const source = readFileSync('features/launch/RestrictedWebView.tsx', 'utf8');
  assertPolicyPropsAreFinalWebViewAuthority(source);

  for (const mutation of [
    `originWhitelist={['https://cabohealth.org']} {...restrictedWebViewPolicyProps}`,
    `{...restrictedWebViewPolicyProps} originWhitelist={['https://cabohealth.org']}`,
    `{...untrustedProps} {...restrictedWebViewPolicyProps}`,
    `injectedJavaScriptObject={{ token: 'unsafe' }} {...restrictedWebViewPolicyProps}`,
    `{...restrictedWebViewPolicyProps} injectedJavaScriptObject={{ token: 'unsafe' }}`,
  ]) {
    const mutatedSource = source.replace('{...restrictedWebViewPolicyProps}', mutation);
    assert.notEqual(mutatedSource, source, `Mutation fixture was not applied: ${mutation}`);
    assert.throws(() => assertPolicyPropsAreFinalWebViewAuthority(mutatedSource));
  }
});

test('native component retains canonical sharing and flex-bounded scrollable error state', () => {
  const source = readFileSync('features/launch/RestrictedWebView.tsx', 'utf8');
  assert.match(source, /getRestrictedSharePayload\(miniapp, title\)/u);
  assert.match(source, /<View style=\{styles\.content\}>/u);
  assert.match(source, /<ScrollView/u);
  assert.match(source, /errorOverlay: \{ position: 'absolute', inset: 0 \}/u);
  assert.doesNotMatch(source, /errorOverlay:[^\n]*(?:top|bottom):/u);
});
