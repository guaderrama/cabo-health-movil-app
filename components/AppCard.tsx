// components/AppCard.tsx
// Premium visual card for each web app - CaboHealth Brand
// With glassmorphism effect, animations and automatic category icons

import { useRef, useEffect } from 'react';
import { TouchableOpacity, View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { WebApp } from '../types';
import { useTheme } from '../hooks';
import { layout, getCategoryConfig } from '../constants';
import { PremiumIcon } from './icons/PremiumIcon';
import type { PremiumIconName } from './icons/PremiumIcon';

interface AppCardProps {
  app: WebApp;
  onPress: (app: WebApp) => void;
  onLongPress?: (app: WebApp) => void;
  index?: number; // For staggered entry animation
}

export function AppCard({ app, onPress, onLongPress, index = 0 }: AppCardProps) {
  const { colors, isDark } = useTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Staggered entry animation
  const enterAnim = useRef(new Animated.Value(0)).current;
  const translateY = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });
  const entryScale = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 400,
      delay: index * 50, // 50ms stagger between cards
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,  // Más sutil y profesional
      useNativeDriver: true,
      damping: 15,
      stiffness: 150,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      damping: 15,
      stiffness: 150,
    }).start();
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(app);
  };

  const handleLongPress = () => {
    if (onLongPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onLongPress(app);
    }
  };

  // Get category config (automatic icon and color)
  const categoryConfig = getCategoryConfig(app.category);

  // In dark mode, always use glassmorphism (ignore category colors for elegance)
  // In light mode, use category colors
  const effectiveColor = isDark ? undefined : (app.color || categoryConfig.color);
  const hasCustomColor = !isDark && effectiveColor && effectiveColor !== '#FFFFFF' && effectiveColor !== colors.cardBackground;
  const cardBgColor = hasCustomColor ? effectiveColor : undefined;

  // Determine if background is light to choose correct text color
  // In dark mode, background is always dark
  const isLightBg = isDark ? false : (hasCustomColor ? isLightColor(effectiveColor) : true);

  return (
    <Animated.View style={[
      styles.cardWrapper,
      {
        opacity: enterAnim,
        transform: [
          { translateY },
          { scale: Animated.multiply(scaleAnim, entryScale) },
        ],
      },
    ]}>
      <TouchableOpacity
        onPress={handlePress}
        onLongPress={handleLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={styles.touchable}
      >
        {/* Glassmorphism container */}
        {!hasCustomColor ? (
          <BlurView
            intensity={isDark ? 25 : 40}
            tint={isDark ? 'dark' : 'light'}
            style={[styles.blurContainer, styles.cardShadow]}
          >
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.glass,
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <CardContent
                app={app}
                colors={colors}
                isLightBg={isLightBg}
                isDark={isDark}
                categoryIcon={categoryConfig.icon}
                premiumIcon={categoryConfig.premiumIcon}
              />
            </View>
          </BlurView>
        ) : (
          <View
            style={[
              styles.card,
              styles.blurContainer,
              styles.cardShadow,
              {
                backgroundColor: cardBgColor,
                borderColor: isLightBg ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)',
              },
            ]}
          >
            <CardContent
              app={app}
              colors={colors}
              isLightBg={isLightBg}
              isDark={isDark}
              categoryIcon={categoryConfig.icon}
              premiumIcon={categoryConfig.premiumIcon}
            />
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// Helper: detect if string is emoji
const isEmoji = (str?: string): boolean => {
  if (!str) return false;
  // Detect Unicode emojis
  return /\p{Emoji}/u.test(str) && str.length <= 4;
};

// Helper: detect if color is light (to choose dark or white text)
const isLightColor = (hexColor?: string): boolean => {
  if (!hexColor) return true;
  // Remove # if exists
  const hex = hexColor.replace('#', '');
  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Calculate luminance (standard formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // If luminance > 0.6, it's a light color
  return luminance > 0.6;
};

// Card inner content
function CardContent({
  app,
  colors,
  isLightBg,
  isDark,
  categoryIcon,
  premiumIcon,
}: {
  app: WebApp;
  colors: any;
  isLightBg: boolean;
  isDark: boolean;
  categoryIcon: keyof typeof Ionicons.glyphMap;
  premiumIcon?: PremiumIconName;
}) {
  // Determine which icon to show: manual emoji > premium SVG > category Ionicon
  const showEmoji = app.icon && isEmoji(app.icon);
  const iconColor = isLightBg ? colors.primary : colors.white;

  return (
    <>
      {/* Badge New */}
      {app.isNew && (
        <View style={[styles.badgeNew, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeNewText}>New</Text>
        </View>
      )}

      {/* Favorite */}
      {app.isFavorite && (
        <View style={[styles.favoriteIcon, { backgroundColor: `${colors.favorite}20` }]}>
          <Ionicons name="star" size={14} color={colors.favorite} />
        </View>
      )}

      {/* Icon - Priority: Emoji > Premium SVG > Ionicon fallback */}
      {showEmoji ? (
        <Text style={styles.icon}>{app.icon}</Text>
      ) : premiumIcon ? (
        <View style={styles.iconContainer}>
          <PremiumIcon name={premiumIcon} size={48} isDark={isDark} />
        </View>
      ) : (
        <View style={styles.iconContainer}>
          <Ionicons name={categoryIcon} size={48} color={iconColor} />
        </View>
      )}

      {/* Name */}
      <Text
        style={[
          styles.name,
          { color: isLightBg ? colors.text : colors.white },
        ]}
        numberOfLines={1}
      >
        {app.name}
      </Text>

      {/* Description */}
      <Text
        style={[
          styles.description,
          {
            color: isLightBg
              ? colors.textSecondary
              : 'rgba(255,255,255,0.8)',
          },
        ]}
        numberOfLines={4}
      >
        {app.description}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    flex: 1,
    margin: 6,
  },
  touchable: {
    flex: 1,
  },
  blurContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    minHeight: 200,
  },
  // Premium shadow system
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  card: {
    flex: 1,
    minHeight: 200,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
  },
  badgeNew: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeNewText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  favoriteIcon: {
    position: 'absolute',
    top: 10,
    left: 10,
    padding: 4,
    borderRadius: 8,
  },
  icon: {
    fontSize: 48,
    marginBottom: 12,
  },
  iconContainer: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
});

export default AppCard;
