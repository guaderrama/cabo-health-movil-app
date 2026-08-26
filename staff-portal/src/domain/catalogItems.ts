import type {
  CallableTransport,
  ServerStaffSession,
} from './staffGateway.js';

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
      return parseCatalogItemMutation(await invokeIdempotentMutation(input.transport, 'adminCreateCatalogItem', {
        item: normalized,
      }));
    },
    update: async (id: string, revision: number, item: CatalogItemDetailsInput) => {
      assertCatalogAdministrationAllowed(input.session);
      assertCatalogMutationIdentity(id, revision);
      const normalized = validateCatalogItemDetails(item);
      return parseCatalogItemMutation(await invokeIdempotentMutation(input.transport, 'adminUpdateCatalogItem', {
        id,
        revision,
        item: normalized,
      }));
    },
    setActive: async (id: string, revision: number, active: boolean) => {
      assertCatalogAdministrationAllowed(input.session);
      assertCatalogMutationIdentity(id, revision);
      if (typeof active !== 'boolean') throw new Error('catalog_item_active_invalid');
      return parseCatalogItemMutation(await invokeIdempotentMutation(input.transport, 'adminSetCatalogItemActive', {
        id,
        revision,
        active,
      }));
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
      const created = await gateway.create(validateCatalogItemInput(item));
      setItems([...snapshot.items, created]);
      return created;
    },
    update: async (id: string, revision: number, item: CatalogItemDetailsInput) => {
      const updated = await gateway.update(id, revision, validateCatalogItemDetails(item));
      replace(updated);
      return updated;
    },
    setActive: async (id: string, revision: number, active: boolean) => {
      const updated = await gateway.setActive(id, revision, active);
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
    || (value.createdAtMs as number) < 0
    || !Number.isSafeInteger(value.updatedAtMs)
    || (value.updatedAtMs as number) < (value.createdAtMs as number)) {
    throw new Error('catalog_item_response_invalid');
  }
  try {
    const details = validateCatalogItemDetails({
      access: value.access,
      icon: value.icon,
      summary: value.summary,
      title: value.title,
      url: value.url,
    });
    if (catalogIdFromUrl(details.url) !== value.id) {
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

function assertCatalogMutationIdentity(id: string, revision: number): void {
  if (!isCatalogItemId(id)
    || PERMANENTLY_RETIRED_CATALOG_IDS.has(id)
    || !Number.isSafeInteger(revision)
    || revision < 1) {
    throw new Error('catalog_item_identity_invalid');
  }
}

function parseCatalogUrl(value: unknown, access: CatalogItemAccess): string {
  if (typeof value !== 'string'
    || value.length > 2048
    || /[\u0000-\u0020\u007f\\%?#]/u.test(value)) {
    throw new Error('catalog_item_url_invalid');
  }
  try {
    const parsed = new URL(value);
    const pathMatch = /^\/apps\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/u.exec(parsed.pathname);
    if (parsed.protocol !== 'https:'
      || parsed.hostname !== 'cabohealth.org'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.port !== ''
      || pathMatch === null
      || !isCatalogItemId(pathMatch[1])
      || PERMANENTLY_RETIRED_CATALOG_IDS.has(pathMatch[1])
      || pathMatch[1] === 'app-review'
      || pathMatch[1] === 'shared'
      || (pathMatch[1] === 'client-resources' && access !== 'clients')) {
      throw new Error('catalog_item_url_invalid');
    }
    return parsed.toString();
  } catch {
    throw new Error('catalog_item_url_invalid');
  }
}

function isCatalogItemId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= CATALOG_ITEM_ID_MAX_LENGTH
    && CATALOG_ITEM_ID_PATTERN.test(value);
}

function catalogIdFromUrl(url: string): string {
  return new URL(url).pathname.split('/')[2] ?? '';
}

function parseLocalizedText(value: unknown, maxLength: number): LocalizedCatalogText {
  if (!hasExactKeys(value, ['en', 'es-MX'])) throw new Error('catalog_item_text_invalid');
  const rawEn = typeof value.en === 'string' ? value.en : '';
  const rawEsMx = typeof value['es-MX'] === 'string' ? value['es-MX'] : '';
  if (CATALOG_TEXT_CONTROL_PATTERN.test(rawEn)
    || CATALOG_TEXT_CONTROL_PATTERN.test(rawEsMx)) {
    throw new Error('catalog_item_text_invalid');
  }
  const en = rawEn.trim();
  const esMx = rawEsMx.trim();
  if (en === '' || esMx === '' || en.length > maxLength || esMx.length > maxLength) {
    throw new Error('catalog_item_text_invalid');
  }
  return Object.freeze({ en, 'es-MX': esMx });
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
