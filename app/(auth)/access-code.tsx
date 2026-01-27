// app/(auth)/access-code.tsx
// Access Code Screen - Enter activation code to access the app

import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { validateAccessCode, formatAccessCode, parseAccessCodeInput, isAdminCode } from '../../services/accessCode';
import { colors, layout } from '../../constants';

type ValidationState = 'idle' | 'loading' | 'success' | 'error';

export default function AccessCodeScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Hidden admin access via Support button
  const supportTapCount = useRef(0);
  const lastSupportTap = useRef(0);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entry animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        damping: 15,
        stiffness: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleCodeChange = (text: string) => {
    const parsed = parseAccessCodeInput(text);
    // Limit to 12 characters (XXXX-XXXXXXXX)
    if (parsed.replace(/-/g, '').length <= 12) {
      setCode(formatAccessCode(parsed));
    }
    if (validationState === 'error') {
      setValidationState('idle');
      setErrorMessage(null);
    }
  };

  const handleSubmit = async () => {
    const codeWithoutDash = code.replace(/-/g, '').trim();

    if (codeWithoutDash.length < 8) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setValidationState('error');
      setErrorMessage('Code must be at least 8 characters');
      triggerShake();
      return;
    }

    Keyboard.dismiss();
    setValidationState('loading');
    setErrorMessage(null);

    // Pass code WITH dash - Firebase stores codes with format "CABO-XXXXXXXX"
    const result = await validateAccessCode(code.trim());

    if (result.isValid) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setValidationState('success');

      // Short delay to show success state before navigating
      setTimeout(() => {
        router.replace('/(main)');
      }, 500);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setValidationState('error');
      triggerShake();

      switch (result.error) {
        case 'invalid':
          setErrorMessage('Invalid code. Please check and try again.');
          break;
        case 'expired':
          setErrorMessage('This code has expired. Contact your provider.');
          break;
        case 'revoked':
          setErrorMessage('This code has been deactivated. Contact your provider.');
          break;
        case 'network_error':
          setErrorMessage('Connection error. Check your internet and try again.');
          break;
        default:
          setErrorMessage('Validation error. Please try again.');
      }
    }
  };

  const codeLength = code.replace(/-/g, '').length;
  const isButtonDisabled = codeLength < 8 || validationState === 'loading';

  // Hidden admin access - 5 rapid taps on Support button
  const handleSupportTap = () => {
    const now = Date.now();
    if (now - lastSupportTap.current < 500) {
      supportTapCount.current += 1;
      if (supportTapCount.current >= 5) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        supportTapCount.current = 0;
        promptAdminPin();
      }
    } else {
      supportTapCount.current = 1;
    }
    lastSupportTap.current = now;
  };

  // Long press on Support also opens admin (with PIN)
  const handleSupportLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    promptAdminPin();
  };

  // Prompt for admin PIN before accessing admin panel
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header Gradient */}
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientMiddle, colors.gradientEnd]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.logoWrapper}>
          <Text style={styles.logoText}>CABO</Text>
          <Text style={styles.logoTextHealth}>HEALTH</Text>
        </View>
        <Text style={styles.tagline}>Longevity Science Lab</Text>
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
        <View style={styles.iconContainer}>
          <Ionicons
            name={validationState === 'success' ? 'checkmark-circle' : 'key'}
            size={60}
            color={validationState === 'success' ? colors.success : colors.primary}
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>Access Code</Text>
        <Text style={styles.description}>
          Enter the code provided by your CaboHealth service provider
        </Text>

        {/* Input */}
        <Animated.View
          style={[
            styles.inputWrapper,
            validationState === 'error' ? styles.inputError : null,
            validationState === 'success' ? styles.inputSuccess : null,
            { transform: [{ translateX: shakeAnim }] },
          ]}
        >
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={code}
            onChangeText={handleCodeChange}
            placeholder="CABO-XXXXXXXX"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={13} // XXXX-XXXXXXXX
            keyboardType="default"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            editable={validationState !== 'loading' && validationState !== 'success'}
          />
        </Animated.View>

        {/* Error Message */}
        {errorMessage && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.button,
            isButtonDisabled ? styles.buttonDisabled : null,
            validationState === 'success' ? styles.buttonSuccess : null,
          ]}
          onPress={handleSubmit}
          disabled={isButtonDisabled}
          activeOpacity={0.8}
        >
          {validationState === 'loading' ? (
            <ActivityIndicator color={colors.white} />
          ) : validationState === 'success' ? (
            <>
              <Ionicons name="checkmark" size={24} color={colors.white} />
              <Text style={styles.buttonText}>Access Granted</Text>
            </>
          ) : (
            <>
              <Ionicons name="log-in" size={24} color={colors.white} />
              <Text style={styles.buttonText}>Activate</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Help Text */}
        <Text style={styles.helpText}>
          Don't have a code? Contact your CaboHealth service provider
        </Text>
      </Animated.View>

      {/* Footer - Support button has hidden admin access */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.supportButton}
          onPress={handleSupportTap}
          onLongPress={handleSupportLongPress}
          delayLongPress={1000}
        >
          <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.supportText}>Support</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
    marginBottom: 8,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 2,
  },
  logoTextHealth: {
    fontSize: 32,
    fontWeight: '300',
    color: colors.white,
    letterSpacing: 2,
  },
  tagline: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1.5,
    fontWeight: '500',
  },
  content: {
    flex: 1,
    paddingHorizontal: layout.spacing.xl,
    paddingTop: layout.spacing.xxl,
    alignItems: 'center',
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.cardBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: layout.spacing.lg,
    ...layout.shadow.md,
  },
  title: {
    fontSize: layout.fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: layout.spacing.sm,
  },
  description: {
    fontSize: layout.fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: layout.spacing.xl,
    lineHeight: 22,
    paddingHorizontal: layout.spacing.md,
  },
  inputWrapper: {
    width: '100%',
    backgroundColor: colors.cardBackground,
    borderRadius: layout.borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: layout.spacing.md,
    ...layout.shadow.sm,
  },
  inputError: {
    borderColor: colors.error,
  },
  inputSuccess: {
    borderColor: colors.success,
  },
  input: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    paddingVertical: layout.spacing.lg,
    paddingHorizontal: layout.spacing.md,
    letterSpacing: 2,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error + '15',
    paddingHorizontal: layout.spacing.md,
    paddingVertical: layout.spacing.sm,
    borderRadius: layout.borderRadius.md,
    marginBottom: layout.spacing.lg,
    gap: 8,
  },
  errorText: {
    fontSize: layout.fontSize.sm,
    color: colors.error,
    flex: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: layout.spacing.xxl,
    paddingVertical: layout.spacing.md,
    borderRadius: layout.borderRadius.lg,
    marginBottom: layout.spacing.lg,
    width: '100%',
    gap: 10,
    ...layout.shadow.md,
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  buttonSuccess: {
    backgroundColor: colors.success,
  },
  buttonText: {
    fontSize: layout.fontSize.lg,
    fontWeight: '600',
    color: colors.white,
  },
  helpText: {
    fontSize: layout.fontSize.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    paddingVertical: layout.spacing.lg,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: layout.spacing.sm,
    paddingHorizontal: layout.spacing.md,
  },
  supportText: {
    fontSize: layout.fontSize.sm,
    color: colors.textSecondary,
  },
});
