export interface LegacyStateStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export const PUBLIC_V1_MIGRATION_MARKER = '@cabohealth_public_v1_migrated';

export const LEGACY_PRIVATE_STATE_KEYS = [
  '@cabohealth_access_code',
  '@cabohealth_client_name',
  '@cabohealth_biometry_enabled',
  '@cabohealth_last_background_time',
  '@cabohealth_cached_apps',
  '@cabohealth_last_sync',
] as const;

const FAVORITES_KEY = '@cabohealth_favorites';
const PUBLIC_MINIAPP_SLUGS = new Set(['healthy-recipes', 'clinic-guide']);

function filterPublicFavorites(serializedFavorites: string): string[] {
  try {
    const favorites: unknown = JSON.parse(serializedFavorites);
    if (!Array.isArray(favorites)) return [];

    return favorites.filter(
      (favorite): favorite is string =>
        typeof favorite === 'string' && PUBLIC_MINIAPP_SLUGS.has(favorite),
    );
  } catch {
    return [];
  }
}

export async function removeLegacyPrivateState(storage: LegacyStateStorage): Promise<void> {
  if ((await storage.getItem(PUBLIC_V1_MIGRATION_MARKER)) === '1') return;

  const serializedFavorites = await storage.getItem(FAVORITES_KEY);
  await storage.multiRemove(LEGACY_PRIVATE_STATE_KEYS);

  if (serializedFavorites !== null) {
    await storage.setItem(
      FAVORITES_KEY,
      JSON.stringify(filterPublicFavorites(serializedFavorites)),
    );
  }

  await storage.setItem(PUBLIC_V1_MIGRATION_MARKER, '1');
}
