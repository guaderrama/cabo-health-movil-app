import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import {
  resolveReducedEffects,
  type AppLanguage,
} from '../features/preferences/preferencesPolicy';

export type HapticCue = 'selection' | 'light' | 'medium' | 'success';

interface PreferencesContextValue {
  language: AppLanguage;
  hapticsEnabled: boolean;
  reducedEffectsOverride: boolean;
  reduceMotion: boolean;
  setLanguage: (language: AppLanguage) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setReducedEffectsOverride: (enabled: boolean) => void;
  triggerHaptic: (cue?: HapticCue) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [reducedEffectsOverride, setReducedEffectsOverrideState] = useState(false);
  const [osReduceMotion, setOsReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setOsReduceMotion,
    );

    Promise.all([
      getLanguage(),
      getHapticEnabled(),
      getReducedEffectsOverride(),
      AccessibilityInfo.isReduceMotionEnabled().catch(() => true),
    ]).then(([storedLanguage, storedHaptics, storedReducedEffects, systemReducedMotion]) => {
      if (!mounted) return;
      setLanguageState(storedLanguage);
      setHapticsEnabledState(storedHaptics);
      setReducedEffectsOverrideState(storedReducedEffects);
      setOsReduceMotion(systemReducedMotion);
      setIsReady(true);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    persistLanguage(nextLanguage).catch(() => {});
  }, []);

  const setHapticsEnabled = useCallback((enabled: boolean) => {
    setHapticsEnabledState(enabled);
    persistHapticEnabled(enabled).catch(() => {});
  }, []);

  const setReducedEffectsOverride = useCallback((enabled: boolean) => {
    setReducedEffectsOverrideState(enabled);
    persistReducedEffectsOverride(enabled).catch(() => {});
  }, []);

  const triggerHaptic = useCallback((cue: HapticCue = 'selection') => {
    if (!hapticsEnabled) return;
    const feedback = cue === 'selection'
      ? Haptics.selectionAsync()
      : cue === 'success'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.impactAsync(
          cue === 'medium'
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light,
        );
    feedback.catch(() => {});
  }, [hapticsEnabled]);

  const value = useMemo<PreferencesContextValue>(() => ({
    language,
    hapticsEnabled,
    reducedEffectsOverride,
    reduceMotion: resolveReducedEffects(osReduceMotion, reducedEffectsOverride),
    setLanguage,
    setHapticsEnabled,
    setReducedEffectsOverride,
    triggerHaptic,
  }), [
    hapticsEnabled,
    language,
    osReduceMotion,
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
