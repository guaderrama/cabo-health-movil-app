import {
  isPermanentlyRetiredCatalogId,
  isReservedReviewSandboxCatalogId,
} from './catalogIdPolicy';
import { parseSafeExternalHttpsDestination } from '../launch/externalHttpsUrlPolicy';

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

interface PublishedCatalogItemBase {
  readonly access: 'public';
  readonly active: true;
  readonly icon: PublishedCatalogIcon;
  readonly id: string;
  readonly summary: Readonly<{ en: string; 'es-MX': string }>;
  readonly title: Readonly<{ en: string; 'es-MX': string }>;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export type PublishedCatalogItem = Readonly<
  | (PublishedCatalogItemBase & {
      readonly destinationKind: 'cabohealth';
      readonly url: string;
    })
  | (PublishedCatalogItemBase & {
      readonly destinationKind: 'external_https';
      readonly url: string;
    })
>;

export interface PublishedClientPreview {
  readonly access: 'clients';
  readonly icon: PublishedCatalogIcon;
  readonly id: string;
  readonly summary: Readonly<{ en: string; 'es-MX': string }>;
  readonly title: Readonly<{ en: string; 'es-MX': string }>;
}

export interface PublishedCatalogSnapshot {
  readonly clientPreviews: readonly Readonly<PublishedClientPreview>[];
  readonly revision: number;
  readonly updatedAtMs: number;
  readonly items: readonly Readonly<PublishedCatalogItem>[];
  readonly schemaVersion: 3;
}

const SNAPSHOT_KEYS = [
  'clientPreviews',
  'items',
  'revision',
  'schemaVersion',
  'updatedAtMs',
] as const;
const ITEM_KEYS = [
  'access',
  'active',
  'createdAtMs',
  'destinationKind',
  'icon',
  'id',
  'revision',
  'summary',
  'title',
  'updatedAtMs',
  'url',
] as const;
const CLIENT_PREVIEW_KEYS = ['access', 'icon', 'id', 'summary', 'title'] as const;
const LOCALIZED_KEYS = ['en', 'es-MX'] as const;
const ID_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EXTERNAL_ID_PATTERN = /^external-[0-9a-f]{32}$/u;
const CLIENT_PREVIEW_FORMAT_CONTROL_PATTERN = /\p{Cf}/u;
const CLIENT_PREVIEW_URI_PATTERN = /\b[a-z][a-z0-9+.-]{0,31}:(?:\/\/)?[^\s]+/iu;
const CLIENT_PREVIEW_HOST_PATTERN = /\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\b/iu;
const CLIENT_PREVIEW_IP_HOST_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s]*)?/u;
const CLIENT_PREVIEW_IPV6_HOST_PATTERN = /(?:^|[^\p{L}\p{N}:])\[?(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?=[0-9a-f:]*::)[0-9a-f:]{2,39})\]?(?=$|[^\p{L}\p{N}:])/iu;
const CLIENT_PREVIEW_PRIVATE_PATH_PATTERN = /(?:^|[^a-z0-9])(?:(?:[a-z]:)?[/\\]{1,2}(?=[a-z0-9._~-])|[a-z0-9][a-z0-9._~-]*(?:[/\\][a-z0-9._~/?#=&-]*|[?#][a-z0-9._~%=&-]+))/iu;
const CLIENT_PREVIEW_CREDENTIAL_PATTERN = /(?:^|[^a-z0-9])(?:CH|AR)[ \-\u2010-\u2015\u2212]*(?:[a-f0-9][ \-\u2010-\u2015\u2212]*){32}(?=$|[^a-f0-9])/iu;
const CLIENT_PREVIEW_CURRENCY_SYMBOL_PATTERN = /\p{Sc}/u;
const CLIENT_PREVIEW_CURRENCY_CODES = new Set<string>([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOV', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BYR', 'BZD',
  'CAD', 'CDF', 'CHE', 'CHF', 'CHW', 'CLF', 'CLP', 'CNH', 'CNY', 'COP', 'COU', 'CRC', 'CUC', 'CUP', 'CVE', 'CZK',
  'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP',
  'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF',
  'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY',
  'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT',
  'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LTL', 'LVL', 'LYD',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRO', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MXV', 'MYR', 'MZN',
  'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR',
  'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RMB', 'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SLL', 'SOS', 'SRD', 'SSP', 'STD', 'STN', 'SVC', 'SYP', 'SZL',
  'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS',
  'UAH', 'UGX', 'USD', 'USN', 'UYI', 'UYU', 'UYW', 'UZS',
  'VED', 'VEF', 'VES', 'VND', 'VUV', 'WST',
  'XAF', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XCG', 'XDR', 'XOF', 'XPD', 'XPF', 'XPT', 'XSU', 'XTS', 'XUA', 'XXX',
  'YER', 'ZAR', 'ZMK', 'ZMW', 'ZWD', 'ZWG', 'ZWL', 'ZWN', 'ZWR',
]);
const CLIENT_PREVIEW_CURRENCY_CODE_AMOUNT_PATTERN = /\b(?:\d[\d.,]*\s*[A-Z]{3}|[A-Z]{3}\s*\d[\d.,]*)\b/u;
const CLIENT_PREVIEW_CURRENCY_CODE_AMOUNT_CANDIDATE_PATTERN = /\b(?:\d[\d.,]*\s*([a-z]{3})|([a-z]{3})\s*\d[\d.,]*)\b/giu;
const CLIENT_PREVIEW_CURRENCY_WORD_AFTER_AMOUNT_PATTERN = /\b\d[\d.,]*\s*(\p{L}+)\b/giu;
const CLIENT_PREVIEW_CURRENCY_WORD_BEFORE_AMOUNT_PATTERN = /\b(\p{L}+)\s*\d[\d.,]*\b/giu;
const CLIENT_PREVIEW_POUND_COMMERCIAL_AMOUNT_PATTERN = /\b(?:available\s+for|buy\s+for|disponible\s+por|comprar?\s+por)\s+\d[\d.,]*\s*(?:pounds?|libras?)\b/iu;
const CLIENT_PREVIEW_COMMERCIAL_TERMS = Object.freeze([
  'price', 'prices', 'pricing', 'precio', 'precios',
  'cost', 'costs', 'costo', 'costos',
  'fee', 'fees', 'tarifa', 'tarifas',
  'currency', 'currencies', 'moneda', 'monedas',
  'monthly', 'mensual', 'mensuales',
  'membership', 'memberships', 'membresía', 'membresías', 'membresia', 'membresias',
  'subscription', 'subscriptions', 'subscribe', 'subscribed',
  'suscripción', 'suscripciones', 'suscripcion', 'suscribir', 'suscríbete',
  'purchase', 'purchases', 'purchasing', 'comprar', 'compra', 'compras',
  'buy', 'buys', 'buying',
  'payment', 'payments', 'paid', 'pago', 'pagos', 'pagar',
  'checkout', 'checkouts', 'billing', 'billed',
  'charge', 'charges', 'charged', 'charging', 'cobro', 'cobros',
  'venta', 'ventas', 'facturación', 'facturacion', 'facturaciones',
]);
const CLIENT_PREVIEW_COMMERCIAL_TERM_ALTERNATION = CLIENT_PREVIEW_COMMERCIAL_TERMS.join('|');
const CLIENT_PREVIEW_COMMERCIAL_TERM_SET = new Set(CLIENT_PREVIEW_COMMERCIAL_TERMS);
const CLIENT_PREVIEW_PRICE_PATTERN = new RegExp(
  String.raw`\b(?:${CLIENT_PREVIEW_COMMERCIAL_TERM_ALTERNATION})\b|\b(?:per\s+month|por\s+mes)\b`,
  'iu',
);
const CLIENT_PREVIEW_FREE_ACCESS_PATTERN = /(?:(?<![-\p{L}\p{N}])(?:free|gratis|complimentary)\b(?=[^.!?\n]{0,80}\b(?:access|resources?|memberships?|accesos?|recursos?|membres[ií]as?)\b)|\b(?:access|resources?|memberships?|accesos?|recursos?|membres[ií]as?)\b(?=[^.!?\n]{0,80}(?<![-\p{L}\p{N}])(?:free|gratis|complimentary)\b))/iu;
const CLIENT_PREVIEW_SALE_PATTERN = /\b(?:(?:sale|sales)\s+available|(?:for|on)\s+sale)\b/iu;
const CLIENT_PREVIEW_IAP_COMMERCIAL_PATTERN = /\b(?:iap\s+(?:available|enabled)|(?:available|enabled)\s+iap)\b/iu;
const CLIENT_PREVIEW_UNSAFE_ID_TOKEN_PATTERN = new RegExp(
  String.raw`(?:^|-)(?:${CLIENT_PREVIEW_COMMERCIAL_TERM_ALTERNATION})(?:-|$)`,
  'iu',
);
const CLIENT_PREVIEW_SALE_ID_TOKEN_PATTERN = /(?:^|-)(?:sale|sales)(?:-|$)/iu;
const CLIENT_PREVIEW_IAP_ID_TOKEN_PATTERN = /(?:^|-)iap(?:-|$)/iu;
const CLIENT_PREVIEW_IAP_ID_CONTEXT_PATTERN = /(?:^|-)(?:available|enabled)(?:-|$)/iu;
const CLIENT_PREVIEW_FREE_ID_TOKEN_PATTERN = /(?:^|-)(?:free|gratis|complimentary)(?:-|$)/iu;
const CLIENT_PREVIEW_FREE_ID_CONTEXT_PATTERN = /(?:^|-)(?:access|resources?|memberships?|accesos?|recursos?|membresias?)(?:-|$)/iu;
const CLIENT_PREVIEW_CURRENCY_ID_WORDS = new Set([
  'afghani', 'afghanis', 'lek', 'leks', 'dinar', 'dinars', 'dinares',
  'dirham', 'dirhams', 'kwanza', 'kwanzas',
  'dollar', 'dollars', 'dolar', 'dolares', 'dólar', 'dólares',
  'florin', 'florins', 'guilder', 'guilders', 'manat', 'manats', 'marka',
  'taka', 'lev', 'leva', 'franc', 'francs', 'franco', 'francos',
  'ngultrum', 'ngultrums', 'boliviano', 'bolivianos',
  'real', 'reais', 'reales', 'pula',
  'ruble', 'rubles', 'rouble', 'roubles', 'rublo', 'rublos',
  'yuan', 'renminbi', 'colón', 'colones', 'koruna', 'korunas',
  'krona', 'kronor', 'krone', 'kroner', 'nakfa', 'birr',
  'euro', 'euros', 'lari', 'cedi', 'cedis', 'dalasi',
  'shilling', 'shillings', 'quetzal', 'quetzales', 'lempira', 'lempiras',
  'gourde', 'gourdes', 'forint', 'forints', 'rupiah',
  'shekel', 'shekels', 'rupee', 'rupees', 'rupia', 'rupias',
  'rial', 'rials', 'riales', 'yen', 'yenes', 'kip', 'lira', 'liras',
  'loti', 'maloti', 'leu', 'lei', 'ariary', 'denar', 'denars',
  'kyat', 'tugrik', 'tugriks', 'pataca', 'patacas', 'ouguiya', 'ouguiyas',
  'kwacha', 'ringgit', 'metical', 'meticais', 'naira',
  'cordoba', 'cordobas', 'córdoba', 'córdobas', 'balboa', 'balboas',
  'sol', 'soles', 'kina', 'guarani', 'guaranies', 'guaraní', 'guaraníes',
  'zloty', 'zlotys', 'złoty', 'złotys', 'riyal', 'riyals', 'riel', 'riels',
  'won', 'leone', 'leones', 'somoni', 'paanga', 'hryvnia', 'hryvnias',
  'som', 'soms', 'dong', 'vatu', 'tala', 'rand', 'peso', 'pesos',
]);
const CLIENT_PREVIEW_ID_NUMBER_PATTERN = /^\d+$/u;
const CLIENT_PREVIEW_ID_NUMBERED_TOKEN_PATTERN = /^(?:\d+([a-z]+)|([a-z]+)\d+)$/u;
const RESERVED_PUBLIC_IDS = new Set([
  'app-review',
  'shared',
  'client-resources',
]);
const RESERVED_CLIENT_IDS = new Set([
  'app-review',
  'shared',
]);
const MAX_CATALOG_ITEMS = 12;
// Keep the value inside the four-digit ISO calendar range used by the UI.
const MAX_CATALOG_TIMESTAMP_MS = 253_402_300_799_999;

export function parsePublishedCatalog(value: unknown): PublishedCatalogSnapshot | null {
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) return null;
  if (value.schemaVersion !== 3) return null;
  if (!isSafeNonnegativeInteger(value.revision)) return null;
  if (!isSafeNonnegativeInteger(value.updatedAtMs)) return null;
  if (
    !Array.isArray(value.items)
    || !Array.isArray(value.clientPreviews)
    || value.items.length + value.clientPreviews.length > MAX_CATALOG_ITEMS
  ) return null;

  const items: Readonly<PublishedCatalogItem>[] = [];
  const ids = new Set<string>();
  for (const candidate of value.items) {
    const item = parsePublishedItem(candidate);
    if (!item || item.updatedAtMs > value.updatedAtMs || ids.has(item.id)) return null;
    ids.add(item.id);
    items.push(item);
  }

  const clientPreviews: Readonly<PublishedClientPreview>[] = [];
  for (const candidate of value.clientPreviews) {
    const preview = parseClientPreview(candidate);
    if (!preview || ids.has(preview.id)) return null;
    ids.add(preview.id);
    clientPreviews.push(preview);
  }

  return Object.freeze({
    clientPreviews: Object.freeze(clientPreviews),
    revision: value.revision,
    schemaVersion: 3,
    updatedAtMs: value.updatedAtMs,
    items: Object.freeze(items),
  });
}

function parseClientPreview(value: unknown): Readonly<PublishedClientPreview> | null {
  if (!hasExactKeys(value, CLIENT_PREVIEW_KEYS)) return null;
  if (value.access !== 'clients' || !isPublishedIcon(value.icon)) return null;
  if (
    typeof value.id !== 'string'
    || !ID_PATTERN.test(value.id)
    || isPermanentlyRetiredCatalogId(value.id)
    || isReservedReviewSandboxCatalogId(value.id)
    || RESERVED_CLIENT_IDS.has(value.id)
    || isUnsafeClientPreviewId(value.id)
  ) return null;
  const title = parseLocalizedText(value.title, 1, 80);
  const summary = parseLocalizedText(value.summary, 1, 240);
  if (!title
    || !summary
    || !isSafeClientPreviewCopy(title)
    || !isSafeClientPreviewCopy(summary)) return null;

  return Object.freeze({
    access: 'clients',
    icon: value.icon,
    id: value.id,
    summary,
    title,
  });
}

function parsePublishedItem(value: unknown): Readonly<PublishedCatalogItem> | null {
  if (!hasExactKeys(value, ITEM_KEYS)) return null;
  if (value.access !== 'public' || value.active !== true) return null;
  if (!isPublishedIcon(value.icon)) return null;
  if (typeof value.id !== 'string') return null;
  if (value.destinationKind === 'cabohealth') {
    if (!ID_PATTERN.test(value.id)
      || isPermanentlyRetiredCatalogId(value.id)
      || isReservedReviewSandboxCatalogId(value.id)
      || RESERVED_PUBLIC_IDS.has(value.id)
      || value.url !== `https://cabohealth.org/apps/${value.id}/`) return null;
  } else if (value.destinationKind === 'external_https') {
    const destination = parseSafeExternalHttpsDestination(value.url);
    if (!EXTERNAL_ID_PATTERN.test(value.id)
      || !destination
      || value.url !== destination.canonicalUrl) return null;
  } else {
    return null;
  }
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
    destinationKind: value.destinationKind,
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

function containsClientPreviewCurrencyCodeAmount(text: string): boolean {
  if (CLIENT_PREVIEW_CURRENCY_CODE_AMOUNT_PATTERN.test(text)) return true;
  for (const match of text.matchAll(CLIENT_PREVIEW_CURRENCY_CODE_AMOUNT_CANDIDATE_PATTERN)) {
    const code = match[1] ?? match[2];
    if (code
      && CLIENT_PREVIEW_CURRENCY_CODES.has(code.toUpperCase())
      && !isBenignClientPreviewTryAmount(text, match)) return true;
  }
  return false;
}

function isBenignClientPreviewTryAmount(text: string, match: RegExpMatchArray): boolean {
  if (match[2]?.toLocaleLowerCase('en-US') !== 'try') return false;
  const trailingText = text.slice((match.index ?? 0) + match[0].length);
  return /^\s+(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|exercises?|reps?|steps?)\b/iu.test(trailingText);
}

function containsClientPreviewCurrencyWordAmount(text: string): boolean {
  for (const pattern of [
    CLIENT_PREVIEW_CURRENCY_WORD_AFTER_AMOUNT_PATTERN,
    CLIENT_PREVIEW_CURRENCY_WORD_BEFORE_AMOUNT_PATTERN,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const word = match[1]?.toLocaleLowerCase('es-MX');
      if (!word || !CLIENT_PREVIEW_CURRENCY_ID_WORDS.has(word)) continue;
      const trailingText = text.slice((match.index ?? 0) + match[0].length);
      if (((word === 'peso' || word === 'pesos') && /^\s+libres\b/iu.test(trailingText))
        || (word === 'real' && /^-world\b/iu.test(trailingText))) continue;
      return true;
    }
  }
  return CLIENT_PREVIEW_POUND_COMMERCIAL_AMOUNT_PATTERN.test(text);
}

function containsClientPreviewFreeAccess(text: string): boolean {
  const copyWithoutFreeWeightPhrase = text.replace(/\bfree\s+weights?\b/giu, 'weight exercise');
  return CLIENT_PREVIEW_FREE_ACCESS_PATTERN.test(copyWithoutFreeWeightPhrase);
}

function isSafeClientPreviewCopy(copy: Readonly<{ en: string; 'es-MX': string }>): boolean {
  return [copy.en, copy['es-MX']].every((text) => (
    !CLIENT_PREVIEW_FORMAT_CONTROL_PATTERN.test(text)
    && !CLIENT_PREVIEW_URI_PATTERN.test(text)
    && !CLIENT_PREVIEW_HOST_PATTERN.test(text)
    && !CLIENT_PREVIEW_IP_HOST_PATTERN.test(text)
    && !CLIENT_PREVIEW_IPV6_HOST_PATTERN.test(text)
    && !CLIENT_PREVIEW_PRIVATE_PATH_PATTERN.test(text)
    && !CLIENT_PREVIEW_CREDENTIAL_PATTERN.test(text)
    && !CLIENT_PREVIEW_CURRENCY_SYMBOL_PATTERN.test(text)
    && !containsClientPreviewCurrencyCodeAmount(text)
    && !containsClientPreviewCurrencyWordAmount(text)
    && !containsClientPreviewFreeAccess(text)
    && !CLIENT_PREVIEW_PRICE_PATTERN.test(text)
    && !CLIENT_PREVIEW_SALE_PATTERN.test(text)
    && !CLIENT_PREVIEW_IAP_COMMERCIAL_PATTERN.test(text)
  ));
}

function containsClientPreviewPricingAmountId(id: string): boolean {
  const segments = id.split('-');
  return segments.some((segment, index) => {
    const numberedTokenMatch = CLIENT_PREVIEW_ID_NUMBERED_TOKEN_PATTERN.exec(segment);
    const numberedToken = numberedTokenMatch?.[1] ?? numberedTokenMatch?.[2];
    if (numberedToken
      && !isClientPreviewBenignCurrencySegment(numberedToken, segments, index)
      && (CLIENT_PREVIEW_CURRENCY_CODES.has(numberedToken.toUpperCase())
        || CLIENT_PREVIEW_CURRENCY_ID_WORDS.has(numberedToken)
        || CLIENT_PREVIEW_COMMERCIAL_TERM_SET.has(numberedToken)
        || numberedToken === 'sale'
        || numberedToken === 'sales')) return true;
    const hasAdjacentAmount = CLIENT_PREVIEW_ID_NUMBER_PATTERN.test(segments[index - 1] ?? '')
      || CLIENT_PREVIEW_ID_NUMBER_PATTERN.test(segments[index + 1] ?? '');
    if (!hasAdjacentAmount) return false;
    if (CLIENT_PREVIEW_CURRENCY_CODES.has(segment.toUpperCase())) return true;
    if (!CLIENT_PREVIEW_CURRENCY_ID_WORDS.has(segment)) return false;
    return !isClientPreviewBenignCurrencySegment(segment, segments, index);
  });
}

function isClientPreviewBenignCurrencySegment(
  segment: string,
  segments: readonly string[],
  index: number,
): boolean {
  return ((segment === 'peso' || segment === 'pesos') && segments[index + 1] === 'libres')
    || (segment === 'real' && segments[index + 1] === 'world');
}

function isUnsafeClientPreviewId(id: string): boolean {
  return CLIENT_PREVIEW_CREDENTIAL_PATTERN.test(id)
    || CLIENT_PREVIEW_UNSAFE_ID_TOKEN_PATTERN.test(id)
    || CLIENT_PREVIEW_SALE_ID_TOKEN_PATTERN.test(id)
    || (CLIENT_PREVIEW_IAP_ID_TOKEN_PATTERN.test(id)
      && CLIENT_PREVIEW_IAP_ID_CONTEXT_PATTERN.test(id))
    || (CLIENT_PREVIEW_FREE_ID_TOKEN_PATTERN.test(id)
      && CLIENT_PREVIEW_FREE_ID_CONTEXT_PATTERN.test(id))
    || containsClientPreviewPricingAmountId(id);
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
