import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Network from 'expo-network';
import type { CatalogPublicMiniapp } from '../constants/publicMiniapps';
import type { PublishedCatalogSnapshot } from '../features/catalog/publishedCatalog';
import { createPublicCatalogState } from '../features/catalog/publicCatalogState';
import { WebApp } from '../types';
import { useFavorites } from '../context/FavoritesContext';
import { usePublicCatalog } from '../context/PublicCatalogContext';

interface UseWebAppsResult {
  catalogMiniapps: readonly Readonly<CatalogPublicMiniapp>[];
  clientPreviews: PublishedCatalogSnapshot['clientPreviews'];
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
  const {
    miniapps: catalogMiniapps,
    clientPreviews,
    isLoading,
    error,
    refresh: refreshPublishedCatalog,
  } = usePublicCatalog();

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
    () => createPublicCatalogState(catalogMiniapps, favorites, isOffline),
    [catalogMiniapps, favorites, isOffline],
  );
  const refresh = useCallback(async () => {
    await refreshPublishedCatalog();
    await Network.getNetworkStateAsync().then((networkState) => {
      setIsOffline(
        networkState.isConnected === false
        || networkState.isInternetReachable === false,
      );
    }).catch(() => {});
  }, [refreshPublishedCatalog]);

  return {
    ...catalog,
    catalogMiniapps,
    clientPreviews,
    isLoading,
    error,
    refresh,
  };
}

export default useWebApps;
