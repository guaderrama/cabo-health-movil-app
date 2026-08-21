import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useTranslations } from '../../hooks';
import type { DevMiniapp } from './devMiniappCatalog';

export function DevMiniappRow({
  miniapp,
  title,
  summary,
  first,
  onPress,
}: {
  miniapp: Readonly<DevMiniapp>;
  title: string;
  summary: string;
  first: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslations();
  const access = miniapp.access === 'client' ? t('devPanel.clients') : t('devPanel.public');
  const label = `${title}. ${summary}. ${t('devPanel.testOnly')}. ${access}.`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('catalog.open')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.disabledBackground }]}>
        <Ionicons name="flask-outline" size={23} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleLine}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>
          <View style={[styles.badge, { backgroundColor: colors.disabledBackground }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>{t('devPanel.testOnly')}</Text>
          </View>
        </View>
        <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>{summary}</Text>
        <Text style={[styles.access, { color: colors.primary }]}>{access}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 },
  icon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flexShrink: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  badge: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 0.9 },
  summary: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  access: { marginTop: 4, fontSize: 10, lineHeight: 14, fontWeight: '800' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});
