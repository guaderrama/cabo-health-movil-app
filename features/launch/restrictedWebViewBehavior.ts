import type { CatalogPublicMiniapp } from '../../constants/publicMiniapps';
import {
  classifyMiniappNavigation,
  EMBEDDED_PRESENTATION_FRAGMENTS,
  type NavigationDecision,
} from './navigationPolicy';

export interface NavigationEffects {
  openExternal: (url: string) => void;
  showError: () => void;
}

export const RESTRICTED_WEBVIEW_SECURITY_PROPS = Object.freeze({
  originWhitelist: ['*'],
  javaScriptEnabled: true,
  domStorageEnabled: true,
  mixedContentMode: 'never' as const,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  javaScriptCanOpenWindowsAutomatically: false,
  setSupportMultipleWindows: true,
  sharedCookiesEnabled: false,
  thirdPartyCookiesEnabled: false,
  limitsNavigationsToAppBoundDomains: true,
  mediaCapturePermissionGrantType: 'deny' as const,
  geolocationEnabled: false,
});

export function applyNavigationDecision(
  decision: NavigationDecision,
  url: string,
  effects: NavigationEffects,
): boolean {
  if (decision.decision === 'allow-webview') return true;
  if (decision.decision === 'open-external') {
    effects.openExternal(url);
    return false;
  }
  effects.showError();
  return false;
}

export function applyPopupNavigation(input: {
  slug: string;
  miniapp?: Readonly<CatalogPublicMiniapp>;
  targetUrl: string;
  platform: string;
  effects: NavigationEffects;
}): boolean {
  const decision = classifyMiniappNavigation({
    slug: input.slug,
    miniapp: input.miniapp,
    url: input.targetUrl,
    platform: input.platform,
    navigationType: 'other',
    isTopFrame: false,
    isPopup: true,
  });
  return applyNavigationDecision(decision, input.targetUrl, input.effects);
}

export function handleRestrictedWebViewBack(router: {
  canGoBack: () => boolean;
  back: () => void;
  replace: (route: '/(main)') => void;
}): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)');
  }
}

export function getRestrictedWebViewSource(
  miniapp: Readonly<CatalogPublicMiniapp>,
  {
    language = 'en',
    reduceMotion = false,
  }: Readonly<{ language?: 'en' | 'es-MX'; reduceMotion?: boolean }> = {},
) {
  const fragment = EMBEDDED_PRESENTATION_FRAGMENTS[`${language}:${reduceMotion ? 'reduced' : 'standard'}`];
  if (!fragment) throw new Error('Unsupported embedded miniapp presentation');
  return { uri: `${miniapp.canonicalUrl}${fragment}` };
}

export function getRestrictedWebViewPolicyProps<ShouldStart, OpenWindow>(
  miniapp: Readonly<CatalogPublicMiniapp>,
  callbacks: Readonly<{
    onShouldStartLoadWithRequest: ShouldStart;
    onOpenWindow: OpenWindow;
  }>,
  presentation: Readonly<{ language?: 'en' | 'es-MX'; reduceMotion?: boolean }> = {},
) {
  return {
    source: getRestrictedWebViewSource(miniapp, presentation),
    onShouldStartLoadWithRequest: callbacks.onShouldStartLoadWithRequest,
    onOpenWindow: callbacks.onOpenWindow,
    ...RESTRICTED_WEBVIEW_SECURITY_PROPS,
  };
}

export function getRestrictedSharePayload(
  miniapp: Readonly<CatalogPublicMiniapp>,
  title: string,
) {
  return {
    title,
    message: `${title}: ${miniapp.universalLink}`,
    url: miniapp.universalLink,
  };
}
