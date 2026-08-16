import { useCallback } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { translateMessage, type MessageKey } from './messages';

export function useTranslations() {
  const { language } = usePreferences();
  const t = useCallback(
    (key: MessageKey) => translateMessage(language, key),
    [language],
  );
  return { language, t };
}
