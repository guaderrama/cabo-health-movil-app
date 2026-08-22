import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClientAccess } from '../../context/ClientAccessContext';
import { useTheme, useTranslations } from '../../hooks';
import type {
  ClientAccountDeletionResult,
  ClientResourceLaunch,
  ClientResourceView,
} from './clientAccessController';
import { ClientResourceWebView } from './ClientResourceWebView';

type ConfirmAction = 'remove' | 'delete-production' | 'delete-review' | null;

export function ClientAccessModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const insets = useSafeAreaInsets();
  const {
    status,
    grant,
    error,
    redeem,
    createLaunch,
    removeAccess,
    deleteAccount,
  } = useClientAccess();
  const [code, setCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [actionPending, setActionPending] = useState(false);
  const [deletionResult, setDeletionResult] = useState<Readonly<ClientAccountDeletionResult> | null>(null);
  const [deletionError, setDeletionError] = useState(false);
  const [launchPendingId, setLaunchPendingId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState(false);
  const [activeLaunch, setActiveLaunch] = useState<Readonly<ClientResourceLaunch> | null>(null);
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [activeResourceTitle, setActiveResourceTitle] = useState('');
  const launchGeneration = useRef(0);
  const busy = status === 'checking' || status === 'redeeming';
  const unlocked = status === 'unlocked' && grant !== null;
  const isReviewGrant = grant !== null && 'scope' in grant && grant.scope === 'review_sandbox';

  useEffect(() => {
    if (!visible) {
      setCode('');
      setAttempted(false);
      setConfirmAction(null);
      setActionPending(false);
      setDeletionResult(null);
      setDeletionError(false);
      setLaunchPendingId(null);
      setLaunchError(false);
      setActiveLaunch(null);
      setActiveResourceId(null);
      setActiveResourceTitle('');
      launchGeneration.current += 1;
    }
  }, [visible]);

  useEffect(() => {
    if (
      activeLaunch
      && (
        status !== 'unlocked'
        || !grant
        || !activeResourceId
        || !grant.resources.some((resource) => resource.id === activeResourceId)
      )
    ) {
      launchGeneration.current += 1;
      setActiveLaunch(null);
      setActiveResourceId(null);
      setActiveResourceTitle('');
    }
  }, [activeLaunch, activeResourceId, grant, status]);

  const submit = async () => {
    if (busy || code.trim().length === 0) return;
    const submittedCode = code;
    setCode('');
    setAttempted(true);
    if (await redeem(submittedCode)) setAttempted(false);
  };

  const confirm = async () => {
    const action = confirmAction;
    if (!action || actionPending) return;
    setActionPending(true);
    if (action === 'remove') {
      await removeAccess();
      setConfirmAction(null);
      setActionPending(false);
      return;
    }
    setDeletionError(false);
    const result = await deleteAccount();
    setConfirmAction(null);
    setActionPending(false);
    if (result) setDeletionResult(result);
    else setDeletionError(true);
  };

  const openResource = async (resource: Readonly<ClientResourceView>) => {
    if (launchPendingId) return;
    const operationGeneration = ++launchGeneration.current;
    setLaunchPendingId(resource.id);
    setLaunchError(false);
    const launch = await createLaunch(resource.id);
    if (operationGeneration !== launchGeneration.current || !visible) return;
    setLaunchPendingId(null);
    if (!launch) {
      setLaunchError(true);
      return;
    }
    setActiveResourceId(resource.id);
    setActiveResourceTitle(resource.title[language === 'es-MX' ? 'es' : 'en']);
    setActiveLaunch(launch);
  };

  const closeModal = () => {
    if (actionPending) return;
    launchGeneration.current += 1;
    setLaunchPendingId(null);
    setActiveLaunch(null);
    setActiveResourceId(null);
    onClose();
  };

  const errorMessage = error === 'invalid-code'
    ? t('clientAccess.invalidCode')
    : t('clientAccess.unavailable');

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={closeModal}>
      {activeLaunch ? (
        <ClientResourceWebView
          launch={activeLaunch}
          title={activeResourceTitle}
          onClose={() => {
            setActiveLaunch(null);
            setActiveResourceId(null);
            setActiveResourceTitle('');
          }}
        />
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.container, { backgroundColor: colors.background }]}
        >
        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top, 12),
              backgroundColor: colors.cardBackground,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {t('clientAccess.modalTitle')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('clientAccess.modalSubtitle')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            accessibilityState={{ disabled: actionPending }}
            disabled={actionPending}
            onPress={closeModal}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={25} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
          {deletionResult ? (
            <View
              accessibilityRole="alert"
              style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
            >
              <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {deletionResult.status === 'pending'
                  ? t('clientAccess.deletionPendingTitle')
                  : t('clientAccess.deletionCompletedTitle')}
              </Text>
              <Text style={[styles.cardCopy, { color: colors.textSecondary }]}>
                {deletionResult.status === 'pending'
                  ? t('clientAccess.deletionPendingBody')
                  : t('clientAccess.deletionCompletedBody')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.done')}
                onPress={closeModal}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.primaryLabel, { color: colors.white }]}>{t('common.done')}</Text>
              </Pressable>
            </View>
          ) : unlocked ? (
            <View style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
              <Ionicons name="checkmark-circle-outline" size={45} color={colors.success} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>{t('clientAccess.activeTitle')}</Text>
              <Text style={[styles.cardCopy, { color: colors.textSecondary }]}>{t('clientAccess.activeSummary')}</Text>
              <View style={styles.resourceList}>
                {grant.resources.map((resource) => (
                  <Pressable
                    key={resource.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('clientAccess.openResource')}: ${resource.title[language === 'es-MX' ? 'es' : 'en']}`}
                    accessibilityState={{ busy: launchPendingId === resource.id, disabled: launchPendingId !== null }}
                    disabled={launchPendingId !== null}
                    onPress={() => { void openResource(resource); }}
                    style={({ pressed }) => [
                      styles.resourceRow,
                      { borderColor: colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={(resource.iconKey === 'featured'
                        ? 'sparkles-outline'
                        : resource.iconKey) as keyof typeof Ionicons.glyphMap}
                      size={21}
                      color={colors.primary}
                    />
                    <Text style={[styles.resourceTitle, { color: colors.text }]}>
                      {resource.title[language === 'es-MX' ? 'es' : 'en']}
                    </Text>
                    {launchPendingId === resource.id
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Ionicons name="arrow-forward" size={19} color={colors.primary} />}
                  </Pressable>
                ))}
              </View>
              {launchError && (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
                  {t('clientAccess.launchUnavailable')}
                </Text>
              )}
              {deletionError && (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
                  {t('clientAccess.deleteUnavailable')}
                </Text>
              )}
              {!isReviewGrant && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setConfirmAction('remove')}
                  style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.primary }, pressed && styles.pressed]}
                >
                  <Text style={[styles.secondaryLabel, { color: colors.primary }]}>{t('clientAccess.removeAccess')}</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isReviewGrant
                  ? t('clientAccess.deleteReviewAccount')
                  : t('clientAccess.deleteAccount')}
                onPress={() => setConfirmAction(isReviewGrant ? 'delete-review' : 'delete-production')}
                style={({ pressed }) => [
                  styles.deleteButton,
                  isReviewGrant && styles.reviewDeleteButton,
                  isReviewGrant && { borderColor: colors.error },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.deleteLabel, { color: colors.error }]}>
                  {isReviewGrant
                    ? t('clientAccess.deleteReviewAccount')
                    : t('clientAccess.deleteAccount')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
              <Ionicons name="key-outline" size={44} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>{t('clientAccess.codeTitle')}</Text>
              <Text style={[styles.cardCopy, { color: colors.textSecondary }]}>{t('clientAccess.codeHelp')}</Text>
              <TextInput
                accessibilityLabel={t('clientAccess.codeLabel')}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!busy}
                onChangeText={(value) => { setCode(value); setAttempted(false); }}
                onSubmitEditing={() => { void submit(); }}
                placeholder="CH-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                placeholderTextColor={colors.textSecondary}
                returnKeyType="done"
                secureTextEntry
                style={[styles.input, { borderColor: attempted ? colors.error : colors.border, color: colors.text }]}
                value={code}
              />
              {(attempted || status === 'error') && error && (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{errorMessage}</Text>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={busy || code.trim().length === 0}
                onPress={() => { void submit(); }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  (busy || code.trim().length === 0) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {busy
                  ? <ActivityIndicator color={colors.white} />
                  : <Text style={[styles.primaryLabel, { color: colors.white }]}>{t('clientAccess.unlock')}</Text>}
              </Pressable>
            </View>
          )}
        </ScrollView>

        <ConfirmationDialog
          action={confirmAction}
          busy={actionPending}
          onCancel={() => { if (!actionPending) setConfirmAction(null); }}
          onConfirm={() => { void confirm(); }}
        />
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

function ConfirmationDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslations();
  if (!action) return null;
  const deleting = action !== 'remove';
  const reviewDeleting = action === 'delete-review';
  return (
    <View style={styles.confirmOverlay}>
      <View accessibilityRole="alert" style={[styles.confirmCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
        <Text style={[styles.confirmTitle, { color: colors.text }]}>
          {reviewDeleting
            ? t('clientAccess.confirmDeleteReviewTitle')
            : deleting
              ? t('clientAccess.confirmDeleteTitle')
              : t('clientAccess.confirmRemoveTitle')}
        </Text>
        <Text style={[styles.confirmCopy, { color: colors.textSecondary }]}>
          {deleting ? t('clientAccess.confirmDeleteBody') : t('clientAccess.confirmRemoveBody')}
        </Text>
        <View style={styles.confirmActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onCancel}
            style={styles.confirmButton}
          >
            <Text style={[styles.confirmButtonLabel, { color: colors.primary }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={onConfirm}
            style={styles.confirmButton}
          >
            {busy ? <ActivityIndicator size="small" color={colors.error} /> : (
              <Text style={[styles.confirmButtonLabel, { color: colors.error }]}>
                {reviewDeleting
                  ? t('clientAccess.deleteReviewAccount')
                  : deleting
                    ? t('clientAccess.deleteAccount')
                    : t('clientAccess.removeAccess')}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 104, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-end' },
  headerCopy: { flex: 1, paddingRight: 12 },
  title: { fontFamily: 'Georgia', fontSize: 25, lineHeight: 31, fontWeight: '600' },
  subtitle: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: { borderWidth: 1, borderRadius: 22, padding: 24, alignItems: 'center' },
  cardTitle: { marginTop: 13, textAlign: 'center', fontFamily: 'Georgia', fontSize: 21, lineHeight: 27, fontWeight: '600' },
  cardCopy: { maxWidth: 330, marginTop: 7, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  input: { width: '100%', minHeight: 52, marginTop: 20, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, letterSpacing: 0.7 },
  error: { marginTop: 10, textAlign: 'center', fontSize: 12, lineHeight: 17 },
  primaryButton: { width: '100%', minHeight: 50, marginTop: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontSize: 13, lineHeight: 18, fontWeight: '800', letterSpacing: 0.8 },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.76 },
  resourceList: { width: '100%', marginTop: 18, gap: 8 },
  resourceRow: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  resourceTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  secondaryButton: { width: '100%', minHeight: 48, marginTop: 20, borderWidth: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  deleteButton: { minHeight: 44, marginTop: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  reviewDeleteButton: { width: '100%', minHeight: 50, marginTop: 20, borderWidth: 1, borderRadius: 999 },
  deleteLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  confirmOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, backgroundColor: 'rgba(3, 25, 37, 0.56)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmCard: { width: '100%', maxWidth: 360, borderWidth: 1, borderRadius: 20, padding: 20 },
  confirmTitle: { fontFamily: 'Georgia', fontSize: 20, lineHeight: 26, fontWeight: '600' },
  confirmCopy: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  confirmActions: { marginTop: 18, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  confirmButton: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  confirmButtonLabel: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
});
