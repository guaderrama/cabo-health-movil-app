import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PublicMiniapp } from '../constants/publicMiniapps';
import { buildCatalogCardAccessibilityLabel } from '../features/catalog/catalogPresentation';
import { useTheme, useTranslations } from '../hooks';

export function PremiumMiniappTile({
  miniapp,
  title,
  summary,
  favorite,
  onPress,
  onToggleFavorite,
}: {
  miniapp: Readonly<PublicMiniapp>;
  title: string;
  summary: string;
  favorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const icon = miniapp.slug === 'clinic-guide' ? 'sparkles-outline' : 'restaurant-outline';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.glassBorder,
          shadowColor: colors.text,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={buildCatalogCardAccessibilityLabel(miniapp, language, t)}
        accessibilityHint={t('catalog.open')}
        onPress={onPress}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <View style={[styles.icon, { backgroundColor: colors.disabledBackground }]}>
          <Ionicons name={icon} size={27} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>
          {summary}
        </Text>
        <View style={styles.footer}>
          <View style={[styles.badge, { backgroundColor: colors.disabledBackground }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              {t('catalog.publicBadge')}
            </Text>
          </View>
          <Ionicons
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            name="chevron-forward"
            size={19}
            color={colors.accentDark}
          />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={favorite ? t('catalog.removeSaved') : t('catalog.save')}
        accessibilityState={{ selected: favorite }}
        onPress={onToggleFavorite}
        style={({ pressed }) => [styles.favorite, pressed && styles.pressed]}
      >
        <Ionicons
          name={favorite ? 'star' : 'star-outline'}
          size={23}
          color={favorite ? colors.favorite : colors.primary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 188,
    borderWidth: 1,
    borderRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.11,
    shadowRadius: 18,
    elevation: 4,
  },
  main: {
    flex: 1,
    minHeight: 188,
    padding: 13,
    paddingTop: 14,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 11,
    paddingRight: 2,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  summary: {
    flexGrow: 1,
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
  footer: {
    minHeight: 26,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 9, lineHeight: 11, fontWeight: '900', letterSpacing: 1 },
  favorite: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
});

export default PremiumMiniappTile;
