import { useCallback } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedMolecules, AppCard, WelcomeBanner } from '../../components';
import { PUBLIC_MINIAPPS, type PublicMiniapp } from '../../constants/publicMiniapps';
import { introColors } from '../../constants';
import { resolveCatalogCardColumns } from '../../features/catalog/catalogPresentation';
import { useFavorites, useReducedMotion, useTheme, useTranslations, useWebApps } from '../../hooks';

export default function HomeScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const { colors, isDark } = useTheme();
  const { t } = useTranslations();
  const { isOffline } = useWebApps();
  const { isFavorite, toggleFavorite } = useFavorites();
  const cardColumns = resolveCatalogCardColumns(window);

  const openMiniapp = useCallback((miniapp: Readonly<PublicMiniapp>) => {
    router.push({ pathname: '/apps/[slug]', params: { slug: miniapp.slug } });
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AnimatedMolecules active={isFocused} isDark={isDark} reduceMotion={reduceMotion} />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientMiddle, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <Image
            source={require('../../assets/logo.png')}
            accessibilityLabel="CaboHealth"
            resizeMode="contain"
            style={styles.logo}
          />
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={styles.headerTitle}>{t('catalog.title')}</Text>
            <Text style={styles.headerSubtitle}>{t('catalog.subtitle')}</Text>
          </View>
        </LinearGradient>

        {isOffline && (
          <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: `${colors.warning}20` }]}>
            <Ionicons name="cloud-offline-outline" size={17} color={colors.warning} />
            <Text style={[styles.offlineText, { color: colors.text }]}>{t('catalog.offlineBanner')}</Text>
          </View>
        )}

        <View style={styles.cardRow}>
          {PUBLIC_MINIAPPS.map((miniapp, index) => (
            <View
              key={miniapp.slug}
              style={[styles.cardColumn, { width: cardColumns === 2 ? '50%' : '100%' }]}
            >
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

        <View style={styles.toolsSection}>
          <WelcomeBanner />
          <UtilityButton
            icon="restaurant-outline"
            title={t('home.browseRecipes')}
            hint={t('home.browseRecipesHint')}
            onPress={() => router.push('/(main)/recipes')}
          />
          <UtilityButton
            icon="checkbox-outline"
            title={t('home.prepareVisit')}
            hint={t('home.prepareVisitHint')}
            onPress={() => router.push('/(main)/visit-checklist')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function UtilityButton({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.utility,
        { backgroundColor: colors.cardBackground, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.utilityIcon, { backgroundColor: `${colors.primary}16` }]}>
        <Ionicons name={icon} size={23} color={colors.primary} />
      </View>
      <Text style={[styles.utilityTitle, { color: colors.text }]}>{title}</Text>
      <Ionicons name="chevron-forward" size={21} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 26 },
  header: { minHeight: 116, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  logo: { width: 58, height: 58, tintColor: '#FFFFFF' },
  headerText: { flex: 1, marginLeft: 12 },
  headerTitle: { color: '#FFFFFF', fontFamily: 'Georgia', fontSize: 25, lineHeight: 30, fontWeight: '600' },
  headerSubtitle: { color: 'rgba(255,255,255,0.86)', fontSize: 12, lineHeight: 17, marginTop: 4 },
  offline: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 14, marginTop: 10, padding: 10, borderRadius: 12 },
  offlineText: { flex: 1, fontSize: 12, lineHeight: 17 },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingTop: 12 },
  cardColumn: { paddingHorizontal: 5, paddingBottom: 10 },
  toolsSection: { paddingHorizontal: 15, paddingTop: 20, gap: 10 },
  utility: { minHeight: 58, borderWidth: 1, borderRadius: 17, flexDirection: 'row', alignItems: 'center', padding: 10 },
  utilityIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  utilityTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
