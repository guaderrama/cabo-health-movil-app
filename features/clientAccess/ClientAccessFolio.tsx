import { EditorialMiniappCover } from '../../components/EditorialMiniappCover';
import { useClientAccess } from '../../context/ClientAccessContext';
import { useTranslations } from '../../hooks';

export function ClientAccessFolio({ index = 0, onPress }: { index?: number; onPress: () => void }) {
  const { status } = useClientAccess();
  const { t } = useTranslations();
  const unlocked = status === 'unlocked';
  const checking = status === 'checking' || status === 'redeeming';
  const summary = unlocked
    ? t('clientAccess.activeSummary')
    : checking
      ? t('clientAccess.checkingSummary')
      : t('clientAccess.lockedSummary');
  const actionLabel = unlocked
    ? t('clientAccess.manageAccess')
    : t('clientAccess.enterCode');

  return (
    <EditorialMiniappCover
      tone="client"
      eyebrow={t('clientAccess.clients')}
      title={t('clientAccess.folioTitle')}
      summary={summary}
      actionLabel={actionLabel}
      icon="heart-outline"
      badgeIcon="lock-closed-outline"
      accessibilityLabel={`${t('clientAccess.folioTitle')}. ${summary}`}
      accessibilityHint={actionLabel}
      index={index}
      onPress={onPress}
    />
  );
}
