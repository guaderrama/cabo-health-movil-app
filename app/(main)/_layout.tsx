// app/(main)/_layout.tsx
import { Slot, usePathname } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { BottomNavigation } from '../../components';
import { useTheme } from '../../hooks';

export default function MainLayout() {
  const pathname = usePathname();
  const { colors } = useTheme();
  const showBottomNavigation = !pathname.includes('/webview/');
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Slot />
      {showBottomNavigation && <BottomNavigation />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
