// app/(main)/_layout.tsx
// Main layout with app state management

import { useEffect, useRef } from 'react';
import { Slot } from 'expo-router';
import { View, StyleSheet, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../../constants';

const BACKGROUND_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - same as AUTH_TIMEOUT_MS

export default function MainLayout() {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Handle app state changes for security
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App going to background - save timestamp for session timeout
        try {
          await AsyncStorage.setItem(config.storageKeys.lastBackgroundTime, Date.now().toString());
        } catch (error) {
          console.error('Error saving background time:', error);
        }
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <View style={styles.container}>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
});
