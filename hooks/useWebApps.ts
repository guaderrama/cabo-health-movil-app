import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Network from 'expo-network';
import { PUBLIC_MINIAPPS } from '../constants/publicMiniapps';
import {
  createPublicCatalogState,
  getFavoriteSnapshot,
  subscribeFavoriteSnapshot,
} from '../features/catalog/publicCatalogState';
import { WebApp } from '../types';

interface UseWebAppsResult {
  apps: WebApp[];
  favoriteApps: WebApp[];
  nonFavoriteApps: WebApp[];
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  refresh: () => Promise<void>;
}

export function useWebApps(): UseWebAppsResult {
  const [isOffline, setIsOffline] = useState(false);
  const favorites = useSyncExternalStore(
    subscribeFavoriteSnapshot,
    getFavoriteSnapshot,
    getFavoriteSnapshot,
  );

  useEffect(() => {
    let isMounted = true;
    Network.getNetworkStateAsync()
      .then((networkState) => {
        if (!isMounted) return;
        setIsOffline(
          networkState.isConnected === false
          || networkState.isInternetReachable === false,
        );
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const catalog = useMemo(
    () => createPublicCatalogState(PUBLIC_MINIAPPS, favorites, isOffline),
    [favorites, isOffline],
  );
  const refresh = useCallback(async () => {}, []);

  return { ...catalog, refresh };
}

export default useWebApps;
