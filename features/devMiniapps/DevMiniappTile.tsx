import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useTranslations } from '../../hooks';
import type { DevMiniapp } from './devMiniappCatalog';

export function DevMiniappTile({
  miniapp,
  title,
  summary,
  onPress,
}: {
  miniapp: Readonly<DevMiniapp>;
  title: string;
  summary: string;
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
        styles.card,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.glassBorder,
          shadowColor: colors.text,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.disabledBackground }]}>
        <Ionicons name="flask-outline" size={25} color={colors.primary} />
      </View>
      <View style={[styles.testBadge, { backgroundColor: colors.disabledBackground }]}>
        <Text style={[styles.testBadgeText, { color: colors.primary }]}>
          {t('devPanel.testOnly')}
        </Text>
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>
        {summary}
      </Text>
      <View style={styles.footer}>
        <Text style={[styles.access, { color: colors.primary }]}>{access}</Text>
        <Ionicons name="chevron-forward" size={19} color={colors.accentDark} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 188,
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
    paddingTop: 14,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.11,
    shadowRadius: 18,
    elevation: 4,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBadge: {
    position: 'absolute',
    top: 14,
    right: 11,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  testBadgeText: { fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 0.8 },
  title: { marginTop: 11, fontSize: 15, lineHeight: 19, fontWeight: '800' },
  summary: { flexGrow: 1, marginTop: 4, fontSize: 12, lineHeight: 16 },
  footer: {
    minHeight: 26,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  access: { fontSize: 10, lineHeight: 14, fontWeight: '800' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
});
