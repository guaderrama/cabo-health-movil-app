import { config } from '../../constants/config';

export const ONBOARDING_COMPLETION_KEY = config.storageKeys.hasSeenOnboarding;

export interface OnboardingStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export async function readOnboardingCompletion(storage: OnboardingStorage): Promise<boolean> {
  return (await storage.getItem(ONBOARDING_COMPLETION_KEY)) === 'true';
}

export async function writeOnboardingCompletion(
  storage: OnboardingStorage,
  completed: boolean,
): Promise<void> {
  await storage.setItem(ONBOARDING_COMPLETION_KEY, JSON.stringify(completed));
}
