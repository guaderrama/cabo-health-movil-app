import { useCallback } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Network from 'expo-network';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BrandedBackground, StatusBarScrim } from '../../components';
import { config } from '../../constants';
import { classifyMiniappNavigation } from '../../features/launch/navigationPolicy';
import { usePreferences, useTheme, useTranslations } from '../../hooks';
import type { ThemeMode } from '../../hooks';
import type { AppLanguage } from '../../i18n/messages';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme, setTheme } = useTheme();
  const {
    language,
    hapticsEnabled,
    reducedEffectsOverride,
    setLanguage,
    setHapticsEnabled,
    setReducedEffectsOverride,
    triggerHaptic,
  } = usePreferences();
  const { t } = useTranslations();

  const selectTheme = useCallback(async (nextTheme: ThemeMode) => {
    if (await setTheme(nextTheme)) triggerHaptic('selection');
  }, [setTheme, triggerHaptic]);

  const openUrl = useCallback(async (url: string) => {
    const decision = classifyMiniappNavigation({
      slug: 'healthy-recipes',
      url,
      platform: Platform.OS,
      navigationType: 'click',
      isTopFrame: true,
      isPopup: false,
    });
    if (decision.decision !== 'open-external') {
      Alert.alert(t('common.error'), t('settings.openLinkError'));
      return;
    }
    try {
      const state = await Network.getNetworkStateAsync();
      if (state.isConnected === false || state.isInternetReachable === false) {
        Alert.alert(t('common.offline'), t('settings.openLinkError'));
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('common.error'), t('settings.openLinkError'));
    }
  }, [t]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BrandedBackground moleculeOpacity={0.32} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>

      <SettingsSection title={t('settings.languageSection')}>
        <Text style={[styles.itemTitle, { color: colors.text }]}>{t('settings.language')}</Text>
        <ChoiceRow
          options={[
            { value: 'en', label: t('settings.languageEnglish') },
            { value: 'es-MX', label: t('settings.languageSpanish') },
          ]}
          selected={language}
          onSelect={(value) => setLanguage(value as AppLanguage)}
        />
      </SettingsSection>

      <SettingsSection title={t('settings.appearanceSection')}>
        <Text style={[styles.itemTitle, { color: colors.text }]}>{t('settings.theme')}</Text>
        <ChoiceRow
          options={[
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
            { value: 'system', label: t('settings.themeSystem') },
          ]}
          selected={theme}
          onSelect={(value) => selectTheme(value as ThemeMode)}
        />
      </SettingsSection>

      <SettingsSection title={t('settings.generalSection')}>
        <ToggleRow
          icon="hand-left-outline"
          title={t('settings.haptics')}
          subtitle={hapticsEnabled ? t('settings.hapticsOn') : t('settings.hapticsOff')}
          value={hapticsEnabled}
          onValueChange={setHapticsEnabled}
        />
        <Separator />
        <ToggleRow
          icon="sparkles-outline"
          title={t('settings.reducedEffects')}
          subtitle={reducedEffectsOverride ? t('settings.reducedEffectsOn') : t('settings.reducedEffectsOff')}
          value={reducedEffectsOverride}
          onValueChange={setReducedEffectsOverride}
        />
        <Separator />
        <LinkRow
          icon="refresh-circle-outline"
          title={t('settings.replayIntro')}
          onPress={() => router.push({ pathname: '/', params: { replay: '1' } })}
        />
      </SettingsSection>

      <SettingsSection title={t('settings.informationSection')}>
        <LinkRow icon="shield-checkmark-outline" title={t('settings.privacy')} onPress={() => openUrl(config.urls.privacy)} />
        <Separator />
        <LinkRow icon="document-text-outline" title={t('settings.terms')} onPress={() => openUrl(config.urls.terms)} />
        <Separator />
        <LinkRow icon="help-circle-outline" title={t('settings.support')} onPress={() => openUrl(config.urls.support)} />
        <Separator />
        <LinkRow icon="flag-outline" title={t('settings.reportContent')} onPress={() => openUrl(config.urls.reportContent)} />
      </SettingsSection>

        <View style={styles.appInfo}>
          <Text style={[styles.appName, { color: colors.text }]}>CaboHealth</Text>
          <Text style={[styles.version, { color: colors.textSecondary }]}>v{config.app.version}</Text>
        </View>
      </ScrollView>
      <StatusBarScrim />
    </View>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <View style={[styles.sectionRule, { backgroundColor: colors.accent }]} />
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>{title}</Text>
      </View>
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: colors.editorialSurface,
            borderColor: colors.editorialBorder,
            shadowColor: colors.text,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function ChoiceRow({
  options,
  selected,
  onSelect,
}: {
  options: readonly { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, checked: active }}
            onPress={() => onSelect(option.value)}
            style={[
              styles.choice,
              {
                backgroundColor: active ? colors.primary : colors.editorialSurfaceMuted,
                borderColor: active ? colors.primary : colors.editorialBorder,
              },
            ]}
          >
            <Text style={[styles.choiceText, { color: active ? colors.onPrimary : colors.text }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <SettingIcon icon={icon} />
      <View style={styles.rowText}>
        <Text style={[styles.itemTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </View>
  );
}

function LinkRow({ icon, title, subtitle, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <SettingIcon icon={icon} />
      <View style={styles.rowText}>
        <Text style={[styles.linkTitle, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

function SettingIcon({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useTheme();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.rowIcon,
        {
          backgroundColor: colors.editorialCover,
          borderColor: colors.editorialBorder,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
    </View>
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={[styles.separator, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 34 },
  title: { fontFamily: 'Georgia', fontSize: 31, lineHeight: 37, fontWeight: '600', marginBottom: 8 },
  section: { marginTop: 18 },
  sectionHeading: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7, marginLeft: 4 },
  sectionRule: { width: 18, height: 1 },
  sectionTitle: { fontSize: 11, lineHeight: 16, fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase' },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    padding: 12,
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  itemTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  itemSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  choice: { flexGrow: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  choiceText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 7 },
  rowIcon: { width: 38, height: 38, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  linkTitle: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
  pressed: { opacity: 0.65 },
  appInfo: { alignItems: 'center', paddingVertical: 28 },
  appName: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  version: { fontSize: 12, lineHeight: 17, marginTop: 3 },
});
