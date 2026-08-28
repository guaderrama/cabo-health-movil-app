import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';
import type { ExternalHttpsCatalogPublicMiniapp } from '../../constants/publicMiniapps';
import { useFavorites, useTheme, useTranslations } from '../../hooks';
import {
  applyExternalHttpsNavigationDecision,
  classifyExternalHttpsNavigation,
  getExternalHttpsWebViewPolicyProps,
  handleExternalPopup,
} from './externalHttpsNavigationPolicy';
import { handleRestrictedWebViewBack } from './restrictedWebViewBehavior';

export function ExternalHttpsWebView({
  miniapp,
}: {
  miniapp: Readonly<ExternalHttpsCatalogPublicMiniapp>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const title = language === 'es-MX' ? miniapp.title.es : miniapp.title.en;

  const showGenericError = useCallback(() => {
    setLoading(false);
    setErrorMessage(t('settings.openLinkError'));
  }, [t]);

  const handleNavigationRequest = useCallback((request: ShouldStartLoadRequest) => (
    applyExternalHttpsNavigationDecision(
      classifyExternalHttpsNavigation(request.url, miniapp.destinationOrigin),
      { showError: showGenericError },
    )
  ), [miniapp.destinationOrigin, showGenericError]);

  const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    handleExternalPopup(event.nativeEvent.targetUrl, { showError: showGenericError });
  }, [showGenericError]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setLoading(true);
    setProgress(0);
    setReloadKey((current) => current + 1);
  }, []);

  const handleHeaderBack = useCallback(() => {
    handleRestrictedWebViewBack(router);
  }, [router]);

  const handleLoadError = useCallback((_event: WebViewErrorEvent) => {
    showGenericError();
  }, [showGenericError]);

  const handleHttpError = useCallback((event: WebViewHttpErrorEvent) => {
    if (event.nativeEvent.statusCode >= 400) showGenericError();
  }, [showGenericError]);

  const externalHttpsWebViewPolicyProps = getExternalHttpsWebViewPolicyProps({
    canonicalUrl: miniapp.destinationUrl,
    origin: miniapp.destinationOrigin,
  }, {
    onShouldStartLoadWithRequest: handleNavigationRequest,
    onOpenWindow: handleOpenWindow,
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top,
            backgroundColor: colors.cardBackground,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={handleHeaderBack}
          style={styles.headerButton}
        >
          <Ionicons name="chevron-back" size={25} color={colors.primary} />
        </Pressable>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.title, { color: colors.text }]}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFavorite(miniapp.slug) ? t('catalog.removeSaved') : t('catalog.save')}
          hitSlop={6}
          onPress={() => toggleFavorite(miniapp.slug)}
          style={styles.headerButton}
        >
          <Ionicons
            name={isFavorite(miniapp.slug) ? 'star' : 'star-outline'}
            size={22}
            color={isFavorite(miniapp.slug) ? colors.favorite : colors.primary}
          />
        </Pressable>
      </View>

      <View style={styles.content}>
        {loading && progress < 1 && (
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progress,
                { backgroundColor: colors.accent, width: `${progress * 100}%` },
              ]}
            />
          </View>
        )}

        <WebView
          key={`${miniapp.slug}:${reloadKey}`}
          style={styles.webview}
          onLoadStart={() => {
            setLoading(true);
            setErrorMessage(null);
          }}
          onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
          onLoadEnd={() => {
            setLoading(false);
            setProgress(1);
          }}
          onError={handleLoadError}
          onHttpError={handleHttpError}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loading, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
          {...externalHttpsWebViewPolicyProps}
        />

        {errorMessage && (
          <View
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={[styles.errorOverlay, { backgroundColor: colors.background }]}
          >
            <ScrollView
              contentContainerStyle={styles.errorScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Ionicons name="cloud-offline-outline" size={58} color={colors.error} />
              <Text style={[styles.errorTitle, { color: colors.text }]}>{t('common.error')}</Text>
              <Text style={[styles.errorBody, { color: colors.textSecondary }]}>{errorMessage}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleRetry}
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="refresh" size={20} color={colors.white} />
                <Text style={[styles.retryText, { color: colors.white }]}>{t('common.retry')}</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    paddingHorizontal: 4,
  },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: {
    flex: 1,
    minHeight: 44,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    paddingTop: 11,
  },
  progressTrack: { height: 3 },
  progress: { height: 3 },
  webview: { flex: 1 },
  loading: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  errorOverlay: { position: 'absolute', inset: 0 },
  errorScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  errorTitle: { marginTop: 14, fontSize: 20, lineHeight: 26, fontWeight: '700', textAlign: 'center' },
  errorBody: { marginTop: 7, maxWidth: 320, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retryButton: {
    minHeight: 44,
    marginTop: 22,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  retryText: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
});
