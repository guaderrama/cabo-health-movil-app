import type {
  CatalogDraftCreateRecord,
  CatalogDraftInput,
  CatalogDraftStore,
  CatalogDraftView,
  StaffAuditAction,
  StaffAuditEvent,
} from '../domain/catalogDraftAdmin.js';
import { validateCatalogDraftInput } from '../domain/catalogDraftAdmin.js';
import { parseSafeCatalogUrl } from '../domain/catalogUrlPolicy.js';
import type { DocumentDatabase } from './firestoreClientAccessStore.js';

const CATALOG_DRAFT_PREFIX = '_private_catalog_drafts';
const AUDIT_EVENT_PREFIX = '_private_audit_events';
const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_DRAFTS = 100;

interface StoredCatalogDraft extends CatalogDraftView {
  readonly createdAtMs: number;
  readonly schemaVersion: 1;
}

export class FirestoreCatalogDraftStore implements CatalogDraftStore {
  readonly #database: DocumentDatabase;

  constructor(database: DocumentDatabase) {
    this.#database = database;
  }

  create(record: CatalogDraftCreateRecord): Promise<CatalogDraftView> {
    return this.#database.runTransaction(async (transaction) => {
      const path = `${CATALOG_DRAFT_PREFIX}/${record.draftId}`;
      if (await transaction.get(path) !== undefined) throw new Error('catalog_draft_collision');
      const stored = Object.freeze({
        access: record.access,
        createdAtMs: record.occurredAtMs,
        draftId: record.draftId,
        icon: record.icon,
        revision: 1,
        schemaVersion: 1,
        status: 'draft',
        summary: record.summary,
        title: record.title,
        updatedAtMs: record.occurredAtMs,
        url: record.url,
      } satisfies StoredCatalogDraft);
      transaction.create(path, stored);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/${record.auditEventId}`,
        staffAudit(record.auditEventId, 'draft.created', suffix(record.draftId), record.occurredAtMs),
      );
      return toView(stored);
    });
  }

  update(command: Readonly<{
    auditEventId: string;
    draftId: string;
    input: CatalogDraftInput;
    occurredAtMs: number;
    revision: number;
  }>): Promise<CatalogDraftView | 'conflict' | 'not_found'> {
    return this.#database.runTransaction(async (transaction) => {
      const path = `${CATALOG_DRAFT_PREFIX}/${command.draftId}`;
      const currentValue = await transaction.get(path);
      if (currentValue === undefined) return 'not_found';
      const current = parseStoredCatalogDraft(currentValue);
      if (!current) throw new Error('invalid_catalog_draft_record');
      if (current.status !== 'draft' || current.revision !== command.revision) return 'conflict';
      const next = Object.freeze({
        ...current,
        ...command.input,
        revision: current.revision + 1,
        updatedAtMs: command.occurredAtMs,
      } satisfies StoredCatalogDraft);
      transaction.set(path, next);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/${command.auditEventId}`,
        staffAudit(command.auditEventId, 'draft.updated', suffix(command.draftId), command.occurredAtMs),
      );
      return toView(next);
    });
  }

  archive(command: Readonly<{
    auditEventId: string;
    draftId: string;
    occurredAtMs: number;
    revision: number;
  }>): Promise<CatalogDraftView | 'conflict' | 'not_found'> {
    return this.#database.runTransaction(async (transaction) => {
      const path = `${CATALOG_DRAFT_PREFIX}/${command.draftId}`;
      const currentValue = await transaction.get(path);
      if (currentValue === undefined) return 'not_found';
      const current = parseStoredCatalogDraft(currentValue);
      if (!current) throw new Error('invalid_catalog_draft_record');
      if (current.status !== 'draft' || current.revision !== command.revision) return 'conflict';
      const next = Object.freeze({
        ...current,
        revision: current.revision + 1,
        status: 'archived',
        updatedAtMs: command.occurredAtMs,
      } satisfies StoredCatalogDraft);
      transaction.set(path, next);
      transaction.create(
        `${AUDIT_EVENT_PREFIX}/${command.auditEventId}`,
        staffAudit(command.auditEventId, 'draft.archived', suffix(command.draftId), command.occurredAtMs),
      );
      return toView(next);
    });
  }

  async list(): Promise<readonly CatalogDraftView[]> {
    const documents = await this.#database.listCollection(CATALOG_DRAFT_PREFIX);
    if (documents.length > MAX_DRAFTS) throw new Error('catalog_draft_limit_exceeded');
    const drafts = documents.map(({ id, value }) => {
      const parsed = parseStoredCatalogDraft(value);
      if (!parsed || parsed.draftId !== id) throw new Error('invalid_catalog_draft_record');
      return toView(parsed);
    });
    return Object.freeze(drafts.sort((left, right) => (
      right.updatedAtMs - left.updatedAtMs || left.draftId.localeCompare(right.draftId)
    )));
  }

  async listAudit(): Promise<readonly StaffAuditEvent[]> {
    const documents = await this.#database.listCollection(AUDIT_EVENT_PREFIX);
    const events = documents.flatMap(({ id, value }) => {
      const parsed = parseStaffAudit(value);
      if (parsed === null) {
        if (isRecord(value) && (value.schemaVersion === 2 || value.schemaVersion === 3)) {
          throw new Error('invalid_staff_audit_record');
        }
        return [];
      }
      if (parsed.eventId !== id) throw new Error('invalid_staff_audit_record');
      return [parsed];
    });
    return Object.freeze(events
      .sort((left, right) => right.occurredAtMs - left.occurredAtMs || left.eventId.localeCompare(right.eventId))
      .slice(0, 100));
  }
}

function staffAudit(
  eventId: string,
  action: StaffAuditAction,
  targetSuffix: string,
  occurredAtMs: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    action,
    actorLabel: 'Staff',
    eventId,
    expiresAtMs: occurredAtMs + AUDIT_RETENTION_MS,
    occurredAtMs,
    outcome: 'success',
    schemaVersion: 2,
    targetSuffix,
  });
}

function toView(stored: StoredCatalogDraft): CatalogDraftView {
  return Object.freeze({
    access: stored.access,
    draftId: stored.draftId,
    icon: stored.icon,
    revision: stored.revision,
    status: stored.status,
    summary: Object.freeze({ ...stored.summary }),
    title: Object.freeze({ ...stored.title }),
    updatedAtMs: stored.updatedAtMs,
    url: stored.url,
  });
}

function parseStoredCatalogDraft(value: unknown): StoredCatalogDraft | null {
  if (!isRecord(value)) return null;
  if (
    !hasExactKeys(value, [
      'access',
      'createdAtMs',
      'draftId',
      'icon',
      'revision',
      'schemaVersion',
      'status',
      'summary',
      'title',
      'updatedAtMs',
      'url',
    ])
    ||
    value.schemaVersion !== 1
    || typeof value.draftId !== 'string'
    || !/^dr_[A-Za-z0-9_-]{32}$/u.test(value.draftId)
    || (value.status !== 'draft' && value.status !== 'archived')
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !Number.isSafeInteger(value.createdAtMs)
    || !Number.isSafeInteger(value.updatedAtMs)
  ) return null;
  try {
    if (!parseSafeCatalogUrl(value.url)) return null;
    validateCatalogDraftInput({
      access: value.access,
      icon: value.icon,
      summary: value.summary,
      title: value.title,
      url: value.url,
    });
  } catch {
    return null;
  }
  return value as unknown as StoredCatalogDraft;
}

function suffix(id: string): string {
  return id.slice(-8);
}

function parseStaffAudit(value: unknown): StaffAuditEvent | null {
  if (!isRecord(value)) return null;
  const action = value.action;
  const schemaVersion = value.schemaVersion;
  const expectedKeys = schemaVersion === 3
    ? [
      'action', 'actorLabel', 'actorUid', 'eventId', 'expiresAtMs',
      'occurredAtMs', 'outcome', 'schemaVersion', 'targetSuffix',
    ]
    : [
      'action', 'actorLabel', 'eventId', 'expiresAtMs', 'occurredAtMs',
      'outcome', 'schemaVersion', 'targetSuffix',
    ];
  if (
    !hasExactKeys(value, expectedKeys)
    || (schemaVersion !== 2 && schemaVersion !== 3)
    || !isStaffAuditAction(action)
    || (schemaVersion === 3 && !isCatalogAuditAction(action))
    || (schemaVersion === 3 && (
      typeof value.actorUid !== 'string'
      || !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.actorUid)
    ))
    || value.actorLabel !== 'Staff'
    || typeof value.eventId !== 'string'
    || !/^evt_[A-Za-z0-9_-]{24,64}$/u.test(value.eventId)
    || !Number.isSafeInteger(value.occurredAtMs)
    || value.outcome !== 'success'
    || typeof value.targetSuffix !== 'string'
    || !/^[A-Za-z0-9_-]{1,12}$/u.test(value.targetSuffix)
    || !Number.isSafeInteger(value.expiresAtMs)
    || value.expiresAtMs !== (value.occurredAtMs as number) + AUDIT_RETENTION_MS
  ) return null;
  return Object.freeze({
    action,
    actorLabel: 'Staff',
    eventId: value.eventId,
    occurredAtMs: value.occurredAtMs as number,
    outcome: 'success',
    targetSuffix: value.targetSuffix,
  });
}

function isStaffAuditAction(value: unknown): value is StaffAuditAction {
  return value === 'client_code.created'
    || value === 'client_code.revoked'
    || value === 'draft.created'
    || value === 'draft.updated'
    || value === 'draft.archived'
    || isCatalogAuditAction(value);
}

function isCatalogAuditAction(value: unknown): value is Extract<StaffAuditAction, `miniapp.${string}`> {
  return value === 'miniapp.created'
    || value === 'miniapp.updated'
    || value === 'miniapp.activated'
    || value === 'miniapp.deactivated'
    || value === 'miniapp.deleted';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}
