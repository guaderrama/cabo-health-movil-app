import {
  isPermanentlyRetiredCatalogId,
  isReservedReviewSandboxCatalogId,
} from '../catalog/catalogIdPolicy';
import { isSafeClientPreviewCopy } from '../catalog/publishedCatalog';
import { parseSafeExternalHttpsDestination } from '../launch/externalHttpsUrlPolicy';

const OPAQUE_SESSION = Symbol('cabohealth.clientAccess.session');
export const CLIENT_RESOURCE_LAUNCH_URL = 'https://cabohealth.org/apps/client-resources/launch/' as const;
export const APP_REVIEW_LAUNCH_URL = 'https://cabohealth.org/apps/app-review/launch/' as const;
export const APP_REVIEW_RESOURCE_ID = 'review-sandbox-app-review-sample-v1' as const;
/**
 * Local budget for a launch response, measured with a monotonic clock from the
 * moment the request is sent. The server issues nonces with a 60 s TTL and is
 * the only authority on expiry and single use (it rejects expired or reused
 * nonces at the broker). The device never compares the server's absolute
 * `expiresAtMs` with its own wall clock, so a skewed or changed device clock
 * cannot block a fresh launch.
 */
export const CLIENT_LAUNCH_RESPONSE_BUDGET_MS = 45_000;
export type ClientLaunchFailureReason =
  | 'not_authorized'
  | 'call_failed'
  | 'invalid_response'
  | 'stale_response'
  | 'superseded';
export type ClientAccessRealm = 'production_client' | 'review_sandbox';
export type ClientAccountDeletionStatus = 'pending' | 'completed';
export type ClientAccountDeletionStatusResult = Readonly<{
  readonly completedAtMs: number | null;
  readonly expectedCompletionByMs: number;
  readonly requestedAtMs: number;
  readonly schemaVersion: 1;
  readonly status: ClientAccountDeletionStatus;
}>;
export type ClientAccountDeletionResult = Readonly<
  | ClientAccountDeletionStatusResult
  | { status: 'unavailable' }
>;
export type ClientAccountDeletionCleanupStatus = 'none' | 'pending' | 'completed';
const CLIENT_RESOURCE_ICON_KEYS = new Set([
  'flask-outline',
  'book-outline',
  'leaf-outline',
  'restaurant-outline',
  'heart-outline',
  'map-outline',
  'chatbubble-ellipses-outline',
  'sparkles-outline',
]);
const PRODUCTION_CLIENT_RESERVED_RESOURCE_IDS = new Set(['app-review', 'shared']);
const EXACT_LEGACY_CLIENT_RESOURCES = Object.freeze({
  access: 'client' as const,
  iconKey: 'sparkles-outline',
  id: 'client-resources',
  summary: Object.freeze({
    en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
    es: 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
  }),
  title: Object.freeze({ en: 'Client Resources', es: 'Recursos para clientes' }),
});
const NEUTRAL_CLIENT_RESOURCES_SUMMARY = Object.freeze({
  en: 'Educational resources for eligible existing CaboHealth clients.',
  'es-MX': 'Recursos educativos para clientes actuales elegibles de CaboHealth.',
});

export class ClientAccessSessionInvalidatedError extends Error {
  constructor() {
    super('invalid_backend_response');
    this.name = 'ClientAccessSessionInvalidatedError';
  }
}

export interface OpaqueClientSession {
  readonly [OPAQUE_SESSION]: true;
}

export interface ClientResourceView {
  readonly id: string;
  readonly title: Readonly<{ en: string; es: string }>;
  readonly summary: Readonly<{ en: string; es: string }>;
  readonly iconKey: string;
  readonly access: 'client';
}

export interface ProductionClientGrantView {
  readonly schemaVersion: 2;
  readonly status: 'active';
  readonly expiresAtMs: number;
  readonly resources: readonly Readonly<ClientResourceView>[];
}

export interface AppReviewGrantView {
  readonly schemaVersion: 1;
  readonly status: 'active';
  readonly scope: 'review_sandbox';
  readonly purpose: 'app_review';
  readonly credentialGeneration: number;
  readonly expiresAtMs: null;
  readonly resources: readonly [Readonly<ClientResourceView>];
}

export type ClientGrantView = ProductionClientGrantView | AppReviewGrantView;

export type ClientAccessStatus = 'checking' | 'locked' | 'redeeming' | 'unlocked' | 'error';

export interface ClientAccessSnapshot {
  readonly status: ClientAccessStatus;
  readonly grant: Readonly<ClientGrantView> | null;
  readonly error: 'invalid-code' | 'unavailable' | null;
}

export type BrokerPostSource = Readonly<{
  uri: typeof CLIENT_RESOURCE_LAUNCH_URL | typeof APP_REVIEW_LAUNCH_URL;
  method: 'POST';
  body: string;
  headers: Readonly<{ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }>;
}>;

export type ClientResourceLaunch = Readonly<
  | {
    kind: 'broker';
    realm: ClientAccessRealm;
    expiresAtMs: number;
    source: BrokerPostSource;
  }
  | {
    kind: 'external_https';
    realm: 'production_client';
    expiresAtMs: number;
    source: Readonly<{ uri: string }>;
    origin: string;
  }
>;

export type ClientLaunchEnvelope = Readonly<
  | {
    kind: 'broker';
    expiresAtMs: number;
    launchUrl: typeof CLIENT_RESOURCE_LAUNCH_URL;
    method: 'POST';
    nonce: string;
  }
  | {
    kind: 'external_https';
    expiresAtMs: number;
    url: string;
  }
  | {
    expiresAtMs: number;
    launchUrl: typeof APP_REVIEW_LAUNCH_URL;
    method: 'POST';
    nonce: string;
  }
>;

export interface ClientAccessGateway {
  redeem(code: string): Promise<{
    session: OpaqueClientSession;
    grant: Readonly<ClientGrantView>;
  } | null>;
  refresh(session: OpaqueClientSession): Promise<Readonly<ClientGrantView> | null>;
  createLaunch(session: OpaqueClientSession, resourceId: string): Promise<unknown>;
  removeAccess(session: OpaqueClientSession): Promise<void>;
  deleteAccount(session: OpaqueClientSession): Promise<Readonly<ClientAccountDeletionResult>>;
  cleanupAccountDeletion?(
    mode: 'begin' | 'retry',
  ): Promise<ClientAccountDeletionCleanupStatus>;
  signOut(): Promise<void>;
}

export interface ClientSessionStore {
  restore(): Promise<OpaqueClientSession | null>;
  commit(session: OpaqueClientSession): Promise<void>;
  clear(): Promise<void>;
}

export interface ClientAccessController {
  getSnapshot(): Readonly<ClientAccessSnapshot>;
  subscribe(listener: (snapshot: Readonly<ClientAccessSnapshot>) => void): () => void;
  initialize(): Promise<void>;
  redeem(code: string): Promise<boolean>;
  refresh(): Promise<void>;
  createLaunch(resourceId: string): Promise<Readonly<ClientResourceLaunch> | null>;
  getLastLaunchFailure(): ClientLaunchFailureReason | null;
  removeAccess(): Promise<boolean>;
  deleteAccount(): Promise<Readonly<ClientAccountDeletionResult> | null>;
}

export function createOpaqueClientSession(): OpaqueClientSession {
  return Object.freeze({ [OPAQUE_SESSION]: true as const });
}

export function normalizeClientAccessCode(rawCode: string): string | null {
  const credential = normalizeClientAccessCredential(rawCode);
  return credential?.realm === 'production_client' ? credential.canonical : null;
}

export function normalizeClientAccessCredential(rawCode: string): Readonly<{
  canonical: string;
  realm: 'production_client' | 'review_sandbox';
}> | null {
  if (typeof rawCode !== 'string' || /[\u0000-\u001f\u007f]/u.test(rawCode)) return null;
  const normalized = rawCode
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/gu, '-');
  const match = /^(CH|AR)[ -]*([A-F0-9 -]+)$/u.exec(normalized);
  if (!match) return null;
  const entropy = match[2].replace(/[ -]/gu, '');
  if (!/^[A-F0-9]{32}$/u.test(entropy)) return null;
  const prefix = match[1];
  return Object.freeze({
    canonical: `${prefix}-${entropy.match(/.{8}/gu)!.join('-')}`,
    realm: prefix === 'CH' ? 'production_client' : 'review_sandbox',
  });
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isNonblankString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maxLength;
}

function parseLocalizedText(value: unknown, maxLength: number): Readonly<{ en: string; es: string }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ['en', 'es'])) return null;
  if (!isNonblankString(record.en, maxLength) || !isNonblankString(record.es, maxLength)) return null;
  return Object.freeze({ en: record.en, es: record.es });
}

function parseClientResource(value: unknown): Readonly<ClientResourceView> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ['access', 'iconKey', 'id', 'summary', 'title'])) return null;
  const title = parseLocalizedText(record.title, 80);
  const summary = parseLocalizedText(record.summary, 240);
  if (
    record.access !== 'client'
    || !isNonblankString(record.id, 64)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.id)
    || isPermanentlyRetiredCatalogId(record.id)
    || isReservedReviewSandboxCatalogId(record.id)
    || PRODUCTION_CLIENT_RESERVED_RESOURCE_IDS.has(record.id)
    || !isNonblankString(record.iconKey, 40)
    || !CLIENT_RESOURCE_ICON_KEYS.has(record.iconKey)
    || !title
    || !summary
    || !isSafeProductionClientResourceCopy(record, title, summary)
  ) return null;
  return Object.freeze({
    id: record.id,
    title,
    summary,
    iconKey: record.iconKey,
    access: 'client',
  });
}

function isSafeProductionClientResourceCopy(
  record: Record<string, unknown>,
  title: Readonly<{ en: string; es: string }>,
  summary: Readonly<{ en: string; es: string }>,
): boolean {
  const validationSummary = isExactLegacyClientResources(record, title, summary)
    ? NEUTRAL_CLIENT_RESOURCES_SUMMARY
    : { en: summary.en, 'es-MX': summary.es };
  return isSafeClientPreviewCopy({ en: title.en, 'es-MX': title.es })
    && isSafeClientPreviewCopy(validationSummary);
}

function isExactLegacyClientResources(
  record: Record<string, unknown>,
  title: Readonly<{ en: string; es: string }>,
  summary: Readonly<{ en: string; es: string }>,
): boolean {
  return record.access === EXACT_LEGACY_CLIENT_RESOURCES.access
    && record.iconKey === EXACT_LEGACY_CLIENT_RESOURCES.iconKey
    && record.id === EXACT_LEGACY_CLIENT_RESOURCES.id
    && title.en === EXACT_LEGACY_CLIENT_RESOURCES.title.en
    && title.es === EXACT_LEGACY_CLIENT_RESOURCES.title.es
    && summary.en === EXACT_LEGACY_CLIENT_RESOURCES.summary.en
    && summary.es === EXACT_LEGACY_CLIENT_RESOURCES.summary.es;
}

export function parseClientGrantView(value: unknown, nowMs: number): Readonly<ClientGrantView> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.scope === 'review_sandbox') return parseAppReviewGrant(record);
  if (!hasExactKeys(record, ['expiresAtMs', 'resources', 'schemaVersion', 'status'])) return null;
  if (
    record.schemaVersion !== 2
    || record.status !== 'active'
    || !Number.isSafeInteger(record.expiresAtMs)
    || (record.expiresAtMs as number) <= nowMs
    || !Array.isArray(record.resources)
    || record.resources.length > 12
  ) return null;
  const ids = new Set<string>();
  const resources: Readonly<ClientResourceView>[] = [];
  for (const value of record.resources) {
    const resource = parseClientResource(value);
    if (!resource || ids.has(resource.id)) return null;
    ids.add(resource.id);
    resources.push(resource);
  }
  return Object.freeze({
    schemaVersion: 2,
    status: 'active',
    expiresAtMs: record.expiresAtMs as number,
    resources: Object.freeze(resources),
  });
}

function parseAppReviewGrant(record: Record<string, unknown>): Readonly<AppReviewGrantView> | null {
  if (!hasExactKeys(record, [
    'credentialGeneration',
    'expiresAtMs',
    'purpose',
    'resources',
    'schemaVersion',
    'scope',
    'status',
  ])) return null;
  if (
    record.schemaVersion !== 1
    || record.status !== 'active'
    || record.scope !== 'review_sandbox'
    || record.purpose !== 'app_review'
    || record.expiresAtMs !== null
    || !Number.isSafeInteger(record.credentialGeneration)
    || (record.credentialGeneration as number) < 1
    || !Array.isArray(record.resources)
    || record.resources.length !== 1
  ) return null;
  const expected = {
    access: 'client',
    iconKey: 'featured',
    id: APP_REVIEW_RESOURCE_ID,
    summary: {
      en: 'A fixed, non-clinical sample prepared only for App Review.',
      es: 'Una muestra fija y no clínica preparada sólo para App Review.',
    },
    title: { en: 'App Review Sample', es: 'Muestra para App Review' },
  } as const;
  const resource = record.resources[0];
  if (!isExactReviewResource(resource, expected)) return null;
  return Object.freeze({
    credentialGeneration: record.credentialGeneration as number,
    expiresAtMs: null,
    purpose: 'app_review',
    resources: Object.freeze([Object.freeze({
      access: 'client',
      iconKey: expected.iconKey,
      id: expected.id,
      summary: Object.freeze({ ...expected.summary }),
      title: Object.freeze({ ...expected.title }),
    })]) as readonly [Readonly<ClientResourceView>],
    schemaVersion: 1,
    scope: 'review_sandbox',
    status: 'active',
  });
}

function isExactReviewResource(
  value: unknown,
  expected: Readonly<ClientResourceView>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ['access', 'iconKey', 'id', 'summary', 'title'])) return false;
  const title = parseLocalizedText(record.title, 80);
  const summary = parseLocalizedText(record.summary, 240);
  return record.access === expected.access
    && record.iconKey === expected.iconKey
    && record.id === expected.id
    && title?.en === expected.title.en
    && title.es === expected.title.es
    && summary?.en === expected.summary.en
    && summary.es === expected.summary.es;
}

export function clientGrantRealm(grant: Readonly<ClientGrantView>): ClientAccessRealm {
  return 'scope' in grant && grant.scope === 'review_sandbox'
    ? 'review_sandbox'
    : 'production_client';
}

function clientGrantIsActive(grant: Readonly<ClientGrantView>, nowMs: number): boolean {
  return grant.expiresAtMs === null || grant.expiresAtMs > nowMs;
}

export function parseClientLaunchEnvelope(
  value: unknown,
  realm: ClientAccessRealm,
): Readonly<ClientLaunchEnvelope> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (realm !== 'production_client' && realm !== 'review_sandbox') return null;

  if (realm === 'review_sandbox') {
    if (!hasExactKeys(record, ['expiresAtMs', 'launchUrl', 'method', 'nonce'])) return null;
    if (
      record.launchUrl !== APP_REVIEW_LAUNCH_URL
      || record.method !== 'POST'
      || !isServerLaunchExpiry(record.expiresAtMs)
      || typeof record.nonce !== 'string'
      || !/^[A-Za-z0-9_-]{32}$/u.test(record.nonce)
    ) return null;
    return Object.freeze({
      expiresAtMs: record.expiresAtMs,
      launchUrl: APP_REVIEW_LAUNCH_URL,
      method: 'POST',
      nonce: record.nonce,
    });
  }

  if (record.kind === 'external_https') {
    if (!hasExactKeys(record, ['expiresAtMs', 'kind', 'url'])) return null;
    if (!isServerLaunchExpiry(record.expiresAtMs) || typeof record.url !== 'string') {
      return null;
    }
    const destination = parseSafeExternalHttpsDestination(record.url);
    if (!destination || destination.canonicalUrl !== record.url) return null;
    return Object.freeze({
      expiresAtMs: record.expiresAtMs,
      kind: 'external_https',
      url: destination.canonicalUrl,
    });
  }

  if (!hasExactKeys(record, ['expiresAtMs', 'kind', 'launchUrl', 'method', 'nonce'])) {
    return null;
  }
  if (
    record.kind !== 'broker'
    || record.launchUrl !== CLIENT_RESOURCE_LAUNCH_URL
    || record.method !== 'POST'
    || !isServerLaunchExpiry(record.expiresAtMs)
    || typeof record.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{32,256}$/u.test(record.nonce)
  ) return null;
  return Object.freeze({
    expiresAtMs: record.expiresAtMs,
    kind: 'broker',
    launchUrl: CLIENT_RESOURCE_LAUNCH_URL,
    method: 'POST',
    nonce: record.nonce,
  });
}

/**
 * `expiresAtMs` is the server's own clock. It is kept for diagnostics only and
 * is deliberately NOT compared with the device clock (see
 * CLIENT_LAUNCH_RESPONSE_BUDGET_MS).
 */
function isServerLaunchExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** True when a response received `elapsedMs` (monotonic) after its request may still be opened. */
export function isClientLaunchResponseFresh(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs)
    && elapsedMs >= 0
    && elapsedMs <= CLIENT_LAUNCH_RESPONSE_BUDGET_MS;
}

function parseClientResourceLaunch(
  value: unknown,
  realm: ClientAccessRealm,
): Readonly<ClientResourceLaunch> | null {
  const envelope = parseClientLaunchEnvelope(value, realm);
  if (!envelope) return null;
  if ('kind' in envelope && envelope.kind === 'external_https') {
    const destination = parseSafeExternalHttpsDestination(envelope.url);
    if (!destination || destination.canonicalUrl !== envelope.url) return null;
    return Object.freeze({
      kind: 'external_https',
      realm: 'production_client',
      expiresAtMs: envelope.expiresAtMs,
      source: Object.freeze({ uri: destination.canonicalUrl }),
      origin: destination.origin,
    });
  }
  return Object.freeze({
    kind: 'broker',
    realm,
    source: Object.freeze({
      uri: envelope.launchUrl,
      method: 'POST' as const,
      body: `nonce=${encodeURIComponent(envelope.nonce)}`,
      headers: Object.freeze({
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' as const,
      }),
    }),
    expiresAtMs: envelope.expiresAtMs,
  });
}

function isOpaqueClientSession(value: unknown): value is OpaqueClientSession {
  return !!value
    && typeof value === 'object'
    && (value as Record<symbol, unknown>)[OPAQUE_SESSION] === true
    && Object.keys(value).length === 0;
}

export function createClientAccessController({
  gateway,
  sessionStore,
  now = Date.now,
  monotonicNow = defaultMonotonicNow,
}: {
  gateway: ClientAccessGateway;
  sessionStore: ClientSessionStore;
  now?: () => number;
  /** Monotonic milliseconds, unaffected by wall-clock changes. */
  monotonicNow?: () => number;
}): ClientAccessController {
  let snapshot: Readonly<ClientAccessSnapshot> = Object.freeze({
    status: 'locked',
    grant: null,
    error: null,
  });
  let currentSession: OpaqueClientSession | null = null;
  let generation = 0;
  let redemptionPending = false;
  let deletionPending = false;
  let accountDeletionCleanupPending = false;
  let lastLaunchFailure: ClientLaunchFailureReason | null = null;
  const listeners = new Set<(snapshot: Readonly<ClientAccessSnapshot>) => void>();
  const publish = (next: ClientAccessSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener(snapshot);
  };

  const clearLocalSession = async () => {
    currentSession = null;
    const results = await Promise.allSettled([gateway.signOut(), sessionStore.clear()]);
    return results.every((result) => result.status === 'fulfilled');
  };

  const cleanupAcknowledgedDeletion = async () => {
    currentSession = null;
    if (!gateway.cleanupAccountDeletion) {
      accountDeletionCleanupPending = !(await clearLocalSession());
      return;
    }
    const [cleanupResult, sessionResult] = await Promise.allSettled([
      gateway.cleanupAccountDeletion('begin'),
      sessionStore.clear(),
    ]);
    accountDeletionCleanupPending = (
      cleanupResult.status === 'rejected'
      || cleanupResult.value !== 'completed'
      || sessionResult.status === 'rejected'
    );
  };

  const retryAcknowledgedDeletionCleanup = async () => {
    if (!gateway.cleanupAccountDeletion) return false;
    const cleanupStatus = await gateway.cleanupAccountDeletion('retry');
    if (cleanupStatus === 'none') return false;
    currentSession = null;
    const sessionCleared = await sessionStore.clear().then(
      () => true,
      () => false,
    );
    accountDeletionCleanupPending = cleanupStatus !== 'completed' || !sessionCleared;
    publish({ status: 'locked', grant: null, error: null });
    return true;
  };

  const refresh = async () => {
    if (redemptionPending || deletionPending) return;
    const operationGeneration = ++generation;
    if (await retryAcknowledgedDeletionCleanup()) return;
    if (operationGeneration !== generation) return;
    const session = currentSession;
    if (!session) {
      publish({ status: 'locked', grant: null, error: null });
      return;
    }
    publish({ status: 'checking', grant: null, error: null });
    let nextGrant: Readonly<ClientGrantView> | null;
    try {
      nextGrant = await gateway.refresh(session);
    } catch {
      if (operationGeneration !== generation) return;
      publish({ status: 'error', grant: null, error: 'unavailable' });
      return;
    }
    if (operationGeneration !== generation) return;
    const parsedGrant = parseClientGrantView(nextGrant, now());
    if (!parsedGrant) {
      await clearLocalSession();
      publish({ status: 'locked', grant: null, error: null });
      return;
    }
    publish({ status: 'unlocked', grant: parsedGrant, error: null });
  };

  const removeAccess = async () => {
    if (deletionPending) return false;
    ++generation;
    const session = currentSession;
    publish({ status: 'checking', grant: null, error: null });
    let remoteSucceeded = true;
    if (session) {
      try {
        await gateway.removeAccess(session);
      } catch {
        remoteSucceeded = false;
      }
    }
    const localSucceeded = await clearLocalSession();
    const succeeded = remoteSucceeded && localSucceeded;
    publish({
      status: succeeded ? 'locked' : 'error',
      grant: null,
      error: succeeded ? null : 'unavailable',
    });
    return succeeded;
  };

  const deleteAccount = async (): Promise<Readonly<ClientAccountDeletionResult> | null> => {
    if (deletionPending) return null;
    deletionPending = true;
    const operationGeneration = ++generation;
    const session = currentSession;
    const activeGrant = snapshot.status === 'unlocked' ? snapshot.grant : null;
    publish({ status: 'checking', grant: null, error: null });
    if (!session) {
      deletionPending = false;
      publish({ status: 'locked', grant: null, error: null });
      return null;
    }
    let result: Readonly<ClientAccountDeletionResult>;
    try {
      result = await gateway.deleteAccount(session);
    } catch {
      deletionPending = false;
      if (operationGeneration !== generation) return null;
      publish(activeGrant
        ? { status: 'unlocked', grant: activeGrant, error: 'unavailable' }
        : { status: 'error', grant: null, error: 'unavailable' });
      return null;
    }
    if (operationGeneration !== generation) {
      deletionPending = false;
      return null;
    }
    if (result.status === 'unavailable') {
      currentSession = null;
      deletionPending = false;
      publish({ status: 'locked', grant: null, error: null });
      return result;
    }
    await cleanupAcknowledgedDeletion();
    deletionPending = false;
    publish({ status: 'locked', grant: null, error: null });
    return result;
  };

  const createLaunch = async (resourceId: string) => {
    const fail = (reason: ClientLaunchFailureReason) => {
      lastLaunchFailure = reason;
      return null;
    };
    const session = currentSession;
    const activeGrant = snapshot.status === 'unlocked' ? snapshot.grant : null;
    if (
      !session
      || !activeGrant
      || !activeGrant.resources.some((resource) => resource.id === resourceId)
    ) return fail('not_authorized');
    if (!clientGrantIsActive(activeGrant, now())) {
      ++generation;
      await clearLocalSession();
      publish({ status: 'locked', grant: null, error: null });
      return fail('not_authorized');
    }
    const operationGeneration = generation;
    const requestedAtMono = monotonicNow();
    let response: unknown;
    try {
      response = await gateway.createLaunch(session, resourceId);
    } catch (error) {
      return fail(
        error instanceof Error && error.message === 'invalid_backend_response'
          ? 'invalid_response'
          : 'call_failed',
      );
    }
    const elapsedMs = monotonicNow() - requestedAtMono;
    if (
      operationGeneration !== generation
      || currentSession !== session
      || snapshot.status !== 'unlocked'
      || snapshot.grant !== activeGrant
    ) return fail('superseded');
    if (!clientGrantIsActive(activeGrant, now())) return fail('not_authorized');
    if (!isClientLaunchResponseFresh(elapsedMs)) return fail('stale_response');
    const launch = parseClientResourceLaunch(response, clientGrantRealm(activeGrant));
    if (!launch) return fail('invalid_response');
    lastLaunchFailure = null;
    return launch;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize: async () => {
      publish({ status: 'checking', grant: null, error: null });
      try {
        const restoredSession = await sessionStore.restore();
        if (restoredSession !== null && !isOpaqueClientSession(restoredSession)) {
          const cleared = await clearLocalSession();
          publish({
            status: cleared ? 'locked' : 'error',
            grant: null,
            error: cleared ? null : 'unavailable',
          });
          return;
        }
        currentSession = restoredSession;
      } catch {
        currentSession = null;
        publish({ status: 'error', grant: null, error: 'unavailable' });
        return;
      }
      await refresh();
    },
    redeem: async (rawCode) => {
      if (redemptionPending || deletionPending || accountDeletionCleanupPending) return false;
      const previousSession = currentSession;
      const previousGrant = snapshot.status === 'unlocked' ? snapshot.grant : null;
      const restorePreviousAccess = (error: ClientAccessSnapshot['error']): boolean => {
        if (
          !previousSession
          || !previousGrant
          || currentSession !== previousSession
          || !clientGrantIsActive(previousGrant, now())
        ) return false;
        publish({ status: 'unlocked', grant: previousGrant, error });
        return true;
      };
      const clearExpiredPreviousAccess = async () => {
        if (
          previousSession
          && previousGrant
          && currentSession === previousSession
          && !clientGrantIsActive(previousGrant, now())
        ) await clearLocalSession();
      };
      const credential = normalizeClientAccessCredential(rawCode);
      if (!credential) {
        if (!restorePreviousAccess('invalid-code')) {
          await clearExpiredPreviousAccess();
          publish({ status: 'locked', grant: null, error: 'invalid-code' });
        }
        return false;
      }
      const operationGeneration = ++generation;
      redemptionPending = true;
      publish({ status: 'redeeming', grant: null, error: null });
      let response: Awaited<ReturnType<ClientAccessGateway['redeem']>>;
      try {
        response = await gateway.redeem(credential.canonical);
      } catch (error) {
        redemptionPending = false;
        if (operationGeneration !== generation) return false;
        if (
          !(error instanceof ClientAccessSessionInvalidatedError)
          && restorePreviousAccess('unavailable')
        ) return false;
        await clearLocalSession();
        publish({ status: 'error', grant: null, error: 'unavailable' });
        return false;
      }
      if (operationGeneration !== generation) {
        redemptionPending = false;
        await clearLocalSession();
        return false;
      }
      if (!response) {
        redemptionPending = false;
        if (!restorePreviousAccess('invalid-code')) {
          await clearExpiredPreviousAccess();
          publish({ status: 'locked', grant: null, error: 'invalid-code' });
        }
        return false;
      }
      const parsedGrant = parseClientGrantView(response.grant, now());
      if (
        !isOpaqueClientSession(response.session)
        || !parsedGrant
        || clientGrantRealm(parsedGrant) !== credential.realm
      ) {
        redemptionPending = false;
        await clearLocalSession();
        publish({ status: 'locked', grant: null, error: 'invalid-code' });
        return false;
      }
      try {
        await sessionStore.commit(response.session);
      } catch {
        redemptionPending = false;
        await clearLocalSession();
        publish({ status: 'error', grant: null, error: 'unavailable' });
        return false;
      }
      if (operationGeneration !== generation) {
        redemptionPending = false;
        await clearLocalSession();
        return false;
      }
      currentSession = response.session;
      redemptionPending = false;
      publish({ status: 'unlocked', grant: parsedGrant, error: null });
      return true;
    },
    refresh,
    createLaunch,
    getLastLaunchFailure: () => lastLaunchFailure,
    removeAccess,
    deleteAccount,
  };
}

function defaultMonotonicNow(): number {
  const clock = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof clock?.now === 'function' ? clock.now() : Date.now();
}
