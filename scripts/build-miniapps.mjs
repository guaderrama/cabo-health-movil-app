import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPROVED_MINIAPP_SLUGS = Object.freeze(['healthy-recipes', 'clinic-guide']);
export const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; media-src 'none'";

const REQUIRED_FACT_KEYS = Object.freeze([
  'publicEmail',
  'phone',
  'whatsApp',
  'address',
  'hours',
  'appleMapsDestination',
  'serviceLanguages',
]);
const EXPECTED_RECIPE_SLUGS = Object.freeze([
  'banana-tahini-cinnamon-toast',
  'black-bean-corn-skillet',
  'chicken-zucchini-tortilla-plates',
  'jicama-orange-lime-cup',
  'lentil-rice-tomato-bowl',
  'mango-cucumber-lime-cup',
  'oats-berry-yogurt-cup',
  'pineapple-lime-agua-fresca',
  'roasted-sweet-potato-chickpea-quinoa-bowls',
  'spinach-egg-corn-tacos',
  'tuna-avocado-crisp-tostadas',
  'white-bean-tomato-pasta',
]);
const ALLOWED_CATEGORIES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'beverage']);
const ALLOWED_TAGS = new Set([
  'plant-based',
  'vegetarian',
  'contains-animal-food',
  'contains-fish',
  'contains-egg',
  'contains-sesame',
]);
const LEGAL_URLS = Object.freeze([
  'https://cabohealth.org/app/privacy/',
  'https://cabohealth.org/app/terms/',
  'https://cabohealth.org/app/support/',
  'https://cabohealth.org/app/report-content/',
]);
const SOURCE_FILES = Object.freeze([
  'clinic-guide/app.js',
  'clinic-guide/index.html',
  'healthy-recipes/app.js',
  'healthy-recipes/index.html',
  'shared/logo.png',
  'shared/motion.js',
  'shared/security-headers.conf',
  'shared/shell.js',
  'shared/styles.css',
]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/u;

function readText(path) {
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.replace(/\r\n?/gu, '\n').replace(/\n*$/u, '\n'), 'utf8');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function walkFiles(root, { ignore = new Set() } = {}) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignore.has(entry.name)) continue;
    const path = join(root, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error(`Symlinks are forbidden in miniapp artifacts: ${path}`);
    if (stats.isDirectory()) files.push(...walkFiles(path, { ignore }));
    else if (stats.isFile()) files.push(path);
    else throw new Error(`Unsupported filesystem entry in miniapps: ${path}`);
  }
  return files;
}

function normalizedRelative(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

function assertExactKeys(value, expected, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    errors.push(`${label} must contain exactly: ${wanted.join(', ')}`);
    return false;
  }
  return true;
}

function isExactHttpsUrl(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value || CONTROL_OR_BACKSLASH.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

function isExactHostUrl(value, host) {
  if (!isExactHttpsUrl(value)) return false;
  const parsed = new URL(value);
  return parsed.hostname === host && parsed.port === '';
}

export function validatePublicContactFacts(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['public contact record must be an object'];
  }
  if (record.status !== 'owner-confirmed') errors.push('status must be owner-confirmed');
  if (
    typeof record.ownerConfirmedAt !== 'string'
    || !ISO_TIMESTAMP.test(record.ownerConfirmedAt)
    || Number.isNaN(Date.parse(record.ownerConfirmedAt))
  ) errors.push('ownerConfirmedAt must be a valid ISO timestamp');

  if (!assertExactKeys(record.facts, REQUIRED_FACT_KEYS, 'facts', errors)) return errors;
  for (const key of REQUIRED_FACT_KEYS) {
    const fact = record.facts[key];
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
      errors.push(`${key} must be a fact object`);
      continue;
    }
    if (fact.sourceStatus !== 'owner-confirmed-source') {
      errors.push(`${key}.sourceStatus must be owner-confirmed-source`);
    }
    if (!isExactHttpsUrl(fact.sourceUrl)) errors.push(`${key}.sourceUrl must be an exact HTTPS URL`);

    if (key === 'serviceLanguages') {
      if (
        !Array.isArray(fact.value)
        || fact.value.length === 0
        || fact.value.some((value) => typeof value !== 'string' || !value || value.trim() !== value || CONTROL_OR_BACKSLASH.test(value))
        || new Set(fact.value).size !== fact.value.length
      ) errors.push('serviceLanguages.value must be a nonempty list of exact unique labels');
      continue;
    }
    if (typeof fact.value !== 'string' || !fact.value || fact.value.trim() !== fact.value || CONTROL_OR_BACKSLASH.test(fact.value)) {
      errors.push(`${key}.value must be exact nonblank text`);
      continue;
    }
    if (key === 'publicEmail' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(fact.value)) {
      errors.push('publicEmail.value must be a plain email address');
    }
    if (key === 'phone' && !/^\+[1-9]\d{6,14}$/u.test(fact.value)) {
      errors.push('phone.value must be an exact international phone number');
    }
    if (key === 'whatsApp') {
      const valid = isExactHostUrl(fact.value, 'wa.me')
        && /^\/\d+\/?$/u.test(new URL(fact.value).pathname)
        && new URL(fact.value).search === ''
        && new URL(fact.value).hash === '';
      if (!valid) errors.push('whatsApp.value must be an exact wa.me HTTPS URL');
    }
    if (key === 'appleMapsDestination' && !isExactHostUrl(fact.value, 'maps.apple.com')) {
      errors.push('appleMapsDestination.value must be an exact Apple Maps HTTPS URL');
    }
  }
  return errors;
}

function assertBilingualText(value, label, errors) {
  if (!assertExactKeys(value, ['en', 'es-MX'], label, errors)) return;
  for (const locale of ['en', 'es-MX']) {
    if (typeof value[locale] !== 'string' || !value[locale].trim()) {
      errors.push(`${label}.${locale} must be nonblank text`);
    }
  }
}

function assertBilingualList(value, label, errors) {
  if (!assertExactKeys(value, ['en', 'es-MX'], label, errors)) return;
  for (const locale of ['en', 'es-MX']) {
    if (!Array.isArray(value[locale]) || value[locale].length === 0 || value[locale].some((item) => typeof item !== 'string' || !item.trim())) {
      errors.push(`${label}.${locale} must be a nonempty text list`);
    }
  }
  if (Array.isArray(value.en) && Array.isArray(value['es-MX']) && value.en.length !== value['es-MX'].length) {
    errors.push(`${label} must have locale parity`);
  }
}

function validateRecipes(content) {
  const errors = [];
  if (!content || typeof content !== 'object' || Array.isArray(content)) return ['recipes content must be an object'];
  if (content.version !== '1.0.0') errors.push('recipes.version must remain 1.0.0 for this release');
  if (content.reviewedOn !== '2026-08-16') errors.push('recipes.reviewedOn must match the frozen editorial review');
  assertBilingualText(content.disclaimer, 'recipes.disclaimer', errors);
  assertBilingualText(content.foodSafety, 'recipes.foodSafety', errors);
  if (!Array.isArray(content.recipes)) return [...errors, 'recipes.recipes must be a list'];

  const slugs = content.recipes.map((recipe) => recipe?.slug).sort();
  if (JSON.stringify(slugs) !== JSON.stringify(EXPECTED_RECIPE_SLUGS)) {
    errors.push('recipes must contain exactly the twelve approved unique slugs');
  }
  const coveredCategories = new Set();
  for (const recipe of content.recipes) {
    const label = `recipe ${recipe?.slug ?? '(missing slug)'}`;
    assertBilingualText(recipe?.title, `${label}.title`, errors);
    assertBilingualText(recipe?.summary, `${label}.summary`, errors);
    assertBilingualText(recipe?.timeLabel, `${label}.timeLabel`, errors);
    assertBilingualList(recipe?.ingredients, `${label}.ingredients`, errors);
    assertBilingualList(recipe?.steps, `${label}.steps`, errors);
    assertBilingualText(recipe?.allergens, `${label}.allergens`, errors);
    assertBilingualText(recipe?.foodSafety, `${label}.foodSafety`, errors);
    assertBilingualText(recipe?.editorialNote, `${label}.editorialNote`, errors);
    if (!Number.isInteger(recipe?.timeMinutes) || recipe.timeMinutes <= 0) errors.push(`${label}.timeMinutes must be positive`);
    if (!Number.isInteger(recipe?.servings) || recipe.servings <= 0) errors.push(`${label}.servings must be positive`);
    if (!Array.isArray(recipe?.categories) || recipe.categories.length === 0 || recipe.categories.some((item) => !ALLOWED_CATEGORIES.has(item))) {
      errors.push(`${label}.categories contains an unknown value`);
    } else recipe.categories.forEach((item) => coveredCategories.add(item));
    if (!Array.isArray(recipe?.tags) || recipe.tags.length === 0 || recipe.tags.some((item) => !ALLOWED_TAGS.has(item))) {
      errors.push(`${label}.tags contains an unknown value`);
    }
  }
  for (const category of ['breakfast', 'lunch', 'dinner', 'snack']) {
    if (!coveredCategories.has(category)) errors.push(`recipes must cover ${category}`);
  }

  const serialized = JSON.stringify(content);
  for (const pattern of [
    /\b(?:diagnoses?|diagnostica|diagnosticar)\b/iu,
    /\b(?:dosage|dosing|dosificaci[oó]n)\b/iu,
    /\b(?:patient portal|medical record|portal de pacientes|expediente cl[ií]nico)\b/iu,
    /\b(?:analytics|tracking|advertising|publicidad|rastreo)\b/iu,
    /\b(?:buy now|purchase|subscribe|comprar ahora|suscr[ií]bete)\b/iu,
    /\b(?:cures?|prevents?|treats?)\s+(?:disease|illness|cancer|diabetes)\b/iu,
    /\b(?:cura|previene|trata)\s+(?:enfermedad|c[aá]ncer|diabetes)\b/iu,
  ]) {
    if (pattern.test(serialized)) errors.push(`recipes contain prohibited language matching ${pattern}`);
  }
  return errors;
}

function validateSourceInventory(projectRoot) {
  const miniappsRoot = join(projectRoot, 'miniapps');
  const sourceFiles = walkFiles(miniappsRoot, { ignore: new Set(['dist', '.dist-stage']) })
    .map((path) => normalizedRelative(miniappsRoot, path))
    .sort();
  if (JSON.stringify(sourceFiles) !== JSON.stringify(SOURCE_FILES)) {
    throw new Error(`MINIAPP_SOURCE_INVENTORY_INVALID\nExpected ${SOURCE_FILES.join(', ')}\nFound ${sourceFiles.join(', ')}`);
  }
  const sourceRoots = readdirSync(miniappsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !['dist', '.dist-stage', 'shared'].includes(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(sourceRoots) !== JSON.stringify([...APPROVED_MINIAPP_SLUGS].sort())) {
    throw new Error(`MINIAPP_SOURCE_ROOTS_INVALID: ${sourceRoots.join(', ')}`);
  }

  const sharedHeaders = readText(join(miniappsRoot, 'shared/security-headers.conf'));
  const hostingHeaders = readText(join(projectRoot, 'web-hosting/cabohealth.org/apps/.htaccess'));
  if (sharedHeaders !== hostingHeaders || !sharedHeaders.includes(`Content-Security-Policy "${CONTENT_SECURITY_POLICY}"`)) {
    throw new Error('MINIAPP_SECURITY_HEADERS_DIVERGED');
  }
  if (sha256(readFileSync(join(miniappsRoot, 'shared/logo.png'))) !== sha256(readFileSync(join(projectRoot, 'assets/logo.png')))) {
    throw new Error('MINIAPP_LOGO_MUST_MATCH_LICENSED_LOCAL_ASSET');
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderList(items, { ordered = false } = {}) {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>\n${items.map((item) => `                <li>${escapeHtml(item)}</li>`).join('\n')}\n              </${tag}>`;
}

const CATEGORY_LABELS = {
  breakfast: { en: 'Breakfast', 'es-MX': 'Desayuno' },
  lunch: { en: 'Lunch', 'es-MX': 'Comida' },
  dinner: { en: 'Dinner', 'es-MX': 'Cena' },
  snack: { en: 'Snack', 'es-MX': 'Botana' },
  beverage: { en: 'Beverage', 'es-MX': 'Bebida' },
};

function renderRecipeLocale(recipe, locale) {
  const english = locale === 'en';
  const detailLabel = english ? 'Recipe details' : 'Detalles de la receta';
  const ingredientsLabel = english ? 'Ingredients' : 'Ingredientes';
  const stepsLabel = english ? 'Steps' : 'Pasos';
  const allergensLabel = english ? 'Allergens' : 'Alérgenos';
  const safetyLabel = english ? 'Safe handling and storage' : 'Manejo y almacenamiento seguro';
  const servingsLabel = english ? 'servings' : 'porciones';
  const favoriteLabel = english ? 'Save recipe' : 'Guardar receta';
  return [
    `        <section lang="${locale}" data-locale="${locale}">`,
    `          <h3>${escapeHtml(recipe.title[locale])}</h3>`,
    `          <p class="recipe-summary">${escapeHtml(recipe.summary[locale])}</p>`,
    '          <ul class="recipe-meta">',
    `            <li>${escapeHtml(recipe.timeLabel[locale])}</li>`,
    `            <li>${recipe.servings} ${servingsLabel}</li>`,
    ...recipe.categories.map((category) => `            <li>${CATEGORY_LABELS[category][locale]}</li>`),
    '          </ul>',
    `          <button class="favorite-button" type="button" data-favorite-recipe="${recipe.slug}" aria-pressed="false" disabled>${favoriteLabel}</button>`,
    '          <details open>',
    `            <summary>${detailLabel}</summary>`,
    `            <h4>${ingredientsLabel}</h4>`,
    renderList(recipe.ingredients[locale]),
    `            <h4>${stepsLabel}</h4>`,
    renderList(recipe.steps[locale], { ordered: true }),
    `            <h4>${allergensLabel}</h4>`,
    `            <p>${escapeHtml(recipe.allergens[locale])}</p>`,
    `            <h4>${safetyLabel}</h4>`,
    `            <p class="safety-note">${escapeHtml(recipe.foodSafety[locale])}</p>`,
    `            <p>${escapeHtml(recipe.editorialNote[locale])}</p>`,
    '          </details>',
    '        </section>',
  ].join('\n');
}

function renderRecipe(recipe) {
  const searchableEn = [recipe.title.en, recipe.summary.en, ...recipe.ingredients.en, ...recipe.categories].join(' ');
  const searchableEs = [recipe.title['es-MX'], recipe.summary['es-MX'], ...recipe.ingredients['es-MX'], ...recipe.categories].join(' ');
  return [
    `      <article class="recipe-card" data-recipe-slug="${recipe.slug}" data-categories="${recipe.categories.join(' ')}" data-search-en="${escapeHtml(searchableEn)}" data-search-es="${escapeHtml(searchableEs)}">`,
    renderRecipeLocale(recipe, 'en'),
    renderRecipeLocale(recipe, 'es-MX'),
    '      </article>',
  ].join('\n');
}

function replaceToken(template, token, value) {
  const marker = `{{${token}}}`;
  const first = template.indexOf(marker);
  if (first === -1 || template.indexOf(marker, first + marker.length) !== -1) {
    throw new Error(`Template must contain exactly one ${marker}`);
  }
  return template.replace(marker, value);
}

export function renderHealthyRecipesDocument(template, content) {
  const replacements = {
    CSP: CONTENT_SECURITY_POLICY,
    RECIPE_ARTICLES: content.recipes.map(renderRecipe).join('\n'),
    FOOD_SAFETY_EN: escapeHtml(content.foodSafety.en),
    FOOD_SAFETY_ES: escapeHtml(content.foodSafety['es-MX']),
    DISCLAIMER_EN: escapeHtml(content.disclaimer.en),
    DISCLAIMER_ES: escapeHtml(content.disclaimer['es-MX']),
    REVIEWED_ON: escapeHtml(content.reviewedOn),
    REVIEWED_ON_ISO: escapeHtml(content.reviewedOn),
    SOURCE_ITEMS: content.sources.map((source) => `            <li>${escapeHtml(source.title)}</li>`).join('\n'),
  };
  let html = template;
  for (const [token, value] of Object.entries(replacements)) html = replaceToken(html, token, value);
  if (/\{\{[A-Z0-9_]+\}\}/u.test(html)) throw new Error('Unresolved token in Healthy Recipes output');
  return html;
}

function parseAttributes(source) {
  const attributes = new Map();
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function validateLocalReference(value, filePath, outputRoot) {
  if (!value || CONTROL_OR_BACKSLASH.test(value) || /^\/\//u.test(value) || /%(?:2f|5c|00)/iu.test(value)) return false;
  if (value.startsWith('#')) return true;
  let parsed;
  try {
    parsed = new URL(value, `https://miniapps.invalid/${normalizedRelative(outputRoot, dirname(filePath))}/`);
  } catch {
    return false;
  }
  return parsed.origin === 'https://miniapps.invalid'
    && parsed.pathname.startsWith('/apps/')
    && !parsed.pathname.split('/').includes('..');
}

function validateHtml(html, filePath, outputRoot, expectedSlug, errors) {
  if (html.charCodeAt(0) === 0xfeff) errors.push(`${filePath}: BOM is forbidden`);
  if (/\{\{[A-Z0-9_]+\}\}/u.test(html)) errors.push(`${filePath}: unresolved build token`);
  if (!html.startsWith('<!doctype html>\n')) errors.push(`${filePath}: deterministic doctype/LF missing`);
  const allowedNavigations = new Set([
    `https://cabohealth.org/apps/${expectedSlug}/`,
    ...LEGAL_URLS,
    '#main-content',
  ]);

  for (const tagMatch of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/giu)) {
    const tag = tagMatch[1].toLowerCase();
    const attributes = parseAttributes(tagMatch[2]);
    if (['base', 'embed', 'form', 'iframe', 'object', 'style'].includes(tag)) errors.push(`${filePath}: forbidden <${tag}>`);
    if (attributes.has('target') || attributes.has('ping') || attributes.has('action') || attributes.has('formaction')) {
      errors.push(`${filePath}: forbidden navigation/form attribute on <${tag}>`);
    }
    if (tag === 'meta' && attributes.get('http-equiv')?.toLowerCase() === 'refresh') {
      errors.push(`${filePath}: meta refresh is forbidden`);
    }
    for (const name of ['src', 'poster']) {
      if (attributes.has(name) && !validateLocalReference(attributes.get(name), filePath, outputRoot)) {
        errors.push(`${filePath}: non-local ${name} on <${tag}>`);
      }
    }
    if (attributes.has('srcset')) {
      for (const candidate of attributes.get('srcset').split(',').map((part) => part.trim().split(/\s+/u)[0])) {
        if (!validateLocalReference(candidate, filePath, outputRoot)) errors.push(`${filePath}: non-local srcset candidate`);
      }
    }
    if (attributes.has('style')) errors.push(`${filePath}: inline style is forbidden`);
    if (attributes.has('href')) {
      const href = attributes.get('href');
      if (tag === 'a') {
        if (!allowedNavigations.has(href)) errors.push(`${filePath}: unapproved anchor ${href}`);
      } else if (tag === 'link') {
        const rel = attributes.get('rel')?.toLowerCase();
        if (rel === 'canonical') {
          if (href !== `https://cabohealth.org/apps/${expectedSlug}/`) errors.push(`${filePath}: wrong canonical URL`);
        } else if (!validateLocalReference(href, filePath, outputRoot)) {
          errors.push(`${filePath}: non-local link resource`);
        }
      } else errors.push(`${filePath}: href on unsupported <${tag}>`);
    }
  }

  const cspMeta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u);
  if (!cspMeta || cspMeta[1] !== CONTENT_SECURITY_POLICY) errors.push(`${filePath}: CSP meta differs from canonical policy`);
  if (/<script\b(?![^>]*\bsrc=)[^>]*>/iu.test(html)) errors.push(`${filePath}: inline script is forbidden`);
  if (/\son[a-z]+\s*=/iu.test(html)) errors.push(`${filePath}: inline event handler is forbidden`);
  if (/<article\b[^>]*data-recipe-slug[^>]*\shidden(?:\s|=|>)/iu.test(html)) errors.push(`${filePath}: canonical recipe cannot start hidden`);
}

function validateJavaScript(source, filePath, outputRoot, errors) {
  for (const [label, pattern] of [
    ['fetch', /\bfetch\s*\(/u],
    ['XHR', /\bXMLHttpRequest\b/u],
    ['EventSource', /\bEventSource\b/u],
    ['WebSocket', /\bWebSocket\b/u],
    ['Worker', /\b(?:SharedWorker|Worker)\s*\(/u],
    ['service worker', /\bserviceWorker\s*\./u],
    ['sendBeacon', /\bsendBeacon\s*\(/u],
    ['window.open', /\bwindow\s*\.\s*open\s*\(/u],
    ['dynamic import', /\bimport\s*\(/u],
    ['location redirect', /\b(?:window\s*\.\s*)?location\s*(?:=|\.\s*(?:assign|replace)\s*\(|\.\s*href\s*=)/u],
  ]) {
    if (pattern.test(source)) errors.push(`${filePath}: forbidden ${label}`);
  }
  for (const match of source.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu)) {
    if (!validateLocalReference(match[1], filePath, outputRoot)) errors.push(`${filePath}: non-local static import`);
  }
}

function validateCss(source, filePath, errors) {
  if (/@import\b/iu.test(source)) errors.push(`${filePath}: CSS imports are forbidden`);
  if (/url\s*\(/iu.test(source)) errors.push(`${filePath}: CSS URL resources are forbidden`);
  if (!/:focus-visible\b/u.test(source)) errors.push(`${filePath}: focus-visible branch missing`);
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/u.test(source)) errors.push(`${filePath}: reduced-motion branch missing`);
}

export function verifyBuiltArtifact({ outputRoot, expectedEntrySlugs }) {
  const root = resolve(outputRoot);
  const expected = [...expectedEntrySlugs];
  if (expected.some((slug) => !APPROVED_MINIAPP_SLUGS.includes(slug)) || new Set(expected).size !== expected.length) {
    throw new Error('Expected artifact roots must be unique approved miniapps');
  }
  const files = walkFiles(root);
  const relativeFiles = files.map((path) => normalizedRelative(root, path));
  const entries = relativeFiles
    .filter((path) => /^apps\/[^/]+\/index\.html$/u.test(path))
    .map((path) => path.split('/')[1])
    .sort();
  if (JSON.stringify(entries) !== JSON.stringify([...expected].sort())) {
    throw new Error(`MINIAPP_OUTPUT_ROOTS_INVALID: ${entries.join(', ')}`);
  }

  const allowedFiles = new Set([
    'apps/.htaccess',
    'apps/shared/logo.png',
    'apps/shared/motion.js',
    'apps/shared/shell.js',
    'apps/shared/styles.css',
    'manifest.json',
    ...expected.flatMap((slug) => [`apps/${slug}/app.js`, `apps/${slug}/index.html`]),
  ]);
  const unknown = relativeFiles.filter((path) => !allowedFiles.has(path));
  if (unknown.length > 0) throw new Error(`UNKNOWN_MINIAPP_ARTIFACTS: ${unknown.join(', ')}`);
  for (const required of [...allowedFiles].filter((path) => path !== 'manifest.json')) {
    if (!relativeFiles.includes(required)) throw new Error(`MISSING_MINIAPP_ARTIFACT: ${required}`);
  }

  const errors = [];
  for (const slug of expected) {
    const path = join(root, `apps/${slug}/index.html`);
    validateHtml(readText(path), path, root, slug, errors);
    validateJavaScript(readText(join(root, `apps/${slug}/app.js`)), join(root, `apps/${slug}/app.js`), root, errors);
  }
  validateJavaScript(readText(join(root, 'apps/shared/motion.js')), join(root, 'apps/shared/motion.js'), root, errors);
  validateJavaScript(readText(join(root, 'apps/shared/shell.js')), join(root, 'apps/shared/shell.js'), root, errors);
  validateCss(readText(join(root, 'apps/shared/styles.css')), join(root, 'apps/shared/styles.css'), errors);
  const headers = readText(join(root, 'apps/.htaccess'));
  const headerMatch = headers.match(/Header always set Content-Security-Policy "([^"]+)"/u);
  if (!headerMatch || headerMatch[1] !== CONTENT_SECURITY_POLICY) errors.push('Apache CSP differs from canonical policy');
  if (errors.length > 0) throw new Error(`MINIAPP_ARTIFACT_VERIFICATION_FAILED\n${errors.join('\n')}`);
  return true;
}

function inventoryFor(root) {
  return walkFiles(root)
    .filter((path) => normalizedRelative(root, path) !== 'manifest.json')
    .map((path) => {
      const bytes = readFileSync(path);
      return {
        path: normalizedRelative(root, path),
        size: bytes.byteLength,
        sha256: sha256(bytes),
      };
    });
}

function isStrictDescendant(parent, child) {
  const relation = relative(parent, child);
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
}

export function assertSafeMiniappOutputPath({ projectRoot, outputRoot }) {
  const project = resolve(projectRoot);
  const target = resolve(outputRoot);
  const canonical = resolve(project, 'miniapps/dist');
  const temporaryRoot = resolve(tmpdir());
  const tempRelation = relative(temporaryRoot, target).replaceAll('\\', '/');
  const isolatedTemp = isStrictDescendant(temporaryRoot, target)
    && /^cabohealth-[^/]+(?:\/|$)/u.test(tempRelation);
  if (target !== canonical && !isolatedTemp) {
    throw new Error(`Refusing unsafe miniapp output path: ${target}`);
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error('Refusing unsafe miniapp output path: target is a symlink');
  }
  return target;
}

export async function buildMiniapps({
  projectRoot,
  outputRoot,
  mode,
  contactFacts,
}) {
  const root = resolve(projectRoot);
  const target = assertSafeMiniappOutputPath({ projectRoot: root, outputRoot });
  if (!['healthy', 'release'].includes(mode)) throw new Error(`Unknown miniapp build mode: ${mode}`);

  validateSourceInventory(root);
  const recipes = readJson(join(root, 'content/recipes.json'));
  const recipeErrors = validateRecipes(recipes);
  if (recipeErrors.length > 0) throw new Error(`MINIAPP_RECIPE_CONTENT_INVALID\n${recipeErrors.join('\n')}`);

  if (mode === 'release') {
    const facts = contactFacts ?? readJson(join(root, 'release/public-contact-facts.json'));
    const contactErrors = validatePublicContactFacts(facts);
    if (contactErrors.length > 0) {
      throw new Error(`PUBLIC_CONTACT_FACTS_INCOMPLETE\n${contactErrors.join('\n')}`);
    }
    throw new Error('CLINIC_GUIDE_TASK_6B_PENDING: confirmed facts pass validation, but the deployable Clinic Guide renderer is intentionally not part of Task 6A');
  }

  const stage = join(dirname(target), `.${basename(target)}.stage`);
  if (existsSync(stage) && lstatSync(stage).isSymbolicLink()) throw new Error('Miniapp staging root cannot be a symlink');
  rmSync(stage, { recursive: true, force: true });
  try {
    mkdirSync(join(stage, 'apps/healthy-recipes'), { recursive: true });
    mkdirSync(join(stage, 'apps/shared'), { recursive: true });
    const template = readText(join(root, 'miniapps/healthy-recipes/index.html'));
    writeText(join(stage, 'apps/healthy-recipes/index.html'), renderHealthyRecipesDocument(template, recipes));
    copyFileSync(join(root, 'miniapps/healthy-recipes/app.js'), join(stage, 'apps/healthy-recipes/app.js'));
    for (const file of ['styles.css', 'motion.js', 'shell.js', 'logo.png']) {
      copyFileSync(join(root, `miniapps/shared/${file}`), join(stage, `apps/shared/${file}`));
    }
    copyFileSync(join(root, 'web-hosting/cabohealth.org/apps/.htaccess'), join(stage, 'apps/.htaccess'));
    verifyBuiltArtifact({ outputRoot: stage, expectedEntrySlugs: ['healthy-recipes'] });

    const manifest = {
      schemaVersion: 1,
      mode: 'healthy-only-task-6a',
      sourceVersion: recipes.version,
      reviewedOn: recipes.reviewedOn,
      entrySlugs: ['healthy-recipes'],
      blockedEntrySlugs: ['clinic-guide'],
      releaseReady: false,
      files: inventoryFor(stage),
    };
    writeText(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    verifyBuiltArtifact({ outputRoot: stage, expectedEntrySlugs: ['healthy-recipes'] });

    rmSync(target, { recursive: true, force: true });
    renameSync(stage, target);
    return manifest;
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

async function runCli() {
  const flag = process.argv[2];
  if (!['--healthy', '--release'].includes(flag) || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/build-miniapps.mjs --healthy|--release');
  }
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputRoot = resolve(projectRoot, 'miniapps/dist');
  const manifest = await buildMiniapps({
    projectRoot,
    outputRoot,
    mode: flag === '--healthy' ? 'healthy' : 'release',
  });
  console.log(`Built ${manifest.entrySlugs.join(', ')} into miniapps/dist (Task 6A; not release-ready).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
