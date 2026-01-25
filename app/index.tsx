// app/index.tsx
// Entry Point - Auth Gate / Redirect

import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../constants';

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

export default function Index() {
  const [isChecking, setIsChecking] = useState(true);
  const [shouldShowBiometry, setShouldShowBiometry] = useState(false);

  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const biometryEnabled = await AsyncStorage.getItem(config.storageKeys.biometryEnabled);

        if (biometryEnabled === 'true') {
          const lastAuthTime = await AsyncStorage.getItem(config.storageKeys.lastSync);
          const now = Date.now();

          if (lastAuthTime) {
            const timeSinceAuth = now - parseInt(lastAuthTime, 10);
            if (timeSinceAuth < AUTH_TIMEOUT_MS) {
              setShouldShowBiometry(false);
            } else {
              setShouldShowBiometry(true);
            }
          } else {
            setShouldShowBiometry(true);
          }
        } else {
          setShouldShowBiometry(false);
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
        setShouldShowBiometry(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkAuthStatus();
  }, []);

  if (isChecking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (shouldShowBiometry) {
    return <Redirect href="/(auth)/biometry" />;
  }

  return <Redirect href="/(main)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
});
