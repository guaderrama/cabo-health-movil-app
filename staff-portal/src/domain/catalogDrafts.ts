import type {
  CallableTransport,
  ServerStaffSession,
} from './staffGateway.js';

export const STAFF_DRAFT_ICONS = Object.freeze([
  'laboratory',
  'guide',
  'nutrition',
  'recipes',
  'wellness',
  'location',
  'contact',
  'featured',
] as const);

export type StaffDraftIcon = (typeof STAFF_DRAFT_ICONS)[number];
export type StaffDraftAccess = 'public' | 'clients';

export interface LocalizedDraftText {
  readonly en: string;
  readonly 'es-MX': string;
}

export interface CatalogDraftInput {
  readonly url: string;
  readonly title: LocalizedDraftText;
  readonly summary: LocalizedDraftText;
  readonly icon: StaffDraftIcon;
  readonly access: StaffDraftAccess;
}

export interface CatalogDraft extends CatalogDraftInput {
  readonly draftId: string;
  readonly revision: number;
  readonly status: 'draft' | 'archived';
  readonly updatedAtMs: number;
}

export interface CatalogDraftGateway {
  list(): Promise<readonly CatalogDraft[]>;
  create(input: CatalogDraftInput): Promise<void>;
  update(draftId: string, revision: number, input: CatalogDraftInput): Promise<void>;
  archive(draftId: string, revision: number): Promise<void>;
}

export interface CatalogDraftModel {
  getSnapshot(): Readonly<{ drafts: readonly CatalogDraft[] }>;
  load(): Promise<void>;
  create(input: CatalogDraftInput): Promise<void>;
  update(draftId: string, revision: number, input: CatalogDraftInput): Promise<void>;
  archive(draftId: string, revision: number): Promise<void>;
}

export function createCatalogDraftGateway(input: Readonly<{
  session: ServerStaffSession;
  transport: CallableTransport;
}>): CatalogDraftGateway {
  const assertAllowed = () => assertDraftAdministrationAllowed(input.session);
  return Object.freeze({
    list: async () => {
      assertAllowed();
      return parseCatalogDraftList(await input.transport('adminListCatalogDrafts', {}));
    },
    create: async (draftInput: CatalogDraftInput) => {
      assertAllowed();
      const normalized = validateDraftInput(draftInput);
      parseCatalogDraftMutation(await input.transport('adminCreateCatalogDraft', { ...normalized }));
    },
    update: async (draftId: string, revision: number, draftInput: CatalogDraftInput) => {
      assertAllowed();
      assertDraftMutationIdentity(draftId, revision);
      const normalized = validateDraftInput(draftInput);
      parseCatalogDraftMutation(await input.transport('adminUpdateCatalogDraft', {
        draftId,
        revision,
        ...normalized,
      }));
    },
    archive: async (draftId: string, revision: number) => {
      assertAllowed();
      assertDraftMutationIdentity(draftId, revision);
      parseCatalogDraftMutation(await input.transport('adminArchiveCatalogDraft', {
        draftId,
        revision,
      }), true);
    },
  });
}

const DRAFT_FIELDS = Object.freeze(['access', 'icon', 'summary', 'title', 'url']);
const LOCALIZED_FIELDS = Object.freeze(['en', 'es-MX']);

export function validateDraftInput(value: unknown): CatalogDraftInput {
  if (!hasExactKeys(value, DRAFT_FIELDS)) throw new Error('draft_fields_invalid');

  const url = normalizeHttpsUrl(value.url);
  const title = parseLocalizedText(value.title);
  const summary = parseLocalizedText(value.summary);
  if (!STAFF_DRAFT_ICONS.includes(value.icon as StaffDraftIcon)) {
    throw new Error('draft_icon_invalid');
  }
  if (value.access !== 'public' && value.access !== 'clients') {
    throw new Error('draft_access_invalid');
  }

  return Object.freeze({
    url,
    title,
    summary,
    icon: value.icon as StaffDraftIcon,
    access: value.access,
  });
}

export function createCatalogDraftModel(gateway: CatalogDraftGateway): CatalogDraftModel {
  let snapshot: Readonly<{ drafts: readonly CatalogDraft[] }> = Object.freeze({
    drafts: Object.freeze([]),
  });
  const refresh = async (): Promise<void> => {
    const drafts = await gateway.list();
    snapshot = Object.freeze({ drafts: Object.freeze([...drafts]) });
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    load: refresh,
    create: async (input: CatalogDraftInput) => {
      await gateway.create(validateDraftInput(input));
      await refresh();
    },
    update: async (draftId: string, revision: number, input: CatalogDraftInput) => {
      await gateway.update(draftId, revision, validateDraftInput(input));
      await refresh();
    },
    archive: async (draftId: string, revision: number) => {
      await gateway.archive(draftId, revision);
      await refresh();
    },
  });
}

function normalizeHttpsUrl(value: unknown): string {
  if (typeof value !== 'string'
    || value.length > 2048
    || /[\u0000-\u0020\u007f\\]/u.test(value)) {
    throw new Error('draft_url_invalid');
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:'
      || parsed.hostname === ''
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.port !== ''
      || parsed.search !== ''
      || parsed.hash !== '') {
      throw new Error('draft_url_invalid');
    }
    return parsed.toString();
  } catch {
    throw new Error('draft_url_invalid');
  }
}

function parseCatalogDraftList(value: unknown): readonly CatalogDraft[] {
  if (!hasExactKeys(value, ['drafts']) || !Array.isArray(value.drafts)) {
    throw new Error('catalog_draft_response_invalid');
  }
  return Object.freeze(value.drafts.map(parseCatalogDraft));
}

function parseCatalogDraftMutation(value: unknown, archived = false): CatalogDraft {
  const expectedFields = archived ? ['archived', 'draft'] : ['draft'];
  if (!hasExactKeys(value, expectedFields)
    || (archived && value.archived !== true)) {
    throw new Error('catalog_draft_response_invalid');
  }
  return parseCatalogDraft(value.draft);
}

function parseCatalogDraft(value: unknown): CatalogDraft {
  if (!hasExactKeys(value, [
    'access',
    'draftId',
    'icon',
    'revision',
    'status',
    'summary',
    'title',
    'updatedAtMs',
    'url',
  ])
    || typeof value.draftId !== 'string'
    || !/^dr_[A-Za-z0-9_-]{32}$/u.test(value.draftId)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || (value.status !== 'draft' && value.status !== 'archived')
    || !Number.isSafeInteger(value.updatedAtMs)
    || (value.updatedAtMs as number) < 0) {
    throw new Error('catalog_draft_response_invalid');
  }
  try {
    const draft = validateDraftInput({
      access: value.access,
      icon: value.icon,
      summary: value.summary,
      title: value.title,
      url: value.url,
    });
    return Object.freeze({
      ...draft,
      draftId: value.draftId,
      revision: value.revision as number,
      status: value.status,
      updatedAtMs: value.updatedAtMs as number,
    });
  } catch {
    throw new Error('catalog_draft_response_invalid');
  }
}

function assertDraftAdministrationAllowed(session: ServerStaffSession): void {
  if (session.scope !== 'production'
    || !session.permissions.includes('client_resource_drafts')) {
    throw new Error('staff_capability_unavailable');
  }
}

function assertDraftMutationIdentity(draftId: string, revision: number): void {
  if (!/^dr_[A-Za-z0-9_-]{32}$/u.test(draftId)
    || !Number.isSafeInteger(revision)
    || revision < 1) {
    throw new Error('draft_identity_invalid');
  }
}

function parseLocalizedText(value: unknown): LocalizedDraftText {
  if (!hasExactKeys(value, LOCALIZED_FIELDS)) throw new Error('draft_text_invalid');
  const en = typeof value.en === 'string' ? value.en.trim() : '';
  const esMx = typeof value['es-MX'] === 'string' ? value['es-MX'].trim() : '';
  if (en === '' || esMx === '' || en.length > 120 || esMx.length > 120) {
    throw new Error('draft_text_invalid');
  }
  return Object.freeze({ en, 'es-MX': esMx });
}

function hasExactKeys(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && fields.every((field, index) => keys[index] === field);
}
