import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BrandedBackground, PremiumResourceRow, StatusBarScrim } from '../../components';
import { CatalogRefreshError } from '../../components/CatalogRefreshError';
import type { CatalogPublicMiniapp } from '../../constants/publicMiniapps';
import { buildPublicMiniappRoute } from '../../features/catalog/publicMiniappRoute';
import { useFavorites, useTheme, useTranslations, useWebApps } from '../../hooks';

export default function SavedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { catalogMiniapps, error: catalogError, isLoading, refresh } = useWebApps();
  const saved = catalogMiniapps.filter((miniapp) => favorites.includes(miniapp.slug));
  const openMiniapp = (miniapp: Readonly<CatalogPublicMiniapp>) => {
    router.push(buildPublicMiniappRoute(miniapp));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BrandedBackground moleculeOpacity={0.38} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('saved.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('saved.subtitle')}</Text>
        {catalogError && (
          <View style={styles.catalogError}>
            <CatalogRefreshError
              hasResources={saved.length > 0}
              isRefreshing={isLoading}
              onRetry={refresh}
            />
          </View>
        )}
        {saved.length === 0 ? !catalogError && (
          <View style={styles.empty}>
            <View
              style={[
                styles.emptyIcon,
                {
                  backgroundColor: colors.editorialCover,
                  borderColor: colors.editorialBorder,
                },
              ]}
            >
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
                backgroundColor: colors.editorialSurface,
                borderColor: colors.editorialBorder,
                shadowColor: colors.text,
              },
            ]}
          >
            {saved.map((miniapp, index) => (
              <PremiumResourceRow
                key={miniapp.slug}
                miniapp={miniapp}
                title={miniapp.title[language === 'es-MX' ? 'es' : 'en']}
                summary={miniapp.summary[language === 'es-MX' ? 'es' : 'en']}
                favorite={isFavorite(miniapp.slug)}
                first={index === 0}
                onPress={() => openMiniapp(miniapp)}
                onToggleFavorite={() => toggleFavorite(miniapp.slug)}
              />
            ))}
          </View>
        )}
      </ScrollView>
      <StatusBarScrim />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  content: { flexGrow: 1, width: '100%', maxWidth: 620, alignSelf: 'center', paddingBottom: 30 },
  title: { fontFamily: 'Georgia', fontSize: 31, lineHeight: 37, fontWeight: '600', paddingHorizontal: 16 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4, paddingHorizontal: 16 },
  catalogError: { marginHorizontal: 16, marginTop: 18 },
  savedGroup: {
    marginHorizontal: 16,
    marginTop: 18,
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 4,
  },
  empty: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 18, textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 21, marginTop: 7, textAlign: 'center', maxWidth: 280 },
});
