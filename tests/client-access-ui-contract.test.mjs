import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('home always presents the locked Client Resources folio and code modal', () => {
  const root = read('app/_layout.tsx');
  const home = read('app/(main)/index.tsx');
  const folio = read('features/clientAccess/ClientAccessFolio.tsx');
  const modal = read('features/clientAccess/ClientAccessModal.tsx');
  const provider = read('context/ClientAccessContext.tsx');
  const bootstrap = read('context/ClientAccessBootstrap.tsx');

  assert.match(root, /<ClientAccessBootstrap>/u);
  assert.match(bootstrap, /<ClientAccessProvider/u);
  assert.match(bootstrap, /loadClientAccessRuntime/u);
  assert.match(bootstrap, /runtime\?\.gateway/u);
  assert.match(home, /<ClientAccessFolio/u);
  assert.match(home, /<ClientAccessModal/u);
  assert.match(home, /t\('clientAccess\.sectionTitle'\)/u);
  assert.match(folio, /<EditorialMiniappCover/u);
  assert.match(folio, /tone="client"/u);
  assert.match(folio, /badgeIcon="lock-closed-outline"/u);
  assert.match(modal, /secureTextEntry/u);
  assert.match(provider, /createLaunch: async \(\) => null/u);
  assert.doesNotMatch(`${root}\n${home}\n${folio}\n${modal}\n${provider}\n${bootstrap}`, /firebase|firestore/iu);
  assert.doesNotMatch(`${home}\n${folio}\n${modal}\n${provider}\n${bootstrap}`, /AsyncStorage/u);
});

test('client access refreshes on foreground and never stores the submitted code', () => {
  const provider = read('context/ClientAccessContext.tsx');
  const controller = read('features/clientAccess/clientAccessController.ts');
  const modal = read('features/clientAccess/ClientAccessModal.tsx');

  assert.match(provider, /AppState\.addEventListener\('change'/u);
  assert.match(provider, /nextState === 'active'/u);
  assert.match(provider, /controller\.refresh\(\)/u);
  assert.match(modal, /const submittedCode = code;\s*setCode\(''\);/u);
  assert.match(controller, /commit\(session: OpaqueClientSession\)/u);
  assert.doesNotMatch(controller, /commit\(code/u);
});

test('development miniapps use an in-app confirmation that works on web', () => {
  const panel = read('features/devMiniapps/DevMiniappPanel.tsx');

  assert.doesNotMatch(panel, /Alert\.alert|\bAlert,/u);
  assert.match(panel, /removeCandidate/u);
  assert.match(panel, /onRemove\(removeCandidate\.id\)/u);
});

test('unlocked resources request an ephemeral launch and render only in the restricted client WebView', () => {
  const modal = read('features/clientAccess/ClientAccessModal.tsx');
  const clientWebView = read('features/clientAccess/ClientResourceWebView.tsx');
  const navigation = read('features/clientAccess/clientResourceNavigation.ts');
  const sharedWebViewSecurity = read('features/launch/restrictedWebViewBehavior.ts');
  const controller = read('features/clientAccess/clientAccessController.ts');
  const appConfig = JSON.parse(read('app.json'));

  assert.match(modal, /createLaunch\(resource\.id\)/u);
  assert.match(modal, /<ClientResourceWebView/u);
  assert.match(modal, /status !== 'unlocked'[^]*setActiveLaunch\(null\)/u);
  assert.match(clientWebView, /<WebView/u);
  assert.match(clientWebView, /classifyClientResourceNavigation\(request\.url\)/u);
  assert.match(clientWebView, /getClientResourceWebViewPolicyProps/u);
  assert.match(navigation, /RESTRICTED_WEBVIEW_SECURITY_PROPS/u);
  assert.match(sharedWebViewSecurity, /limitsNavigationsToAppBoundDomains: true/u);
  assert.match(navigation, /originWhitelist: \['https:\/\/cabohealth\.org'\]/u);
  assert.deepEqual(appConfig.expo.ios.infoPlist.WKAppBoundDomains, ['cabohealth.org']);
  assert.doesNotMatch(`${modal}\n${clientWebView}\n${controller}`, /Linking|Share|onMessage|injectedJavaScript/iu);
  assert.doesNotMatch(controller, /private\.example|targetUrl|destinationUrl/iu);
});
