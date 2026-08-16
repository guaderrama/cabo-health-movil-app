import { StyleSheet, Text, View } from 'react-native';
import { useTheme, useTranslations } from '../hooks';

export function WelcomeBanner() {
  const { colors } = useTheme();
  const { t } = useTranslations();
  return (
    <View
      accessibilityRole="summary"
      style={[styles.container, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>{t('home.offlineTools')}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {t('home.offlineToolsDescription')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 18, padding: 16 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '700', marginBottom: 4 },
  body: { fontSize: 13, lineHeight: 19 },
});
