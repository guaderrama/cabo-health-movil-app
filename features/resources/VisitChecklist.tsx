import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useTranslations } from '../../hooks';
import {
  CLINIC_GUIDE,
  createVisitChecklistState,
  resetVisitChecklist,
  setVisitChecklistItem,
} from './publicContent';

export function VisitChecklist() {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const [state, setState] = useState(() => createVisitChecklistState(CLINIC_GUIDE));
  const completed = useMemo(() => Object.values(state).filter(Boolean).length, [state]);
  const total = Object.keys(state).length;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('visit.subtitle')}</Text>
      <View style={[styles.emergency, { borderColor: colors.error, backgroundColor: `${colors.error}10` }]}>
        <View style={styles.emergencyTitleRow}>
          <Ionicons name="warning-outline" size={21} color={colors.error} />
          <Text style={[styles.emergencyTitle, { color: colors.error }]}>{t('visit.emergencyTitle')}</Text>
        </View>
        <Text style={[styles.emergencyBody, { color: colors.text }]}>{CLINIC_GUIDE.emergency[language]}</Text>
      </View>
      <View style={styles.progressRow}>
        <Text accessibilityLiveRegion="polite" style={[styles.progress, { color: colors.textSecondary }]}>
          {completed}/{total} {t('visit.progress')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('visit.reset')}
          onPress={() => setState((current) => resetVisitChecklist(current, CLINIC_GUIDE))}
          style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
        >
          <Ionicons name="refresh" size={18} color={colors.primary} />
          <Text style={[styles.resetText, { color: colors.primary }]}>{t('visit.reset')}</Text>
        </Pressable>
      </View>
      {CLINIC_GUIDE.groups.map((group) => (
        <View key={group.id} style={styles.group}>
          <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.text }]}>
            {group.title[language]}
          </Text>
          <View style={[styles.groupCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            {group.items.map((item, index) => {
              const checked = state[item.id] === true;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityHint={checked ? t('visit.complete') : t('visit.incomplete')}
                  onPress={() => setState((current) => setVisitChecklistItem(current, item.id, !checked))}
                  style={({ pressed }) => [
                    styles.checkRow,
                    index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={25}
                    color={checked ? colors.primary : colors.textTertiary}
                  />
                  <Text style={[styles.checkText, { color: colors.text }]}>{item.text[language]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <View style={[styles.emergency, { borderColor: colors.error, backgroundColor: `${colors.error}10` }]}>
        <Text style={[styles.emergencyBody, { color: colors.text }]}>{CLINIC_GUIDE.emergency[language]}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  emergency: { borderWidth: 1, borderRadius: 16, padding: 14 },
  emergencyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  emergencyTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  emergencyBody: { fontSize: 13, lineHeight: 20 },
  progressRow: { minHeight: 52, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  progress: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  reset: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  resetText: { fontSize: 13, fontWeight: '700' },
  group: { marginBottom: 18 },
  groupTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', marginBottom: 8 },
  groupCard: { borderWidth: 1, borderRadius: 17, overflow: 'hidden' },
  checkRow: { minHeight: 56, flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 14 },
  checkText: { flex: 1, fontSize: 14, lineHeight: 21 },
  pressed: { opacity: 0.68 },
});
