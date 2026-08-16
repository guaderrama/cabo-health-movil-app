import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import * as Haptics from 'expo-haptics';
import {
  getFavoriteSnapshot,
  setFavoriteSnapshot,
  settleFavoritePersistence,
  subscribeFavoriteSnapshot,
  toggleFavoriteSnapshot,
} from '../features/catalog/publicCatalogState';
import { getFavorites, saveFavorites } from '../services/storage';

const reportFavoritePersistenceFailure = () => {
  console.error('Unable to save favorites.');
};

export function useFavorites() {
  const favorites = useSyncExternalStore(
    subscribeFavoriteSnapshot,
    getFavoriteSnapshot,
    getFavoriteSnapshot,
  );
  const [isLoading, setIsLoading] = useState(true);

  const loadFavorites = useCallback(async () => {
    try {
      setFavoriteSnapshot(await getFavorites());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const toggleFavorite = useCallback(async (appId: string) => {
    const wasFavorite = getFavoriteSnapshot().includes(appId);
    const nextFavorites = toggleFavoriteSnapshot(appId);

    Haptics.impactAsync(
      wasFavorite
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium,
    );
    await settleFavoritePersistence(
      () => saveFavorites([...nextFavorites]),
      reportFavoritePersistenceFailure,
    );
  }, []);

  const isFavorite = useCallback(
    (appId: string) => favorites.includes(appId),
    [favorites],
  );

  const addFavorite = useCallback(async (appId: string) => {
    const current = getFavoriteSnapshot();
    if (current.includes(appId)) return;

    const nextFavorites = [...current, appId];
    setFavoriteSnapshot(nextFavorites);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await settleFavoritePersistence(
      () => saveFavorites(nextFavorites),
      reportFavoritePersistenceFailure,
    );
  }, []);

  const removeFavorite = useCallback(async (appId: string) => {
    const nextFavorites = getFavoriteSnapshot().filter((id) => id !== appId);
    setFavoriteSnapshot(nextFavorites);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await settleFavoritePersistence(
      () => saveFavorites(nextFavorites),
      reportFavoritePersistenceFailure,
    );
  }, []);

  return {
    favorites,
    isLoading,
    isFavorite,
    toggleFavorite,
    addFavorite,
    removeFavorite,
    refresh: loadFavorites,
  };
}
