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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { useTheme, useTranslations } from '../../hooks';
import type { ClientResourceLaunch } from './clientAccessController';
import {
  classifyClientResourceNavigation,
  getClientResourceWebViewPolicyProps,
} from './clientResourceNavigation';

export function ClientResourceWebView({
  launch,
  title,
  onClose,
}: {
  launch: Readonly<ClientResourceLaunch>;
  title: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslations();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showUnavailable = useCallback(() => {
    setLoading(false);
    setErrorMessage(t('clientAccess.launchUnavailable'));
  }, [t]);

  const handleNavigationRequest = useCallback((request: ShouldStartLoadRequest) => {
    const decision = classifyClientResourceNavigation(request.url);
    if (decision.decision === 'allow') return true;
    setLoading(false);
    setErrorMessage(t('clientAccess.navigationBlocked'));
    return false;
  }, [t]);

  const handleLoadError = useCallback((_event: WebViewErrorEvent) => {
    showUnavailable();
  }, [showUnavailable]);

  const handleHttpError = useCallback((event: WebViewHttpErrorEvent) => {
    if (event.nativeEvent.statusCode >= 400) showUnavailable();
  }, [showUnavailable]);

  const policyProps = getClientResourceWebViewPolicyProps(
    launch.source,
    handleNavigationRequest,
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 8),
            backgroundColor: colors.cardBackground,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={25} color={colors.primary} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.text }]}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <WebView
          cacheEnabled={false}
          incognito
          onError={handleLoadError}
          onHttpError={handleHttpError}
          onLoadEnd={() => setLoading(false)}
          onLoadStart={() => {
            setLoading(true);
            setErrorMessage(null);
          }}
          style={styles.webview}
          {...policyProps}
        />

        {loading && !errorMessage && (
          <View style={[styles.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              {t('clientAccess.openingResource')}
            </Text>
          </View>
        )}

        {errorMessage && (
          <View
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={[styles.errorOverlay, { backgroundColor: colors.background }]}
          >
            <ScrollView contentContainerStyle={styles.errorContent}>
              <Ionicons name="shield-outline" size={54} color={colors.error} />
              <Text style={[styles.errorTitle, { color: colors.text }]}>{t('common.error')}</Text>
              <Text style={[styles.errorBody, { color: colors.textSecondary }]}>{errorMessage}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.returnButton,
                  { backgroundColor: colors.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.returnLabel, { color: colors.white }]}>
                  {t('clientAccess.backToResources')}
                </Text>
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
  header: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 48, height: 48 },
  title: { flex: 1, height: 48, textAlign: 'center', textAlignVertical: 'center', paddingTop: 13, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  content: { flex: 1 },
  webview: { flex: 1 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, lineHeight: 20 },
  errorOverlay: { ...StyleSheet.absoluteFillObject },
  errorContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  errorTitle: { marginTop: 14, textAlign: 'center', fontFamily: 'Georgia', fontSize: 22, lineHeight: 28, fontWeight: '600' },
  errorBody: { maxWidth: 330, marginTop: 8, textAlign: 'center', fontSize: 14, lineHeight: 21 },
  returnButton: { minHeight: 48, marginTop: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  returnLabel: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  pressed: { opacity: 0.76 },
});
