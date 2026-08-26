export const PUBLISHED_CATALOG_ICONS = Object.freeze([
  'laboratory',
  'guide',
  'nutrition',
  'recipes',
  'wellness',
  'location',
  'contact',
  'featured',
] as const);

export type PublishedCatalogIcon = (typeof PUBLISHED_CATALOG_ICONS)[number];

export interface PublishedCatalogItem {
  readonly access: 'public';
  readonly active: true;
  readonly icon: PublishedCatalogIcon;
  readonly id: string;
  readonly summary: Readonly<{ en: string; 'es-MX': string }>;
  readonly title: Readonly<{ en: string; 'es-MX': string }>;
  readonly url: string;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface PublishedCatalogSnapshot {
  readonly revision: number;
  readonly updatedAtMs: number;
  readonly items: readonly Readonly<PublishedCatalogItem>[];
}

const SNAPSHOT_KEYS = ['items', 'revision', 'updatedAtMs'] as const;
const ITEM_KEYS = [
  'access',
  'active',
  'createdAtMs',
  'icon',
  'id',
  'revision',
  'summary',
  'title',
  'updatedAtMs',
  'url',
] as const;
const LOCALIZED_KEYS = ['en', 'es-MX'] as const;
const ID_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RESERVED_PUBLIC_IDS = new Set(['app-review', 'shared', 'client-resources']);
const MAX_CATALOG_ITEMS = 12;
// Keep the value inside the four-digit ISO calendar range used by the UI.
const MAX_CATALOG_TIMESTAMP_MS = 253_402_300_799_999;

export function parsePublishedCatalog(value: unknown): PublishedCatalogSnapshot | null {
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) return null;
  if (!isSafeNonnegativeInteger(value.revision)) return null;
  if (!isSafeNonnegativeInteger(value.updatedAtMs)) return null;
  if (!Array.isArray(value.items) || value.items.length > MAX_CATALOG_ITEMS) return null;

  const items: Readonly<PublishedCatalogItem>[] = [];
  const ids = new Set<string>();
  for (const candidate of value.items) {
    const item = parsePublishedItem(candidate);
    if (!item || item.updatedAtMs > value.updatedAtMs || ids.has(item.id)) return null;
    ids.add(item.id);
    items.push(item);
  }

  return Object.freeze({
    revision: value.revision,
    updatedAtMs: value.updatedAtMs,
    items: Object.freeze(items),
  });
}

function parsePublishedItem(value: unknown): Readonly<PublishedCatalogItem> | null {
  if (!hasExactKeys(value, ITEM_KEYS)) return null;
  if (value.access !== 'public' || value.active !== true) return null;
  if (!isPublishedIcon(value.icon)) return null;
  if (
    typeof value.id !== 'string'
    || !ID_PATTERN.test(value.id)
    || RESERVED_PUBLIC_IDS.has(value.id)
  ) return null;
  if (value.url !== `https://cabohealth.org/apps/${value.id}/`) return null;
  if (!isSafePositiveInteger(value.revision)) return null;
  if (!isSafeNonnegativeInteger(value.createdAtMs)) return null;
  if (!isSafeNonnegativeInteger(value.updatedAtMs) || value.updatedAtMs < value.createdAtMs) {
    return null;
  }
  const title = parseLocalizedText(value.title, 1, 80);
  const summary = parseLocalizedText(value.summary, 1, 240);
  if (!title || !summary) return null;

  return Object.freeze({
    access: 'public',
    active: true,
    icon: value.icon,
    id: value.id,
    summary,
    title,
    url: value.url,
    revision: value.revision,
    createdAtMs: value.createdAtMs,
    updatedAtMs: value.updatedAtMs,
  });
}

function parseLocalizedText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): Readonly<{ en: string; 'es-MX': string }> | null {
  if (!hasExactKeys(value, LOCALIZED_KEYS)) return null;
  if (
    !isSafeText(value.en, minimumLength, maximumLength)
    || !isSafeText(value['es-MX'], minimumLength, maximumLength)
  ) return null;
  return Object.freeze({ en: value.en, 'es-MX': value['es-MX'] });
}

function isSafeText(value: unknown, minimumLength: number, maximumLength: number): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= minimumLength
    && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isPublishedIcon(value: unknown): value is PublishedCatalogIcon {
  return typeof value === 'string'
    && PUBLISHED_CATALOG_ICONS.includes(value as PublishedCatalogIcon);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_CATALOG_TIMESTAMP_MS;
}

function isSafePositiveInteger(value: unknown): value is number {
  return isSafeNonnegativeInteger(value) && value > 0;
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
