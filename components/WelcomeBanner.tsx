// components/WelcomeBanner.tsx
// Banner de bienvenida con efecto glassmorphism premium

import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../hooks';
import { layout } from '../constants';

interface WelcomeBannerProps {
  userName?: string;
}

const MESSAGES = [
  { icon: '🌟', text: 'Bienvenido a tu viaje de salud regenerativa' },
  { icon: '💪', text: 'Tu bienestar es nuestra prioridad' },
  { icon: '🧬', text: 'Medicina regenerativa a tu alcance' },
  { icon: '✨', text: 'Descubre el poder de la longevidad' },
  { icon: '🌿', text: 'Equilibrando tu salud naturalmente' },
];

export function WelcomeBanner({ userName }: WelcomeBannerProps) {
  const { colors, isDark } = useTheme();
  const [currentMessage, setCurrentMessage] = useState(0);
  const fadeAnim = useState(new Animated.Value(1))[0];

  // Rotar mensajes cada 5 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        // Cambiar mensaje
        setCurrentMessage((prev) => (prev + 1) % MESSAGES.length);
        // Fade in
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [fadeAnim]);

  const message = MESSAGES[currentMessage];
  const greeting = userName ? `Hola, ${userName}` : 'Bienvenido';
  const timeOfDay = getTimeOfDay();

  return (
    <View style={styles.container}>
      <BlurView
        intensity={isDark ? 40 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={styles.blurContainer}
      >
        <View
          style={[
            styles.content,
            {
              backgroundColor: colors.glass,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          {/* Saludo */}
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>
            {timeOfDay} {greeting}
          </Text>

          {/* Mensaje rotativo */}
          <Animated.View style={[styles.messageContainer, { opacity: fadeAnim }]}>
            <Text style={styles.icon}>{message.icon}</Text>
            <Text style={[styles.message, { color: colors.text }]}>
              {message.text}
            </Text>
          </Animated.View>

          {/* Indicadores */}
          <View style={styles.indicators}>
            {MESSAGES.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.indicator,
                  {
                    backgroundColor:
                      index === currentMessage ? colors.primary : colors.border,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </BlurView>
    </View>
  );
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos dias,';
  if (hour < 19) return 'Buenas tardes,';
  return 'Buenas noches,';
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: layout.spacing.lg,
    marginBottom: layout.spacing.lg,
    borderRadius: layout.borderRadius.xl,
    overflow: 'hidden',
  },
  blurContainer: {
    overflow: 'hidden',
    borderRadius: layout.borderRadius.xl,
  },
  content: {
    padding: layout.spacing.lg,
    borderWidth: 1,
    borderRadius: layout.borderRadius.xl,
  },
  greeting: {
    fontSize: layout.fontSize.sm,
    fontWeight: layout.fontWeight.medium,
    marginBottom: layout.spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: layout.spacing.md,
  },
  icon: {
    fontSize: 28,
    marginRight: layout.spacing.sm,
  },
  message: {
    fontSize: layout.fontSize.lg,
    fontWeight: layout.fontWeight.semibold,
    flex: 1,
    lineHeight: 24,
  },
  indicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  indicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

export default WelcomeBanner;
