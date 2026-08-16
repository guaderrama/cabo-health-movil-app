// hooks/index.ts
// Barrel export para todos los hooks

export { useWebApps } from './useWebApps';
export { useNetworkStatus } from './useNetworkStatus';
export { useFavorites } from './useFavorites';
export { useReducedMotion } from './useReducedMotion';

// Theme hook (re-export from context)
export { useTheme, ThemeProvider } from '../context/ThemeContext';
export type { ThemeMode } from '../context/ThemeContext';
