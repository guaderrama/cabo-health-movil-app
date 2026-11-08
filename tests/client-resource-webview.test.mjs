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

for (const launch of [brokerLaunch, externalLaunch]) {
  for (const terminationEvent of ['onContentProcessDidTerminate', 'onRenderProcessGone']) {
    test(`${launch.kind} process termination stops loading and preserves the authorized recovery path (${terminationEvent})`, () => {
      const runtime = loadClientResourceWebView();
      const effects = [];
      const props = {
        launch,
        title: 'Client Resource',
        onClose: () => effects.push('back'),
        onRetry: () => effects.push('retry'),
      };
      const initial = runtime.render(props);
      const webView = getWebView(initial);
      assert.equal(typeof webView.props[terminationEvent], 'function', 'process death needs a recovery handler');
      webView.props[terminationEvent]({ nativeEvent: { didCrash: true } });

      const failed = runtime.render(props);
      const alert = descendants(failed).find((node) => node.props?.accessibilityRole === 'alert');
      assert.ok(alert, 'a terminated page must not stay blank');
      assert.ok(descendants(alert).some((node) => node.type === 'Text'
        && node.props.children === 'clientAccess.launchUnavailable'));
      assert.equal(descendants(failed).some((node) => node.type === 'ActivityIndicator'
        || node.props?.accessibilityRole === 'progressbar'), false);
      assert.deepEqual(effects, [], 'termination neither retries nor closes an active session automatically');
      assert.equal(getWebView(failed).key, webView.key, 'do not remount a consumed broker launch');
      assert.equal(getWebView(failed).props.source, launch.source, 'do not replace the authorized launch');

      const retry = descendants(alert).find((node) => node.type === 'Pressable'
        && descendants(node).some((child) => child.type === 'Text' && child.props.children === 'common.retry'));
      assert.ok(retry, 'retry must ask the route for fresh authorization and a new launch');
      retry.props.onPress();
      assert.deepEqual(effects, ['retry']);
      assert.equal(getWebView(runtime.render(props)).props.source, launch.source,
        'the WebView must delegate recovery instead of replaying the POST itself');
      const back = descendants(alert).find((node) => node.type === 'Pressable'
        && descendants(node).some((child) => child.type === 'Text'
          && child.props.children === 'clientAccess.backToResources'));
      assert.ok(back);
      back.props.onPress();
      assert.deepEqual(effects, ['retry', 'back']);
    });
  }
}

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

test('broker HTTP rejection offers a fresh route launch without replaying the consumed POST', () => {
  const runtime = loadClientResourceWebView();
  const effects = [];
  const props = {
    launch: brokerLaunch,
    title: 'Broker Resource',
    onClose: () => {},
    onRetry: () => effects.push('fresh-launch'),
  };
  getWebView(runtime.render(props)).props.onHttpError({ nativeEvent: { statusCode: 403 } });
  const failedView = runtime.render(props);
  const actionLabels = descendants(failedView)
    .filter((node) => node.type === 'Pressable')
    .map((node) => descendants(node).find((child) => child.type === 'Text')?.props.children)
    .filter((label) => label === 'common.retry' || label === 'clientAccess.backToResources');

  assert.deepEqual(actionLabels, ['common.retry', 'clientAccess.backToResources']);
  const retry = descendants(failedView).find((node) => node.type === 'Pressable'
    && descendants(node).some((child) => child.props?.children === 'common.retry'));
  retry.props.onPress();
  assert.deepEqual(effects, ['fresh-launch']);
  assert.equal(getWebView(runtime.render(props)).props.source, brokerLaunch.source);
});

test('external VIP loading shows nonblocking accessible progress and removes it on load end', () => {
  const runtime = loadClientResourceWebView();
  const props = {
    launch: externalLaunch,
    title: 'Sleep Resource',
    onClose: () => {},
    onRetry: () => {},
  };

  const initialView = runtime.render(props);
  const initialProgress = descendants(initialView).find(
    (node) => node.props?.accessibilityRole === 'progressbar',
  );
  assert.ok(initialProgress, 'external VIP launch renders an accessible progressbar');
  assert.equal(initialProgress.props.accessibilityLabel, 'clientAccess.openingResource');
  assert.equal(initialProgress.props.accessibilityValue?.now, 0);
  assert.equal(
    descendants(initialView).some(
      (node) => node.type === 'Text' && node.props.children === 'clientAccess.openingResource',
    ),
    false,
  );

  getWebView(initialView).props.onLoadProgress({ nativeEvent: { progress: 0.42 } });
  const progressingView = runtime.render(props);
  const progressingProgress = descendants(progressingView).find(
    (node) => node.props?.accessibilityRole === 'progressbar',
  );
  assert.equal(progressingProgress?.props.accessibilityValue?.now, 42);

  getWebView(progressingView).props.onLoadEnd();
  const loadedView = runtime.render(props);
  assert.equal(
    descendants(loadedView).some((node) => node.props?.accessibilityRole === 'progressbar'),
    false,
  );
});

test('broker loading keeps the existing blocking loader overlay', () => {
  const runtime = loadClientResourceWebView();
  const view = runtime.render({
    launch: brokerLaunch,
    title: 'Broker Resource',
    onClose: () => {},
    onRetry: () => {},
  });

  assert.equal(descendants(view).some((node) => node.type === 'ActivityIndicator'), true);
  assert.equal(
    descendants(view).some(
      (node) => node.type === 'Text' && node.props.children === 'clientAccess.openingResource',
    ),
    true,
  );
  assert.equal(
    descendants(view).some((node) => node.props?.accessibilityRole === 'progressbar'),
    false,
  );
  assert.equal(
    getWebView(view).props.onLoadProgress,
    undefined,
    'broker loading does not subscribe to unused progress events',
  );
});

test('external VIP WebView silently applies a rejected subframe without an alert, then renders an unsafe top-frame block', () => {
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
  const unsafeSubframeRequest = {
    url: 'https://attacker.example/',
    isTopFrame: false,
    mainDocumentURL: 'https://www.eightsleep.com/mx/',
  };

  assert.equal(getWebView(runtime.render(props)).props.onShouldStartLoadWithRequest(safeRequest), true);
  assert.equal(
    descendants(runtime.render(props)).some((node) => node.props?.accessibilityRole === 'alert'),
    false,
  );
  assert.equal(
    getWebView(runtime.render(props)).props.onShouldStartLoadWithRequest(unsafeSubframeRequest),
    false,
  );
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
