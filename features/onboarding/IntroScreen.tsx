import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedMolecules } from '../../components';
import { introColors, layout } from '../../constants';
import { useReducedMotion, useTheme } from '../../hooks';
import {
  createIntroContinuation,
  type IntroContinuation,
} from './introTiming';

interface IntroScreenProps {
  onComplete: () => void | Promise<void>;
}

export function IntroScreen({ onComplete }: IntroScreenProps) {
  const { isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [isFocused, setIsFocused] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const continuationRef = useRef<IntroContinuation | null>(null);
  const completionRef = useRef<Promise<void> | null>(null);
  const logoProgress = useRef(new Animated.Value(1)).current;
  const logoEntranceStarted = useRef(false);
  const sceneActive = isFocused && appIsActive;

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  const completeOnce = useCallback(() => {
    if (!completionRef.current) {
      completionRef.current = Promise.resolve().then(onComplete);
    }
    return completionRef.current;
  }, [onComplete]);

  useEffect(() => {
    const continuation = createIntroContinuation({
      reduceMotion: reduceMotion === true,
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancel: (handle) => clearTimeout(handle),
      onComplete: completeOnce,
    });
    continuationRef.current = continuation;

    if (sceneActive && reduceMotion !== null) continuation.start();

    return () => {
      continuation.cancelPending();
      if (continuationRef.current === continuation) continuationRef.current = null;
    };
  }, [completeOnce, reduceMotion, sceneActive]);

  useEffect(() => {
    if (!sceneActive || reduceMotion !== false || logoEntranceStarted.current) {
      logoProgress.setValue(1);
      return;
    }

    logoEntranceStarted.current = true;
    logoProgress.setValue(0);
    const entrance = Animated.timing(logoProgress, {
      toValue: 1,
      duration: 650,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    });
    entrance.start();

    return () => {
      entrance.stop();
      logoProgress.setValue(1);
    };
  }, [logoProgress, reduceMotion, sceneActive]);

  const handleEnter = useCallback(() => {
    const continuation = continuationRef.current;
    void (continuation ? continuation.complete() : completeOnce());
  }, [completeOnce]);

  const logoWidth = Math.min(width * 0.58, layout.intro.logoMaxWidth);
  const ctaBottom = layout.intro.ctaBottom + insets.bottom;

  return (
    <LinearGradient
      colors={[
        introColors.gradientTop,
        introColors.gradientMiddle,
        introColors.gradientBottom,
      ]}
      locations={[0, 0.38, 0.87]}
      style={styles.container}
    >
      <AnimatedMolecules
        active={sceneActive}
        isDark={isDark}
        reduceMotion={reduceMotion !== false}
      />

      <Animated.Image
        source={require('../../assets/logo.png')}
        accessibilityLabel="CaboHealth"
        resizeMode="contain"
        style={[
          styles.logo,
          {
            top: height * layout.intro.logoTopRatio - logoWidth / 2,
            width: logoWidth,
            height: logoWidth,
            opacity: logoProgress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
            transform: [
              {
                translateY: logoProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          },
        ]}
      />

      <View style={[styles.identity, { top: height * layout.intro.identityTopRatio }]}>
        <LinearGradient
          colors={['transparent', introColors.bronze, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.rule}
        />
        <Text style={styles.tagline}>PRECISION LONGEVITY MEDICINE</Text>
      </View>

      <View
        style={[
          styles.messageContainer,
          { top: height * layout.intro.messageTopRatio },
        ]}
      >
        <Text style={styles.message}>One thoughtful place to explore CaboHealth.</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Enter CaboHealth"
        accessibilityHint="Opens the CaboHealth apps portal"
        onPress={handleEnter}
        style={({ pressed }) => [
          styles.ctaOuter,
          { bottom: ctaBottom },
          pressed && styles.ctaPressed,
        ]}
      >
        <LinearGradient
          colors={[introColors.ink, introColors.sea]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.ctaGradient}
        >
          <Text style={styles.ctaLabel}>ENTER CABOHEALTH</Text>
        </LinearGradient>
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  logo: {
    position: 'absolute',
    alignSelf: 'center',
    tintColor: introColors.ink,
  },
  identity: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    transform: [{ translateY: -14 }],
  },
  rule: {
    width: 52,
    height: 1,
    marginBottom: 12,
  },
  tagline: {
    color: introColors.soft,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2.4,
    textAlign: 'center',
  },
  messageContainer: {
    position: 'absolute',
    left: layout.intro.horizontalInset,
    right: layout.intro.horizontalInset,
    alignItems: 'center',
    transform: [{ translateY: -36 }],
  },
  message: {
    maxWidth: 320,
    color: introColors.soft,
    fontFamily: 'Georgia',
    fontSize: 31,
    fontWeight: '400',
    lineHeight: 35,
    textAlign: 'center',
  },
  ctaOuter: {
    position: 'absolute',
    left: layout.intro.horizontalInset,
    right: layout.intro.horizontalInset,
    minHeight: layout.intro.ctaMinHeight,
    borderRadius: 999,
    shadowColor: introColors.ink,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.23,
    shadowRadius: 18,
    elevation: 6,
  },
  ctaPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  ctaGradient: {
    minHeight: layout.intro.ctaMinHeight,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
});
