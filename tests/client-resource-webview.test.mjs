import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

import {
  applyExternalHttpsNavigationDecision,
  classifyExternalHttpsNavigationRequest,
} from '../.test-build/features/launch/externalHttpsNavigationPolicy.js';

const require = createRequire(import.meta.url);

function loadClientResourceWebView() {
  const source = readFileSync('features/clientAccess/ClientResourceWebView.tsx', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const state = [];
  let cursor = 0;
  const runtimeModule = { exports: {} };
  const runtimeRequire = (specifier) => {
    if (specifier === 'react') return {
      useCallback: (callback) => callback,
      useState: (initial) => {
        const index = cursor++;
        if (state.length <= index) state[index] = initial;
        return [state[index], (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
        }];
      },
    };
    if (specifier === 'react-native') return {
      ActivityIndicator: 'ActivityIndicator',
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      StyleSheet: {
        absoluteFillObject: {},
        create: (styles) => styles,
        hairlineWidth: 1,
      },
      Text: 'Text',
      View: 'View',
    };
    if (specifier === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (specifier === 'react-native-safe-area-context') return {
      useSafeAreaInsets: () => ({ top: 0 }),
    };
    if (specifier === 'react-native-webview') return { WebView: 'WebView' };
    if (specifier === '../../hooks') return {
      useTheme: () => ({ colors: {
        background: 'background', cardBackground: 'card', border: 'border',
        error: 'error', primary: 'primary', text: 'text', textSecondary: 'secondary', white: 'white',
      } }),
      useTranslations: () => ({ t: (key) => key }),
    };
    if (specifier === './clientResourceNavigation') return {
      classifyClientResourceNavigation: () => ({ decision: 'allow' }),
      getClientResourceWebViewPolicyProps: (launchSource, handler) => ({
        source: launchSource,
        onShouldStartLoadWithRequest: handler,
      }),
      getExternalClientResourceWebViewPolicyProps: (launch, handler, popup) => ({
        source: launch.source,
        onShouldStartLoadWithRequest: handler,
        onOpenWindow: popup,
      }),
    };
    if (specifier === '../launch/externalHttpsNavigationPolicy') return {
      applyExternalHttpsNavigationDecision,
      classifyExternalHttpsNavigationRequest,
      handleExternalPopup: () => false,
    };
    return require(specifier);
  };
  new Function('require', 'module', 'exports', compiled)(
    runtimeRequire,
    runtimeModule,
    runtimeModule.exports,
  );
  return {
    render(props) {
      cursor = 0;
      return runtimeModule.exports.ClientResourceWebView(props);
    },
  };
}

function descendants(node) {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children];
  return [node, ...children.flatMap(descendants)];
}

function triggerLoadError(view) {
  const webView = descendants(view).find((node) => node.type === 'WebView');
  assert.ok(webView, 'WebView did not render');
  webView.props.onError({ nativeEvent: {} });
}

function getWebView(view) {
  const webView = descendants(view).find((node) => node.type === 'WebView');
  assert.ok(webView, 'WebView did not render');
  return webView;
}

const brokerLaunch = Object.freeze({
  kind: 'broker',
  realm: 'production_client',
  expiresAtMs: 1_900_000_060_000,
  source: Object.freeze({
    uri: 'https://cabohealth.org/apps/client-resources/launch/',
    method: 'POST',
    body: 'nonce=opaque',
    headers: Object.freeze({
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    }),
  }),
});
const externalLaunch = Object.freeze({
  kind: 'external_https',
  realm: 'production_client',
  expiresAtMs: 1_900_000_060_000,
  source: Object.freeze({ uri: 'https://www.eightsleep.com/mx/' }),
  origin: 'https://www.eightsleep.com',
});

test('external VIP error renders Retry and Back actions and invokes route retry', () => {
  const runtime = loadClientResourceWebView();
  const effects = [];
  const props = {
    launch: externalLaunch,
    title: 'Sleep Resource',
    onClose: () => effects.push('back'),
    onRetry: () => effects.push('retry'),
  };
  triggerLoadError(runtime.render(props));
  const failedView = runtime.render(props);
  const actionLabels = descendants(failedView)
    .filter((node) => node.type === 'Pressable')
    .map((node) => ({
      label: descendants(node).find((child) => child.type === 'Text')?.props.children,
      onPress: node.props.onPress,
    }))
    .filter(({ label }) => label === 'common.retry' || label === 'clientAccess.backToResources');

  assert.deepEqual(actionLabels.map(({ label }) => label), [
    'common.retry',
    'clientAccess.backToResources',
  ]);
  actionLabels[0].onPress();
  actionLabels[1].onPress();
  assert.deepEqual(effects, ['retry', 'back']);
});

test('broker error keeps the unchanged Back-only behavior', () => {
  const runtime = loadClientResourceWebView();
  const props = {
    launch: brokerLaunch,
    title: 'Broker Resource',
    onClose: () => {},
    onRetry: () => assert.fail('broker exposed retry'),
  };
  triggerLoadError(runtime.render(props));
  const failedView = runtime.render(props);
  const actionLabels = descendants(failedView)
    .filter((node) => node.type === 'Pressable')
    .map((node) => descendants(node).find((child) => child.type === 'Text')?.props.children)
    .filter((label) => label === 'common.retry' || label === 'clientAccess.backToResources');

  assert.deepEqual(actionLabels, ['clientAccess.backToResources']);
});

test('external VIP WebView silently allows a safe inherited blank iframe but renders an unsafe top-frame block', () => {
  const runtime = loadClientResourceWebView();
  const props = {
    launch: externalLaunch,
    title: 'Sleep Resource',
    onClose: () => {},
    onRetry: () => {},
  };
  const safeRequest = {
    url: 'about:blank',
    isTopFrame: false,
    mainDocumentURL: 'https://www.eightsleep.com/mx/',
  };
  const unsafeRequest = {
    url: 'https://attacker.example/',
    isTopFrame: true,
    mainDocumentURL: 'https://www.eightsleep.com/mx/',
  };

  assert.equal(getWebView(runtime.render(props)).props.onShouldStartLoadWithRequest(safeRequest), true);
  assert.equal(
    descendants(runtime.render(props)).some((node) => node.props?.accessibilityRole === 'alert'),
    false,
  );
  assert.equal(getWebView(runtime.render(props)).props.onShouldStartLoadWithRequest(unsafeRequest), false);
  assert.equal(
    descendants(runtime.render(props)).some((node) => node.props?.accessibilityRole === 'alert'),
    true,
  );
});
