import { EditorialMiniappCover } from '../../components/EditorialMiniappCover';
import { useTranslations } from '../../hooks';
import type { DevMiniapp } from './devMiniappCatalog';
import {
  translateDevMiniappMessage,
  type DevMiniappMessageKey,
} from './devMiniappMessages';

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
  const { language, t } = useTranslations();
  const devT = (key: DevMiniappMessageKey) => translateDevMiniappMessage(language, key);
  const access = miniapp.access === 'client' ? devT('devPanel.clients') : devT('devPanel.public');
  const label = `${title}. ${summary}. ${devT('devPanel.testOnly')}. ${access}.`;

  return (
    <EditorialMiniappCover
      tone={miniapp.access === 'client' ? 'client' : 'test'}
      eyebrow={access}
      title={title}
      summary={summary}
      actionLabel={t('catalog.openResource')}
      icon={miniapp.icon}
      badgeIcon={miniapp.access === 'client' ? 'lock-closed-outline' : 'globe-outline'}
      accessibilityLabel={label}
      accessibilityHint={t('catalog.openResource')}
      index={index}
      onPress={onPress}
    />
  );
}
