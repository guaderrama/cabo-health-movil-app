import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PublicMiniapp } from '../constants/publicMiniapps';
import { buildCatalogCardAccessibilityLabel } from '../features/catalog/catalogPresentation';
import { useTheme, useTranslations } from '../hooks';

export function PremiumResourceRow({
  miniapp,
  title,
  summary,
  favorite,
  first,
  onPress,
  onToggleFavorite,
}: {
  miniapp: Readonly<PublicMiniapp>;
  title: string;
  summary: string;
  favorite: boolean;
  first: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const icon = miniapp.slug === 'clinic-guide' ? 'sparkles-outline' : 'restaurant-outline';

  return (
    <View
      style={[
        styles.row,
        !first && {
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
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
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.icon,
            {
              backgroundColor: miniapp.slug === 'clinic-guide'
                ? colors.editorialCover
                : colors.editorialCoverWarm,
              borderColor: colors.editorialBorder,
            },
          ]}
        >
          <Ionicons name={icon} size={27} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.summary, { color: colors.textSecondary }]}>{summary}</Text>
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
      <Ionicons
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        name="chevron-forward"
        size={20}
        color={colors.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 13,
  },
  main: {
    flex: 1,
    minHeight: 91,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    paddingRight: 4,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  title: {
    fontFamily: 'Georgia',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    marginBottom: 3,
  },
  summary: { fontSize: 12, lineHeight: 17 },
  favorite: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});

export default PremiumResourceRow;
