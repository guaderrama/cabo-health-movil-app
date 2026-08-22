import {
  APP_REVIEW_LAUNCH_URL,
  APP_REVIEW_RESOURCE_ID,
  clientGrantRealm,
  CLIENT_RESOURCE_LAUNCH_URL,
  createOpaqueClientSession,
  type ClientAccessGateway,
  type ClientAccessRealm,
  type ClientAccountDeletionCleanupStatus,
  type ClientAccountDeletionStatusResult,
  type ClientGrantView,
  type ClientSessionStore,
  normalizeClientAccessCredential,
  type OpaqueClientSession,
  parseClientGrantView,
} from './clientAccessController';
import {
  type ClientAccountDeletionTracker,
  type ClientAccountDeletionTrackingState,
  type ClientDeletionReceiptRecord,
  type ClientDeletionReceiptStore,
  parseDeletionStatus,
} from './clientDeletionReceiptStore';

const CLIENT_UID_PATTERN = /^client_[A-Za-z0-9_-]{32}$/u;
const REVIEW_UID_PATTERN = /^review_[A-Za-z0-9_-]{32}$/u;
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
  markDeletionCleanupPending(): Promise<void>;
  hasDeletionCleanupPending(): Promise<boolean>;
  clearDeletionCleanupPending(): Promise<void>;
}

export interface FirebaseClientAccessAdapter {
  readonly deletionTracker: ClientAccountDeletionTracker;
  readonly gateway: ClientAccessGateway;
  readonly sessionStore: ClientSessionStore;
}

export function createFirebaseClientAccessAdapter({
  auth,
  deletionReceipts,
  functions,
  installation,
  createRequestId,
  now = Date.now,
}: {
  readonly auth: FirebaseClientAuthPort;
  readonly deletionReceipts: ClientDeletionReceiptStore;
  readonly functions: FirebaseCallablePort;
  readonly installation: ClientInstallationPort;
  readonly createRequestId: () => string;
  readonly now?: () => number;
}): FirebaseClientAccessAdapter {
  let localDeletionCleanupPending = false;
  const getInstallationId = async () => {
    const value = await installation.getOrCreate();
    if (!INSTALLATION_ID_PATTERN.test(value)) throw new Error('client_installation_unavailable');
    return value;
  };

  const requireAccessPrincipal = (): Readonly<{ realm: ClientAccessRealm; uid: string }> => {
    const current = auth.currentUser();
    const realm = current ? realmForUid(current.uid) : null;
    if (!current || !realm) {
      throw new Error('client_session_unavailable');
    }
    return Object.freeze({ realm, uid: current.uid });
  };

  const failAndSignOut = async (): Promise<never> => {
    await auth.signOut().catch(() => {});
    throw new Error('invalid_backend_response');
  };

  const cleanupAccountDeletion = async (
    mode: 'begin' | 'retry',
  ): Promise<ClientAccountDeletionCleanupStatus> => {
    if (mode === 'retry' && !localDeletionCleanupPending) {
      const persistedPending = await installation.hasDeletionCleanupPending()
        .catch(() => false);
      if (!persistedPending) return 'none';
    }
    localDeletionCleanupPending = true;
    let markerPersisted = true;
    if (mode === 'begin') {
      markerPersisted = await installation.markDeletionCleanupPending().then(
        () => true,
        () => false,
      );
    }
    const results = await Promise.allSettled([
      installation.clear(),
      auth.signOut(),
    ]);
    if (results.some((result) => result.status === 'rejected')) return 'pending';
    if (!markerPersisted) return 'pending';
    try {
      await installation.clearDeletionCleanupPending();
    } catch {
      return 'pending';
    }
    localDeletionCleanupPending = false;
    return 'completed';
  };

  const ensureReceiptCleanup = async (): Promise<ClientAccountDeletionCleanupStatus> => {
    const retried = await cleanupAccountDeletion('retry');
    return retried === 'none' ? cleanupAccountDeletion('begin') : retried;
  };

  const trackingState = (
    receipt: Readonly<ClientDeletionReceiptRecord>,
    status: Readonly<ClientAccountDeletionStatusResult>,
    availability: 'current' | 'offline',
  ): ClientAccountDeletionTrackingState => Object.freeze({
    availability,
    kind: status.status,
    realm: receipt.realm,
    status,
  });

  const pollReceipt = async (
    receipt: Readonly<ClientDeletionReceiptRecord>,
  ): Promise<ClientAccountDeletionTrackingState> => {
    if (receipt.phase === 'accepted') {
      await ensureReceiptCleanup().catch(() => 'pending');
    }
    let response: unknown;
    try {
      response = await functions.call(
        receipt.realm === 'production_client'
          ? 'getClientAccountDeletionStatus'
          : 'getAppReviewAccountDeletionStatus',
        { deletionReceipt: receipt.deletionReceipt },
      );
    } catch (error) {
      if (isNotFound(error)) {
        if (receipt.phase === 'prepared') {
          try {
            await deletionReceipts.clear(receipt);
            return Object.freeze({ kind: 'none' as const });
          } catch {
            return Object.freeze({
              kind: 'unavailable' as const,
              phase: 'prepared' as const,
              realm: receipt.realm,
            });
          }
        }
        return Object.freeze({
          kind: 'unavailable' as const,
          phase: 'accepted' as const,
          realm: receipt.realm,
        });
      }
      if (receipt.phase === 'accepted') {
        if (receipt.lastKnownStatus) {
          return trackingState(receipt, receipt.lastKnownStatus, 'offline');
        }
      }
      return Object.freeze({
        kind: 'unavailable' as const,
        phase: receipt.phase,
        realm: receipt.realm,
      });
    }
    const status = parseDeletionStatus(response);
    if (!status) {
      return Object.freeze({
        kind: 'unavailable' as const,
        phase: receipt.phase,
        realm: receipt.realm,
      });
    }
    let accepted: Readonly<ClientDeletionReceiptRecord>;
    try {
      accepted = await deletionReceipts.markAccepted(receipt, status);
    } catch {
      return Object.freeze({
        kind: 'unavailable' as const,
        phase: receipt.phase,
        realm: receipt.realm,
      });
    }
    if (receipt.phase === 'prepared') {
      await ensureReceiptCleanup().catch(() => 'pending');
    }
    return trackingState(accepted, status, 'current');
  };

  let deletionSubmissionPending: Promise<void> | null = null;
  const withDeletionSubmission = async <T>(work: () => Promise<T>): Promise<T> => {
    if (deletionSubmissionPending) {
      throw new Error('client_deletion_submission_pending');
    }
    let releaseSubmission!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseSubmission = resolve; });
    deletionSubmissionPending = barrier;
    try {
      return await work();
    } finally {
      if (deletionSubmissionPending === barrier) deletionSubmissionPending = null;
      releaseSubmission();
    }
  };

  const checkReceipt = async (): Promise<ClientAccountDeletionTrackingState> => {
    while (deletionSubmissionPending) await deletionSubmissionPending;
    let loaded: Awaited<ReturnType<ClientDeletionReceiptStore['load']>>;
    try {
      loaded = await deletionReceipts.load();
    } catch {
      return Object.freeze({
        kind: 'unavailable' as const,
        phase: 'corrupt' as const,
        realm: null,
      });
    }
    if (loaded.kind === 'none') return loaded;
    if (loaded.kind === 'unavailable') {
      return Object.freeze({
        kind: 'unavailable' as const,
        phase: 'corrupt' as const,
        realm: loaded.realms.length === 1 ? loaded.realms[0]! : null,
      });
    }
    return pollReceipt(loaded.receipt);
  };

  let checkPending: Promise<ClientAccountDeletionTrackingState> | null = null;
  const check = (): Promise<ClientAccountDeletionTrackingState> => {
    if (!checkPending) {
      checkPending = checkReceipt().finally(() => { checkPending = null; });
    }
    return checkPending;
  };

  const clearAcceptedReceipt = async (completedOnly: boolean): Promise<boolean> => {
    let loaded: Awaited<ReturnType<ClientDeletionReceiptStore['load']>>;
    try {
      loaded = await deletionReceipts.load();
    } catch {
      return false;
    }
    if (
      loaded.kind !== 'receipt'
      || loaded.receipt.phase !== 'accepted'
      || !loaded.receipt.lastKnownStatus
      || (completedOnly && loaded.receipt.lastKnownStatus.status !== 'completed')
    ) return false;
    if (await ensureReceiptCleanup().catch(() => 'pending') !== 'completed') return false;
    try {
      await deletionReceipts.clear(loaded.receipt);
      return true;
    } catch {
      return false;
    }
  };

  const deletionTracker: ClientAccountDeletionTracker = Object.freeze({
    check,
    acknowledgeCompleted: () => clearAcceptedReceipt(true),
    archiveAccepted: () => clearAcceptedReceipt(false),
  });

  const gateway: ClientAccessGateway = Object.freeze({
    redeem: async (code: string) => {
      const credential = normalizeClientAccessCredential(code);
      if (!credential) return null;
      const installationId = await getInstallationId();
      const requestId = createRequestId();
      if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('client_request_unavailable');
      let response: unknown;
      try {
        response = credential.realm === 'production_client'
          ? await functions.call('redeemClientAccessCode', {
            code: credential.canonical,
            installationId,
            requestId,
          })
          : await functions.call('redeemAppReviewCredential', {
            credential: credential.canonical,
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
      const grant = parseClientGrantView(parsed.grant, now());
      if (!grant || clientGrantRealm(grant) !== credential.realm) return failAndSignOut();
      const principal = await auth.signInWithCustomToken(parsed.customToken).catch(() => null);
      if (!principal || realmForUid(principal.uid) !== credential.realm) return failAndSignOut();
      return Object.freeze({
        session: createOpaqueClientSession(),
        grant,
      });
    },

    refresh: async (_session: OpaqueClientSession) => {
      const principal = requireAccessPrincipal();
      let response: unknown;
      try {
        response = await functions.call(
          principal.realm === 'production_client'
            ? 'refreshClientAccess'
            : 'refreshAppReviewAccess', {
          installationId: await getInstallationId(),
        });
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
        await auth.signOut().catch(() => {});
        return null;
      }
      if (!hasExactKeys(response, ['grant'])) throw new Error('invalid_backend_response');
      const grant = parseClientGrantView(response.grant, now());
      if (!grant || clientGrantRealm(grant) !== principal.realm) return failAndSignOut();
      return grant;
    },

    createLaunch: async (_session: OpaqueClientSession, resourceId: string) => {
      const principal = requireAccessPrincipal();
      const installationId = await getInstallationId();
      if (principal.realm === 'review_sandbox' && resourceId !== APP_REVIEW_RESOURCE_ID) {
        throw new Error('invalid_review_resource');
      }
      const response = principal.realm === 'production_client'
        ? await functions.call('createClientLaunch', { installationId, resourceId })
        : await functions.call('createAppReviewLaunch', { installationId });
      const launch = parseLaunchEnvelope(response, principal.realm, now());
      if (!launch) return failAndSignOut();
      return launch;
    },

    removeAccess: async (_session: OpaqueClientSession) => {
      const principal = requireAccessPrincipal();
      if (principal.realm === 'review_sandbox') return;
      const response = await functions.call('removeClientAccess', {
        installationId: await getInstallationId(),
      });
      if (!hasExactKeys(response, ['removed']) || response.removed !== true) {
        throw new Error('invalid_backend_response');
      }
    },

    deleteAccount: (_session: OpaqueClientSession) => withDeletionSubmission(async () => {
      const principal = requireAccessPrincipal();
      const receipt = await deletionReceipts.prepare(principal.realm);
      let response: unknown;
      let requestError: unknown = null;
      try {
        response = await functions.call(
          principal.realm === 'production_client'
            ? 'deleteClientAccount'
            : 'deleteAppReviewAccount', {
          deletionReceipt: receipt.deletionReceipt,
          installationId: await getInstallationId(),
        });
      } catch (error) {
        requestError = error;
      }
      const status = requestError === null ? parseDeletionStatus(response) : null;
      if (status) {
        try {
          await deletionReceipts.markAccepted(receipt, status);
          return status;
        } catch {
          return Object.freeze({ status: 'unavailable' as const });
        }
      }
      const resolved = await pollReceipt(receipt);
      if (resolved.kind === 'pending' || resolved.kind === 'completed') {
        return resolved.status;
      }
      if (resolved.kind === 'none') {
        throw requestError instanceof Error
          ? requestError
          : new Error('invalid_backend_response');
      }
      return Object.freeze({ status: 'unavailable' as const });
    }),

    cleanupAccountDeletion,

    signOut: () => auth.signOut(),
  });

  const sessionStore: ClientSessionStore = Object.freeze({
    restore: async () => {
      const principal = await auth.waitForReady();
      if (principal === null) return null;
      if (!realmForUid(principal.uid)) {
        await auth.signOut();
        return null;
      }
      return createOpaqueClientSession();
    },
    commit: async (_session: OpaqueClientSession) => {
      requireAccessPrincipal();
    },
    clear: async () => {},
  });

  return Object.freeze({ deletionTracker, gateway, sessionStore });
}

function realmForUid(uid: string): ClientAccessRealm | null {
  if (CLIENT_UID_PATTERN.test(uid)) return 'production_client';
  if (REVIEW_UID_PATTERN.test(uid)) return 'review_sandbox';
  return null;
}

function parseLaunchEnvelope(
  value: unknown,
  realm: ClientAccessRealm,
  nowMs: number,
): Readonly<{
  expiresAtMs: number;
  launchUrl: typeof CLIENT_RESOURCE_LAUNCH_URL | typeof APP_REVIEW_LAUNCH_URL;
  method: 'POST';
  nonce: string;
}> | null {
  if (!hasExactKeys(value, ['expiresAtMs', 'launchUrl', 'method', 'nonce'])) return null;
  const expectedUrl = realm === 'production_client'
    ? CLIENT_RESOURCE_LAUNCH_URL
    : APP_REVIEW_LAUNCH_URL;
  const noncePattern = realm === 'production_client'
    ? /^[A-Za-z0-9_-]{32,256}$/u
    : /^[A-Za-z0-9_-]{32}$/u;
  if (
    value.launchUrl !== expectedUrl
    || value.method !== 'POST'
    || !Number.isSafeInteger(value.expiresAtMs)
    || (value.expiresAtMs as number) <= nowMs
    || (value.expiresAtMs as number) > nowMs + 120_000
    || typeof value.nonce !== 'string'
    || !noncePattern.test(value.nonce)
  ) return null;
  return Object.freeze({
    expiresAtMs: value.expiresAtMs as number,
    launchUrl: expectedUrl,
    method: 'POST',
    nonce: value.nonce,
  });
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

function isNotFound(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const code = (value as Record<string, unknown>).code;
  return code === 'not-found' || code === 'functions/not-found';
}
