// constants/config.ts
// Configuraciones de la app CaboHealth

export const config = {
  // App info
  app: {
    name: 'CaboHealth',
    version: '2.0.0',
    buildNumber: '1',
  },

  // Storage keys
  storageKeys: {
    favorites: '@cabohealth_favorites',
    favoritesOrder: '@cabohealth_favorites_order',
    language: '@cabohealth_language',
    hapticEnabled: '@cabohealth_haptic_enabled',
    reducedEffects: '@cabohealth_reduced_effects',
    hasSeenOnboarding: '@cabohealth_has_seen_onboarding',
  },

  // Timeouts
  timeouts: {
    networkTimeout: 10 * 1000, // 10 segundos
    webViewTimeout: 30 * 1000, // 30 segundos
  },

  // Limits
  limits: {
    maxFavorites: 10,
    searchMinLength: 2,
  },

  // URLs
  urls: {
    support: 'https://cabohealth.org/app/support/',
    privacy: 'https://cabohealth.org/app/privacy/',
    terms: 'https://cabohealth.org/app/terms/',
    reportContent: 'https://cabohealth.org/app/report-content/',
  },

  // Features flags
  features: {
    widgetsEnabled: true,
    searchEnabled: true,
    hapticFeedbackEnabled: true,
  },
} as const;

export type ConfigKey = keyof typeof config;
