import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import {
  EDITORIAL_TILE_MOTION,
  resolveEditorialTileEntrance,
} from '../features/motion/editorialTileMotion';
import { useReducedMotion } from './useReducedMotion';

export function useEditorialTileMotion(index: number) {
  const reduceMotion = useReducedMotion();
  const entrancePolicy = useMemo(
    () => resolveEditorialTileEntrance({ index, reduceMotion }),
    [index, reduceMotion],
  );
  const entrance = useRef(new Animated.Value(entrancePolicy.animate ? 0 : 1)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const favoriteScale = useRef(new Animated.Value(1)).current;
  const pressAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const favoriteAnimation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!entrancePolicy.animate) {
      entrance.stopAnimation();
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: EDITORIAL_TILE_MOTION.entranceDurationMs,
      delay: entrancePolicy.delayMs,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance, entrancePolicy]);

  const animatePress = useCallback((pressed: boolean) => {
    pressAnimation.current?.stop();
    if (reduceMotion) {
      pressScale.setValue(1);
      return;
    }
    pressAnimation.current = Animated.timing(pressScale, {
      toValue: pressed ? EDITORIAL_TILE_MOTION.pressedScale : 1,
      duration: pressed
        ? EDITORIAL_TILE_MOTION.pressInDurationMs
        : EDITORIAL_TILE_MOTION.pressOutDurationMs,
      easing: pressed
        ? Easing.out(Easing.cubic)
        : Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    pressAnimation.current.start();
  }, [pressScale, reduceMotion]);

  const animateFavorite = useCallback(() => {
    favoriteAnimation.current?.stop();
    if (reduceMotion) {
      favoriteScale.setValue(1);
      return;
    }
    const half = Math.floor(EDITORIAL_TILE_MOTION.favoriteDurationMs / 2);
    favoriteAnimation.current = Animated.sequence([
      Animated.timing(favoriteScale, {
        toValue: EDITORIAL_TILE_MOTION.favoriteScale,
        duration: half,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(favoriteScale, {
        toValue: 1,
        duration: EDITORIAL_TILE_MOTION.favoriteDurationMs - half,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: true,
      }),
    ]);
    favoriteAnimation.current.start();
  }, [favoriteScale, reduceMotion]);

  useEffect(() => () => {
    pressAnimation.current?.stop();
    favoriteAnimation.current?.stop();
  }, []);

  return {
    cardStyle: {
      opacity: entrance.interpolate({
        inputRange: [0, 1],
        outputRange: [entrancePolicy.opacity, 1],
      }),
      transform: [
        {
          translateY: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [entrancePolicy.translateY, 0],
          }),
        },
        { scale: pressScale },
      ],
    },
    favoriteStyle: { transform: [{ scale: favoriteScale }] },
    onPressIn: () => animatePress(true),
    onPressOut: () => animatePress(false),
    animateFavorite,
  };
}
