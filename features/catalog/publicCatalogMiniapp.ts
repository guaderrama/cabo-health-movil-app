import type { CatalogPublicMiniapp } from '../../constants/publicMiniapps';
import type { PublishedCatalogSnapshot } from './publishedCatalog';

const LEGAL_URLS = Object.freeze({
  privacy: 'https://cabohealth.org/app/privacy/' as const,
  terms: 'https://cabohealth.org/app/terms/' as const,
  support: 'https://cabohealth.org/app/support/' as const,
  reportContent: 'https://cabohealth.org/app/report-content/' as const,
});
const EDITORIAL_SOURCE = Object.freeze({
  en: 'CaboHealth editorial team',
  'es-MX': 'Equipo editorial de CaboHealth',
});

export function resolvePublicCatalogMiniapps<T>(
  snapshot: PublishedCatalogSnapshot | null,
  fallback: readonly T[],
  platform: string,
): readonly Readonly<CatalogPublicMiniapp>[] | readonly T[] {
  if (snapshot !== null) return toPublicCatalogMiniapps(snapshot);
  return platform === 'web' ? fallback : Object.freeze([]);
}

export function toPublicCatalogMiniapps(
  snapshot: PublishedCatalogSnapshot,
): readonly Readonly<CatalogPublicMiniapp>[] {
  return Object.freeze(snapshot.items.map((item) => Object.freeze<CatalogPublicMiniapp>({
    slug: item.id,
    title: Object.freeze({ en: item.title.en, es: item.title['es-MX'] }),
    summary: Object.freeze({ en: item.summary.en, es: item.summary['es-MX'] }),
    canonicalUrl: item.url,
    universalLink: item.url,
    allowedPathPrefix: `/apps/${item.id}/`,
    access: 'public',
    contentDescriptors: ['health-and-wellness-information'],
    appStoreAgeRating: 9,
    dataUse: ['technical-request-logs'],
    permissions: [],
    hasUserGeneratedContent: false,
    hasPurchases: false,
    editorialSource: EDITORIAL_SOURCE,
    reviewedOn: new Date(item.updatedAtMs).toISOString().slice(0, 10),
    contentVersion: String(item.revision),
    legalUrls: LEGAL_URLS,
    iconKey: item.icon,
  })));
}
