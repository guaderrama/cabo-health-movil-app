import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Network from 'expo-network';
import { PUBLIC_MINIAPPS } from '../constants/publicMiniapps';
import { createPublicCatalogState } from '../features/catalog/publicCatalogState';
import { WebApp } from '../types';
import { useFavorites } from '../context/FavoritesContext';

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
  const { favorites } = useFavorites();

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
