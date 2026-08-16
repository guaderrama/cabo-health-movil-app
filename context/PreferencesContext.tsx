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
import { AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  getHapticEnabled,
  getLanguage,
  getReducedEffectsOverride,
  setHapticEnabled as persistHapticEnabled,
  setLanguage as persistLanguage,
  setReducedEffectsOverride as persistReducedEffectsOverride,
} from '../services/storage';
import { resolveReducedEffects, type AppLanguage } from '../features/preferences/preferencesPolicy';
import { createOrderedPersistence } from '../features/preferences/persistencePolicy';
import type { MessageKey } from '../i18n/messages';

export type HapticCue = 'selection' | 'light' | 'medium' | 'success';
type PreferenceChange =
  | { kind: 'language'; value: AppLanguage }
  | { kind: 'haptics'; value: boolean }
  | { kind: 'reducedEffects'; value: boolean };

interface PersistenceIssue {
  messageKey: MessageKey;
  retry: () => void;
}

interface PreferencesContextValue {
  language: AppLanguage;
  hapticsEnabled: boolean;
  reducedEffectsOverride: boolean;
  reduceMotion: boolean;
  persistenceIssue: PersistenceIssue | null;
  setLanguage: (language: AppLanguage) => Promise<boolean>;
  setHapticsEnabled: (enabled: boolean) => Promise<boolean>;
  setReducedEffectsOverride: (enabled: boolean) => Promise<boolean>;
  triggerHaptic: (cue?: HapticCue) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

function playHaptic(cue: HapticCue): void {
  const feedback = cue === 'selection'
    ? Haptics.selectionAsync()
    : cue === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(
        cue === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
  feedback.catch(() => {});
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [reducedEffectsOverride, setReducedEffectsOverrideState] = useState(false);
  const [osReduceMotion, setOsReduceMotion] = useState(true);
  const [persistenceIssue, setPersistenceIssue] = useState<PersistenceIssue | null>(null);
  const hapticsEnabledRef = useRef(hapticsEnabled);
  hapticsEnabledRef.current = hapticsEnabled;
  const writerRef = useRef<ReturnType<typeof createOrderedPersistence<PreferenceChange>> | null>(null);

  if (!writerRef.current) {
    writerRef.current = createOrderedPersistence<PreferenceChange>({
      persist: async (change) => {
        if (change.kind === 'language') await persistLanguage(change.value);
        if (change.kind === 'haptics') await persistHapticEnabled(change.value);
        if (change.kind === 'reducedEffects') await persistReducedEffectsOverride(change.value);
      },
      onCommit: (change) => {
        if (change.kind === 'language') setLanguageState(change.value);
        if (change.kind === 'haptics') setHapticsEnabledState(change.value);
        if (change.kind === 'reducedEffects') setReducedEffectsOverrideState(change.value);
        setPersistenceIssue(null);
        const hapticsWillBeEnabled = change.kind === 'haptics'
          ? change.value
          : hapticsEnabledRef.current;
        if (hapticsWillBeEnabled) playHaptic('selection');
      },
      onFailure: (change) => {
        setPersistenceIssue({
          messageKey: 'storage.preferenceWriteError',
          retry: () => { void writerRef.current?.submit(change); },
        });
      },
    });
  }

  const loadPreferences = useCallback(async function load() {
    const read = writerRef.current!.beginRead();
    const [storedLanguage, storedHaptics, storedReducedEffects, systemReducedMotion] = await Promise.all([
      getLanguage(),
      getHapticEnabled(),
      getReducedEffectsOverride(),
      AccessibilityInfo.isReduceMotionEnabled().catch(() => true),
    ]);
    read.applyCurrent(() => {
      setLanguageState(storedLanguage.value);
      setHapticsEnabledState(storedHaptics.value);
      setReducedEffectsOverrideState(storedReducedEffects.value);
      setOsReduceMotion(systemReducedMotion);
      const readFailed = [storedLanguage, storedHaptics, storedReducedEffects]
        .some((result) => result.status === 'error');
      setPersistenceIssue(readFailed ? {
        messageKey: 'storage.readError',
        retry: () => { void load(); },
      } : null);
      setIsReady(true);
    });
  }, []);

  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setOsReduceMotion);
    void loadPreferences();
    return () => subscription.remove();
  }, [loadPreferences]);

  const setLanguage = useCallback(
    (value: AppLanguage) => writerRef.current!.submit({ kind: 'language', value }),
    [],
  );
  const setHapticsEnabled = useCallback(
    (value: boolean) => writerRef.current!.submit({ kind: 'haptics', value }),
    [],
  );
  const setReducedEffectsOverride = useCallback(
    (value: boolean) => writerRef.current!.submit({ kind: 'reducedEffects', value }),
    [],
  );
  const triggerHaptic = useCallback((cue: HapticCue = 'selection') => {
    if (hapticsEnabledRef.current) playHaptic(cue);
  }, []);

  const value = useMemo<PreferencesContextValue>(() => ({
    language,
    hapticsEnabled,
    reducedEffectsOverride,
    reduceMotion: resolveReducedEffects(osReduceMotion, reducedEffectsOverride),
    persistenceIssue,
    setLanguage,
    setHapticsEnabled,
    setReducedEffectsOverride,
    triggerHaptic,
  }), [
    hapticsEnabled,
    language,
    osReduceMotion,
    persistenceIssue,
    reducedEffectsOverride,
    setHapticsEnabled,
    setLanguage,
    setReducedEffectsOverride,
    triggerHaptic,
  ]);

  if (!isReady) return null;
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used within PreferencesProvider');
  return value;
}
