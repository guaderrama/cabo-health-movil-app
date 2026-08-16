// constants/layout.ts
// Constantes de diseño para WebApp Launcher

import { Dimensions, Platform } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const layout = {
  // Screen dimensions
  screenWidth: SCREEN_WIDTH,
  screenHeight: SCREEN_HEIGHT,

  // Spacing
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },

  // Border radius
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 9999,
  },

  // Cards
  card: {
    minHeight: 120,
    gap: 12,
    padding: 16,
    iconSize: 44,
  },

  // Grid
  grid: {
    columns: 2,
    gap: 12,
    padding: 16,
  },

  // Typography
  fontSize: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    title: 28,
  },

  // Font weights
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },

  // Header
  header: {
    height: Platform.OS === 'ios' ? 44 : 56,
    iconSize: 24,
    paddingHorizontal: 16,
  },

  // Safe area
  safeArea: {
    top: Platform.OS === 'ios' ? 47 : 24,
    bottom: Platform.OS === 'ios' ? 34 : 16,
  },

  // Approved A4 cover proportions.
  intro: {
    logoTopRatio: 0.18,
    identityTopRatio: 0.39,
    messageTopRatio: 0.56,
    horizontalInset: 27,
    ctaBottom: 54,
    ctaMinHeight: 48,
    logoMaxWidth: 230,
  },

  // Shadows
  shadow: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 5,
    },
  },

  // Progress bar
  progressBar: {
    height: 2,
  },

  // Settings row
  settingsRow: {
    height: 56,
    iconSize: 28,
  },
} as const;

export type LayoutKey = keyof typeof layout;
