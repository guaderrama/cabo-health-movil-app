import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('home presents locked client previews and keeps a safe access-management fallback', () => {
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
  assert.match(home, /<ClientMiniappTile/u);
  assert.match(home, /clientCard\.locked/u);
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

test('a locked client card requests a code while an unlocked card launches that exact resource', () => {
  const home = read('app/(main)/index.tsx');
  const tile = read('features/clientAccess/ClientMiniappTile.tsx');
  const modal = read('features/clientAccess/ClientAccessModal.tsx');

  assert.match(home, /clientCard\.locked[^]*setClientAccessVisible\(true\)/u);
  assert.match(home, /clientCard\.locked[^]*setClientCodeEntryRequested\(true\)/u);
  assert.match(home, /setRequestedClientResourceId\(clientCard\.id\)/u);
  assert.match(home, /codeEntryRequested=\{clientCodeEntryRequested\}/u);
  assert.match(tile, /tone="client"/u);
  assert.match(tile, /badgeIcon=\{card\.locked \? 'lock-closed-outline' : undefined\}/u);
  assert.match(tile, /card\.locked\s*\?\s*t\('clientAccess\.enterCode'\)\s*:\s*t\('clientAccess\.openResource'\)/u);
  assert.match(tile, /clientAccess\.requiresAccess/u);
  assert.match(modal, /requestedResourceId/u);
  assert.match(modal, /codeEntryRequested \|\| !unlocked/u);
  assert.match(modal, /onRedeemed\?\.\(\)/u);
});

test('an exact card launch has an isolated loading and retry surface, separate from access management', () => {
  const modal = read('features/clientAccess/ClientAccessModal.tsx');
  const requestedCardStart = modal.indexOf('function RequestedResourceLaunchCard');
  const deletionCardStart = modal.indexOf('function DeletionStatusCard');

  assert.match(modal, /requestedResourceId !== null\s*\?\s*\(\s*<RequestedResourceLaunchCard/u);
  assert.match(modal, /status !== 'unlocked'[^]*requestedResourceHandled\.current = null[^]*setActiveLaunch\(null\)/u);
  assert.match(modal, /resolveRequestedResourceLaunchState/u);
  assert.equal(requestedCardStart >= 0, true);
  assert.equal(deletionCardStart > requestedCardStart, true);
  const requestedCard = modal.slice(requestedCardStart, deletionCardStart);
  assert.match(requestedCard, /ActivityIndicator/u);
  assert.match(requestedCard, /clientAccess\.launchUnavailable/u);
  assert.match(requestedCard, /common\.retry/u);
  assert.doesNotMatch(requestedCard, /removeAccess|deleteAccount|resourceList/u);
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
  assert.match(clientWebView, /classifyClientResourceNavigation\(request\.url, launch\.realm\)/u);
  assert.match(clientWebView, /getClientResourceWebViewPolicyProps/u);
  assert.match(navigation, /RESTRICTED_WEBVIEW_SECURITY_PROPS/u);
  assert.match(sharedWebViewSecurity, /limitsNavigationsToAppBoundDomains: true/u);
  assert.match(navigation, /originWhitelist: \['https:\/\/cabohealth\.org'\]/u);
  assert.deepEqual(appConfig.expo.ios.infoPlist.WKAppBoundDomains, ['cabohealth.org']);
  assert.doesNotMatch(
    `${modal}\n${clientWebView}\n${controller}`,
    /\bLinking\b|\bShare\b|onMessage\s*=|injectedJavaScript\s*=/iu,
  );
  assert.doesNotMatch(controller, /private\.example|targetUrl|destinationUrl/iu);
});

test('one secret field consumes CH or AR while App Review exposes isolated durable account deletion', () => {
  const modal = read('features/clientAccess/ClientAccessModal.tsx');
  const controller = read('features/clientAccess/clientAccessController.ts');
  const adapter = read('features/clientAccess/firebaseClientAccessAdapter.ts');
  const nativeSources = `${modal}\n${controller}\n${adapter}`;

  assert.equal((modal.match(/<TextInput\b/gu) ?? []).length, 1);
  assert.match(modal, /secureTextEntry/u);
  assert.match(controller, /\^\(CH\|AR\)/u);
  assert.match(adapter, /redeemAppReviewCredential/u);
  assert.match(adapter, /refreshAppReviewAccess/u);
  assert.match(adapter, /createAppReviewLaunch/u);
  assert.match(adapter, /deleteAppReviewAccount/u);
  assert.match(modal, /!isReviewGrant[^]*clientAccess\.removeAccess/u);
  assert.match(modal, /isReviewGrant[^]*clientAccess\.deleteReviewAccount/u);
  assert.match(modal, /reviewDeleting[^]*clientAccess\.confirmDeleteReviewTitle/u);
  assert.match(modal, /deletionTracking\.kind !== 'none'/u);
  assert.match(modal, /clientAccess\.deletionPendingBody/u);
  assert.match(modal, /clientAccess\.deletionCompletedBody/u);
  assert.match(modal, /deletionError[^]*clientAccess\.deleteUnavailable/u);
  assert.match(modal, /resource\.iconKey === 'featured'[^]*sparkles-outline/u);
  assert.doesNotMatch(nativeSources, /AsyncStorage|console\.|\blog(?:ger)?\b/iu);
});

test('remove and delete copy disclose the durable backend deletion and local-installation difference', () => {
  const messages = read('i18n/messages.ts');
  const adapter = read('features/clientAccess/firebaseClientAccessAdapter.ts');

  assert.match(messages, /Removing access revokes authorization and queues deletion of the pseudonymous access account and linked records\./u);
  assert.match(messages, /Quitar el acceso revoca la autorización y pone en cola la eliminación de la cuenta seudónima de acceso y sus registros vinculados\./u);
  assert.match(messages, /Delete also removes this app installation identifier from your iPhone\./u);
  assert.match(messages, /Eliminar también borra de tu iPhone el identificador de esta instalación de la app\./u);
  assert.match(adapter, /removeAccess:[^]*functions\.call\('removeClientAccess'/u);
  assert.match(adapter, /deleteAccount:[^]*principal\.realm === 'production_client'[^]*'deleteClientAccount'[^]*'deleteAppReviewAccount'/u);
  assert.match(adapter, /const cleanupAccountDeletion[^]*installation\.clear\(\)[^]*auth\.signOut\(\)[^]*cleanupAccountDeletion,/u);
});

test('the destructive confirmation isolates VoiceOver from the controls behind it', () => {
  const modal = read('features/clientAccess/ClientAccessModal.tsx');

  assert.match(modal, /accessibilityElementsHidden=\{confirmAction !== null\}/u);
  assert.match(modal, /importantForAccessibility=\{confirmAction !== null \? 'no-hide-descendants' : 'auto'\}/u);
  assert.match(modal, /accessibilityViewIsModal/u);
});

test('durable deletion receipts are polled before session restore and remain user-verifiable', () => {
  const bootstrap = read('context/ClientAccessBootstrap.tsx');
  const provider = read('context/ClientAccessContext.tsx');
  const modal = read('features/clientAccess/ClientAccessModal.tsx');
  const messages = read('i18n/messages.ts');
  const support = read('features/clientAccess/clientAccessSupport.ts');

  assert.match(bootstrap, /deletionTracker=\{runtime\?\.deletionTracker\}/u);
  assert.match(provider, /deletionTracker\.check\(\)[^]*controller\.initialize\(\)/u);
  assert.match(provider, /nextState === 'active'[^]*checkDeletionStatus/u);
  assert.match(modal, /clientAccess\.checkDeletionStatus/u);
  assert.match(modal, /expectedCompletionByMs/u);
  assert.match(modal, /clientAccess\.deletionOverdueBody/u);
  assert.match(modal, /openClientAccessSupport\(\)/u);
  assert.match(support, /Linking\.openURL\(config\.urls\.support\)/u);
  assert.match(modal, /clientAccess\.deletionSupport/u);
  assert.match(modal, /acknowledgeDeletionCompletion/u);
  assert.match(modal, /archiveDeletionReceipt/u);
  assert.match(messages, /normally retries about every five minutes/u);
  assert.match(messages, /normalmente reintenta la eliminación aproximadamente cada cinco minutos/u);
  assert.match(messages, /Completion is expected by/u);
  assert.match(messages, /Se espera que termine antes del/u);
  assert.doesNotMatch(messages, /guaranteed|garantizad[oa]/iu);
});
