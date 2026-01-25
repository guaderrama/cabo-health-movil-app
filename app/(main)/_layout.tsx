// app/(main)/_layout.tsx
// SOLUCIÓN: Slot-based navigation

import { Slot } from 'expo-router';
import { View, StyleSheet } from 'react-native';

export default function MainLayout() {
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
