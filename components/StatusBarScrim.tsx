import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks';

/**
 * Opaque strip behind the iOS status bar / Dynamic Island so scrolled content
 * never draws under the clock and battery (seen in App Review's capture of
 * 3.0 (14), where "MINI APPS" overlapped the clock). Render it after the
 * ScrollView so it sits on top; it ignores touches.
 */
export function StatusBarScrim() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (insets.top <= 0) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.scrim, { height: insets.top, backgroundColor: colors.background }]}
    />
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
});
