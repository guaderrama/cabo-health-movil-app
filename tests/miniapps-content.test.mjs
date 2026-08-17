import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function assertBilingualText(value, label) {
  assert.equal(typeof value, 'object', `${label} must be bilingual`);
  for (const locale of ['en', 'es-MX']) {
    assert.equal(typeof value[locale], 'string', `${label}.${locale} must be text`);
    assert.ok(value[locale].trim().length > 0, `${label}.${locale} must not be blank`);
  }
}

function assertBilingualList(value, label, minimumLength = 1) {
  assert.equal(typeof value, 'object', `${label} must be bilingual`);
  for (const locale of ['en', 'es-MX']) {
    assert.ok(Array.isArray(value[locale]), `${label}.${locale} must be a list`);
    assert.ok(value[locale].length >= minimumLength, `${label}.${locale} must have content`);
    for (const [index, item] of value[locale].entries()) {
      assert.equal(typeof item, 'string', `${label}.${locale}[${index}] must be text`);
      assert.ok(item.trim().length > 0, `${label}.${locale}[${index}] must not be blank`);
    }
  }
  assert.equal(value.en.length, value['es-MX'].length, `${label} must have locale parity`);
}

test('canonical recipes provide exactly twelve complete original bilingual entries', () => {
  const recipes = readJson('content/recipes.json');
  const expectedSlugs = [
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
  ];

  assert.equal(recipes.reviewedOn, '2026-08-16');
  assertBilingualText(recipes.disclaimer, 'disclaimer');
  assertBilingualText(recipes.foodSafety, 'foodSafety');
  assert.deepEqual(
    recipes.recipes.map(({ slug }) => slug).sort(),
    expectedSlugs,
  );

  const categories = new Set();
  for (const recipe of recipes.recipes) {
    assert.match(recipe.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assertBilingualText(recipe.title, `${recipe.slug}.title`);
    assertBilingualText(recipe.summary, `${recipe.slug}.summary`);
    assert.ok(Array.isArray(recipe.categories) && recipe.categories.length > 0);
    assert.ok(Array.isArray(recipe.tags) && recipe.tags.length > 0);
    recipe.categories.forEach((category) => categories.add(category));
    assert.ok(Number.isInteger(recipe.timeMinutes) && recipe.timeMinutes > 0);
    assert.ok(Number.isInteger(recipe.servings) && recipe.servings > 0);
    assertBilingualText(recipe.timeLabel, `${recipe.slug}.timeLabel`);
    assertBilingualList(recipe.ingredients, `${recipe.slug}.ingredients`, 2);
    assertBilingualList(recipe.steps, `${recipe.slug}.steps`, 2);
    assertBilingualText(recipe.allergens, `${recipe.slug}.allergens`);
    assertBilingualText(recipe.foodSafety, `${recipe.slug}.foodSafety`);
    assertBilingualText(recipe.editorialNote, `${recipe.slug}.editorialNote`);
  }

  for (const requiredCategory of ['breakfast', 'lunch', 'dinner', 'snack']) {
    assert.ok(categories.has(requiredCategory), `missing category: ${requiredCategory}`);
  }
});

test('canonical public miniapp content contains no prohibited product behavior or health claims', () => {
  const content = [
    readFileSync(new URL('../content/recipes.json', import.meta.url), 'utf8'),
    readFileSync(new URL('../content/clinic-guide.json', import.meta.url), 'utf8'),
  ].join('\n');
  const prohibitedPatterns = [
    /\b(?:diagnoses?|diagnostica|diagnosticar)\b/i,
    /\b(?:dosage|dose|dosing|dosis|dosificaci[oó]n)\b/i,
    /\b(?:patient portal|patient record|medical record|portal de pacientes|expediente cl[ií]nico)\b/i,
    /\b(?:analytics|tracking|advertising|publicidad|rastreo)\b/i,
    /\b(?:buy now|purchase|subscribe|comprar ahora|suscr[ií]bete)\b/i,
    /\b(?:cures?|prevents?|treats?)\s+(?:disease|illness|cancer|diabetes)\b/i,
    /\b(?:cura|previene|trata)\s+(?:enfermedad|c[aá]ncer|diabetes)\b/i,
  ];

  for (const pattern of prohibitedPatterns) {
    assert.doesNotMatch(content, pattern);
  }
});

test('clinic checklist remains bilingual and non-collecting while contact facts match the owner confirmation exactly', () => {
  const guide = readJson('content/clinic-guide.json');
  const contacts = readJson('release/public-contact-facts.json');
  const requiredGroups = [
    'appointment-confirmation',
    'questions',
    'travel-access',
    'accessibility-language',
    'what-to-bring',
    'privacy',
  ];

  assert.equal(guide.reviewedOn, '2026-08-16');
  assertBilingualText(guide.emergency, 'clinicGuide.emergency');
  assertBilingualText(guide.privacy, 'clinicGuide.privacy');
  assert.deepEqual(guide.groups.map(({ id }) => id), requiredGroups);
  for (const group of guide.groups) {
    assertBilingualText(group.title, `${group.id}.title`);
    assert.ok(group.items.length > 0, `${group.id} must have checklist items`);
    for (const item of group.items) {
      assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assertBilingualText(item.text, `${group.id}.${item.id}`);
    }
  }

  assert.deepEqual(contacts, {
    status: 'owner-confirmed',
    ownerConfirmedAt: '2026-08-17T02:33:24.000Z',
    facts: {
      publicEmail: {
        value: 'ivan@ivanguaderrama.com',
        sourceUrl: 'https://cabohealth.org/app/support/',
        sourceStatus: 'owner-confirmed-source',
      },
      phone: {
        value: '+526241224865',
        sourceUrl: 'https://www.cabohealth.org/contact.html',
        sourceStatus: 'owner-confirmed-source',
      },
      whatsApp: {
        value: 'https://wa.me/526241224865',
        sourceUrl: 'https://www.cabohealth.org/contact.html',
        sourceStatus: 'owner-confirmed-source',
      },
      address: {
        value: 'In front of Plaza Amelia Wilkes, Hidalgo, Calle Cabo San Lucas 10, Centro, 23410 Cabo San Lucas, B.C.S., Mexico',
        sourceUrl: 'https://cabohealth.org/app/support/',
        sourceStatus: 'owner-confirmed-source',
      },
      hours: {
        value: 'Monday–Friday, 10:00 AM–4:00 PM',
        sourceUrl: 'https://cabohealth.org/app/support/',
        sourceStatus: 'owner-confirmed-source',
      },
      appleMapsDestination: {
        value: 'https://maps.apple.com/place?address=In%20front%20of%20Plaza%20Amelia%20Wilkes%2C%20Hidalgo%2C%20Calle%20Cabo%20San%20Lucas%2010%2C%20Centro%2C%2023410%20Cabo%20San%20Lucas%2C%20B.C.S.%2C%20Mexico&name=Cabo%20Health',
        sourceUrl: 'https://maps.apple.com/place?address=In%20front%20of%20Plaza%20Amelia%20Wilkes%2C%20Hidalgo%2C%20Calle%20Cabo%20San%20Lucas%2010%2C%20Centro%2C%2023410%20Cabo%20San%20Lucas%2C%20B.C.S.%2C%20Mexico&name=Cabo%20Health',
        sourceStatus: 'owner-confirmed-source',
      },
      serviceLanguages: {
        value: ['English', 'Spanish'],
        sourceUrl: 'https://cabohealth.org/app/support/',
        sourceStatus: 'owner-confirmed-source',
      },
    },
  });
});

test('content files live at the canonical paths consumed by both native and web surfaces', () => {
  for (const relativePath of ['content/recipes.json', 'content/clinic-guide.json']) {
    assert.doesNotThrow(() => readFileSync(`${projectRoot}/${relativePath}`, 'utf8'));
  }
});
