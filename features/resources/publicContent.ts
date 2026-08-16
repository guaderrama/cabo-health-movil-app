import recipesJson from '../../content/recipes.json';
import clinicGuideJson from '../../content/clinic-guide.json';
import publicContactFactsJson from '../../release/public-contact-facts.json';

export type ContentLanguage = 'en' | 'es-MX';
export type RecipeCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface LocalizedText {
  en: string;
  'es-MX': string;
}

export interface Recipe {
  slug: string;
  title: LocalizedText;
  summary: LocalizedText;
  categories: RecipeCategory[];
  tags: string[];
  timeMinutes: number;
  timeLabel: LocalizedText;
  servings: number;
  ingredients: Record<ContentLanguage, string[]>;
  steps: Record<ContentLanguage, string[]>;
  allergens: LocalizedText;
  foodSafety: LocalizedText;
  editorialNote: LocalizedText;
}

export interface RecipeContent {
  version: string;
  reviewedOn: string;
  disclaimer: LocalizedText;
  foodSafety: LocalizedText;
  sources: readonly { title: string; url: string }[];
  recipes: readonly Recipe[];
}

export interface VisitChecklistItem {
  id: string;
  text: LocalizedText;
}

export interface VisitChecklistGroup {
  id: string;
  title: LocalizedText;
  items: readonly VisitChecklistItem[];
}

export interface ClinicGuideContent {
  version: string;
  reviewedOn: string;
  emergency: LocalizedText;
  privacy: LocalizedText;
  groups: readonly VisitChecklistGroup[];
  sources: readonly { title: string; url: string }[];
}

export interface PublicContactFact {
  value: string | readonly string[] | null;
  sourceUrl: string | null;
  sourceStatus: 'owner-confirmation-required' | 'owner-confirmed-source';
}

export interface PublicContactFacts {
  status: 'awaiting-owner-confirmation' | 'owner-confirmed';
  ownerConfirmedAt: string | null;
  facts: Record<string, PublicContactFact>;
}

export const REQUIRED_PUBLIC_CONTACT_FACT_KEYS = [
  'publicEmail',
  'phone',
  'whatsApp',
  'address',
  'hours',
  'appleMapsDestination',
  'serviceLanguages',
] as const;

export const RECIPE_CONTENT = recipesJson as RecipeContent;
export const RECIPES = RECIPE_CONTENT.recipes;
export const CLINIC_GUIDE = clinicGuideJson as ClinicGuideContent;
export const PUBLIC_CONTACT_FACTS = publicContactFactsJson as PublicContactFacts;

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

export function searchRecipes(
  query: string,
  language: ContentLanguage,
  recipes: readonly Recipe[] = RECIPES,
): Recipe[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...recipes];

  return recipes.filter((recipe) => {
    const searchable = [
      recipe.title[language],
      recipe.summary[language],
      ...recipe.ingredients[language],
    ].join(' ');
    return normalizeSearchText(searchable).includes(normalizedQuery);
  });
}

export function filterRecipes(
  recipes: readonly Recipe[],
  filters: { category?: RecipeCategory | null; tags?: readonly string[] },
): Recipe[] {
  return recipes.filter((recipe) => {
    const categoryMatches = !filters.category || recipe.categories.includes(filters.category);
    const tagsMatch = !filters.tags?.length
      || filters.tags.every((tag) => recipe.tags.includes(tag));
    return categoryMatches && tagsMatch;
  });
}

export function getRecipeBySlug(slug: string): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.slug === slug);
}

function checklistIds(guide: ClinicGuideContent): string[] {
  return guide.groups.flatMap((group) => group.items.map((item) => item.id));
}

export function createVisitChecklistState(
  guide: ClinicGuideContent,
): Record<string, boolean> {
  return Object.fromEntries(checklistIds(guide).map((id) => [id, false]));
}

export function setVisitChecklistItem(
  state: Readonly<Record<string, boolean>>,
  id: string,
  checked: boolean,
): Record<string, boolean> {
  if (!(id in state) || state[id] === checked) return { ...state };
  return { ...state, [id]: checked };
}

export function resetVisitChecklist(
  _state: Readonly<Record<string, boolean>>,
  guide: ClinicGuideContent,
): Record<string, boolean> {
  return createVisitChecklistState(guide);
}

export function canUseContactActions(facts: PublicContactFacts): boolean {
  if (facts.status !== 'owner-confirmed' || typeof facts.ownerConfirmedAt !== 'string') {
    return false;
  }
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoTimestamp.test(facts.ownerConfirmedAt) || Number.isNaN(Date.parse(facts.ownerConfirmedAt))) {
    return false;
  }

  const keys = Object.keys(facts.facts);
  if (
    keys.length !== REQUIRED_PUBLIC_CONTACT_FACT_KEYS.length
    || REQUIRED_PUBLIC_CONTACT_FACT_KEYS.some((key) => !Object.hasOwn(facts.facts, key))
  ) {
    return false;
  }

  return REQUIRED_PUBLIC_CONTACT_FACT_KEYS.every((key) => {
    const fact = facts.facts[key];
    const hasValue = Array.isArray(fact.value)
      ? fact.value.length > 0
        && fact.value.every((value) => typeof value === 'string' && value.trim().length > 0)
      : typeof fact.value === 'string' && fact.value.trim().length > 0;
    if (!hasValue || fact.sourceStatus !== 'owner-confirmed-source') return false;
    if (typeof fact.sourceUrl !== 'string' || fact.sourceUrl.trim() !== fact.sourceUrl) return false;
    try {
      return new URL(fact.sourceUrl).protocol === 'https:';
    } catch {
      return false;
    }
  });
}
