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
