import type { CatalogPublicMiniapp } from '../../constants/publicMiniapps';
import type { PublishedCatalogSnapshot } from './publishedCatalog';
import { parseSafeExternalHttpsDestination } from '../launch/externalHttpsUrlPolicy';

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
  return Object.freeze(snapshot.items.map((item) => {
    const base = {
    slug: item.id,
    title: Object.freeze({ en: item.title.en, es: item.title['es-MX'] }),
    summary: Object.freeze({ en: item.summary.en, es: item.summary['es-MX'] }),
    access: 'public',
    permissions: [],
    hasUserGeneratedContent: false,
    hasPurchases: false,
    reviewedOn: new Date(item.updatedAtMs).toISOString().slice(0, 10),
    contentVersion: String(item.revision),
    legalUrls: LEGAL_URLS,
    iconKey: item.icon,
    } as const;

    if (item.destinationKind === 'cabohealth') {
      return Object.freeze<CatalogPublicMiniapp>({
        ...base,
        canonicalUrl: item.url,
        universalLink: item.url,
        allowedPathPrefix: `/apps/${item.id}/`,
        destinationKind: 'cabohealth',
        contentDescriptors: ['health-and-wellness-information'],
        appStoreAgeRating: 9,
        dataUse: ['technical-request-logs'],
        editorialSource: EDITORIAL_SOURCE,
      });
    }

    const destination = parseSafeExternalHttpsDestination(item.url);
    if (!destination) throw new Error('invalid_external_catalog_destination');
    const hostname = new URL(destination.canonicalUrl).hostname;
    const editorialSource = Object.freeze({ en: hostname, 'es-MX': hostname });
    return Object.freeze<CatalogPublicMiniapp>({
      ...base,
      destinationKind: 'external_https',
      destinationUrl: destination.canonicalUrl,
      destinationOrigin: destination.origin,
      contentDescriptors: ['external-web-resource'],
      appStoreAgeRating: null,
      dataUse: ['third-party-network-request'],
      editorialSource,
    });
  }));
}
