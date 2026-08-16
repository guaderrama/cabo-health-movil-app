// app/(main)/_layout.tsx
import { Slot, usePathname } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { BottomNavigation, PersistenceErrorBanner } from '../../components';
import { useFavorites, usePreferences, useTheme } from '../../hooks';

export default function MainLayout() {
  const pathname = usePathname();
  const { colors, persistenceIssue: themeIssue } = useTheme();
  const { persistenceIssue: preferenceIssue } = usePreferences();
  const { persistenceIssue: favoriteIssue } = useFavorites();
  const showBottomNavigation = !pathname.includes('/webview/');
  const persistenceIssue = favoriteIssue ?? preferenceIssue ?? themeIssue;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}><Slot /></View>
      {persistenceIssue && <PersistenceErrorBanner issue={persistenceIssue} />}
      {showBottomNavigation && <BottomNavigation />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
