// types/index.ts
// Tipos TypeScript para WebApp Launcher

export interface WebApp {
  id: string;
  name: string;          // Título de la card
  description: string;   // Descripción corta
  url: string;           // URL a abrir en WebView
  icon?: string;         // Emoji opcional (si no se usa categoría)
  color?: string;        // Color hex opcional (si no se usa categoría)
  category?: string;     // Categoría - determina icono y color automáticamente
  order: number;         // Posición en grid
  isActive: boolean;     // Si se muestra o no
  isNew?: boolean;       // Badge "Nuevo"
  isFavorite?: boolean;  // Agregado localmente por el cliente
}

export interface WebAppFirestore {
  id: string;
  name: string;
  description: string;
  url: string;
  icon?: string;         // Opcional - usa categoría si no se especifica
  color?: string;        // Opcional - usa categoría si no se especifica
  category?: string;     // Determina icono y color automáticamente
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  isNew?: boolean;
}

export interface AppState {
  apps: WebApp[];
  favorites: string[];
  isLoading: boolean;
  isOffline: boolean;
  error: string | null;
}

export interface UserPreferences {
  biometryEnabled: boolean;
  hapticEnabled: boolean;
}

export interface LocalStorage {
  favorites: string[];
  favoritesOrder: string[];
  cachedApps: WebApp[];
  lastSync: number;
  biometryEnabled: boolean;
  hasSeenOnboarding: boolean;
}

// Navigation types
export type RootStackParamList = {
  index: undefined;
  '(main)': undefined;
  '(main)/index': undefined;
  '(main)/settings': undefined;
  '(main)/webview/[id]': { id: string };
  '(auth)/biometry': undefined;
};

// WebView state
export interface WebViewState {
  loading: boolean;
  progress: number;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

// Access Code types
export interface AccessCode {
  id?: string;
  code: string;
  clientName: string;
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  deviceId?: string;
  notes?: string;
}

export interface AccessCodeResult {
  isValid: boolean;
  clientName?: string;
  error?: 'invalid' | 'expired' | 'revoked' | 'network_error';
  expiresAt?: Date;
}

export interface AccessCodeState {
  hasValidCode: boolean;
  isLoading: boolean;
  clientName: string | null;
  code: string | null;
  error: string | null;
}
