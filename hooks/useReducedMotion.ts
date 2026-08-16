import { usePreferences } from '../context/PreferencesContext';

export function useReducedMotion(): boolean {
  return usePreferences().reduceMotion;
}
