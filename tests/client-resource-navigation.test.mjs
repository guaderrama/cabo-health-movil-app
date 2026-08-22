import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyClientResourceNavigation,
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
