import type { PublicMiniapp } from '../../constants/publicMiniapps';

export type PremiumHomeQuickAction = Readonly<{
  id: 'visit' | 'contact' | 'map';
  kind: 'route' | 'external';
  destination: string;
}>;

export type PremiumHomeModel = Readonly<{
  featured: Readonly<PublicMiniapp>;
  quickActions: readonly PremiumHomeQuickAction[];
  available: readonly Readonly<PublicMiniapp>[];
}>;

export function buildPremiumHomeModel(
  miniapps: readonly Readonly<PublicMiniapp>[],
  contactUrls: readonly string[],
): PremiumHomeModel {
  const slugs = miniapps.map((miniapp) => miniapp.slug);
  if (
    slugs.length !== 2
    || slugs[0] !== 'healthy-recipes'
    || slugs[1] !== 'clinic-guide'
  ) {
    throw new Error('Premium home requires exactly the two reviewed modules.');
  }

  const featured = miniapps.find((miniapp) => miniapp.slug === 'clinic-guide');
  if (!featured) throw new Error('The approved Clinic Guide is missing from the catalog.');

  const quickActions: PremiumHomeQuickAction[] = [
    { id: 'visit', kind: 'route', destination: '/(main)/visit-checklist' },
  ];
  const whatsApp = contactUrls.find((url) => url.startsWith('https://wa.me/'));
  if (whatsApp) quickActions.push({ id: 'contact', kind: 'external', destination: whatsApp });
  const appleMaps = contactUrls.find((url) => url.startsWith('https://maps.apple.com/'));
  if (appleMaps) quickActions.push({ id: 'map', kind: 'external', destination: appleMaps });

  return Object.freeze({
    featured,
    quickActions: Object.freeze(quickActions),
    available: Object.freeze(miniapps.filter((miniapp) => miniapp.slug !== featured.slug)),
  });
}
