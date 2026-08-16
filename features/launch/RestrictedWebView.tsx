import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';
import type { PublicMiniapp } from '../../constants/publicMiniapps';
import { useFavorites, useTheme, useTranslations } from '../../hooks';
import { classifyMiniappNavigation } from './navigationPolicy';
import {
  applyNavigationDecision,
  applyPopupNavigation,
  getRestrictedSharePayload,
  getRestrictedWebViewSource,
  handleRestrictedWebViewBack,
  RESTRICTED_WEBVIEW_SECURITY_PROPS,
} from './restrictedWebViewBehavior';

export function RestrictedWebView({
  miniapp,
}: {
  miniapp: Readonly<PublicMiniapp>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const title = language === 'es-MX' ? miniapp.title.es : miniapp.title.en;

  const showGenericError = useCallback(() => {
    setLoading(false);
    setErrorMessage(t('settings.openLinkError'));
  }, [t]);

  const openExternal = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      showGenericError();
    }
  }, [showGenericError]);

  const handleNavigationRequest = useCallback((request: ShouldStartLoadRequest) => {
    const result = classifyMiniappNavigation({
      slug: miniapp.slug,
      url: request.url,
      platform: Platform.OS,
      navigationType: request.navigationType,
      isTopFrame: request.isTopFrame,
      isPopup: false,
    });

    return applyNavigationDecision(result, request.url, {
      openExternal,
      showError: showGenericError,
    });
  }, [miniapp.slug, openExternal, showGenericError]);

  const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    applyPopupNavigation({
      slug: miniapp.slug,
      targetUrl: event.nativeEvent.targetUrl,
      platform: Platform.OS,
      effects: {
        openExternal,
        showError: showGenericError,
      },
    });
  }, [miniapp.slug, openExternal, showGenericError]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setLoading(true);
    setProgress(0);
    setCanGoBack(false);
    setCanGoForward(false);
    setReloadKey((current) => current + 1);
  }, []);

  const handleShare = useCallback(async () => {
    try {
      await Share.share(getRestrictedSharePayload(miniapp, title));
    } catch {
      showGenericError();
    }
  }, [miniapp, showGenericError, title]);

  const handleHeaderBack = useCallback(() => {
    handleRestrictedWebViewBack(router);
  }, [router]);

  const handleNavigationStateChange = useCallback((navigation: WebViewNavigation) => {
    setCanGoBack(navigation.canGoBack);
    setCanGoForward(navigation.canGoForward);
  }, []);

  const handleLoadError = useCallback((_event: WebViewErrorEvent) => {
    showGenericError();
  }, [showGenericError]);

  const handleHttpError = useCallback((event: WebViewHttpErrorEvent) => {
    if (event.nativeEvent.statusCode >= 400) showGenericError();
  }, [showGenericError]);

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
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.text }]}>
          {title}
        </Text>
        <View style={styles.headerActions}>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.share')}
            hitSlop={6}
            onPress={handleShare}
            style={styles.headerButton}
          >
            <Ionicons name="share-outline" size={22} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.content}>
        {loading && progress < 1 && (
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.progress, { backgroundColor: colors.accent, width: `${progress * 100}%` }]} />
          </View>
        )}

        <WebView
          key={`${miniapp.slug}:${reloadKey}`}
          ref={webViewRef}
          source={getRestrictedWebViewSource(miniapp)}
          style={styles.webview}
          onShouldStartLoadWithRequest={handleNavigationRequest}
          onOpenWindow={handleOpenWindow}
          onLoadStart={() => {
            setLoading(true);
            setErrorMessage(null);
          }}
          onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
          onLoadEnd={() => {
            setLoading(false);
            setProgress(1);
          }}
          onNavigationStateChange={handleNavigationStateChange}
          onError={handleLoadError}
          onHttpError={handleHttpError}
          allowsBackForwardNavigationGestures
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loading, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
          {...RESTRICTED_WEBVIEW_SECURITY_PROPS}
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

      <View
        style={[
          styles.toolbar,
          {
            paddingBottom: Math.max(insets.bottom, 8),
            backgroundColor: colors.cardBackground,
            borderTopColor: colors.border,
          },
        ]}
      >
        <ToolbarButton
          disabled={!canGoBack}
          icon="chevron-back"
          label={t('common.back')}
          onPress={() => webViewRef.current?.goBack()}
        />
        <ToolbarButton
          disabled={!canGoForward}
          icon="chevron-forward"
          label={t('common.forward')}
          onPress={() => webViewRef.current?.goForward()}
        />
        <ToolbarButton icon="refresh" label={t('common.retry')} onPress={handleRetry} />
        <ToolbarButton icon="share-outline" label={t('common.share')} onPress={handleShare} />
      </View>
    </View>
  );
}

function ToolbarButton({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={styles.toolbarButton}
    >
      <Ionicons name={icon} size={25} color={disabled ? colors.disabled : colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, paddingHorizontal: 4 },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minHeight: 44, textAlign: 'center', textAlignVertical: 'center', fontSize: 16, lineHeight: 21, fontWeight: '700', paddingTop: 11 },
  headerActions: { flexDirection: 'row' },
  progressTrack: { height: 3 },
  progress: { height: 3 },
  webview: { flex: 1 },
  loading: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  errorOverlay: { position: 'absolute', inset: 0 },
  errorScrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  errorTitle: { marginTop: 14, fontSize: 20, lineHeight: 26, fontWeight: '700', textAlign: 'center' },
  errorBody: { marginTop: 7, maxWidth: 320, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retryButton: { minHeight: 44, marginTop: 22, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  retryText: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  toolbar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderTopWidth: 1, paddingTop: 4 },
  toolbarButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
