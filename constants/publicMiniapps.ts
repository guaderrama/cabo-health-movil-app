export type PublicMiniappSlug = 'healthy-recipes' | 'clinic-guide';

export interface PublicMiniappLegalUrls {
  privacy: 'https://cabohealth.org/app/privacy/';
  terms: 'https://cabohealth.org/app/terms/';
  support: 'https://cabohealth.org/app/support/';
  reportContent: 'https://cabohealth.org/app/report-content/';
}

export interface PublicMiniapp {
  slug: PublicMiniappSlug;
  title: { en: string; es: string };
  summary: { en: string; es: string };
  canonicalUrl: `https://cabohealth.org/apps/${PublicMiniappSlug}/`;
  universalLink: `https://cabohealth.org/apps/${PublicMiniappSlug}/`;
  allowedPathPrefix: `/apps/${PublicMiniappSlug}/`;
  access: 'public';
  contentDescriptors: ['health-and-wellness-information'];
  appStoreAgeRating: number | null;
  dataUse: ['technical-request-logs'];
  permissions: [];
  hasUserGeneratedContent: false;
  hasPurchases: false;
  editorialSource: string;
  reviewedOn: string;
  contentVersion: string;
  legalUrls: PublicMiniappLegalUrls;
}

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
    access: 'public',
    contentDescriptors: ['health-and-wellness-information'],
    appStoreAgeRating: null,
    dataUse: ['technical-request-logs'],
    permissions: [],
    hasUserGeneratedContent: false,
    hasPurchases: false,
    editorialSource: 'CaboHealth editorial team',
    reviewedOn: '2026-08-16',
    contentVersion: '1.0.0',
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
    access: 'public',
    contentDescriptors: ['health-and-wellness-information'],
    appStoreAgeRating: null,
    dataUse: ['technical-request-logs'],
    permissions: [],
    hasUserGeneratedContent: false,
    hasPurchases: false,
    editorialSource: 'CaboHealth editorial team',
    reviewedOn: '2026-08-16',
    contentVersion: '1.0.0',
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
  access: 'public';
  contentDescriptor: 'health-and-wellness-information';
  dataUse: 'technical-request-logs';
  permissions: [];
  source: string;
  reviewedOn: string;
  appStoreAgeRating?: number;
}

export function getEditorialMetadata(
  miniapp: Readonly<PublicMiniapp>,
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
