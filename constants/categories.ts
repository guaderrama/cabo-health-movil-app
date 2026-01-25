// constants/categories.ts
// Category system with automatic icons and colors
// Admin only needs to specify the category and icon/color are assigned automatically
// Consolidated to 6 core premium icons: dna, cell, brain, molecule, analytics, heartPulse

import { Ionicons } from '@expo/vector-icons';
import type { PremiumIconName } from '../components/icons/PremiumIcon';

export interface CategoryConfig {
  icon: keyof typeof Ionicons.glyphMap;  // Fallback Ionicon
  premiumIcon?: PremiumIconName;         // Premium SVG with gradient
  color: string;
  label: string;
  labelEn: string;
}

export const CATEGORIES: Record<string, CategoryConfig> = {
  // === CELL - Cellular Regeneration (salud, medicina, laboratorio, belleza) ===
  salud: {
    icon: 'medkit-outline',
    premiumIcon: 'cell',
    color: '#F0F7F0',
    label: 'Salud',
    labelEn: 'Health',
  },
  medicina: {
    icon: 'medical-outline',
    premiumIcon: 'cell',
    color: '#F0F7F0',
    label: 'Medicina',
    labelEn: 'Medicine',
  },
  laboratorio: {
    icon: 'flask-outline',
    premiumIcon: 'cell',
    color: '#F5F0F8',
    label: 'Laboratorio',
    labelEn: 'Laboratory',
  },
  belleza: {
    icon: 'sparkles-outline',
    premiumIcon: 'cell',
    color: '#FDF2F0',
    label: 'Belleza',
    labelEn: 'Beauty',
  },
  cosmeticos: {
    icon: 'sparkles-outline',
    premiumIcon: 'cell',
    color: '#FDF2F0',
    label: 'Cosméticos',
    labelEn: 'Cosmetics',
  },

  // === MOLECULE - Microbiome/Nutrition ===
  nutricion: {
    icon: 'nutrition-outline',
    premiumIcon: 'molecule',
    color: '#FDF8F3',
    label: 'Nutrición',
    labelEn: 'Nutrition',
  },
  alimentacion: {
    icon: 'restaurant-outline',
    premiumIcon: 'molecule',
    color: '#FDF8F3',
    label: 'Alimentación',
    labelEn: 'Food',
  },

  // === HEARTPULSE - Cardiovascular/Fitness ===
  fitness: {
    icon: 'fitness-outline',
    premiumIcon: 'heartPulse',
    color: '#F0F6FC',
    label: 'Fitness',
    labelEn: 'Fitness',
  },
  ejercicio: {
    icon: 'barbell-outline',
    premiumIcon: 'heartPulse',
    color: '#F0F6FC',
    label: 'Ejercicio',
    labelEn: 'Exercise',
  },
  bienestar: {
    icon: 'leaf-outline',
    premiumIcon: 'heartPulse',
    color: '#F0FAFB',
    label: 'Bienestar',
    labelEn: 'Wellness',
  },
  wellness: {
    icon: 'heart-outline',
    premiumIcon: 'heartPulse',
    color: '#F0FAFB',
    label: 'Wellness',
    labelEn: 'Wellness',
  },

  // === DNA - Longevity/Genetics ===
  ciencia: {
    icon: 'beaker-outline',
    premiumIcon: 'dna',
    color: '#F5F0F8',
    label: 'Ciencia',
    labelEn: 'Science',
  },
  longevidad: {
    icon: 'trending-up-outline',
    premiumIcon: 'dna',
    color: '#F0F8F5',
    label: 'Longevidad',
    labelEn: 'Longevity',
  },
  rejuvenecimiento: {
    icon: 'sparkles-outline',
    premiumIcon: 'dna',
    color: '#F0F8F5',
    label: 'Rejuvenecimiento',
    labelEn: 'Rejuvenation',
  },

  // === BRAIN - Neuroscience/Cognitive ===
  cerebro: {
    icon: 'bulb-outline',
    premiumIcon: 'brain',
    color: '#F8F5F0',
    label: 'Cerebro',
    labelEn: 'Brain',
  },
  cognitivo: {
    icon: 'bulb-outline',
    premiumIcon: 'brain',
    color: '#F8F5F0',
    label: 'Cognitivo',
    labelEn: 'Cognitive',
  },
  sueno: {
    icon: 'moon-outline',
    premiumIcon: 'brain',
    color: '#F0F0F8',
    label: 'Sueño',
    labelEn: 'Sleep',
  },
  descanso: {
    icon: 'bed-outline',
    premiumIcon: 'brain',
    color: '#F0F0F8',
    label: 'Descanso',
    labelEn: 'Rest',
  },

  // === ANALYTICS - Data/Metrics/Utilities ===
  analisis: {
    icon: 'analytics-outline',
    premiumIcon: 'analytics',
    color: '#F0F1F8',
    label: 'Análisis',
    labelEn: 'Analytics',
  },
  datos: {
    icon: 'stats-chart-outline',
    premiumIcon: 'analytics',
    color: '#F0F1F8',
    label: 'Datos',
    labelEn: 'Data',
  },
  utilidades: {
    icon: 'apps-outline',
    premiumIcon: 'analytics',
    color: '#F5F5F5',
    label: 'Utilidades',
    labelEn: 'Utilities',
  },
  herramientas: {
    icon: 'construct-outline',
    premiumIcon: 'analytics',
    color: '#F5F5F5',
    label: 'Herramientas',
    labelEn: 'Tools',
  },
  calculadora: {
    icon: 'calculator-outline',
    premiumIcon: 'analytics',
    color: '#FFFBF0',
    label: 'Calculadora',
    labelEn: 'Calculator',
  },

  // === Categories without premium icons (use Ionicons fallback) ===
  notas: {
    icon: 'document-text-outline',
    premiumIcon: 'analytics',
    color: '#FFFCF0',
    label: 'Notas',
    labelEn: 'Notes',
  },
  documentos: {
    icon: 'folder-outline',
    premiumIcon: 'analytics',
    color: '#FFFCF0',
    label: 'Documentos',
    labelEn: 'Documents',
  },
  clima: {
    icon: 'partly-sunny-outline',
    premiumIcon: 'analytics',
    color: '#F0F8FC',
    label: 'Clima',
    labelEn: 'Weather',
  },
  naturaleza: {
    icon: 'flower-outline',
    premiumIcon: 'heartPulse',
    color: '#F0F8F0',
    label: 'Naturaleza',
    labelEn: 'Nature',
  },
  colores: {
    icon: 'color-palette-outline',
    premiumIcon: 'analytics',
    color: '#FCF0F5',
    label: 'Colores',
    labelEn: 'Colors',
  },
  diseno: {
    icon: 'brush-outline',
    premiumIcon: 'analytics',
    color: '#FCF0F5',
    label: 'Diseño',
    labelEn: 'Design',
  },

  // === Default / Other ===
  otro: {
    icon: 'globe-outline',
    premiumIcon: 'dna',
    color: '#F5F5F5',
    label: 'Otro',
    labelEn: 'Other',
  },
} as const;

// Helper function to get category config
export function getCategoryConfig(category?: string): CategoryConfig {
  if (!category) return CATEGORIES.otro;

  const normalizedCategory = category.toLowerCase().trim();
  return CATEGORIES[normalizedCategory] || CATEGORIES.otro;
}

// List of available categories (for admin reference)
export const AVAILABLE_CATEGORIES = Object.keys(CATEGORIES).filter(k => k !== 'otro');

export default CATEGORIES;
