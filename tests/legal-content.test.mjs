import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const verifierPath = join(projectRoot, 'scripts/verify-minimal-v1.mjs');
const legalUrls = Object.freeze({
  privacy: 'https://cabohealth.org/app/privacy/',
  terms: 'https://cabohealth.org/app/terms/',
  support: 'https://cabohealth.org/app/support/',
  reportContent: 'https://cabohealth.org/app/report-content/',
});
const pagePaths = Object.freeze({
  privacy: 'web-hosting/cabohealth.org/app/privacy/index.html',
  terms: 'web-hosting/cabohealth.org/app/terms/index.html',
  support: 'web-hosting/cabohealth.org/app/support/index.html',
});

function readArtifact(relativePath) {
  const absolutePath = join(projectRoot, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} must exist`);
  return readFileSync(absolutePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readArtifact(relativePath));
}

function attributeValues(html, attribute) {
  return [...html.matchAll(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'gi'))]
    .map((match) => match[1]);
}

function sectionKeys(html, locale) {
  const article = html.match(new RegExp(`<article\\b[^>]*lang=["']${locale}["'][^>]*>([\\s\\S]*?)<\\/article>`, 'i'));
  assert.ok(article, `missing ${locale} policy article`);
  return [...article[1].matchAll(/\bdata-policy-section=["']([^"']+)["']/gi)]
    .map((match) => match[1]);
}

async function loadPublicMiniapps() {
  const source = readArtifact('constants/publicMiniapps.ts');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('canonical legal URLs agree across the catalog, miniapps, and hosted legal navigation', async () => {
  const { PUBLIC_MINIAPPS } = await loadPublicMiniapps();

  for (const miniapp of PUBLIC_MINIAPPS) {
    assert.deepEqual(miniapp.legalUrls, legalUrls, `${miniapp.slug} legal URLs drifted`);
    const miniappHtml = readArtifact(`miniapps/${miniapp.slug}/index.html`);
    const hrefs = attributeValues(miniappHtml, 'href');
    for (const url of Object.values(legalUrls)) assert.ok(hrefs.includes(url), `${miniapp.slug} misses ${url}`);
  }

  for (const [page, path] of Object.entries(pagePaths)) {
    const html = readArtifact(path);
    assert.equal(attributeValues(html, 'rel').includes('canonical'), true, `${page} needs a canonical link`);
    assert.match(html, new RegExp(`<link\\b[^>]*rel=["']canonical["'][^>]*href=["']${legalUrls[page].replaceAll('/', '\\/')}["']`, 'i'));
    const hrefs = attributeValues(html, 'href');
    for (const url of Object.values(legalUrls)) assert.ok(hrefs.includes(url), `${page} navigation misses ${url}`);
  }
});

test('each legal surface has matching English and Spanish policy sections', () => {
  for (const path of Object.values(pagePaths)) {
    const html = readArtifact(path);
    const english = sectionKeys(html, 'en');
    const spanish = sectionKeys(html, 'es-MX');
    assert.ok(english.length >= 5, `${path} needs complete policy sections`);
    assert.deepEqual(spanish, english, `${path} bilingual section parity drifted`);
  }
});

test('privacy states the exact v1 data boundary in both languages', () => {
  const html = readArtifact(pagePaths.privacy);
  for (const pattern of [
    /do not request or collect health information/i,
    /no account/i,
    /no app-generated identifiers/i,
    /no analytics/i,
    /no advertising/i,
    /no sensitive permissions/i,
    /favorites and preferences remain on your device/i,
    /WebKit/i,
    /two public modules/i,
    /normal technical HTTP request logs/i,
    /retention and deletion details are pending/i,
    /no solicitan ni recopilan información de salud/i,
    /sin cuenta/i,
    /sin identificadores generados por la app/i,
    /sin analítica/i,
    /sin publicidad/i,
    /sin permisos sensibles/i,
    /favoritos y preferencias permanecen en tu dispositivo/i,
    /dos módulos públicos/i,
    /registros técnicos normales de solicitudes HTTP/i,
    /detalles de retención y eliminación están pendientes/i,
  ]) assert.match(html, pattern);
});

test('support renders only the frozen contact record and explicit same-window actions', () => {
  const contactRecord = readJson('release/public-contact-facts.json');
  const html = readArtifact(pagePaths.support);
  const hrefs = attributeValues(html, 'href');
  const { facts } = contactRecord;
  const expectedActions = [
    `mailto:${facts.publicEmail.value}`,
    `tel:${facts.phone.value}`,
    facts.whatsApp.value,
    facts.appleMapsDestination.value,
  ];

  assert.equal(contactRecord.status, 'owner-confirmed');
  for (const value of [facts.publicEmail.value, facts.phone.value, facts.address.value, facts.hours.value]) {
    assert.ok(html.includes(value), `support misses frozen value: ${value}`);
  }
  for (const action of expectedActions) {
    assert.equal(hrefs.filter((href) => href === action).length, 2, `${action} must render once per locale`);
  }
  assert.match(html, /messages are reviewed during published business hours; no response deadline is promised/i);
  assert.match(html, /los mensajes se revisan durante el horario publicado; no se promete un plazo de respuesta/i);
  assert.match(html, /Healthy Recipes/);
  assert.match(html, /Recetas Saludables/);
  assert.match(html, /Clinic Guide/);
  assert.match(html, /Guía de la Clínica/);
});

test('Report Content is visible in both languages with an explicit contact path', () => {
  for (const path of Object.values(pagePaths)) {
    const html = readArtifact(path);
    assert.match(html, /Report Content/);
    assert.match(html, /Reportar contenido/);
    assert.ok(attributeValues(html, 'href').includes('mailto:ivan@ivanguaderrama.com'));
  }
});

test('legal pages contain no absent-v1 or unresolved release claims', () => {
  const combined = Object.values(pagePaths).map(readArtifact).join('\n');
  for (const forbidden of [
    /access codes?/i,
    /códigos? de acceso/i,
    /biometric/i,
    /biométr/i,
    /Keychain/i,
    /patient data/i,
    /datos de pacientes/i,
    /account deletion/i,
    /eliminación de cuenta/i,
    /iPad/i,
    /minimum iOS/i,
    /iOS mínimo/i,
    /App Store seller/i,
    /vendedor de App Store/i,
    /age rating/i,
    /clasificación por edad/i,
    /medical device conclusion/i,
    /conclusión de dispositivo médico/i,
    /export compliance conclusion/i,
    /conclusión de cumplimiento de exportación/i,
    /logs? (?:are|is) (?:kept|retained) for \d+/i,
    /registros? (?:se )?(?:conservan|retienen) durante \d+/i,
  ]) assert.doesNotMatch(combined, forbidden);
});

test('legal pages use no forms, scripts, popups, tracking, or remote assets', () => {
  for (const path of Object.values(pagePaths)) {
    const html = readArtifact(path);
    assert.doesNotMatch(html, /<(?:form|input|textarea|select|button|script|iframe)\b/i);
    assert.doesNotMatch(html, /\btarget\s*=/i);
    assert.doesNotMatch(html, /\bon\w+\s*=/i);
    assert.doesNotMatch(html, /window\.open|google-analytics|googletagmanager|tracking pixel|track(?:ing)?-id/i);
    assert.deepEqual(attributeValues(html, 'src'), []);
    for (const href of attributeValues(html, 'href')) {
      assert.match(href, /^(?:https:\/\/(?:cabohealth\.org|wa\.me|maps\.apple\.com)\/|mailto:|tel:)/i, `unsafe href in ${path}: ${href}`);
    }
  }
});

test('draft compliance facts preserve every Task 7B gate as machine-readable pending', () => {
  const facts = readJson('release/compliance-facts.json');
  assert.equal(facts.schemaVersion, 1);
  assert.equal(facts.brand, 'CaboHealth');
  assert.deepEqual(facts.legalEntity, {
    name: 'Cabo Health',
    nameStatus: 'owner-confirmed',
    legalSignOffStatus: 'pending',
  });
  assert.equal(facts.releaseReady, false);

  const requiredPendingPaths = [
    ['appStore', 'seller'],
    ['appStore', 'sellerRelationship'],
    ['hosting', 'logTypes'],
    ['hosting', 'retention'],
    ['hosting', 'deletionProcess'],
    ['support', 'responseSla'],
    ['contentRights'],
    ['exportCompliance'],
    ['medicalDevice'],
    ['ageRating', 'host'],
    ['ageRating', 'miniapps', 'healthy-recipes'],
    ['ageRating', 'miniapps', 'clinic-guide'],
    ['phiRemediation'],
  ];
  for (const path of requiredPendingPaths) {
    const gate = path.reduce((value, key) => value?.[key], facts);
    assert.deepEqual(gate, { value: null, status: 'pending' }, `${path.join('.')} must fail closed`);
  }
});

test('release verification fails closed and names every unresolved Task 7B gate', () => {
  const result = spawnSync(process.execPath, [verifierPath, projectRoot], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  for (const gate of [
    'legalEntity.legalSignOffStatus',
    'appStore.seller',
    'appStore.sellerRelationship',
    'hosting.logTypes',
    'hosting.retention',
    'hosting.deletionProcess',
    'support.responseSla',
    'contentRights',
    'exportCompliance',
    'medicalDevice',
    'ageRating.host',
    'ageRating.miniapps.healthy-recipes',
    'ageRating.miniapps.clinic-guide',
    'phiRemediation',
  ]) assert.match(result.stderr, new RegExp(`Pending release gate: ${gate.replaceAll('.', '\\.')}`));
});

test('operational and inventory drafts identify unverified controls without claiming completion', () => {
  for (const path of [
    'docs/operations/content-review-and-takedown.md',
    'docs/operations/hosting-security-checklist.md',
    'release/data-inventory.md',
    'release/content-rights.md',
  ]) {
    const document = readArtifact(path);
    assert.match(document, /Status: Draft — not release-approved/i);
    assert.match(document, /PENDING/);
    assert.doesNotMatch(document, /Status: Complete|verified control|release approved/i);
  }
  assert.match(readArtifact('docs/operations/content-review-and-takedown.md'), /No user-generated content \(UGC\)/i);
});
