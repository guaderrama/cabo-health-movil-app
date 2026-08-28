import type {
  CallableTransport,
  ServerStaffSession,
} from './staffGateway.js';
import {
  EXTERNAL_CATALOG_ID_PATTERN,
  parseSafeCatalogUrl,
} from './catalogUrlPolicy.js';

export const CATALOG_ITEM_ICONS = Object.freeze([
  'laboratory',
  'guide',
  'nutrition',
  'recipes',
  'wellness',
  'location',
  'contact',
  'featured',
] as const);

const CATALOG_ITEM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CATALOG_ITEM_ID_MAX_LENGTH = 64;
const CATALOG_TEXT_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const CLIENT_CATALOG_COMMERCIAL_TERMS = Object.freeze([
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
const CLIENT_CATALOG_COMMERCIAL_ID_SEGMENTS = new Set(CLIENT_CATALOG_COMMERCIAL_TERMS);
const CLIENT_CATALOG_SALE_ID_SEGMENTS = new Set(['sale', 'sales']);
const CLIENT_CATALOG_IAP_ID_CONTEXT_SEGMENTS = new Set(['available', 'enabled']);
const CLIENT_CATALOG_FREE_ID_SEGMENTS = new Set(['free', 'gratis', 'complimentary']);
const CLIENT_CATALOG_FREE_ID_CONTEXT_SEGMENTS = new Set([
  'access', 'resource', 'resources', 'membership', 'memberships',
  'acceso', 'accesos', 'recurso', 'recursos', 'membresia', 'membresias',
]);
const CLIENT_CATALOG_CURRENCY_ID_WORDS = new Set([
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
const CLIENT_CATALOG_ID_NUMBER_PATTERN = /^\d+$/u;
const CLIENT_CATALOG_ID_NUMBERED_TOKEN_PATTERN = /^(?:\d+([a-z]+)|([a-z]+)\d+)$/u;
const CLIENT_TEASER_FORMAT_PATTERN = /\p{Cf}/u;
const CLIENT_TEASER_URI_PATTERN = /\b[a-z][a-z0-9+.-]{0,31}:(?:\/\/)?[^\s]+/iu;
const CLIENT_TEASER_BARE_DOMAIN_PATTERN = /\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\b/iu;
const CLIENT_TEASER_IP_HOST_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s]*)?/u;
const CLIENT_TEASER_IPV6_HOST_PATTERN = /(?:^|[^\p{L}\p{N}:])\[?(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?=[0-9a-f:]*::)[0-9a-f:]{2,39})\]?(?=$|[^\p{L}\p{N}:])/iu;
const CLIENT_TEASER_INFRA_PATH_PATTERN = /(?:^|[^a-z0-9])(?:(?:[a-z]:)?[\\/]{1,2}(?=[a-z0-9._~-])|[a-z0-9][a-z0-9._~-]*(?:[\\/][a-z0-9._~/?#=&-]*|[?#][a-z0-9._~%=&-]+))/iu;
const CLIENT_TEASER_CREDENTIAL_PATTERN = /(?:^|[^a-z0-9])(?:CH|AR)[ \-\u2010-\u2015\u2212]*(?:[a-f0-9][ \-\u2010-\u2015\u2212]*){32}(?=$|[^a-f0-9])/iu;
const CLIENT_TEASER_CURRENCY_SYMBOL_PATTERN = /\p{Sc}/u;
const CLIENT_TEASER_CURRENCY_CODES = new Set<string>([
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
const CLIENT_TEASER_CURRENCY_CODE_AMOUNT_PATTERN = /\b(?:\d[\d.,]*\s*[A-Z]{3}|[A-Z]{3}\s*\d[\d.,]*)\b/u;
const CLIENT_TEASER_CURRENCY_CODE_AMOUNT_CANDIDATE_PATTERN = /\b(?:\d[\d.,]*\s*([a-z]{3})|([a-z]{3})\s*\d[\d.,]*)\b/giu;
const CLIENT_TEASER_CURRENCY_WORD_AFTER_AMOUNT_PATTERN = /\b\d[\d.,]*\s*(\p{L}+)\b/giu;
const CLIENT_TEASER_CURRENCY_WORD_BEFORE_AMOUNT_PATTERN = /\b(\p{L}+)\s*\d[\d.,]*\b/giu;
const CLIENT_TEASER_POUND_COMMERCIAL_AMOUNT_PATTERN = /\b(?:available\s+for|buy\s+for|disponible\s+por|comprar?\s+por)\s+\d[\d.,]*\s*(?:pounds?|libras?)\b/iu;
const CLIENT_TEASER_COMMERCIAL_TERM_ALTERNATION = CLIENT_CATALOG_COMMERCIAL_TERMS.join('|');
const CLIENT_TEASER_PRICE_PATTERN = new RegExp(
  String.raw`\b(?:${CLIENT_TEASER_COMMERCIAL_TERM_ALTERNATION})\b|\b(?:per\s+month|por\s+mes)\b`,
  'iu',
);
const CLIENT_TEASER_FREE_ACCESS_PATTERN = /(?:(?<![-\p{L}\p{N}])(?:free|gratis|complimentary)\b(?=[^.!?\n]{0,80}\b(?:access|resources?|memberships?|accesos?|recursos?|membres[ií]as?)\b)|\b(?:access|resources?|memberships?|accesos?|recursos?|membres[ií]as?)\b(?=[^.!?\n]{0,80}(?<![-\p{L}\p{N}])(?:free|gratis|complimentary)\b))/iu;
const CLIENT_TEASER_SALE_PATTERN = /\b(?:(?:sale|sales)\s+available|(?:for|on)\s+sale)\b/iu;
const CLIENT_TEASER_IAP_COMMERCIAL_PATTERN = /\b(?:iap\s+(?:available|enabled)|(?:available|enabled)\s+iap)\b/iu;
const REVIEW_SANDBOX_CATALOG_ID_PREFIX = 'review-sandbox-';
const PERMANENTLY_RETIRED_CATALOG_IDS = new Set([
  'health-advisor',
  'ai-cosmetic-scan',
  'service-hub',
  'sleep-lab',
]);

export type CatalogItemIcon = (typeof CATALOG_ITEM_ICONS)[number];
export type CatalogItemAccess = 'public' | 'clients';

export interface LocalizedCatalogText {
  readonly en: string;
  readonly 'es-MX': string;
}

export interface CatalogItemDetailsInput {
  readonly access: CatalogItemAccess;
  readonly icon: CatalogItemIcon;
  readonly summary: LocalizedCatalogText;
  readonly title: LocalizedCatalogText;
  readonly url: string;
}

export interface CatalogItemInput extends CatalogItemDetailsInput {
  readonly active: boolean;
}

export interface CatalogItem extends CatalogItemInput {
  readonly createdAtMs: number;
  readonly id: string;
  readonly revision: number;
  readonly updatedAtMs: number;
}

export interface CatalogItemGateway {
  list(): Promise<readonly CatalogItem[]>;
  create(item: CatalogItemInput): Promise<CatalogItem>;
  update(id: string, revision: number, item: CatalogItemDetailsInput): Promise<CatalogItem>;
  setActive(id: string, revision: number, active: boolean): Promise<CatalogItem>;
  delete(id: string, revision: number): Promise<void>;
}

export interface CatalogItemModel {
  getSnapshot(): Readonly<{ items: readonly CatalogItem[] }>;
  load(): Promise<void>;
  create(item: CatalogItemInput): Promise<CatalogItem>;
  update(id: string, revision: number, item: CatalogItemDetailsInput): Promise<CatalogItem>;
  setActive(id: string, revision: number, active: boolean): Promise<CatalogItem>;
  delete(id: string, revision: number): Promise<void>;
}

export function createCatalogItemGateway(input: Readonly<{
  session: ServerStaffSession;
  transport: CallableTransport;
}>): CatalogItemGateway {
  return Object.freeze({
    list: async () => {
      assertCatalogAdministrationAllowed(input.session);
      return parseCatalogItemList(await input.transport('adminListCatalogItems', {}));
    },
    create: async (item: CatalogItemInput) => {
      assertCatalogAdministrationAllowed(input.session);
      const normalized = validateCatalogItemInput(item);
      return parseCreatedCatalogItemMutation(await invokeIdempotentMutation(input.transport, 'adminCreateCatalogItem', {
        item: normalized,
      }), normalized);
    },
    update: async (id: string, revision: number, item: CatalogItemDetailsInput) => {
      assertCatalogAdministrationAllowed(input.session);
      assertCatalogMutationIdentity(id, revision);
      const normalized = validateCatalogItemDetails(item);
      return parseUpdatedCatalogItemMutation(await invokeIdempotentMutation(input.transport, 'adminUpdateCatalogItem', {
        id,
        revision,
        item: normalized,
      }), id, revision, normalized);
    },
    setActive: async (id: string, revision: number, active: boolean) => {
      assertCatalogAdministrationAllowed(input.session);
      assertCatalogMutationIdentity(id, revision);
      if (typeof active !== 'boolean') throw new Error('catalog_item_active_invalid');
      return parseActivatedCatalogItemMutation(await invokeIdempotentMutation(input.transport, 'adminSetCatalogItemActive', {
        id,
        revision,
        active,
      }), id, revision, active);
    },
    delete: async (id: string, revision: number) => {
      assertCatalogAdministrationAllowed(input.session);
      assertCatalogMutationIdentity(id, revision);
      const result = await invokeIdempotentMutation(input.transport, 'adminDeleteCatalogItem', {
        id,
        revision,
      });
      if (!hasExactKeys(result, ['deleted']) || result.deleted !== true) {
        throw new Error('catalog_item_response_invalid');
      }
    },
  });
}

async function invokeIdempotentMutation(
  transport: CallableTransport,
  name: string,
  mutation: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const payload = Object.freeze({
    requestId: globalThis.crypto.randomUUID(),
    ...mutation,
  });
  try {
    return await transport(name, payload);
  } catch (error) {
    if (!isLostNetworkError(error)) throw error;
    return transport(name, payload);
  }
}

function isLostNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'functions/unavailable' || code === 'functions/deadline-exceeded';
}

export function createCatalogItemModel(gateway: CatalogItemGateway): CatalogItemModel {
  let snapshot: Readonly<{ items: readonly CatalogItem[] }> = Object.freeze({
    items: Object.freeze([]),
  });
  const setItems = (items: readonly CatalogItem[]) => {
    snapshot = Object.freeze({ items: Object.freeze([...items]) });
  };
  const replace = (updated: CatalogItem) => {
    setItems(snapshot.items.map((item) => item.id === updated.id ? updated : item));
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    load: async () => { setItems(await gateway.list()); },
    create: async (item: CatalogItemInput) => {
      const normalized = validateCatalogItemInput(item);
      const created = correlateCreatedCatalogItem(
        parseCatalogItem(await gateway.create(normalized)),
        normalized,
      );
      if (snapshot.items.some((candidate) => candidate.id === created.id)) {
        throw new Error('catalog_item_response_invalid');
      }
      setItems([...snapshot.items, created]);
      return created;
    },
    update: async (id: string, revision: number, item: CatalogItemDetailsInput) => {
      const stored = snapshot.items.find((candidate) => candidate.id === id);
      if (!stored) throw new Error('catalog_item_not_found');
      if (item.url !== stored.url) {
        throw new Error('catalog_item_url_immutable');
      }
      const normalized = validateCatalogItemDetails(item);
      const updated = correlateUpdatedCatalogItem(
        parseCatalogItem(await gateway.update(id, revision, normalized)),
        id,
        revision,
        normalized,
        stored,
      );
      replace(updated);
      return updated;
    },
    setActive: async (id: string, revision: number, active: boolean) => {
      const stored = snapshot.items.find((candidate) => candidate.id === id);
      if (!stored) throw new Error('catalog_item_not_found');
      const updated = correlateActivatedCatalogItem(
        parseCatalogItem(await gateway.setActive(id, revision, active)),
        id,
        revision,
        active,
        stored,
      );
      replace(updated);
      return updated;
    },
    delete: async (id: string, revision: number) => {
      await gateway.delete(id, revision);
      setItems(snapshot.items.filter((item) => item.id !== id));
    },
  });
}

export function validateCatalogItemInput(value: unknown): CatalogItemInput {
  if (!hasExactKeys(value, ['access', 'active', 'icon', 'summary', 'title', 'url'])
    || typeof value.active !== 'boolean') {
    throw new Error('catalog_item_fields_invalid');
  }
  return Object.freeze({
    ...validateCatalogItemDetails({
      access: value.access,
      icon: value.icon,
      summary: value.summary,
      title: value.title,
      url: value.url,
    }),
    active: value.active,
  });
}

function parseCatalogItemList(value: unknown): readonly CatalogItem[] {
  if (!hasExactKeys(value, ['items'])
    || !Array.isArray(value.items)
    || value.items.length > 12) {
    throw new Error('catalog_item_response_invalid');
  }
  const items = value.items.map(parseCatalogItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error('catalog_item_response_invalid');
  }
  return Object.freeze(items);
}

function parseCatalogItemMutation(value: unknown): CatalogItem {
  if (!hasExactKeys(value, ['item'])) {
    throw new Error('catalog_item_response_invalid');
  }
  return parseCatalogItem(value.item);
}

function parseCreatedCatalogItemMutation(
  value: unknown,
  expected: CatalogItemInput,
): CatalogItem {
  return correlateCreatedCatalogItem(parseCatalogItemMutation(value), expected);
}

function parseUpdatedCatalogItemMutation(
  value: unknown,
  id: string,
  revision: number,
  expected: CatalogItemDetailsInput,
): CatalogItem {
  return correlateUpdatedCatalogItem(
    parseCatalogItemMutation(value),
    id,
    revision,
    expected,
  );
}

function parseActivatedCatalogItemMutation(
  value: unknown,
  id: string,
  revision: number,
  active: boolean,
): CatalogItem {
  return correlateActivatedCatalogItem(
    parseCatalogItemMutation(value),
    id,
    revision,
    active,
  );
}

function correlateCreatedCatalogItem(
  item: CatalogItem,
  expected: CatalogItemInput,
): CatalogItem {
  const destination = parseSafeCatalogUrl(expected.url);
  if (!destination
    || item.revision !== 1
    || item.createdAtMs !== item.updatedAtMs
    || !catalogInputMatches(item, expected)
    || (destination.kind === 'cabohealth'
      ? item.id !== destination.id
      : !EXTERNAL_CATALOG_ID_PATTERN.test(item.id))) {
    throw new Error('catalog_item_response_invalid');
  }
  return item;
}

function correlateUpdatedCatalogItem(
  item: CatalogItem,
  id: string,
  revision: number,
  expected: CatalogItemDetailsInput,
  stored?: CatalogItem,
): CatalogItem {
  if (item.id !== id
    || item.revision !== revision + 1
    || !catalogDetailsMatch(item, expected)
    || (stored !== undefined
      && (item.active !== stored.active
        || item.createdAtMs !== stored.createdAtMs
        || item.updatedAtMs < stored.updatedAtMs))) {
    throw new Error('catalog_item_response_invalid');
  }
  return item;
}

function correlateActivatedCatalogItem(
  item: CatalogItem,
  id: string,
  revision: number,
  active: boolean,
  stored?: CatalogItem,
): CatalogItem {
  if (item.id !== id
    || item.revision !== revision + 1
    || item.active !== active
    || (stored !== undefined
      && (!catalogDetailsMatch(item, stored)
        || item.createdAtMs !== stored.createdAtMs
        || item.updatedAtMs < stored.updatedAtMs))) {
    throw new Error('catalog_item_response_invalid');
  }
  return item;
}

function catalogInputMatches(
  item: CatalogItem,
  expected: CatalogItemInput,
): boolean {
  return item.active === expected.active && catalogDetailsMatch(item, expected);
}

function catalogDetailsMatch(
  item: CatalogItemDetailsInput,
  expected: CatalogItemDetailsInput,
): boolean {
  return item.access === expected.access
    && item.icon === expected.icon
    && item.url === expected.url
    && localizedCatalogTextMatches(item.summary, expected.summary)
    && localizedCatalogTextMatches(item.title, expected.title);
}

function localizedCatalogTextMatches(
  value: LocalizedCatalogText,
  expected: LocalizedCatalogText,
): boolean {
  return value.en === expected.en && value['es-MX'] === expected['es-MX'];
}

function parseCatalogItem(value: unknown): CatalogItem {
  if (!hasExactKeys(value, [
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
  ])
    || !isCatalogItemId(value.id)
    || typeof value.active !== 'boolean'
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !Number.isSafeInteger(value.createdAtMs)
    || Object.is(value.createdAtMs, -0)
    || (value.createdAtMs as number) < 0
    || !Number.isSafeInteger(value.updatedAtMs)
    || Object.is(value.updatedAtMs, -0)
    || (value.updatedAtMs as number) < (value.createdAtMs as number)) {
    throw new Error('catalog_item_response_invalid');
  }
  try {
    const details = parseCatalogItemDetails({
      access: value.access,
      icon: value.icon,
      summary: value.summary,
      title: value.title,
      url: value.url,
    });
    const destination = parseSafeCatalogUrl(details.url);
    if (details.url !== value.url
      || !destination
      || (destination.kind === 'cabohealth'
        ? destination.id !== value.id || EXTERNAL_CATALOG_ID_PATTERN.test(value.id as string)
        : !EXTERNAL_CATALOG_ID_PATTERN.test(value.id as string))) {
      throw new Error('catalog_item_response_invalid');
    }
    return Object.freeze({
      ...details,
      active: value.active,
      createdAtMs: value.createdAtMs as number,
      id: value.id,
      revision: value.revision as number,
      updatedAtMs: value.updatedAtMs as number,
    });
  } catch {
    throw new Error('catalog_item_response_invalid');
  }
}

export function validateCatalogItemDetails(value: unknown): CatalogItemDetailsInput {
  const details = parseCatalogItemDetails(value);
  if (details.access === 'clients') {
    const destination = parseSafeCatalogUrl(details.url);
    if (destination?.kind === 'cabohealth' && isRestrictedClientCatalogId(destination.id)) {
      throw new Error('catalog_item_url_invalid');
    }
    if (containsSensitiveClientTeaserCopy(details.summary.en)
      || containsSensitiveClientTeaserCopy(details.summary['es-MX'])
      || containsSensitiveClientTeaserCopy(details.title.en)
      || containsSensitiveClientTeaserCopy(details.title['es-MX'])) {
      throw new Error('catalog_item_text_invalid');
    }
  }
  return details;
}

function parseCatalogItemDetails(value: unknown): CatalogItemDetailsInput {
  if (!hasExactKeys(value, ['access', 'icon', 'summary', 'title', 'url'])) {
    throw new Error('catalog_item_fields_invalid');
  }
  if (value.access !== 'public' && value.access !== 'clients') {
    throw new Error('catalog_item_access_invalid');
  }
  if (!CATALOG_ITEM_ICONS.includes(value.icon as CatalogItemIcon)) {
    throw new Error('catalog_item_icon_invalid');
  }
  return Object.freeze({
    access: value.access,
    icon: value.icon as CatalogItemIcon,
    summary: parseLocalizedText(value.summary, 240),
    title: parseLocalizedText(value.title, 80),
    url: parseCatalogUrl(value.url, value.access),
  });
}

export function isCatalogRevisionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 'functions/aborted'
    || candidate.code === 'functions/failed-precondition'
    || candidate.code === 'catalog_item_conflict') return true;
  return typeof candidate.message === 'string'
    && /(?:catalog_item_)?(?:revision_)?conflict/iu.test(candidate.message);
}

export function isCatalogItemUrlInvalid(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 'catalog_item_url_invalid'
    || candidate.code === 'catalog_item_url_immutable') return true;
  return typeof candidate.message === 'string'
    && /catalog_item_url_(?:invalid|immutable)/u.test(candidate.message);
}

function assertCatalogMutationIdentity(id: string, revision: number): void {
  if (!isCatalogItemId(id)
    || PERMANENTLY_RETIRED_CATALOG_IDS.has(id)
    || id.startsWith(REVIEW_SANDBOX_CATALOG_ID_PREFIX)
    || !Number.isSafeInteger(revision)
    || revision < 1) {
    throw new Error('catalog_item_identity_invalid');
  }
}

function parseCatalogUrl(value: unknown, access: CatalogItemAccess): string {
  const parsed = parseSafeCatalogUrl(value);
  if (!parsed
    || (parsed.kind === 'cabohealth'
      && parsed.id === 'client-resources'
      && access !== 'clients')) {
    throw new Error('catalog_item_url_invalid');
  }
  return parsed.url;
}

function isCatalogItemId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= CATALOG_ITEM_ID_MAX_LENGTH
    && CATALOG_ITEM_ID_PATTERN.test(value);
}

function isRestrictedClientCatalogId(value: string): boolean {
  const segments = value.split('-');
  return CLIENT_TEASER_CREDENTIAL_PATTERN.test(value)
    || (segments.includes('iap')
      && segments.some((segment) => CLIENT_CATALOG_IAP_ID_CONTEXT_SEGMENTS.has(segment)))
    || (segments.some((segment) => CLIENT_CATALOG_FREE_ID_SEGMENTS.has(segment))
      && segments.some((segment) => CLIENT_CATALOG_FREE_ID_CONTEXT_SEGMENTS.has(segment)))
    || segments.some((segment, index) => CLIENT_CATALOG_COMMERCIAL_ID_SEGMENTS.has(segment)
      || CLIENT_CATALOG_SALE_ID_SEGMENTS.has(segment)
      || containsClientCatalogNumberedPricingSegment(segments, segment, index)
      || containsClientCatalogCurrencyAmountSegment(segments, segment, index));
}

function containsClientCatalogNumberedPricingSegment(
  segments: readonly string[],
  segment: string,
  index: number,
): boolean {
  const match = CLIENT_CATALOG_ID_NUMBERED_TOKEN_PATTERN.exec(segment);
  const token = match?.[1] ?? match?.[2];
  return Boolean(token
    && !isClientCatalogBenignCurrencySegment(token, segments, index)
    && (CLIENT_TEASER_CURRENCY_CODES.has(token.toUpperCase())
      || CLIENT_CATALOG_CURRENCY_ID_WORDS.has(token)
      || CLIENT_CATALOG_COMMERCIAL_ID_SEGMENTS.has(token)
      || CLIENT_CATALOG_SALE_ID_SEGMENTS.has(token)));
}

function containsClientCatalogCurrencyAmountSegment(
  segments: readonly string[],
  segment: string,
  index: number,
): boolean {
  const hasAdjacentAmount = CLIENT_CATALOG_ID_NUMBER_PATTERN.test(segments[index - 1] ?? '')
    || CLIENT_CATALOG_ID_NUMBER_PATTERN.test(segments[index + 1] ?? '');
  if (!hasAdjacentAmount) return false;
  if (CLIENT_TEASER_CURRENCY_CODES.has(segment.toUpperCase())) return true;
  if (!CLIENT_CATALOG_CURRENCY_ID_WORDS.has(segment)) return false;
  return !isClientCatalogBenignCurrencySegment(segment, segments, index);
}

function isClientCatalogBenignCurrencySegment(
  segment: string,
  segments: readonly string[],
  index: number,
): boolean {
  return ((segment === 'peso' || segment === 'pesos') && segments[index + 1] === 'libres')
    || (segment === 'real' && segments[index + 1] === 'world');
}

function parseLocalizedText(
  value: unknown,
  maxLength: number,
): LocalizedCatalogText {
  if (!hasExactKeys(value, ['en', 'es-MX'])) throw new Error('catalog_item_text_invalid');
  const rawEn = typeof value.en === 'string' ? value.en : '';
  const rawEsMx = typeof value['es-MX'] === 'string' ? value['es-MX'] : '';
  if (CATALOG_TEXT_CONTROL_PATTERN.test(rawEn)
    || CATALOG_TEXT_CONTROL_PATTERN.test(rawEsMx)) {
    throw new Error('catalog_item_text_invalid');
  }
  const en = rawEn.trim();
  const esMx = rawEsMx.trim();
  if (en === ''
    || esMx === ''
    || en.length > maxLength
    || esMx.length > maxLength) {
    throw new Error('catalog_item_text_invalid');
  }
  return Object.freeze({ en, 'es-MX': esMx });
}

function containsClientTeaserCurrencyCodeAmount(value: string): boolean {
  if (CLIENT_TEASER_CURRENCY_CODE_AMOUNT_PATTERN.test(value)) return true;
  for (const match of value.matchAll(CLIENT_TEASER_CURRENCY_CODE_AMOUNT_CANDIDATE_PATTERN)) {
    const code = match[1] ?? match[2];
    if (code
      && CLIENT_TEASER_CURRENCY_CODES.has(code.toUpperCase())
      && !isBenignClientTeaserTryAmount(value, match)) return true;
  }
  return false;
}

function isBenignClientTeaserTryAmount(value: string, match: RegExpMatchArray): boolean {
  if (match[2]?.toLocaleLowerCase('en-US') !== 'try') return false;
  const trailingText = value.slice((match.index ?? 0) + match[0].length);
  return /^\s+(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|exercises?|reps?|steps?)\b/iu.test(trailingText);
}

function containsClientTeaserCurrencyWordAmount(value: string): boolean {
  for (const pattern of [
    CLIENT_TEASER_CURRENCY_WORD_AFTER_AMOUNT_PATTERN,
    CLIENT_TEASER_CURRENCY_WORD_BEFORE_AMOUNT_PATTERN,
  ]) {
    for (const match of value.matchAll(pattern)) {
      const word = match[1]?.toLocaleLowerCase('es-MX');
      if (!word || !CLIENT_CATALOG_CURRENCY_ID_WORDS.has(word)) continue;
      const trailingText = value.slice((match.index ?? 0) + match[0].length);
      if (((word === 'peso' || word === 'pesos') && /^\s+libres\b/iu.test(trailingText))
        || (word === 'real' && /^-world\b/iu.test(trailingText))) continue;
      return true;
    }
  }
  return CLIENT_TEASER_POUND_COMMERCIAL_AMOUNT_PATTERN.test(value);
}

function containsClientTeaserFreeAccess(value: string): boolean {
  const withoutFreeWeightPhrases = value.replace(
    /\bfree\s+weights?\b/giu,
    'weight exercise',
  );
  return CLIENT_TEASER_FREE_ACCESS_PATTERN.test(withoutFreeWeightPhrases);
}

function containsSensitiveClientTeaserCopy(value: string): boolean {
  return CLIENT_TEASER_CREDENTIAL_PATTERN.test(value)
    || CLIENT_TEASER_CURRENCY_SYMBOL_PATTERN.test(value)
    || containsClientTeaserCurrencyCodeAmount(value)
    || containsClientTeaserCurrencyWordAmount(value)
    || containsClientTeaserFreeAccess(value)
    || CLIENT_TEASER_FORMAT_PATTERN.test(value)
    || CLIENT_TEASER_INFRA_PATH_PATTERN.test(value)
    || CLIENT_TEASER_IP_HOST_PATTERN.test(value)
    || CLIENT_TEASER_IPV6_HOST_PATTERN.test(value)
    || CLIENT_TEASER_IAP_COMMERCIAL_PATTERN.test(value)
    || CLIENT_TEASER_PRICE_PATTERN.test(value)
    || CLIENT_TEASER_SALE_PATTERN.test(value)
    || CLIENT_TEASER_URI_PATTERN.test(value)
    || CLIENT_TEASER_BARE_DOMAIN_PATTERN.test(value);
}

function assertCatalogAdministrationAllowed(session: ServerStaffSession): void {
  if (session.scope !== 'production'
    || !session.permissions.includes('client_resource_publish')) {
    throw new Error('staff_capability_unavailable');
  }
}

function hasExactKeys(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && fields.every((field, index) => keys[index] === field);
}
