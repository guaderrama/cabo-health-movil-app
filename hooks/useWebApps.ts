import { useCallback, useEffect, useMemo, useState } from 'react';
import { PUBLIC_MINIAPPS } from '../constants/publicMiniapps';
import { getFavorites } from '../services/storage';
import { WebApp } from '../types';
import { useNetworkStatus } from './useNetworkStatus';

interface UseWebAppsResult {
  apps: WebApp[];
  favoriteApps: WebApp[];
  nonFavoriteApps: WebApp[];
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  refresh: () => Promise<void>;
}

const PUBLIC_WEB_APPS: WebApp[] = PUBLIC_MINIAPPS.map((miniapp, index) => ({
  id: miniapp.slug,
  name: miniapp.title.en,
  description: miniapp.summary.en,
  url: miniapp.canonicalUrl,
  category: miniapp.slug === 'healthy-recipes' ? 'nutricion' : 'salud',
  order: index,
  isActive: true,
}));

export function useWebApps(): UseWebAppsResult {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isConnected, isInternetReachable } = useNetworkStatus();

  const loadFavorites = useCallback(async () => {
    setFavorites(await getFavorites());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadFavorites().catch(() => setIsLoading(false));
  }, [loadFavorites]);

  const apps = useMemo(
    () => PUBLIC_WEB_APPS.map((app) => ({ ...app, isFavorite: favorites.includes(app.id) })),
    [favorites],
  );
  const favoriteApps = useMemo(() => apps.filter((app) => app.isFavorite), [apps]);
  const nonFavoriteApps = useMemo(() => apps.filter((app) => !app.isFavorite), [apps]);

  const refresh = useCallback(async () => {}, []);

  return {
    apps,
    favoriteApps,
    nonFavoriteApps,
    isLoading,
    error: null,
    isOffline: !isConnected || isInternetReachable === false,
    refresh,
  };
}

export default useWebApps;
