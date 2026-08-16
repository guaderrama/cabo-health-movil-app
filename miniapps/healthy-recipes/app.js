import { mountNetworkMotion } from '../shared/motion.js';
import { mountShell } from '../shared/shell.js';

const FAVORITES_KEY = 'cabohealth.web.recipe-favorites.v1';
const page = document;
const shell = mountShell({ document: page, storage: window.localStorage });
const motion = mountNetworkMotion({ document: page, language: shell.getLanguage });
const search = page.querySelector('[data-recipe-search]');
const filterButtons = [...page.querySelectorAll('[data-recipe-filter]')];
const recipeCards = [...page.querySelectorAll('[data-recipe-slug]')];
const favoriteButtons = [...page.querySelectorAll('[data-favorite-recipe]')];
const count = page.querySelector('[data-result-count]');
let selectedFilter = 'all';
let favorites = readFavorites();

function readFavorites() {
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((slug) => typeof slug === 'string') : []);
  } catch {
    return new Set();
  }
}

function persistFavorites() {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites].sort()));
  } catch {
    // Favorites remain usable for this visit if local storage is unavailable.
  }
}

function visibleTextFor(card) {
  return shell.getLanguage() === 'es-MX' ? card.dataset.searchEs : card.dataset.searchEn;
}

function updateResultCount(visible) {
  if (!count) return;
  const language = shell.getLanguage();
  count.textContent = language === 'es-MX'
    ? `${visible} de ${recipeCards.length} recetas visibles`
    : `${visible} of ${recipeCards.length} recipes shown`;
}

function applyFilters() {
  const query = search?.value.trim().toLocaleLowerCase(shell.getLanguage()) ?? '';
  let visible = 0;
  for (const card of recipeCards) {
    const categories = card.dataset.categories.split(' ');
    const matchesCategory = selectedFilter === 'all' || categories.includes(selectedFilter);
    const matchesQuery = !query || visibleTextFor(card).toLocaleLowerCase(shell.getLanguage()).includes(query);
    const show = matchesCategory && matchesQuery;
    card.classList.toggle('is-filtered-out', !show);
    card.setAttribute('aria-hidden', String(!show));
    if (show) visible += 1;
  }
  updateResultCount(visible);
}

function updateFavoriteButtons() {
  for (const button of favoriteButtons) {
    const selected = favorites.has(button.dataset.favoriteRecipe);
    button.disabled = false;
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = shell.getLanguage() === 'es-MX'
      ? (selected ? 'Guardada' : 'Guardar receta')
      : (selected ? 'Saved' : 'Save recipe');
  }
}

function onFilterClick(event) {
  selectedFilter = event.currentTarget.dataset.recipeFilter;
  for (const button of filterButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.recipeFilter === selectedFilter));
  }
  applyFilters();
}

function onFavoriteClick(event) {
  const slug = event.currentTarget.dataset.favoriteRecipe;
  if (favorites.has(slug)) favorites.delete(slug);
  else favorites.add(slug);
  persistFavorites();
  updateFavoriteButtons();
}

function onLanguageChange() {
  updateFavoriteButtons();
  applyFilters();
}

search.disabled = false;
search.addEventListener('input', applyFilters);
for (const button of filterButtons) {
  button.disabled = false;
  button.addEventListener('click', onFilterClick);
}
for (const button of favoriteButtons) {
  button.addEventListener('click', onFavoriteClick);
}
page.addEventListener('cabohealth:languagechange', onLanguageChange);
updateFavoriteButtons();
applyFilters();

window.addEventListener('pagehide', () => {
  search.removeEventListener('input', applyFilters);
  for (const button of filterButtons) button.removeEventListener('click', onFilterClick);
  for (const button of favoriteButtons) button.removeEventListener('click', onFavoriteClick);
  page.removeEventListener('cabohealth:languagechange', onLanguageChange);
  motion.destroy();
  shell.destroy();
}, { once: true });
