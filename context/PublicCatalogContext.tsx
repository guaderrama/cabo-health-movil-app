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
import { AppState, Platform } from 'react-native';
import {
  PUBLIC_MINIAPPS,
  type CatalogPublicMiniapp,
} from '../constants/publicMiniapps';
import type { PublishedCatalogSnapshot } from '../features/catalog/publishedCatalog';
import { resolvePublicCatalogMiniapps } from '../features/catalog/publicCatalogMiniapp';
import type { PublishedCatalogRepository } from '../features/catalog/publishedCatalogRepository';
import { loadPublishedCatalogRepository } from '../features/catalog/publishedCatalogRuntime';

interface PublicCatalogContextValue {
  readonly miniapps: readonly Readonly<CatalogPublicMiniapp>[];
  readonly clientPreviews: PublishedCatalogSnapshot['clientPreviews'];
  readonly isLoading: boolean;
  readonly error: 'catalog-refresh-unavailable' | null;
  getMiniapp(slug: string): Readonly<CatalogPublicMiniapp> | undefined;
  refresh(): Promise<void>;
}

const PublicCatalogContext = createContext<PublicCatalogContextValue | undefined>(undefined);
const EMPTY_CLIENT_PREVIEWS: PublishedCatalogSnapshot['clientPreviews'] = Object.freeze([]);

export function PublicCatalogProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublishedCatalogSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<PublicCatalogContextValue['error']>(null);
  const repositoryRef = useRef<PublishedCatalogRepository | null>(null);
  const repositoryLoadRef = useRef<Promise<PublishedCatalogRepository | null> | null>(null);
  const refreshRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);

  const ensureRepository = useCallback(async () => {
    if (repositoryRef.current) return repositoryRef.current;
    if (!repositoryLoadRef.current) {
      repositoryLoadRef.current = loadPublishedCatalogRepository()
        .catch(() => null)
        .then((repository) => {
          repositoryRef.current = repository;
          return repository;
        });
    }
    return repositoryLoadRef.current;
  }, []);

  const applySnapshot = useCallback((next: PublishedCatalogSnapshot) => {
    if (!mountedRef.current) return;
    setSnapshot((current) => (
      current !== null && current.revision >= next.revision ? current : next
    ));
  }, []);

  const refreshCatalog = useCallback(async (): Promise<boolean> => {
    if (refreshRef.current) return refreshRef.current;
    const operation = (async () => {
      const repository = await ensureRepository();
      if (!repository) return false;
      const next = await repository.refresh();
      if (!next) return false;
      applySnapshot(next);
      return true;
    })();
    refreshRef.current = operation;
    try {
      return await operation;
    } finally {
      if (refreshRef.current === operation) refreshRef.current = null;
    }
  }, [applySnapshot, ensureRepository]);

  const refresh = useCallback(async () => {
    if (mountedRef.current) setIsLoading(true);
    const refreshed = await refreshCatalog();
    if (!mountedRef.current) return;
    setError(refreshed ? null : 'catalog-refresh-unavailable');
    setIsLoading(false);
  }, [refreshCatalog]);

  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      const repository = await ensureRepository();
      if (repository) {
        const cached = await repository.readCached();
        if (cached) applySnapshot(cached);
      }
      const refreshed = await refreshCatalog();
      if (!mountedRef.current) return;
      setError(refreshed ? null : 'catalog-refresh-unavailable');
      setIsLoading(false);
    })();
    return () => { mountedRef.current = false; };
  }, [applySnapshot, ensureRepository, refreshCatalog]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const miniapps = useMemo<readonly Readonly<CatalogPublicMiniapp>[]>(
    () => resolvePublicCatalogMiniapps(snapshot, PUBLIC_MINIAPPS, Platform.OS),
    [snapshot],
  );
  const clientPreviews = snapshot?.clientPreviews ?? EMPTY_CLIENT_PREVIEWS;
  const value = useMemo<PublicCatalogContextValue>(() => ({
    miniapps,
    clientPreviews,
    isLoading,
    error,
    getMiniapp: (slug: string) => miniapps.find((miniapp) => miniapp.slug === slug),
    refresh,
  }), [clientPreviews, error, isLoading, miniapps, refresh]);

  return (
    <PublicCatalogContext.Provider value={value}>
      {children}
    </PublicCatalogContext.Provider>
  );
}

export function usePublicCatalog(): PublicCatalogContextValue {
  const value = useContext(PublicCatalogContext);
  if (!value) throw new Error('usePublicCatalog must be used within PublicCatalogProvider');
  return value;
}
