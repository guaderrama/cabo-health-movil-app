import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaboHealthMiniappIcon } from '../../components/icons/CaboHealthMiniappIcon';
import { useTheme, useTranslations } from '../../hooks';
import type { MessageKey } from '../../i18n/messages';
import {
  DEFAULT_DEV_MINIAPP_ICON,
  DEV_MINIAPP_ICONS,
  isDevMiniappPanelEnabled,
  type CreateDevMiniappResult,
  type DevMiniapp,
  type DevMiniappAccess,
  type DevMiniappIcon,
  type DevMiniappInput,
} from './devMiniappCatalog';

const ICON_LABEL_KEYS = Object.freeze({
  'flask-outline': 'devPanel.iconLab',
  'book-outline': 'devPanel.iconGuide',
  'leaf-outline': 'devPanel.iconNutrition',
  'restaurant-outline': 'devPanel.iconRecipes',
  'heart-outline': 'devPanel.iconWellness',
  'map-outline': 'devPanel.iconLocation',
  'chatbubble-ellipses-outline': 'devPanel.iconContact',
  'sparkles-outline': 'devPanel.iconFeatured',
} satisfies Record<DevMiniappIcon, MessageKey>);

const EMPTY_FORM: DevMiniappInput = {
  titleEn: '',
  titleEs: '',
  summaryEn: '',
  summaryEs: '',
  url: '',
  access: 'public',
  icon: DEFAULT_DEV_MINIAPP_ICON,
};

export function DevMiniappPanel({
  visible,
  miniapps,
  saving,
  storageError,
  onClose,
  onAdd,
  onToggle,
  onRemove,
}: {
  visible: boolean;
  miniapps: readonly Readonly<DevMiniapp>[];
  saving: boolean;
  storageError: boolean;
  onClose: () => void;
  onAdd: (input: Readonly<DevMiniappInput>) => Promise<CreateDevMiniappResult>;
  onToggle: (id: string, active: boolean) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<DevMiniappInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<Readonly<DevMiniapp> | null>(null);

  if (!isDevMiniappPanelEnabled(__DEV__)) return null;

  const update = <Key extends keyof DevMiniappInput>(key: Key, value: DevMiniappInput[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const submit = async () => {
    const result = await onAdd(form);
    if (!result.ok) {
      setFormError(t('devPanel.validationError'));
      return;
    }
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const fillSample = () => {
    setForm({
      titleEn: 'Sample: Healthy Recipes',
      titleEs: 'Ejemplo: Recetas saludables',
      summaryEn: 'Temporary test card using an existing live CaboHealth page.',
      summaryEs: 'Tarjeta temporal que usa una página existente de CaboHealth.',
      url: 'https://cabohealth.org/apps/healthy-recipes/',
      access: 'client',
      icon: 'restaurant-outline',
    });
    setFormError(null);
  };

  const removeSelected = async () => {
    if (!removeCandidate) return;
    const removed = await onRemove(removeCandidate.id);
    if (removed) setRemoveCandidate(null);
  };

  const displayTitle = (miniapp: Readonly<DevMiniapp>) => (
    language === 'es-MX' ? miniapp.titleEs : miniapp.titleEn
  );

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top, 14),
              backgroundColor: colors.cardBackground,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.headerCopy}>
            <View style={styles.titleLine}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
                {t('devPanel.title')}
              </Text>
              <View style={[styles.testBadge, { backgroundColor: colors.disabledBackground }]}>
                <Text style={[styles.testBadgeText, { color: colors.primary }]}>{t('devPanel.testOnly')}</Text>
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={25} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 28, 36) }]}
        >
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('devPanel.subtitle')}
          </Text>

          {storageError && (
            <View accessibilityRole="alert" style={[styles.alert, { borderColor: colors.error }]}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
              <Text style={[styles.alertText, { color: colors.text }]}>{t('devPanel.storageError')}</Text>
            </View>
          )}

          <Text accessibilityRole="header" style={[styles.sectionLabel, { color: colors.primary }]}>
            {t('devPanel.current').toUpperCase()}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            {miniapps.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('devPanel.empty')}</Text>
            ) : miniapps.map((miniapp, index) => (
              <View
                key={miniapp.id}
                style={[
                  styles.savedRow,
                  index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    styles.savedIcon,
                    { backgroundColor: colors.editorialCoverMuted, borderColor: colors.editorialBorder },
                  ]}
                >
                  <CaboHealthMiniappIcon name={miniapp.icon} size={22} />
                </View>
                <View style={styles.savedCopy}>
                  <Text style={[styles.savedTitle, { color: colors.text }]} numberOfLines={1}>{displayTitle(miniapp)}</Text>
                  <Text style={[styles.savedMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {miniapp.access === 'client' ? t('devPanel.clients') : t('devPanel.public')} · {miniapp.slug}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={`${displayTitle(miniapp)}: ${miniapp.active ? t('devPanel.active') : t('devPanel.inactive')}`}
                  disabled={saving}
                  value={miniapp.active}
                  onValueChange={(active) => { void onToggle(miniapp.id, active); }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('devPanel.remove')}: ${displayTitle(miniapp)}`}
                  disabled={saving}
                  onPress={() => setRemoveCandidate(miniapp)}
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                </Pressable>
              </View>
            ))}
          </View>

          <Text accessibilityRole="header" style={[styles.sectionLabel, styles.addLabel, { color: colors.primary }]}>
            {t('devPanel.addTitle').toUpperCase()}
          </Text>
          <View style={[styles.form, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              onPress={fillSample}
              style={({ pressed }) => [
                styles.sampleButton,
                { borderColor: colors.primary },
                pressed && styles.pressed,
              ]}
            >
              <CaboHealthMiniappIcon name="flask-outline" size={20} />
              <Text style={[styles.sampleButtonText, { color: colors.primary }]}>{t('devPanel.useSample')}</Text>
            </Pressable>
            <Field
              label={t('devPanel.titleEn')}
              value={form.titleEn}
              onChangeText={(value) => update('titleEn', value)}
            />
            <Field
              label={t('devPanel.titleEs')}
              value={form.titleEs}
              onChangeText={(value) => update('titleEs', value)}
            />
            <Field
              label={t('devPanel.summaryEn')}
              value={form.summaryEn}
              onChangeText={(value) => update('summaryEn', value)}
              multiline
            />
            <Field
              label={t('devPanel.summaryEs')}
              value={form.summaryEs}
              onChangeText={(value) => update('summaryEs', value)}
              multiline
            />
            <Field
              label={t('devPanel.url')}
              value={form.url}
              onChangeText={(value) => update('url', value)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://example.org/guide/"
            />

            <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('devPanel.icon')}</Text>
            <View accessibilityRole="radiogroup" style={styles.iconGrid}>
              {DEV_MINIAPP_ICONS.map((icon) => (
                <IconChoice
                  key={icon}
                  icon={icon}
                  label={t(ICON_LABEL_KEYS[icon])}
                  selected={(form.icon ?? DEFAULT_DEV_MINIAPP_ICON) === icon}
                  onPress={() => update('icon', icon)}
                />
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: colors.text }]}>{t('devPanel.access')}</Text>
            <View accessibilityRole="radiogroup" style={styles.segmented}>
              {(['public', 'client'] as const).map((access) => (
                <AccessChoice
                  key={access}
                  access={access}
                  selected={form.access === access}
                  label={access === 'public' ? t('devPanel.public') : t('devPanel.clients')}
                  onPress={() => update('access', access)}
                />
              ))}
            </View>
            <Text style={[styles.accessWarning, { color: colors.textSecondary }]}>{t('devPanel.accessWarning')}</Text>

            {formError && (
              <Text accessibilityRole="alert" style={[styles.formError, { color: colors.error }]}>
                {formError}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => { void submit(); }}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: colors.primary },
                saving && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="add" size={22} color={colors.white} />
              <Text style={[styles.addButtonText, { color: colors.white }]}>{t('devPanel.add')}</Text>
            </Pressable>
          </View>
        </ScrollView>

        {removeCandidate && (
          <View style={styles.confirmOverlay}>
            <View
              accessibilityRole="alert"
              style={[
                styles.confirmCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.confirmTitle, { color: colors.text }]}>{t('devPanel.remove')}</Text>
              <Text style={[styles.confirmCopy, { color: colors.textSecondary }]}>{t('devPanel.removeConfirm')}</Text>
              <View style={styles.confirmActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => setRemoveCandidate(null)}
                  style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}
                >
                  <Text style={[styles.confirmButtonText, { color: colors.primary }]}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => { void removeSelected(); }}
                  style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}
                >
                  <Text style={[styles.confirmButtonText, { color: colors.error }]}>{t('devPanel.remove')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...inputProps } = props;
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.input,
          inputProps.multiline && styles.multiline,
          { color: colors.text, backgroundColor: colors.background, borderColor: colors.border },
          style,
        ]}
        {...inputProps}
      />
    </View>
  );
}

function AccessChoice({
  access,
  selected,
  label,
  onPress,
}: {
  access: DevMiniappAccess;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        {
          backgroundColor: selected ? colors.primary : colors.background,
          borderColor: selected ? colors.primary : colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={access === 'client' ? 'lock-closed-outline' : 'globe-outline'}
        size={18}
        color={selected ? colors.white : colors.primary}
      />
      <Text style={[styles.segmentText, { color: selected ? colors.white : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function IconChoice({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: DevMiniappIcon;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconChoice,
        {
          backgroundColor: selected ? colors.primary : colors.editorialSurfaceMuted,
          borderColor: selected ? colors.primary : colors.editorialBorder,
        },
        pressed && styles.pressed,
      ]}
    >
      <CaboHealthMiniappIcon name={icon} size={27} inverted={selected} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1 },
  headerCopy: { flex: 1, minHeight: 44, justifyContent: 'center' },
  titleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { fontFamily: 'Georgia', fontSize: 22, lineHeight: 28, fontWeight: '700' },
  testBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  testBadgeText: { fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 1.2 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  alert: { marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 13, padding: 12 },
  alertText: { flex: 1, fontSize: 13, lineHeight: 18 },
  sectionLabel: { marginTop: 24, marginBottom: 9, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1.8 },
  addLabel: { marginTop: 30 },
  card: { borderWidth: 1, borderRadius: 17, overflow: 'hidden' },
  empty: { padding: 16, fontSize: 13, lineHeight: 18 },
  savedRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  savedIcon: { width: 38, height: 38, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  savedCopy: { flex: 1 },
  savedTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  savedMeta: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  form: { borderWidth: 1, borderRadius: 17, padding: 14 },
  sampleButton: { minHeight: 44, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  sampleButtonText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  field: { marginBottom: 14 },
  fieldLabel: { marginBottom: 6, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  iconChoice: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', gap: 8 },
  accessWarning: { marginTop: 8, fontSize: 11, lineHeight: 16 },
  segment: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10 },
  segmentText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  formError: { marginTop: 12, fontSize: 12, lineHeight: 18 },
  addButton: { minHeight: 48, marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 13, paddingHorizontal: 16 },
  addButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.55 },
  confirmOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, backgroundColor: 'rgba(3, 25, 37, 0.56)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmCard: { width: '100%', maxWidth: 360, borderWidth: 1, borderRadius: 20, padding: 20 },
  confirmTitle: { fontFamily: 'Georgia', fontSize: 20, lineHeight: 26, fontWeight: '600' },
  confirmCopy: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  confirmActions: { marginTop: 18, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  confirmButton: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  confirmButtonText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
});
