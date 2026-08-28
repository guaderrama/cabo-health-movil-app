import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyExternalHttpsNavigationDecision,
  classifyExternalHttpsNavigation,
  getExternalHttpsWebViewPolicyProps,
  getExternalHttpsWebViewSource,
  handleExternalPopup,
} from '../.test-build/features/launch/externalHttpsNavigationPolicy.js';
import {
  RESTRICTED_WEBVIEW_SECURITY_PROPS,
} from '../.test-build/features/launch/restrictedWebViewBehavior.js';

const destination = Object.freeze({
  canonicalUrl: 'https://www.eightsleep.com/mx/?locale=es#sleep',
  origin: 'https://www.eightsleep.com',
});

test('external WebView loads the exact URL and allows only safe same-origin top-frame navigation', () => {
  assert.deepEqual(getExternalHttpsWebViewSource(destination), {
    uri: 'https://www.eightsleep.com/mx/?locale=es#sleep',
  });
  for (const url of [
    'https://www.eightsleep.com/mx/sleep',
    'https://www.eightsleep.com/mx/?next=1#details',
  ]) {
    assert.deepEqual(classifyExternalHttpsNavigation(url, destination.origin), {
      decision: 'allow',
      reason: 'safe-same-origin',
    });
  }
  assert.equal(
    classifyExternalHttpsNavigation(
      'https://accounts.eightsleep.com/',
      destination.origin,
    ).decision,
    'block',
  );
});

test('external WebView policy opts out of app-bound domains only for the selected origin', () => {
  const handlers = Object.freeze({
    onShouldStartLoadWithRequest: () => true,
    onOpenWindow: () => {},
  });
  const props = getExternalHttpsWebViewPolicyProps(destination, handlers);

  assert.deepEqual(props.source, { uri: destination.canonicalUrl });
  assert.deepEqual(props.originWhitelist, [destination.origin]);
  assert.equal(props.limitsNavigationsToAppBoundDomains, false);
  assert.equal(props.mixedContentMode, 'never');
  assert.equal(props.allowFileAccess, false);
  assert.equal(props.allowFileAccessFromFileURLs, false);
  assert.equal(props.allowUniversalAccessFromFileURLs, false);
  assert.equal(props.javaScriptCanOpenWindowsAutomatically, false);
  assert.equal(props.setSupportMultipleWindows, true);
  assert.equal(props.sharedCookiesEnabled, false);
  assert.equal(props.thirdPartyCookiesEnabled, false);
  assert.equal(props.mediaCapturePermissionGrantType, 'deny');
  assert.equal(props.geolocationEnabled, false);
  assert.equal(props.allowsLinkPreview, false);
  assert.equal('onMessage' in props, false);
  assert.equal('injectedJavaScript' in props, false);
  assert.equal('injectedJavaScriptBeforeContentLoaded' in props, false);

  assert.equal(RESTRICTED_WEBVIEW_SECURITY_PROPS.limitsNavigationsToAppBoundDomains, true);
});

test('popup, cross-origin redirect, unsafe scheme, local target, and traversal all block in place', () => {
  for (const url of [
    'https://accounts.eightsleep.com/',
    'http://www.eightsleep.com/',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///tmp/private',
    'https://127.0.0.1/',
    'https://localhost/',
    'https://www.eightsleep.com/a/%2e%2e/private',
    'https://www.eightsleep.com/a/%2fprivate',
  ]) {
    assert.equal(
      classifyExternalHttpsNavigation(url, destination.origin).decision,
      'block',
      url,
    );
  }

  let errorCalls = 0;
  let openExternalCalls = 0;
  const effects = {
    showError: () => { errorCalls += 1; },
    openExternal: () => { openExternalCalls += 1; },
  };
  assert.equal(handleExternalPopup('https://www.eightsleep.com/popup', effects), false);
  assert.equal(openExternalCalls, 0);
  assert.equal(errorCalls, 1);
});

test('blocked navigation stays in place and shows only the generic unavailable state', () => {
  let errorCalls = 0;
  const allowed = applyExternalHttpsNavigationDecision(
    classifyExternalHttpsNavigation('https://accounts.eightsleep.com/', destination.origin),
    { showError: () => { errorCalls += 1; } },
  );
  assert.equal(allowed, false);
  assert.equal(errorCalls, 1);
});

test('external WebView source denies privileged surfaces and has no browser, share, or bridge escape', () => {
  const component = readFileSync('features/launch/ExternalHttpsWebView.tsx', 'utf8');
  const policy = readFileSync('features/launch/externalHttpsNavigationPolicy.ts', 'utf8');
  const pinnedWebViewShared = readFileSync(
    'node_modules/react-native-webview/src/WebViewShared.tsx',
    'utf8',
  );

  for (const required of [
    /mediaCapturePermissionGrantType:\s*'deny'/u,
    /geolocationEnabled:\s*false/u,
    /allowFileAccess:\s*false/u,
    /allowFileAccessFromFileURLs:\s*false/u,
    /allowUniversalAccessFromFileURLs:\s*false/u,
    /sharedCookiesEnabled:\s*false/u,
    /thirdPartyCookiesEnabled:\s*false/u,
  ]) assert.match(policy, required);
  assert.match(component, /\{\.\.\.externalHttpsWebViewPolicyProps\}/u);
  assert.match(component, /onOpenWindow/u);
  assert.doesNotMatch(
    component,
    /\bLinking\b|\bShare\b|openURL|onMessage|injectedJavaScript|nativeConfig|onFileDownload/iu,
  );
  assert.doesNotMatch(
    pinnedWebViewShared,
    /Linking\.(?:canOpenURL|openURL)/u,
    'originWhitelist rejection must not escape to the operating-system browser',
  );
});
