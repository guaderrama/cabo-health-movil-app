import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import type { PublicMiniapp } from '../constants/publicMiniapps';
import { buildCatalogCardAccessibilityLabel } from '../features/catalog/catalogPresentation';
import { useReducedMotion, useTheme, useTranslations } from '../hooks';
import { EditorialMetadata } from './EditorialMetadata';

interface AppCardProps {
  miniapp: Readonly<PublicMiniapp>;
  favorite: boolean;
  onPress: (miniapp: Readonly<PublicMiniapp>) => void;
  onToggleFavorite: (slug: string) => void;
  index?: number;
}

export function AppCard({
  miniapp,
  favorite,
  onPress,
  onToggleFavorite,
  index = 0,
}: AppCardProps) {
  const { colors, isDark } = useTheme();
  const { language, t } = useTranslations();
  const reduceMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: 180,
      delay: index * 45,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance, index, reduceMotion]);

  const title = miniapp.title[language === 'es-MX' ? 'es' : 'en'];
  const summary = miniapp.summary[language === 'es-MX' ? 'es' : 'en'];

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: entrance,
        transform: [{
          translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
        }],
      }}
    >
      <BlurView
        intensity={isDark ? 28 : 42}
        tint={isDark ? 'dark' : 'light'}
        style={[styles.card, { borderColor: colors.glassBorder }]}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glass }]} />
        <View style={styles.topRow}>
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.moduleIcon, { backgroundColor: `${colors.primary}18` }]}
          >
            <Ionicons
              name={miniapp.slug === 'healthy-recipes' ? 'restaurant-outline' : 'calendar-outline'}
              size={23}
              color={colors.primary}
            />
          </View>
          <View style={[styles.badge, { backgroundColor: `${colors.primary}18` }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>{t('catalog.publicBadge')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favorite ? t('catalog.removeSaved') : t('catalog.save')}
            accessibilityState={{ selected: favorite }}
            hitSlop={6}
            onPress={() => onToggleFavorite(miniapp.slug)}
            style={({ pressed }) => [
              styles.favoriteButton,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={favorite ? 'star' : 'star-outline'}
              size={21}
              color={favorite ? colors.favorite : colors.primary}
            />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={buildCatalogCardAccessibilityLabel(miniapp, language, t)}
          accessibilityHint={t('catalog.open')}
          onPress={() => onPress(miniapp)}
          style={({ pressed }) => [styles.content, pressed && styles.pressed]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.summary, { color: colors.textSecondary }]}>{summary}</Text>
          <EditorialMetadata miniapp={miniapp} />
        </Pressable>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 244,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#082A3C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  content: { flex: 1, paddingHorizontal: 14, paddingBottom: 14 },
  pressed: { opacity: 0.82 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, paddingBottom: 10 },
  moduleIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badge: { flex: 1, minWidth: 0, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { flexShrink: 1, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '700', marginBottom: 5 },
  summary: { fontSize: 12, lineHeight: 17 },
  favoriteButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
