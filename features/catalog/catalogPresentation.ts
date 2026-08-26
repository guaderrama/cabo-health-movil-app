import type {
  CatalogPublicMiniapp,
  PublicCatalogIcon,
} from '../../constants/publicMiniapps';
import type { CaboHealthMiniappIconName } from '../../components/icons/CaboHealthMiniappIcon';
import type { AppLanguage, MessageKey } from '../../i18n/messages';

export function formatEditorialDate(value: string, language: AppLanguage): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'es-MX' ? 'es-MX' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function buildCatalogCardAccessibilityLabel(
  miniapp: Readonly<CatalogPublicMiniapp>,
  language: AppLanguage,
  translate: (key: MessageKey) => string,
): string {
  const catalogLanguage = language === 'es-MX' ? 'es' : 'en';
  const facts = [
    miniapp.title[catalogLanguage],
    miniapp.summary[catalogLanguage],
    translate('catalog.publicBadge'),
    `${translate('catalog.source')}: ${miniapp.editorialSource[language]}`,
    `${translate('catalog.reviewed')}: ${formatEditorialDate(miniapp.reviewedOn, language)}`,
    translate('catalog.content'),
    translate('catalog.logs'),
    translate('catalog.permissions'),
  ];
  if (miniapp.appStoreAgeRating !== null) {
    facts.push(`${translate('catalog.age')}: ${miniapp.appStoreAgeRating}+`);
  }
  return facts.join('. ');
}

export function resolveCatalogMiniappIcon(
  icon: PublicCatalogIcon | undefined,
  slug: string,
): CaboHealthMiniappIconName {
  if (!icon) return slug === 'clinic-guide' ? 'sparkles-outline' : 'restaurant-outline';
  return ({
    laboratory: 'flask-outline',
    guide: 'book-outline',
    nutrition: 'leaf-outline',
    recipes: 'restaurant-outline',
    wellness: 'heart-outline',
    location: 'map-outline',
    contact: 'chatbubble-ellipses-outline',
    featured: 'sparkles-outline',
  } as const)[icon];
}

export function resolveCatalogCardColumns(input: { width: number; fontScale: number }): 1 | 2 {
  return input.width >= 375 && input.fontScale < 1.2 ? 2 : 1;
}
