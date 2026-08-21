import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';
import { useTheme, useTranslations } from '../../hooks';
import { RESTRICTED_WEBVIEW_SECURITY_PROPS } from '../launch/restrictedWebViewBehavior';
import {
  classifyDevMiniappNavigation,
  isDevMiniappPanelEnabled,
  type DevMiniapp,
} from './devMiniappCatalog';

const DEV_MINIAPP_WEBVIEW_SECURITY_PROPS = Object.freeze({
  ...RESTRICTED_WEBVIEW_SECURITY_PROPS,
  // Development previews may target an owner-supplied HTTPS domain that is
  // intentionally not part of the production app-bound domain allowlist.
  limitsNavigationsToAppBoundDomains: false,
});

export function DevMiniappPreview({
  miniapp,
  title,
  onClose,
}: {
  miniapp: Readonly<DevMiniapp> | null;
  title: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslations();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!isDevMiniappPanelEnabled(__DEV__) || !miniapp) return null;

  const block = () => {
    setLoading(false);
    setError(t('devPanel.previewBlocked'));
    return false;
  };

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible onRequestClose={onClose}>
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
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            style={styles.headerButton}
          >
            <Ionicons name="close" size={25} color={colors.primary} />
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          <View style={[styles.badge, { backgroundColor: colors.disabledBackground }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>{t('devPanel.testOnly')}</Text>
          </View>
        </View>

        <View style={styles.content}>
          <WebView
            source={{ uri: miniapp.url }}
            style={styles.webview}
            onLoadStart={() => { setLoading(true); setError(null); }}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setError(t('settings.openLinkError')); }}
            onHttpError={(event: WebViewHttpErrorEvent) => {
              if (event.nativeEvent.statusCode >= 400) {
                setLoading(false);
                setError(t('settings.openLinkError'));
              }
            }}
            onShouldStartLoadWithRequest={(request) => (
              classifyDevMiniappNavigation(miniapp.url, request.url) || block()
            )}
            onOpenWindow={block}
            {...DEV_MINIAPP_WEBVIEW_SECURITY_PROPS}
          />
          {loading && (
            <View style={[styles.overlay, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
          {error && (
            <View accessibilityRole="alert" style={[styles.overlay, { backgroundColor: colors.background }]}>
              <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.text }]}>{error}</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, paddingHorizontal: 4 },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minHeight: 44, paddingTop: 11, textAlign: 'center', textAlignVertical: 'center', fontSize: 16, lineHeight: 21, fontWeight: '700' },
  badge: { minHeight: 28, marginRight: 9, marginBottom: 8, justifyContent: 'center', borderRadius: 999, paddingHorizontal: 7 },
  badgeText: { fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 0.8 },
  content: { flex: 1 },
  webview: { flex: 1 },
  overlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 28 },
  errorText: { maxWidth: 320, marginTop: 14, textAlign: 'center', fontSize: 14, lineHeight: 21 },
});
