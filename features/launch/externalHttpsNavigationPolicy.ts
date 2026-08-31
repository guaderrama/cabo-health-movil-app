import type { SafeExternalHttpsDestination } from './externalHttpsUrlPolicy';
import {
  isSafeSameOriginExternalNavigation,
  parseSafeExternalHttpsDestination,
} from './externalHttpsUrlPolicy';

export type ExternalHttpsNavigationDecision = Readonly<
  | { decision: 'allow'; reason: 'safe-same-origin' }
  | { decision: 'allow'; reason: 'safe-inherited-subframe' }
  | {
    decision: 'block';
    reason: 'unsafe-or-cross-origin';
    presentation: 'error' | 'silent';
  }
>;

export interface ExternalHttpsNavigationRequest {
  readonly url: string;
  readonly isTopFrame?: boolean;
  readonly mainDocumentURL?: string;
}

export interface ExternalHttpsNavigationEffects {
  showError: () => void;
}

export const EXTERNAL_HTTPS_WEBVIEW_SECURITY_PROPS = Object.freeze({
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
  limitsNavigationsToAppBoundDomains: false,
  mediaCapturePermissionGrantType: 'deny' as const,
  geolocationEnabled: false,
  allowsLinkPreview: false,
});

export function classifyExternalHttpsNavigation(
  value: string,
  expectedOrigin: string,
): ExternalHttpsNavigationDecision {
  return classifyExternalHttpsNavigationRequest({ url: value }, expectedOrigin);
}

export function classifyExternalHttpsNavigationRequest(
  request: Readonly<ExternalHttpsNavigationRequest>,
  expectedOrigin: string,
): ExternalHttpsNavigationDecision {
  if (isSafeSameOriginExternalNavigation(request.url, expectedOrigin)) {
    return Object.freeze({ decision: 'allow', reason: 'safe-same-origin' });
  }
  if (
    request.url === 'about:blank'
    && request.isTopFrame === false
    && typeof request.mainDocumentURL === 'string'
    && isSafeSameOriginExternalNavigation(request.mainDocumentURL, expectedOrigin)
  ) {
    return Object.freeze({ decision: 'allow', reason: 'safe-inherited-subframe' });
  }
  return Object.freeze({
    decision: 'block',
    reason: 'unsafe-or-cross-origin',
    presentation: request.isTopFrame === false ? 'silent' : 'error',
  });
}

export function applyExternalHttpsNavigationDecision(
  decision: ExternalHttpsNavigationDecision,
  effects: ExternalHttpsNavigationEffects,
): boolean {
  if (decision.decision === 'allow') return true;
  if (decision.presentation === 'error') effects.showError();
  return false;
}

export function handleExternalPopup(
  _targetUrl: string,
  effects: ExternalHttpsNavigationEffects,
): false {
  effects.showError();
  return false;
}

export function getExternalHttpsWebViewSource(
  destination: Readonly<SafeExternalHttpsDestination>,
) {
  const parsed = parseSafeExternalHttpsDestination(destination.canonicalUrl);
  if (
    !parsed
    || parsed.canonicalUrl !== destination.canonicalUrl
    || parsed.origin !== destination.origin
  ) throw new Error('Invalid external HTTPS WebView destination');
  return Object.freeze({ uri: parsed.canonicalUrl });
}

export function getExternalHttpsWebViewPolicyProps<ShouldStart, OpenWindow>(
  destination: Readonly<SafeExternalHttpsDestination>,
  callbacks: Readonly<{
    onShouldStartLoadWithRequest: ShouldStart;
    onOpenWindow: OpenWindow;
  }>,
) {
  const source = getExternalHttpsWebViewSource(destination);
  return {
    source,
    originWhitelist: [destination.origin],
    onShouldStartLoadWithRequest: callbacks.onShouldStartLoadWithRequest,
    onOpenWindow: callbacks.onOpenWindow,
    ...EXTERNAL_HTTPS_WEBVIEW_SECURITY_PROPS,
  };
}
