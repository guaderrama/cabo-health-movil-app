import { isDeepStrictEqual } from 'node:util';

import {
  type CatalogAuditAction,
  type CatalogCreateRecord,
  type CatalogItemDetailsInput,
  type CatalogItemView,
  type CatalogMutationRecord,
  type CatalogSnapshot,
  type CatalogStore,
  CATALOG_ID_PATTERN,
  catalogIdFromUrl,
  validateCatalogItemInput,
} from '../domain/catalogAdmin.js';
import {
  clientResourcePath,
  type DocumentDatabase,
  type DocumentTransaction,
} from './firestoreClientAccessStore.js';

const CATALOG_PATH = '_private_catalog/current';
const CATALOG_REQUEST_PREFIX = '_private_catalog_requests';
const AUDIT_EVENT_PREFIX = '_private_audit_events';
const MAX_ITEMS = 12;

interface StoredCatalog {
  readonly items: readonly CatalogItemView[];
  readonly revision: number;
  readonly schemaVersion: 1;
  readonly updatedAtMs: number;
}

type StoredCatalogRequest = Readonly<{
  action: CatalogAuditAction;
  actorUid: string;
  expiresAtMs: number;
  fingerprint: string;
  requestId: string;
  response: Readonly<
    | { item: CatalogItemView; kind: 'item' }
    | { kind: 'deleted' }
  >;
  schemaVersion: 1;
  targetId: string;
}>;

export class FirestoreCatalogStore implements CatalogStore {
  readonly #database: DocumentDatabase;

  constructor(database: DocumentDatabase) {
    this.#database = database;
  }

  create(record: CatalogCreateRecord): Promise<CatalogItemView | 'conflict' | 'limit'> {
    return this.#database.runTransaction(async (transaction) => {
      const replay = await readCatalogReplay(transaction, record.mutation);
      if (replay === 'mismatch' || replay === 'deleted') return 'conflict';
      if (replay !== null) return replay;
      const currentValue = await transaction.get(CATALOG_PATH);
      const current = currentValue === undefined ? emptyCatalog(record.createdAtMs) : parseCatalog(currentValue);
      if (!current) throw new Error('invalid_catalog_record');
      if (current.items.some((item) => item.id === record.id)) return 'conflict';
      if (current.items.length >= MAX_ITEMS) return 'limit';
      const created = Object.freeze({
        access: record.access,
        active: record.active,
        createdAtMs: record.createdAtMs,
        icon: record.icon,
        id: record.id,
        revision: 1,
        summary: record.summary,
        title: record.title,
        updatedAtMs: record.createdAtMs,
        url: record.url,
      } satisfies CatalogItemView);
      await assertCreateClientProjection(transaction, created);
      const next = Object.freeze({
        items: Object.freeze([...current.items, created]),
        revision: current.revision + 1,
        schemaVersion: 1 as const,
        updatedAtMs: Math.max(current.updatedAtMs, record.createdAtMs),
      });
      if (currentValue === undefined) transaction.create(CATALOG_PATH, next);
      else transaction.set(CATALOG_PATH, next);
      syncClientResource(transaction, null, created);
      writeCatalogMutation(transaction, record.mutation, { item: created, kind: 'item' });
      return created;
    });
  }

  delete(command: Readonly<{
    id: string;
    mutation: CatalogMutationRecord;
    revision: number;
  }>): Promise<'deleted' | 'conflict' | 'not_found'> {
    return this.#database.runTransaction(async (transaction) => {
      const replay = await readCatalogReplay(transaction, command.mutation);
      if (replay === 'deleted') return 'deleted';
      if (replay !== null) return 'conflict';
      const currentValue = await transaction.get(CATALOG_PATH);
      if (currentValue === undefined) return 'not_found';
      const current = parseCatalog(currentValue);
      if (!current) throw new Error('invalid_catalog_record');
      const index = current.items.findIndex((item) => item.id === command.id);
      if (index === -1) return 'not_found';
      const removed = current.items[index]!;
      if (removed.revision !== command.revision) return 'conflict';
      await assertExistingClientProjection(transaction, removed);
      const updatedAtMs = Math.max(current.updatedAtMs, command.mutation.occurredAtMs);
      transaction.set(CATALOG_PATH, Object.freeze({
        items: Object.freeze(current.items.filter((_, itemIndex) => itemIndex !== index)),
        revision: current.revision + 1,
        schemaVersion: 1 as const,
        updatedAtMs,
      }));
      syncClientResource(transaction, removed, null);
      writeCatalogMutation(transaction, command.mutation, { kind: 'deleted' });
      return 'deleted';
    });
  }

  async listActive(): Promise<readonly CatalogItemView[]> {
    return Object.freeze((await this.list()).filter((item) => item.active));
  }

  async list(): Promise<readonly CatalogItemView[]> {
    return (await this.snapshot()).items;
  }

  async snapshot(): Promise<CatalogSnapshot> {
    const documents = await this.#database.listCollection('_private_catalog');
    const current = documents.find(({ id }) => id === 'current');
    if (!current) return Object.freeze({ items: Object.freeze([]), revision: 0, updatedAtMs: 0 });
    const parsed = parseCatalog(current.value);
    if (!parsed) throw new Error('invalid_catalog_record');
    return Object.freeze({
      items: parsed.items,
      revision: parsed.revision,
      updatedAtMs: parsed.updatedAtMs,
    });
  }

  setActive(command: Readonly<{
    active: boolean;
    id: string;
    mutation: CatalogMutationRecord;
    revision: number;
  }>): Promise<CatalogItemView | 'conflict' | 'not_found'> {
    return this.#database.runTransaction(async (transaction) => {
      const replay = await readCatalogReplay(transaction, command.mutation);
      if (replay === 'mismatch' || replay === 'deleted') return 'conflict';
      if (replay !== null) return replay;
      const currentValue = await transaction.get(CATALOG_PATH);
      if (currentValue === undefined) return 'not_found';
      const current = parseCatalog(currentValue);
      if (!current) throw new Error('invalid_catalog_record');
      const index = current.items.findIndex((item) => item.id === command.id);
      if (index === -1) return 'not_found';
      const item = current.items[index]!;
      if (item.revision !== command.revision) return 'conflict';
      const updatedAtMs = Math.max(
        current.updatedAtMs,
        item.updatedAtMs,
        command.mutation.occurredAtMs,
      );
      const updated = Object.freeze({
        ...item,
        active: command.active,
        revision: item.revision + 1,
        updatedAtMs,
      });
      await assertSetActiveClientProjection(transaction, item, updated);
      const items = [...current.items];
      items[index] = updated;
      transaction.set(CATALOG_PATH, Object.freeze({
        items: Object.freeze(items),
        revision: current.revision + 1,
        schemaVersion: 1 as const,
        updatedAtMs,
      }));
      syncClientResource(transaction, item, updated);
      writeCatalogMutation(transaction, command.mutation, { item: updated, kind: 'item' });
      return updated;
    });
  }

  update(command: Readonly<{
    details: CatalogItemDetailsInput;
    id: string;
    mutation: CatalogMutationRecord;
    revision: number;
  }>): Promise<CatalogItemView | 'conflict' | 'not_found'> {
    return this.#database.runTransaction(async (transaction) => {
      const replay = await readCatalogReplay(transaction, command.mutation);
      if (replay === 'mismatch' || replay === 'deleted') return 'conflict';
      if (replay !== null) return replay;
      const currentValue = await transaction.get(CATALOG_PATH);
      if (currentValue === undefined) return 'not_found';
      const current = parseCatalog(currentValue);
      if (!current) throw new Error('invalid_catalog_record');
      const index = current.items.findIndex((item) => item.id === command.id);
      if (index === -1) return 'not_found';
      const item = current.items[index]!;
      if (item.revision !== command.revision) return 'conflict';
      const updatedAtMs = Math.max(
        current.updatedAtMs,
        item.updatedAtMs,
        command.mutation.occurredAtMs,
      );
      const updated = Object.freeze({
        ...item,
        ...command.details,
        revision: item.revision + 1,
        updatedAtMs,
      });
      await assertUpdateClientProjection(transaction, item, updated);
      const items = [...current.items];
      items[index] = updated;
      transaction.set(CATALOG_PATH, Object.freeze({
        items: Object.freeze(items),
        revision: current.revision + 1,
        schemaVersion: 1 as const,
        updatedAtMs,
      }));
      syncClientResource(transaction, item, updated);
      writeCatalogMutation(transaction, command.mutation, { item: updated, kind: 'item' });
      return updated;
    });
  }
}

async function assertCreateClientProjection(
  transaction: DocumentTransaction,
  item: CatalogItemView,
): Promise<void> {
  if (item.access !== 'clients') return;
  const value = await transaction.get(clientResourcePath(item.id));
  if (!item.active) {
    if (value === undefined) return;
    throw new Error('invalid_client_resource_projection');
  }
  if (isAllowedCreateOrActivateProjection(value, item)) return;
  throw new Error('invalid_client_resource_projection');
}

async function assertSetActiveClientProjection(
  transaction: DocumentTransaction,
  previous: CatalogItemView,
  next: CatalogItemView,
): Promise<void> {
  if (previous.access !== 'clients') return;
  if (!previous.active && next.active) {
    const value = await transaction.get(clientResourcePath(next.id));
    if (isAllowedCreateOrActivateProjection(value, next)) return;
    throw new Error('invalid_client_resource_projection');
  }
  await assertExistingClientProjection(transaction, previous);
}

function isAllowedCreateOrActivateProjection(
  value: unknown,
  item: CatalogItemView,
): boolean {
  return value === undefined
    || isDeepStrictEqual(value, clientProjection(item))
    || (item.id === 'client-resources' && isDeepStrictEqual(value, LEGACY_CLIENT_RESOURCES));
}

async function assertExistingClientProjection(
  transaction: DocumentTransaction,
  item: CatalogItemView,
): Promise<void> {
  if (item.access !== 'clients') return;
  const value = await transaction.get(clientResourcePath(item.id));
  if (item.active) {
    if (isDeepStrictEqual(value, clientProjection(item))) return;
    throw new Error('invalid_client_resource_projection');
  }
  if (value === undefined
    || isDeepStrictEqual(value, clientProjection(item))
    || (item.id === 'client-resources' && isDeepStrictEqual(value, LEGACY_CLIENT_RESOURCES))) return;
  throw new Error('invalid_client_resource_projection');
}

async function assertUpdateClientProjection(
  transaction: DocumentTransaction,
  previous: CatalogItemView,
  next: CatalogItemView,
): Promise<void> {
  if (previous.access === 'clients') {
    await assertExistingClientProjection(transaction, previous);
    return;
  }
  if (next.access !== 'clients') return;
  if (await transaction.get(clientResourcePath(next.id)) !== undefined) {
    throw new Error('invalid_client_resource_projection');
  }
}

async function readCatalogReplay(
  transaction: DocumentTransaction,
  mutation: CatalogMutationRecord,
): Promise<CatalogItemView | 'deleted' | 'mismatch' | null> {
  const value = await transaction.get(`${CATALOG_REQUEST_PREFIX}/${mutation.requestId}`);
  if (value === undefined) return null;
  const stored = parseCatalogRequest(value);
  if (!stored) throw new Error('invalid_catalog_request_record');
  if (stored.action !== mutation.action
    || stored.actorUid !== mutation.actorUid
    || stored.fingerprint !== mutation.fingerprint
    || stored.requestId !== mutation.requestId
    || stored.targetId !== mutation.targetId) return 'mismatch';
  return stored.response.kind === 'deleted' ? 'deleted' : stored.response.item;
}

function writeCatalogMutation(
  transaction: DocumentTransaction,
  mutation: CatalogMutationRecord,
  response: StoredCatalogRequest['response'],
): void {
  transaction.create(`${CATALOG_REQUEST_PREFIX}/${mutation.requestId}`, Object.freeze({
    action: mutation.action,
    actorUid: mutation.actorUid,
    expiresAtMs: mutation.expiresAtMs,
    fingerprint: mutation.fingerprint,
    requestId: mutation.requestId,
    response,
    schemaVersion: 1,
    targetId: mutation.targetId,
  } satisfies StoredCatalogRequest));
  transaction.create(`${AUDIT_EVENT_PREFIX}/${mutation.auditEventId}`, Object.freeze({
    action: mutation.action,
    actorLabel: 'Staff',
    actorUid: mutation.actorUid,
    eventId: mutation.auditEventId,
    expiresAtMs: mutation.expiresAtMs,
    occurredAtMs: mutation.occurredAtMs,
    outcome: 'success',
    schemaVersion: 3,
    targetSuffix: mutation.targetId.slice(-12),
  }));
}

function syncClientResource(
  transaction: DocumentTransaction,
  previous: CatalogItemView | null,
  next: CatalogItemView | null,
): void {
  if (next?.access === 'clients' && next.active) {
    transaction.set(clientResourcePath(next.id), clientProjection(next));
    return;
  }
  if (previous?.access === 'clients') {
    transaction.delete(clientResourcePath(previous.id));
  }
}

function clientProjection(item: CatalogItemView): Readonly<Record<string, unknown>> {
  return Object.freeze({
    access: 'client',
    iconKey: clientIconKey(item.icon),
    id: item.id,
    schemaVersion: 1,
    status: 'active',
    summary: Object.freeze({ en: item.summary.en, es: item.summary['es-MX'] }),
    title: Object.freeze({ en: item.title.en, es: item.title['es-MX'] }),
  });
}

const LEGACY_CLIENT_RESOURCES = Object.freeze({
  access: 'client',
  iconKey: 'featured',
  id: 'client-resources',
  schemaVersion: 1,
  status: 'active',
  summary: Object.freeze({
    en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
    es: 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
  }),
  title: Object.freeze({ en: 'Client Resources', es: 'Recursos para clientes' }),
});

function clientIconKey(icon: CatalogItemView['icon']): string {
  return {
    contact: 'chatbubble-ellipses-outline',
    featured: 'sparkles-outline',
    guide: 'book-outline',
    laboratory: 'flask-outline',
    location: 'map-outline',
    nutrition: 'leaf-outline',
    recipes: 'restaurant-outline',
    wellness: 'heart-outline',
  }[icon];
}

function parseCatalogRequest(value: unknown): StoredCatalogRequest | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'action', 'actorUid', 'expiresAtMs', 'fingerprint', 'requestId',
      'response', 'schemaVersion', 'targetId',
    ])
    || !isCatalogAuditAction(value.action)
    || typeof value.actorUid !== 'string'
    || !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.actorUid)
    || !Number.isSafeInteger(value.expiresAtMs)
    || typeof value.fingerprint !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/u.test(value.fingerprint)
    || typeof value.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.requestId)
    || value.schemaVersion !== 1
    || typeof value.targetId !== 'string'
    || !CATALOG_ID_PATTERN.test(value.targetId)
    || !isRecord(value.response)) return null;
  let response: StoredCatalogRequest['response'];
  if (hasExactKeys(value.response, ['kind']) && value.response.kind === 'deleted') {
    response = Object.freeze({ kind: 'deleted' });
  } else if (hasExactKeys(value.response, ['item', 'kind']) && value.response.kind === 'item') {
    const item = parseItem(value.response.item);
    if (!item || item.id !== value.targetId) return null;
    response = Object.freeze({ item, kind: 'item' });
  } else {
    return null;
  }
  return Object.freeze({
    action: value.action,
    actorUid: value.actorUid,
    expiresAtMs: value.expiresAtMs as number,
    fingerprint: value.fingerprint,
    requestId: value.requestId,
    response,
    schemaVersion: 1,
    targetId: value.targetId,
  });
}

function isCatalogAuditAction(value: unknown): value is CatalogAuditAction {
  return value === 'miniapp.created'
    || value === 'miniapp.updated'
    || value === 'miniapp.activated'
    || value === 'miniapp.deactivated'
    || value === 'miniapp.deleted';
}

function emptyCatalog(nowMs: number): StoredCatalog {
  return Object.freeze({
    items: Object.freeze([]),
    revision: 0,
    schemaVersion: 1,
    updatedAtMs: nowMs,
  });
}

function parseCatalog(value: unknown): StoredCatalog | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['items', 'revision', 'schemaVersion', 'updatedAtMs'])
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !Number.isSafeInteger(value.updatedAtMs)
    || (value.updatedAtMs as number) < 0
    || !Array.isArray(value.items)
    || value.items.length > MAX_ITEMS) return null;
  const ids = new Set<string>();
  const items: CatalogItemView[] = [];
  for (const candidate of value.items) {
    const item = parseItem(candidate);
    if (!item || ids.has(item.id)) return null;
    ids.add(item.id);
    items.push(item);
  }
  return Object.freeze({
    items: Object.freeze(items),
    revision: value.revision as number,
    schemaVersion: 1,
    updatedAtMs: value.updatedAtMs as number,
  });
}

function parseItem(value: unknown): CatalogItemView | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'access', 'active', 'createdAtMs', 'icon', 'id', 'revision',
      'summary', 'title', 'updatedAtMs', 'url',
    ])
    || typeof value.id !== 'string'
    || !CATALOG_ID_PATTERN.test(value.id)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !Number.isSafeInteger(value.createdAtMs)
    || (value.createdAtMs as number) < 0
    || !Number.isSafeInteger(value.updatedAtMs)
    || (value.updatedAtMs as number) < (value.createdAtMs as number)) return null;
  try {
    const input = validateCatalogItemInput({
      access: value.access,
      active: value.active,
      icon: value.icon,
      summary: value.summary,
      title: value.title,
      url: value.url,
    });
    if (catalogIdFromUrl(input.url) !== value.id) return null;
    return Object.freeze({
      ...input,
      createdAtMs: value.createdAtMs as number,
      id: value.id,
      revision: value.revision as number,
      updatedAtMs: value.updatedAtMs as number,
    });
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}
