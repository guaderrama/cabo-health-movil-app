import type { ClientResourceLaunch } from './clientAccessController';
import { RESTRICTED_WEBVIEW_SECURITY_PROPS } from '../launch/restrictedWebViewBehavior';

const CLIENT_RESOURCE_PATH_PREFIX = '/apps/client-resources/';

export type ClientResourceNavigationDecision =
  | Readonly<{ decision: 'allow'; reason: 'client-resource-path' }>
  | Readonly<{
    decision: 'block';
    reason:
      | 'unsafe-url-text'
      | 'unsafe-scheme'
      | 'malformed-url'
      | 'origin-not-allowed'
      | 'query-or-fragment-not-allowed'
      | 'unsafe-path'
      | 'path-not-allowed';
  }>;

export function classifyClientResourceNavigation(
  url: string,
): ClientResourceNavigationDecision {
  if (typeof url !== 'string' || /[\u0000-\u0020\u007f\\]/u.test(url)) {
    return block('unsafe-url-text');
  }
  if (!url.startsWith('https://')) return block('unsafe-scheme');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return block('malformed-url');
  }
  if (parsed.protocol !== 'https:') return block('unsafe-scheme');

  const authority = getRawAuthority(url);
  if (
    authority !== 'cabohealth.org'
    || parsed.hostname !== 'cabohealth.org'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.port !== ''
  ) return block('origin-not-allowed');

  const suffix = url.slice('https://'.length + authority.length);
  if (suffix.includes('?') || suffix.includes('#')) {
    return block('query-or-fragment-not-allowed');
  }

  const rawPath = suffix === '' ? '/' : suffix;
  if (rawPath.includes('%') || !hasSafePathSegments(rawPath)) {
    return block('unsafe-path');
  }
  if (!rawPath.startsWith(CLIENT_RESOURCE_PATH_PREFIX)) {
    return block('path-not-allowed');
  }
  return { decision: 'allow', reason: 'client-resource-path' };
}

export function getClientResourceWebViewPolicyProps<ShouldStart>(
  source: Readonly<ClientResourceLaunch['source']>,
  onShouldStartLoadWithRequest: ShouldStart,
) {
  return {
    ...RESTRICTED_WEBVIEW_SECURITY_PROPS,
    originWhitelist: ['https://cabohealth.org'],
    source,
    onShouldStartLoadWithRequest,
    onOpenWindow: () => {},
  };
}

function block(
  reason: Extract<ClientResourceNavigationDecision, { decision: 'block' }>['reason'],
): ClientResourceNavigationDecision {
  return { decision: 'block', reason };
}

function getRawAuthority(url: string): string {
  const authorityStart = 'https://'.length;
  const authorityEnd = url.slice(authorityStart).search(/[/?#]/u);
  return authorityEnd === -1
    ? url.slice(authorityStart)
    : url.slice(authorityStart, authorityStart + authorityEnd);
}

function hasSafePathSegments(path: string): boolean {
  if (!path.startsWith('/') || path.includes('//')) return false;
  const segments = path.split('/');
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    const finalTrailingSlash = index === segments.length - 1 && segment === '';
    if (finalTrailingSlash) continue;
    if (
      segment === ''
      || segment === '.'
      || segment === '..'
      || !/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(segment)
    ) return false;
  }
  return true;
}
