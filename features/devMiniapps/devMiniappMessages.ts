import type { AppLanguage } from '../../i18n/messages';

// Static proof that this catalog belongs to development source only. Production
// app entries must not import any module below features/devMiniapps.
export const DEV_MINIAPP_FEATURE_MARKER = 'development-source-only' as const;

const englishDevMiniappMessages = {
  'devPanel.title': 'Miniapp test panel',
  'devPanel.subtitle': 'Development only. Add a public HTTPS page from any domain. These entries stay on this device and are never included in the App Store release.',
  'devPanel.current': 'Current tests',
  'devPanel.empty': 'No test miniapps yet.',
  'devPanel.addTitle': 'Add a test miniapp',
  'devPanel.titleEn': 'Name in English',
  'devPanel.titleEs': 'Name in Spanish',
  'devPanel.summaryEn': 'Description in English',
  'devPanel.summaryEs': 'Description in Spanish',
  'devPanel.url': 'Public HTTPS link',
  'devPanel.icon': 'Icon',
  'devPanel.iconLab': 'Laboratory',
  'devPanel.iconGuide': 'Guide',
  'devPanel.iconNutrition': 'Nutrition',
  'devPanel.iconRecipes': 'Recipes',
  'devPanel.iconWellness': 'Wellness',
  'devPanel.iconLocation': 'Location',
  'devPanel.iconContact': 'Contact',
  'devPanel.iconFeatured': 'Featured',
  'devPanel.access': 'Access',
  'devPanel.public': 'Public',
  'devPanel.clients': 'Clients',
  'devPanel.add': 'Add miniapp',
  'devPanel.remove': 'Remove',
  'devPanel.active': 'Visible',
  'devPanel.inactive': 'Hidden',
  'devPanel.testOnly': 'TEST ONLY',
  'devPanel.storageError': 'The private test catalog could not be saved or loaded.',
  'devPanel.removeConfirm': 'Remove this test miniapp?',
  'devPanel.previewBlocked': 'This test page tried to leave the selected website.',
  'devPanel.validationError': 'Complete both languages and use an unused public HTTPS link without a password.',
  'devPanel.openHint': 'Press and hold, or tap five times, to open the private test panel.',
  'devPanel.useSample': 'Fill with a working sample',
  'devPanel.accessWarning': 'The access label is visual in this development panel. Production client access is managed separately through verified codes.',
} as const;

export type DevMiniappMessageKey = keyof typeof englishDevMiniappMessages;

const spanishDevMiniappMessages: Record<DevMiniappMessageKey, string> = {
  'devPanel.title': 'Panel de prueba de miniapps',
  'devPanel.subtitle': 'Sólo para desarrollo. Agrega una página pública HTTPS de cualquier dominio. Estas entradas permanecen en este dispositivo y nunca se incluyen en la versión de App Store.',
  'devPanel.current': 'Pruebas actuales',
  'devPanel.empty': 'Aún no hay miniapps de prueba.',
  'devPanel.addTitle': 'Agregar miniapp de prueba',
  'devPanel.titleEn': 'Nombre en inglés',
  'devPanel.titleEs': 'Nombre en español',
  'devPanel.summaryEn': 'Descripción en inglés',
  'devPanel.summaryEs': 'Descripción en español',
  'devPanel.url': 'Enlace público HTTPS',
  'devPanel.icon': 'Ícono',
  'devPanel.iconLab': 'Laboratorio',
  'devPanel.iconGuide': 'Guía',
  'devPanel.iconNutrition': 'Nutrición',
  'devPanel.iconRecipes': 'Recetas',
  'devPanel.iconWellness': 'Bienestar',
  'devPanel.iconLocation': 'Ubicación',
  'devPanel.iconContact': 'Contacto',
  'devPanel.iconFeatured': 'Destacada',
  'devPanel.access': 'Acceso',
  'devPanel.public': 'Pública',
  'devPanel.clients': 'Clientes',
  'devPanel.add': 'Agregar miniapp',
  'devPanel.remove': 'Quitar',
  'devPanel.active': 'Visible',
  'devPanel.inactive': 'Oculta',
  'devPanel.testOnly': 'SÓLO PRUEBA',
  'devPanel.storageError': 'No se pudo guardar o cargar el catálogo privado de prueba.',
  'devPanel.removeConfirm': '¿Quitar esta miniapp de prueba?',
  'devPanel.previewBlocked': 'Esta página de prueba intentó salir del sitio web seleccionado.',
  'devPanel.validationError': 'Completa ambos idiomas y usa un enlace público HTTPS que no tenga contraseña.',
  'devPanel.openHint': 'Mantén presionado o toca cinco veces para abrir el panel privado de prueba.',
  'devPanel.useSample': 'Llenar con un ejemplo funcional',
  'devPanel.accessWarning': 'La etiqueta de acceso es sólo visual en este panel de desarrollo. El acceso de clientes en producción se administra por separado con códigos verificados.',
};

const DEV_MINIAPP_MESSAGES: Record<
  AppLanguage,
  Readonly<Record<DevMiniappMessageKey, string>>
> = {
  en: englishDevMiniappMessages,
  'es-MX': spanishDevMiniappMessages,
};

export function translateDevMiniappMessage(
  language: AppLanguage,
  key: DevMiniappMessageKey,
): string {
  return DEV_MINIAPP_MESSAGES[language][key];
}
