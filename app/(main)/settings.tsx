import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks';
import type { ThemeMode } from '../../hooks';
import { config, layout } from '../../constants';
import { setFavoriteSnapshot } from '../../features/catalog/publicCatalogState';

interface SettingItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  showChevron?: boolean;
  colors: any;
}

function SettingItem({
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
  rightElement,
  showChevron = false,
  colors,
}: SettingItemProps) {
  const effectiveIconColor = iconColor || colors.primary;

  return (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      disabled={!onPress && !rightElement}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[styles.iconContainer, { backgroundColor: effectiveIconColor + '20' }]}>
        <Ionicons name={icon} size={22} color={effectiveIconColor} />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingTitle, { color: colors.text }]}>{title}</Text>
        {subtitle && <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
      </View>
      {rightElement}
      {showChevron && <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />}
    </TouchableOpacity>
  );
}

function ThemeSelector({ colors, theme, setTheme }: { colors: any; theme: ThemeMode; setTheme: (theme: ThemeMode) => void }) {
  const options: { value: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'light', label: 'Light', icon: 'sunny-outline' },
    { value: 'dark', label: 'Dark', icon: 'moon-outline' },
    { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  ];

  return (
    <View style={styles.themeSelector}>
      {options.map((option) => (
        <TouchableOpacity
          key={option.value}
          style={[
            styles.themeOption,
            {
              backgroundColor: theme === option.value ? colors.primary : colors.cardBackground,
              borderColor: theme === option.value ? colors.primary : colors.border,
            },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setTheme(option.value);
          }}
        >
          <Ionicons
            name={option.icon}
            size={20}
            color={theme === option.value ? colors.white : colors.textSecondary}
          />
          <Text style={[styles.themeOptionText, { color: theme === option.value ? colors.white : colors.text }]}>
            {option.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, theme, setTheme, isDark } = useTheme();
  const [hapticEnabled, setHapticEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(config.storageKeys.hapticEnabled)
      .then((haptic) => setHapticEnabled(haptic !== 'false'))
      .catch(() => setHapticEnabled(true));
  }, []);

  const handleHapticToggle = useCallback(async (value: boolean) => {
    setHapticEnabled(value);
    await AsyncStorage.setItem(config.storageKeys.hapticEnabled, value.toString());
    if (value) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleResetFavorites = useCallback(() => {
    Alert.alert('Reset Favorites', 'Are you sure you want to delete all your favorites?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.removeItem(config.storageKeys.favorites);
            setFavoriteSnapshot([]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Favorites Deleted', 'Your favorites have been reset.');
          } catch {
            Alert.alert('Error', 'Could not reset favorites.');
          }
        },
      },
    ]);
  }, []);

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open this page.'));
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.cardBackground }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Appearance</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            <View style={styles.settingItem}>
              <View style={[styles.iconContainer, { backgroundColor: colors.accent + '20' }]}>
                <Ionicons name={isDark ? 'moon' : 'sunny'} size={22} color={colors.accent} />
              </View>
              <View style={styles.settingContent}>
                <Text style={[styles.settingTitle, { color: colors.text }]}>Theme</Text>
                <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>
                  {theme === 'light' ? 'Light mode' : theme === 'dark' ? 'Dark mode' : 'Auto'}
                </Text>
              </View>
            </View>
            <ThemeSelector colors={colors} theme={theme} setTheme={setTheme} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>General</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            <SettingItem
              icon="hand-left-outline"
              iconColor={colors.success}
              title="Haptic Feedback"
              subtitle={hapticEnabled ? 'Vibrations enabled' : 'Vibrations disabled'}
              colors={colors}
              rightElement={
                <Switch
                  value={hapticEnabled}
                  onValueChange={handleHapticToggle}
                  trackColor={{ false: colors.border, true: colors.success }}
                  thumbColor={colors.white}
                />
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Saved</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            <SettingItem
              icon="star-outline"
              iconColor={colors.error}
              title="Reset Favorites"
              subtitle="Delete all favorites"
              onPress={handleResetFavorites}
              showChevron
              colors={colors}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Information</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            <SettingItem icon="help-circle-outline" title="Support" onPress={() => openUrl(config.urls.support)} showChevron colors={colors} />
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
            <SettingItem icon="shield-checkmark-outline" title="Privacy" onPress={() => openUrl(config.urls.privacy)} showChevron colors={colors} />
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
            <SettingItem icon="document-text-outline" title="Terms" onPress={() => openUrl(config.urls.terms)} showChevron colors={colors} />
          </View>
        </View>

        <View style={styles.appInfo}>
          <Text style={[styles.appName, { color: colors.text }]}>{config.app.name}</Text>
          <Text style={[styles.appVersion, { color: colors.textSecondary }]}>Version {config.app.version}</Text>
          <Text style={[styles.appCopyright, { color: colors.textTertiary }]}>© 2026 CaboHealth</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.spacing.lg,
    paddingVertical: layout.spacing.md,
    borderBottomWidth: 1,
  },
  backButton: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: layout.fontSize.md },
  title: { fontSize: layout.fontSize.lg, fontWeight: layout.fontWeight.semibold },
  headerSpacer: { width: 70 },
  scrollView: { flex: 1 },
  section: { marginTop: layout.spacing.lg },
  sectionTitle: {
    fontSize: layout.fontSize.sm,
    fontWeight: layout.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginHorizontal: layout.spacing.lg,
    marginBottom: layout.spacing.sm,
  },
  sectionContent: {
    marginHorizontal: layout.spacing.lg,
    borderRadius: layout.borderRadius.lg,
    ...layout.shadow.sm,
  },
  settingItem: { flexDirection: 'row', alignItems: 'center', padding: layout.spacing.md },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: layout.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: layout.spacing.md,
  },
  settingContent: { flex: 1 },
  settingTitle: { fontSize: layout.fontSize.md, fontWeight: layout.fontWeight.medium },
  settingSubtitle: { fontSize: layout.fontSize.sm, marginTop: 2 },
  separator: { height: 1, marginLeft: 52 + layout.spacing.md },
  themeSelector: {
    flexDirection: 'row',
    paddingHorizontal: layout.spacing.md,
    paddingBottom: layout.spacing.md,
    gap: 8,
  },
  themeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  themeOptionText: { fontSize: 13, fontWeight: '600' },
  appInfo: { alignItems: 'center', paddingVertical: layout.spacing.xxl, marginTop: layout.spacing.lg },
  appName: { fontSize: layout.fontSize.lg, fontWeight: layout.fontWeight.bold, marginBottom: layout.spacing.xs },
  appVersion: { fontSize: layout.fontSize.sm, marginBottom: layout.spacing.xs },
  appCopyright: { fontSize: layout.fontSize.xs },
});
