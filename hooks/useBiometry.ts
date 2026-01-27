// hooks/useBiometry.ts
// Hook for biometric authentication (Face ID / Touch ID)

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
  resetAuthentication: () => void;
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
      setError('Could not enable biometry');
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
      setError('Could not disable biometry');
    }
  }, []);

  // Autenticar con biometría
  const authenticate = useCallback(async (): Promise<boolean> => {
    setError(null);

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify your identity',
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use passcode',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setIsAuthenticated(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return true;
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        if (result.error === 'user_cancel') {
          setError('Authentication cancelled');
        } else if (result.error === 'user_fallback') {
          setError('Using alternative method');
        } else if (result.error === 'lockout') {
          setError('Too many attempts. Try again later.');
        } else {
          setError('Authentication failed');
        }
        return false;
      }
    } catch (err) {
      console.error('Error during authentication:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Authentication error');
      return false;
    }
  }, []);

  // Reset authentication state (call when app goes to background or on logout)
  const resetAuthentication = useCallback(() => {
    setIsAuthenticated(false);
    setError(null);
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
    resetAuthentication,
  };
}

// Helper to get biometry type name
export function getBiometryTypeName(type: BiometryType): string {
  switch (type) {
    case 'facial':
      return 'Face ID';
    case 'fingerprint':
      return 'Touch ID';
    case 'iris':
      return 'Iris';
    default:
      return 'Biometry';
  }
}

// Helper to get biometry type icon
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
