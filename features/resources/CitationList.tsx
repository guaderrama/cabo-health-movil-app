import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useTranslations } from '../../hooks';
import { isApprovedCitationUrl } from './publicContent';

interface CitationListProps {
  reviewedOn: string;
  sources: readonly { title: string; url: string }[];
}

export function CitationList({ reviewedOn, sources }: CitationListProps) {
  const { colors } = useTheme();
  const { t } = useTranslations();

  const openSource = async (url: string) => {
    if (!isApprovedCitationUrl(url)) {
      Alert.alert(t('common.error'), t('citations.openError'));
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('common.error'), t('citations.openError'));
    }
  };

  return (
    <View
      accessibilityLabel={`${t('citations.sources')}. ${t('citations.reviewedOn')} ${reviewedOn}`}
      style={[styles.container, { borderColor: colors.border }]}
    >
      <View style={styles.headingRow}>
        <Ionicons name="library-outline" size={20} color={colors.primary} />
        <View style={styles.headingText}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {t('citations.sources')}
          </Text>
          <Text style={[styles.reviewed, { color: colors.textSecondary }]}>
            {t('citations.reviewedOn')}: {reviewedOn}
          </Text>
        </View>
      </View>
      {sources.map((source) => (
        <Pressable
          key={source.url}
          accessibilityRole="link"
          accessibilityLabel={`${t('citations.openSource')}: ${source.title}`}
          onPress={() => { void openSource(source.url); }}
          style={({ pressed }) => [styles.source, pressed && styles.pressed]}
        >
          <Text style={[styles.sourceText, { color: colors.primary }]}>{source.title}</Text>
          <Ionicons name="open-outline" size={17} color={colors.primary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 22, paddingTop: 16 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 8 },
  headingText: { flex: 1 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  reviewed: { fontSize: 12, lineHeight: 18, marginTop: 1 },
  source: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  sourceText: { flex: 1, fontSize: 13, lineHeight: 19, textDecorationLine: 'underline' },
  pressed: { opacity: 0.68 },
});
