// app/(auth)/biometry.tsx
// Biometry Screen - Autenticación con Face ID / Touch ID

import { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBiometry, getBiometryTypeName, getBiometryIcon } from '../../hooks';
import { colors, layout, config } from '../../constants';

export default function BiometryScreen() {
  const router = useRouter();
  const {
    isAvailable,
    biometryType,
    isAuthenticated,
    isLoading,
    error,
    authenticate,
  } = useBiometry();

  // Auto-autenticar cuando la pantalla carga
  useEffect(() => {
    if (!isLoading && isAvailable) {
      authenticate();
    }
  }, [isLoading, isAvailable, authenticate]);

  // Redirigir cuando está autenticado
  useEffect(() => {
    const saveAuthAndRedirect = async () => {
      if (isAuthenticated) {
        // Guardar timestamp de autenticación
        await AsyncStorage.setItem(config.storageKeys.lastSync, Date.now().toString());
        router.replace('/(main)');
      }
    };
    saveAuthAndRedirect();
  }, [isAuthenticated, router]);

  const handleAuthenticate = useCallback(async () => {
    const success = await authenticate();
    if (success) {
      // Guardar timestamp de autenticación
      await AsyncStorage.setItem(config.storageKeys.lastSync, Date.now().toString());
      router.replace('/(main)');
    }
  }, [authenticate, router]);

  const handleSkip = useCallback(() => {
    // Permitir saltar si no hay biometría disponible
    router.replace('/(main)');
  }, [router]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Verificando seguridad...</Text>
        </View>
      </View>
    );
  }

  const biometryName = getBiometryTypeName(biometryType);
  const biometryIcon = getBiometryIcon(biometryType) as keyof typeof Ionicons.glyphMap;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Logo / Icono */}
        <View style={styles.iconContainer}>
          <Ionicons name={biometryIcon} size={80} color={colors.primary} />
        </View>

        {/* Título */}
        <Text style={styles.title}>CaboHealth</Text>

        {/* Mensaje */}
        <Text style={styles.description}>
          {isAvailable
            ? `Usa ${biometryName} para acceder a tus apps de salud`
            : 'La autenticación biométrica no está disponible en este dispositivo'}
        </Text>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Botón principal */}
        {isAvailable && (
          <TouchableOpacity style={styles.button} onPress={handleAuthenticate}>
            <Ionicons name={biometryIcon} size={24} color={colors.white} />
            <Text style={styles.buttonText}>Verificar con {biometryName}</Text>
          </TouchableOpacity>
        )}

        {/* Botón secundario si no hay biometría */}
        {!isAvailable && (
          <TouchableOpacity style={styles.button} onPress={handleSkip}>
            <Text style={styles.buttonText}>Continuar</Text>
          </TouchableOpacity>
        )}

        {/* Hint */}
        <Text style={styles.hint}>
          Tus datos están protegidos
        </Text>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Powered by CaboHealth
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: layout.spacing.xl,
  },
  iconContainer: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.cardBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: layout.spacing.xl,
    ...layout.shadow.lg,
  },
  title: {
    fontSize: layout.fontSize.title,
    fontWeight: layout.fontWeight.bold,
    color: colors.text,
    marginBottom: layout.spacing.md,
    textAlign: 'center',
  },
  description: {
    fontSize: layout.fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: layout.spacing.xl,
    paddingHorizontal: layout.spacing.xl,
    lineHeight: 24,
  },
  loadingText: {
    marginTop: layout.spacing.lg,
    fontSize: layout.fontSize.md,
    color: colors.textSecondary,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error + '15',
    paddingHorizontal: layout.spacing.md,
    paddingVertical: layout.spacing.sm,
    borderRadius: layout.borderRadius.md,
    marginBottom: layout.spacing.lg,
  },
  errorText: {
    fontSize: layout.fontSize.sm,
    color: colors.error,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: layout.spacing.xxl,
    paddingVertical: layout.spacing.md,
    borderRadius: layout.borderRadius.md,
    marginBottom: layout.spacing.xl,
    minWidth: 250,
  },
  buttonText: {
    fontSize: layout.fontSize.lg,
    fontWeight: layout.fontWeight.semibold,
    color: colors.white,
  },
  hint: {
    fontSize: layout.fontSize.sm,
    color: colors.textTertiary,
  },
  footer: {
    paddingVertical: layout.spacing.lg,
    alignItems: 'center',
  },
  footerText: {
    fontSize: layout.fontSize.xs,
    color: colors.textTertiary,
  },
});
