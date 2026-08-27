import { useEffect, useState } from 'react';
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
import type { ClientAccountDeletionTrackingState } from './clientDeletionReceiptStore';
import { openClientAccessSupport } from './clientAccessSupport';

type ConfirmAction = 'remove' | 'delete-production' | 'delete-review' | null;
type DeletionTrackingPresentation = ClientAccountDeletionTrackingState
  | Readonly<{ kind: 'checking' }>;

export function ClientAccessModal({
  visible,
  codeEntryRequested = false,
  onClose,
  onOpenResource,
  onRedeemed,
}: {
  visible: boolean;
  codeEntryRequested?: boolean;
  onClose: () => void;
  onOpenResource: (resourceId: string) => void;
  onRedeemed?: () => void;
}) {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const insets = useSafeAreaInsets();
  const {
    status,
    grant,
    error,
    redeem,
    removeAccess,
    deleteAccount,
    deletionTracking,
    checkDeletionStatus,
    acknowledgeDeletionCompletion,
    archiveDeletionReceipt,
  } = useClientAccess();
  const [code, setCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [actionPending, setActionPending] = useState(false);
  const [deletionError, setDeletionError] = useState(false);
  const [deletionActionError, setDeletionActionError] = useState(false);
  const busy = status === 'checking'
    || status === 'redeeming'
    || deletionTracking.kind === 'checking';
  const unlocked = status === 'unlocked' && grant !== null;
  const showCodeEntry = codeEntryRequested || !unlocked;
  const isReviewGrant = grant !== null && 'scope' in grant && grant.scope === 'review_sandbox';

  useEffect(() => {
    if (!visible) {
      setCode('');
      setAttempted(false);
      setConfirmAction(null);
      setActionPending(false);
      setDeletionError(false);
      setDeletionActionError(false);
    }
  }, [visible]);

  const submit = async () => {
    if (busy || code.trim().length === 0) return;
    const submittedCode = code;
    setCode('');
    setAttempted(true);
    if (await redeem(submittedCode)) {
      setAttempted(false);
      onRedeemed?.();
    }
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
    if (!result) setDeletionError(true);
  };

  const closeModal = () => {
    if (actionPending) return;
    onClose();
  };

  const finishDeletion = async () => {
    if (actionPending) return;
    if (deletionTracking.kind !== 'completed') {
      closeModal();
      return;
    }
    setActionPending(true);
    setDeletionActionError(false);
    const cleared = await acknowledgeDeletionCompletion();
    setActionPending(false);
    if (cleared) closeModal();
    else setDeletionActionError(true);
  };

  const archiveDeletion = async () => {
    if (actionPending) return;
    setActionPending(true);
    setDeletionActionError(false);
    const archived = await archiveDeletionReceipt();
    setActionPending(false);
    if (archived) closeModal();
    else setDeletionActionError(true);
  };

  const openDeletionSupport = async () => {
    setDeletionActionError(false);
    try {
      await openClientAccessSupport();
    } catch {
      setDeletionActionError(true);
    }
  };

  const errorMessage = error === 'invalid-code'
    ? t('clientAccess.invalidCode')
    : t('clientAccess.unavailable');

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={closeModal}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View
          accessibilityElementsHidden={confirmAction !== null}
          importantForAccessibility={confirmAction !== null ? 'no-hide-descendants' : 'auto'}
          style={styles.modalContent}
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
          {deletionTracking.kind !== 'none' ? (
            <DeletionStatusCard
              actionError={deletionActionError}
              busy={actionPending}
              language={language}
              tracking={deletionTracking}
              onArchive={() => { void archiveDeletion(); }}
              onCheck={() => { void checkDeletionStatus(); }}
              onDone={() => { void finishDeletion(); }}
              onSupport={() => { void openDeletionSupport(); }}
            />
          ) : !showCodeEntry ? (
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
                    onPress={() => onOpenResource(resource.id)}
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
                    <Ionicons name="arrow-forward" size={19} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
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
        </View>

        <ConfirmationDialog
          action={confirmAction}
          busy={actionPending}
          onCancel={() => { if (!actionPending) setConfirmAction(null); }}
          onConfirm={() => { void confirm(); }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DeletionStatusCard({
  actionError,
  busy,
  language,
  tracking,
  onArchive,
  onCheck,
  onDone,
  onSupport,
}: {
  actionError: boolean;
  busy: boolean;
  language: 'en' | 'es-MX';
  tracking: DeletionTrackingPresentation;
  onArchive: () => void;
  onCheck: () => void;
  onDone: () => void;
  onSupport: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslations();

  if (tracking.kind === 'checking') {
    return (
      <View
        accessibilityRole="alert"
        style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {t('clientAccess.deletionCheckingTitle')}
        </Text>
        <Text style={[styles.cardCopy, { color: colors.textSecondary }]}>
          {t('clientAccess.deletionCheckingBody')}
        </Text>
      </View>
    );
  }

  if (tracking.kind === 'unavailable') {
    const accepted = tracking.phase === 'accepted';
    return (
      <View
        accessibilityRole="alert"
        style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
      >
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {accepted
            ? t('clientAccess.deletionUnavailableAcceptedTitle')
            : t('clientAccess.deletionUnavailablePreparedTitle')}
        </Text>
        <Text style={[styles.cardCopy, { color: colors.textSecondary }]}>
          {accepted
            ? t('clientAccess.deletionUnavailableAcceptedBody')
            : t('clientAccess.deletionUnavailablePreparedBody')}
        </Text>
        {actionError && (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
            {t('clientAccess.deletionReceiptActionFailed')}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={onCheck}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary },
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy
            ? <ActivityIndicator color={colors.white} />
            : <Text style={[styles.primaryLabel, { color: colors.white }]}>{t('clientAccess.checkDeletionStatus')}</Text>}
        </Pressable>
        <Pressable
          accessibilityRole="link"
          disabled={busy}
          onPress={onSupport}
          style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.primary }, pressed && styles.pressed]}
        >
          <Text style={[styles.secondaryLabel, { color: colors.primary }]}>{t('clientAccess.deletionSupport')}</Text>
        </Pressable>
        {accepted && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onArchive}
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
          >
            <Text style={[styles.deleteLabel, { color: colors.error }]}>
              {t('clientAccess.archiveDeletionReceipt')}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (tracking.kind === 'none') return null;

  const overdue = tracking.kind === 'pending'
    && Date.now() >= tracking.status.expectedCompletionByMs;
  const formattedExpectedDate = new Intl.DateTimeFormat(
    language === 'es-MX' ? 'es-MX' : 'en-US',
    { day: 'numeric', month: 'long', year: 'numeric' },
  ).format(new Date(tracking.status.expectedCompletionByMs));
  const completed = tracking.kind === 'completed';
  return (
    <View
      accessibilityRole="alert"
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      <Ionicons
        name={completed ? 'checkmark-circle-outline' : overdue ? 'time-outline' : 'shield-checkmark-outline'}
        size={48}
        color={completed ? colors.success : overdue ? colors.error : colors.primary}
      />
      <Text style={[styles.cardTitle, { color: colors.text }]}>
        {completed
          ? t('clientAccess.deletionCompletedTitle')
          : overdue
            ? t('clientAccess.deletionOverdueTitle')
            : t('clientAccess.deletionPendingTitle')}
      </Text>
      <Text style={[styles.cardCopy, { color: colors.textSecondary }]}>
        {completed
          ? t('clientAccess.deletionCompletedBody')
          : overdue
            ? t('clientAccess.deletionOverdueBody')
            : t('clientAccess.deletionPendingBody')}
      </Text>
      {!completed && (
        <Text style={[styles.expectedDate, { color: colors.text }]}>
          {t('clientAccess.deletionExpectedBy')} {formattedExpectedDate}
        </Text>
      )}
      {tracking.availability === 'offline' && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {t('clientAccess.deletionStatusOffline')}
        </Text>
      )}
      {actionError && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {t('clientAccess.deletionReceiptActionFailed')}
        </Text>
      )}
      {!completed && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={onCheck}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary },
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy
            ? <ActivityIndicator color={colors.white} />
            : <Text style={[styles.primaryLabel, { color: colors.white }]}>{t('clientAccess.checkDeletionStatus')}</Text>}
        </Pressable>
      )}
      {overdue && (
        <Pressable
          accessibilityRole="link"
          disabled={busy}
          onPress={onSupport}
          style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.primary }, pressed && styles.pressed]}
        >
          <Text style={[styles.secondaryLabel, { color: colors.primary }]}>{t('clientAccess.deletionSupport')}</Text>
        </Pressable>
      )}
      {completed && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={onDone}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary },
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy
            ? <ActivityIndicator color={colors.white} />
            : <Text style={[styles.primaryLabel, { color: colors.white }]}>{t('common.done')}</Text>}
        </Pressable>
      )}
    </View>
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
    <View accessibilityViewIsModal style={styles.confirmOverlay}>
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
  modalContent: { flex: 1 },
  header: { minHeight: 104, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-end' },
  headerCopy: { flex: 1, paddingRight: 12 },
  title: { fontFamily: 'Georgia', fontSize: 25, lineHeight: 31, fontWeight: '600' },
  subtitle: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: { borderWidth: 1, borderRadius: 22, padding: 24, alignItems: 'center' },
  cardTitle: { marginTop: 13, textAlign: 'center', fontFamily: 'Georgia', fontSize: 21, lineHeight: 27, fontWeight: '600' },
  cardCopy: { maxWidth: 330, marginTop: 7, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  expectedDate: { marginTop: 14, textAlign: 'center', fontSize: 13, lineHeight: 18, fontWeight: '700' },
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
