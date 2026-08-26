import { createHash } from 'node:crypto';

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

export function isPermanentlyRetiredCatalogId(value: unknown): boolean {
  return typeof value === 'string' && PERMANENTLY_RETIRED_CATALOG_ID_SET.has(value);
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
  }>): Promise<CatalogItemView | 'conflict' | 'not_found'>;
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
    const createdAtMs = validNow(this.#nowMs());
    const id = catalogIdFromUrl(normalized.url);
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
      items: Object.freeze(snapshot.items.filter((item) => item.active && item.access === 'public')),
      revision: snapshot.revision,
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
    if (catalogIdFromUrl(normalized.url) !== id) throw new CatalogInputError();
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
    if (result === 'not_found') throw new CatalogNotFoundError();
    return result;
  }
}

const INPUT_FIELDS = Object.freeze(['access', 'active', 'icon', 'summary', 'title', 'url']);

export function validateCatalogItemInput(value: unknown): CatalogItemInput {
  if (!hasExactKeys(value, INPUT_FIELDS)
    || (value.access !== 'public' && value.access !== 'clients')
    || typeof value.active !== 'boolean'
    || !(CATALOG_ICONS as readonly unknown[]).includes(value.icon)) {
    throw new CatalogInputError();
  }
  const url = normalizeCatalogUrl(value.url);
  assertCatalogRoutePolicy(url, value.access);
  return Object.freeze({
    access: value.access,
    active: value.active,
    icon: value.icon as CatalogIcon,
    summary: parseLocalizedText(value.summary, 240),
    title: parseLocalizedText(value.title, 80),
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
  if (typeof value !== 'string'
    || value.length > 2_048
    || /[\u0000-\u0020\u007f\\%?#]/u.test(value)) {
    throw new CatalogInputError();
  }
  catalogIdFromUrl(value);
  return value;
}

function assertCatalogRoutePolicy(url: string, access: CatalogAccess): void {
  const id = catalogIdFromUrl(url);
  if (isPermanentlyRetiredCatalogId(id)
    || id === 'app-review'
    || id === 'shared'
    || (id === 'client-resources' && access !== 'clients')) {
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

function validNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_server_time');
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
