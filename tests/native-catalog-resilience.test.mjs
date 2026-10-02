import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = process.cwd();

// Node has no native renderer. Keep application components/branching real,
// replacing only native surfaces and context values at their public boundaries.
function createScreenHarness({ language = 'en' } = {}) {
  const cache = new Map();
  let refreshes = 0;
  const catalog = {
    catalogMiniapps: [], clientPreviews: [], apps: [], favoriteApps: [], nonFavoriteApps: [],
    isLoading: false, isInitialLoading: false, error: null, isOffline: false,
    refresh: async () => { refreshes += 1; },
  };
  const favorites = {
    favorites: ['healthy-recipes'], isFavorite: () => true, toggleFavorite: async () => true,
  };
  const native = Object.fromEntries([
    'View', 'Text', 'Pressable', 'ScrollView', 'RefreshControl', 'Image', 'ActivityIndicator',
  ].map((name) => [name, name]));
  const colors = new Proxy({}, { get: () => '#123456' });
  const translations = () => ({ language, t: (key) => load('i18n/messages.ts').translateMessage(language, key) });
  const nativeModules = {
    react: {
      ...require('react'),
      useCallback: (callback) => callback,
      useMemo: (factory) => factory(),
      useRef: (value) => ({ current: value }),
      useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    },
    'react-native': {
      ...native, Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) },
    'react-native-webview': { WebView: 'WebView' },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'expo-router': {
      useLocalSearchParams: () => ({ slug: 'healthy-recipes' }),
      useRouter: () => ({ push() {}, back() {}, replace() {}, canGoBack: () => true }),
    },
  };
  const localModules = {
    hooks: {
      useTheme: () => ({ colors, isDark: false }), useTranslations: translations,
      useFavorites: () => favorites, useWebApps: () => catalog,
      usePreferences: () => ({ reduceMotion: false }),
    },
    components: {
      BrandedBackground: 'Background', PremiumMiniappTile: 'ResourceTile',
      PremiumResourceRow: 'ResourceRow', LoadingIndicator: 'LoadingIndicator',
    },
    'context/ClientAccessContext': {
      useClientAccess: () => ({ status: 'locked', grant: null, refresh: async () => {} }),
    },
    'context/PublicCatalogContext': {
      usePublicCatalog: () => ({
        ...catalog, miniapps: catalog.catalogMiniapps,
        getMiniapp: (slug) => catalog.catalogMiniapps.find((item) => item.slug === slug),
      }),
    },
    'features/clientAccess/ClientAccessModal': { ClientAccessModal: 'ClientAccessModal' },
    'features/clientAccess/ClientAccessFolio': { ClientAccessFolio: 'ClientAccessFolio' },
    'features/clientAccess/ClientMiniappTile': { ClientMiniappTile: 'ClientMiniappTile' },
    'app/+not-found': { __esModule: true, default: () => 'NotFound' },
  };
  function load(relativePath) {
    const path = resolve(root, relativePath);
    const stubKey = path.slice(root.length + 1).replace(/\.(?:tsx?|json)$/u, '');
    if (Object.hasOwn(localModules, stubKey)) return localModules[stubKey];
    if (cache.has(path)) return cache.get(path);
    if (path.endsWith('.png')) return path;
    if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
    const filename = [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(existsSync);
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const exports = {};
    cache.set(path, exports);
    new Function('require', 'exports', compiled)((name) => {
      if (Object.hasOwn(nativeModules, name)) return nativeModules[name];
      return name.startsWith('.') ? load(resolve(dirname(filename), name)) : require(name);
    }, exports);
    return exports;
  }
  function expand(element) {
    if (Array.isArray(element)) return element.flatMap(expand);
    if (!element || typeof element !== 'object') return element;
    if (typeof element.type === 'function') return expand(element.type(element.props));
    return { ...element, props: { ...element.props, children: expand(element.props.children) } };
  }
  const render = (path) => expand(load(path).default());
  return { catalog, favorites, load, render, refreshes: () => refreshes };
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join(' ');
  if (!tree || typeof tree !== 'object') return typeof tree === 'string' ? tree : '';
  return textContent(tree.props.children);
}

test('an unchanged authorized public page remains mounted during a foreground catalog refresh', () => {
  const harness = createScreenHarness();
  harness.catalog.catalogMiniapps = harness.load('constants/publicMiniapps.ts').PUBLIC_MINIAPPS;
  const Route = harness.load('app/apps/[slug].tsx').default;
  const ready = Route();
  harness.catalog.isLoading = true;
  assert.equal(Route().type, ready.type, 'background refresh must not replace the active WebView');
  harness.catalog.isLoading = false;
  harness.catalog.error = 'catalog-refresh-unavailable';
  assert.equal(Route().type, ready.type, 'failed refresh must retain an already authorized page');
  harness.catalog.catalogMiniapps = [];
  assert.notEqual(Route().type, ready.type, 'actual catalog removal must still close the page');
});

for (const language of ['en', 'es-MX']) {
  for (const screen of ['app/(main)/index.tsx', 'app/(main)/saved.tsx']) {
    test(`${screen} explains a cold catalog failure and visibly retries in ${language}`, async () => {
      const harness = createScreenHarness({ language });
      harness.catalog.error = 'catalog-refresh-unavailable';
      const failed = harness.render(screen);
      const alerts = nodes(failed, (node) => node.props.accessibilityRole === 'alert');
      assert.equal(alerts.length, 1, 'a failed catalog must not look like an empty collection');
      assert.match(textContent(alerts[0]), language === 'en' ? /could not be loaded/u : /No se pudieron cargar/u);
      assert.doesNotMatch(textContent(failed), /Nothing saved yet|Aún no hay nada guardado/u);
      const retry = nodes(alerts[0], (node) => node.props.accessibilityRole === 'button')[0];
      assert.ok(retry, 'recovery must be visible without discovering pull-to-refresh');
      assert.equal(retry.props.accessibilityLabel, language === 'en' ? 'Try again' : 'Intentar de nuevo');
      await retry.props.onPress();
      assert.equal(harness.refreshes(), 1);

      harness.catalog.isLoading = true;
      const loading = harness.render(screen);
      const pendingRetry = nodes(loading, (node) => node.props.accessibilityRole === 'button'
        && node.props.accessibilityState?.busy === true)[0];
      assert.equal(pendingRetry?.props.disabled, true, 'do not invite duplicate retries');

      harness.catalog.isLoading = false;
      harness.catalog.error = null;
      harness.catalog.catalogMiniapps = harness.load('constants/publicMiniapps.ts').PUBLIC_MINIAPPS;
      const recovered = harness.render(screen);
      assert.equal(nodes(recovered, (node) => node.props.accessibilityRole === 'alert').length, 0);
      assert.ok(nodes(recovered, (node) => node.type === 'ResourceTile' || node.type === 'ResourceRow').length > 0);
    });
  }
}

test('catalog refresh failure keeps cached Home and Saved resources visible alongside recovery', () => {
  const harness = createScreenHarness();
  harness.catalog.catalogMiniapps = harness.load('constants/publicMiniapps.ts').PUBLIC_MINIAPPS;
  harness.catalog.error = 'catalog-refresh-unavailable';
  for (const screen of ['app/(main)/index.tsx', 'app/(main)/saved.tsx']) {
    const rendered = harness.render(screen);
    assert.equal(nodes(rendered, (node) => node.props.accessibilityRole === 'alert').length, 1);
    assert.ok(nodes(rendered, (node) => node.type === 'ResourceTile' || node.type === 'ResourceRow').length > 0);
  }
});

test('Saved does not claim to show cached resources when no saved resource is available', () => {
  const harness = createScreenHarness();
  harness.catalog.catalogMiniapps = harness.load('constants/publicMiniapps.ts').PUBLIC_MINIAPPS;
  harness.favorites.favorites = ['previously-published-resource'];
  harness.catalog.error = 'catalog-refresh-unavailable';
  const rendered = harness.render('app/(main)/saved.tsx');
  assert.equal(nodes(rendered, (node) => node.type === 'ResourceRow').length, 0);
  assert.doesNotMatch(textContent(rendered), /resources are still shown/u);
});

test('iOS build configuration lets the offered System theme receive the system appearance', () => {
  const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
  const { setUserInterfaceStyle } = require('@expo/prebuild-config/build/plugins/unversioned/expo-system-ui/withIosUserInterfaceStyle');
  const plist = setUserInterfaceStyle(expo, expo.ios.infoPlist);
  assert.equal(plist.UIUserInterfaceStyle, 'Automatic');
});
