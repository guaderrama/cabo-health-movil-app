// app/(main)/webview/_layout.tsx
// Layout para WebView - necesario para Slot-based navigation

import { Slot } from 'expo-router';
import { View, StyleSheet } from 'react-native';

export default function WebViewLayout() {
  return (
    <View style={styles.container}>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
