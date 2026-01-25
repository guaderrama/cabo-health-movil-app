// components/LoadingIndicator.tsx
// Indicador de carga

import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { colors, layout } from '../constants';

interface LoadingIndicatorProps {
  message?: string;
  size?: 'small' | 'large';
}

export function LoadingIndicator({
  message = 'Cargando...',
  size = 'large'
}: LoadingIndicatorProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={colors.primary} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: layout.spacing.xl,
  },
  message: {
    marginTop: layout.spacing.md,
    fontSize: layout.fontSize.md,
    color: colors.textSecondary,
  },
});

export default LoadingIndicator;
