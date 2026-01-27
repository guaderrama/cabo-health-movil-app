// hooks/useWebApps.ts
// Hook para obtener y gestionar web apps

import { useState, useEffect, useCallback, useMemo } from 'react';
import { WebApp } from '../types';
import {
  fetchWebApps,
  subscribeToWebApps,
  cacheWebApps,
  getCachedWebApps,
  getFavorites,
} from '../services';

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
  const [apps, setApps] = useState<WebApp[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Combina apps con estado de favoritos (memoized to prevent unnecessary recalculations)
  const appsWithFavorites = useMemo(() =>
    apps.map((app) => ({
      ...app,
      isFavorite: favorites.includes(app.id),
    })),
    [apps, favorites]
  );

  // Separa favoritos de no favoritos (memoized)
  const favoriteApps = useMemo(() =>
    appsWithFavorites.filter((app) => app.isFavorite),
    [appsWithFavorites]
  );

  const nonFavoriteApps = useMemo(() =>
    appsWithFavorites.filter((app) => !app.isFavorite),
    [appsWithFavorites]
  );

  // Carga inicial
  const loadApps = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Cargar favoritos locales
      const storedFavorites = await getFavorites();
      setFavorites(storedFavorites);

      // Intentar cargar desde Firebase
      const firebaseApps = await fetchWebApps();
      setApps(firebaseApps);
      setIsOffline(false);

      // Guardar en caché
      await cacheWebApps(firebaseApps);
    } catch (err) {
      console.error('Error loading apps from Firebase:', err);

      // Intentar cargar desde caché
      try {
        const cachedApps = await getCachedWebApps();
        if (cachedApps.length > 0) {
          setApps(cachedApps);
          setIsOffline(true);
          setError('Mostrando datos en caché');
        } else {
          setError('No se pudieron cargar las apps');
        }
      } catch (cacheErr) {
        setError('No se pudieron cargar las apps');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refresh manual
  const refresh = useCallback(async () => {
    await loadApps();
  }, [loadApps]);

  // Suscripción en tiempo real
  useEffect(() => {
    loadApps();

    // Suscribirse a cambios en tiempo real
    const unsubscribe = subscribeToWebApps(
      async (updatedApps) => {
        setApps(updatedApps);
        setIsOffline(false);
        setError(null);
        await cacheWebApps(updatedApps);
      },
      (err) => {
        console.error('Subscription error:', err);
        // No setear error aquí para no sobreescribir datos existentes
      }
    );

    return () => {
      unsubscribe();
    };
  }, [loadApps]);

  // Actualizar favoritos cuando cambien
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const storedFavorites = await getFavorites();
        setFavorites(storedFavorites);
      } catch (err) {
        console.error('Error loading favorites:', err);
      }
    };

    // Recargar favoritos periódicamente (30 seconds - was 1s which caused performance issues)
    const interval = setInterval(loadFavorites, 30000);
    return () => clearInterval(interval);
  }, []);

  return {
    apps: appsWithFavorites,
    favoriteApps,
    nonFavoriteApps,
    isLoading,
    error,
    isOffline,
    refresh,
  };
}

export default useWebApps;
