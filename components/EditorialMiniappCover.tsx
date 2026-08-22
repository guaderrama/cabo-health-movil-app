import type { ComponentProps } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
  actionLabel,
  icon,
  folioIcon,
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
  actionLabel: string;
  icon: CaboHealthMiniappIconName;
  folioIcon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  badgeIcon?: ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  accessibilityHint: string;
  index?: number;
  favorite?: FavoriteAction;
  onPress: () => void;
}) {
  const { colors, isDark } = useTheme();
  const motion = useEditorialTileMotion(index);
  const isClient = tone === 'client';
  const isCompact = tone === 'client' || tone === 'test';
  const cardColor = isClient ? colors.miniappCardSurfaceClient : colors.miniappCardSurface;
  const borderColor = isClient ? colors.miniappCardBorderClient : colors.miniappCardBorder;
  const tabColor = isClient ? colors.miniappFolioTabClient : colors.miniappFolioTabPublic;
  const layerNear = isClient
    ? colors.miniappFolioLayerNearClient
    : colors.miniappFolioLayerNear;
  const layerFar = isClient
    ? colors.miniappFolioLayerFarClient
    : colors.miniappFolioLayerFar;
  const actionColor = isClient
    ? (isDark ? colors.accentLight : colors.accentDark)
    : colors.primary;
  const clientIconColor = isDark ? colors.accentLight : colors.accentDark;
  const shellShadow = Platform.OS === 'web'
    ? {
        boxShadow: isDark
          ? '0 12px 24px rgba(0, 0, 0, 0.34)'
          : '0 7px 16px rgba(8, 42, 60, 0.13)',
      }
    : {
        shadowColor: isDark ? '#000000' : colors.text,
        shadowOpacity: isDark ? 0.32 : 0.15,
      };
  const medallionShadow = Platform.OS === 'web'
    ? {
        boxShadow: isDark
          ? '0 5px 12px rgba(0, 0, 0, 0.28)'
          : '0 5px 12px rgba(8, 42, 60, 0.14)',
      }
    : {
        shadowColor: isDark ? '#000000' : colors.text,
        shadowOpacity: isDark ? 0.25 : 0.14,
      };

  const handleFavorite = () => {
    motion.animateFavorite();
    favorite?.onPress();
  };

  return (
    <Animated.View
      style={[
        styles.shell,
        isCompact && styles.shellCompact,
        shellShadow,
        motion.cardStyle,
      ]}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.backLayerFar,
          isCompact && styles.backLayerCompact,
          { backgroundColor: layerFar, borderColor },
        ]}
      />
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.backLayerMid,
          isCompact && styles.backLayerCompact,
          { backgroundColor: layerFar, borderColor },
        ]}
      />
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.backLayerNear,
          isCompact && styles.backLayerCompact,
          { backgroundColor: layerNear, borderColor },
        ]}
      />
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.accessTab,
        ]}
      >
        <View
          style={[
            styles.accessTabShape,
            { backgroundColor: tabColor, borderColor },
          ]}
        />
        <View style={styles.accessTabContent}>
          {badgeIcon && (
            <Ionicons name={badgeIcon} size={13} color={colors.miniappFolioTabText} />
          )}
          <Text
            style={[styles.eyebrow, { color: colors.miniappFolioTabText }]}
            numberOfLines={1}
          >
            {eyebrow.toUpperCase()}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.card,
          isCompact && styles.cardCompact,
          { backgroundColor: cardColor, borderColor },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          onPress={onPress}
          onPressIn={motion.onPressIn}
          onPressOut={motion.onPressOut}
          style={({ pressed }) => [
            styles.main,
            isCompact && styles.mainCompact,
            pressed && styles.pressed,
          ]}
        >
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={[
              styles.iconMedallion,
              isCompact && styles.iconMedallionCompact,
              medallionShadow,
              {
                backgroundColor: colors.miniappCardIconSurface,
                borderColor: colors.miniappCardIconBorder,
              },
            ]}
          >
            {folioIcon ? (
              <MaterialCommunityIcons name={folioIcon} size={35} color={colors.primary} />
            ) : (
              <CaboHealthMiniappIcon
                name={icon}
                size={34}
                primaryColor={isClient ? clientIconColor : undefined}
                secondaryColor={isClient ? colors.accent : undefined}
                accentColor={isClient ? clientIconColor : undefined}
              />
            )}
          </View>

          <View style={[styles.copy, isCompact && styles.copyCompact]}>
            <Text
              style={[styles.title, isCompact && styles.titleCompact, { color: colors.text }]}
              numberOfLines={2}
            >
              {title}
            </Text>
            <View
              style={[
                styles.titleRule,
                isCompact && styles.titleRuleCompact,
                { backgroundColor: colors.accent },
              ]}
            />
            <Text
              style={[
                styles.summary,
                isCompact && styles.summaryCompact,
                { color: colors.textSecondary },
              ]}
              numberOfLines={3}
            >
              {summary}
            </Text>
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[styles.footer, isCompact && styles.footerCompact]}
            >
              <Text style={[styles.actionLabel, { color: actionColor }]} numberOfLines={1}>
                {actionLabel}
              </Text>
              <Ionicons name="arrow-forward" size={18} color={actionColor} />
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
                pressed && styles.favoritePressed,
              ]}
            >
              <Ionicons
                name={favorite.selected ? 'star' : 'star-outline'}
                size={27}
                color={favorite.selected
                  ? (isDark ? colors.favorite : colors.accentDark)
                  : colors.miniappFolioFavorite}
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
    minHeight: 283,
    paddingTop: 23,
    borderRadius: 22,
    shadowOffset: { width: 0, height: 7 },
    shadowRadius: 12,
    elevation: 4,
  },
  shellCompact: { minHeight: 244 },
  backLayerFar: {
    position: 'absolute',
    top: 7,
    right: -18,
    bottom: -9,
    left: 18,
    borderWidth: 1,
    borderRadius: 12,
    transform: [{ rotate: '0.55deg' }],
  },
  backLayerMid: {
    position: 'absolute',
    top: 11,
    right: -12,
    bottom: -7,
    left: 12,
    borderWidth: 1,
    borderRadius: 12,
    opacity: 0.82,
    transform: [{ rotate: '0.15deg' }],
  },
  backLayerNear: {
    position: 'absolute',
    top: 17,
    right: -6,
    bottom: -5,
    left: 6,
    borderWidth: 1,
    borderRadius: 12,
    transform: [{ rotate: '-0.3deg' }],
  },
  backLayerCompact: { bottom: -6 },
  accessTab: {
    position: 'absolute',
    top: 0,
    left: 14,
    zIndex: 1,
    minWidth: 81,
    height: 40,
  },
  accessTabShape: {
    position: 'absolute',
    top: 0,
    right: 4,
    bottom: 0,
    left: 4,
    borderWidth: 1,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 7,
    transform: [{ skewX: '9deg' }],
  },
  accessTabContent: {
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
  },
  eyebrow: {
    maxWidth: 68,
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.35,
  },
  card: {
    zIndex: 2,
    flex: 1,
    minHeight: 260,
    borderWidth: 1,
    borderRadius: 11,
    overflow: 'hidden',
  },
  cardCompact: { minHeight: 221 },
  main: { flex: 1, minHeight: 260 },
  mainCompact: { minHeight: 221 },
  pressed: { opacity: 0.88 },
  iconMedallion: {
    position: 'absolute',
    top: 16,
    left: 15,
    zIndex: 1,
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 8,
    elevation: 4,
  },
  iconMedallionCompact: {
    top: 13,
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  copy: {
    flex: 1,
    paddingTop: 99,
    paddingHorizontal: 16,
    paddingBottom: 15,
  },
  copyCompact: { paddingTop: 82, paddingBottom: 11 },
  title: {
    minHeight: 46,
    paddingRight: 2,
    fontFamily: 'Georgia',
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
  },
  titleCompact: { minHeight: 44, lineHeight: 22 },
  titleRule: { width: 56, height: 1, marginTop: 7, marginBottom: 11 },
  titleRuleCompact: { width: 46, marginTop: 4, marginBottom: 7 },
  summary: { flexGrow: 1, fontSize: 12.5, lineHeight: 17 },
  summaryCompact: { lineHeight: 16 },
  footer: {
    minHeight: 24,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  footerCompact: { minHeight: 18, marginTop: 4 },
  actionLabel: {
    flexShrink: 1,
    fontFamily: 'Georgia',
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'right',
  },
  favoriteWrap: { position: 'absolute', top: 8, right: 6, zIndex: 3 },
  favorite: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoritePressed: { opacity: 0.62 },
});

export default EditorialMiniappCover;
