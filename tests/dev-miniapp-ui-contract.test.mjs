import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('the miniapp test panel is development-only and has no Expo admin route', () => {
  const home = read('app/(main)/index.tsx');
  const panel = read('features/devMiniapps/DevMiniappPanel.tsx');
  const preview = read('features/devMiniapps/DevMiniappPreview.tsx');

  assert.equal(existsSync('app/(main)/admin.tsx'), false);
  assert.match(home, /devCatalog\.enabled \?/u);
  assert.match(home, /delayLongPress=\{900\}/u);
  assert.match(home, /logoTapCount\.current >= 5/u);
  assert.match(panel, /if \(!isDevMiniappPanelEnabled\(__DEV__\)\) return null;/u);
  assert.match(preview, /if \(!isDevMiniappPanelEnabled\(__DEV__\) \|\| !miniapp\) return null;/u);
});

test('the test WebView uses the restricted policy without a native bridge', () => {
  const preview = read('features/devMiniapps/DevMiniappPreview.tsx');
  assert.match(preview, /classifyDevMiniappNavigation\(miniapp\.url, request\.url\)/u);
  assert.match(preview, /\.\.\.RESTRICTED_WEBVIEW_SECURITY_PROPS/u);
  assert.doesNotMatch(preview, /onMessage|injectedJavaScript|nativeConfig/u);
});

test('the test panel contains no legacy PIN, Firebase authority, or client-code promise', () => {
  const sources = [
    read('features/devMiniapps/DevMiniappPanel.tsx'),
    read('features/devMiniapps/useDevMiniapps.ts'),
    read('features/devMiniapps/devMiniappStore.ts'),
  ].join('\n');
  assert.doesNotMatch(sources, /ADMIN_PIN|master.?code|firebase|firestore|access_codes/iu);
  assert.match(read('i18n/messages.ts'), /Client codes and server protection are not active yet\./u);
});
