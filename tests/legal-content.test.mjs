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
    .map((match) => match[1].replaceAll('&amp;', '&'));
}

const forbiddenReleaseClaims = [
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
  /minimum (?:supported )?(?:iOS|version)/i,
  /(?:iOS|versión) mínim[oa]/i,
  /\b(?:seller|vendor)\s+(?:is|of record|name|for)\b/i,
  /\b(?:el\s+)?vendedor\s+(?:es|oficial|registrado|de)\b/i,
  /age rating/i,
  /clasificación por edad/i,
  /medical device conclusion/i,
  /conclusión de dispositivo médico/i,
  /export compliance conclusion/i,
  /conclusión de cumplimiento de exportación/i,
  /\b(?:we|CaboHealth)\s+(?:own|owns)\b/i,
  /\bCaboHealth\s+(?:retains|holds)\s+(?:all|exclusive)\s+rights\b/i,
  /\b(?:nosotros|CaboHealth)\s+(?:poseemos|es dueño|es titular)\b/i,
  /\bCaboHealth\s+(?:conserva|mantiene)\s+(?:todos|derechos exclusivos)\b/i,
  /\b(?:you may use|hereby grants?|licensed? (?:to|for))\b/i,
  /\b(?:puedes usar|por (?:la )?presente concede|licencia(?:do)? (?:a|para))\b/i,
  /governed by (?:the )?laws? of|exclusive jurisdiction|courts? of [A-Z]/i,
  /\b(?:Mexican|California) law applies\b/i,
  /se (?:rige|rigen) por las leyes de|jurisdicción exclusiva|tribunales? de [A-ZÁÉÍÓÚ]/i,
  /\baplican las leyes de\b/i,
  /\b(?:respond\w*|repl(?:y|ies|ied)|resolv\w*|response|resolution)\b[^.]{0,80}\b(?:within|in (?:\d+|one|two|three)|by|no later than)\b/i,
  /\b(?:respondemos|responderemos|respuesta|resolución)\b[^.]{0,80}\b(?:dentro de|en \d+|a más tardar)\b/i,
  /logs?[^.]{0,80}\b(?:kept|retained|stored)\b[^.]{0,40}\b(?:for|until)\b/i,
  /\b(?:keep|retain|store)\w*\b[^.]{0,40}\blogs?\b[^.]{0,40}\b(?:for|until)\b/i,
  /registros?[^.]{0,80}\b(?:conservan|retienen|guardan)\b[^.]{0,40}\b(?:durante|hasta)\b/i,
  /\b(?:conservamos|retenemos|guardamos)\b[^.]{0,40}\bregistros?\b[^.]{0,40}\b(?:durante|hasta)\b/i,
  /logs?[^.]{0,80}\b(?:deleted|erased|purged)\b[^.]{0,40}\b(?:automatically|on request)\b/i,
  /\b(?:delete|erase|purge)\w*\b[^.]{0,40}\blogs?\b[^.]{0,40}\b(?:after|automatically|on request)\b/i,
  /registros?[^.]{0,80}\b(?:eliminan|borran|purgan)\b[^.]{0,40}\b(?:automáticamente|a solicitud)\b/i,
  /\b(?:eliminamos|borramos|purgamos)\b[^.]{0,40}\bregistros?\b[^.]{0,40}\b(?:después|automáticamente|a solicitud)\b/i,
  /\bPHI\b[^.]{0,80}\b(?:removed|remediated|cleared|deleted)\b/i,
  /patient documents?[^.]{0,80}\b(?:removed|remediated|cleared|deleted)\b/i,
  /\bPHI\b[^.]{0,80}\b(?:eliminad[oa]s?|remediad[oa]s?|retirad[oa]s?)\b/i,
  /documentos? de pacientes?[^.]{0,80}\b(?:eliminad[oa]s?|remediad[oa]s?|retirad[oa]s?)\b/i,
  /\b(?:no PHI remains|PHI-free)\b/i,
  /\b(?:ya no queda PHI|sin PHI)\b/i,
  /\brequires? iOS \d+|requiere iOS \d+\b/i,
  /\bis (?:the )?(?:verified )?(?:seller|vendor)\b/i,
  /\bes (?:el )?(?:vendedor|proveedor) (?:verificado|oficial)\b/i,
];

function articleForLocale(html, locale) {
  const article = html.match(new RegExp(`<article\\b[^>]*lang=["']${locale}["'][^>]*>([\\s\\S]*?)<\\/article>`, 'i'));
  assert.ok(article, `missing ${locale} policy article`);
  return article[1];
}

function sectionForLocale(html, locale, key) {
  const article = articleForLocale(html, locale);
  const section = article.match(new RegExp(`<section\\b[^>]*data-policy-section=["']${key}["'][^>]*>([\\s\\S]*?)<\\/section>`, 'i'));
  assert.ok(section, `missing ${locale}.${key}`);
  return section[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function assertNoUnverifiedClaims(html) {
  for (const forbidden of forbiddenReleaseClaims) assert.doesNotMatch(html, forbidden);
}

function assertStaticLegalSurface(html, path) {
  assert.doesNotMatch(html, /<(?:form|input|textarea|select|button|script|iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /<link\b(?=[^>]*\brel=["'][^"']*\bstylesheet\b)/i);
  assert.doesNotMatch(html, /@import\b/i);
  assert.doesNotMatch(html, /\burl\s*\(/i);
  assert.doesNotMatch(html, /\b(?:srcset|poster)\s*=/i);
  assert.doesNotMatch(html, /\btarget\s*=/i);
  assert.doesNotMatch(html, /\bon\w+\s*=/i);
  assert.doesNotMatch(html, /window\.open|google-analytics|googletagmanager|tracking pixel|track(?:ing)?-id/i);
  assert.doesNotMatch(html, /href=["'][^"']*&(?!(?:amp|lt|gt|quot|apos);)/i);
  assert.deepEqual(attributeValues(html, 'src'), []);
  for (const href of attributeValues(html, 'href')) {
    assert.match(href, /^(?:https:\/\/(?:cabohealth\.org|wa\.me|maps\.apple\.com)\/|mailto:|tel:)/i, `unsafe href in ${path}: ${href}`);
  }
}

function sectionKeys(html, locale) {
  return [...articleForLocale(html, locale).matchAll(/\bdata-policy-section=["']([^"']+)["']/gi)]
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

test('each bilingual section preserves its locale-specific substantive obligation', () => {
  const obligations = {
    privacy: {
      scope: [/two public modules/i, /dos módulos públicos/i],
      'data-boundary': [/do not request or collect health information/i, /no solicitan ni recopilan información de salud/i],
      'local-state': [/remain on your device/i, /permanecen en tu dispositivo/i],
      'hosting-logs': [/retention and deletion details are pending/i, /detalles de retención y eliminación están pendientes/i],
      children: [/final children and age position remains pending/i, /postura final sobre niñez y edad sigue pendiente/i],
      contact: [/Do not include health or other sensitive information/i, /No incluyas información de salud ni otra información sensible/i],
      changes: [/Material changes will be published/i, /cambios materiales se publicarán/i],
    },
    terms: {
      scope: [/do not diagnose, treat, prescribe/i, /No diagnostican, tratan, prescriben/i],
      emergency: [/Call local emergency services/i, /Llama a los servicios locales de emergencia/i],
      'acceptable-use': [/no user-generated content area/i, /no tienen un área de contenido generado por usuarios/i],
      rights: [/rights review for this release remains? pending/i, /revisión de derechos de contenido para este lanzamiento sigue pendiente/i],
      'external-services': [/separate services governed by their providers/i, /servicios separados regidos por sus proveedores/i],
      availability: [/does not promise uninterrupted access/i, /no promete acceso ininterrumpido/i],
      'approval-contact': [/subject to owner and legal approval/i, /sujetos a aprobación del propietario y legal/i],
    },
    support: {
      contact: [/no response deadline is promised/i, /no se promete un plazo de respuesta/i],
      recipes: [/Favorites are local to the device/i, /Los favoritos son locales al dispositivo/i],
      clinic: [/module is not an emergency channel/i, /módulo no es un canal de emergencia/i],
      privacy: [/do not request or collect health information/i, /no solicitan ni recopilan información de salud/i],
      'report-content': [/without including sensitive information/i, /sin incluir información sensible/i],
      scope: [/facts that are still pending are not stated here/i, /hechos de plataforma o lanzamiento que siguen pendientes/i],
    },
  };

  for (const [page, sections] of Object.entries(obligations)) {
    const html = readArtifact(pagePaths[page]);
    for (const [section, [englishPattern, spanishPattern]] of Object.entries(sections)) {
      const english = sectionForLocale(html, 'en', section);
      const spanish = sectionForLocale(html, 'es-MX', section);
      assert.ok(english.length >= 60, `${page}.${section}.en is not substantive`);
      assert.ok(spanish.length >= 60, `${page}.${section}.es-MX is not substantive`);
      assert.match(english, englishPattern, `${page}.${section}.en obligation drifted`);
      assert.match(spanish, spanishPattern, `${page}.${section}.es-MX obligation drifted`);
    }
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
  assertNoUnverifiedClaims(combined);
});

test('claim mutation matrix rejects SLA, jurisdiction, rights, seller, retention, and PHI inventions', () => {
  const baseline = Object.values(pagePaths).map(readArtifact).join('\n');
  const mutations = [
    'We respond within 24 hours.',
    'Responderemos dentro de 24 horas.',
    'These terms are governed by the laws of Mexico.',
    'Estos términos se rigen por las leyes de México.',
    'CaboHealth owns all public content.',
    'CaboHealth es titular de todo el contenido público.',
    'You may use the public modules under this license.',
    'Puedes usar los módulos públicos bajo esta licencia.',
    'The seller is Cabo Health.',
    'El vendedor es Cabo Health.',
    'HTTP logs are retained until the end of each month.',
    'Los registros HTTP se conservan durante treinta días.',
    'HTTP logs are deleted automatically.',
    'Los registros HTTP se eliminan automáticamente.',
    'All PHI was removed from public hosting.',
    'Los documentos de pacientes fueron retirados del alojamiento público.',
    'The minimum supported version is iOS 18.',
    'La versión mínima es iOS 18.',
    'Support replies in two business days.',
    'Mexican law applies.',
    'CaboHealth retains all rights.',
    'Cabo Health is the verified seller.',
    'We keep HTTP logs for one month.',
    'Eliminamos los registros automáticamente.',
    'No PHI remains on the public site.',
    'This app requires iOS 18 or later.',
  ];

  for (const mutation of mutations) {
    assert.throws(() => assertNoUnverifiedClaims(`${baseline}\n<p>${mutation}</p>`), assert.AssertionError, mutation);
  }
});

test('legal pages use no forms, scripts, popups, tracking, or remote assets', () => {
  for (const path of Object.values(pagePaths)) {
    assertStaticLegalSurface(readArtifact(path), path);
  }
});

test('active-resource mutation matrix rejects every supported remote loading mechanism', () => {
  const baseline = readArtifact(pagePaths.privacy);
  const mutations = [
    '<script src="https://tracker.example/script.js"></script>',
    '<link rel="stylesheet" href="https://cdn.example/style.css">',
    '<style>@import "https://cdn.example/style.css";</style>',
    '<style>.remote { background-image: url(https://cdn.example/pixel.png); }</style>',
    '<form action="https://collector.example/"><input name="health"></form>',
    '<a target="_blank" href="https://cabohealth.org/app/privacy/">Popup</a>',
    '<iframe src="https://collector.example/"></iframe>',
  ];

  for (const mutation of mutations) {
    assert.throws(() => assertStaticLegalSurface(`${baseline}\n${mutation}`, 'mutated privacy'), assert.AssertionError, mutation);
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
