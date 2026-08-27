import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandedBackground } from '../../components';
import { useClientAccess } from '../../context/ClientAccessContext';
import { useTheme, useTranslations } from '../../hooks';
import type { ClientResourceLaunch } from '../../features/clientAccess/clientAccessController';
import {
  getClientResourceRouteExpiryDelay,
  normalizeClientResourceRouteParam,
  requestClientResourceRouteLaunch,
  resolveClientResourceRouteLaunchFailure,
  resolveClientResourceRouteResource,
} from '../../features/clientAccess/clientResourceRoute';
import { ClientResourceWebView } from '../../features/clientAccess/ClientResourceWebView';

type RoutePhase = 'loading' | 'unavailable';

export default function ClientResourceRoute() {
  const params = useLocalSearchParams<{ resourceId?: string | string[] }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { language, t } = useTranslations();
  const { status, grant, deletionTracking, refresh, createLaunch } = useClientAccess();
  const resourceId = normalizeClientResourceRouteParam(params.resourceId);
  const [authorizationNowMs, setAuthorizationNowMs] = useState(() => Date.now());
  const resource = resolveClientResourceRouteResource(
    params.resourceId,
    status,
    grant,
    authorizationNowMs,
  );
  const currentlyAuthorized = deletionTracking.kind === 'none' && resource !== null;
  const [activeLaunch, setActiveLaunch] = useState<Readonly<ClientResourceLaunch> | null>(null);
  const [phase, setPhase] = useState<RoutePhase>('loading');
  const [attempt, setAttempt] = useState(0);
  const operationGeneration = useRef(0);
  const resumeAfterRevalidation = useRef(false);
  const routeFlowStarted = useRef(false);
  const launchAttemptPending = useRef(false);
  const automaticRetryUsed = useRef(false);
  const authorizationState = {
    deletionTrackingKind: deletionTracking.kind,
    resourceAvailable: resource !== null,
    status,
  } as const;
  const authorizationStateRef = useRef(authorizationState);
  authorizationStateRef.current = authorizationState;

  const closeToResources = useCallback(() => {
    operationGeneration.current += 1;
    resumeAfterRevalidation.current = false;
    routeFlowStarted.current = false;
    launchAttemptPending.current = false;
    automaticRetryUsed.current = false;
    setActiveLaunch(null);
    if (router.canGoBack()) router.back();
    else router.replace('/(main)');
  }, [router]);

  useEffect(() => {
    if (resourceId === null) {
      operationGeneration.current += 1;
      routeFlowStarted.current = false;
      launchAttemptPending.current = false;
      setActiveLaunch(null);
      setPhase('unavailable');
      return;
    }

    const operation = ++operationGeneration.current;
    let mounted = true;
    routeFlowStarted.current = true;
    launchAttemptPending.current = true;
    setActiveLaunch(null);
    setPhase('loading');
    void requestClientResourceRouteLaunch({
      resourceId,
      refresh,
      createLaunch,
      isCurrent: () => mounted && operationGeneration.current === operation,
    }).then((launch) => {
      if (!mounted || operationGeneration.current !== operation) return;
      launchAttemptPending.current = false;
      if (launch === null) {
        const action = resolveClientResourceRouteLaunchFailure({
          ...authorizationStateRef.current,
          automaticRetryUsed: automaticRetryUsed.current,
        });
        if (action === 'wait-for-revalidation') {
          resumeAfterRevalidation.current = true;
          setPhase('loading');
        } else if (action === 'retry-once') {
          automaticRetryUsed.current = true;
          setAttempt((value) => value + 1);
        } else if (action === 'return-home') {
          routeFlowStarted.current = false;
          router.replace('/(main)');
        } else {
          setPhase('unavailable');
        }
        return;
      }
      automaticRetryUsed.current = false;
      resumeAfterRevalidation.current = false;
      setActiveLaunch(launch);
    });

    return () => {
      mounted = false;
      if (operationGeneration.current === operation) operationGeneration.current += 1;
    };
  }, [attempt, createLaunch, refresh, resourceId, router]);

  useEffect(() => {
    const revalidating = status === 'checking'
      || status === 'redeeming'
      || deletionTracking.kind === 'checking';
    if (
      routeFlowStarted.current
      && !launchAttemptPending.current
      && revalidating
    ) {
      operationGeneration.current += 1;
      setActiveLaunch(null);
      setPhase('loading');
      resumeAfterRevalidation.current = true;
      return;
    }

    const deletionSuspended = deletionTracking.kind !== 'none'
      && deletionTracking.kind !== 'checking';
    const accessLost = status === 'locked'
      || status === 'error'
      || (status === 'unlocked' && resource === null);
    if (
      routeFlowStarted.current
      && (
        deletionSuspended
        || (!launchAttemptPending.current && accessLost)
      )
    ) {
      operationGeneration.current += 1;
      resumeAfterRevalidation.current = false;
      routeFlowStarted.current = false;
      launchAttemptPending.current = false;
      setActiveLaunch(null);
      router.replace('/(main)');
      return;
    }

    if (
      status === 'unlocked'
      && deletionTracking.kind === 'none'
      && resource !== null
      && activeLaunch === null
      && resumeAfterRevalidation.current
      && !launchAttemptPending.current
    ) {
      resumeAfterRevalidation.current = false;
      setAttempt((value) => value + 1);
    }
  }, [activeLaunch, deletionTracking.kind, resource, router, status]);

  useEffect(() => {
    const expiresAtMs = status === 'unlocked' && grant !== null
      ? grant.expiresAtMs
      : null;
    if (expiresAtMs === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const checkExpiry = () => {
      const nowMs = Date.now();
      const delayMs = getClientResourceRouteExpiryDelay(expiresAtMs, nowMs);
      if (delayMs === null) return;
      if (delayMs === 0) {
        operationGeneration.current += 1;
        resumeAfterRevalidation.current = false;
        routeFlowStarted.current = false;
        launchAttemptPending.current = false;
        setAuthorizationNowMs(nowMs);
        setActiveLaunch(null);
        router.replace('/(main)');
        return;
      }
      timer = setTimeout(checkExpiry, delayMs);
    };
    checkExpiry();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [grant, router, status]);

  const retryLaunch = useCallback(() => {
    automaticRetryUsed.current = false;
    setAttempt((value) => value + 1);
  }, []);

  const title = useMemo(() => (
    resource?.title[language === 'es-MX' ? 'es' : 'en']
      ?? t('clientAccess.modalTitle')
  ), [language, resource, t]);

  if (activeLaunch !== null && currentlyAuthorized) {
    return (
      <ClientResourceWebView
        launch={activeLaunch}
        title={title}
        onClose={closeToResources}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BrandedBackground density="standard" moleculeOpacity={isDark ? 0.46 : 0.72} />
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
          onPress={closeToResources}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={25} color={colors.primary} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.text }]}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.statusContent}>
        {phase === 'loading' ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              {t('clientAccess.openingResource')}
            </Text>
          </>
        ) : (
          <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorContent}>
            <Ionicons name="shield-outline" size={54} color={colors.error} />
            <Text style={[styles.errorTitle, { color: colors.text }]}>
              {t('clientAccess.launchUnavailable')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={retryLaunch}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.retryLabel, { color: colors.white }]}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  header: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 48, height: 48 },
  title: { flex: 1, height: 48, textAlign: 'center', textAlignVertical: 'center', paddingTop: 13, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  statusContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  statusText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  errorContent: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  errorTitle: { maxWidth: 340, marginTop: 14, textAlign: 'center', fontFamily: 'Georgia', fontSize: 20, lineHeight: 28, fontWeight: '600' },
  retryButton: { minHeight: 48, marginTop: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  retryLabel: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  pressed: { opacity: 0.76 },
});
