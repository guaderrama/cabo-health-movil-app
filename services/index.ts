// services/index.ts
// Barrel export para todos los servicios

export { initializeFirebase, getFirestoreDB } from './firebase';
export { fetchWebApps, subscribeToWebApps, fetchWebAppById } from './firestore';
export {
  saveFavorites,
  getFavorites,
  cacheWebApps,
  getCachedWebApps,
  getLastSyncTime,
  setBiometryEnabled,
  getBiometryEnabled,
  setHapticEnabled,
  getHapticEnabled,
  setLastBackgroundTime,
  getLastBackgroundTime,
  clearAllStorage,
  getLocalState,
} from './storage';
