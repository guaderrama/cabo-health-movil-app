import { useCallback, useMemo } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandedBackground, PremiumResourceRow } from '../../components';
import { PUBLIC_MINIAPPS, type PublicMiniapp } from '../../constants/publicMiniapps';
import {
  buildPremiumHomeModel,
  type PremiumHomeTool,
} from '../../features/home/premiumHomePresentation';
import { useFavorites, useTheme, useTranslations, useWebApps } from '../../hooks';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { language, t } = useTranslations();
  const { isOffline } = useWebApps();
  const { isFavorite, toggleFavorite } = useFavorites();
  const model = useMemo(() => buildPremiumHomeModel(PUBLIC_MINIAPPS), []);

  const openMiniapp = useCallback((miniapp: Readonly<PublicMiniapp>) => {
    router.push({ pathname: '/apps/[slug]', params: { slug: miniapp.slug } });
  }, [router]);

  const openTool = useCallback((tool: PremiumHomeTool) => {
    if (tool.kind === 'miniapp') {
      const miniapp = model.resources.find((resource) => resource.slug === tool.destination);
      if (miniapp) openMiniapp(miniapp);
      return;
    }
    router.push(tool.destination as never);
  }, [model.resources, openMiniapp, router]);

  const titleFor = useCallback((miniapp: Readonly<PublicMiniapp>) => (
    miniapp.title[language === 'es-MX' ? 'es' : 'en']
  ), [language]);
  const summaryFor = useCallback((miniapp: Readonly<PublicMiniapp>) => (
    miniapp.slug === 'clinic-guide' ? t('home.clinicSummary') : t('home.recipesSummary')
  ), [t]);

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
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 64) }]}>
          <Image
            source={require('../../assets/logo-wordmark.png')}
            accessibilityLabel="CaboHealth"
            resizeMode="contain"
            tintColor={colors.text}
            style={styles.logo}
          />
        </View>

        <View style={styles.body}>
          <SectionLabel label={t('home.resources')} color={colors.primary} />
          <View
            style={[
              styles.groupSurface,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
                shadowColor: colors.text,
              },
            ]}
          >
            {model.resources.map((miniapp, index) => (
              <PremiumResourceRow
                key={miniapp.slug}
                miniapp={miniapp}
                title={titleFor(miniapp)}
                summary={summaryFor(miniapp)}
                favorite={isFavorite(miniapp.slug)}
                first={index === 0}
                onPress={() => openMiniapp(miniapp)}
                onToggleFavorite={() => toggleFavorite(miniapp.slug)}
              />
            ))}
          </View>

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
                  backgroundColor: colors.glass,
                  borderColor: colors.glassBorder,
                  shadowColor: colors.text,
                },
              ]}
            >
              {model.tools.map((tool, index) => (
                <ToolRow
                  key={tool.id}
                  tool={tool}
                  title={tool.id === 'plan-visit' ? t('home.planVisit') : t('home.visitChecklist')}
                  first={index === 0}
                  onPress={() => openTool(tool)}
                />
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
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
  const icon = tool.id === 'plan-visit' ? 'navigate-outline' : 'checkbox-outline';
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
      <View style={styles.toolIcon}>
        <Ionicons name={icon} size={26} color={colors.primary} />
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
  header: { alignItems: 'center', paddingBottom: 54, paddingHorizontal: 20 },
  logo: { width: 86, height: 50 },
  body: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 24 },
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
  toolsSection: { marginTop: 31 },
  toolsSurface: { marginTop: 0 },
  toolRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 9 },
  toolIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  offline: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 14, borderWidth: 1, borderRadius: 14, padding: 11 },
  offlineText: { flex: 1, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});
