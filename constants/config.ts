// constants/config.ts
// Configuraciones de la app CaboHealth

export const config = {
  // App info
  app: {
    name: 'CaboHealth',
    version: '2.0.0',
    buildNumber: '1',
  },

  // Firebase
  firebase: {
    // Estas credenciales deben ser configuradas en Firebase Console
    // y reemplazadas con los valores reales
    apiKey: 'TU_API_KEY',
    authDomain: 'TU_PROJECT.firebaseapp.com',
    projectId: 'TU_PROJECT_ID',
    storageBucket: 'TU_PROJECT.appspot.com',
    messagingSenderId: 'TU_MESSAGING_SENDER_ID',
    appId: 'TU_APP_ID',
  },

  // Firestore collections (con prefijo para evitar conflictos)
  collections: {
    webApps: 'cabohealth_apps',
    config: 'cabohealth_config',
  },

  // Storage keys
  storageKeys: {
    favorites: '@cabohealth_favorites',
    favoritesOrder: '@cabohealth_favorites_order',
    cachedApps: '@cabohealth_cached_apps',
    lastSync: '@cabohealth_last_sync',
    biometryEnabled: '@cabohealth_biometry_enabled',
    hapticEnabled: '@cabohealth_haptic_enabled',
    hasSeenOnboarding: '@cabohealth_has_seen_onboarding',
    lastBackgroundTime: '@cabohealth_last_background_time',
  },

  // Timeouts
  timeouts: {
    syncInterval: 5 * 60 * 1000, // 5 minutos
    biometrySessionDuration: 5 * 60 * 1000, // 5 minutos
    networkTimeout: 10 * 1000, // 10 segundos
    webViewTimeout: 30 * 1000, // 30 segundos
  },

  // Limits
  limits: {
    maxFavorites: 10,
    maxCachedApps: 50,
    searchMinLength: 2,
  },

  // URLs
  urls: {
    support: 'https://cabohealth.com/support',
    privacy: 'https://cabohealth.com/privacy',
    terms: 'https://cabohealth.com/terms',
  },

  // Features flags
  features: {
    biometryEnabled: true,
    widgetsEnabled: true,
    searchEnabled: true,
    offlineModeEnabled: true,
    hapticFeedbackEnabled: true,
  },
} as const;

export type ConfigKey = keyof typeof config;
