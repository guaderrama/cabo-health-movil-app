import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { useEditorialTileMotion, useTheme } from '../hooks';
import {
  CaboHealthMiniappIcon,
  type CaboHealthMiniappIconName,
} from './icons/CaboHealthMiniappIcon';

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
  icon: CaboHealthMiniappIconName;
  accessibilityLabel: string;
  accessibilityHint: string;
  index?: number;
  favorite?: FavoriteAction;
  onPress: () => void;
}) {
  const { colors } = useTheme();
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
          <EditorialCoverArt tone={tone} />
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
            <CaboHealthMiniappIcon name={icon} size={31} />
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
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.openAction,
                {
                  backgroundColor: tone === 'test' ? colors.editorialIconSurface : colors.primary,
                  borderColor: tone === 'test' ? colors.editorialBorder : colors.primary,
                },
              ]}
            >
              <Ionicons
                name="arrow-forward"
                size={18}
                color={tone === 'test' ? colors.primary : colors.onPrimary}
              />
            </View>
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

function EditorialCoverArt({ tone }: { tone: EditorialMiniappTone }) {
  const { colors } = useTheme();
  return (
    <Svg
      accessible={false}
      width="100%"
      height="100%"
      viewBox="0 0 170 90"
      style={StyleSheet.absoluteFill}
    >
      {tone === 'clinic' && (
        <>
          <Circle cx="146" cy="12" r="43" fill={colors.primary} opacity={0.055} />
          <Circle cx="129" cy="51" r="19" fill={colors.primaryLight} opacity={0.09} />
          <Path
            d="M92 82 C112 64 138 52 177 46"
            fill="none"
            stroke={colors.primary}
            strokeWidth="1.5"
            opacity={0.18}
          />
          <Circle cx="126" cy="61" r="3.5" fill={colors.primary} opacity={0.24} />
          <Circle cx="154" cy="50" r="5.5" fill={colors.accent} opacity={0.36} />
        </>
      )}
      {tone === 'recipes' && (
        <>
          <Circle cx="145" cy="17" r="39" fill={colors.accent} opacity={0.075} />
          <Path
            d="M119 73 C104 50 118 27 151 18 C154 46 145 66 119 73 Z"
            fill={colors.accent}
            opacity={0.18}
          />
          <Path
            d="M122 70 C142 58 153 42 158 22"
            fill="none"
            stroke={colors.primary}
            strokeWidth="1.3"
            opacity={0.2}
          />
          <Circle cx="151" cy="26" r="4" fill={colors.primaryLight} opacity={0.2} />
        </>
      )}
      {tone === 'test' && (
        <>
          <Circle cx="143" cy="18" r="42" fill={colors.primary} opacity={0.045} />
          <Circle cx="143" cy="18" r="22" fill="none" stroke={colors.primary} strokeWidth="1" opacity={0.08} />
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 218,
    borderWidth: 1.25,
    borderRadius: 22,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.17,
    shadowRadius: 18,
    elevation: 7,
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
    minHeight: 38,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  footerRule: { width: 25, height: 1 },
  openAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
