// components/OfflineScreen.tsx
// Pantalla cuando no hay conexión

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout } from '../constants';

interface OfflineScreenProps {
  onRetry?: () => void;
  showCachedData?: boolean;
}

export function OfflineScreen({ onRetry, showCachedData }: OfflineScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="cloud-offline-outline" size={64} color={colors.textSecondary} />
      </View>

      <Text style={styles.title}>Sin Conexión</Text>
      <Text style={styles.message}>
        Revisa tu conexión a internet e intenta de nuevo
      </Text>

      {showCachedData && (
        <Text style={styles.cachedNote}>
          Mostrando datos guardados
        </Text>
      )}

      {onRetry && (
        <TouchableOpacity style={styles.button} onPress={onRetry}>
          <Ionicons name="refresh" size={20} color={colors.white} />
          <Text style={styles.buttonText}>Reintentar</Text>
        </TouchableOpacity>
      )}
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
  iconContainer: {
    marginBottom: layout.spacing.lg,
  },
  title: {
    fontSize: layout.fontSize.xl,
    fontWeight: layout.fontWeight.bold,
    color: colors.text,
    marginBottom: layout.spacing.sm,
  },
  message: {
    fontSize: layout.fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: layout.spacing.md,
  },
  cachedNote: {
    fontSize: layout.fontSize.sm,
    color: colors.warning,
    marginBottom: layout.spacing.xl,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: layout.spacing.xl,
    paddingVertical: layout.spacing.md,
    borderRadius: layout.borderRadius.md,
  },
  buttonText: {
    fontSize: layout.fontSize.md,
    fontWeight: layout.fontWeight.semibold,
    color: colors.white,
  },
});

export default OfflineScreen;
