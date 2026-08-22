import { randomBytes as nodeRandomBytes } from 'node:crypto';

export const CATALOG_DRAFT_ICONS = Object.freeze([
  'laboratory',
  'guide',
  'nutrition',
  'recipes',
  'wellness',
  'location',
  'contact',
  'featured',
] as const);

export type CatalogDraftIcon = typeof CATALOG_DRAFT_ICONS[number];
export type CatalogDraftAccess = 'public' | 'clients';

export interface LocalizedDraftText {
  readonly en: string;
  readonly 'es-MX': string;
}

export interface CatalogDraftInput {
  readonly access: CatalogDraftAccess;
  readonly icon: CatalogDraftIcon;
  readonly summary: LocalizedDraftText;
  readonly title: LocalizedDraftText;
  readonly url: string;
}

export interface CatalogDraftView extends CatalogDraftInput {
  readonly draftId: string;
  readonly revision: number;
  readonly status: 'draft' | 'archived';
  readonly updatedAtMs: number;
}

export interface CatalogDraftCreateRecord extends CatalogDraftInput {
  readonly auditEventId: string;
  readonly draftId: string;
  readonly occurredAtMs: number;
}

export type StaffAuditAction =
  | 'client_code.created'
  | 'client_code.revoked'
  | 'draft.created'
  | 'draft.updated'
  | 'draft.archived';

export interface StaffAuditEvent {
  readonly action: StaffAuditAction;
  readonly actorLabel: 'Staff';
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly outcome: 'success';
  readonly targetSuffix: string;
}

export interface CatalogDraftStore {
  archive(command: Readonly<{
    auditEventId: string;
    draftId: string;
    occurredAtMs: number;
    revision: number;
  }>): Promise<CatalogDraftView | 'conflict' | 'not_found'>;
  create(record: CatalogDraftCreateRecord): Promise<CatalogDraftView>;
  list(): Promise<readonly CatalogDraftView[]>;
  listAudit(): Promise<readonly StaffAuditEvent[]>;
  update(command: Readonly<{
    auditEventId: string;
    draftId: string;
    input: CatalogDraftInput;
    occurredAtMs: number;
    revision: number;
  }>): Promise<CatalogDraftView | 'conflict' | 'not_found'>;
}

export class CatalogDraftInputError extends Error {
  constructor() {
    super('invalid_admin_input');
    this.name = 'CatalogDraftInputError';
  }
}

export class CatalogDraftConflictError extends Error {
  constructor() {
    super('catalog_draft_revision_conflict');
    this.name = 'CatalogDraftConflictError';
  }
}

export class CatalogDraftNotFoundError extends Error {
  constructor() {
    super('catalog_draft_not_found');
    this.name = 'CatalogDraftNotFoundError';
  }
}

export class CatalogDraftAdminService {
  readonly #nowMs: () => number;
  readonly #randomBytes: (size: number) => Uint8Array;
  readonly #store: CatalogDraftStore;

  constructor(dependencies: Readonly<{
    nowMs?: () => number;
    randomBytes?: (size: number) => Uint8Array;
    store: CatalogDraftStore;
  }>) {
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
    this.#store = dependencies.store;
  }

  create(input: CatalogDraftInput): Promise<CatalogDraftView> {
    const normalized = validateCatalogDraftInput(input);
    const occurredAtMs = this.#nowMs();
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
      throw new Error('invalid_server_time');
    }
    return this.#store.create(Object.freeze({
      ...normalized,
      auditEventId: opaqueId('evt', this.#randomBytes),
      draftId: opaqueId('dr', this.#randomBytes),
      occurredAtMs,
    }));
  }

  list(): Promise<readonly CatalogDraftView[]> {
    return this.#store.list();
  }

  listAudit(): Promise<readonly StaffAuditEvent[]> {
    return this.#store.listAudit();
  }

  async update(
    draftId: string,
    revision: number,
    input: CatalogDraftInput,
  ): Promise<CatalogDraftView> {
    assertDraftMutationIdentity(draftId, revision);
    const result = await this.#store.update(Object.freeze({
      auditEventId: opaqueId('evt', this.#randomBytes),
      draftId,
      input: validateCatalogDraftInput(input),
      occurredAtMs: validNow(this.#nowMs()),
      revision,
    }));
    return unwrapMutation(result);
  }

  async archive(draftId: string, revision: number): Promise<CatalogDraftView> {
    assertDraftMutationIdentity(draftId, revision);
    const result = await this.#store.archive(Object.freeze({
      auditEventId: opaqueId('evt', this.#randomBytes),
      draftId,
      occurredAtMs: validNow(this.#nowMs()),
      revision,
    }));
    return unwrapMutation(result);
  }
}

export function validateCatalogDraftInput(input: unknown): CatalogDraftInput {
  if (!hasExactKeys(input, ['access', 'icon', 'summary', 'title', 'url'])) {
    throw new CatalogDraftInputError();
  }
  if (input.access !== 'public' && input.access !== 'clients') {
    throw new CatalogDraftInputError();
  }
  if (!(CATALOG_DRAFT_ICONS as readonly unknown[]).includes(input.icon)) {
    throw new CatalogDraftInputError();
  }
  return Object.freeze({
    access: input.access,
    icon: input.icon as CatalogDraftIcon,
    summary: parseLocalizedText(input.summary),
    title: parseLocalizedText(input.title),
    url: normalizeDraftUrl(input.url),
  });
}

function normalizeDraftUrl(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length > 2_048
    || /[\u0000-\u0020\u007f\\]/u.test(value)
  ) throw new CatalogDraftInputError();
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname === ''
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.port !== ''
      || parsed.search !== ''
      || parsed.hash !== ''
    ) throw new CatalogDraftInputError();
    return parsed.toString();
  } catch (error) {
    if (error instanceof CatalogDraftInputError) throw error;
    throw new CatalogDraftInputError();
  }
}

function parseLocalizedText(value: unknown): LocalizedDraftText {
  if (!hasExactKeys(value, ['en', 'es-MX'])) throw new CatalogDraftInputError();
  const en = typeof value.en === 'string' ? value.en.trim() : '';
  const esMx = typeof value['es-MX'] === 'string' ? value['es-MX'].trim() : '';
  if (!en || !esMx || en.length > 120 || esMx.length > 120) {
    throw new CatalogDraftInputError();
  }
  return Object.freeze({ en, 'es-MX': esMx });
}

function opaqueId(prefix: 'dr' | 'evt', randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(24);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 24) {
    throw new Error('secure_random_source_failed');
  }
  return `${prefix}_${Buffer.from(bytes).toString('base64url')}`;
}

function validNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_server_time');
  return value;
}

function assertDraftMutationIdentity(draftId: string, revision: number): void {
  if (!/^dr_[A-Za-z0-9_-]{32}$/u.test(draftId) || !Number.isSafeInteger(revision) || revision < 1) {
    throw new CatalogDraftInputError();
  }
}

function unwrapMutation(
  result: CatalogDraftView | 'conflict' | 'not_found',
): CatalogDraftView {
  if (result === 'conflict') throw new CatalogDraftConflictError();
  if (result === 'not_found') throw new CatalogDraftNotFoundError();
  return result;
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}
