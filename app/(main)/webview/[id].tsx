// app/(main)/webview/[id].tsx
// WebView Screen - CaboHealth Brand

import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import type { WebViewErrorEvent, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWebApps, useFavorites } from '../../../hooks';
import { colors } from '../../../constants';

export default function WebViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);

  const { apps } = useWebApps();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const app = apps.find((a) => a.id === id);
  const url = app?.url;
  const title = app?.name || 'Loading...';

  // Handle WebView errors
  const handleError = (event: WebViewErrorEvent) => {
    const { nativeEvent } = event;
    console.error('WebView error:', nativeEvent);
    setError(nativeEvent.description || 'Failed to load page');
    setLoading(false);
  };

  // Handle HTTP errors (4xx, 5xx)
  const handleHttpError = (event: WebViewHttpErrorEvent) => {
    const { nativeEvent } = event;
    console.error('WebView HTTP error:', nativeEvent.statusCode, nativeEvent.url);
    if (nativeEvent.statusCode >= 400) {
      setError(`HTTP Error ${nativeEvent.statusCode}`);
    }
  };

  // Retry loading
  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setProgress(0);
    webViewRef.current?.reload();
  };
  const appIsFavorite = id ? isFavorite(id) : false;

  const handleShare = async () => {
    if (!app) return;
    try {
      await Share.share({
        title: app.name,
        message: `${app.name}: ${app.url}`,
        url: app.url,
      });
    } catch (e) {
      console.error('Share error:', e);
    }
  };

  const handleNavStateChange = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    setCanGoForward(nav.canGoForward);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backText}>Volver</Text>
        </TouchableOpacity>

        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => id && toggleFavorite(id)}>
            <Ionicons
              name={appIsFavorite ? 'star' : 'star-outline'}
              size={22}
              color={appIsFavorite ? colors.favorite : colors.primary}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
            <Ionicons name="share-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => webViewRef.current?.reload()}>
            <Ionicons name="refresh" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress Bar */}
      {loading && progress < 1 && (
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
        </View>
      )}

      {/* Error State */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={64} color={colors.error} />
          <Text style={styles.errorTitle}>Failed to load</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Ionicons name="refresh" size={20} color={colors.white} />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* App Not Found */}
      {!url && !error && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.warning} />
          <Text style={styles.errorTitle}>App not found</Text>
          <Text style={styles.errorMessage}>This app may have been removed.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={colors.white} />
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* WebView */}
      {url && !error && (
        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          style={styles.webview}
          onLoadStart={() => { setLoading(true); setError(null); }}
          onLoadProgress={(e) => setProgress(e.nativeEvent.progress)}
          onLoadEnd={() => { setLoading(false); setProgress(1); }}
          onNavigationStateChange={handleNavStateChange}
          onError={handleError}
          onHttpError={handleHttpError}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowsBackForwardNavigationGestures={true}
          allowsInlineMediaPlayback={true}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        />
      )}

      {/* Bottom Bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => webViewRef.current?.goBack()}
          disabled={!canGoBack}
        >
          <Ionicons name="chevron-back" size={28} color={canGoBack ? colors.primary : colors.disabled} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => webViewRef.current?.goForward()}
          disabled={!canGoForward}
        >
          <Ionicons name="chevron-forward" size={28} color={canGoForward ? colors.primary : colors.disabled} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={() => webViewRef.current?.reload()}>
          <Ionicons name="refresh" size={24} color={colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={handleShare}>
          <Ionicons
            name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'}
            size={24}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cardBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 54,
    paddingBottom: 10,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 70,
  },
  backText: {
    fontSize: 17,
    color: colors.primary,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerActions: {
    flexDirection: 'row',
    minWidth: 70,
    justifyContent: 'flex-end',
  },
  actionBtn: {
    padding: 6,
    marginLeft: 2,
  },
  progressContainer: {
    height: 3,
    backgroundColor: colors.border,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  webview: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 8,
    paddingBottom: 34,
    backgroundColor: colors.cardBackground,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  navBtn: {
    padding: 10,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.background,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
