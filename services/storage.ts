import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../constants';
import {
  readOnboardingCompletion,
  writeOnboardingCompletion,
} from '../features/onboarding/onboardingStore';
import {
  normalizeLanguage,
  parseStoredBoolean,
  type AppLanguage,
} from '../features/preferences/preferencesPolicy';
import { normalizePublicFavorites } from '../features/catalog/publicCatalogState';

const KEYS = config.storageKeys;

export function parseFavorites(data: string | null): string[] {
  if (!data) return [];

  try {
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) ? normalizePublicFavorites(parsed) : [];
  } catch {
    return [];
  }
}

export async function saveFavorites(favorites: string[]): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.favorites,
    JSON.stringify(normalizePublicFavorites(favorites)),
  );
}

export async function getFavorites(): Promise<string[]> {
  try {
    return parseFavorites(await AsyncStorage.getItem(KEYS.favorites));
  } catch {
    return [];
  }
}

export async function setHapticEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.hapticEnabled, JSON.stringify(enabled));
}

export async function getHapticEnabled(): Promise<boolean> {
  try {
    return parseStoredBoolean(await AsyncStorage.getItem(KEYS.hapticEnabled), true);
  } catch {
    return true;
  }
}

export async function setLanguage(language: AppLanguage): Promise<void> {
  await AsyncStorage.setItem(KEYS.language, language);
}

export async function getLanguage(): Promise<AppLanguage> {
  try {
    return normalizeLanguage(await AsyncStorage.getItem(KEYS.language));
  } catch {
    return 'en';
  }
}

export async function setReducedEffectsOverride(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.reducedEffects, JSON.stringify(enabled));
}

export async function getReducedEffectsOverride(): Promise<boolean> {
  try {
    return parseStoredBoolean(await AsyncStorage.getItem(KEYS.reducedEffects), false);
  } catch {
    return false;
  }
}

export async function getOnboardingCompleted(): Promise<boolean> {
  try {
    return await readOnboardingCompletion(AsyncStorage);
  } catch {
    return false;
  }
}

export async function setOnboardingCompleted(): Promise<void> {
  await writeOnboardingCompletion(AsyncStorage, true);
}
