import type { CallableTransport } from './staffGateway.js';

export const STAFF_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

const AUTHORIZATION_BOUNDARY_CODES = new Set([
  'functions/unauthenticated',
  'functions/permission-denied',
  'auth/id-token-expired',
  'auth/user-token-expired',
  'auth/requires-recent-login',
]);
export function isStaffAuthorizationBoundaryError(error: unknown): boolean {
  return isRecord(error)
    && typeof error.code === 'string'
    && AUTHORIZATION_BOUNDARY_CODES.has(error.code);
}

export function calculateStaffSessionExpiryMs(authTimeSeconds: unknown): number {
  if (typeof authTimeSeconds !== 'number'
    || !Number.isSafeInteger(authTimeSeconds)
    || authTimeSeconds <= 0) {
    throw new Error('staff_auth_time_invalid');
  }
  return (authTimeSeconds * 1000) + STAFF_SESSION_MAX_AGE_MS;
}

export function createAuthorizationBoundTransport(
  delegate: CallableTransport,
  onAuthorizationLost: () => Promise<void>,
): CallableTransport {
  return async (name, payload) => {
    try {
      return await delegate(name, payload);
    } catch (error) {
      if (isStaffAuthorizationBoundaryError(error)) {
        try {
          await onAuthorizationLost();
        } catch {
          // Preserve the authoritative callable error even if local sign-out fails.
        }
      }
      throw error;
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
