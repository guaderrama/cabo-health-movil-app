import type { PublicMiniapp, PublicMiniappSlug } from '../../constants/publicMiniapps';
import {
  classifyMiniappNavigation,
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
  slug: PublicMiniappSlug;
  targetUrl: string;
  platform: string;
  effects: NavigationEffects;
}): boolean {
  const decision = classifyMiniappNavigation({
    slug: input.slug,
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

export function getRestrictedWebViewSource(miniapp: Readonly<PublicMiniapp>) {
  return { uri: miniapp.canonicalUrl };
}

export function getRestrictedSharePayload(
  miniapp: Readonly<PublicMiniapp>,
  title: string,
) {
  return {
    title,
    message: `${title}: ${miniapp.universalLink}`,
    url: miniapp.universalLink,
  };
}
