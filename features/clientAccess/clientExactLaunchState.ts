import type { ClientAccessStatus } from './clientAccessController';

export type RequestedResourceLaunchState = 'busy' | 'unavailable';

export function resolveRequestedResourceLaunchState({
  handledResourceId,
  launchError,
  launchPendingId,
  requestedResourceAvailable,
  requestedResourceId,
  status,
}: Readonly<{
  handledResourceId: string | null;
  launchError: boolean;
  launchPendingId: string | null;
  requestedResourceAvailable: boolean;
  requestedResourceId: string | null;
  status: ClientAccessStatus;
}>): RequestedResourceLaunchState {
  if (requestedResourceId === null || launchError) return 'unavailable';
  if (status === 'checking' || status === 'redeeming') return 'busy';
  if (launchPendingId === requestedResourceId) return 'busy';
  if (requestedResourceAvailable && handledResourceId !== requestedResourceId) return 'busy';
  return 'unavailable';
}
