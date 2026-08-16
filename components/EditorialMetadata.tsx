import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getEditorialMetadata,
  type PublicMiniapp,
} from '../constants/publicMiniapps';
import { useTheme, useTranslations } from '../hooks';

export function EditorialMetadata({ miniapp }: { miniapp: Readonly<PublicMiniapp> }) {
  const { colors } = useTheme();
  const { t } = useTranslations();
  const metadata = getEditorialMetadata(miniapp);

  return (
    <View style={styles.container} accessibilityLabel={`${t('catalog.source')}: ${metadata.source}. ${t('catalog.reviewed')}: ${metadata.reviewedOn}. ${t('catalog.content')}. ${t('catalog.logs')}. ${t('catalog.permissions')}.`}>
      <View style={styles.row}>
        <Ionicons name="document-text-outline" size={12} color={colors.textSecondary} />
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          {metadata.source} · {metadata.reviewedOn}
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
