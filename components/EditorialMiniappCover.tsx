import type { ComponentProps } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line } from 'react-native-svg';
import { useEditorialTileMotion, useTheme } from '../hooks';

export type EditorialMiniappTone = 'clinic' | 'recipes' | 'test';

interface FavoriteAction {
  selected: boolean;
  label: string;
  onPress: () => void;
}

export function EditorialMiniappCover({
  tone,
  eyebrow,
  title,
  summary,
  icon,
  accessibilityLabel,
  accessibilityHint,
  index = 0,
  favorite,
  onPress,
}: {
  tone: EditorialMiniappTone;
  eyebrow: string;
  title: string;
  summary: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  accessibilityHint: string;
  index?: number;
  favorite?: FavoriteAction;
  onPress: () => void;
}) {
  const { colors, isDark } = useTheme();
  const motion = useEditorialTileMotion(index);
  const coverColor = tone === 'clinic'
    ? colors.editorialCover
    : tone === 'recipes'
      ? colors.editorialCoverWarm
      : colors.editorialCoverMuted;
  const cardColor = tone === 'test' ? colors.editorialSurfaceMuted : colors.editorialSurface;

  const handleFavorite = () => {
    motion.animateFavorite();
    favorite?.onPress();
  };

  return (
    <Animated.View
      style={[
        styles.card,
        tone === 'test' && styles.testCard,
        {
          backgroundColor: cardColor,
          borderColor: colors.editorialBorder,
          shadowColor: colors.text,
        },
        motion.cardStyle,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        onPressIn={motion.onPressIn}
        onPressOut={motion.onPressOut}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <LinearGradient
          colors={[coverColor, colors.editorialSurface]}
          locations={[0, 1]}
          style={styles.cover}
        >
          <EditorialNetwork tone={tone} />
          <Text style={[styles.eyebrow, { color: colors.primary }]} numberOfLines={1}>
            {eyebrow.toUpperCase()}
          </Text>
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.icon,
              {
                backgroundColor: colors.editorialIconSurface,
                borderColor: colors.editorialBorder,
              },
            ]}
          >
            <Ionicons name={icon} size={30} color={colors.primary} />
          </View>
          <View style={[styles.bronzeRule, { backgroundColor: colors.accent }]} />
        </LinearGradient>

        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>
            {summary}
          </Text>
          <View style={styles.footer}>
            <View style={[styles.footerRule, { backgroundColor: colors.accent }]} />
            <Ionicons
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              name="arrow-forward"
              size={18}
              color={isDark ? colors.accentLight : colors.accentDark}
            />
          </View>
        </View>
      </Pressable>

      {favorite && (
        <Animated.View style={[styles.favoriteWrap, motion.favoriteStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favorite.label}
            accessibilityState={{ selected: favorite.selected }}
            onPress={handleFavorite}
            style={({ pressed }) => [
              styles.favorite,
              {
                backgroundColor: colors.editorialIconSurface,
                borderColor: colors.editorialBorder,
              },
              pressed && styles.favoritePressed,
            ]}
          >
            <Ionicons
              name={favorite.selected ? 'star' : 'star-outline'}
              size={22}
              color={favorite.selected ? colors.favorite : colors.primary}
            />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function EditorialNetwork({ tone }: { tone: EditorialMiniappTone }) {
  const { colors } = useTheme();
  const warm = tone === 'recipes';
  const muted = tone === 'test';
  return (
    <Svg
      accessible={false}
      width="100%"
      height="100%"
      viewBox="0 0 170 90"
      style={StyleSheet.absoluteFill}
    >
      <Line x1="-6" y1="69" x2="51" y2="20" stroke={colors.primary} strokeWidth="0.8" opacity={muted ? 0.12 : 0.2} />
      <Line x1="51" y1="20" x2="108" y2="58" stroke={colors.primary} strokeWidth="0.8" opacity={muted ? 0.1 : 0.18} />
      <Line x1="108" y1="58" x2="177" y2="22" stroke={colors.primary} strokeWidth="0.8" opacity={muted ? 0.1 : 0.2} />
      <Line x1="27" y1="86" x2="108" y2="58" stroke={colors.primary} strokeWidth="0.8" opacity={muted ? 0.08 : 0.15} />
      <Circle cx="51" cy="20" r="4" fill={colors.primaryLight} opacity={muted ? 0.22 : 0.42} />
      <Circle cx="108" cy="58" r="5" fill={warm ? colors.accent : colors.primary} opacity={muted ? 0.18 : 0.38} />
      <Circle cx="150" cy="36" r="2.4" fill={colors.accent} opacity={muted ? 0.2 : 0.72} />
      <Circle cx="27" cy="86" r="2.5" fill={colors.primaryLight} opacity={0.32} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 218,
    borderWidth: 1,
    borderRadius: 22,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.13,
    shadowRadius: 22,
    elevation: 5,
  },
  testCard: {
    borderStyle: 'dashed',
    shadowOpacity: 0.06,
    elevation: 2,
  },
  main: { flex: 1, minHeight: 218 },
  pressed: { opacity: 0.9 },
  cover: {
    minHeight: 88,
    paddingHorizontal: 13,
    paddingTop: 12,
    overflow: 'hidden',
  },
  eyebrow: {
    maxWidth: 82,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1.25,
  },
  icon: {
    position: 'absolute',
    left: 13,
    bottom: 8,
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bronzeRule: {
    position: 'absolute',
    right: 13,
    bottom: 17,
    width: 36,
    height: 1,
  },
  copy: { flex: 1, paddingHorizontal: 13, paddingTop: 13, paddingBottom: 11 },
  title: {
    minHeight: 41,
    paddingRight: 2,
    fontFamily: 'Georgia',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  summary: { flexGrow: 1, marginTop: 4, fontSize: 12, lineHeight: 16 },
  footer: {
    minHeight: 24,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  footerRule: { width: 21, height: 1 },
  favoriteWrap: { position: 'absolute', top: 8, right: 8, zIndex: 2 },
  favorite: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoritePressed: { opacity: 0.72 },
});

export default EditorialMiniappCover;
