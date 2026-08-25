import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useTranslations } from '../../hooks';
import {
  filterRecipes,
  RECIPE_CONTENT,
  RECIPES,
  searchRecipes,
  type Recipe,
  type RecipeCategory,
} from './publicContent';
import { CitationList } from './CitationList';

const CATEGORIES: readonly (RecipeCategory | null)[] = [null, 'breakfast', 'lunch', 'dinner', 'snack', 'beverage'];

export function RecipeBrowser() {
  const { colors } = useTheme();
  const { language, t } = useTranslations();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<RecipeCategory | null>(null);
  const [selected, setSelected] = useState<Recipe | null>(null);
  const results = useMemo(
    () => filterRecipes(searchRecipes(query, language), { category }),
    [category, language, query],
  );

  if (selected) {
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => setSelected(null)}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>{t('common.back')}</Text>
        </Pressable>
        <Text style={[styles.detailTitle, { color: colors.text }]}>{selected.title[language]}</Text>
        <Text style={[styles.summary, { color: colors.textSecondary }]}>{selected.summary[language]}</Text>
        <Text style={[styles.meta, { color: colors.primary }]}>
          {selected.timeLabel[language]} · {selected.servings} {t('recipes.servings')}
        </Text>
        <DetailSection title={t('recipes.ingredients')} items={selected.ingredients[language]} />
        <DetailSection title={t('recipes.steps')} items={selected.steps[language]} numbered />
        <InfoBlock icon="alert-circle-outline" title={t('recipes.allergens')} body={selected.allergens[language]} />
        <InfoBlock icon="shield-checkmark-outline" title={t('recipes.foodSafety')} body={selected.foodSafety[language]} />
        <Text style={[styles.note, { color: colors.textSecondary }]}>{selected.editorialNote[language]}</Text>
        <CitationList sources={RECIPE_CONTENT.sources} reviewedOn={RECIPE_CONTENT.reviewedOn} />
        <Text style={[styles.disclaimer, { color: colors.textSecondary, borderColor: colors.border }]}>
          {RECIPE_CONTENT.disclaimer[language]}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('recipes.subtitle')}</Text>
      <View style={[styles.search, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput
          accessibilityLabel={t('recipes.searchLabel')}
          value={query}
          onChangeText={setQuery}
          placeholder={t('recipes.searchPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, { color: colors.text }]}
          returnKeyType="search"
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {CATEGORIES.map((value) => {
          const label = value ? t(`recipes.${value}`) : t('recipes.all');
          const active = category === value;
          return (
            <Pressable
              key={value ?? 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setCategory(value)}
              style={[
                styles.filter,
                {
                  backgroundColor: active ? colors.primary : colors.cardBackground,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: active ? colors.white : colors.text }]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {results.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="leaf-outline" size={38} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('recipes.noResults')}</Text>
        </View>
      ) : results.map((recipe) => (
        <Pressable
          key={recipe.slug}
          accessibilityRole="button"
          accessibilityLabel={`${recipe.title[language]}. ${recipe.summary[language]}`}
          accessibilityHint={t('recipes.readRecipe')}
          onPress={() => setSelected(recipe)}
          style={({ pressed }) => [
            styles.recipeCard,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.recipeText}>
            <Text style={[styles.recipeTitle, { color: colors.text }]}>{recipe.title[language]}</Text>
            <Text style={[styles.summary, { color: colors.textSecondary }]}>{recipe.summary[language]}</Text>
            <Text style={[styles.meta, { color: colors.primary }]}>{recipe.timeLabel[language]}</Text>
          </View>
          <Ionicons name="chevron-forward" size={21} color={colors.textTertiary} />
        </Pressable>
      ))}
      <CitationList sources={RECIPE_CONTENT.sources} reviewedOn={RECIPE_CONTENT.reviewedOn} />
      <Text style={[styles.disclaimer, { color: colors.textSecondary, borderColor: colors.border }]}>
        {RECIPE_CONTENT.disclaimer[language]}
      </Text>
    </ScrollView>
  );
}

function DetailSection({ title, items, numbered = false }: { title: string; items: readonly string[]; numbered?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} style={styles.itemRow}>
          <Text style={[styles.itemMarker, { color: colors.primary }]}>{numbered ? `${index + 1}.` : '•'}</Text>
          <Text style={[styles.itemText, { color: colors.text }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function InfoBlock({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.infoBlock, { backgroundColor: `${colors.primary}10` }]}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View style={styles.infoText}>
        <Text style={[styles.infoTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.summary, { color: colors.textSecondary }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, paddingVertical: 11, paddingHorizontal: 10 },
  filters: { gap: 8, paddingVertical: 12 },
  filter: { minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  filterText: { fontSize: 13, fontWeight: '600' },
  recipeCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, padding: 15, marginBottom: 10 },
  recipeText: { flex: 1, paddingRight: 10 },
  recipeTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700', marginBottom: 3 },
  summary: { fontSize: 13, lineHeight: 19 },
  meta: { fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 6 },
  empty: { alignItems: 'center', paddingVertical: 42 },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 10, textAlign: 'center' },
  pressed: { opacity: 0.72 },
  backButton: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backText: { fontSize: 16 },
  detailTitle: { fontSize: 27, lineHeight: 33, fontWeight: '700', marginBottom: 6 },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: '700', marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 9 },
  itemMarker: { width: 25, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  itemText: { flex: 1, fontSize: 15, lineHeight: 22 },
  infoBlock: { flexDirection: 'row', gap: 10, borderRadius: 16, padding: 14, marginTop: 16 },
  infoText: { flex: 1 },
  infoTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 3 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 16 },
  disclaimer: { fontSize: 12, lineHeight: 18, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 22, paddingTop: 16 },
});
