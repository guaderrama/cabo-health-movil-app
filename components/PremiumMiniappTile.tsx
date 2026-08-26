import type { CatalogPublicMiniapp } from '../constants/publicMiniapps';
import {
  buildCatalogCardAccessibilityLabel,
  resolveCatalogMiniappIcon,
} from '../features/catalog/catalogPresentation';
import { useTranslations } from '../hooks';
import { EditorialMiniappCover } from './EditorialMiniappCover';

export function PremiumMiniappTile({
  miniapp,
  title,
  summary,
  favorite,
  index = 0,
  onPress,
  onToggleFavorite,
}: {
  miniapp: Readonly<CatalogPublicMiniapp>;
  title: string;
  summary: string;
  favorite: boolean;
  index?: number;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const { language, t } = useTranslations();
  const clinic = miniapp.slug === 'clinic-guide';

  return (
    <EditorialMiniappCover
      tone={clinic ? 'clinic' : 'recipes'}
      eyebrow={t('catalog.publicBadge')}
      title={title}
      summary={summary}
      actionLabel={t('catalog.openResource')}
      icon={resolveCatalogMiniappIcon(miniapp.iconKey, miniapp.slug)}
      folioIcon={miniapp.slug === 'clinic-guide'
        ? 'stethoscope'
        : miniapp.slug === 'healthy-recipes'
          ? 'bowl-mix-outline'
          : undefined}
      badgeIcon="globe-outline"
      accessibilityLabel={buildCatalogCardAccessibilityLabel(miniapp, language, t)}
      accessibilityHint={t('catalog.openResource')}
      index={index}
      favorite={{
        selected: favorite,
        label: favorite ? t('catalog.removeSaved') : t('catalog.save'),
        onPress: onToggleFavorite,
      }}
      onPress={onPress}
    />
  );
}

export default PremiumMiniappTile;
