// components/SkeletonCard.tsx
// Skeleton loading card with shimmer effect

import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../hooks';
import { layout } from '../constants';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - layout.spacing.lg * 2 - layout.card.gap) / 2;

export function SkeletonCard() {
  const { colors, isDark } = useTheme();
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1500, // Slower, more premium feel
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    shimmer.start();
    return () => shimmer.stop();
  }, [shimmerAnim]);

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-CARD_WIDTH, CARD_WIDTH],
  });

  // More subtle colors for premium feel
  const baseColor = isDark ? '#1E293B' : '#F1F5F9';
  const highlightColor = isDark ? '#2D3A4F' : '#E8EDF3';

  return (
    <View style={[styles.card, { backgroundColor: baseColor }]}>
      {/* Icon placeholder */}
      <View style={[styles.iconPlaceholder, { backgroundColor: highlightColor }]} />

      {/* Title placeholder */}
      <View style={[styles.titlePlaceholder, { backgroundColor: highlightColor }]} />

      {/* Description placeholder */}
      <View style={[styles.descPlaceholder, { backgroundColor: highlightColor }]} />

      {/* Shimmer overlay */}
      <Animated.View
        style={[
          styles.shimmerOverlay,
          { transform: [{ translateX }] },
        ]}
      >
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.15)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.shimmerGradient}
        />
      </Animated.View>
    </View>
  );
}

// Grid of skeleton cards
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.cardContainer}>
          <SkeletonCard />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20, // Matches AppCard
    padding: layout.card.padding,
    height: 140,
    overflow: 'hidden',
  },
  iconPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 14, // Softer corners
    marginBottom: 12,
  },
  titlePlaceholder: {
    width: '70%',
    height: 16,
    borderRadius: 8, // Softer corners
    marginBottom: 8,
  },
  descPlaceholder: {
    width: '50%',
    height: 12,
    borderRadius: 6, // Softer corners
  },
  shimmerOverlay: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  shimmerGradient: {
    flex: 1,
    width: CARD_WIDTH,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: layout.spacing.lg - layout.card.gap / 2,
    paddingTop: layout.spacing.lg,
  },
  cardContainer: {
    width: '50%',
    padding: layout.card.gap / 2,
  },
});

export default SkeletonCard;
