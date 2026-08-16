// app/_layout.tsx
// SOLUCIÓN: Slot-based navigation (evita incompatibilidad Stack + Fabric)
// + ThemeProvider para soporte Dark Mode Premium

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { ThemeProvider, useTheme } from '../hooks';
import { removeLegacyPrivateState } from '../features/migrations/removeLegacyPrivateState';

function ThemedLayout() {
  const { colors, isDark } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Slot />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  );
}

export default function RootLayout() {
  const [migrationComplete, setMigrationComplete] = useState(false);

  useEffect(() => {
    removeLegacyPrivateState(AsyncStorage)
      .then(() => setMigrationComplete(true))
      .catch(() => console.error('Unable to complete the public-v1 storage migration.'));
  }, []);

  if (!migrationComplete) return null;

  return (
    <ThemeProvider>
      <ThemedLayout />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
