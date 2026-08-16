import type { PublicMiniapp } from '../../constants/publicMiniapps';
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
  miniapp: Readonly<PublicMiniapp>,
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

export function resolveCatalogCardColumns(input: { width: number; fontScale: number }): 1 | 2 {
  return input.width >= 375 && input.fontScale < 1.35 ? 2 : 1;
}
