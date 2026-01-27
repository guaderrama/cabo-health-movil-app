// app/(main)/settings.tsx
// Settings Screen - Configuración de la app con Dark Mode Premium

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useBiometry, getBiometryTypeName, getBiometryIcon, useTheme } from '../../hooks';
import { layout, config } from '../../constants';
import type { ThemeMode } from '../../hooks';
import { clearStoredCode, getStoredClientName } from '../../services/accessCode';

// Número de taps para acceso admin
const ADMIN_TAP_COUNT = 5;

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
      {showChevron && (
        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
  );
}

// Componente para selección de tema
function ThemeSelector({ colors, theme, setTheme }: { colors: any; theme: ThemeMode; setTheme: (t: ThemeMode) => void }) {
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
          <Text
            style={[
              styles.themeOptionText,
              { color: theme === option.value ? colors.white : colors.text },
            ]}
          >
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
  const {
    isAvailable: biometryAvailable,
    biometryType,
    isEnabled: biometryEnabled,
    enableBiometry,
    disableBiometry,
    authenticate,
    resetAuthentication,
  } = useBiometry();

  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [cacheSize, setCacheSize] = useState('0 KB');
  const [clientName, setClientName] = useState<string | null>(null);

  // Estado para acceso admin secreto
  const [adminTapCount, setAdminTapCount] = useState(0);
  const adminTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (adminTapTimeout.current) {
        clearTimeout(adminTapTimeout.current);
      }
    };
  }, []);

  // Handler para tap secreto en versión
  const handleVersionTap = useCallback(() => {
    // Limpiar timeout anterior
    if (adminTapTimeout.current) {
      clearTimeout(adminTapTimeout.current);
    }

    const newCount = adminTapCount + 1;
    setAdminTapCount(newCount);

    // Feedback sutil
    if (newCount >= 3) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    // Si llegó a los taps necesarios, ir a admin
    if (newCount >= ADMIN_TAP_COUNT) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdminTapCount(0);
      router.push('/(main)/admin');
      return;
    }

    // Resetear contador después de 2 segundos de inactividad
    adminTapTimeout.current = setTimeout(() => {
      setAdminTapCount(0);
    }, 2000);
  }, [adminTapCount, router]);

  // Cargar preferencias
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const haptic = await AsyncStorage.getItem(config.storageKeys.hapticEnabled);
        setHapticEnabled(haptic !== 'false');

        // Cargar nombre del cliente
        const storedClientName = await getStoredClientName();
        setClientName(storedClientName);

        // Calcular tamaño de caché (aproximado)
        const cachedApps = await AsyncStorage.getItem(config.storageKeys.cachedApps);
        const favorites = await AsyncStorage.getItem(config.storageKeys.favorites);
        const totalSize = (cachedApps?.length || 0) + (favorites?.length || 0);
        setCacheSize(totalSize > 1024 ? `${(totalSize / 1024).toFixed(1)} KB` : `${totalSize} bytes`);
      } catch (error) {
        console.error('Error loading preferences:', error);
      }
    };

    loadPreferences();
  }, []);

  // Toggle biometría
  const handleBiometryToggle = useCallback(async (value: boolean) => {
    if (value) {
      // Turning ON - authenticate first
      const success = await authenticate();
      if (success) {
        await enableBiometry();
        Alert.alert('Enabled', 'Biometric authentication is now enabled.');
      }
    } else {
      // Turning OFF - confirm then disable
      Alert.alert(
        'Disable Security',
        'Are you sure you want to disable biometric authentication?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              await disableBiometry();
              Alert.alert('Disabled', 'Biometric authentication has been disabled.');
            },
          },
        ]
      );
    }
  }, [authenticate, enableBiometry, disableBiometry]);

  // Toggle haptic
  const handleHapticToggle = useCallback(async (value: boolean) => {
    setHapticEnabled(value);
    await AsyncStorage.setItem(config.storageKeys.hapticEnabled, value.toString());
    if (value) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  // Clear cache
  const handleClearCache = useCallback(() => {
    Alert.alert(
      'Clear Cache',
      'This will delete locally saved data. Apps will be reloaded from the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem(config.storageKeys.cachedApps);
              setCacheSize('0 bytes');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Cache Cleared', 'Local data has been deleted.');
            } catch (error) {
              console.error('Error clearing cache:', error);
              Alert.alert('Error', 'Could not clear cache.');
            }
          },
        },
      ]
    );
  }, []);

  // Reset favorites
  const handleResetFavorites = useCallback(() => {
    Alert.alert(
      'Reset Favorites',
      'Are you sure you want to delete all your favorites?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem(config.storageKeys.favorites);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Favorites Deleted', 'Your favorites have been reset.');
            } catch (error) {
              console.error('Error resetting favorites:', error);
            }
          },
        },
      ]
    );
  }, []);

  // Open support
  const handleSupport = useCallback(() => {
    Linking.openURL('mailto:ivan@ivanguaderrama.com?subject=CaboHealth%20Support');
  }, []);

  // Logout - clear access code and reset authentication state
  const handleLogout = useCallback(() => {
    Alert.alert(
      'Log Out',
      'Your access code will be removed and you will need to enter it again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearStoredCode();
              resetAuthentication(); // Reset biometry authentication state
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.replace('/');
            } catch (error) {
              console.error('Error logging out:', error);
              Alert.alert('Error', 'Could not log out.');
            }
          },
        },
      ]
    );
  }, [router, resetAuthentication]);

  const biometryName = getBiometryTypeName(biometryType);
  const biometryIcon = getBiometryIcon(biometryType) as keyof typeof Ionicons.glyphMap;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.cardBackground }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Section: Appearance */}
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

        {/* Section: Security */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Security</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            {biometryAvailable ? (
              <SettingItem
                icon={biometryIcon}
                iconColor={colors.primary}
                title={biometryName}
                subtitle={biometryEnabled ? 'Enabled' : 'Disabled'}
                colors={colors}
                rightElement={
                  <Switch
                    value={Boolean(biometryEnabled)}
                    onValueChange={handleBiometryToggle}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.white}
                  />
                }
              />
            ) : (
              <SettingItem
                icon="lock-closed-outline"
                iconColor={colors.textTertiary}
                title="Biometry not available"
                subtitle="Your device does not support biometric authentication"
                colors={colors}
              />
            )}
          </View>
        </View>

        {/* Section: General */}
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
                  value={Boolean(hapticEnabled)}
                  onValueChange={handleHapticToggle}
                  trackColor={{ false: colors.border, true: colors.success }}
                  thumbColor={colors.white}
                />
              }
            />
          </View>
        </View>

        {/* Section: Data */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Data</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            <SettingItem
              icon="trash-outline"
              iconColor={colors.warning}
              title="Clear Cache"
              subtitle={`Current size: ${cacheSize}`}
              onPress={handleClearCache}
              showChevron
              colors={colors}
            />
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
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

        {/* Section: Support */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Support</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            <SettingItem
              icon="mail-outline"
              iconColor={colors.info}
              title="Contact Support"
              subtitle="ivan@ivanguaderrama.com"
              onPress={handleSupport}
              showChevron
              colors={colors}
            />
          </View>
        </View>

        {/* Section: Account */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Account</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.cardBackground }]}>
            {clientName && (
              <>
                <SettingItem
                  icon="person-outline"
                  iconColor={colors.primary}
                  title="Client"
                  subtitle={clientName}
                  colors={colors}
                />
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
              </>
            )}
            <SettingItem
              icon="log-out-outline"
              iconColor={colors.error}
              title="Log Out"
              subtitle="Remove access code"
              onPress={handleLogout}
              showChevron
              colors={colors}
            />
          </View>
        </View>

        {/* App info - Tap 5 times on version for admin access */}
        <View style={styles.appInfo}>
          <Text style={[styles.appName, { color: colors.text }]}>{config.app.name}</Text>
          <TouchableOpacity onPress={handleVersionTap} activeOpacity={0.7}>
            <Text style={[styles.appVersion, { color: colors.textSecondary }]}>
              Version {config.app.version}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.appCopyright, { color: colors.textTertiary }]}>© 2024 CaboHealth</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.spacing.lg,
    paddingVertical: layout.spacing.md,
    borderBottomWidth: 1,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: layout.fontSize.md,
  },
  title: {
    fontSize: layout.fontSize.lg,
    fontWeight: layout.fontWeight.semibold,
  },
  headerSpacer: {
    width: 70,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: layout.spacing.lg,
  },
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
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: layout.spacing.md,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: layout.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: layout.spacing.md,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: layout.fontSize.md,
    fontWeight: layout.fontWeight.medium,
  },
  settingSubtitle: {
    fontSize: layout.fontSize.sm,
    marginTop: 2,
  },
  separator: {
    height: 1,
    marginLeft: 52 + layout.spacing.md,
  },
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
  themeOptionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: layout.spacing.xxl,
    marginTop: layout.spacing.lg,
  },
  appName: {
    fontSize: layout.fontSize.lg,
    fontWeight: layout.fontWeight.bold,
    marginBottom: layout.spacing.xs,
  },
  appVersion: {
    fontSize: layout.fontSize.sm,
    marginBottom: layout.spacing.xs,
  },
  appCopyright: {
    fontSize: layout.fontSize.xs,
  },
});
