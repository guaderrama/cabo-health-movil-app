export type AppLanguage = 'en' | 'es-MX';

export function normalizeLanguage(value: unknown): AppLanguage {
  return value === 'es-MX' ? 'es-MX' : 'en';
}

export function normalizeReducedEffectsOverride(value: unknown): boolean {
  return value === true;
}

export function parseStoredBoolean(
  serialized: string | null,
  fallback: boolean,
): boolean {
  if (serialized === 'true') return true;
  if (serialized === 'false') return false;
  return fallback;
}

export function resolveReducedEffects(
  osReduceMotionEnabled: boolean,
  overrideEnabled: boolean,
): boolean {
  return osReduceMotionEnabled || overrideEnabled;
}
