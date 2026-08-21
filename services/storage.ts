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
import {
  readStoredValue,
  type StoredValueResult,
} from '../features/preferences/persistencePolicy';
import { normalizePublicFavorites } from '../features/catalog/publicCatalogState';

const KEYS = config.storageKeys;

export function parseFavorites(data: string | null): string[] {
  if (!data) return [];
  const parsed: unknown = JSON.parse(data);
  if (!Array.isArray(parsed)) throw new Error('Invalid favorites value');
  return normalizePublicFavorites(parsed);
}

export async function saveFavorites(favorites: string[]): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.favorites,
    JSON.stringify(normalizePublicFavorites(favorites)),
  );
}

export async function getFavorites(): Promise<StoredValueResult<string[]>> {
  return readStoredValue(AsyncStorage, KEYS.favorites, parseFavorites, []);
}

export async function setHapticEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.hapticEnabled, JSON.stringify(enabled));
}

export async function getHapticEnabled(): Promise<StoredValueResult<boolean>> {
  return readStoredValue(
    AsyncStorage,
    KEYS.hapticEnabled,
    (stored) => {
      if (stored !== 'true' && stored !== 'false') throw new Error('Invalid haptic value');
      return parseStoredBoolean(stored, true);
    },
    true,
  );
}

export async function setLanguage(language: AppLanguage): Promise<void> {
  await AsyncStorage.setItem(KEYS.language, language);
}

export async function getLanguage(): Promise<StoredValueResult<AppLanguage>> {
  return readStoredValue(
    AsyncStorage,
    KEYS.language,
    (stored) => {
      if (stored !== 'en' && stored !== 'es-MX') throw new Error('Invalid language value');
      return normalizeLanguage(stored);
    },
    'en',
  );
}

export async function setReducedEffectsOverride(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.reducedEffects, JSON.stringify(enabled));
}

export async function getReducedEffectsOverride(): Promise<StoredValueResult<boolean>> {
  return readStoredValue(
    AsyncStorage,
    KEYS.reducedEffects,
    (stored) => {
      if (stored !== 'true' && stored !== 'false') throw new Error('Invalid reduced effects value');
      return parseStoredBoolean(stored, false);
    },
    false,
  );
}

const THEME_STORAGE_KEY = '@cabohealth_theme';

export async function getThemePreference(): Promise<StoredValueResult<'light' | 'dark' | 'system'>> {
  return readStoredValue(
    AsyncStorage,
    THEME_STORAGE_KEY,
    (stored) => {
      if (stored !== 'light' && stored !== 'dark' && stored !== 'system') {
        throw new Error('Invalid theme value');
      }
      return stored;
    },
    'light',
  );
}

export async function setThemePreference(theme: 'light' | 'dark' | 'system'): Promise<void> {
  await AsyncStorage.setItem(THEME_STORAGE_KEY, theme);
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
