// constants/colors.ts
// Paleta de colores CaboHealth - Medicina Regenerativa
// Soporta Light Mode y Dark Mode Premium

// Light Mode Colors
export const lightColors = {
  // Primarios - Teal Médico
  primary: '#0D9488',
  primaryLight: '#14B8A6',
  primaryDark: '#0F766E',

  // Acento - Azul Cielo
  accent: '#0EA5E9',
  accentLight: '#38BDF8',
  accentDark: '#0284C7',

  // Fondos
  background: '#F8FAFC',
  cardBackground: '#FFFFFF',

  // Texto
  text: '#1E293B',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',

  // Estados
  success: '#22C55E',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#0EA5E9',

  // Favoritos
  favorite: '#F59E0B',
  favoriteActive: '#F59E0B',
  favoriteInactive: '#CBD5E1',

  // Otros
  border: '#E2E8F0',
  separator: '#CBD5E1',
  white: '#FFFFFF',
  black: '#000000',

  // Overlay
  overlay: 'rgba(0,0,0,0.4)',
  overlayLight: 'rgba(0,0,0,0.1)',

  // Badge
  badgeNew: '#0D9488',
  badgeNewText: '#FFFFFF',

  // Disabled
  disabled: '#CBD5E1',
  disabledBackground: '#F1F5F9',

  // Gradientes (para uso en LinearGradient) - 3 colores premium
  gradientStart: '#0D9488',   // Teal profundo
  gradientMiddle: '#0891B2',  // Cyan intermedio
  gradientEnd: '#0284C7',     // Blue profundo

  // Glassmorphism
  glass: 'rgba(255, 255, 255, 0.9)',
  glassBorder: 'rgba(255, 255, 255, 0.5)',
} as const;

// Dark Mode Colors - Premium Aesthetic
export const darkColors = {
  // Primarios - Teal brillante en oscuro
  primary: '#14B8A6',
  primaryLight: '#2DD4BF',
  primaryDark: '#0D9488',

  // Acento - Azul Cielo brillante
  accent: '#38BDF8',
  accentLight: '#7DD3FC',
  accentDark: '#0EA5E9',

  // Fondos - Slate oscuro premium
  background: '#0F172A',
  cardBackground: '#1E293B',

  // Texto - Contraste alto
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',

  // Estados (más brillantes en dark)
  success: '#34D399',
  error: '#F87171',
  warning: '#FBBF24',
  info: '#38BDF8',

  // Favoritos
  favorite: '#FBBF24',
  favoriteActive: '#FBBF24',
  favoriteInactive: '#475569',

  // Otros
  border: '#334155',
  separator: '#475569',
  white: '#FFFFFF',
  black: '#000000',

  // Overlay
  overlay: 'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(0,0,0,0.3)',

  // Badge
  badgeNew: '#14B8A6',
  badgeNewText: '#FFFFFF',

  // Disabled
  disabled: '#475569',
  disabledBackground: '#1E293B',

  // Gradientes (para uso en LinearGradient) - 3 colores premium
  gradientStart: '#0D9488',   // Teal profundo
  gradientMiddle: '#0891B2',  // Cyan intermedio
  gradientEnd: '#0284C7',     // Blue profundo

  // Glassmorphism - efecto vidrio oscuro premium
  glass: 'rgba(15, 23, 42, 0.85)',
  glassBorder: 'rgba(56, 189, 248, 0.15)',  // Subtle cyan border glow
} as const;

// Default export para compatibilidad (Light Mode)
export const colors = lightColors;

// Type that allows both light and dark color palettes
export type ThemeColors = typeof lightColors | typeof darkColors;
export type ColorKey = keyof typeof lightColors;
