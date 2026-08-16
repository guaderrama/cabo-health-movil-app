import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getEditorialMetadata,
  type PublicMiniapp,
} from '../constants/publicMiniapps';
import { formatEditorialDate } from '../features/catalog/catalogPresentation';
import { useTheme, useTranslations } from '../hooks';

export function EditorialMetadata({ miniapp }: { miniapp: Readonly<PublicMiniapp> }) {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const metadata = getEditorialMetadata(miniapp);
  const source = metadata.source[language];
  const reviewedOn = formatEditorialDate(metadata.reviewedOn, language);

  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={`${t('catalog.source')}: ${source}. ${t('catalog.reviewed')}: ${reviewedOn}. ${t('catalog.content')}. ${t('catalog.logs')}. ${t('catalog.permissions')}.`}
    >
      <View style={styles.row}>
        <Ionicons name="document-text-outline" size={12} color={colors.textSecondary} />
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          {t('catalog.source')}: {source} · {t('catalog.reviewed')}: {reviewedOn}
        </Text>
      </View>
      <View style={styles.row}>
        <Ionicons name="shield-checkmark-outline" size={12} color={colors.textSecondary} />
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          {t('catalog.content')} · {t('catalog.permissions')}
        </Text>
      </View>
      <View style={styles.row}>
        <Ionicons name="server-outline" size={12} color={colors.textSecondary} />
        <Text style={[styles.text, { color: colors.textSecondary }]}>{t('catalog.logs')}</Text>
      </View>
      {metadata.appStoreAgeRating !== undefined && (
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          {t('catalog.age')}: {metadata.appStoreAgeRating}+
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 3, marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  text: { flexShrink: 1, fontSize: 10, lineHeight: 14 },
});
