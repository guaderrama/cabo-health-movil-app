import type { PublicMiniapp } from '../../constants/publicMiniapps';

export type PremiumHomeTool = Readonly<{
  id: 'visit-checklist';
  kind: 'route';
  destination: string;
}>;

export type PremiumHomeModel = Readonly<{
  resources: readonly Readonly<PublicMiniapp>[];
  tools: readonly PremiumHomeTool[];
}>;

export function buildPremiumHomeModel(
  miniapps: readonly Readonly<PublicMiniapp>[],
): PremiumHomeModel {
  const slugs = miniapps.map((miniapp) => miniapp.slug);
  if (
    slugs.length !== 2
    || slugs[0] !== 'healthy-recipes'
    || slugs[1] !== 'clinic-guide'
  ) {
    throw new Error('Premium home requires exactly the two reviewed modules.');
  }

  const resources = ['clinic-guide', 'healthy-recipes'].map((slug) => {
    const miniapp = miniapps.find((candidate) => candidate.slug === slug);
    if (!miniapp) throw new Error(`The approved ${slug} resource is missing from the catalog.`);
    return miniapp;
  });
  const tools: readonly PremiumHomeTool[] = [
    { id: 'visit-checklist', kind: 'route', destination: '/(main)/visit-checklist' },
  ];

  return Object.freeze({
    resources: Object.freeze(resources),
    tools: Object.freeze(tools),
  });
}
