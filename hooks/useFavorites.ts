// hooks/useFavorites.ts
// Hook para manejar favoritos con AsyncStorage

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { config } from '../constants';

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Cargar favoritos desde AsyncStorage
  const loadFavorites = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(config.storageKeys.favorites);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading favorites:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Guardar favoritos en AsyncStorage
  const saveFavorites = useCallback(async (newFavorites: string[]) => {
    try {
      await AsyncStorage.setItem(
        config.storageKeys.favorites,
        JSON.stringify(newFavorites)
      );
    } catch (error) {
      console.error('Error saving favorites:', error);
    }
  }, []);

  // Toggle favorito
  const toggleFavorite = useCallback(async (appId: string) => {
    setFavorites((current) => {
      const isFavorite = current.includes(appId);
      const newFavorites = isFavorite
        ? current.filter((id) => id !== appId)
        : [...current, appId];

      // Haptic feedback
      Haptics.impactAsync(
        isFavorite
          ? Haptics.ImpactFeedbackStyle.Light
          : Haptics.ImpactFeedbackStyle.Medium
      );

      // Guardar en background
      saveFavorites(newFavorites);

      return newFavorites;
    });
  }, [saveFavorites]);

  // Verificar si es favorito
  const isFavorite = useCallback((appId: string) => {
    return favorites.includes(appId);
  }, [favorites]);

  // Agregar a favoritos (using functional update to avoid stale closure)
  const addFavorite = useCallback(async (appId: string) => {
    let newFavorites: string[] = [];
    setFavorites((current) => {
      if (current.includes(appId)) {
        newFavorites = current;
        return current;
      }
      newFavorites = [...current, appId];
      return newFavorites;
    });
    // Only save and provide feedback if actually added
    if (newFavorites.length > 0 && newFavorites[newFavorites.length - 1] === appId) {
      await saveFavorites(newFavorites);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [saveFavorites]);

  // Remover de favoritos (using functional update to avoid stale closure)
  const removeFavorite = useCallback(async (appId: string) => {
    let newFavorites: string[] = [];
    setFavorites((current) => {
      newFavorites = current.filter((id) => id !== appId);
      return newFavorites;
    });
    await saveFavorites(newFavorites);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [saveFavorites]);

  // Cargar al montar
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

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
