import { PUBLIC_CONTACT_URLS } from '../../constants/publicContacts';
import {
  getPublicMiniapp,
  PUBLIC_MINIAPPS,
  type CatalogPublicMiniapp,
} from '../../constants/publicMiniapps';
import { isPermanentlyRetiredCatalogId } from '../catalog/catalogIdPolicy';

export const EMBEDDED_PRESENTATION_FRAGMENTS = Object.freeze({
  'en:standard': '#embedded-en',
  'en:reduced': '#embedded-en-reduced',
  'es-MX:standard': '#embedded-es-MX',
  'es-MX:reduced': '#embedded-es-MX-reduced',
} as const);

const ALLOWED_ROOT_FRAGMENTS: readonly string[] = Object.freeze([
  '#main-content',
  ...Object.values(EMBEDDED_PRESENTATION_FRAGMENTS),
]);
const PUBLIC_ROUTE_ID_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const APPROVED_EDITORIAL_SOURCE_URLS = Object.freeze({
  'healthy-recipes': Object.freeze([
    'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
    'https://www.foodsafety.gov/keep-food-safe/4-steps-to-food-safety',
    'https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/food-allergies-big-9',
  ]),
  'clinic-guide': Object.freeze([
    'https://www.gob.mx/911/articulos/que-es-9-1-1-conoce-mas-de-911emergencias?idiom=es',
  ]),
} as const);

export type NavigationReason =
  | 'selected-miniapp-path'
  | 'approved-legal-click'
  | 'approved-contact-click'
  | 'approved-editorial-source-click'
  | 'popup-target'
  | 'unknown-miniapp'
  | 'unsafe-url-text'
  | 'relative-url'
  | 'unsafe-scheme'
  | 'malformed-url'
  | 'userinfo-not-allowed'
  | 'port-not-allowed'
  | 'host-not-allowed'
  | 'cross-miniapp-path'
  | 'unapproved-path'
  | 'query-not-allowed'
  | 'unapproved-fragment'
  | 'unsafe-path-encoding'
  | 'path-traversal'
  | 'external-not-user-initiated'
  | 'external-not-allowlisted';

export type NavigationDecision =
  | Readonly<{ decision: 'allow-webview'; reason: 'selected-miniapp-path' }>
  | Readonly<{
    decision: 'open-external';
    reason: 'approved-legal-click' | 'approved-contact-click' | 'approved-editorial-source-click';
  }>
  | Readonly<{
    decision: 'block';
    reason: Exclude<NavigationReason,
      | 'selected-miniapp-path'
      | 'approved-legal-click'
      | 'approved-contact-click'
      | 'approved-editorial-source-click'>;
  }>;

export interface MiniappNavigationRequest {
  slug: string | string[] | undefined;
  miniapp?: Readonly<CatalogPublicMiniapp>;
  url: string;
  platform: string;
  navigationType?: string;
  isTopFrame?: boolean;
  isPopup?: boolean;
}

export function resolvePublicMiniappRouteSlug(
  value: string | string[] | undefined,
  catalog: readonly Readonly<Pick<CatalogPublicMiniapp, 'slug'>>[] = PUBLIC_MINIAPPS,
): string | undefined {
  if (typeof value !== 'string' || isPermanentlyRetiredCatalogId(value)) return undefined;
  return catalog.find((miniapp) => miniapp.slug === value)?.slug;
}

export function shouldWaitForPublicCatalogRoute(
  value: string | string[] | undefined,
  isLoading: boolean,
): boolean {
  return isLoading
    && typeof value === 'string'
    && PUBLIC_ROUTE_ID_PATTERN.test(value)
    && !isPermanentlyRetiredCatalogId(value);
}

export function classifyMiniappNavigation(
  request: MiniappNavigationRequest,
  contactUrls: readonly string[] = PUBLIC_CONTACT_URLS,
): NavigationDecision {
  if (request.isPopup) return block('popup-target');

  const miniapp = typeof request.slug === 'string'
    ? resolveNavigationMiniapp(request.slug, request.miniapp)
    : undefined;
  if (!miniapp) return block('unknown-miniapp');

  const { url } = request;
  if (/[\u0000-\u0020\u007f\\]/u.test(url)) return block('unsafe-url-text');

  const legalUrls = Object.values(miniapp.legalUrls);
  const legalDestination = legalUrls.includes(url as (typeof legalUrls)[number]);
  const contactDestination = contactUrls.includes(url);
  const editorialSourceUrls = getEditorialSourceUrls(miniapp.slug);
  const editorialSourceDestination = editorialSourceUrls.includes(url);
  if (legalDestination || contactDestination || editorialSourceDestination) {
    if (!isExplicitTopFrameIosClick(request)) {
      return block('external-not-user-initiated');
    }
    if (legalDestination) return { decision: 'open-external', reason: 'approved-legal-click' };
    if (contactDestination) return { decision: 'open-external', reason: 'approved-contact-click' };
    return { decision: 'open-external', reason: 'approved-editorial-source-click' };
  }

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url)?.[1];
  if (!scheme) return block('relative-url');

  if (isKnownExternalShape(url, scheme)) {
    return block('external-not-allowlisted');
  }
  if (scheme !== 'https') return block('unsafe-scheme');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return block('malformed-url');
  }

  const authority = getRawAuthority(url);
  if (authority.includes('@') || parsed.username !== '' || parsed.password !== '') {
    return block('userinfo-not-allowed');
  }
  if (authority.includes(':')) return block('port-not-allowed');
  if (authority !== 'cabohealth.org' || parsed.hostname !== 'cabohealth.org') {
    return block('host-not-allowed');
  }

  const rawPath = getRawPath(url, authority);
  const unsafePathReason = classifyUnsafePath(rawPath);
  if (unsafePathReason) return block(unsafePathReason);

  const suffix = url.slice('https://'.length + authority.length);
  const hashIndex = suffix.indexOf('#');
  const queryIndex = suffix.indexOf('?');
  if (queryIndex !== -1 && (hashIndex === -1 || queryIndex < hashIndex)) {
    return block('query-not-allowed');
  }

  const rawFragment = hashIndex === -1 ? '' : suffix.slice(hashIndex);
  if (rawFragment !== '') {
    if (rawPath !== miniapp.allowedPathPrefix || !ALLOWED_ROOT_FRAGMENTS.includes(rawFragment)) {
      return block('unapproved-fragment');
    }
  }

  if (rawPath.startsWith(miniapp.allowedPathPrefix)) {
    return { decision: 'allow-webview', reason: 'selected-miniapp-path' };
  }
  if (isOtherPublicMiniappPath(rawPath, miniapp.slug)) {
    return block('cross-miniapp-path');
  }
  return block('unapproved-path');
}

function resolveNavigationMiniapp(
  slug: string,
  supplied: Readonly<CatalogPublicMiniapp> | undefined,
): Readonly<CatalogPublicMiniapp> | undefined {
  const candidate = supplied ?? getPublicMiniapp(slug);
  if (!hasExactCatalogBoundary(candidate) || candidate.slug !== slug) {
    return undefined;
  }
  return candidate;
}

function hasExactCatalogBoundary(value: unknown): value is Readonly<CatalogPublicMiniapp> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const miniapp = value as Record<string, unknown>;
  if (
    typeof miniapp.slug !== 'string'
    || !PUBLIC_ROUTE_ID_PATTERN.test(miniapp.slug)
    || isPermanentlyRetiredCatalogId(miniapp.slug)
    || ['app-review', 'shared', 'client-resources'].includes(miniapp.slug)
    || miniapp.legalUrls === null
    || typeof miniapp.legalUrls !== 'object'
    || Array.isArray(miniapp.legalUrls)
  ) return false;
  const legalUrls = miniapp.legalUrls as Record<string, unknown>;
  if (Object.keys(legalUrls).sort().join(',') !== 'privacy,reportContent,support,terms') {
    return false;
  }
  const canonical = `https://cabohealth.org/apps/${miniapp.slug}/`;
  return miniapp.canonicalUrl === canonical
    && miniapp.universalLink === canonical
    && miniapp.allowedPathPrefix === `/apps/${miniapp.slug}/`
    && legalUrls.privacy === 'https://cabohealth.org/app/privacy/'
    && legalUrls.terms === 'https://cabohealth.org/app/terms/'
    && legalUrls.support === 'https://cabohealth.org/app/support/'
    && legalUrls.reportContent === 'https://cabohealth.org/app/report-content/';
}

function getEditorialSourceUrls(slug: string): readonly string[] {
  if (!Object.hasOwn(APPROVED_EDITORIAL_SOURCE_URLS, slug)) return [];
  return APPROVED_EDITORIAL_SOURCE_URLS[
    slug as keyof typeof APPROVED_EDITORIAL_SOURCE_URLS
  ];
}

function isOtherPublicMiniappPath(rawPath: string, selectedSlug: string): boolean {
  const matched = /^\/apps\/((?=.{1,64}(?:\/|$))[a-z0-9]+(?:-[a-z0-9]+)*)\//u.exec(rawPath);
  return matched !== null && matched[1] !== selectedSlug;
}

function block(
  reason: Extract<NavigationDecision, { decision: 'block' }>['reason'],
): NavigationDecision {
  return { decision: 'block', reason };
}

function isExplicitTopFrameIosClick(request: MiniappNavigationRequest): boolean {
  return request.platform === 'ios'
    && request.isTopFrame === true
    && request.navigationType === 'click';
}

function isKnownExternalShape(url: string, scheme: string): boolean {
  if (/^(?:mailto|tel)$/i.test(scheme)) return true;
  return url.startsWith('https://maps.apple.com/') || url.startsWith('https://wa.me/');
}

function getRawAuthority(url: string): string {
  const authorityStart = 'https://'.length;
  const authorityEnd = url.slice(authorityStart).search(/[/?#]/u);
  return authorityEnd === -1
    ? url.slice(authorityStart)
    : url.slice(authorityStart, authorityStart + authorityEnd);
}

function getRawPath(url: string, authority: string): string {
  const pathStart = 'https://'.length + authority.length;
  const suffix = url.slice(pathStart);
  const pathEnd = suffix.search(/[?#]/u);
  const path = pathEnd === -1 ? suffix : suffix.slice(0, pathEnd);
  return path === '' ? '/' : path;
}

function classifyUnsafePath(
  rawPath: string,
): 'unsafe-path-encoding' | 'path-traversal' | undefined {
  if (/%(?:0[0-9a-f]|1[0-9a-f]|20|7f)/iu.test(rawPath)) return 'unsafe-path-encoding';
  if (/%(?:25)*(?:2f|5c)/iu.test(rawPath)) return 'unsafe-path-encoding';

  let decoded = rawPath;
  const hasDoubleEncoding = /%25/iu.test(rawPath);
  for (let pass = 0; pass < 3; pass += 1) {
    if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
      return 'path-traversal';
    }
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return 'unsafe-path-encoding';
    }
  }
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    return 'path-traversal';
  }
  return hasDoubleEncoding ? 'unsafe-path-encoding' : undefined;
}
