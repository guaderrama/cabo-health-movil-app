import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import {
  CATALOG_ID_PATTERN,
  CatalogInputError,
  isGloballyReservedCatalogId,
} from './catalogAdmin.js';

export type CatalogUrlClassification = Readonly<
  | { kind: 'cabohealth'; id: string; url: string }
  | { kind: 'external_https'; url: string }
>;

export const EXTERNAL_CATALOG_ID_PATTERN = /^external-[0-9a-f]{32}$/u;

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const URL_MAX_LENGTH = 2_048;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SPECIAL_USE_DNS_SUFFIXES = Object.freeze([
  'localhost',
  'local',
  'internal',
  'alt',
  'arpa',
  'test',
  'invalid',
  'example',
  'onion',
]);

export function parseSafeCatalogUrl(value: unknown): CatalogUrlClassification | null {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > URL_MAX_LENGTH
    || /[\u0000-\u0020\u007f\\]/u.test(value)
    || /%(?![0-9a-f]{2})/iu.test(value)
    || !value.startsWith('https://')) {
    return null;
  }

  const rawParts = splitRawHttpsUrl(value);
  if (!rawParts
    || rawParts.authority.includes('@')
    || !hasOnlyDefaultHttpsPort(rawParts.authority)
    || !isSafeRawPath(rawParts.path)
    || !hasNoDecodedControls(rawParts.suffix)) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.port !== ''
    || !isPublicDnsHostname(parsed.hostname)) {
    return null;
  }

  const canonical = parsed.toString();
  if (parsed.hostname === 'cabohealth.org') {
    return parseCaboHealthCatalogUrl(value, canonical, parsed);
  }
  return Object.freeze({ kind: 'external_https' as const, url: canonical });
}

export function externalCatalogIdFromRequestId(requestId: string): string {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new CatalogInputError();
  }
  const digest = createHash('sha256')
    .update('cabohealth/catalog-external-id/v1', 'utf8')
    .update(Buffer.from([0]))
    .update(requestId, 'utf8')
    .digest('hex');
  return `external-${digest.slice(0, 32)}`;
}

export function catalogIdentityMatches(id: string, url: string): boolean {
  const parsed = parseSafeCatalogUrl(url);
  if (!parsed) return false;
  return parsed.kind === 'cabohealth'
    ? id === parsed.id
    : EXTERNAL_CATALOG_ID_PATTERN.test(id);
}

export function isLegacyCompatibleCatalogUrl(url: string): boolean {
  return parseSafeCatalogUrl(url)?.kind === 'cabohealth';
}

function splitRawHttpsUrl(value: string): Readonly<{
  authority: string;
  path: string;
  suffix: string;
}> | null {
  const remainder = value.slice('https://'.length);
  const boundary = remainder.search(/[/?#]/u);
  const authority = boundary === -1 ? remainder : remainder.slice(0, boundary);
  if (authority === '') return null;
  const suffix = boundary === -1 ? '' : remainder.slice(boundary);
  const pathEnd = suffix.search(/[?#]/u);
  return Object.freeze({
    authority,
    path: pathEnd === -1 ? suffix : suffix.slice(0, pathEnd),
    suffix,
  });
}

function isSafeRawPath(path: string): boolean {
  const decodedPath = decodePercentEscapes(path);
  return decodedPath !== null
    && !containsPathTraversalOrSeparator(path)
    && !containsPathTraversalOrSeparator(decodedPath)
    && !/[\u0000-\u001f\u007f\\]/u.test(decodedPath);
}

function hasNoDecodedControls(value: string): boolean {
  const decoded = decodePercentEscapes(value);
  return decoded !== null && !/[\u0000-\u001f\u007f]/u.test(decoded);
}

function decodePercentEscapes(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function containsPathTraversalOrSeparator(path: string): boolean {
  return /%(?:2f|5c)/iu.test(path)
    || path.includes('\\')
    || path.split('/').some((segment) => normalizesToTraversalSegment(segment));
}

function normalizesToTraversalSegment(segment: string): boolean {
  const withEncodedDots = segment.replace(/%2e/giu, '.');
  return withEncodedDots === '.' || withEncodedDots === '..';
}

function hasOnlyDefaultHttpsPort(authority: string): boolean {
  if (authority.startsWith('[')) return /^\[[^\]]+\](?::443)?$/u.test(authority);
  const portDelimiter = authority.indexOf(':');
  return portDelimiter === -1 || authority.slice(portDelimiter) === ':443';
}

function isPublicDnsHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/u, '').replace(/\]$/u, '');
  return normalized !== ''
    && !normalized.endsWith('.')
    && normalized.length <= 253
    && isIP(normalized) === 0
    && normalized.split('.').length >= 2
    && normalized.split('.').every((label) => DNS_LABEL_PATTERN.test(label))
    && !SPECIAL_USE_DNS_SUFFIXES.some((suffix) => (
      normalized === suffix || normalized.endsWith(`.${suffix}`)
    ));
}

function parseCaboHealthCatalogUrl(
  raw: string,
  canonical: string,
  parsed: URL,
): CatalogUrlClassification | null {
  const match = /^\/apps\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/u.exec(parsed.pathname);
  const id = match?.[1];
  const expected = id ? `https://cabohealth.org/apps/${id}/` : '';
  if (raw !== expected
    || canonical !== expected
    || !id
    || !CATALOG_ID_PATTERN.test(id)
    || isGloballyReservedCatalogId(id)) {
    return null;
  }
  return Object.freeze({ kind: 'cabohealth' as const, id, url: canonical });
}
