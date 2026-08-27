import { EditorialMiniappCover } from '../../components/EditorialMiniappCover';
import { useTranslations } from '../../hooks';
import type { ClientHomeCard } from './clientHomePresentation';

export function ClientMiniappTile({
  card,
  index = 0,
  onPress,
}: {
  card: Readonly<ClientHomeCard>;
  index?: number;
  onPress: () => void;
}) {
  const { language, t } = useTranslations();
  const localizedKey = language === 'es-MX' ? 'es' : 'en';
  const title = card.title[localizedKey];
  const summary = card.summary[localizedKey];
  const actionLabel = card.locked
    ? t('clientAccess.enterCode')
    : t('clientAccess.openResource');
  const accessibilityLabel = card.locked
    ? `${title}. ${summary}. ${t('clientAccess.requiresAccess')}.`
    : `${title}. ${summary}.`;

  return (
    <EditorialMiniappCover
      tone="client"
      eyebrow={t('clientAccess.clients')}
      title={title}
      summary={summary}
      actionLabel={actionLabel}
      icon={card.iconKey}
      badgeIcon={card.locked ? 'lock-closed-outline' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={actionLabel}
      index={index}
      onPress={onPress}
    />
  );
}

export default ClientMiniappTile;
