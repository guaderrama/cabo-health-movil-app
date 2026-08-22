import type { PublicMiniapp } from '../constants/publicMiniapps';
import { buildCatalogCardAccessibilityLabel } from '../features/catalog/catalogPresentation';
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
  miniapp: Readonly<PublicMiniapp>;
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
      icon={clinic ? 'sparkles-outline' : 'restaurant-outline'}
      badgeIcon="globe-outline"
      accessibilityLabel={buildCatalogCardAccessibilityLabel(miniapp, language, t)}
      accessibilityHint={t('catalog.open')}
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
