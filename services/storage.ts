import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../constants';
import {
  readOnboardingCompletion,
  writeOnboardingCompletion,
} from '../features/onboarding/onboardingStore';

const KEYS = config.storageKeys;

function parseFavorites(data: string | null): string[] {
  if (!data) return [];

  try {
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export async function saveFavorites(favorites: string[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.favorites, JSON.stringify(favorites));
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
    const data = await AsyncStorage.getItem(KEYS.hapticEnabled);
    return data === null ? true : JSON.parse(data) === true;
  } catch {
    return true;
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
