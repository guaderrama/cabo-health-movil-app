import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

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
const require = createRequire(import.meta.url);

function loadPinnedSharedWrapper(platform) {
  const source = readFileSync(
    'node_modules/react-native-webview/src/WebViewShared.tsx',
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const linkingEffects = [];
  const runtimeModule = { exports: {} };
  const runtimeRequire = (specifier) => {
    if (specifier === 'react-native') return {
      ActivityIndicator: 'ActivityIndicator',
      Linking: {
        canOpenURL: async (url) => {
          linkingEffects.push(['canOpenURL', url]);
          return true;
        },
        openURL: async (url) => {
          linkingEffects.push(['openURL', url]);
        },
      },
      Platform: { OS: platform },
      Text: 'Text',
      View: 'View',
    };
    if (specifier === './WebView.styles') return {
      __esModule: true,
      default: {
        errorText: {},
        errorTextTitle: {},
        loadingOrErrorView: {},
      },
    };
    return require(specifier);
  };
  const execute = new Function('require', 'module', 'exports', compiled);
  execute(runtimeRequire, runtimeModule, runtimeModule.exports);
  return {
    createOnShouldStartLoadWithRequest:
      runtimeModule.exports.createOnShouldStartLoadWithRequest,
    linkingEffects,
  };
}

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

test('patched shared wrapper forces rejected origins to false after one application callback on iOS and Android', async () => {
  for (const platform of ['ios', 'android']) {
    const runtime = loadPinnedSharedWrapper(platform);
    const applicationRequests = [];
    const nativeDecisions = [];
    const rejectedUrl = 'https://accounts.eightsleep.com/login';
    const handler = runtime.createOnShouldStartLoadWithRequest(
      (shouldStart, url, lockIdentifier) => {
        nativeDecisions.push([shouldStart, url, lockIdentifier]);
      },
      [destination.origin],
      (request) => {
        applicationRequests.push(request.url);
        return true;
      },
    );

    handler({ nativeEvent: { url: rejectedUrl, lockIdentifier: 41 } });
    await Promise.resolve();

    assert.deepEqual(applicationRequests, [rejectedUrl], platform);
    assert.deepEqual(nativeDecisions, [[false, rejectedUrl, 41]], platform);
    assert.deepEqual(runtime.linkingEffects, [], platform);
  }
});

test('patched shared wrapper keeps a whitelist-prefix lookalike blocked by the exact-origin callback', () => {
  for (const platform of ['ios', 'android']) {
    const runtime = loadPinnedSharedWrapper(platform);
    const applicationRequests = [];
    const nativeDecisions = [];
    const lookalikeUrl = 'https://www.eightsleep.com.attacker.org/';
    const handler = runtime.createOnShouldStartLoadWithRequest(
      (shouldStart, url, lockIdentifier) => {
        nativeDecisions.push([shouldStart, url, lockIdentifier]);
      },
      [destination.origin],
      (request) => {
        applicationRequests.push(request.url);
        return false;
      },
    );

    handler({ nativeEvent: { url: lookalikeUrl, lockIdentifier: 42 } });

    assert.deepEqual(applicationRequests, [lookalikeUrl], platform);
    assert.deepEqual(nativeDecisions, [[false, lookalikeUrl, 42]], platform);
    assert.deepEqual(runtime.linkingEffects, [], platform);
  }
});

test('external WebView source denies privileged surfaces and has no browser, share, or bridge escape', () => {
  const component = readFileSync('features/launch/ExternalHttpsWebView.tsx', 'utf8');
  const policy = readFileSync('features/launch/externalHttpsNavigationPolicy.ts', 'utf8');

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
});
