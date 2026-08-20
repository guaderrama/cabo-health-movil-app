import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAIN_NAV_ITEMS, resolveMainNavigationSelection } from '../i18n/messages';
import { useTheme, useTranslations } from '../hooks';

export function BottomNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslations();
  const selected = resolveMainNavigationSelection(pathname);

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: `${colors.cardBackground}F2`,
          borderColor: colors.border,
          marginBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {MAIN_NAV_ITEMS.map((item) => {
        const active = item.id === selected;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={t(item.labelKey)}
            accessibilityState={{ selected: active }}
            onPress={() => router.replace(item.route)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <Ionicons
              name={item.icon as keyof typeof Ionicons.glyphMap}
              size={22}
              color={active ? colors.primary : colors.textSecondary}
            />
            <Text style={[styles.label, { color: active ? colors.primary : colors.textSecondary }]}>
              {t(item.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 7,
    paddingVertical: 5,
    shadowColor: '#082A3C',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.13,
    shadowRadius: 18,
    elevation: 6,
  },
  item: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 13 },
  label: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
