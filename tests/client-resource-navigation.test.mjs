import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyClientResourceNavigation,
  getExternalClientResourceWebViewPolicyProps,
  getClientResourceWebViewPolicyProps,
} from '../.test-build/features/clientAccess/clientResourceNavigation.js';

const allow = (url) => assert.deepEqual(
  classifyClientResourceNavigation(url),
  { decision: 'allow', reason: 'client-resource-path' },
);

const block = (url) => assert.equal(classifyClientResourceNavigation(url).decision, 'block');

test('client WebView allows only the exact CaboHealth launch endpoint and resource subtree', () => {
  allow('https://cabohealth.org/apps/client-resources/launch/');
  allow('https://cabohealth.org/apps/client-resources/');
  allow('https://cabohealth.org/apps/client-resources/microbiota-guide/');
  allow('https://cabohealth.org/apps/client-resources/microbiota-guide/chapter-1.html');
});

test('client WebView blocks alternate origins, ports, credentials, queries, and fragments', () => {
  for (const url of [
    'http://cabohealth.org/apps/client-resources/launch/',
    'https://www.cabohealth.org/apps/client-resources/launch/',
    'https://cabohealth.org.evil.test/apps/client-resources/launch/',
    'https://CABOHEALTH.org/apps/client-resources/launch/',
    'https://cabohealth.org:443/apps/client-resources/launch/',
    'https://user@cabohealth.org/apps/client-resources/launch/',
    'https://cabohealth.org/apps/client-resources/launch/?nonce=leak',
    'https://cabohealth.org/apps/client-resources/launch/#fragment',
    'about:blank',
  ]) block(url);
});

test('client WebView blocks sibling paths and path confusion or traversal', () => {
  for (const url of [
    'https://cabohealth.org/',
    'https://cabohealth.org/apps/client-resources-evil/',
    'https://cabohealth.org/apps/healthy-recipes/',
    'https://cabohealth.org/apps/client-resources/../healthy-recipes/',
    'https://cabohealth.org/apps/client-resources/%2e%2e/healthy-recipes/',
    'https://cabohealth.org/apps/client-resources/%252e%252e%252fhealthy-recipes/',
    'https://cabohealth.org/apps/client-resources/%2F%2Fevil.test/',
    'https://cabohealth.org/apps/client-resources//evil',
    'https://cabohealth.org/apps/client-resources/evil\\path',
    'https://cabohealth.org/apps/client-resources/space here',
  ]) block(url);
});

test('App Review WebView allows only its exact fixed launch path', () => {
  assert.deepEqual(
    classifyClientResourceNavigation(
      'https://cabohealth.org/apps/app-review/launch/',
      'review_sandbox',
    ),
    { decision: 'allow', reason: 'app-review-launch-path' },
  );
  for (const url of [
    'https://cabohealth.org/apps/app-review/',
    'https://cabohealth.org/apps/app-review/sample/',
    'https://cabohealth.org/apps/app-review/launch/index.html',
    'https://cabohealth.org/apps/app-review/launch/?nonce=leak',
    'https://cabohealth.org/apps/client-resources/launch/',
  ]) {
    assert.equal(
      classifyClientResourceNavigation(url, 'review_sandbox').decision,
      'block',
    );
  }
});

test('the fixed App Review page runs without JavaScript or DOM storage', () => {
  const source = {
    uri: 'https://cabohealth.org/apps/app-review/launch/',
    method: 'POST',
    body: 'nonce=abcdefghijklmnopqrstuvwxyz123456',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  };
  const props = getClientResourceWebViewPolicyProps(source, () => true);

  assert.equal(props.javaScriptEnabled, false);
  assert.equal(props.domStorageEnabled, false);
  assert.equal(props.source, source);
  assert.equal('onMessage' in props, false);
  assert.equal('injectedJavaScript' in props, false);
});

test('client launch policy uses POST and the shared app-bound WebView hardening', () => {
  const source = {
    uri: 'https://cabohealth.org/apps/client-resources/launch/',
    method: 'POST',
    body: 'nonce=opaque_transient_nonce_123456789',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  };
  const shouldStart = () => true;
  const props = getClientResourceWebViewPolicyProps(source, shouldStart);

  assert.equal(props.source, source);
  assert.equal(props.onShouldStartLoadWithRequest, shouldStart);
  assert.equal(props.limitsNavigationsToAppBoundDomains, true);
  assert.equal(props.sharedCookiesEnabled, false);
  assert.equal(props.thirdPartyCookiesEnabled, false);
  assert.equal(props.allowFileAccess, false);
  assert.equal(props.mixedContentMode, 'never');
  assert.equal('onMessage' in props, false);
  assert.equal('injectedJavaScript' in props, false);
});

test('external VIP launch reuses the exact same-origin external security policy', () => {
  const launch = {
    kind: 'external_https',
    realm: 'production_client',
    expiresAtMs: 1_900_000_060_000,
    source: { uri: 'https://www.eightsleep.com/mx/' },
    origin: 'https://www.eightsleep.com',
  };
  const shouldStart = () => true;
  const openWindow = () => false;
  const props = getExternalClientResourceWebViewPolicyProps(
    launch,
    shouldStart,
    openWindow,
  );

  assert.deepEqual(props.source, { uri: 'https://www.eightsleep.com/mx/' });
  assert.deepEqual(props.originWhitelist, ['https://www.eightsleep.com']);
  assert.equal(props.onShouldStartLoadWithRequest, shouldStart);
  assert.equal(props.onOpenWindow, openWindow);
  assert.equal(props.limitsNavigationsToAppBoundDomains, false);
  assert.equal(props.sharedCookiesEnabled, false);
  assert.equal(props.thirdPartyCookiesEnabled, false);
  assert.equal(props.allowFileAccess, false);
  assert.equal(props.mixedContentMode, 'never');
  assert.equal(props.mediaCapturePermissionGrantType, 'deny');
  assert.equal(props.geolocationEnabled, false);
  assert.equal('onMessage' in props, false);
  assert.equal('injectedJavaScript' in props, false);
});
