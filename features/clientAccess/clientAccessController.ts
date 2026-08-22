const OPAQUE_SESSION = Symbol('cabohealth.clientAccess.session');
export const CLIENT_RESOURCE_LAUNCH_URL = 'https://cabohealth.org/apps/client-resources/launch/' as const;
export const APP_REVIEW_LAUNCH_URL = 'https://cabohealth.org/apps/app-review/launch/' as const;
export const APP_REVIEW_RESOURCE_ID = 'review-sandbox-app-review-sample-v1' as const;
export type ClientAccessRealm = 'production_client' | 'review_sandbox';
export type ClientAccountDeletionStatus = 'pending' | 'completed';
export interface ClientAccountDeletionResult {
  readonly status: ClientAccountDeletionStatus;
}
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
  readonly schemaVersion: 1;
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

export interface ClientResourceLaunch {
  readonly realm: ClientAccessRealm;
  readonly source: Readonly<{
    uri: typeof CLIENT_RESOURCE_LAUNCH_URL | typeof APP_REVIEW_LAUNCH_URL;
    method: 'POST';
    body: string;
    headers: Readonly<{ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }>;
  }>;
  readonly expiresAtMs: number;
}

export interface ClientAccessGateway {
  redeem(code: string): Promise<{
    session: OpaqueClientSession;
    grant: Readonly<ClientGrantView>;
  } | null>;
  refresh(session: OpaqueClientSession): Promise<Readonly<ClientGrantView> | null>;
  createLaunch(session: OpaqueClientSession, resourceId: string): Promise<unknown>;
  removeAccess(session: OpaqueClientSession): Promise<void>;
  deleteAccount(session: OpaqueClientSession): Promise<Readonly<ClientAccountDeletionResult>>;
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
    || !isNonblankString(record.id, 80)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.id)
    || !isNonblankString(record.iconKey, 40)
    || !CLIENT_RESOURCE_ICON_KEYS.has(record.iconKey)
    || !title
    || !summary
  ) return null;
  return Object.freeze({
    id: record.id,
    title,
    summary,
    iconKey: record.iconKey,
    access: 'client',
  });
}

export function parseClientGrantView(value: unknown, nowMs: number): Readonly<ClientGrantView> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.scope === 'review_sandbox') return parseAppReviewGrant(record);
  if (!hasExactKeys(record, ['expiresAtMs', 'resources', 'schemaVersion', 'status'])) return null;
  if (
    record.schemaVersion !== 1
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
    schemaVersion: 1,
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

function parseClientResourceLaunch(
  value: unknown,
  nowMs: number,
  realm: ClientAccessRealm,
): Readonly<ClientResourceLaunch> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ['expiresAtMs', 'launchUrl', 'method', 'nonce'])) return null;
  const noncePattern = realm === 'production_client'
    ? /^[A-Za-z0-9_-]{32,256}$/u
    : /^[A-Za-z0-9_-]{32}$/u;
  if (
    record.launchUrl !== (
      realm === 'production_client' ? CLIENT_RESOURCE_LAUNCH_URL : APP_REVIEW_LAUNCH_URL
    )
    || record.method !== 'POST'
    || !Number.isSafeInteger(record.expiresAtMs)
    || (record.expiresAtMs as number) <= nowMs
    || (record.expiresAtMs as number) > nowMs + 120_000
    || typeof record.nonce !== 'string'
    || !noncePattern.test(record.nonce)
  ) return null;
  const launchUrl = realm === 'production_client'
    ? CLIENT_RESOURCE_LAUNCH_URL
    : APP_REVIEW_LAUNCH_URL;
  return Object.freeze({
    realm,
    source: Object.freeze({
      uri: launchUrl,
      method: 'POST' as const,
      body: `nonce=${encodeURIComponent(record.nonce)}`,
      headers: Object.freeze({
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' as const,
      }),
    }),
    expiresAtMs: record.expiresAtMs as number,
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
}: {
  gateway: ClientAccessGateway;
  sessionStore: ClientSessionStore;
  now?: () => number;
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

  const refresh = async () => {
    if (redemptionPending || deletionPending) return;
    const operationGeneration = ++generation;
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
    const localSucceeded = await clearLocalSession();
    deletionPending = false;
    publish({
      status: localSucceeded ? 'locked' : 'error',
      grant: null,
      error: localSucceeded ? null : 'unavailable',
    });
    return result;
  };

  const createLaunch = async (resourceId: string) => {
    const session = currentSession;
    const activeGrant = snapshot.status === 'unlocked' ? snapshot.grant : null;
    if (
      !session
      || !activeGrant
      || !activeGrant.resources.some((resource) => resource.id === resourceId)
    ) return null;
    if (!clientGrantIsActive(activeGrant, now())) {
      ++generation;
      await clearLocalSession();
      publish({ status: 'locked', grant: null, error: null });
      return null;
    }
    const operationGeneration = generation;
    let response: unknown;
    try {
      response = await gateway.createLaunch(session, resourceId);
    } catch {
      return null;
    }
    if (
      operationGeneration !== generation
      || currentSession !== session
      || snapshot.status !== 'unlocked'
      || snapshot.grant !== activeGrant
      || !clientGrantIsActive(activeGrant, now())
    ) return null;
    return parseClientResourceLaunch(response, now(), clientGrantRealm(activeGrant));
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
      if (redemptionPending || deletionPending) return false;
      const credential = normalizeClientAccessCredential(rawCode);
      if (!credential) {
        publish({ status: 'locked', grant: null, error: 'invalid-code' });
        return false;
      }
      const operationGeneration = ++generation;
      redemptionPending = true;
      publish({ status: 'redeeming', grant: null, error: null });
      let response: Awaited<ReturnType<ClientAccessGateway['redeem']>>;
      try {
        response = await gateway.redeem(credential.canonical);
      } catch {
        redemptionPending = false;
        if (operationGeneration !== generation) return false;
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
        publish({ status: 'locked', grant: null, error: 'invalid-code' });
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
    removeAccess,
    deleteAccount,
  };
}
