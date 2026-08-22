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
          backgroundColor: colors.editorialSurface,
          borderColor: colors.editorialBorder,
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
            {active && (
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={[styles.activeMarker, { backgroundColor: colors.accent }]}
              />
            )}
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
    width: '94%',
    maxWidth: 620,
    alignSelf: 'center',
    flexDirection: 'row',
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
  item: { position: 'relative', flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 13 },
  activeMarker: { position: 'absolute', top: 1, width: 22, height: 2, borderRadius: 2 },
  label: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
