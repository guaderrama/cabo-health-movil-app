import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useTranslations } from '../hooks';

export default function NotFoundScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslations();
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          backgroundColor: colors.background,
        },
      ]}
    >
      <Ionicons name="alert-circle-outline" size={58} color={colors.warning} />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('common.error')}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t('settings.openLinkError')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('nav.apps')}
        onPress={() => router.replace('/(main)')}
        style={[styles.button, { backgroundColor: colors.primary }]}
      >
        <Ionicons name="grid-outline" size={20} color={colors.white} />
        <Text style={[styles.buttonText, { color: colors.white }]}>{t('nav.apps')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  title: { marginTop: 14, fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  body: { marginTop: 8, maxWidth: 320, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 44, marginTop: 24, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  buttonText: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
});
