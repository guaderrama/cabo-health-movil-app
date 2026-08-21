// constants/colors.ts
// Approved CaboHealth palette. The A4 intro is the visual authority for every
// native surface; light and dark modes stay inside the same color family.

export const introColors = {
  ink: '#082A3C',
  sea: '#0E5876',
  paper: '#FBFAF7',
  bronze: '#B8956A',
  gold: '#C69745',
  soft: '#4F7785',
  gradientTop: '#E3F1F5',
  gradientMiddle: '#EDF6F7',
  gradientBottom: '#FBFAF7',
} as const;

// Light Mode Colors
export const lightColors = {
  primary: introColors.sea,
  primaryLight: '#3F8298',
  primaryDark: introColors.ink,

  accent: introColors.bronze,
  accentLight: '#D8C2A3',
  accentDark: '#7A562F',

  // Fondos
  background: introColors.paper,
  cardBackground: '#FFFFFF',

  // Texto
  text: introColors.ink,
  textSecondary: introColors.soft,
  textTertiary: '#6D8C97',

  // Estados
  success: '#2E715E',
  error: '#A13F3F',
  warning: '#8A5D28',
  info: introColors.sea,

  // Favoritos
  favorite: introColors.bronze,
  favoriteActive: introColors.bronze,
  favoriteInactive: '#AFC3C9',

  // Otros
  border: '#D5E3E7',
  separator: '#C5D8DE',
  white: '#FFFFFF',
  black: '#000000',

  // Overlay
  overlay: 'rgba(0,0,0,0.4)',
  overlayLight: 'rgba(0,0,0,0.1)',

  // Badge
  badgeNew: introColors.sea,
  badgeNewText: '#FFFFFF',

  // Disabled
  disabled: '#AFC3C9',
  disabledBackground: '#EDF4F5',

  // Gradientes (para uso en LinearGradient) - 3 colores premium
  gradientStart: introColors.gradientTop,
  gradientMiddle: introColors.gradientMiddle,
  gradientEnd: introColors.gradientBottom,

  // Glassmorphism
  glass: 'rgba(255, 255, 255, 0.88)',
  glassBorder: 'rgba(14, 88, 118, 0.14)',
} as const;

// Dark Mode Colors - Premium Aesthetic
export const darkColors = {
  primary: '#8BC7D2',
  primaryLight: '#B8DDE3',
  primaryDark: introColors.sea,

  accent: introColors.bronze,
  accentLight: '#DEC9AA',
  accentDark: '#8A633A',

  // Fondos - Slate oscuro premium
  background: introColors.ink,
  cardBackground: '#10384A',

  // Texto - Contraste alto
  text: introColors.paper,
  textSecondary: '#B8CDD3',
  textTertiary: '#86A7B1',

  // Estados (más brillantes en dark)
  success: '#7FC6A9',
  error: '#F19A9A',
  warning: '#DEC08E',
  info: '#8BC7D2',

  // Favoritos
  favorite: '#DEC08E',
  favoriteActive: '#DEC08E',
  favoriteInactive: '#628392',

  // Otros
  border: '#315667',
  separator: '#426A7A',
  white: '#FFFFFF',
  black: '#000000',

  // Overlay
  overlay: 'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(0,0,0,0.3)',

  // Badge
  badgeNew: introColors.sea,
  badgeNewText: '#FFFFFF',

  // Disabled
  disabled: '#628392',
  disabledBackground: '#143C4E',

  // Gradientes (para uso en LinearGradient) - 3 colores premium
  gradientStart: introColors.ink,
  gradientMiddle: '#0B3042',
  gradientEnd: '#10384A',

  // Glassmorphism - efecto vidrio oscuro premium
  glass: 'rgba(8, 42, 60, 0.88)',
  glassBorder: 'rgba(139, 199, 210, 0.22)',
} as const;

// Default export para compatibilidad (Light Mode)
export const colors = lightColors;

// Type that allows both light and dark color palettes
export type ThemeColors = typeof lightColors | typeof darkColors;
export type ColorKey = keyof typeof lightColors;
