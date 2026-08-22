import {
  createOpaqueClientSession,
  type ClientAccessGateway,
  type ClientGrantView,
  type ClientSessionStore,
  type OpaqueClientSession,
} from './clientAccessController';

const CLIENT_UID_PATTERN = /^client_[A-Za-z0-9_-]{32}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/u;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;

export interface FirebaseClientAuthPort {
  waitForReady(): Promise<Readonly<{ uid: string }> | null>;
  currentUser(): Readonly<{ uid: string }> | null;
  signInWithCustomToken(customToken: string): Promise<Readonly<{ uid: string }>>;
  signOut(): Promise<void>;
}

export interface FirebaseCallablePort {
  call(name: string, data: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface ClientInstallationPort {
  getOrCreate(): Promise<string>;
  clear(): Promise<void>;
}

export interface FirebaseClientAccessAdapter {
  readonly gateway: ClientAccessGateway;
  readonly sessionStore: ClientSessionStore;
}

export function createFirebaseClientAccessAdapter({
  auth,
  functions,
  installation,
  createRequestId,
}: {
  readonly auth: FirebaseClientAuthPort;
  readonly functions: FirebaseCallablePort;
  readonly installation: ClientInstallationPort;
  readonly createRequestId: () => string;
}): FirebaseClientAccessAdapter {
  const getInstallationId = async () => {
    const value = await installation.getOrCreate();
    if (!INSTALLATION_ID_PATTERN.test(value)) throw new Error('client_installation_unavailable');
    return value;
  };

  const requireClientPrincipal = () => {
    const current = auth.currentUser();
    if (!current || !CLIENT_UID_PATTERN.test(current.uid)) {
      throw new Error('client_session_unavailable');
    }
    return current;
  };

  const failAndSignOut = async (): Promise<never> => {
    await auth.signOut().catch(() => {});
    throw new Error('invalid_backend_response');
  };

  const gateway: ClientAccessGateway = Object.freeze({
    redeem: async (code: string) => {
      const installationId = await getInstallationId();
      const requestId = createRequestId();
      if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('client_request_unavailable');
      let response: unknown;
      try {
        response = await functions.call('redeemClientAccessCode', {
          code,
          installationId,
          requestId,
        });
      } catch (error) {
        await auth.signOut().catch(() => {});
        if (isPermissionDenied(error)) return null;
        throw error;
      }
      const parsed = parseRedeemEnvelope(response);
      if (!parsed) return failAndSignOut();
      const principal = await auth.signInWithCustomToken(parsed.customToken).catch(() => null);
      if (!principal || !CLIENT_UID_PATTERN.test(principal.uid)) return failAndSignOut();
      return Object.freeze({
        session: createOpaqueClientSession(),
        grant: parsed.grant,
      });
    },

    refresh: async (_session: OpaqueClientSession) => {
      requireClientPrincipal();
      const response = await functions.call('refreshClientAccess', {
        installationId: await getInstallationId(),
      });
      if (!hasExactKeys(response, ['grant'])) throw new Error('invalid_backend_response');
      return response.grant as Readonly<ClientGrantView>;
    },

    createLaunch: async (_session: OpaqueClientSession, resourceId: string) => {
      requireClientPrincipal();
      return functions.call('createClientLaunch', {
        installationId: await getInstallationId(),
        resourceId,
      });
    },

    removeAccess: async (_session: OpaqueClientSession) => {
      requireClientPrincipal();
      const response = await functions.call('removeClientAccess', {
        installationId: await getInstallationId(),
      });
      if (!hasExactKeys(response, ['removed']) || response.removed !== true) {
        throw new Error('invalid_backend_response');
      }
    },

    deleteAccount: async (_session: OpaqueClientSession) => {
      requireClientPrincipal();
      const response = await functions.call('deleteClientAccount', {
        installationId: await getInstallationId(),
      });
      if (!hasExactKeys(response, ['deleted']) || response.deleted !== true) {
        throw new Error('invalid_backend_response');
      }
      await installation.clear();
    },

    signOut: () => auth.signOut(),
  });

  const sessionStore: ClientSessionStore = Object.freeze({
    restore: async () => {
      const principal = await auth.waitForReady();
      if (principal === null) return null;
      if (!CLIENT_UID_PATTERN.test(principal.uid)) {
        await auth.signOut();
        return null;
      }
      return createOpaqueClientSession();
    },
    commit: async (_session: OpaqueClientSession) => {
      requireClientPrincipal();
    },
    clear: async () => {},
  });

  return Object.freeze({ gateway, sessionStore });
}

function parseRedeemEnvelope(value: unknown): Readonly<{
  customToken: string;
  grant: Readonly<ClientGrantView>;
}> | null {
  if (!hasExactKeys(value, ['customToken', 'grant'])) return null;
  if (
    typeof value.customToken !== 'string'
    || value.customToken.length < 16
    || value.customToken.length > 8192
    || /[\u0000-\u001f\u007f]/u.test(value.customToken)
    || !value.grant
    || typeof value.grant !== 'object'
    || Array.isArray(value.grant)
  ) return null;
  return Object.freeze({
    customToken: value.customToken,
    grant: value.grant as Readonly<ClientGrantView>,
  });
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

function isPermissionDenied(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const code = (value as Record<string, unknown>).code;
  return code === 'permission-denied' || code === 'functions/permission-denied';
}
