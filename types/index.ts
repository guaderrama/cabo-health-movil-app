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

export interface AppState {
  apps: WebApp[];
  favorites: string[];
  isLoading: boolean;
  isOffline: boolean;
  error: string | null;
}

// Navigation types
export type RootStackParamList = {
  index: undefined;
  '(main)': undefined;
  '(main)/index': undefined;
  '(main)/settings': undefined;
  '(main)/webview/[id]': { id: string };
};

// WebView state
export interface WebViewState {
  loading: boolean;
  progress: number;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}
