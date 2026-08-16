import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  normalizePublicFavorites,
  togglePublicFavorite,
} from '../features/catalog/publicCatalogState';
import { getFavorites, saveFavorites } from '../services/storage';
import { usePreferences } from './PreferencesContext';

interface FavoritesContextValue {
  favorites: readonly string[];
  isFavorite: (slug: string) => boolean;
  toggleFavorite: (slug: string) => void;
  addFavorite: (slug: string) => void;
  removeFavorite: (slug: string) => void;
  clearFavorites: () => void;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { triggerHaptic } = usePreferences();
  const [favorites, setFavorites] = useState<string[] | null>(null);

  useEffect(() => {
    let mounted = true;
    getFavorites().then((storedFavorites) => {
      if (mounted) setFavorites(normalizePublicFavorites(storedFavorites));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const commit = useCallback((nextFavorites: readonly string[], cue: 'light' | 'medium') => {
    const normalized = normalizePublicFavorites(nextFavorites);
    setFavorites(normalized);
    triggerHaptic(cue);
    saveFavorites(normalized).catch(() => {});
  }, [triggerHaptic]);

  const toggleFavorite = useCallback((slug: string) => {
    if (!favorites) return;
    const wasFavorite = favorites.includes(slug);
    const next = togglePublicFavorite(favorites, slug);
    if (next.length === favorites.length && next.every((value, index) => value === favorites[index])) return;
    commit(next, wasFavorite ? 'light' : 'medium');
  }, [commit, favorites]);

  const addFavorite = useCallback((slug: string) => {
    if (!favorites || favorites.includes(slug)) return;
    const next = togglePublicFavorite(favorites, slug);
    if (next.length !== favorites.length) commit(next, 'medium');
  }, [commit, favorites]);

  const removeFavorite = useCallback((slug: string) => {
    if (!favorites?.includes(slug)) return;
    commit(favorites.filter((favorite) => favorite !== slug), 'light');
  }, [commit, favorites]);

  const clearFavorites = useCallback(() => {
    if (!favorites?.length) return;
    commit([], 'light');
  }, [commit, favorites]);

  const value = useMemo<FavoritesContextValue>(() => ({
    favorites: favorites ?? [],
    isFavorite: (slug: string) => favorites?.includes(slug) ?? false,
    toggleFavorite,
    addFavorite,
    removeFavorite,
    clearFavorites,
  }), [addFavorite, clearFavorites, favorites, removeFavorite, toggleFavorite]);

  if (favorites === null) return null;
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error('useFavorites must be used within FavoritesProvider');
  return value;
}
