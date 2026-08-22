import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandedBackground, PremiumMiniappTile } from '../../components';
import { PUBLIC_MINIAPPS, type PublicMiniapp } from '../../constants/publicMiniapps';
import { resolveCatalogCardColumns } from '../../features/catalog/catalogPresentation';
import {
  buildPremiumHomeModel,
  type PremiumHomeTool,
} from '../../features/home/premiumHomePresentation';
import { DevMiniappPanel } from '../../features/devMiniapps/DevMiniappPanel';
import { DevMiniappPreview } from '../../features/devMiniapps/DevMiniappPreview';
import { DevMiniappTile } from '../../features/devMiniapps/DevMiniappTile';
import { type DevMiniapp } from '../../features/devMiniapps/devMiniappCatalog';
import { useDevMiniapps } from '../../features/devMiniapps/useDevMiniapps';
import { useFavorites, useTheme, useTranslations, useWebApps } from '../../hooks';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const { language, t } = useTranslations();
  const { isOffline } = useWebApps();
  const { isFavorite, toggleFavorite } = useFavorites();
  const model = useMemo(() => buildPremiumHomeModel(PUBLIC_MINIAPPS), []);
  const devCatalog = useDevMiniapps();
  const [devPanelVisible, setDevPanelVisible] = useState(false);
  const [previewMiniapp, setPreviewMiniapp] = useState<Readonly<DevMiniapp> | null>(null);
  const logoTapCount = useRef(0);
  const columns = resolveCatalogCardColumns({ width, fontScale });

  const openMiniapp = useCallback((miniapp: Readonly<PublicMiniapp>) => {
    router.push({ pathname: '/apps/[slug]', params: { slug: miniapp.slug } });
  }, [router]);

  const openTool = useCallback((tool: PremiumHomeTool) => {
    router.push(tool.destination as never);
  }, [router]);

  const titleFor = useCallback((miniapp: Readonly<PublicMiniapp>) => (
    miniapp.title[language === 'es-MX' ? 'es' : 'en']
  ), [language]);
  const summaryFor = useCallback((miniapp: Readonly<PublicMiniapp>) => (
    miniapp.slug === 'clinic-guide' ? t('home.clinicSummary') : t('home.recipesSummary')
  ), [t]);
  const devTitleFor = useCallback((miniapp: Readonly<DevMiniapp>) => (
    language === 'es-MX' ? miniapp.titleEs : miniapp.titleEn
  ), [language]);
  const devSummaryFor = useCallback((miniapp: Readonly<DevMiniapp>) => (
    language === 'es-MX' ? miniapp.summaryEs : miniapp.summaryEn
  ), [language]);
  const handleDevLogoTap = useCallback(() => {
    logoTapCount.current += 1;
    if (logoTapCount.current >= 5) {
      logoTapCount.current = 0;
      setDevPanelVisible(true);
    }
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BrandedBackground density="rich" moleculeOpacity={isDark ? 0.58 : 0.9} />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(24, insets.bottom + 12) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 18, 72) }]}>
          <View style={styles.brandLockup}>
            {devCatalog.enabled ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="CaboHealth"
                accessibilityHint={t('devPanel.openHint')}
                delayLongPress={900}
                onPress={handleDevLogoTap}
                onLongPress={() => setDevPanelVisible(true)}
                style={({ pressed }) => [styles.logoControl, pressed && styles.logoPressed]}
              >
                <Image
                  source={require('../../assets/logo-wordmark.png')}
                  resizeMode="contain"
                  tintColor={colors.text}
                  style={styles.logo}
                />
              </Pressable>
            ) : (
              <Image
                source={require('../../assets/logo-wordmark.png')}
                accessibilityLabel="CaboHealth"
                resizeMode="contain"
                tintColor={colors.text}
                style={styles.logo}
              />
            )}
            <View style={styles.brandPromiseRow}>
              <View style={[styles.brandRule, { backgroundColor: colors.accent }]} />
              <Text style={[styles.brandPromise, { color: colors.textSecondary }]}>
                {t('home.brandPromise')}
              </Text>
              <View style={[styles.brandRule, { backgroundColor: colors.accent }]} />
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <SectionLabel label={t('home.resources')} color={colors.primary} />
          <View style={styles.miniappGrid}>
            {model.resources.map((miniapp, index) => (
              <View
                key={miniapp.slug}
                style={columns === 2 ? styles.halfTile : styles.fullTile}
              >
                <PremiumMiniappTile
                  miniapp={miniapp}
                  title={titleFor(miniapp)}
                  summary={summaryFor(miniapp)}
                  favorite={isFavorite(miniapp.slug)}
                  index={index}
                  onPress={() => openMiniapp(miniapp)}
                  onToggleFavorite={() => toggleFavorite(miniapp.slug)}
                />
              </View>
            ))}
          </View>

          {devCatalog.enabled && devCatalog.visibleMiniapps.length > 0 && (
            <View style={styles.testSection}>
              <SectionLabel label={t('home.testMiniapps')} color={colors.primary} />
              <View style={styles.miniappGrid}>
                {devCatalog.visibleMiniapps.map((miniapp, index) => (
                  <View
                    key={miniapp.id}
                    style={columns === 2 ? styles.halfTile : styles.fullTile}
                  >
                    <DevMiniappTile
                      miniapp={miniapp}
                      title={devTitleFor(miniapp)}
                      summary={devSummaryFor(miniapp)}
                      index={model.resources.length + index}
                      onPress={() => setPreviewMiniapp(miniapp)}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          {isOffline && (
            <View
              accessibilityRole="alert"
              style={[
                styles.offline,
                { backgroundColor: colors.glass, borderColor: colors.warning },
              ]}
            >
              <Ionicons name="cloud-offline-outline" size={18} color={colors.warning} />
              <Text style={[styles.offlineText, { color: colors.text }]}>
                {t('catalog.offlineBanner')}
              </Text>
            </View>
          )}

          <View style={styles.toolsSection}>
            <SectionLabel label={t('home.tools')} color={colors.primary} />
            <View
              style={[
                styles.groupSurface,
                styles.toolsSurface,
                {
                  backgroundColor: colors.editorialSurface,
                  borderColor: colors.editorialBorder,
                  shadowColor: colors.text,
                },
              ]}
            >
              {model.tools.map((tool, index) => (
                <ToolRow
                  key={tool.id}
                  tool={tool}
                  title={t('home.prepareVisit')}
                  first={index === 0}
                  onPress={() => openTool(tool)}
                />
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
      <DevMiniappPanel
        visible={devPanelVisible}
        miniapps={devCatalog.miniapps}
        saving={devCatalog.saving}
        storageError={devCatalog.storageError}
        onClose={() => setDevPanelVisible(false)}
        onAdd={devCatalog.addMiniapp}
        onToggle={devCatalog.toggleMiniapp}
        onRemove={devCatalog.deleteMiniapp}
      />
      <DevMiniappPreview
        miniapp={previewMiniapp}
        title={previewMiniapp ? devTitleFor(previewMiniapp) : ''}
        onClose={() => setPreviewMiniapp(null)}
      />
    </View>
  );
}

function ToolRow({
  tool,
  title,
  first,
  onPress,
}: {
  tool: PremiumHomeTool;
  title: string;
  first: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolRow,
        !first && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.toolIcon,
          {
            backgroundColor: colors.editorialCover,
            borderColor: colors.editorialBorder,
          },
        ]}
      >
        <Ionicons name="checkbox-outline" size={26} color={colors.primary} />
      </View>
      <Text style={[styles.toolTitle, { color: colors.text }]}>{title}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.primary} />
    </Pressable>
  );
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <Text accessibilityRole="header" style={[styles.sectionLabel, { color }]}>
      {label.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  scrollContent: { flexGrow: 1 },
  header: { alignItems: 'center', paddingBottom: 48, paddingHorizontal: 20 },
  brandLockup: { width: '100%', alignItems: 'center' },
  logoControl: { minWidth: 104, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 104, height: 60 },
  brandPromiseRow: {
    width: '100%',
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  brandRule: { width: 18, height: 1, opacity: 0.78 },
  brandPromise: {
    maxWidth: 258,
    fontFamily: 'Georgia',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  body: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingTop: 14, paddingHorizontal: 20, paddingBottom: 24 },
  sectionLabel: {
    marginTop: 14,
    marginBottom: 10,
    marginLeft: 3,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  groupSurface: {
    borderWidth: 1,
    borderRadius: 17,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 4,
  },
  miniappGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
  },
  halfTile: { width: '48.2%' },
  fullTile: { width: '100%' },
  toolsSection: { marginTop: 34 },
  testSection: { marginTop: 17 },
  toolsSurface: { marginTop: 0 },
  toolRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
  toolIcon: { width: 44, height: 44, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  offline: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 14, borderWidth: 1, borderRadius: 14, padding: 11 },
  offlineText: { flex: 1, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
  logoPressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
