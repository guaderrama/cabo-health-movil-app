import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MessageKey } from '../i18n/messages';
import { useTheme, useTranslations } from '../hooks';

interface PersistenceErrorBannerProps {
  issue: {
    messageKey: MessageKey;
    retry: () => void;
  };
}

export function PersistenceErrorBanner({ issue }: PersistenceErrorBannerProps) {
  const { colors } = useTheme();
  const { t } = useTranslations();

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.container,
        { backgroundColor: colors.cardBackground, borderColor: colors.warning },
      ]}
    >
      <Text style={[styles.message, { color: colors.text }]}>{t(issue.messageKey)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('storage.retry')}
        onPress={issue.retry}
        style={({ pressed }) => [
          styles.retry,
          { backgroundColor: colors.primary },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.retryText, { color: colors.white }]}>{t('storage.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  message: { flex: 1, fontSize: 13, lineHeight: 18 },
  retry: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
