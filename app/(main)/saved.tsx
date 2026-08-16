import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppCard } from '../../components';
import { PUBLIC_MINIAPPS, type PublicMiniapp } from '../../constants/publicMiniapps';
import { useFavorites, useTheme, useTranslations } from '../../hooks';

export default function SavedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslations();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const saved = PUBLIC_MINIAPPS.filter((miniapp) => favorites.includes(miniapp.slug));
  const openMiniapp = (miniapp: Readonly<PublicMiniapp>) => {
    router.push({ pathname: '/(main)/webview/[id]', params: { id: miniapp.slug } });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('saved.title')}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('saved.subtitle')}</Text>
      {saved.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: `${colors.primary}14` }]}>
            <Ionicons name="star-outline" size={34} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('saved.emptyTitle')}</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{t('saved.emptyBody')}</Text>
        </View>
      ) : (
        <View style={styles.cardRow}>
          {saved.map((miniapp, index) => (
            <View key={miniapp.slug} style={styles.cardColumn}>
              <AppCard
                miniapp={miniapp}
                favorite={isFavorite(miniapp.slug)}
                onPress={openMiniapp}
                onToggleFavorite={toggleFavorite}
                index={index}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 30 },
  title: { fontFamily: 'Georgia', fontSize: 31, lineHeight: 37, fontWeight: '600', paddingHorizontal: 16 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4, paddingHorizontal: 16 },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingTop: 18 },
  cardColumn: { width: '50%', padding: 5 },
  empty: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 18, textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 21, marginTop: 7, textAlign: 'center', maxWidth: 280 },
});
