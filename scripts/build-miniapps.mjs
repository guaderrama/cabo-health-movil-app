import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const APPROVED_MINIAPP_SLUGS = Object.freeze(['healthy-recipes', 'clinic-guide']);
export const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; media-src 'none'";
const IMMUTABLE_ARTIFACT_PREFIX = '.dist-artifact-';
const IMMUTABLE_ARTIFACT_NAME = /^\.dist-artifact-[a-f0-9]{48}\.capsule$/u;
const LEGACY_CONTROLLED_BUILD_NAMES = Object.freeze(['.dist-stage', '.dist-stage.prepare']);
const TASK6A_CAPSULE_KIND = 'cabohealth-miniapps-task-6a-capsule-v1';
export const MINIAPP_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
});
export const MINIAPP_APACHE_SECURITY_CONFIG = [
  'Options -Indexes',
  '<IfModule mod_headers.c>',
  `  Header always set Content-Security-Policy "${MINIAPP_SECURITY_HEADERS['Content-Security-Policy']}"`,
  `  Header always set X-Content-Type-Options "${MINIAPP_SECURITY_HEADERS['X-Content-Type-Options']}"`,
  `  Header always set X-Frame-Options "${MINIAPP_SECURITY_HEADERS['X-Frame-Options']}"`,
  `  Header always set Referrer-Policy "${MINIAPP_SECURITY_HEADERS['Referrer-Policy']}"`,
  `  Header always set Permissions-Policy "${MINIAPP_SECURITY_HEADERS['Permissions-Policy']}"`,
  '</IfModule>',
  '',
].join('\n');

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
const TASK6A_REVIEWED_SOURCE_SHA256 = Object.freeze({
  'assets/logo.png': 'e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117',
  'content/recipes.json': 'fbc9c338341653e87a744ae11906a1995ea642aa094ef4aaaf418f6bc819b9cf',
  'miniapps/clinic-guide/app.js': '4f2f8fde380201d94bfe8c3b69674068e8c5ee11bb1e1600029eebcab27bec9b',
  'miniapps/clinic-guide/index.html': '7742f1ebad943bec481d5d950909eb973083b4bc2e4f01380eecb05678117f4e',
  'miniapps/healthy-recipes/app.js': '70a2537bcf2b858eef98535cc48e691fbd081bd3e180347207aecfc04550e090',
  'miniapps/healthy-recipes/index.html': 'b957146425693d892808044faed006cb991eeb8695ddb522baa625ffb319a481',
  'miniapps/shared/logo.png': 'e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117',
  'miniapps/shared/motion.js': '9ac97593f7339f6b7f1b9f4da6dafed4084185440022604b75754377291e56b7',
  'miniapps/shared/security-headers.conf': '0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da',
  'miniapps/shared/shell.js': 'd53f7caab7fbcaee1739b5aada9773b443289022f8e9c3b11578b84ab98a3103',
  'miniapps/shared/styles.css': '1cfcd2166aebba9c02016441a8115333de2633792873b22ace3c8bb3cc8ad04d',
  'web-hosting/cabohealth.org/apps/.htaccess': '0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da',
});
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/u;

function readText(path) {
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function normalizedText(value) {
  return value.replace(/\r\n?/gu, '\n').replace(/\n*$/u, '\n');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error(`Symlinks are forbidden in miniapp artifacts: ${path}`);
    if (stats.isDirectory()) files.push(...walkFiles(path));
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
  const rootEntries = readdirSync(miniappsRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const controlledEntry = ({ name }) => name === 'dist' || IMMUTABLE_ARTIFACT_NAME.test(name);
  for (const entry of rootEntries.filter(controlledEntry)) {
    const path = join(miniappsRoot, entry.name);
    const stats = lstatSync(path);
    const validDist = entry.name === 'dist' && (stats.isDirectory() || stats.isFile());
    const validImmutableCandidate = IMMUTABLE_ARTIFACT_NAME.test(entry.name) && stats.isFile();
    if (stats.isSymbolicLink() || (!validDist && !validImmutableCandidate)) {
      throw new Error(`Controlled miniapp build entry has an unsafe type: ${path}`);
    }
  }
  const sourceFiles = rootEntries
    .filter((entry) => !controlledEntry(entry))
    .flatMap((entry) => {
      const path = join(miniappsRoot, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error(`Symlinks are forbidden in miniapp sources: ${path}`);
      return stats.isDirectory() ? walkFiles(path) : [path];
    })
    .map((path) => normalizedRelative(miniappsRoot, path))
    .sort();
  if (JSON.stringify(sourceFiles) !== JSON.stringify(SOURCE_FILES)) {
    throw new Error(`MINIAPP_SOURCE_INVENTORY_INVALID\nExpected ${SOURCE_FILES.join(', ')}\nFound ${sourceFiles.join(', ')}`);
  }
  const sourceRoots = rootEntries
    .filter((entry) => entry.isDirectory() && !controlledEntry(entry) && entry.name !== 'shared')
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(sourceRoots) !== JSON.stringify([...APPROVED_MINIAPP_SLUGS].sort())) {
    throw new Error(`MINIAPP_SOURCE_ROOTS_INVALID: ${sourceRoots.join(', ')}`);
  }

  const sharedHeaders = readText(join(miniappsRoot, 'shared/security-headers.conf'));
  const hostingHeaders = readText(join(projectRoot, 'web-hosting/cabohealth.org/apps/.htaccess'));
  if (
    sharedHeaders !== MINIAPP_APACHE_SECURITY_CONFIG
    || hostingHeaders !== MINIAPP_APACHE_SECURITY_CONFIG
  ) {
    throw new Error('MINIAPP_SECURITY_HEADERS_DIVERGED');
  }
  if (sha256(readFileSync(join(miniappsRoot, 'shared/logo.png'))) !== sha256(readFileSync(join(projectRoot, 'assets/logo.png')))) {
    throw new Error('MINIAPP_LOGO_MUST_MATCH_LICENSED_LOCAL_ASSET');
  }
  // Interrupted candidates must not wedge a later build, but their names are
  // not a hiding place: createHealthyArtifactPlan subsequently requires every
  // residue to be a private exact byte-prefix of the one pinned capsule.
  return rootEntries
    .filter(({ name }) => IMMUTABLE_ARTIFACT_NAME.test(name))
    .map(({ name }) => join(miniappsRoot, name));
}

function validateReviewedSourceAttestation(projectRoot) {
  for (const [relativePath, expectedHash] of Object.entries(TASK6A_REVIEWED_SOURCE_SHA256)) {
    const path = join(projectRoot, relativePath);
    const stats = lstatIfPresent(path);
    if (!stats?.isFile() || stats.isSymbolicLink() || sha256(readFileSync(path)) !== expectedHash) {
      throw new Error(`MINIAPP_REVIEWED_SOURCE_ATTESTATION_FAILED: ${relativePath}`);
    }
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

const TASK6A_ENTRY_SLUGS = Object.freeze(['healthy-recipes']);
const TASK6A_BLOCKED_SLUGS = Object.freeze(['clinic-guide']);
const TASK6A_REVIEWED_ARTIFACTS = Object.freeze({
  'apps/.htaccess': Object.freeze({
    size: 568,
    sha256: '0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da',
  }),
  'apps/healthy-recipes/app.js': Object.freeze({
    size: 4049,
    sha256: '70a2537bcf2b858eef98535cc48e691fbd081bd3e180347207aecfc04550e090',
  }),
  'apps/healthy-recipes/index.html': Object.freeze({
    size: 55957,
    sha256: '5f22027afcd1600fa36cd77974d48b6d2ddc4fe26e27fcf57f206a8520413829',
  }),
  'apps/shared/logo.png': Object.freeze({
    size: 13598,
    sha256: 'e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117',
  }),
  'apps/shared/motion.js': Object.freeze({
    size: 8996,
    sha256: '9ac97593f7339f6b7f1b9f4da6dafed4084185440022604b75754377291e56b7',
  }),
  'apps/shared/shell.js': Object.freeze({
    size: 3769,
    sha256: 'd53f7caab7fbcaee1739b5aada9773b443289022f8e9c3b11578b84ab98a3103',
  }),
  'apps/shared/styles.css': Object.freeze({
    size: 8715,
    sha256: '1cfcd2166aebba9c02016441a8115333de2633792873b22ace3c8bb3cc8ad04d',
  }),
});
const TASK6A_ARTIFACT_PATHS = Object.freeze(Object.keys(TASK6A_REVIEWED_ARTIFACTS));
const TASK6A_MANIFEST_KEYS = Object.freeze([
  'blockedEntrySlugs',
  'entrySlugs',
  'files',
  'mode',
  'releaseReady',
  'reviewedOn',
  'schemaVersion',
  'sourceVersion',
]);

function expectedHealthyArtifactFiles(projectRoot, recipes) {
  const values = new Map([
    ['apps/.htaccess', readFileSync(join(projectRoot, 'web-hosting/cabohealth.org/apps/.htaccess'))],
    ['apps/healthy-recipes/app.js', readFileSync(join(projectRoot, 'miniapps/healthy-recipes/app.js'))],
    [
      'apps/healthy-recipes/index.html',
      Buffer.from(normalizedText(renderHealthyRecipesDocument(
        readText(join(projectRoot, 'miniapps/healthy-recipes/index.html')),
        recipes,
      )), 'utf8'),
    ],
    ['apps/shared/logo.png', readFileSync(join(projectRoot, 'miniapps/shared/logo.png'))],
    ['apps/shared/motion.js', readFileSync(join(projectRoot, 'miniapps/shared/motion.js'))],
    ['apps/shared/shell.js', readFileSync(join(projectRoot, 'miniapps/shared/shell.js'))],
    ['apps/shared/styles.css', readFileSync(join(projectRoot, 'miniapps/shared/styles.css'))],
  ]);
  return new Map([...values.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function assertReviewedArtifactBuffers(files) {
  if (!isDeepStrictEqual([...files.keys()], TASK6A_ARTIFACT_PATHS)) {
    throw new Error('MINIAPP_REVIEWED_ARTIFACT_ATTESTATION_FAILED: exact file set required');
  }
  for (const [path, bytes] of files) {
    const reviewed = TASK6A_REVIEWED_ARTIFACTS[path];
    if (bytes.byteLength !== reviewed.size || sha256(bytes) !== reviewed.sha256) {
      throw new Error(`MINIAPP_REVIEWED_ARTIFACT_ATTESTATION_FAILED: ${path}`);
    }
  }
}

function inventoryForBuffers(files) {
  return [...files.entries()].map(([path, bytes]) => ({
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
  }));
}

function healthyManifest(recipes, files) {
  return {
    schemaVersion: 1,
    mode: 'healthy-only-task-6a',
    sourceVersion: recipes.version,
    reviewedOn: recipes.reviewedOn,
    entrySlugs: [...TASK6A_ENTRY_SLUGS],
    blockedEntrySlugs: [...TASK6A_BLOCKED_SLUGS],
    releaseReady: false,
    files: inventoryForBuffers(files),
  };
}

function assertExactManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('MINIAPP_MANIFEST_INVALID: manifest must be an object');
  }
  const keys = Object.keys(manifest).sort();
  if (!isDeepStrictEqual(keys, [...TASK6A_MANIFEST_KEYS].sort())) {
    throw new Error(`MINIAPP_MANIFEST_INVALID: exact keys required (${TASK6A_MANIFEST_KEYS.join(', ')})`);
  }
  if (!Array.isArray(manifest.files)) throw new Error('MINIAPP_MANIFEST_INVALID: files must be an array');
  const paths = [];
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !isDeepStrictEqual(Object.keys(entry).sort(), ['path', 'sha256', 'size'])) {
      throw new Error('MINIAPP_MANIFEST_INVALID: each file requires exactly path, size and sha256');
    }
    if (
      typeof entry.path !== 'string'
      || !entry.path
      || entry.path.startsWith('/')
      || entry.path.includes('\\')
      || entry.path.split('/').some((part) => !part || part === '.' || part === '..')
      || typeof entry.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(entry.sha256)
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
    ) throw new Error('MINIAPP_MANIFEST_INVALID: malformed file inventory entry');
    paths.push(entry.path);
  }
  if (!isDeepStrictEqual(paths, [...paths].sort()) || new Set(paths).size !== paths.length) {
    throw new Error('MINIAPP_MANIFEST_INVALID: file paths must be unique and sorted');
  }
}

function parseCanonicalManifest(root) {
  const manifestBytes = readFileSync(join(root, 'manifest.json'));
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('MINIAPP_MANIFEST_INVALID: manifest must be canonical JSON');
  }
  assertExactManifestShape(manifest);
  if (!manifestBytes.equals(Buffer.from(normalizedText(JSON.stringify(manifest, null, 2)), 'utf8'))) {
    throw new Error('MINIAPP_MANIFEST_BYTES_NONCANONICAL');
  }
  return { manifest, manifestBytes };
}

export function createHealthyArtifactPlan(projectRoot) {
  const root = realpathSync(resolve(projectRoot));
  const immutableCandidateResidues = validateSourceInventory(root);
  validateReviewedSourceAttestation(root);
  const recipes = readJson(join(root, 'content/recipes.json'));
  const recipeErrors = validateRecipes(recipes);
  if (recipeErrors.length > 0) throw new Error(`MINIAPP_RECIPE_CONTENT_INVALID\n${recipeErrors.join('\n')}`);
  const files = expectedHealthyArtifactFiles(root, recipes);
  assertReviewedArtifactBuffers(files);
  const manifest = healthyManifest(recipes, files);
  const plan = Object.freeze({ files, manifest, projectRoot: root });
  validateImmutableCandidateResidues(immutableCandidateResidues, plan);
  return plan;
}

function healthyArtifactCapsule(plan) {
  return {
    schemaVersion: 1,
    kind: TASK6A_CAPSULE_KIND,
    manifest: plan.manifest,
    files: [...plan.files].map(([path, bytes]) => ({
      path,
      size: bytes.byteLength,
      sha256: sha256(bytes),
      bytesBase64: bytes.toString('base64'),
    })),
  };
}

function healthyArtifactCapsuleBytes(plan) {
  return Buffer.from(normalizedText(JSON.stringify(healthyArtifactCapsule(plan), null, 2)), 'utf8');
}

function validateImmutableCandidateResidues(paths, plan) {
  const expected = healthyArtifactCapsuleBytes(plan);
  for (const path of paths) {
    const stats = lstatSync(path);
    const mode = stats.mode & 0o777;
    const bytes = readFileSync(path);
    if (
      !stats.isFile()
      || stats.isSymbolicLink()
      || ![0o400, 0o600].includes(mode)
      || stats.nlink < 1
      || stats.nlink > 2
      || bytes.byteLength > expected.byteLength
      || !bytes.equals(expected.subarray(0, bytes.byteLength))
    ) {
      throw new Error(`MINIAPP_IMMUTABLE_CANDIDATE_RESIDUE_INVALID: ${path}`);
    }
  }
}

function assertUnchangedFilesystemObject(before, after, label) {
  if (!before || !after || before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(`MINIAPP_ARTIFACT_CHANGED_DURING_VERIFICATION: ${label}`);
  }
}

function verifyDirectoryArtifact(root, plan) {
  const actualPaths = walkFiles(root).map((path) => normalizedRelative(root, path)).sort();
  const expectedPaths = [...plan.files.keys(), 'manifest.json'].sort();
  if (!isDeepStrictEqual(actualPaths, expectedPaths)) {
    throw new Error(`MINIAPP_ARTIFACT_FILE_SET_INVALID\nExpected ${expectedPaths.join(', ')}\nFound ${actualPaths.join(', ')}`);
  }

  for (const [relativePath, expectedBytes] of plan.files) {
    const actualBytes = readFileSync(join(root, relativePath));
    if (!actualBytes.equals(expectedBytes)) {
      throw new Error(`MINIAPP_ARTIFACT_BYTES_MISMATCH: ${relativePath}`);
    }
  }

  const { manifest, manifestBytes } = parseCanonicalManifest(root);
  const actualInventory = inventoryFor(root);
  if (!isDeepStrictEqual(manifest.files, actualInventory)) {
    throw new Error('MINIAPP_MANIFEST_INVENTORY_MISMATCH');
  }
  if (!isDeepStrictEqual(manifest, plan.manifest)) {
    throw new Error('MINIAPP_MANIFEST_METADATA_MISMATCH');
  }
  const canonicalManifest = Buffer.from(normalizedText(JSON.stringify(plan.manifest, null, 2)), 'utf8');
  if (!manifestBytes.equals(canonicalManifest)) {
    throw new Error('MINIAPP_MANIFEST_BYTES_NONCANONICAL');
  }
}

function verifyCapsuleArtifact(root, rootStats, plan) {
  if (!rootStats.isFile() || rootStats.isSymbolicLink()) {
    throw new Error('MINIAPP_ARTIFACT_VERIFICATION_FAILED: capsule must be a real regular file');
  }
  const actualBytes = readFileSync(root);
  const afterRead = lstatIfPresent(root);
  assertUnchangedFilesystemObject(filesystemIdentity(root, rootStats), filesystemIdentity(root, afterRead), 'capsule identity');
  if (!actualBytes.equals(healthyArtifactCapsuleBytes(plan))) {
    throw new Error('MINIAPP_ARTIFACT_CAPSULE_MISMATCH');
  }
}

export function verifyBuiltArtifact({ projectRoot, outputRoot, expectedEntrySlugs = TASK6A_ENTRY_SLUGS }) {
  if (!isDeepStrictEqual(expectedEntrySlugs, TASK6A_ENTRY_SLUGS)) {
    throw new Error('Task 6A verifier accepts only the exact Healthy Recipes entry root');
  }
  const root = resolve(outputRoot);
  const rootStats = lstatIfPresent(root);
  if (!rootStats || rootStats.isSymbolicLink() || (!rootStats.isDirectory() && !rootStats.isFile())) {
    throw new Error('MINIAPP_ARTIFACT_VERIFICATION_FAILED: artifact root must be a real directory or immutable capsule');
  }
  const plan = createHealthyArtifactPlan(projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  if (rootStats.isDirectory()) verifyDirectoryArtifact(root, plan);
  else verifyCapsuleArtifact(root, rootStats, plan);
  const finalStats = lstatIfPresent(root);
  assertUnchangedFilesystemObject(filesystemIdentity(root, rootStats), filesystemIdentity(root, finalStats), 'artifact root identity');
  return true;
}

export function readVerifiedMiniappArtifact({ projectRoot, outputRoot }) {
  const root = resolve(outputRoot);
  verifyBuiltArtifact({ projectRoot, outputRoot: root });
  const plan = createHealthyArtifactPlan(projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const rootStats = lstatIfPresent(root);
  if (!rootStats || rootStats.isSymbolicLink()) {
    throw new Error('MINIAPP_ARTIFACT_CHANGED_DURING_SNAPSHOT: artifact root');
  }
  const files = new Map();
  if (rootStats.isFile()) {
    verifyCapsuleArtifact(root, rootStats, plan);
    for (const [path, bytes] of plan.files) files.set(path, Buffer.from(bytes));
  } else if (rootStats.isDirectory()) {
    for (const path of plan.files.keys()) {
      const bytes = readFileSync(join(root, path));
      files.set(path, Buffer.from(bytes));
    }
    verifyDirectoryArtifact(root, plan);
  } else {
    throw new Error('MINIAPP_ARTIFACT_CHANGED_DURING_SNAPSHOT: artifact root type');
  }
  const finalStats = lstatIfPresent(root);
  assertUnchangedFilesystemObject(filesystemIdentity(root, rootStats), filesystemIdentity(root, finalStats), 'snapshot root identity');
  for (const [path, expectedBytes] of plan.files) {
    if (!files.get(path)?.equals(expectedBytes)) {
      throw new Error(`MINIAPP_ARTIFACT_CHANGED_DURING_SNAPSHOT: ${path}`);
    }
  }
  return Object.freeze({
    files,
    manifest: structuredClone(plan.manifest),
  });
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
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isStrictDescendant(parent, child) {
  const relation = relative(parent, child);
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function filesystemIdentity(path, stats = lstatIfPresent(path)) {
  return stats ? Object.freeze({ dev: stats.dev, ino: stats.ino, path }) : null;
}

function assertOwnedDirectoryPath({ trustedRoot, candidate, label }) {
  const relation = relative(trustedRoot, candidate);
  if (!isStrictDescendant(trustedRoot, candidate)) {
    throw new Error(`Refusing unsafe ${label}: path escapes its real trusted root`);
  }

  const trustedStats = lstatIfPresent(trustedRoot);
  if (!trustedStats?.isDirectory() || trustedStats.isSymbolicLink()) {
    throw new Error(`Refusing unsafe ${label}: trusted root is not a real directory`);
  }
  const identities = [filesystemIdentity(trustedRoot, trustedStats)];
  let current = trustedRoot;
  for (const component of relation.split(/[\\/]/u)) {
    current = join(current, component);
    const stats = lstatIfPresent(current);
    if (!stats) break;
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing unsafe ${label}: symlinked path component ${current}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Refusing unsafe ${label}: path component is not a directory ${current}`);
    }
    const actual = realpathSync(current);
    if (actual !== trustedRoot && !isStrictDescendant(trustedRoot, actual)) {
      throw new Error(`Refusing unsafe ${label}: real path escapes its trusted root`);
    }
    identities.push(filesystemIdentity(current, stats));
  }
  return identities;
}

function describeSafeMiniappOutputPaths({ projectRoot, outputRoot }) {
  const projectLexical = resolve(projectRoot);
  const projectStats = lstatIfPresent(projectLexical);
  if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) {
    throw new Error('Refusing unsafe miniapp project root');
  }
  const project = realpathSync(projectLexical);
  const targetLexical = resolve(outputRoot);
  const canonicalLexical = resolve(projectLexical, 'miniapps/dist');
  const temporaryLexical = resolve(tmpdir());
  const temporary = realpathSync(temporaryLexical);

  let target;
  let trustedRoot;
  if (targetLexical === canonicalLexical) {
    trustedRoot = project;
    target = resolve(project, 'miniapps/dist');
  } else {
    let tempRelation = relative(temporaryLexical, targetLexical);
    if (!tempRelation || tempRelation.startsWith('..') || isAbsolute(tempRelation)) {
      tempRelation = relative(temporary, targetLexical);
    }
    const normalized = tempRelation.replaceAll('\\', '/');
    const [container, ...descendants] = normalized.split('/');
    if (!/^cabohealth-[A-Za-z0-9._-]+$/u.test(container ?? '') || descendants.length === 0 || descendants.some((part) => !part)) {
      throw new Error(`Refusing unsafe miniapp output path: ${targetLexical}`);
    }
    trustedRoot = resolve(temporary, container);
    const trustedStats = lstatIfPresent(trustedRoot);
    if (!trustedStats?.isDirectory() || trustedStats.isSymbolicLink() || realpathSync(trustedRoot) !== trustedRoot) {
      throw new Error('Refusing unsafe miniapp output path: isolated temp root is not an owned real directory');
    }
    target = resolve(trustedRoot, ...descendants);
  }

  const parent = dirname(target);
  const targetName = target.slice(parent.length + 1);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(targetName)
    || LEGACY_CONTROLLED_BUILD_NAMES.includes(targetName)
    || targetName.startsWith(IMMUTABLE_ARTIFACT_PREFIX)
  ) {
    throw new Error('Refusing unsafe miniapp output path: target name collides with controlled immutable artifacts');
  }
  const parentChain = parent === trustedRoot
    ? [filesystemIdentity(trustedRoot)]
    : assertOwnedDirectoryPath({ trustedRoot, candidate: parent, label: 'miniapp output parent' });
  if (parentChain.at(-1)?.path !== parent) {
    throw new Error('Refusing unsafe miniapp output path: output parent must already be an owned real directory');
  }
  const targetStats = lstatIfPresent(target);
  if (targetStats?.isSymbolicLink() || (targetStats && !targetStats.isDirectory() && !targetStats.isFile())) {
    throw new Error('Refusing unsafe miniapp output path: target must be absent, a real directory, or an immutable capsule');
  }
  return Object.freeze({
    parent,
    parentChain,
    project,
    target,
    targetIdentity: filesystemIdentity(target, targetStats),
    targetName,
    trustedRoot,
  });
}

export function assertSafeMiniappOutputPath({ projectRoot, outputRoot }) {
  return describeSafeMiniappOutputPaths({ projectRoot, outputRoot }).target;
}

export function assertVerifiedMiniappDeploymentSource({ projectRoot, outputRoot }) {
  const canonical = resolve(realpathSync(resolve(projectRoot)), 'miniapps/dist');
  const target = assertSafeMiniappOutputPath({ projectRoot, outputRoot });
  if (target !== canonical) {
    throw new Error('Miniapp deployment source must be the verified canonical miniapps/dist artifact');
  }
  const targetStats = lstatIfPresent(target);
  if (!targetStats?.isDirectory() || targetStats.isSymbolicLink()) {
    throw new Error('MINIAPP_DEPLOYMENT_REQUIRES_REVIEWED_MATERIALIZATION: immutable capsule is verified but is not a deployable static directory');
  }
  verifyBuiltArtifact({ projectRoot, outputRoot: target });
  return target;
}

// Node does not expose openat(2) or renameat2(RENAME_NOREPLACE). This tiny
// publisher enters the already-attested parent as its process cwd, verifies
// that cwd inode before its first write, and performs every mutation relative
// to that stable kernel-held directory. Its O_EXCL candidate is hard-linked to
// the canonical name, which makes publication atomic and non-replacing.
const IMMUTABLE_PUBLISHER_SOURCE = String.raw`
'use strict';
const { createHash, randomBytes } = require('node:crypto');
const {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');

function fail(message) {
  throw new Error(message);
}

try {
  const [expectedDev, expectedIno, targetName, expectedSize, expectedHash, candidatePrefix] = process.argv.slice(1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(targetName || '')) fail('unsafe canonical target name');
  if (!/^\.dist-artifact-$/.test(candidatePrefix || '')) fail('unsafe immutable candidate prefix');
  const cwdFd = openSync('.', constants.O_RDONLY);
  const cwdStats = fstatSync(cwdFd);
  if (!cwdStats.isDirectory() || String(cwdStats.dev) !== expectedDev || String(cwdStats.ino) !== expectedIno) {
    fail('output parent ownership changed before publication');
  }

  const capsule = readFileSync(0);
  if (String(capsule.byteLength) !== expectedSize) fail('immutable capsule size changed in transit');
  if (createHash('sha256').update(capsule).digest('hex') !== expectedHash) fail('immutable capsule hash changed in transit');

  let candidateName;
  let candidateFd;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    candidateName = candidatePrefix + randomBytes(24).toString('hex') + '.capsule';
    try {
      candidateFd = openSync(
        candidateName,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
        0o600,
      );
      break;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  if (candidateFd === undefined) fail('could not reserve a unique immutable candidate');
  writeFileSync(candidateFd, capsule);
  fsyncSync(candidateFd);
  fchmodSync(candidateFd, 0o400);
  const candidateStats = fstatSync(candidateFd);
  if (!candidateStats.isFile() || candidateStats.size !== capsule.byteLength) fail('immutable candidate verification failed');

  linkSync(candidateName, targetName);
  const targetFd = openSync(targetName, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const targetStats = fstatSync(targetFd);
  if (
    !targetStats.isFile()
    || targetStats.dev !== candidateStats.dev
    || targetStats.ino !== candidateStats.ino
  ) fail('canonical target is not the published immutable candidate');
  const targetBytes = readFileSync(targetFd);
  if (!targetBytes.equals(capsule)) fail('canonical target bytes changed after publication');
  closeSync(targetFd);
  closeSync(candidateFd);
  closeSync(cwdFd);
  process.stdout.write(JSON.stringify({
    candidateName,
    dev: String(candidateStats.dev),
    ino: String(candidateStats.ino),
  }));
} catch (error) {
  process.stderr.write(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
`;

function publishImmutableCapsule({ bytes, parent, parentIdentity, targetName }) {
  if (!parentIdentity) throw new Error('MINIAPP_CANONICAL_PUBLICATION_FAILED: missing parent identity');
  const result = spawnSync(process.execPath, [
    '-e',
    IMMUTABLE_PUBLISHER_SOURCE,
    String(parentIdentity.dev),
    String(parentIdentity.ino),
    targetName,
    String(bytes.byteLength),
    sha256(bytes),
    IMMUTABLE_ARTIFACT_PREFIX,
  ], {
    cwd: parent,
    encoding: 'utf8',
    input: bytes,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `publisher exited ${result.status}`;
    throw new Error(`MINIAPP_CANONICAL_PUBLICATION_FAILED: exclusive publish refused (${detail})`);
  }
  try {
    const published = JSON.parse(result.stdout);
    if (
      !IMMUTABLE_ARTIFACT_NAME.test(published.candidateName)
      || !/^\d+$/u.test(published.dev)
      || !/^\d+$/u.test(published.ino)
    ) throw new Error('malformed publisher attestation');
    return Object.freeze(published);
  } catch (cause) {
    throw new Error('MINIAPP_CANONICAL_PUBLICATION_FAILED: invalid publisher attestation', { cause });
  }
}

export async function buildMiniapps({
  projectRoot,
  outputRoot,
  mode,
  contactFacts,
  beforeFilesystemOperation = () => {},
}) {
  const pathInputs = { projectRoot, outputRoot };
  const safePaths = describeSafeMiniappOutputPaths(pathInputs);
  const root = safePaths.project;
  const target = safePaths.target;
  if (!['healthy', 'release'].includes(mode)) throw new Error(`Unknown miniapp build mode: ${mode}`);

  if (mode === 'release') {
    const facts = contactFacts ?? readJson(join(root, 'release/public-contact-facts.json'));
    const contactErrors = validatePublicContactFacts(facts);
    if (contactErrors.length > 0) {
      throw new Error(`PUBLIC_CONTACT_FACTS_INCOMPLETE\n${contactErrors.join('\n')}`);
    }
    throw new Error('CLINIC_GUIDE_TASK_6B_PENDING: confirmed facts pass validation, but the deployable Clinic Guide renderer is intentionally not part of Task 6A');
  }

  const plan = createHealthyArtifactPlan(root);
  if (safePaths.targetIdentity) {
    verifyBuiltArtifact({ projectRoot: root, outputRoot: target });
    const current = describeSafeMiniappOutputPaths(pathInputs);
    if (
      !isDeepStrictEqual(current.parentChain, safePaths.parentChain)
      || !isDeepStrictEqual(current.targetIdentity, safePaths.targetIdentity)
    ) {
      throw new Error('MINIAPP_EXISTING_ARTIFACT_CHANGED_DURING_IDEMPOTENCE_CHECK');
    }
    verifyBuiltArtifact({ projectRoot: root, outputRoot: target });
    const final = describeSafeMiniappOutputPaths(pathInputs);
    if (
      !isDeepStrictEqual(final.parentChain, safePaths.parentChain)
      || !isDeepStrictEqual(final.targetIdentity, safePaths.targetIdentity)
    ) {
      throw new Error('MINIAPP_EXISTING_ARTIFACT_CHANGED_DURING_IDEMPOTENCE_CHECK');
    }
    return plan.manifest;
  }

  const capsuleBytes = healthyArtifactCapsuleBytes(plan);
  beforeFilesystemOperation({ operation: 'publish-canonical-artifact', path: target });
  const published = publishImmutableCapsule({
    bytes: capsuleBytes,
    parent: safePaths.parent,
    parentIdentity: safePaths.parentChain.at(-1),
    targetName: safePaths.targetName,
  });
  const targetStats = lstatIfPresent(target);
  if (
    !targetStats?.isFile()
    || targetStats.isSymbolicLink()
    || String(targetStats.dev) !== published.dev
    || String(targetStats.ino) !== published.ino
  ) throw new Error('MINIAPP_CANONICAL_PUBLICATION_FAILED: canonical identity changed after publication');
  const candidate = join(safePaths.parent, published.candidateName);
  const candidateStats = lstatIfPresent(candidate);
  if (
    !candidateStats?.isFile()
    || candidateStats.isSymbolicLink()
    || candidateStats.dev !== targetStats.dev
    || candidateStats.ino !== targetStats.ino
  ) throw new Error('MINIAPP_CANONICAL_PUBLICATION_FAILED: immutable candidate identity changed after publication');
  verifyBuiltArtifact({ projectRoot: root, outputRoot: target });
  const finalStats = lstatIfPresent(target);
  assertUnchangedFilesystemObject(filesystemIdentity(target, targetStats), filesystemIdentity(target, finalStats), 'published canonical artifact');
  return plan.manifest;
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
  const artifactType = lstatSync(outputRoot).isDirectory()
    ? 'verified existing static directory'
    : 'verified immutable capsule; reviewed static-tree materialization is still required';
  console.log(`Prepared ${manifest.entrySlugs.join(', ')} at miniapps/dist (${artifactType}; Task 6A; not release-ready).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
