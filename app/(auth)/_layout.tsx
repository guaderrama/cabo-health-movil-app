// app/(auth)/_layout.tsx
// SOLUCIÓN: Slot-based navigation (evita incompatibilidad Stack + Fabric)

import { Slot } from 'expo-router';
import { View, StyleSheet } from 'react-native';

export default function AuthLayout() {
  return (
    <View style={styles.container}>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
});
