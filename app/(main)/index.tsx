// app/(main)/index.tsx
// Home Screen - CaboHealth Brand Premium

import { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWebApps, useFavorites, useTheme } from '../../hooks';
import { AppCard, ErrorScreen, SkeletonGrid, AnimatedMolecules } from '../../components';
import { WebApp } from '../../types';
import { layout } from '../../constants';

export default function HomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { apps, favoriteApps, nonFavoriteApps, isLoading, error, isOffline, refresh } = useWebApps();
  const { toggleFavorite, isFavorite } = useFavorites();

  const handleAppPress = useCallback((app: WebApp) => {
    router.push(`/(main)/webview/${app.id}`);
  }, [router]);

  const handleLongPress = useCallback((app: WebApp) => {
    const currentlyFavorite = isFavorite(app.id);
    Alert.alert(
      currentlyFavorite ? 'Remove from Favorites' : 'Add to Favorites',
      `${currentlyFavorite ? 'Remove' : 'Add'} "${app.name}" ${currentlyFavorite ? 'from' : 'to'} favorites?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: currentlyFavorite ? 'Remove' : 'Add',
          onPress: () => toggleFavorite(app.id),
          style: currentlyFavorite ? 'destructive' : 'default',
        },
      ]
    );
  }, [toggleFavorite, isFavorite]);

  const handleSettingsPress = () => {
    router.push('/(main)/settings');
  };

  const renderAppCard = useCallback(({ item, index }: { item: WebApp; index: number }) => (
    <View style={styles.cardContainer}>
      <AppCard
        app={item}
        onPress={handleAppPress}
        onLongPress={handleLongPress}
        index={favoriteApps.length + index} // Offset by favorites count for proper stagger
      />
    </View>
  ), [handleAppPress, handleLongPress, favoriteApps.length]);

  const renderHeader = () => (
    <View>
      {/* Favorites */}
      {favoriteApps.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.primary }]}>
            Favorites
          </Text>
          <View style={styles.grid}>
            {favoriteApps.map((app, idx) => (
              <View key={app.id} style={styles.cardContainer}>
                <AppCard
                  app={app}
                  onPress={handleAppPress}
                  onLongPress={handleLongPress}
                  index={idx}
                />
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Separator */}
      {favoriteApps.length > 0 && nonFavoriteApps.length > 0 && (
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>
          All Apps
        </Text>
      )}
    </View>
  );

  // Loading - Show skeleton cards
  if (isLoading && apps.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header Premium con Logo Destacado */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientMiddle, colors.gradientEnd]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <View style={styles.logoWrapper}>
              <Text style={styles.logoText}>CABO</Text>
              <Text style={styles.logoTextHealth}>HEALTH</Text>
            </View>
            <Text style={styles.tagline}>Longevity Science Lab</Text>
          </View>
        </LinearGradient>
        <View style={{ marginTop: 16 }}>
          <SkeletonGrid count={6} />
        </View>
      </SafeAreaView>
    );
  }

  // Error sin datos
  if (error && apps.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ErrorScreen message={error} onRetry={refresh} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Animated Molecules Background */}
      <AnimatedMolecules isDark={isDark} />

      {/* Header Premium con Logo Destacado */}
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientMiddle, colors.gradientEnd]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        {/* Settings button - posición absoluta */}
        <TouchableOpacity
          onPress={handleSettingsPress}
          style={styles.settingsButton}
        >
          <Ionicons name="settings-outline" size={22} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>

        {/* Logo centrado con wrapper glassmorphism */}
        <View style={styles.headerContent}>
          <View style={styles.logoWrapper}>
            <Text style={styles.logoText}>CABO</Text>
            <Text style={styles.logoTextHealth}>HEALTH</Text>
          </View>
          <Text style={styles.tagline}>Longevity Science Lab</Text>
        </View>
      </LinearGradient>

      {/* Offline banner */}
      {isOffline && (
        <View style={[styles.offlineBanner, { backgroundColor: colors.warning }]}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.white} />
          <Text style={[styles.offlineText, { color: colors.white }]}> Offline mode - cached data</Text>
        </View>
      )}

      {/* Grid de apps */}
      <FlatList
        data={nonFavoriteApps}
        renderItem={renderAppCard}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="apps-outline" size={48} color={colors.textTertiary} />
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                No apps available
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Header Premium
  headerGradient: {
    paddingTop: 24,
    paddingBottom: 32,  // Reducido - sin overlap
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
  },
  // Logo wrapper glassmorphism
  logoWrapper: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 32,
    fontWeight: '200',  // Ultra light para elegancia
    color: '#FFFFFF',
    letterSpacing: 12,
    lineHeight: 38,
  },
  logoTextHealth: {
    fontSize: 32,
    fontWeight: '800',  // Extra bold para contraste
    color: '#FFFFFF',
    letterSpacing: 6,
    lineHeight: 38,
  },
  tagline: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 3,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  // Settings button premium (outline style)
  settingsButton: {
    position: 'absolute',
    right: 20,
    top: 16,
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,  // Ensure it's above all other elements
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: layout.spacing.sm,
    marginHorizontal: layout.spacing.lg,
    borderRadius: 8,
    marginTop: -layout.spacing.md,
    marginBottom: layout.spacing.sm,
  },
  offlineText: {
    fontSize: layout.fontSize.sm,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 16,  // Espacio limpio sin overlap
    marginTop: 0,    // Sin overlap - transición limpia
  },
  section: {
    marginBottom: 16,
  },
  // Section titles premium
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 16,
    marginLeft: 8,
    marginTop: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  row: {
    justifyContent: 'space-between',
  },
  cardContainer: {
    width: '50%',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: layout.spacing.xxl * 2,
  },
  emptyText: {
    marginTop: layout.spacing.md,
    fontSize: layout.fontSize.md,
  },
});
