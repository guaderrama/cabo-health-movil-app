import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BrandedBackground, PremiumResourceRow } from '../../components';
import { PUBLIC_MINIAPPS, type PublicMiniapp } from '../../constants/publicMiniapps';
import { useFavorites, useTheme, useTranslations } from '../../hooks';

export default function SavedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const saved = PUBLIC_MINIAPPS.filter((miniapp) => favorites.includes(miniapp.slug));
  const openMiniapp = (miniapp: Readonly<PublicMiniapp>) => {
    router.push({ pathname: '/apps/[slug]', params: { slug: miniapp.slug } });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BrandedBackground moleculeOpacity={0.38} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}>
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
          <View
            style={[
              styles.savedGroup,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
                shadowColor: colors.text,
              },
            ]}
          >
            {saved.map((miniapp, index) => (
              <PremiumResourceRow
                key={miniapp.slug}
                miniapp={miniapp}
                title={miniapp.title[language === 'es-MX' ? 'es' : 'en']}
                summary={miniapp.slug === 'clinic-guide'
                  ? t('home.clinicSummary')
                  : t('home.recipesSummary')}
                favorite={isFavorite(miniapp.slug)}
                first={index === 0}
                onPress={() => openMiniapp(miniapp)}
                onToggleFavorite={() => toggleFavorite(miniapp.slug)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  content: { flexGrow: 1, paddingBottom: 30 },
  title: { fontFamily: 'Georgia', fontSize: 31, lineHeight: 37, fontWeight: '600', paddingHorizontal: 16 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4, paddingHorizontal: 16 },
  savedGroup: {
    marginHorizontal: 16,
    marginTop: 18,
    borderWidth: 1,
    borderRadius: 17,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 4,
  },
  empty: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 18, textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 21, marginTop: 7, textAlign: 'center', maxWidth: 280 },
});
