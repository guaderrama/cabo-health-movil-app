import type { ComponentProps } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEditorialTileMotion, useTheme } from '../hooks';
import {
  CaboHealthMiniappIcon,
  type CaboHealthMiniappIconName,
} from './icons/CaboHealthMiniappIcon';

export type EditorialMiniappTone = 'clinic' | 'recipes' | 'test' | 'client';

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
  badgeIcon,
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
  badgeIcon?: ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  accessibilityHint: string;
  index?: number;
  favorite?: FavoriteAction;
  onPress: () => void;
}) {
  const { colors, isDark } = useTheme();
  const motion = useEditorialTileMotion(index);
  const headerColor = tone === 'clinic'
    ? colors.miniappCardHeader
    : tone === 'recipes'
      ? colors.miniappCardHeaderWarm
      : tone === 'client'
        ? colors.miniappCardHeaderClient
        : colors.miniappCardHeaderTest;
  const cardColor = tone === 'client'
    ? colors.miniappCardSurfaceClient
    : colors.miniappCardSurface;
  const borderColor = tone === 'client'
    ? colors.miniappCardBorderClient
    : colors.miniappCardBorder;
  const shellShadow = Platform.OS === 'web'
    ? {
        boxShadow: isDark
          ? '0 14px 30px rgba(0, 0, 0, 0.38)'
          : '0 12px 28px rgba(8, 42, 60, 0.22)',
      }
    : {
        shadowColor: isDark ? '#000000' : colors.text,
        shadowOpacity: isDark ? 0.36 : 0.22,
      };

  const handleFavorite = () => {
    motion.animateFavorite();
    favorite?.onPress();
  };

  return (
    <Animated.View
      style={[
        styles.shell,
        shellShadow,
        motion.cardStyle,
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardColor,
            borderColor,
          },
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
          <View style={[styles.cover, { backgroundColor: headerColor }]}>
            <View style={styles.eyebrowRow}>
              {badgeIcon && (
                <Ionicons name={badgeIcon} size={12} color={colors.miniappCardHeaderText} />
              )}
              <Text style={[styles.eyebrow, { color: colors.miniappCardHeaderText }]} numberOfLines={1}>
                {eyebrow.toUpperCase()}
              </Text>
            </View>
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.icon,
                {
                  backgroundColor: colors.miniappCardIconSurface,
                  borderColor: colors.miniappCardIconBorder,
                },
              ]}
            >
              <CaboHealthMiniappIcon name={icon} size={31} />
            </View>
            <View style={[styles.bronzeRule, { backgroundColor: colors.accentLight }]} />
          </View>

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
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color={colors.onPrimary}
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
                  backgroundColor: colors.miniappCardIconSurface,
                  borderColor: colors.miniappCardIconBorder,
                },
                pressed && styles.favoritePressed,
              ]}
            >
              <Ionicons
                name={favorite.selected ? 'star' : 'star-outline'}
                size={22}
                color={favorite.selected
                  ? (isDark ? colors.favorite : colors.accentDark)
                  : colors.primary}
              />
            </Pressable>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 218,
    borderRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 18,
    elevation: 9,
  },
  card: {
    flex: 1,
    minHeight: 218,
    borderWidth: 1.5,
    borderRadius: 22,
    overflow: 'hidden',
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
  eyebrowRow: {
    minHeight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
