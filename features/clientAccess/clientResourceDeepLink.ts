const CLIENT_RESOURCE_PATH = '/apps/client-resources';
const CLIENT_RESOURCE_ORIGIN = 'https://cabohealth.org';
const FORBIDDEN_SEGMENTS = new Set(['api', 'launch']);

export const CLIENT_RESOURCE_REJECTED_PATH = '/__client-resource-link-rejected__';

export type ClientResourceDeepLinkDecision =
  | Readonly<{ decision: 'open-native-client-access'; path: string }>
  | Readonly<{
    decision: 'not-found';
    reason:
      | 'unsafe-url-text'
      | 'origin-not-allowed'
      | 'query-or-fragment-not-allowed'
      | 'unsafe-path'
      | 'path-not-allowed'
      | 'reserved-path';
  }>
  | Readonly<{ decision: 'unrelated' }>;

/**
 * Classifies the raw system path before Expo Router can normalize dot segments.
 * Client-resource links never identify a private web destination: every safe
 * path resolves to the same native access gate and resource list.
 */
export function classifyClientResourceDeepLink(
  rawHref: string,
): ClientResourceDeepLinkDecision {
  const target = splitRawTarget(rawHref);
  if (!target || !looksLikeClientResourceNamespace(target.rawPath)) {
    return { decision: 'unrelated' };
  }

  if (/[\u0000-\u0020\u007f\\]/u.test(rawHref)) {
    return notFound('unsafe-url-text');
  }
  if (target.absoluteOrigin !== null && target.absoluteOrigin !== CLIENT_RESOURCE_ORIGIN) {
    return notFound('origin-not-allowed');
  }
  if (target.rawSuffix !== '') {
    return notFound('query-or-fragment-not-allowed');
  }
  if (target.rawPath.includes('%') || !hasSafeRawPath(target.rawPath)) {
    return notFound('unsafe-path');
  }
  if (
    target.rawPath !== CLIENT_RESOURCE_PATH
    && !target.rawPath.startsWith(`${CLIENT_RESOURCE_PATH}/`)
  ) {
    return notFound('path-not-allowed');
  }

  const subpath = target.rawPath.slice(CLIENT_RESOURCE_PATH.length);
  const subsegments = subpath.split('/').filter(Boolean);
  if (subsegments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    return notFound('reserved-path');
  }

  const path = target.rawPath === CLIENT_RESOURCE_PATH
    ? `${CLIENT_RESOURCE_PATH}/`
    : target.rawPath;
  return { decision: 'open-native-client-access', path };
}

export function redirectClientResourceSystemPath(rawPath: string): string {
  const decision = classifyClientResourceDeepLink(rawPath);
  return decision.decision === 'not-found'
    ? CLIENT_RESOURCE_REJECTED_PATH
    : decision.decision === 'open-native-client-access'
      ? decision.path
      : rawPath;
}

function notFound(
  reason: Extract<ClientResourceDeepLinkDecision, { decision: 'not-found' }>['reason'],
): ClientResourceDeepLinkDecision {
  return { decision: 'not-found', reason };
}

function splitRawTarget(rawHref: string): Readonly<{
  absoluteOrigin: string | null;
  rawPath: string;
  rawSuffix: string;
}> | null {
  if (typeof rawHref !== 'string' || rawHref === '') return null;

  if (rawHref.startsWith('/')) {
    const suffixIndex = rawHref.search(/[?#]/u);
    return {
      absoluteOrigin: null,
      rawPath: suffixIndex === -1 ? rawHref : rawHref.slice(0, suffixIndex),
      rawSuffix: suffixIndex === -1 ? '' : rawHref.slice(suffixIndex),
    };
  }

  const absolute = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)([?#].*)?$/u.exec(rawHref);
  if (!absolute) return null;
  const rawPath = absolute[3] === '' ? '/' : absolute[3];
  return {
    absoluteOrigin: `${absolute[1]}://${absolute[2]}`,
    rawPath,
    rawSuffix: absolute[4] ?? '',
  };
}

function looksLikeClientResourceNamespace(rawPath: string): boolean {
  let decoded = rawPath;
  for (let pass = 0; pass < 2 && decoded.includes('%'); pass += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // A malformed encoding that visibly names the namespace is rejected below.
      break;
    }
  }
  const segments = decoded.toLowerCase().replaceAll('\\', '/').split('/');
  return segments.includes('client-resources');
}

function hasSafeRawPath(rawPath: string): boolean {
  if (!rawPath.startsWith('/') || rawPath.includes('//')) return false;
  const segments = rawPath.split('/');
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
