export type DevMiniappAccess = 'public' | 'client';

export interface DevMiniappInput {
  titleEn: string;
  titleEs: string;
  summaryEn: string;
  summaryEs: string;
  url: string;
  access: DevMiniappAccess;
}

export interface DevMiniapp extends DevMiniappInput {
  id: string;
  slug: string;
  active: boolean;
}

export type CreateDevMiniappResult =
  | Readonly<{ ok: true; value: Readonly<DevMiniapp> }>
  | Readonly<{ ok: false; reason: string }>;

export function isDevMiniappPanelEnabled(runtimeIsDev: boolean): boolean {
  return runtimeIsDev;
}

export function getVisibleDevMiniapps(
  miniapps: readonly Readonly<DevMiniapp>[],
): readonly Readonly<DevMiniapp>[] {
  return miniapps.filter((miniapp) => miniapp.active);
}

export function setDevMiniappActive(
  miniapps: readonly Readonly<DevMiniapp>[],
  id: string,
  active: boolean,
): readonly Readonly<DevMiniapp>[] {
  return miniapps.map((miniapp) => (
    miniapp.id === id ? { ...miniapp, active } : miniapp
  ));
}

export function removeDevMiniapp(
  miniapps: readonly Readonly<DevMiniapp>[],
  id: string,
): readonly Readonly<DevMiniapp>[] {
  return miniapps.filter((miniapp) => miniapp.id !== id);
}

const DEV_MINIAPP_KEYS = Object.freeze([
  'access',
  'active',
  'id',
  'slug',
  'summaryEn',
  'summaryEs',
  'titleEn',
  'titleEs',
  'url',
]);

type ParsedDevMiniappUrl = Readonly<{
  canonicalUrl: string;
  hostname: string;
  origin: string;
}>;

function parsePublicHttpsUrl(rawUrl: string): ParsedDevMiniappUrl | null {
  if (
    rawUrl.length === 0
    || rawUrl.length > 2048
    || /[\u0000-\u0020\u007f\\]/u.test(rawUrl)
    || /%(?:2e|2f|5c)/iu.test(rawUrl)
    || !rawUrl.startsWith('https://')
  ) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const authority = rawUrl.slice('https://'.length).split(/[/?#]/u, 1)[0];
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.port !== ''
    || authority.includes('@')
    || authority.includes(':')
    || !hostname.includes('.')
    || hostname.startsWith('.')
    || hostname.endsWith('.')
    || hostname === 'localhost'
    || hostname.endsWith('.local')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)
  ) return null;

  return {
    canonicalUrl: parsed.toString(),
    hostname,
    origin: parsed.origin,
  };
}

export function parseDevMiniappCatalog(stored: string): readonly Readonly<DevMiniapp>[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length > 12) throw new Error('invalid');
    const result: DevMiniapp[] = [];
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('invalid');
      }
      const record = candidate as Record<string, unknown>;
      if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(DEV_MINIAPP_KEYS)) {
        throw new Error('invalid');
      }
      if (
        typeof record.id !== 'string'
        || typeof record.slug !== 'string'
        || typeof record.titleEn !== 'string'
        || typeof record.titleEs !== 'string'
        || typeof record.summaryEn !== 'string'
        || typeof record.summaryEs !== 'string'
        || typeof record.url !== 'string'
        || typeof record.active !== 'boolean'
        || (record.access !== 'public' && record.access !== 'client')
      ) {
        throw new Error('invalid');
      }
      const created = createDevMiniapp({
        titleEn: record.titleEn,
        titleEs: record.titleEs,
        summaryEn: record.summaryEn,
        summaryEs: record.summaryEs,
        url: record.url,
        access: record.access,
      }, result);
      if (!created.ok || record.id !== created.value.id || record.slug !== created.value.slug) {
        throw new Error('invalid');
      }
      result.push({ ...created.value, active: record.active });
    }
    return result;
  } catch {
    throw new Error('Invalid test miniapp catalog');
  }
}

export function classifyDevMiniappNavigation(
  selectedRootUrl: string,
  candidateUrl: string,
): boolean {
  const selectedUrl = parsePublicHttpsUrl(selectedRootUrl);
  const candidate = parsePublicHttpsUrl(candidateUrl);
  if (!selectedUrl || !candidate || selectedUrl.origin !== candidate.origin) return false;

  const selected = /^https:\/\/cabohealth\.org(\/apps\/[a-z0-9]+(?:-[a-z0-9]+)*\/)$/.exec(selectedRootUrl);
  if (!selected) return candidateUrl === selectedRootUrl || !/%(?:2e|2f|5c)/iu.test(candidateUrl);
  if (/[\u0000-\u0020\u007f\\%?]/u.test(candidateUrl)) return false;
  const parsed = new URL(candidateUrl);
  if (
    parsed.hostname !== 'cabohealth.org'
    || !parsed.pathname.startsWith(selected[1])
  ) return false;

  const remainingPath = parsed.pathname.slice(selected[1].length);
  if (remainingPath !== '') {
    const segments = remainingPath.split('/').filter(Boolean);
    if (segments.some((segment) => (
      segment === '.'
      || segment === '..'
      || !/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(segment)
    ))) return false;
  }
  return parsed.hash === '' || /^#[A-Za-z][A-Za-z0-9_-]*$/u.test(parsed.hash);
}

export function createDevMiniapp(
  input: Readonly<DevMiniappInput>,
  existing: readonly Readonly<DevMiniapp>[],
): CreateDevMiniappResult {
  if (existing.length >= 12) {
    return {
      ok: false,
      reason: 'The test catalog can contain up to 12 miniapps.',
    };
  }
  const titleEn = input.titleEn.trim();
  const titleEs = input.titleEs.trim();
  const summaryEn = input.summaryEn.trim();
  const summaryEs = input.summaryEs.trim();
  if (
    !titleEn
    || !titleEs
    || !summaryEn
    || !summaryEs
    || titleEn.length > 60
    || titleEs.length > 60
    || summaryEn.length > 180
    || summaryEs.length > 180
    || (input.access !== 'public' && input.access !== 'client')
  ) {
    return {
      ok: false,
      reason: 'Complete both languages and choose Public or Clients.',
    };
  }
  const parsedUrl = parsePublicHttpsUrl(input.url);
  const cabohealthMatch = /^https:\/\/cabohealth\.org\/apps\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/u.exec(input.url);
  if (!parsedUrl || existing.some((miniapp) => miniapp.url === parsedUrl.canonicalUrl)) {
    return {
      ok: false,
      reason: 'Use an unused public HTTPS link without credentials or a custom port.',
    };
  }
  const slug = cabohealthMatch?.[1] ?? parsedUrl.hostname;
  const id = cabohealthMatch?.[1] ?? `external:${parsedUrl.canonicalUrl}`;
  return {
    ok: true,
    value: {
      id,
      slug,
      titleEn,
      titleEs,
      summaryEn,
      summaryEs,
      url: parsedUrl.canonicalUrl,
      access: input.access,
      active: true,
    },
  };
}
