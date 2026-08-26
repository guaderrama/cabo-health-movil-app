import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  type CatalogAdminService,
  type CatalogItemInput,
  type CatalogItemView,
  catalogIdFromUrl,
  validateCatalogItemInput,
} from './catalogAdmin.js';
import { validateCatalogDraftInput } from './catalogDraftAdmin.js';
import type { DocumentDatabase } from '../repositories/firestoreClientAccessStore.js';

const PRODUCTION_PROJECT_ID = 'cabohealth-owner-prod';
const MAX_CATALOG_ITEMS = 12;
const MAX_LEGACY_DRAFTS = 100;

const LEGACY_PERMISSIONS = Object.freeze([
  'client_codes',
  'client_resource_drafts',
  'app_review_credential',
] as const);

const CURRENT_PERMISSIONS = Object.freeze([
  'client_codes',
  'client_resource_drafts',
  'client_resource_publish',
  'app_review_credential',
] as const);

const LEGACY_ADMIN_DOCUMENT = Object.freeze({
  active: true as const,
  permissions: LEGACY_PERMISSIONS,
  schemaVersion: 1 as const,
  scope: 'production' as const,
});

const CURRENT_ADMIN_DOCUMENT = Object.freeze({
  active: true as const,
  permissions: CURRENT_PERMISSIONS,
  schemaVersion: 1 as const,
  scope: 'production' as const,
});

const CANONICAL_SEEDS = Object.freeze([
  Object.freeze({
    access: 'public' as const,
    active: true,
    icon: 'recipes' as const,
    summary: Object.freeze({
      en: 'Practical, balanced recipes for everyday wellbeing.',
      'es-MX': 'Recetas prácticas y equilibradas para el bienestar diario.',
    }),
    title: Object.freeze({ en: 'Healthy Recipes', 'es-MX': 'Recetas Saludables' }),
    url: 'https://cabohealth.org/apps/healthy-recipes/',
  }),
  Object.freeze({
    access: 'public' as const,
    active: true,
    icon: 'guide' as const,
    summary: Object.freeze({
      en: 'Helpful information for planning a CaboHealth clinic visit.',
      'es-MX': 'Información útil para planear una visita a la clínica CaboHealth.',
    }),
    title: Object.freeze({
      en: 'CaboHealth Clinic Guide',
      'es-MX': 'Guía de Clínica CaboHealth',
    }),
    url: 'https://cabohealth.org/apps/clinic-guide/',
  }),
  Object.freeze({
    access: 'clients' as const,
    active: true,
    icon: 'featured' as const,
    summary: Object.freeze({
      en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
      'es-MX': 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
    }),
    title: Object.freeze({ en: 'Client Resources', 'es-MX': 'Recursos para clientes' }),
    url: 'https://cabohealth.org/apps/client-resources/',
  }),
] satisfies readonly CatalogItemInput[]);

export type CatalogMigrationSkipReason =
  | 'archived'
  | 'catalog-limit'
  | 'duplicate-draft-id'
  | 'existing-id'
  | 'external-url'
  | 'incompatible'
  | 'seed-id';

export interface CatalogMigrationOperation {
  readonly item: CatalogItemInput;
  readonly requestId: string;
  readonly source: 'seed' | 'legacy-draft';
  readonly sourceDraftId: string | null;
}

export interface CatalogMigrationPlan {
  readonly adminDocumentState: 'legacy' | 'current';
  readonly artifactKind: 'cabohealth-catalog-migration-plan';
  readonly operations: readonly CatalogMigrationOperation[];
  readonly ownerUid: string;
  readonly preexistingCatalog: readonly CatalogItemView[];
  readonly preexistingCatalogSha256: string;
  readonly projectId: 'cabohealth-owner-prod';
  readonly schemaVersion: 1;
  readonly skips: readonly Readonly<{
    draftId: string;
    reason: CatalogMigrationSkipReason;
  }>[];
  readonly sourceDraftsSha256: string;
}

export interface CatalogMigrationOwner {
  readonly disabled: boolean;
  readonly emailVerified: boolean;
  readonly factorCount: number;
  readonly providerIds: readonly string[];
}

export interface CatalogMigrationEvidence {
  readonly artifactKind: 'cabohealth-catalog-migration-evidence';
  readonly containsSensitiveValues: false;
  readonly operationCounts: Readonly<{
    legacyDraft: number;
    seed: number;
  }>;
  readonly planSha256: string;
  readonly projectId: 'cabohealth-owner-prod';
  readonly schemaVersion: 1;
  readonly skipCounts: readonly Readonly<{
    count: number;
    reason: CatalogMigrationSkipReason;
  }>[];
  readonly status: 'applied' | 'dry-run';
}

export function assertCatalogMigrationOwnerReady(
  owner: CatalogMigrationOwner | undefined,
): asserts owner is CatalogMigrationOwner {
  if (!owner
    || owner.disabled
    || !owner.emailVerified
    || owner.factorCount !== 0
    || !owner.providerIds.includes('password')) {
    throw new Error('catalog_migration_owner_not_ready');
  }
}

export async function createCatalogMigrationPlan(input: Readonly<{
  catalog: CatalogAdminService;
  database: DocumentDatabase;
  ownerUid: string;
  projectId: string;
}>): Promise<CatalogMigrationPlan> {
  assertProductionIdentity(input.projectId, input.ownerUid);
  const adminValue = await readDocument(input.database, `_private_admins/${input.ownerUid}`);
  const adminDocumentState = parseAdminDocumentState(adminValue);
  const preexistingCatalog = Object.freeze([...(await input.catalog.list())]
    .sort((left, right) => left.id.localeCompare(right.id)));
  if (preexistingCatalog.length > MAX_CATALOG_ITEMS) {
    throw new Error('catalog_migration_catalog_limit');
  }
  const sourceDrafts = Object.freeze([...(await input.database.listCollection('_private_catalog_drafts'))]
    .sort((left, right) => left.id.localeCompare(right.id)));
  if (sourceDrafts.length > MAX_LEGACY_DRAFTS) {
    throw new Error('catalog_migration_legacy_draft_limit');
  }

  const decisions = buildMigrationDecisions(preexistingCatalog, sourceDrafts);

  return Object.freeze({
    adminDocumentState,
    artifactKind: 'cabohealth-catalog-migration-plan' as const,
    operations: decisions.operations,
    ownerUid: input.ownerUid,
    preexistingCatalog,
    preexistingCatalogSha256: sha256Canonical(preexistingCatalog),
    projectId: PRODUCTION_PROJECT_ID,
    schemaVersion: 1 as const,
    skips: decisions.skips,
    sourceDraftsSha256: sha256Canonical(sourceDrafts),
  });
}

function buildMigrationDecisions(
  preexistingCatalog: readonly CatalogItemView[],
  sourceDrafts: readonly Readonly<{ id: string; value: unknown }>[],
): Readonly<{
  operations: readonly CatalogMigrationOperation[];
  skips: readonly Readonly<{ draftId: string; reason: CatalogMigrationSkipReason }>[];
}> {
  const operations: CatalogMigrationOperation[] = CANONICAL_SEEDS.map((seed) => Object.freeze({
    item: validateCatalogItemInput(seed),
    requestId: deterministicRequestId(`seed:${catalogIdFromUrl(seed.url)}`),
    source: 'seed' as const,
    sourceDraftId: null,
  }));
  const seedIds = new Set(operations.map(({ item }) => catalogIdFromUrl(item.url)));
  const existingIds = new Set(preexistingCatalog.map(({ id }) => id));
  for (const operation of operations) {
    const id = catalogIdFromUrl(operation.item.url);
    const existing = preexistingCatalog.find((item) => item.id === id);
    if (existing && !sameCatalogInput(existing, operation.item)) {
      throw new Error('catalog_migration_seed_drift');
    }
  }
  let occupiedItems = preexistingCatalog.length
    + operations.filter(({ item }) => !existingIds.has(catalogIdFromUrl(item.url))).length;
  if (occupiedItems > MAX_CATALOG_ITEMS) throw new Error('catalog_migration_catalog_limit');
  const importedIds = new Set<string>();
  const skips: Array<Readonly<{ draftId: string; reason: CatalogMigrationSkipReason }>> = [];
  for (const document of sourceDrafts) {
    const parsed = parseLegacyDraft(document.id, document.value);
    if (!parsed) {
      skips.push(Object.freeze({ draftId: safeDraftLabel(document.id), reason: 'incompatible' }));
      continue;
    }
    if (parsed.status === 'archived') {
      skips.push(Object.freeze({ draftId: document.id, reason: 'archived' }));
      continue;
    }
    let item: CatalogItemInput;
    try {
      item = validateCatalogItemInput({ ...parsed.input, active: false });
    } catch {
      skips.push(Object.freeze({
        draftId: document.id,
        reason: isExternalUrl(parsed.input.url) ? 'external-url' : 'incompatible',
      }));
      continue;
    }
    const id = catalogIdFromUrl(item.url);
    if (seedIds.has(id)) {
      skips.push(Object.freeze({ draftId: document.id, reason: 'seed-id' }));
      continue;
    }
    if (existingIds.has(id)) {
      skips.push(Object.freeze({ draftId: document.id, reason: 'existing-id' }));
      continue;
    }
    if (importedIds.has(id)) {
      skips.push(Object.freeze({ draftId: document.id, reason: 'duplicate-draft-id' }));
      continue;
    }
    if (occupiedItems >= MAX_CATALOG_ITEMS) {
      skips.push(Object.freeze({ draftId: document.id, reason: 'catalog-limit' }));
      continue;
    }
    operations.push(Object.freeze({
      item,
      requestId: deterministicRequestId(
        `legacy-draft:${document.id}:${id}:${sha256Canonical(item)}`,
      ),
      source: 'legacy-draft' as const,
      sourceDraftId: document.id,
    }));
    importedIds.add(id);
    occupiedItems += 1;
  }
  return Object.freeze({
    operations: Object.freeze(operations),
    skips: Object.freeze(skips),
  });
}

function parseLegacyDraft(
  documentId: string,
  value: unknown,
): Readonly<{
  input: ReturnType<typeof validateCatalogDraftInput>;
  status: 'draft' | 'archived';
}> | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'access', 'createdAtMs', 'draftId', 'icon', 'revision', 'schemaVersion',
      'status', 'summary', 'title', 'updatedAtMs', 'url',
    ])
    || !/^dr_[A-Za-z0-9_-]{32}$/u.test(documentId)
    || value.draftId !== documentId
    || value.schemaVersion !== 1
    || (value.status !== 'draft' && value.status !== 'archived')
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !Number.isSafeInteger(value.createdAtMs)
    || (value.createdAtMs as number) < 0
    || !Number.isSafeInteger(value.updatedAtMs)
    || (value.updatedAtMs as number) < (value.createdAtMs as number)
    || hasLocalizedControl(value.summary)
    || hasLocalizedControl(value.title)) return null;
  try {
    return Object.freeze({
      input: validateCatalogDraftInput({
        access: value.access,
        icon: value.icon,
        summary: value.summary,
        title: value.title,
        url: value.url,
      }),
      status: value.status,
    });
  } catch {
    return null;
  }
}

function hasLocalizedControl(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [value.en, value['es-MX']].some((entry) => (
    typeof entry === 'string' && /[\u0000-\u001f\u007f]/u.test(entry)
  ));
}

function sameCatalogInput(view: CatalogItemView, input: CatalogItemInput): boolean {
  return isDeepStrictEqual({
    access: view.access,
    active: view.active,
    icon: view.icon,
    summary: view.summary,
    title: view.title,
    url: view.url,
  }, input);
}

function isExternalUrl(value: string): boolean {
  try {
    return new URL(value).hostname !== 'cabohealth.org';
  } catch {
    return false;
  }
}

function safeDraftLabel(value: string): string {
  return /^dr_[A-Za-z0-9_-]{32}$/u.test(value)
    ? value
    : `invalid_${sha256Canonical(value).slice(0, 16)}`;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

export function hashCatalogMigrationPlan(plan: CatalogMigrationPlan): string {
  return sha256Canonical(plan);
}

export function parseCatalogMigrationPlan(value: unknown): CatalogMigrationPlan {
  try {
    if (!isRecord(value)
      || !hasExactKeys(value, [
        'adminDocumentState', 'artifactKind', 'operations', 'ownerUid',
        'preexistingCatalog', 'preexistingCatalogSha256', 'projectId',
        'schemaVersion', 'skips', 'sourceDraftsSha256',
      ])
      || (value.adminDocumentState !== 'legacy' && value.adminDocumentState !== 'current')
      || value.artifactKind !== 'cabohealth-catalog-migration-plan'
      || value.projectId !== PRODUCTION_PROJECT_ID
      || value.schemaVersion !== 1
      || typeof value.ownerUid !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.ownerUid)
      || typeof value.preexistingCatalogSha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.preexistingCatalogSha256)
      || typeof value.sourceDraftsSha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.sourceDraftsSha256)
      || !Array.isArray(value.preexistingCatalog)
      || !Array.isArray(value.operations)
      || !Array.isArray(value.skips)) throw invalidPlan();

    const preexistingCatalog = Object.freeze(value.preexistingCatalog.map(parseCatalogItemView));
    if (preexistingCatalog.length > MAX_CATALOG_ITEMS
      || !isStrictlySortedUnique(preexistingCatalog.map(({ id }) => id))
      || sha256Canonical(preexistingCatalog) !== value.preexistingCatalogSha256) {
      throw invalidPlan();
    }
    const operations = Object.freeze(value.operations.map(parseMigrationOperation));
    if (operations.length < CANONICAL_SEEDS.length) throw invalidPlan();
    for (let index = 0; index < CANONICAL_SEEDS.length; index += 1) {
      const operation = operations[index];
      const seed = CANONICAL_SEEDS[index];
      if (!operation
        || !seed
        || operation.source !== 'seed'
        || operation.sourceDraftId !== null
        || !isDeepStrictEqual(operation.item, seed)
        || operation.requestId !== deterministicRequestId(
          `seed:${catalogIdFromUrl(seed.url)}`,
        )) throw invalidPlan();
    }
    if (operations.slice(CANONICAL_SEEDS.length).some(({ source }) => source !== 'legacy-draft')) {
      throw invalidPlan();
    }
    const operationIds = operations.map(({ item }) => catalogIdFromUrl(item.url));
    if (new Set(operationIds).size !== operationIds.length) throw invalidPlan();
    const totalIds = new Set([
      ...preexistingCatalog.map(({ id }) => id),
      ...operationIds,
    ]);
    if (totalIds.size > MAX_CATALOG_ITEMS) throw invalidPlan();

    const skips = Object.freeze(value.skips.map(parseMigrationSkip));
    const sourceLabels = [
      ...operations.flatMap(({ sourceDraftId }) => sourceDraftId === null ? [] : [sourceDraftId]),
      ...skips.map(({ draftId }) => draftId),
    ];
    if (new Set(sourceLabels).size !== sourceLabels.length) throw invalidPlan();

    return Object.freeze({
      adminDocumentState: value.adminDocumentState,
      artifactKind: 'cabohealth-catalog-migration-plan' as const,
      operations,
      ownerUid: value.ownerUid,
      preexistingCatalog,
      preexistingCatalogSha256: value.preexistingCatalogSha256,
      projectId: PRODUCTION_PROJECT_ID,
      schemaVersion: 1 as const,
      skips,
      sourceDraftsSha256: value.sourceDraftsSha256,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'catalog_migration_plan_invalid') throw error;
    throw invalidPlan();
  }
}

export async function applyCatalogMigrationPlan(input: Readonly<{
  catalog: CatalogAdminService;
  database: DocumentDatabase;
  loadOwner: (uid: string) => Promise<CatalogMigrationOwner | undefined>;
  plan: unknown;
  projectId: string;
  reviewedPlanSha256: string;
}>): Promise<CatalogMigrationEvidence> {
  const plan = parseCatalogMigrationPlan(input.plan);
  assertProductionIdentity(input.projectId, plan.ownerUid);
  if (plan.projectId !== input.projectId
    || input.reviewedPlanSha256 !== hashCatalogMigrationPlan(plan)) {
    throw new Error('catalog_migration_apply_not_authorized');
  }
  const owner = await input.loadOwner(plan.ownerUid);
  assertCatalogMigrationOwnerReady(owner);

  parseAdminDocumentState(
    await readDocument(input.database, `_private_admins/${plan.ownerUid}`),
  );
  const sourceDrafts = Object.freeze([...(await input.database.listCollection('_private_catalog_drafts'))]
    .sort((left, right) => left.id.localeCompare(right.id)));
  if (sha256Canonical(sourceDrafts) !== plan.sourceDraftsSha256
    || sha256Canonical(plan.preexistingCatalog) !== plan.preexistingCatalogSha256) {
    throw new Error('catalog_migration_source_drift');
  }
  const expectedDecisions = buildMigrationDecisions(plan.preexistingCatalog, sourceDrafts);
  if (!isDeepStrictEqual(expectedDecisions.operations, plan.operations)
    || !isDeepStrictEqual(expectedDecisions.skips, plan.skips)) {
    throw new Error('catalog_migration_source_drift');
  }
  await assertCatalogApplyPreconditions(input.catalog, plan);

  const preexistingIds = new Set(plan.preexistingCatalog.map(({ id }) => id));
  for (const operation of plan.operations) {
    const id = catalogIdFromUrl(operation.item.url);
    if (preexistingIds.has(id)) continue;
    await input.catalog.create(operation.item, Object.freeze({
      actorUid: plan.ownerUid,
      requestId: operation.requestId,
    }));
  }

  await promoteOwnerAdminDocument(input.database, plan.ownerUid);
  return sanitizeCatalogMigrationEvidence(plan, 'applied');
}

function parseMigrationOperation(value: unknown): CatalogMigrationOperation {
  if (!isRecord(value)
    || !hasExactKeys(value, ['item', 'requestId', 'source', 'sourceDraftId'])
    || (value.source !== 'seed' && value.source !== 'legacy-draft')
    || typeof value.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.requestId)
    || (value.sourceDraftId !== null
      && (typeof value.sourceDraftId !== 'string'
        || !/^dr_[A-Za-z0-9_-]{32}$/u.test(value.sourceDraftId)))) throw invalidPlan();
  const item = validateCatalogItemInput(value.item);
  if (!isDeepStrictEqual(item, value.item)) throw invalidPlan();
  if (value.source === 'seed' && value.sourceDraftId !== null) throw invalidPlan();
  if (value.source === 'legacy-draft') {
    if (value.sourceDraftId === null || item.active) throw invalidPlan();
    const id = catalogIdFromUrl(item.url);
    if (value.requestId !== deterministicRequestId(
      `legacy-draft:${value.sourceDraftId}:${id}:${sha256Canonical(item)}`,
    )) throw invalidPlan();
  }
  return Object.freeze({
    item,
    requestId: value.requestId,
    source: value.source,
    sourceDraftId: value.sourceDraftId,
  });
}

function parseMigrationSkip(value: unknown): Readonly<{
  draftId: string;
  reason: CatalogMigrationSkipReason;
}> {
  if (!isRecord(value)
    || !hasExactKeys(value, ['draftId', 'reason'])
    || typeof value.draftId !== 'string'
    || (!/^dr_[A-Za-z0-9_-]{32}$/u.test(value.draftId)
      && !/^invalid_[a-f0-9]{16}$/u.test(value.draftId))
    || !isSkipReason(value.reason)) throw invalidPlan();
  return Object.freeze({ draftId: value.draftId, reason: value.reason });
}

function parseCatalogItemView(value: unknown): CatalogItemView {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'access', 'active', 'createdAtMs', 'icon', 'id', 'revision',
      'summary', 'title', 'updatedAtMs', 'url',
    ])
    || typeof value.id !== 'string'
    || !Number.isSafeInteger(value.createdAtMs)
    || (value.createdAtMs as number) < 0
    || Object.is(value.createdAtMs, -0)
    || !Number.isSafeInteger(value.updatedAtMs)
    || (value.updatedAtMs as number) < (value.createdAtMs as number)
    || Object.is(value.updatedAtMs, -0)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1) throw invalidPlan();
  const item = validateCatalogItemInput({
    access: value.access,
    active: value.active,
    icon: value.icon,
    summary: value.summary,
    title: value.title,
    url: value.url,
  });
  if (!isDeepStrictEqual(item, {
    access: value.access,
    active: value.active,
    icon: value.icon,
    summary: value.summary,
    title: value.title,
    url: value.url,
  })) throw invalidPlan();
  if (catalogIdFromUrl(item.url) !== value.id) throw invalidPlan();
  return Object.freeze({
    ...item,
    createdAtMs: value.createdAtMs as number,
    id: value.id,
    revision: value.revision as number,
    updatedAtMs: value.updatedAtMs as number,
  });
}

function isSkipReason(value: unknown): value is CatalogMigrationSkipReason {
  return value === 'archived'
    || value === 'catalog-limit'
    || value === 'duplicate-draft-id'
    || value === 'existing-id'
    || value === 'external-url'
    || value === 'incompatible'
    || value === 'seed-id';
}

function isStrictlySortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0);
}

function invalidPlan(): Error {
  return new Error('catalog_migration_plan_invalid');
}

export function sanitizeCatalogMigrationEvidence(
  plan: CatalogMigrationPlan,
  status: 'applied' | 'dry-run',
): CatalogMigrationEvidence {
  const skipCounts = [...new Set(plan.skips.map(({ reason }) => reason))]
    .sort()
    .map((reason) => Object.freeze({
      count: plan.skips.filter((skip) => skip.reason === reason).length,
      reason,
    }));
  return Object.freeze({
    artifactKind: 'cabohealth-catalog-migration-evidence' as const,
    containsSensitiveValues: false as const,
    operationCounts: Object.freeze({
      legacyDraft: plan.operations.filter(({ source }) => source === 'legacy-draft').length,
      seed: plan.operations.filter(({ source }) => source === 'seed').length,
    }),
    planSha256: hashCatalogMigrationPlan(plan),
    projectId: PRODUCTION_PROJECT_ID,
    schemaVersion: 1 as const,
    skipCounts: Object.freeze(skipCounts),
    status,
  });
}

async function assertCatalogApplyPreconditions(
  catalog: CatalogAdminService,
  plan: CatalogMigrationPlan,
): Promise<void> {
  const current = await catalog.list();
  const operationById = new Map(plan.operations.map((operation) => [
    catalogIdFromUrl(operation.item.url),
    operation,
  ]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  for (const expected of plan.preexistingCatalog) {
    if (!isDeepStrictEqual(currentById.get(expected.id), expected)) {
      throw new Error('catalog_migration_source_drift');
    }
  }
  const preexistingIds = new Set(plan.preexistingCatalog.map(({ id }) => id));
  for (const item of current) {
    if (preexistingIds.has(item.id)) continue;
    const operation = operationById.get(item.id);
    if (!operation || !sameCatalogInput(item, operation.item)) {
      throw new Error('catalog_migration_source_drift');
    }
  }
}

function promoteOwnerAdminDocument(
  database: DocumentDatabase,
  ownerUid: string,
): Promise<void> {
  return database.runTransaction(async (transaction) => {
    const path = `_private_admins/${ownerUid}`;
    const value = await transaction.get(path);
    const state = parseAdminDocumentState(value);
    if (state === 'legacy') transaction.set(path, CURRENT_ADMIN_DOCUMENT);
  });
}

function parseAdminDocumentState(value: unknown): 'legacy' | 'current' {
  if (isDeepStrictEqual(value, LEGACY_ADMIN_DOCUMENT)) return 'legacy';
  if (isDeepStrictEqual(value, CURRENT_ADMIN_DOCUMENT)) return 'current';
  throw new Error('catalog_migration_admin_document_drift');
}

function assertProductionIdentity(projectId: string, ownerUid: string): void {
  if (projectId !== PRODUCTION_PROJECT_ID
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(ownerUid)) {
    throw new Error('catalog_migration_identity_invalid');
  }
}

async function readDocument(database: DocumentDatabase, path: string): Promise<unknown> {
  return database.runTransaction((transaction) => transaction.get(path));
}

function deterministicRequestId(label: string): string {
  const bytes = createHash('sha256')
    .update('cabohealth/catalog-migration/request/v1\0', 'utf8')
    .update(label, 'utf8')
    .digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hexadecimal = bytes.toString('hex');
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
