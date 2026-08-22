const OPAQUE_SESSION = Symbol('cabohealth.clientAccess.session');
export const CLIENT_RESOURCE_LAUNCH_URL = 'https://cabohealth.org/apps/client-resources/launch/' as const;
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

export interface ClientGrantView {
  readonly schemaVersion: 1;
  readonly status: 'active';
  readonly expiresAtMs: number;
  readonly resources: readonly Readonly<ClientResourceView>[];
}

export type ClientAccessStatus = 'checking' | 'locked' | 'redeeming' | 'unlocked' | 'error';

export interface ClientAccessSnapshot {
  readonly status: ClientAccessStatus;
  readonly grant: Readonly<ClientGrantView> | null;
  readonly error: 'invalid-code' | 'unavailable' | null;
}

export interface ClientResourceLaunch {
  readonly source: Readonly<{
    uri: typeof CLIENT_RESOURCE_LAUNCH_URL;
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
  deleteAccount(session: OpaqueClientSession): Promise<void>;
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
  deleteAccount(): Promise<boolean>;
}

export function createOpaqueClientSession(): OpaqueClientSession {
  return Object.freeze({ [OPAQUE_SESSION]: true as const });
}

export function normalizeClientAccessCode(rawCode: string): string | null {
  if (typeof rawCode !== 'string' || /[\u0000-\u001f\u007f]/u.test(rawCode)) return null;
  const normalized = rawCode
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/gu, '-');
  const match = /^CH[ -]*([A-F0-9 -]+)$/u.exec(normalized);
  if (!match) return null;
  const entropy = match[1].replace(/[ -]/gu, '');
  if (!/^[A-F0-9]{32}$/u.test(entropy)) return null;
  return `CH-${entropy.match(/.{8}/gu)!.join('-')}`;
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

function parseClientResourceLaunch(
  value: unknown,
  nowMs: number,
): Readonly<ClientResourceLaunch> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ['expiresAtMs', 'launchUrl', 'method', 'nonce'])) return null;
  if (
    record.launchUrl !== CLIENT_RESOURCE_LAUNCH_URL
    || record.method !== 'POST'
    || !Number.isSafeInteger(record.expiresAtMs)
    || (record.expiresAtMs as number) <= nowMs
    || (record.expiresAtMs as number) > nowMs + 120_000
    || typeof record.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{32,256}$/u.test(record.nonce)
  ) return null;
  return Object.freeze({
    source: Object.freeze({
      uri: CLIENT_RESOURCE_LAUNCH_URL,
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
    if (redemptionPending) return;
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

  const terminate = async (action: 'removeAccess' | 'deleteAccount') => {
    ++generation;
    const session = currentSession;
    publish({ status: 'checking', grant: null, error: null });
    let remoteSucceeded = true;
    if (session) {
      try {
        await gateway[action](session);
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

  const createLaunch = async (resourceId: string) => {
    const session = currentSession;
    const activeGrant = snapshot.status === 'unlocked' ? snapshot.grant : null;
    if (
      !session
      || !activeGrant
      || !activeGrant.resources.some((resource) => resource.id === resourceId)
    ) return null;
    if (activeGrant.expiresAtMs <= now()) {
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
      || activeGrant.expiresAtMs <= now()
    ) return null;
    return parseClientResourceLaunch(response, now());
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
      if (redemptionPending) return false;
      const code = normalizeClientAccessCode(rawCode);
      if (!code) {
        publish({ status: 'locked', grant: null, error: 'invalid-code' });
        return false;
      }
      const operationGeneration = ++generation;
      redemptionPending = true;
      publish({ status: 'redeeming', grant: null, error: null });
      let response: Awaited<ReturnType<ClientAccessGateway['redeem']>>;
      try {
        response = await gateway.redeem(code);
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
      if (!isOpaqueClientSession(response.session) || !parsedGrant) {
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
    removeAccess: () => terminate('removeAccess'),
    deleteAccount: () => terminate('deleteAccount'),
  };
}
