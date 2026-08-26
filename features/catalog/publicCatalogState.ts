import { isPermanentlyRetiredCatalogId } from './catalogIdPolicy';

export interface CatalogMiniapp {
  slug: string;
  title: { en: string };
  summary: { en: string };
  canonicalUrl: string;
}

type FavoriteListener = () => void;

let favoriteSnapshot: string[] = [];
const favoriteListeners = new Set<FavoriteListener>();
const CANONICAL_FAVORITES = ['healthy-recipes', 'clinic-guide'] as const;
const PUBLIC_ID_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RESERVED_PRIVATE_IDS = new Set([
  'client-resources',
  'app-review',
  'shared',
]);
const MAX_REMEMBERED_FAVORITES = 64;

export function normalizePublicFavorites(favorites: readonly unknown[]): string[] {
  const requested = new Set(
    favorites.filter((favorite): favorite is string => typeof favorite === 'string'),
  );
  return CANONICAL_FAVORITES.filter((slug) => requested.has(slug));
}

export function togglePublicFavorite(favorites: readonly string[], id: string): string[] {
  const normalized = normalizePublicFavorites(favorites);
  if (!CANONICAL_FAVORITES.includes(id as (typeof CANONICAL_FAVORITES)[number])) {
    return normalized;
  }
  return normalizePublicFavorites(
    normalized.includes(id)
      ? normalized.filter((favorite) => favorite !== id)
      : [...normalized, id],
  );
}

export function normalizeRememberedPublicFavorites(favorites: readonly unknown[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of favorites) {
    if (
      typeof value !== 'string'
      || !PUBLIC_ID_PATTERN.test(value)
      || isPermanentlyRetiredCatalogId(value)
      || RESERVED_PRIVATE_IDS.has(value)
      || seen.has(value)
    ) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length === MAX_REMEMBERED_FAVORITES) break;
  }
  return normalized;
}

export function toggleRememberedPublicFavorite(
  favorites: readonly string[],
  id: string,
): string[] {
  const normalized = normalizeRememberedPublicFavorites(favorites);
  if (
    !PUBLIC_ID_PATTERN.test(id)
    || isPermanentlyRetiredCatalogId(id)
    || RESERVED_PRIVATE_IDS.has(id)
  ) return normalized;
  return normalizeRememberedPublicFavorites(
    normalized.includes(id)
      ? normalized.filter((favorite) => favorite !== id)
      : [...normalized, id],
  );
}

export function getFavoriteSnapshot(): readonly string[] {
  return favoriteSnapshot;
}

export function setFavoriteSnapshot(favorites: readonly string[]): void {
  const nextSnapshot = normalizePublicFavorites(favorites);
  if (
    nextSnapshot.length === favoriteSnapshot.length
    && nextSnapshot.every((favorite, index) => favorite === favoriteSnapshot[index])
  ) {
    return;
  }

  favoriteSnapshot = nextSnapshot;
  for (const listener of [...favoriteListeners]) listener();
}

export function toggleFavoriteSnapshot(id: string): readonly string[] {
  const nextSnapshot = togglePublicFavorite(favoriteSnapshot, id);
  setFavoriteSnapshot(nextSnapshot);
  return favoriteSnapshot;
}

export function subscribeFavoriteSnapshot(listener: FavoriteListener): () => void {
  favoriteListeners.add(listener);
  return () => favoriteListeners.delete(listener);
}

export async function settleFavoritePersistence(
  persist: () => Promise<void>,
  reportFailure: () => void,
): Promise<void> {
  try {
    await persist();
  } catch {
    try {
      reportFailure();
    } catch {}
  }
}

export function createPublicCatalogState(
  miniapps: readonly CatalogMiniapp[],
  favorites: readonly string[],
  isOffline = false,
) {
  const apps = miniapps.map((miniapp, index) => ({
    id: miniapp.slug,
    name: miniapp.title.en,
    description: miniapp.summary.en,
    url: miniapp.canonicalUrl,
    category: miniapp.slug === 'healthy-recipes' ? 'nutricion' : 'salud',
    order: index,
    isActive: true,
    isFavorite: favorites.includes(miniapp.slug),
  }));

  return {
    apps,
    favoriteApps: apps.filter((app) => app.isFavorite),
    nonFavoriteApps: apps.filter((app) => !app.isFavorite),
    isLoading: false,
    error: null,
    isOffline,
  };
}
