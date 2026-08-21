import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, type ThemeColors } from '../constants/colors';
import { getThemePreference, setThemePreference } from '../services/storage';
import { createOrderedPersistence } from '../features/preferences/persistencePolicy';
import type { MessageKey } from '../i18n/messages';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface PersistenceIssue {
  messageKey: MessageKey;
  retry: () => void;
}

interface ThemeContextType {
  theme: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  persistenceIssue: PersistenceIssue | null;
  setTheme: (theme: ThemeMode) => Promise<boolean>;
  toggleTheme: () => Promise<boolean>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [theme, setThemeState] = useState<ThemeMode>('light');
  const [isLoaded, setIsLoaded] = useState(false);
  const [persistenceIssue, setPersistenceIssue] = useState<PersistenceIssue | null>(null);
  const writerRef = useRef<ReturnType<typeof createOrderedPersistence<ThemeMode>> | null>(null);

  if (!writerRef.current) {
    writerRef.current = createOrderedPersistence<ThemeMode>({
      persist: setThemePreference,
      onCommit: (value) => {
        setThemeState(value);
        setPersistenceIssue(null);
      },
      onFailure: (value) => {
        setPersistenceIssue({
          messageKey: 'storage.themeWriteError',
          retry: () => { void writerRef.current?.submit(value); },
        });
      },
    });
  }

  const loadTheme = useCallback(async function load() {
    const read = writerRef.current!.beginRead();
    const result = await getThemePreference();
    read.applyCurrent(() => {
      setThemeState(result.value);
      setPersistenceIssue(result.status === 'error' ? {
        messageKey: 'storage.readError',
        retry: () => { void load(); },
      } : null);
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    void loadTheme();
  }, [loadTheme]);

  const setTheme = useCallback((newTheme: ThemeMode) => (
    writerRef.current!.submit(newTheme)
  ), []);

  const isDark = theme === 'dark' || (theme === 'system' && systemColorScheme === 'dark');
  const colors = isDark ? darkColors : lightColors;
  const toggleTheme = useCallback(
    () => setTheme(isDark ? 'light' : 'dark'),
    [isDark, setTheme],
  );

  if (!isLoaded) return null;
  return (
    <ThemeContext.Provider value={{
      theme,
      isDark,
      colors,
      persistenceIssue,
      setTheme,
      toggleTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within a ThemeProvider');
  return value;
}

export default ThemeContext;
