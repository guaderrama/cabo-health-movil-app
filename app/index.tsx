// app/index.tsx
// Entry Point - Access Code + Biometry Auth Gate

import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../constants';
import { checkStoredCode, getStoredCode } from '../services/accessCode';

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type AuthState = 'checking' | 'need_code' | 'code_expired' | 'need_biometry' | 'authenticated';

export default function Index() {
  const [authState, setAuthState] = useState<AuthState>('checking');

  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        // Step 1: Check if there's an access code stored
        const storedCode = await getStoredCode();

        if (!storedCode) {
          // No code stored - need to enter code
          setAuthState('need_code');
          return;
        }

        // Step 2: Validate the stored code against Firebase
        const codeResult = await checkStoredCode();

        if (!codeResult.isValid) {
          // Code is invalid, expired, or revoked
          if (codeResult.error === 'network_error') {
            // Network error - allow access with cached code (offline mode)
            // Continue to biometry check
          } else {
            // Code was revoked or expired
            setAuthState('code_expired');
            return;
          }
        }

        // Step 3: Check biometry settings
        const biometryEnabled = await AsyncStorage.getItem(config.storageKeys.biometryEnabled);

        if (biometryEnabled === 'true') {
          const lastAuthTime = await AsyncStorage.getItem(config.storageKeys.lastSync);
          const now = Date.now();

          if (lastAuthTime) {
            const timeSinceAuth = now - parseInt(lastAuthTime, 10);
            if (timeSinceAuth < AUTH_TIMEOUT_MS) {
              // Still within biometry session - go to app
              setAuthState('authenticated');
            } else {
              // Session expired - need biometry
              setAuthState('need_biometry');
            }
          } else {
            // No previous auth - need biometry
            setAuthState('need_biometry');
          }
        } else {
          // Biometry not enabled - go directly to app
          setAuthState('authenticated');
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
        // On error, try to let user in if they have a code stored
        const storedCode = await getStoredCode();
        if (storedCode) {
          setAuthState('authenticated');
        } else {
          setAuthState('need_code');
        }
      }
    };

    checkAuthStatus();
  }, []);

  // Loading state
  if (authState === 'checking') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0D9488" />
      </View>
    );
  }

  // Redirect based on auth state
  switch (authState) {
    case 'need_code':
      return <Redirect href="/(auth)/access-code" />;

    case 'code_expired':
      return <Redirect href="/(auth)/code-expired" />;

    case 'need_biometry':
      return <Redirect href="/(auth)/biometry" />;

    case 'authenticated':
      return <Redirect href="/(main)" />;

    default:
      return <Redirect href="/(auth)/access-code" />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
});
