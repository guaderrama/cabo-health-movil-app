import { EditorialMiniappCover } from '../../components/EditorialMiniappCover';
import { useTranslations } from '../../hooks';
import type { DevMiniapp } from './devMiniappCatalog';

export function DevMiniappTile({
  miniapp,
  title,
  summary,
  index = 0,
  onPress,
}: {
  miniapp: Readonly<DevMiniapp>;
  title: string;
  summary: string;
  index?: number;
  onPress: () => void;
}) {
  const { t } = useTranslations();
  const access = miniapp.access === 'client' ? t('devPanel.clients') : t('devPanel.public');
  const label = `${title}. ${summary}. ${t('devPanel.testOnly')}. ${access}.`;

  return (
    <EditorialMiniappCover
      tone="test"
      eyebrow={access}
      title={title}
      summary={summary}
      icon={miniapp.icon}
      accessibilityLabel={label}
      accessibilityHint={t('catalog.open')}
      index={index}
      onPress={onPress}
    />
  );
}
