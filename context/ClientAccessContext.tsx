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
  type ClientAccessGateway,
  type ClientAccessSnapshot,
  type ClientResourceLaunch,
  type ClientSessionStore,
} from '../features/clientAccess/clientAccessController';

const LOCKED_GATEWAY: ClientAccessGateway = Object.freeze({
  redeem: async () => null,
  refresh: async () => null,
  createLaunch: async () => null,
  removeAccess: async () => {},
  deleteAccount: async () => {},
  signOut: async () => {},
});

const EMPTY_SESSION_STORE: ClientSessionStore = Object.freeze({
  restore: async () => null,
  commit: async () => { throw new Error('Client access is not configured'); },
  clear: async () => {},
});

interface ClientAccessContextValue extends ClientAccessSnapshot {
  redeem(code: string): Promise<boolean>;
  refresh(): Promise<void>;
  createLaunch(resourceId: string): Promise<Readonly<ClientResourceLaunch> | null>;
  removeAccess(): Promise<boolean>;
  deleteAccount(): Promise<boolean>;
}

const ClientAccessContext = createContext<ClientAccessContextValue | undefined>(undefined);

export function ClientAccessProvider({
  children,
  gateway = LOCKED_GATEWAY,
  sessionStore = EMPTY_SESSION_STORE,
}: {
  children: ReactNode;
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

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void controller.initialize();
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void controller.refresh();
    });
    return () => subscription.remove();
  }, [controller]);

  const redeem = useCallback((code: string) => controller.redeem(code), [controller]);
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const createLaunch = useCallback(
    (resourceId: string) => controller.createLaunch(resourceId),
    [controller],
  );
  const removeAccess = useCallback(() => controller.removeAccess(), [controller]);
  const deleteAccount = useCallback(() => controller.deleteAccount(), [controller]);
  const value = useMemo<ClientAccessContextValue>(() => ({
    ...snapshot,
    redeem,
    refresh,
    createLaunch,
    removeAccess,
    deleteAccount,
  }), [createLaunch, deleteAccount, redeem, refresh, removeAccess, snapshot]);

  return <ClientAccessContext.Provider value={value}>{children}</ClientAccessContext.Provider>;
}

export function useClientAccess(): ClientAccessContextValue {
  const value = useContext(ClientAccessContext);
  if (!value) throw new Error('useClientAccess must be used within ClientAccessProvider');
  return value;
}
