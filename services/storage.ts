// services/storage.ts
// AsyncStorage helpers para WebApp Launcher

import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebApp, LocalStorage } from '../types';
import { config } from '../constants';

const KEYS = config.storageKeys;

/**
 * Guarda los favoritos en storage local
 */
export async function saveFavorites(favorites: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.favorites, JSON.stringify(favorites));
  } catch (error) {
    console.error('Error saving favorites:', error);
    throw error;
  }
}

/**
 * Obtiene los favoritos del storage local
 */
export async function getFavorites(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.favorites);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error getting favorites:', error);
    return [];
  }
}

/**
 * Guarda las apps en caché para modo offline
 */
export async function cacheWebApps(apps: WebApp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.cachedApps, JSON.stringify(apps));
    await AsyncStorage.setItem(KEYS.lastSync, Date.now().toString());
  } catch (error) {
    console.error('Error caching web apps:', error);
    throw error;
  }
}

/**
 * Obtiene las apps del caché
 */
export async function getCachedWebApps(): Promise<WebApp[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.cachedApps);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error getting cached web apps:', error);
    return [];
  }
}

/**
 * Obtiene el timestamp de la última sincronización
 */
export async function getLastSyncTime(): Promise<number | null> {
  try {
    const data = await AsyncStorage.getItem(KEYS.lastSync);
    return data ? parseInt(data, 10) : null;
  } catch (error) {
    console.error('Error getting last sync time:', error);
    return null;
  }
}

/**
 * Guarda la preferencia de biometría
 */
export async function setBiometryEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.biometryEnabled, JSON.stringify(enabled));
  } catch (error) {
    console.error('Error saving biometry preference:', error);
    throw error;
  }
}

/**
 * Obtiene la preferencia de biometría
 */
export async function getBiometryEnabled(): Promise<boolean> {
  try {
    const data = await AsyncStorage.getItem(KEYS.biometryEnabled);
    return data ? JSON.parse(data) : false;
  } catch (error) {
    console.error('Error getting biometry preference:', error);
    return false;
  }
}

/**
 * Guarda la preferencia de haptic feedback
 */
export async function setHapticEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.hapticEnabled, JSON.stringify(enabled));
  } catch (error) {
    console.error('Error saving haptic preference:', error);
    throw error;
  }
}

/**
 * Obtiene la preferencia de haptic feedback
 */
export async function getHapticEnabled(): Promise<boolean> {
  try {
    const data = await AsyncStorage.getItem(KEYS.hapticEnabled);
    return data !== null ? JSON.parse(data) : true; // Default: enabled
  } catch (error) {
    console.error('Error getting haptic preference:', error);
    return true;
  }
}

/**
 * Guarda el timestamp de cuando la app fue al background
 */
export async function setLastBackgroundTime(time: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.lastBackgroundTime, time.toString());
  } catch (error) {
    console.error('Error saving last background time:', error);
    throw error;
  }
}

/**
 * Obtiene el timestamp de cuando la app fue al background
 */
export async function getLastBackgroundTime(): Promise<number | null> {
  try {
    const data = await AsyncStorage.getItem(KEYS.lastBackgroundTime);
    return data ? parseInt(data, 10) : null;
  } catch (error) {
    console.error('Error getting last background time:', error);
    return null;
  }
}

/**
 * Limpia todo el storage (para debug/reset)
 */
export async function clearAllStorage(): Promise<void> {
  try {
    const keys = Object.values(KEYS);
    await AsyncStorage.multiRemove(keys);
  } catch (error) {
    console.error('Error clearing storage:', error);
    throw error;
  }
}

/**
 * Obtiene todo el estado local
 */
export async function getLocalState(): Promise<Partial<LocalStorage>> {
  try {
    const [favorites, cachedApps, lastSync, biometryEnabled] = await Promise.all([
      getFavorites(),
      getCachedWebApps(),
      getLastSyncTime(),
      getBiometryEnabled(),
    ]);

    return {
      favorites,
      cachedApps,
      lastSync: lastSync || 0,
      biometryEnabled,
    };
  } catch (error) {
    console.error('Error getting local state:', error);
    return {};
  }
}
