import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedMolecules } from '../../components';
import { introColors, layout } from '../../constants';
import { useReducedMotion, useTheme } from '../../hooks';
import { calculateIntroLayout } from './introLayout';
import { createIntroContinuation, type IntroContinuation } from './introTiming';

interface IntroScreenProps {
  onComplete: () => void | Promise<void>;
}

export function IntroScreen({ onComplete }: IntroScreenProps) {
  const { isDark } = useTheme();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const isFocused = useIsFocused();
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const onCompleteRef = useRef(onComplete);
  const continuationRef = useRef<IntroContinuation | null>(null);
  const logoProgress = useRef(new Animated.Value(1)).current;
  const logoEntranceStarted = useRef(false);
  onCompleteRef.current = onComplete;
  if (!continuationRef.current) {
    continuationRef.current = createIntroContinuation({
      onComplete: () => onCompleteRef.current(),
    });
  }
  const sceneActive = isFocused && appIsActive;
  const introLayout = useMemo(
    () => calculateIntroLayout({ width, height, fontScale, insets }),
    [fontScale, height, insets, width],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

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
    void continuationRef.current?.complete();
  }, []);

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
        reduceMotion={reduceMotion}
      />

      <ScrollView
        alwaysBounceVertical={false}
        bounces={introLayout.requiresScrolling}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: introLayout.safeTop,
            paddingBottom: introLayout.safeBottom,
          },
        ]}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View
          style={[
            styles.flow,
            {
              minHeight: introLayout.contentMinHeight,
              paddingLeft: introLayout.horizontalPaddingLeft,
              paddingRight: introLayout.horizontalPaddingRight,
            },
          ]}
        >
          <View style={{ height: introLayout.topSpacer }} />

          <Animated.Image
            source={require('../../assets/logo.png')}
            accessibilityLabel="CaboHealth"
            resizeMode="contain"
            tintColor={introColors.ink}
            style={[
              {
                width: introLayout.logoSize,
                height: introLayout.logoSize,
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

          <View style={{ height: introLayout.identityGap }} />
          <View style={styles.identity}>
            <LinearGradient
              colors={['transparent', introColors.bronze, 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.rule}
            />
            <Text style={styles.tagline}>LONGEVITY, GROUNDED IN SCIENCE.</Text>
          </View>

          <View style={{ height: introLayout.messageGap }} />
          <View style={styles.messageContainer}>
            <Text style={styles.message}>One thoughtful place to explore CaboHealth.</Text>
          </View>

          <View style={[styles.flexSpacer, { minHeight: introLayout.messageCtaGap }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enter CaboHealth"
            accessibilityHint="Opens the CaboHealth apps portal"
            onPress={handleEnter}
            style={({ pressed }) => [styles.ctaOuter, pressed && styles.ctaPressed]}
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
          <View style={{ height: introLayout.bottomPadding }} />
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  flow: {
    alignItems: 'center',
  },
  identity: {
    width: '100%',
    alignItems: 'center',
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
    width: '100%',
    alignItems: 'center',
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
    width: '100%',
    maxWidth: 520,
    minHeight: layout.intro.ctaMinHeight,
    borderRadius: 999,
    shadowColor: introColors.ink,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.23,
    shadowRadius: 18,
    elevation: 6,
  },
  flexSpacer: {
    flexGrow: 1,
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
