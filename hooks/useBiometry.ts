// hooks/useBiometry.ts
// Hook para manejar autenticación biométrica (Face ID / Touch ID)

import { useState, useEffect, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { config } from '../constants';

export type BiometryType = 'fingerprint' | 'facial' | 'iris' | null;

interface UseBiometryResult {
  isAvailable: boolean;
  biometryType: BiometryType;
  isEnabled: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  authenticate: () => Promise<boolean>;
  enableBiometry: () => Promise<void>;
  disableBiometry: () => Promise<void>;
  checkIfEnabled: () => Promise<boolean>;
}

export function useBiometry(): UseBiometryResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<BiometryType>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Verificar disponibilidad de biometría
  const checkBiometryAvailability = useCallback(async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      setIsAvailable(compatible && enrolled);

      if (compatible && enrolled) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometryType('facial');
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometryType('fingerprint');
        } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
          setBiometryType('iris');
        }
      }
    } catch (err) {
      console.error('Error checking biometry availability:', err);
      setIsAvailable(false);
    }
  }, []);

  // Verificar si biometría está habilitada en la app
  const checkIfEnabled = useCallback(async (): Promise<boolean> => {
    try {
      const stored = await AsyncStorage.getItem(config.storageKeys.biometryEnabled);
      const enabled = stored === 'true';
      setIsEnabled(enabled);
      return enabled;
    } catch (err) {
      console.error('Error checking biometry enabled status:', err);
      return false;
    }
  }, []);

  // Habilitar biometría
  const enableBiometry = useCallback(async () => {
    try {
      await AsyncStorage.setItem(config.storageKeys.biometryEnabled, 'true');
      setIsEnabled(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('Error enabling biometry:', err);
      setError('No se pudo habilitar la biometría');
    }
  }, []);

  // Deshabilitar biometría
  const disableBiometry = useCallback(async () => {
    try {
      await AsyncStorage.setItem(config.storageKeys.biometryEnabled, 'false');
      setIsEnabled(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.error('Error disabling biometry:', err);
      setError('No se pudo deshabilitar la biometría');
    }
  }, []);

  // Autenticar con biometría
  const authenticate = useCallback(async (): Promise<boolean> => {
    setError(null);

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verificar identidad',
        cancelLabel: 'Cancelar',
        fallbackLabel: 'Usar código',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setIsAuthenticated(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return true;
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        if (result.error === 'user_cancel') {
          setError('Autenticación cancelada');
        } else if (result.error === 'user_fallback') {
          setError('Usando método alternativo');
        } else if (result.error === 'lockout') {
          setError('Demasiados intentos. Intenta más tarde.');
        } else {
          setError('Autenticación fallida');
        }
        return false;
      }
    } catch (err) {
      console.error('Error during authentication:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Error de autenticación');
      return false;
    }
  }, []);

  // Inicialización
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await checkBiometryAvailability();
      await checkIfEnabled();
      setIsLoading(false);
    };

    init();
  }, [checkBiometryAvailability, checkIfEnabled]);

  return {
    isAvailable,
    biometryType,
    isEnabled,
    isAuthenticated,
    isLoading,
    error,
    authenticate,
    enableBiometry,
    disableBiometry,
    checkIfEnabled,
  };
}

// Helper para obtener el nombre del tipo de biometría
export function getBiometryTypeName(type: BiometryType): string {
  switch (type) {
    case 'facial':
      return 'Face ID';
    case 'fingerprint':
      return 'Touch ID';
    case 'iris':
      return 'Iris';
    default:
      return 'Biometría';
  }
}

// Helper para obtener el icono del tipo de biometría
export function getBiometryIcon(type: BiometryType): string {
  switch (type) {
    case 'facial':
      return 'scan-outline';
    case 'fingerprint':
      return 'finger-print';
    case 'iris':
      return 'eye-outline';
    default:
      return 'lock-closed-outline';
  }
}
