export interface SafeExternalHttpsDestination {
  readonly canonicalUrl: string;
  readonly origin: string;
}

const URL_MAX_LENGTH = 2_048;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const IPV4_HOST_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
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

export function parseSafeExternalHttpsDestination(
  value: unknown,
): Readonly<SafeExternalHttpsDestination> | null {
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
    || parsed.hostname === 'cabohealth.org'
    || !isPublicDnsHostname(parsed.hostname)) {
    return null;
  }

  return Object.freeze({
    canonicalUrl: parsed.toString(),
    origin: parsed.origin,
  });
}

export function isSafeSameOriginExternalNavigation(
  value: string,
  expectedOrigin: string,
): boolean {
  const parsed = parseSafeExternalHttpsDestination(value);
  return parsed !== null && parsed.origin === expectedOrigin;
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
    && !normalized.includes(':')
    && !IPV4_HOST_PATTERN.test(normalized)
    && normalized.split('.').length >= 2
    && normalized.split('.').every((label) => DNS_LABEL_PATTERN.test(label))
    && !SPECIAL_USE_DNS_SUFFIXES.some((suffix) => (
      normalized === suffix || normalized.endsWith(`.${suffix}`)
    ));
}
