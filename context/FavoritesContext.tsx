import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  normalizeRememberedPublicFavorites,
  toggleRememberedPublicFavorite,
} from '../features/catalog/publicCatalogState';
import { createOrderedPersistence } from '../features/preferences/persistencePolicy';
import { getFavorites, saveFavorites } from '../services/storage';
import { usePreferences, type HapticCue } from './PreferencesContext';
import type { MessageKey } from '../i18n/messages';

interface FavoriteChange {
  favorites: string[];
  cue: HapticCue;
}

interface PersistenceIssue {
  messageKey: MessageKey;
  retry: () => void;
}

interface FavoritesContextValue {
  favorites: readonly string[];
  persistenceIssue: PersistenceIssue | null;
  isFavorite: (slug: string) => boolean;
  toggleFavorite: (slug: string) => Promise<boolean>;
  addFavorite: (slug: string) => Promise<boolean>;
  removeFavorite: (slug: string) => Promise<boolean>;
  clearFavorites: () => Promise<boolean>;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { triggerHaptic } = usePreferences();
  const triggerHapticRef = useRef(triggerHaptic);
  triggerHapticRef.current = triggerHaptic;
  const [favorites, setFavorites] = useState<string[] | null>(null);
  const committedFavoritesRef = useRef<string[]>([]);
  const intendedFavoritesRef = useRef<string[]>([]);
  const [persistenceIssue, setPersistenceIssue] = useState<PersistenceIssue | null>(null);
  const writerRef = useRef<ReturnType<typeof createOrderedPersistence<FavoriteChange>> | null>(null);

  if (!writerRef.current) {
    writerRef.current = createOrderedPersistence<FavoriteChange>({
      persist: ({ favorites: next }) => saveFavorites(normalizeRememberedPublicFavorites(next)),
      onCommit: ({ favorites: next, cue }, settlement) => {
        const normalized = normalizeRememberedPublicFavorites(next);
        committedFavoritesRef.current = normalized;
        if (settlement.isLatest) intendedFavoritesRef.current = normalized;
        setFavorites(normalized);
        setPersistenceIssue(null);
        triggerHapticRef.current(cue);
      },
      onFailure: (change, settlement) => {
        if (settlement.isLatest) {
          intendedFavoritesRef.current = committedFavoritesRef.current;
        }
        setPersistenceIssue({
          messageKey: 'storage.favoriteWriteError',
          retry: () => {
            const normalized = normalizeRememberedPublicFavorites(change.favorites);
            intendedFavoritesRef.current = normalized;
            void writerRef.current?.submit({ ...change, favorites: normalized });
          },
        });
      },
    });
  }

  const loadFavorites = useCallback(async function load() {
    const read = writerRef.current!.beginRead();
    const result = await getFavorites();
    read.applyCurrent(() => {
      const normalized = normalizeRememberedPublicFavorites(result.value);
      committedFavoritesRef.current = normalized;
      intendedFavoritesRef.current = normalized;
      setFavorites(normalized);
      setPersistenceIssue(result.status === 'error' ? {
        messageKey: 'storage.readError',
        retry: () => { void load(); },
      } : null);
    });
  }, []);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const submit = useCallback((next: readonly string[], cue: HapticCue) => {
    const normalized = normalizeRememberedPublicFavorites(next);
    intendedFavoritesRef.current = normalized;
    return writerRef.current!.submit({ favorites: normalized, cue });
  }, []);

  const toggleFavorite = useCallback((slug: string) => {
    if (!favorites) return Promise.resolve(false);
    const intended = intendedFavoritesRef.current;
    const next = toggleRememberedPublicFavorite(intended, slug);
    if (next.length === intended.length && next.every((value, index) => value === intended[index])) {
      return Promise.resolve(true);
    }
    return submit(next, intended.includes(slug) ? 'light' : 'medium');
  }, [favorites, submit]);

  const addFavorite = useCallback((slug: string) => {
    if (!favorites) return Promise.resolve(false);
    const intended = intendedFavoritesRef.current;
    if (intended.includes(slug)) return Promise.resolve(true);
    const next = toggleRememberedPublicFavorite(intended, slug);
    return next.length === intended.length ? Promise.resolve(false) : submit(next, 'medium');
  }, [favorites, submit]);

  const removeFavorite = useCallback((slug: string) => {
    if (!favorites) return Promise.resolve(false);
    const intended = intendedFavoritesRef.current;
    if (!intended.includes(slug)) return Promise.resolve(true);
    return submit(intended.filter((favorite) => favorite !== slug), 'light');
  }, [favorites, submit]);

  const clearFavorites = useCallback(
    () => !favorites
      ? Promise.resolve(false)
      : !intendedFavoritesRef.current.length
        ? Promise.resolve(true)
        : submit([], 'light'),
    [favorites, submit],
  );

  const value = useMemo<FavoritesContextValue>(() => ({
    favorites: favorites ?? [],
    persistenceIssue,
    isFavorite: (slug: string) => favorites?.includes(slug) ?? false,
    toggleFavorite,
    addFavorite,
    removeFavorite,
    clearFavorites,
  }), [addFavorite, clearFavorites, favorites, persistenceIssue, removeFavorite, toggleFavorite]);

  if (favorites === null) return null;
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error('useFavorites must be used within FavoritesProvider');
  return value;
}
