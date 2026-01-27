// app/(auth)/code-expired.tsx
// Screen shown when access code has been revoked or expired

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Linking,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { clearStoredCode } from '../../services/accessCode';
import { colors, layout, config } from '../../constants';

export default function CodeExpiredScreen() {
  const router = useRouter();

  // Hidden admin access state
  const [tapCount, setTapCount] = useState(0);
  const lastTapTimeRef = useRef(0);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entry animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        damping: 12,
        stiffness: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle pulse animation for icon
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const handleEnterNewCode = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Clear the old code before redirecting
    await clearStoredCode();
    router.replace('/(auth)/access-code');
  };

  const handleContactSupport = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Open support email or link
    Linking.openURL(`mailto:support@cabohealth.com?subject=Access%20Code%20Expired`);
  };

  // Hidden admin access - prompt for PIN
  const promptAdminPin = () => {
    Alert.prompt(
      'Admin Access',
      'Enter admin PIN:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enter',
          onPress: (pin?: string) => {
            if (pin === '1234') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.push('/(main)/admin');
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', 'Invalid PIN');
            }
          },
        },
      ],
      'secure-text'
    );
  };

  // Secret tap handler for admin access (5 rapid taps)
  const handleSecretTap = () => {
    const now = Date.now();
    if (now - lastTapTimeRef.current < 500) {
      const newCount = tapCount + 1;
      setTapCount(newCount);
      if (newCount >= 5) {
        setTapCount(0);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        promptAdminPin();
      }
    } else {
      setTapCount(1);
    }
    lastTapTimeRef.current = now;
  };

  return (
    <View style={styles.container}>
      {/* Header Gradient */}
      <LinearGradient
        colors={['#DC2626', '#B91C1C', '#991B1B']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.logoWrapper}>
          <Text style={styles.logoText}>CABO</Text>
          <Text style={styles.logoTextHealth}>HEALTH</Text>
        </View>
      </LinearGradient>

      {/* Content */}
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Icon */}
        <Animated.View
          style={[
            styles.iconContainer,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <Ionicons name="lock-closed" size={60} color={colors.error} />
        </Animated.View>

        {/* Title */}
        <Text style={styles.title}>Access Suspended</Text>

        {/* Description */}
        <Text style={styles.description}>
          Your access code has been deactivated or has expired.
          {'\n\n'}
          If you believe this is an error, contact your CaboHealth service provider to get a new code.
        </Text>

        {/* Primary Button */}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleEnterNewCode}
          activeOpacity={0.8}
        >
          <Ionicons name="key" size={22} color={colors.white} />
          <Text style={styles.primaryButtonText}>Enter New Code</Text>
        </TouchableOpacity>

        {/* Secondary Button */}
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleContactSupport}
          activeOpacity={0.7}
        >
          <Ionicons name="mail-outline" size={20} color={colors.primary} />
          <Text style={styles.secondaryButtonText}>Contact Support</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Footer - tap 5 times for hidden admin access */}
      <TouchableOpacity
        style={styles.footer}
        onPress={handleSecretTap}
        activeOpacity={1}
      >
        <Text style={styles.footerText}>
          If your subscription is active, request a new code from your provider
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerGradient: {
    paddingTop: 60,
    paddingBottom: 30,
    alignItems: 'center',
  },
  logoWrapper: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 2,
  },
  logoTextHealth: {
    fontSize: 28,
    fontWeight: '300',
    color: colors.white,
    letterSpacing: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: layout.spacing.xl,
    paddingTop: layout.spacing.xxl,
    alignItems: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.error + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: layout.spacing.xl,
    borderWidth: 2,
    borderColor: colors.error + '30',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    marginBottom: layout.spacing.md,
    textAlign: 'center',
  },
  description: {
    fontSize: layout.fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: layout.spacing.xxl,
    lineHeight: 24,
    paddingHorizontal: layout.spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: layout.spacing.xxl,
    paddingVertical: layout.spacing.md,
    borderRadius: layout.borderRadius.lg,
    marginBottom: layout.spacing.md,
    width: '100%',
    gap: 10,
    ...layout.shadow.md,
  },
  primaryButtonText: {
    fontSize: layout.fontSize.lg,
    fontWeight: '600',
    color: colors.white,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '10',
    paddingHorizontal: layout.spacing.xl,
    paddingVertical: layout.spacing.md,
    borderRadius: layout.borderRadius.lg,
    width: '100%',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  secondaryButtonText: {
    fontSize: layout.fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  footer: {
    paddingVertical: layout.spacing.lg,
    paddingHorizontal: layout.spacing.xl,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: {
    fontSize: layout.fontSize.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
