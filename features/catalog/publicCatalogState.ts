export interface CatalogMiniapp {
  slug: string;
  title: { en: string };
  summary: { en: string };
  canonicalUrl: string;
}

type FavoriteListener = () => void;

let favoriteSnapshot: string[] = [];
const favoriteListeners = new Set<FavoriteListener>();

export function getFavoriteSnapshot(): readonly string[] {
  return favoriteSnapshot;
}

export function setFavoriteSnapshot(favorites: readonly string[]): void {
  const nextSnapshot = [...favorites];
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
  const nextSnapshot = favoriteSnapshot.includes(id)
    ? favoriteSnapshot.filter((favorite) => favorite !== id)
    : [...favoriteSnapshot, id];
  setFavoriteSnapshot(nextSnapshot);
  return favoriteSnapshot;
}

export function subscribeFavoriteSnapshot(listener: FavoriteListener): () => void {
  favoriteListeners.add(listener);
  return () => favoriteListeners.delete(listener);
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
