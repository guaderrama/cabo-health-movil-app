import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const read = (path) => readFileSync(path, 'utf8');

function sourceFilesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(candidate);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [candidate] : [];
  });
}

function resolveSourceImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = resolve(dirname(importer), specifier);
  const candidates = [
    absolute,
    `${absolute}.ts`,
    `${absolute}.tsx`,
    `${absolute}.js`,
    `${absolute}.jsx`,
    join(absolute, 'index.ts'),
    join(absolute, 'index.tsx'),
    join(absolute, 'index.js'),
    join(absolute, 'index.jsx'),
  ];
  return candidates.find((candidate) => (
    existsSync(candidate) && statSync(candidate).isFile()
  )) ?? null;
}

function productionAppSourceGraph() {
  const pending = sourceFilesBelow('app').map((path) => resolve(path));
  const visited = new Set();
  const dependencyPattern = /(?:\b(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?|\brequire\s*\()\s*['"]([^'"]+)['"]/gu;

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (!sourcePath || visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const source = readFileSync(sourcePath, 'utf8');
    for (const match of source.matchAll(dependencyPattern)) {
      const dependency = resolveSourceImport(sourcePath, match[1]);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }

  return [...visited].map((path) => relative(process.cwd(), path)).sort();
}

test('the miniapp test panel source is absent from the production app graph and global messages', () => {
  const home = read('app/(main)/index.tsx');
  const globalMessages = read('i18n/messages.ts');
  const devMessages = read('features/devMiniapps/devMiniappMessages.ts');
  const panel = read('features/devMiniapps/DevMiniappPanel.tsx');
  const preview = read('features/devMiniapps/DevMiniappPreview.tsx');
  const productionGraph = productionAppSourceGraph();

  assert.equal(existsSync('app/(main)/admin.tsx'), false);
  assert.doesNotMatch(home, /devMiniapps|DevMiniapp|devPanel|home\.testMiniapps/u);
  assert.equal(
    productionGraph.some((path) => path.startsWith('features/devMiniapps/')),
    false,
    `development source entered the production graph:\n${productionGraph.join('\n')}`,
  );
  assert.doesNotMatch(globalMessages, /devPanel\.|home\.testMiniapps|Miniapp test panel|Panel de prueba de miniapps/u);
  assert.match(devMessages, /DEV_MINIAPP_FEATURE_MARKER = 'development-source-only'/u);
  assert.match(devMessages, /Production client access is managed separately through verified codes\./u);
  assert.match(panel, /if \(!isDevMiniappPanelEnabled\(__DEV__\)\) return null;/u);
  assert.match(preview, /if \(!isDevMiniappPanelEnabled\(__DEV__\) \|\| !miniapp\) return null;/u);
});

test('the test WebView uses the restricted policy without a native bridge', () => {
  const preview = read('features/devMiniapps/DevMiniappPreview.tsx');
  assert.match(preview, /classifyDevMiniappNavigation\(miniapp\.url, request\.url\)/u);
  assert.match(preview, /\.\.\.DEV_MINIAPP_WEBVIEW_SECURITY_PROPS/u);
  assert.match(preview, /limitsNavigationsToAppBoundDomains: false/u);
  assert.doesNotMatch(preview, /onMessage|injectedJavaScript|nativeConfig/u);
});

test('the test panel contains no legacy PIN, Firebase authority, or client-code promise', () => {
  const sources = [
    read('features/devMiniapps/DevMiniappPanel.tsx'),
    read('features/devMiniapps/useDevMiniapps.ts'),
    read('features/devMiniapps/devMiniappStore.ts'),
  ].join('\n');
  assert.doesNotMatch(sources, /ADMIN_PIN|master.?code|firebase|firestore|access_codes/iu);
  assert.match(read('features/devMiniapps/devMiniappMessages.ts'), /Production client access is managed separately through verified codes\./u);
});

test('the test panel offers a reviewed icon picker and cards render the stored choice', () => {
  const panel = read('features/devMiniapps/DevMiniappPanel.tsx');
  const tile = read('features/devMiniapps/DevMiniappTile.tsx');
  const catalog = read('features/devMiniapps/devMiniappCatalog.ts');
  const cover = read('components/EditorialMiniappCover.tsx');
  const brandIcon = read('components/icons/CaboHealthMiniappIcon.tsx');

  assert.match(catalog, /DEV_MINIAPP_ICONS/u);
  assert.match(panel, /accessibilityRole="radiogroup"/u);
  assert.match(panel, /IconChoice/u);
  assert.match(panel, /update\('icon', icon\)/u);
  assert.match(panel, /form\.icon \?\? DEFAULT_DEV_MINIAPP_ICON/u);
  assert.match(tile, /icon=\{miniapp\.icon\}/u);
  assert.match(panel, /CaboHealthMiniappIcon/u);
  assert.match(cover, /CaboHealthMiniappIcon/u);
  assert.doesNotMatch(panel, /<Ionicons name=\{miniapp\.icon\}/u);
  assert.doesNotMatch(panel, /<Ionicons name=\{icon\}/u);
  assert.doesNotMatch(cover, /<Ionicons name=\{icon\}/u);
  assert.match(brandIcon, /primary.*secondary.*accent/su);
  for (const icon of [
    'flask-outline',
    'book-outline',
    'leaf-outline',
    'restaurant-outline',
    'heart-outline',
    'map-outline',
    'chatbubble-ellipses-outline',
    'sparkles-outline',
  ]) {
    assert.match(brandIcon, new RegExp(`'${icon}'`, 'u'));
  }
});
