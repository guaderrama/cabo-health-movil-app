import { createHash } from 'node:crypto';

import {
  catalogIdentityMatches,
  externalCatalogIdFromRequestId,
  isLegacyCompatibleCatalogUrl,
  parseSafeCatalogUrl,
} from './catalogUrlPolicy.js';

export const CATALOG_ICONS = Object.freeze([
  'laboratory',
  'guide',
  'nutrition',
  'recipes',
  'wellness',
  'location',
  'contact',
  'featured',
] as const);

export type CatalogIcon = typeof CATALOG_ICONS[number];
export type CatalogAccess = 'public' | 'clients';
export const CATALOG_ID_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const PERMANENTLY_RETIRED_CATALOG_IDS = Object.freeze([
  'health-advisor',
  'ai-cosmetic-scan',
  'service-hub',
  'sleep-lab',
] as const);
const PERMANENTLY_RETIRED_CATALOG_ID_SET = new Set<string>(
  PERMANENTLY_RETIRED_CATALOG_IDS,
);
const REVIEW_SANDBOX_CATALOG_ID_PREFIX = 'review-sandbox-';
const GLOBALLY_RESERVED_CATALOG_IDS = new Set<string>(['app-review', 'shared']);

export function isPermanentlyRetiredCatalogId(value: unknown): boolean {
  return typeof value === 'string' && PERMANENTLY_RETIRED_CATALOG_ID_SET.has(value);
}

export function isGloballyReservedCatalogId(value: unknown): boolean {
  return typeof value === 'string'
    && (isPermanentlyRetiredCatalogId(value)
      || value.startsWith(REVIEW_SANDBOX_CATALOG_ID_PREFIX)
      || GLOBALLY_RESERVED_CATALOG_IDS.has(value));
}

export interface LocalizedCatalogText {
  readonly en: string;
  readonly 'es-MX': string;
}

export interface CatalogItemInput {
  readonly access: CatalogAccess;
  readonly active: boolean;
  readonly icon: CatalogIcon;
  readonly summary: LocalizedCatalogText;
  readonly title: LocalizedCatalogText;
  readonly url: string;
}

export type CatalogItemDetailsInput = Readonly<Omit<CatalogItemInput, 'active'>>;

export interface CatalogItemView extends CatalogItemInput {
  readonly createdAtMs: number;
  readonly id: string;
  readonly revision: number;
  readonly updatedAtMs: number;
}

export interface CatalogSnapshot {
  readonly items: readonly CatalogItemView[];
  readonly revision: number;
  readonly updatedAtMs: number;
}

export interface PublishedClientPreview {
  readonly access: 'clients';
  readonly icon: CatalogIcon;
  readonly id: string;
  readonly summary: LocalizedCatalogText;
  readonly title: LocalizedCatalogText;
}

export interface PublishedCatalogSnapshot extends CatalogSnapshot {
  readonly clientPreviews: readonly PublishedClientPreview[];
}

export interface PublishedCatalogV3 {
  readonly clientPreviews: readonly PublishedClientPreview[];
  readonly items: readonly (CatalogItemView & Readonly<{
    destinationKind: 'cabohealth' | 'external_https';
  }>)[];
  readonly revision: number;
  readonly schemaVersion: 3;
  readonly updatedAtMs: number;
}

export type CatalogAuditAction =
  | 'miniapp.created'
  | 'miniapp.updated'
  | 'miniapp.activated'
  | 'miniapp.deactivated'
  | 'miniapp.deleted';

export interface CatalogMutationContext {
  readonly actorUid: string;
  readonly requestId: string;
}

export interface CatalogMutationRecord {
  readonly action: CatalogAuditAction;
  readonly actorUid: string;
  readonly auditEventId: string;
  readonly expiresAtMs: number;
  readonly fingerprint: string;
  readonly occurredAtMs: number;
  readonly requestId: string;
  readonly targetId: string;
}

export interface CatalogCreateRecord extends CatalogItemInput {
  readonly createdAtMs: number;
  readonly id: string;
  readonly mutation: CatalogMutationRecord;
}

export interface CatalogStore {
  create(record: CatalogCreateRecord): Promise<CatalogItemView | 'conflict' | 'limit'>;
  delete(command: Readonly<{
    id: string;
    mutation: CatalogMutationRecord;
    revision: number;
  }>): Promise<'deleted' | 'conflict' | 'not_found'>;
  list(): Promise<readonly CatalogItemView[]>;
  listActive(): Promise<readonly CatalogItemView[]>;
  snapshot(): Promise<CatalogSnapshot>;
  setActive(command: Readonly<{
    active: boolean;
    id: string;
    mutation: CatalogMutationRecord;
    revision: number;
  }>): Promise<CatalogItemView | 'conflict' | 'not_found'>;
  update(command: Readonly<{
    details: CatalogItemDetailsInput;
    id: string;
    mutation: CatalogMutationRecord;
    revision: number;
  }>): Promise<CatalogItemView | 'conflict' | 'immutable_url' | 'not_found'>;
}

export class CatalogInputError extends Error {
  constructor() {
    super('invalid_admin_input');
    this.name = 'CatalogInputError';
  }
}

export class CatalogConflictError extends Error {
  constructor() {
    super('catalog_item_conflict');
    this.name = 'CatalogConflictError';
  }
}

export class CatalogLimitError extends Error {
  constructor() {
    super('catalog_item_limit');
    this.name = 'CatalogLimitError';
  }
}

export class CatalogNotFoundError extends Error {
  constructor() {
    super('catalog_item_not_found');
    this.name = 'CatalogNotFoundError';
  }
}

export class CatalogAdminService {
  readonly #nowMs: () => number;
  readonly #store: CatalogStore;

  constructor(dependencies: Readonly<{
    nowMs?: () => number;
    store: CatalogStore;
  }>) {
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#store = dependencies.store;
  }

  async create(
    input: CatalogItemInput,
    context: CatalogMutationContext,
  ): Promise<CatalogItemView> {
    const normalized = validateCatalogItemInput(input);
    assertSafeClientPreviewInput(normalized);
    const createdAtMs = validNow(this.#nowMs());
    const destination = parseSafeCatalogUrl(normalized.url);
    if (!destination) throw new CatalogInputError();
    const id = destination.kind === 'cabohealth'
      ? destination.id
      : externalCatalogIdFromRequestId(context.requestId);
    const result = await this.#store.create(Object.freeze({
      ...normalized,
      createdAtMs,
      id,
      mutation: catalogMutation(
        'miniapp.created',
        id,
        normalized,
        context,
        createdAtMs,
      ),
    }));
    if (result === 'conflict') throw new CatalogConflictError();
    if (result === 'limit') throw new CatalogLimitError();
    return result;
  }

  async delete(
    id: string,
    revision: number,
    context: CatalogMutationContext,
  ): Promise<void> {
    assertMutationIdentity(id, revision);
    const occurredAtMs = validNow(this.#nowMs());
    const result = await this.#store.delete(Object.freeze({
      id,
      mutation: catalogMutation(
        'miniapp.deleted',
        id,
        { revision },
        context,
        occurredAtMs,
      ),
      revision,
    }));
    if (result === 'conflict') throw new CatalogConflictError();
    if (result === 'not_found') throw new CatalogNotFoundError();
  }

  listActive(): Promise<readonly CatalogItemView[]> {
    return this.#store.listActive();
  }

  list(): Promise<readonly CatalogItemView[]> {
    return this.#store.list();
  }

  async publishedCatalog(): Promise<CatalogSnapshot> {
    const snapshot = await this.#store.snapshot();
    return Object.freeze({
      items: Object.freeze(snapshot.items.filter((item) => (
        item.active
        && item.access === 'public'
        && isLegacyCompatibleCatalogUrl(item.url)
      ))),
      revision: snapshot.revision,
      updatedAtMs: snapshot.updatedAtMs,
    });
  }

  async publishedShowcaseCatalog(): Promise<PublishedCatalogSnapshot> {
    const snapshot = await this.#store.snapshot();
    return Object.freeze({
      clientPreviews: Object.freeze(snapshot.items
        .filter((item) => (
          item.active
          && item.access === 'clients'
          && isLegacyCompatibleCatalogUrl(item.url)
        ))
        .map(publishedClientPreview)),
      items: Object.freeze(snapshot.items.filter((item) => (
        item.active
        && item.access === 'public'
        && isLegacyCompatibleCatalogUrl(item.url)
      ))),
      revision: snapshot.revision,
      updatedAtMs: snapshot.updatedAtMs,
    });
  }

  async publishedCatalogV3(): Promise<PublishedCatalogV3> {
    const snapshot = await this.#store.snapshot();
    return Object.freeze({
      clientPreviews: Object.freeze(snapshot.items
        .filter((item) => item.active && item.access === 'clients')
        .map(publishedClientPreview)),
      items: Object.freeze(snapshot.items
        .filter((item) => item.active && item.access === 'public')
        .map((item) => {
          const destination = parseSafeCatalogUrl(item.url);
          if (!destination) throw new CatalogInputError();
          return Object.freeze({ ...item, destinationKind: destination.kind });
        })),
      revision: snapshot.revision,
      schemaVersion: 3,
      updatedAtMs: snapshot.updatedAtMs,
    });
  }

  async setActive(
    id: string,
    revision: number,
    active: boolean,
    context: CatalogMutationContext,
  ): Promise<CatalogItemView> {
    assertMutationIdentity(id, revision);
    if (typeof active !== 'boolean') throw new CatalogInputError();
    if (active) {
      const current = (await this.#store.list()).find((item) => item.id === id);
      if (current?.revision === revision) assertSafeClientPreviewInput(current);
    }
    const occurredAtMs = validNow(this.#nowMs());
    const result = await this.#store.setActive(Object.freeze({
      active,
      id,
      mutation: catalogMutation(
        active ? 'miniapp.activated' : 'miniapp.deactivated',
        id,
        { active, revision },
        context,
        occurredAtMs,
      ),
      revision,
    }));
    if (result === 'conflict') throw new CatalogConflictError();
    if (result === 'not_found') throw new CatalogNotFoundError();
    return result;
  }

  async update(
    id: string,
    revision: number,
    details: CatalogItemDetailsInput,
    context: CatalogMutationContext,
  ): Promise<CatalogItemView> {
    assertMutationIdentity(id, revision);
    const normalized = validateCatalogItemDetailsInput(details);
    assertSafeClientPreviewInput(normalized);
    if (!catalogIdentityMatches(id, normalized.url)) throw new CatalogInputError();
    const occurredAtMs = validNow(this.#nowMs());
    const result = await this.#store.update(Object.freeze({
      details: normalized,
      id,
      mutation: catalogMutation(
        'miniapp.updated',
        id,
        { details: normalized, revision },
        context,
        occurredAtMs,
      ),
      revision,
    }));
    if (result === 'conflict') throw new CatalogConflictError();
    if (result === 'immutable_url') throw new CatalogInputError();
    if (result === 'not_found') throw new CatalogNotFoundError();
    return result;
  }
}

const INPUT_FIELDS = Object.freeze(['access', 'active', 'icon', 'summary', 'title', 'url']);
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
const CLIENT_PREVIEW_SALE_PATTERN = /\b(?:(?:sale|sales)\s+available|(?:for|on)\s+sale)\b/iu;
const CLIENT_PREVIEW_IAP_COMMERCIAL_PATTERN = /\b(?:iap\s+(?:available|enabled)|(?:available|enabled)\s+iap)\b/iu;
const CLIENT_PREVIEW_FREE_ACCESS_PATTERN = /(?:(?<![-\p{L}\p{N}])(?:free|gratis|complimentary)\b(?=[^.!?\n]{0,80}\b(?:access|resources?|memberships?|accesos?|recursos?|membres[ií]as?)\b)|\b(?:access|resources?|memberships?|accesos?|recursos?|membres[ií]as?)\b(?=[^.!?\n]{0,80}(?<![-\p{L}\p{N}])(?:free|gratis|complimentary)\b))/iu;
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
const EXACT_LEGACY_CLIENT_RESOURCES_SUMMARY = Object.freeze({
  en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
  'es-MX': 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
});
const NEUTRAL_CLIENT_RESOURCES_SUMMARY = Object.freeze({
  en: 'Educational resources for eligible existing CaboHealth clients.',
  'es-MX': 'Recursos educativos para clientes actuales elegibles de CaboHealth.',
});

export function validateCatalogItemInput(value: unknown): CatalogItemInput {
  if (!hasExactKeys(value, INPUT_FIELDS)
    || (value.access !== 'public' && value.access !== 'clients')
    || typeof value.active !== 'boolean'
    || !(CATALOG_ICONS as readonly unknown[]).includes(value.icon)) {
    throw new CatalogInputError();
  }
  const url = normalizeCatalogUrl(value.url);
  assertCatalogRoutePolicy(url, value.access);
  const summary = parseLocalizedText(value.summary, 240);
  const title = parseLocalizedText(value.title, 80);
  return Object.freeze({
    access: value.access,
    active: value.active,
    icon: value.icon as CatalogIcon,
    summary,
    title,
    url,
  });
}

const DETAILS_FIELDS = Object.freeze(['access', 'icon', 'summary', 'title', 'url']);

export function validateCatalogItemDetailsInput(value: unknown): CatalogItemDetailsInput {
  if (!hasExactKeys(value, DETAILS_FIELDS)) throw new CatalogInputError();
  const parsed = validateCatalogItemInput({ ...value, active: false });
  const { active: _active, ...details } = parsed;
  return Object.freeze(details);
}

export function catalogIdFromUrl(url: string): string {
  const match = /^https:\/\/cabohealth\.org\/apps\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/u.exec(url);
  if (!match || !CATALOG_ID_PATTERN.test(match[1]!)) throw new CatalogInputError();
  return match[1]!;
}

function normalizeCatalogUrl(value: unknown): string {
  const parsed = parseSafeCatalogUrl(value);
  if (!parsed) throw new CatalogInputError();
  return parsed.url;
}

function assertCatalogRoutePolicy(url: string, access: CatalogAccess): void {
  const destination = parseSafeCatalogUrl(url);
  if (!destination) throw new CatalogInputError();
  if (destination.kind === 'cabohealth'
    && (isGloballyReservedCatalogId(destination.id)
      || (destination.id === 'client-resources' && access !== 'clients'))) {
    throw new CatalogInputError();
  }
}

function parseLocalizedText(value: unknown, maxLength: number): LocalizedCatalogText {
  if (!hasExactKeys(value, ['en', 'es-MX'])) throw new CatalogInputError();
  const en = typeof value.en === 'string' ? value.en.trim() : '';
  const esMx = typeof value['es-MX'] === 'string' ? value['es-MX'].trim() : '';
  if (!en
    || !esMx
    || en.length > maxLength
    || esMx.length > maxLength
    || /[\u0000-\u001f\u007f]/u.test(en)
    || /[\u0000-\u001f\u007f]/u.test(esMx)) {
    throw new CatalogInputError();
  }
  return Object.freeze({ en, 'es-MX': esMx });
}

function containsCurrencyCodeAmount(text: string): boolean {
  if (CLIENT_PREVIEW_CURRENCY_CODE_AMOUNT_PATTERN.test(text)) return true;
  for (const match of text.matchAll(CLIENT_PREVIEW_CURRENCY_CODE_AMOUNT_CANDIDATE_PATTERN)) {
    const code = match[1] ?? match[2];
    if (code
      && CLIENT_PREVIEW_CURRENCY_CODES.has(code.toUpperCase())
      && !isBenignTryClinicalAmount(text, match)) return true;
  }
  return false;
}

function isBenignTryClinicalAmount(text: string, match: RegExpMatchArray): boolean {
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
  const withoutFreeWeightPhrases = text.replace(
    /\bfree\s+weights?\b/giu,
    'weight exercise',
  );
  return CLIENT_PREVIEW_FREE_ACCESS_PATTERN.test(withoutFreeWeightPhrases);
}

function assertSafeClientPreviewCopy(copy: LocalizedCatalogText): void {
  for (const text of [copy.en, copy['es-MX']]) {
    if (CLIENT_PREVIEW_FORMAT_CONTROL_PATTERN.test(text)
      || CLIENT_PREVIEW_URI_PATTERN.test(text)
      || CLIENT_PREVIEW_HOST_PATTERN.test(text)
      || CLIENT_PREVIEW_IP_HOST_PATTERN.test(text)
      || CLIENT_PREVIEW_IPV6_HOST_PATTERN.test(text)
      || CLIENT_PREVIEW_PRIVATE_PATH_PATTERN.test(text)
      || CLIENT_PREVIEW_CREDENTIAL_PATTERN.test(text)
      || CLIENT_PREVIEW_CURRENCY_SYMBOL_PATTERN.test(text)
      || containsCurrencyCodeAmount(text)
      || containsClientPreviewCurrencyWordAmount(text)
      || containsClientPreviewFreeAccess(text)
      || CLIENT_PREVIEW_IAP_COMMERCIAL_PATTERN.test(text)
      || CLIENT_PREVIEW_SALE_PATTERN.test(text)
      || CLIENT_PREVIEW_PRICE_PATTERN.test(text)) {
      throw new CatalogInputError();
    }
  }
}

function assertSafeClientPreviewInput(
  input: Readonly<Pick<CatalogItemInput, 'access' | 'summary' | 'title' | 'url'>>,
): void {
  if (input.access !== 'clients') return;
  const destination = parseSafeCatalogUrl(input.url);
  if (!destination
    || (destination.kind === 'cabohealth' && isUnsafeClientPreviewId(destination.id))) {
    throw new CatalogInputError();
  }
  assertSafeClientPreviewCopy(input.summary);
  assertSafeClientPreviewCopy(input.title);
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

function normalizeExactLegacyClientResourcesPreview(item: CatalogItemView): CatalogItemView {
  if (item.access !== 'clients'
    || item.icon !== 'featured'
    || item.id !== 'client-resources'
    || item.url !== 'https://cabohealth.org/apps/client-resources/'
    || item.title.en !== 'Client Resources'
    || item.title['es-MX'] !== 'Recursos para clientes'
    || item.summary.en !== EXACT_LEGACY_CLIENT_RESOURCES_SUMMARY.en
    || item.summary['es-MX'] !== EXACT_LEGACY_CLIENT_RESOURCES_SUMMARY['es-MX']) {
    return item;
  }
  return Object.freeze({ ...item, summary: NEUTRAL_CLIENT_RESOURCES_SUMMARY });
}

function publishedClientPreview(item: CatalogItemView): PublishedClientPreview {
  const previewItem = normalizeExactLegacyClientResourcesPreview(item);
  assertSafeClientPreviewInput(previewItem);
  return Object.freeze({
    access: 'clients',
    icon: previewItem.icon,
    id: previewItem.id,
    summary: previewItem.summary,
    title: previewItem.title,
  });
}

function validNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new Error('invalid_server_time');
  }
  return value;
}

const MUTATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

function catalogMutation(
  action: CatalogAuditAction,
  targetId: string,
  payload: unknown,
  context: CatalogMutationContext,
  occurredAtMs: number,
): CatalogMutationRecord {
  if (!hasExactKeys(context, ['actorUid', 'requestId'])
    || typeof context.actorUid !== 'string'
    || !/^[A-Za-z0-9:_-]{1,128}$/u.test(context.actorUid)
    || typeof context.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(context.requestId)) {
    throw new CatalogInputError();
  }
  const fingerprint = createHash('sha256')
    .update('cabohealth/catalog-mutation/v1\0', 'utf8')
    .update(JSON.stringify({ action, payload, targetId }), 'utf8')
    .digest('base64url');
  return Object.freeze({
    action,
    actorUid: context.actorUid,
    auditEventId: `evt_${context.requestId.replaceAll('-', '')}`,
    expiresAtMs: occurredAtMs + MUTATION_RETENTION_MS,
    fingerprint,
    occurredAtMs,
    requestId: context.requestId,
    targetId,
  });
}

function assertMutationIdentity(id: string, revision: number): void {
  if (!CATALOG_ID_PATTERN.test(id)
    || isPermanentlyRetiredCatalogId(id)
    || id.startsWith(REVIEW_SANDBOX_CATALOG_ID_PREFIX)
    || !Number.isSafeInteger(revision)
    || revision < 1) throw new CatalogInputError();
}

function hasExactKeys(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}
