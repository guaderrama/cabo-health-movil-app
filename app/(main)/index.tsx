import { useCallback, useMemo } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedMolecules } from '../../components';
import { PUBLIC_CONTACT_URLS } from '../../constants/publicContacts';
import { PUBLIC_MINIAPPS, type PublicMiniapp } from '../../constants/publicMiniapps';
import { introColors } from '../../constants';
import {
  buildPremiumHomeModel,
  type PremiumHomeQuickAction,
} from '../../features/home/premiumHomePresentation';
import { useFavorites, useReducedMotion, useTheme, useTranslations, useWebApps } from '../../hooks';

type PremiumPalette = Readonly<{
  ink: string;
  sea: string;
  paper: string;
  bronze: string;
  soft: string;
  mist: string;
  line: string;
}>;

const PREMIUM: PremiumPalette = {
  ink: introColors.ink,
  sea: introColors.sea,
  paper: introColors.paper,
  bronze: introColors.bronze,
  soft: introColors.soft,
  mist: '#E8F4F8',
  line: 'rgba(8,42,60,0.11)',
};

export default function HomeScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { colors, isDark } = useTheme();
  const { language, t } = useTranslations();
  const { isOffline } = useWebApps();
  const { isFavorite, toggleFavorite } = useFavorites();
  const model = useMemo(
    () => buildPremiumHomeModel(PUBLIC_MINIAPPS, PUBLIC_CONTACT_URLS),
    [],
  );
  const palette: PremiumPalette = isDark
    ? {
      ink: colors.text,
      sea: colors.primary,
      paper: colors.background,
      bronze: '#D1AE7B',
      soft: colors.textSecondary,
      mist: colors.cardBackground,
      line: colors.border,
    }
    : PREMIUM;

  const openMiniapp = useCallback((miniapp: Readonly<PublicMiniapp>) => {
    router.push({ pathname: '/apps/[slug]', params: { slug: miniapp.slug } });
  }, [router]);

  const openQuickAction = useCallback(async (action: PremiumHomeQuickAction) => {
    if (action.kind === 'route') {
      router.push(action.destination as never);
      return;
    }
    try {
      await Linking.openURL(action.destination);
    } catch {
      Alert.alert(t('common.error'), t('settings.openLinkError'));
    }
  }, [router, t]);

  const titleFor = useCallback((miniapp: Readonly<PublicMiniapp>) => (
    miniapp.title[language === 'es-MX' ? 'es' : 'en']
  ), [language]);
  const summaryFor = useCallback((miniapp: Readonly<PublicMiniapp>) => (
    miniapp.summary[language === 'es-MX' ? 'es' : 'en']
  ), [language]);

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <LinearGradient
        colors={isDark
          ? [colors.background, colors.cardBackground, colors.background]
          : [introColors.gradientTop, introColors.gradientMiddle, introColors.gradientBottom]}
        locations={[0, 0.42, 0.9]}
        style={StyleSheet.absoluteFill}
      />
      <AnimatedMolecules
        active={isFocused}
        isDark={isDark}
        reduceMotion={reduceMotion}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(30, insets.bottom + 18) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 38) }]}>
          <Image
            source={require('../../assets/logo-wordmark.png')}
            accessibilityLabel="CaboHealth"
            resizeMode="contain"
            tintColor={palette.ink}
            style={styles.logo}
          />
          <Text style={[styles.kicker, { color: palette.bronze }]}>{t('home.welcome')}</Text>
          <Text accessibilityRole="header" style={[styles.headerTitle, { color: palette.ink }]}>
            {t('catalog.title')}
          </Text>
          <Text style={[styles.headerSubtitle, { color: palette.soft }]}>
            {t('catalog.subtitle')}
          </Text>
        </View>

        <View style={styles.body}>
          <FeaturedGuide
            miniapp={model.featured}
            title={titleFor(model.featured)}
            summary={summaryFor(model.featured)}
            buttonLabel={t('home.openGuide')}
            favorite={isFavorite(model.featured.slug)}
            favoriteLabel={isFavorite(model.featured.slug) ? t('catalog.removeSaved') : t('catalog.save')}
            palette={palette}
            isDark={isDark}
            onPress={() => openMiniapp(model.featured)}
            onToggleFavorite={() => toggleFavorite(model.featured.slug)}
          />

          {isOffline && (
            <View
              accessibilityRole="alert"
              style={[styles.offline, { backgroundColor: `${colors.warning}18`, borderColor: `${colors.warning}55` }]}
            >
              <Ionicons name="cloud-offline-outline" size={17} color={colors.warning} />
              <Text style={[styles.offlineText, { color: palette.ink }]}>{t('catalog.offlineBanner')}</Text>
            </View>
          )}

          <SectionLabel label={t('home.quickAccess')} color={palette.soft} />
          <View style={styles.quickGrid}>
            {model.quickActions.map((action) => (
              <QuickActionCard
                key={action.id}
                action={action}
                label={action.id === 'visit'
                  ? t('home.planVisit')
                  : action.id === 'contact'
                    ? t('home.contactClinic')
                    : t('home.clinicMap')}
                palette={palette}
                onPress={() => void openQuickAction(action)}
              />
            ))}
          </View>

          <SectionLabel label={t('home.availableNow')} color={palette.soft} />
          <View style={styles.moduleList}>
            {model.available.map((miniapp) => (
              <PremiumModuleRow
                key={miniapp.slug}
                miniapp={miniapp}
                title={titleFor(miniapp)}
                summary={summaryFor(miniapp)}
                favorite={isFavorite(miniapp.slug)}
                palette={palette}
                onPress={() => openMiniapp(miniapp)}
                onToggleFavorite={() => toggleFavorite(miniapp.slug)}
              />
            ))}
          </View>

          <SectionLabel label={t('home.localTools')} color={palette.soft} />
          <View style={styles.localTools}>
            <LocalToolRow
              icon="restaurant-outline"
              title={t('home.browseRecipes')}
              palette={palette}
              onPress={() => router.push('/(main)/recipes')}
            />
            <LocalToolRow
              icon="checkbox-outline"
              title={t('home.prepareVisit')}
              palette={palette}
              onPress={() => router.push('/(main)/visit-checklist')}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function FeaturedGuide({
  miniapp,
  title,
  summary,
  buttonLabel,
  favorite,
  favoriteLabel,
  palette,
  isDark,
  onPress,
  onToggleFavorite,
}: {
  miniapp: Readonly<PublicMiniapp>;
  title: string;
  summary: string;
  buttonLabel: string;
  favorite: boolean;
  favoriteLabel: string;
  palette: PremiumPalette;
  isDark: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <BlurView
      intensity={isDark ? 24 : 38}
      tint={isDark ? 'dark' : 'light'}
      style={[styles.featured, { borderColor: isDark ? palette.line : 'rgba(255,255,255,0.82)' }]}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(15,23,42,0.72)' : 'rgba(255,255,255,0.74)' }]} />
      <View style={styles.featureTop}>
        <LinearGradient colors={[palette.ink, palette.sea]} style={styles.featureIcon}>
          <Ionicons name="sparkles-outline" size={19} color="#FFFFFF" />
        </LinearGradient>
        <View style={styles.featureCopy}>
          <Text style={[styles.featureTitle, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.featureSummary, { color: palette.soft }]}>{summary}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={favoriteLabel}
          accessibilityState={{ selected: favorite }}
          hitSlop={6}
          onPress={onToggleFavorite}
          style={({ pressed }) => [styles.featureFavorite, pressed && styles.pressed]}
        >
          <Ionicons
            name={favorite ? 'star' : 'star-outline'}
            size={20}
            color={favorite ? palette.bronze : palette.sea}
          />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${buttonLabel}: ${title}`}
        accessibilityHint={miniapp.canonicalUrl}
        hitSlop={7}
        onPress={onPress}
        style={({ pressed }) => [styles.featureButtonOuter, pressed && styles.pressed]}
      >
        <LinearGradient colors={[palette.ink, palette.sea]} style={styles.featureButton}>
          <Text style={styles.featureButtonText}>{buttonLabel.toUpperCase()}</Text>
        </LinearGradient>
      </Pressable>
    </BlurView>
  );
}

function QuickActionCard({
  action,
  label,
  palette,
  onPress,
}: {
  action: PremiumHomeQuickAction;
  label: string;
  palette: PremiumPalette;
  onPress: () => void;
}) {
  const icon: keyof typeof Ionicons.glyphMap = action.id === 'visit'
    ? 'navigate-outline'
    : action.id === 'contact'
      ? 'chatbubble-ellipses-outline'
      : 'map-outline';
  return (
    <Pressable
      accessibilityRole={action.kind === 'external' ? 'link' : 'button'}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickCard,
        { backgroundColor: 'rgba(255,255,255,0.84)', borderColor: palette.line },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={19} color={palette.sea} />
      <Text style={[styles.quickLabel, { color: palette.soft }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

function PremiumModuleRow({
  miniapp,
  title,
  summary,
  favorite,
  palette,
  onPress,
  onToggleFavorite,
}: {
  miniapp: Readonly<PublicMiniapp>;
  title: string;
  summary: string;
  favorite: boolean;
  palette: PremiumPalette;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const iconText = miniapp.slug === 'healthy-recipes' ? 'HR' : 'CH';
  return (
    <View style={[styles.moduleRow, { backgroundColor: 'rgba(255,255,255,0.9)', borderColor: palette.line }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${summary}`}
        onPress={onPress}
        style={({ pressed }) => [styles.moduleMain, pressed && styles.pressed]}
      >
        <LinearGradient colors={[palette.ink, palette.sea]} style={styles.moduleIcon}>
          <Text style={styles.moduleIconText}>{iconText}</Text>
        </LinearGradient>
        <View style={styles.moduleCopy}>
          <Text style={[styles.moduleTitle, { color: palette.ink }]}>{title}</Text>
          <Text numberOfLines={2} style={[styles.moduleSummary, { color: palette.soft }]}>{summary}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={favorite ? `Remove ${title} from Saved` : `Save ${title}`}
        accessibilityState={{ selected: favorite }}
        onPress={onToggleFavorite}
        style={({ pressed }) => [styles.favorite, pressed && styles.pressed]}
      >
        <Ionicons name={favorite ? 'star' : 'star-outline'} size={20} color={favorite ? palette.bronze : palette.sea} />
      </Pressable>
      <Ionicons name="chevron-forward" size={18} color={palette.bronze} />
    </View>
  );
}

function LocalToolRow({
  icon,
  title,
  palette,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  palette: PremiumPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.localTool,
        { backgroundColor: 'rgba(255,255,255,0.82)', borderColor: palette.line },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.localIcon, { backgroundColor: `${palette.sea}12` }]}>
        <Ionicons name={icon} size={20} color={palette.sea} />
      </View>
      <Text style={[styles.localTitle, { color: palette.ink }]}>{title}</Text>
      <Ionicons name="chevron-forward" size={18} color={palette.bronze} />
    </Pressable>
  );
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.sectionLabel, { color }]}>{label.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  scrollContent: { flexGrow: 1 },
  header: { height: 205, overflow: 'hidden', paddingHorizontal: 20 },
  logo: { width: 105, height: 55, marginBottom: 11 },
  kicker: { fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 2.1, textTransform: 'uppercase' },
  headerTitle: { fontFamily: 'Georgia', fontSize: 31, lineHeight: 35, fontWeight: '400', marginTop: 4 },
  headerSubtitle: { maxWidth: 310, fontSize: 13, lineHeight: 18, marginTop: 3 },
  body: { paddingHorizontal: 15, paddingBottom: 24 },
  featured: {
    marginTop: -27,
    minHeight: 108,
    padding: 10,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: PREMIUM.ink,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.11,
    shadowRadius: 20,
    elevation: 5,
  },
  featureTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  featureIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureCopy: { flex: 1 },
  featureTitle: { fontFamily: 'Georgia', fontSize: 18, lineHeight: 22, fontWeight: '400', marginBottom: 3 },
  featureSummary: { fontSize: 12, lineHeight: 17 },
  featureFavorite: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: -2 },
  featureButtonOuter: { alignSelf: 'flex-start', marginTop: 6, borderRadius: 999, overflow: 'hidden' },
  featureButton: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  featureButtonText: { color: '#FFFFFF', fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8 },
  offline: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 13, borderWidth: 1, borderRadius: 13, padding: 10 },
  offlineText: { flex: 1, fontSize: 12, lineHeight: 17 },
  sectionLabel: { marginTop: 20, marginHorizontal: 2, marginBottom: 9, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1.8 },
  quickGrid: { flexDirection: 'row', gap: 8 },
  quickCard: {
    flex: 1,
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 8,
    gap: 6,
    shadowColor: PREMIUM.ink,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  quickLabel: { fontSize: 11, lineHeight: 14, textAlign: 'center' },
  moduleList: { gap: 9 },
  moduleRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 15,
    paddingRight: 10,
    shadowColor: PREMIUM.ink,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  moduleMain: { flex: 1, minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, paddingRight: 3 },
  moduleIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  moduleIconText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  moduleCopy: { flex: 1 },
  moduleTitle: { fontFamily: 'Georgia', fontSize: 16, lineHeight: 20, fontWeight: '400', marginBottom: 2 },
  moduleSummary: { fontSize: 11, lineHeight: 15 },
  favorite: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  localTools: { gap: 8 },
  localTool: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 15, padding: 8, gap: 10 },
  localIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  localTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
