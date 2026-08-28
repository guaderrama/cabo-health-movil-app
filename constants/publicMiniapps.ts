export type PublicMiniappSlug = 'healthy-recipes' | 'clinic-guide';

export interface PublicMiniappLegalUrls {
  privacy: 'https://cabohealth.org/app/privacy/';
  terms: 'https://cabohealth.org/app/terms/';
  support: 'https://cabohealth.org/app/support/';
  reportContent: 'https://cabohealth.org/app/report-content/';
}

export type PublicCatalogIcon =
  | 'laboratory'
  | 'guide'
  | 'nutrition'
  | 'recipes'
  | 'wellness'
  | 'location'
  | 'contact'
  | 'featured';

export interface CatalogPublicMiniappBase {
  readonly access: 'public';
  readonly contentVersion: string;
  readonly editorialSource: Readonly<{ en: string; 'es-MX': string }>;
  readonly hasPurchases: false;
  readonly hasUserGeneratedContent: false;
  readonly iconKey?: PublicCatalogIcon;
  readonly legalUrls: Readonly<PublicMiniappLegalUrls>;
  readonly permissions: readonly [];
  readonly reviewedOn: string;
  readonly slug: string;
  readonly summary: Readonly<{ en: string; es: string }>;
  readonly title: Readonly<{ en: string; es: string }>;
}

export type CaboHealthCatalogPublicMiniapp = Readonly<
  CatalogPublicMiniappBase & {
    readonly appStoreAgeRating: number | null;
    readonly allowedPathPrefix: string;
    readonly canonicalUrl: string;
    readonly contentDescriptors: readonly ['health-and-wellness-information'];
    readonly dataUse: readonly ['technical-request-logs'];
    readonly destinationKind: 'cabohealth';
    readonly universalLink: string;
  }
>;

export type ExternalHttpsCatalogPublicMiniapp = Readonly<
  CatalogPublicMiniappBase & {
    readonly appStoreAgeRating: null;
    readonly contentDescriptors: readonly ['external-web-resource'];
    readonly dataUse: readonly ['third-party-network-request'];
    readonly destinationKind: 'external_https';
    readonly destinationOrigin: string;
    readonly destinationUrl: string;
  }
>;

export type CatalogPublicMiniapp = Readonly<
  CaboHealthCatalogPublicMiniapp | ExternalHttpsCatalogPublicMiniapp
>;

export type PublicMiniapp = Readonly<
  CatalogPublicMiniappBase & {
    readonly appStoreAgeRating: number | null;
    readonly allowedPathPrefix: `/apps/${PublicMiniappSlug}/`;
    readonly canonicalUrl: `https://cabohealth.org/apps/${PublicMiniappSlug}/`;
    readonly contentDescriptors: readonly ['health-and-wellness-information'];
    readonly dataUse: readonly ['technical-request-logs'];
    readonly destinationKind: 'cabohealth';
    readonly slug: PublicMiniappSlug;
    readonly universalLink: `https://cabohealth.org/apps/${PublicMiniappSlug}/`;
  }
>;

export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const;

export const PUBLIC_MINIAPPS: readonly Readonly<PublicMiniapp>[] = Object.freeze([
  Object.freeze<PublicMiniapp>({
    slug: 'healthy-recipes',
    title: {
      en: 'Healthy Recipes',
      es: 'Recetas Saludables',
    },
    summary: {
      en: 'Practical, balanced recipes for everyday wellbeing.',
      es: 'Recetas prácticas y equilibradas para el bienestar diario.',
    },
    canonicalUrl: 'https://cabohealth.org/apps/healthy-recipes/',
    universalLink: 'https://cabohealth.org/apps/healthy-recipes/',
    allowedPathPrefix: '/apps/healthy-recipes/',
    destinationKind: 'cabohealth',
    access: 'public',
    contentDescriptors: ['health-and-wellness-information'],
    appStoreAgeRating: 9,
    dataUse: ['technical-request-logs'],
    permissions: [],
    hasUserGeneratedContent: false,
    hasPurchases: false,
    editorialSource: {
      en: 'CaboHealth editorial team',
      'es-MX': 'Equipo editorial de CaboHealth',
    },
    reviewedOn: '2026-08-24',
    contentVersion: '1.0.1',
    legalUrls: {
      privacy: 'https://cabohealth.org/app/privacy/',
      terms: 'https://cabohealth.org/app/terms/',
      support: 'https://cabohealth.org/app/support/',
      reportContent: 'https://cabohealth.org/app/report-content/',
    },
  }),
  Object.freeze<PublicMiniapp>({
    slug: 'clinic-guide',
    title: {
      en: 'CaboHealth Clinic Guide',
      es: 'Guía de Clínica CaboHealth',
    },
    summary: {
      en: 'Helpful information for planning a CaboHealth clinic visit.',
      es: 'Información útil para planear una visita a la clínica CaboHealth.',
    },
    canonicalUrl: 'https://cabohealth.org/apps/clinic-guide/',
    universalLink: 'https://cabohealth.org/apps/clinic-guide/',
    allowedPathPrefix: '/apps/clinic-guide/',
    destinationKind: 'cabohealth',
    access: 'public',
    contentDescriptors: ['health-and-wellness-information'],
    appStoreAgeRating: 9,
    dataUse: ['technical-request-logs'],
    permissions: [],
    hasUserGeneratedContent: false,
    hasPurchases: false,
    editorialSource: {
      en: 'CaboHealth editorial team',
      'es-MX': 'Equipo editorial de CaboHealth',
    },
    reviewedOn: '2026-08-24',
    contentVersion: '1.0.1',
    legalUrls: {
      privacy: 'https://cabohealth.org/app/privacy/',
      terms: 'https://cabohealth.org/app/terms/',
      support: 'https://cabohealth.org/app/support/',
      reportContent: 'https://cabohealth.org/app/report-content/',
    },
  }),
]);

export function getPublicMiniapp(slug: string): Readonly<PublicMiniapp> | undefined {
  return PUBLIC_MINIAPPS.find((miniapp) => miniapp.slug === slug);
}

export interface EditorialMetadata {
  readonly access: 'public';
  readonly appStoreAgeRating?: number;
  readonly contentDescriptor: CatalogPublicMiniapp['contentDescriptors'][number];
  readonly dataUse: CatalogPublicMiniapp['dataUse'][number];
  readonly permissions: readonly [];
  readonly reviewedOn: string;
  readonly source: Readonly<{ en: string; 'es-MX': string }>;
}

export function getEditorialMetadata(
  miniapp: Readonly<CatalogPublicMiniapp>,
): EditorialMetadata {
  return {
    access: miniapp.access,
    contentDescriptor: miniapp.contentDescriptors[0],
    dataUse: miniapp.dataUse[0],
    permissions: [],
    source: miniapp.editorialSource,
    reviewedOn: miniapp.reviewedOn,
    ...(miniapp.appStoreAgeRating === null
      ? {}
      : { appStoreAgeRating: miniapp.appStoreAgeRating }),
  };
}
