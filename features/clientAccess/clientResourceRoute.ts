import type {
  ClientAccessStatus,
  ClientGrantView,
  ClientResourceLaunch,
  ClientResourceView,
} from './clientAccessController';

export interface ClientResourceRouteHref {
  readonly pathname: '/client-resource/[resourceId]';
  readonly params: Readonly<{ resourceId: string }>;
}

const CLIENT_RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_EXPIRY_TIMER_DELAY_MS = 2_147_000_000;

export function buildClientResourceRoute(resourceId: string): Readonly<ClientResourceRouteHref> {
  const normalizedResourceId = normalizeClientResourceRouteParam(resourceId);
  if (normalizedResourceId === null) throw new TypeError('invalid_client_resource_id');
  return Object.freeze({
    pathname: '/client-resource/[resourceId]' as const,
    params: Object.freeze({ resourceId: normalizedResourceId }),
  });
}

export function normalizeClientResourceRouteParam(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 64
    || !CLIENT_RESOURCE_ID_PATTERN.test(value)
  ) return null;
  return value;
}

export function resolveClientResourceRouteResource(
  routeParam: unknown,
  status: ClientAccessStatus,
  grant: Readonly<ClientGrantView> | null,
  nowMs = Date.now(),
): Readonly<ClientResourceView> | null {
  const resourceId = normalizeClientResourceRouteParam(routeParam);
  if (resourceId === null || status !== 'unlocked' || grant === null) return null;
  if (grant.expiresAtMs !== null && nowMs >= grant.expiresAtMs) return null;
  return grant.resources.find((resource) => resource.id === resourceId) ?? null;
}

export function getClientResourceRouteExpiryDelay(
  expiresAtMs: number | null,
  nowMs: number,
): number | null {
  if (expiresAtMs === null) return null;
  return Math.min(
    MAX_EXPIRY_TIMER_DELAY_MS,
    Math.max(0, expiresAtMs - nowMs),
  );
}

export type ClientResourceRouteLaunchFailureAction =
  | 'wait-for-revalidation'
  | 'retry-once'
  | 'return-home'
  | 'show-unavailable';

export function resolveClientResourceRouteLaunchFailure({
  automaticRetryUsed,
  deletionTrackingKind,
  resourceAvailable,
  status,
}: Readonly<{
  automaticRetryUsed: boolean;
  deletionTrackingKind: 'none' | 'checking' | 'pending' | 'completed' | 'unavailable';
  resourceAvailable: boolean;
  status: ClientAccessStatus;
}>): ClientResourceRouteLaunchFailureAction {
  if (deletionTrackingKind !== 'none' && deletionTrackingKind !== 'checking') {
    return 'return-home';
  }
  if (
    deletionTrackingKind === 'checking'
    || status === 'checking'
    || status === 'redeeming'
  ) return 'wait-for-revalidation';
  if (status !== 'unlocked' || !resourceAvailable) return 'return-home';
  return automaticRetryUsed ? 'show-unavailable' : 'retry-once';
}

export async function requestClientResourceRouteLaunch({
  resourceId,
  refresh,
  createLaunch,
  isCurrent,
}: Readonly<{
  resourceId: string;
  refresh: () => Promise<void>;
  createLaunch: (resourceId: string) => Promise<Readonly<ClientResourceLaunch> | null>;
  isCurrent: () => boolean;
}>): Promise<Readonly<ClientResourceLaunch> | null> {
  try {
    await refresh();
    if (!isCurrent()) return null;
    const launch = await createLaunch(resourceId);
    return isCurrent() ? launch : null;
  } catch {
    return null;
  }
}
