import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  createClientAccessController,
  type ClientAccessController,
  type ClientAccountDeletionResult,
  type ClientAccessGateway,
  type ClientAccessSnapshot,
  type ClientResourceLaunch,
  type ClientSessionStore,
} from '../features/clientAccess/clientAccessController';
import type {
  ClientAccountDeletionTracker,
  ClientAccountDeletionTrackingState,
} from '../features/clientAccess/clientDeletionReceiptStore';

const LOCKED_GATEWAY: ClientAccessGateway = Object.freeze({
  redeem: async () => null,
  refresh: async () => null,
  createLaunch: async () => null,
  removeAccess: async () => {},
  deleteAccount: async () => { throw new Error('Client access is not configured'); },
  signOut: async () => {},
});

const EMPTY_SESSION_STORE: ClientSessionStore = Object.freeze({
  restore: async () => null,
  commit: async () => { throw new Error('Client access is not configured'); },
  clear: async () => {},
});

interface ClientAccessContextValue extends ClientAccessSnapshot {
  deletionTracking: ClientAccountDeletionTrackingState | Readonly<{ kind: 'checking' }>;
  redeem(code: string): Promise<boolean>;
  refresh(): Promise<void>;
  createLaunch(resourceId: string): Promise<Readonly<ClientResourceLaunch> | null>;
  removeAccess(): Promise<boolean>;
  deleteAccount(): Promise<Readonly<ClientAccountDeletionResult> | null>;
  checkDeletionStatus(): Promise<void>;
  acknowledgeDeletionCompletion(): Promise<boolean>;
  archiveDeletionReceipt(): Promise<boolean>;
}

const ClientAccessContext = createContext<ClientAccessContextValue | undefined>(undefined);

export function ClientAccessProvider({
  children,
  deletionTracker,
  gateway = LOCKED_GATEWAY,
  sessionStore = EMPTY_SESSION_STORE,
}: {
  children: ReactNode;
  deletionTracker?: ClientAccountDeletionTracker;
  gateway?: ClientAccessGateway;
  sessionStore?: ClientSessionStore;
}) {
  const controllerRef = useRef<ClientAccessController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createClientAccessController({ gateway, sessionStore });
  }
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState<Readonly<ClientAccessSnapshot>>(
    controller.getSnapshot(),
  );
  const [deletionTracking, setDeletionTracking] = useState<
    ClientAccessContextValue['deletionTracking']
  >(deletionTracker ? Object.freeze({ kind: 'checking' as const }) : Object.freeze({ kind: 'none' as const }));
  const deletionTrackingRef = useRef(deletionTracking);
  const synchronizationGeneration = useRef(0);
  const controllerInitialized = useRef(false);
  const sessionSuspendedForDeletion = useRef(false);

  const publishDeletionTracking = useCallback((next: ClientAccessContextValue['deletionTracking']) => {
    deletionTrackingRef.current = next;
    setDeletionTracking(next);
  }, []);

  const checkDeletionStatus = useCallback(async () => {
    const operationGeneration = ++synchronizationGeneration.current;
    if (!deletionTracker) {
      publishDeletionTracking(Object.freeze({ kind: 'none' as const }));
      if (!controllerInitialized.current) {
        controllerInitialized.current = true;
        await controller.initialize();
      } else {
        await controller.refresh();
      }
      return;
    }
    publishDeletionTracking(Object.freeze({ kind: 'checking' as const }));
    const next = await deletionTracker.check().catch(() => Object.freeze({
      kind: 'unavailable' as const,
      phase: 'corrupt' as const,
      realm: null,
    }));
    if (operationGeneration !== synchronizationGeneration.current) return;
    if (next.kind !== 'none') {
      publishDeletionTracking(next);
      sessionSuspendedForDeletion.current = true;
      return;
    }
    if (!controllerInitialized.current || sessionSuspendedForDeletion.current) {
      controllerInitialized.current = true;
      sessionSuspendedForDeletion.current = false;
      await controller.initialize();
    } else {
      await controller.refresh();
    }
    if (operationGeneration === synchronizationGeneration.current) {
      publishDeletionTracking(next);
    }
  }, [controller, deletionTracker, publishDeletionTracking]);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void checkDeletionStatus();
    return () => {
      synchronizationGeneration.current += 1;
      unsubscribe();
    };
  }, [checkDeletionStatus, controller]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void checkDeletionStatus();
    });
    return () => subscription.remove();
  }, [checkDeletionStatus]);

  const redeem = useCallback((code: string) => (
    deletionTrackingRef.current.kind === 'none'
      ? controller.redeem(code)
      : Promise.resolve(false)
  ), [controller]);
  const refresh = checkDeletionStatus;
  const createLaunch = useCallback(
    async (resourceId: string) => {
      if (deletionTrackingRef.current.kind !== 'none') return null;
      const operationGeneration = synchronizationGeneration.current;
      const launch = await controller.createLaunch(resourceId);
      return (
        synchronizationGeneration.current === operationGeneration
        && deletionTrackingRef.current.kind === 'none'
      ) ? launch : null;
    },
    [controller],
  );
  const removeAccess = useCallback(() => controller.removeAccess(), [controller]);
  const deleteAccount = useCallback(async () => {
    const result = await controller.deleteAccount();
    if (deletionTracker) await checkDeletionStatus();
    return result;
  }, [checkDeletionStatus, controller, deletionTracker]);
  const acknowledgeDeletionCompletion = useCallback(async () => {
    if (!deletionTracker || !await deletionTracker.acknowledgeCompleted()) return false;
    synchronizationGeneration.current += 1;
    publishDeletionTracking(Object.freeze({ kind: 'none' as const }));
    sessionSuspendedForDeletion.current = false;
    return true;
  }, [deletionTracker, publishDeletionTracking]);
  const archiveDeletionReceipt = useCallback(async () => {
    if (!deletionTracker || !await deletionTracker.archiveAccepted()) return false;
    synchronizationGeneration.current += 1;
    publishDeletionTracking(Object.freeze({ kind: 'none' as const }));
    sessionSuspendedForDeletion.current = false;
    return true;
  }, [deletionTracker, publishDeletionTracking]);
  const value = useMemo<ClientAccessContextValue>(() => ({
    ...snapshot,
    deletionTracking,
    redeem,
    refresh,
    createLaunch,
    removeAccess,
    deleteAccount,
    checkDeletionStatus,
    acknowledgeDeletionCompletion,
    archiveDeletionReceipt,
  }), [
    acknowledgeDeletionCompletion,
    archiveDeletionReceipt,
    checkDeletionStatus,
    createLaunch,
    deleteAccount,
    deletionTracking,
    redeem,
    refresh,
    removeAccess,
    snapshot,
  ]);

  return <ClientAccessContext.Provider value={value}>{children}</ClientAccessContext.Provider>;
}

export function useClientAccess(): ClientAccessContextValue {
  const value = useContext(ClientAccessContext);
  if (!value) throw new Error('useClientAccess must be used within ClientAccessProvider');
  return value;
}
