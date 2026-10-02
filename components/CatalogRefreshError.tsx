import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useTranslations } from '../hooks';

export function CatalogRefreshError({
  hasResources,
  isRefreshing,
  onRetry,
}: {
  hasResources: boolean;
  isRefreshing: boolean;
  onRetry: () => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslations();

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        { backgroundColor: colors.editorialSurface, borderColor: colors.warning },
      ]}
    >
      <Text style={[styles.message, { color: colors.text }]}>
        {t(hasResources ? 'catalog.refreshError' : 'catalog.loadError')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.retry')}
        accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
        disabled={isRefreshing}
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retry,
          { backgroundColor: colors.primary },
          (pressed || isRefreshing) && styles.dimmed,
        ]}
      >
        {isRefreshing && <ActivityIndicator color={colors.onPrimary} size="small" />}
        <Text style={[styles.retryText, { color: colors.onPrimary }]}>
          {t(isRefreshing ? 'catalog.refreshing' : 'common.retry')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14, gap: 12 },
  message: { fontSize: 14, lineHeight: 21 },
  retry: {
    alignSelf: 'flex-start', minHeight: 44, borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  retryText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  dimmed: { opacity: 0.65 },
});
