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
  reportContent: 'web-hosting/cabohealth.org/app/report-content/index.html',
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

function exactExplicitActionUrls() {
  const { facts } = readJson('release/public-contact-facts.json');
  return new Set([
    ...Object.values(legalUrls),
    `mailto:${facts.publicEmail.value}`,
    `tel:${facts.phone.value}`,
    facts.whatsApp.value,
    facts.appleMapsDestination.value,
  ]);
}

function openingTags(html, path) {
  const tags = [];
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      const commentEnd = html.indexOf('-->', start + 4);
      assert.notEqual(commentEnd, -1, `unterminated comment in ${path}`);
      index = commentEnd + 3;
      continue;
    }
    const name = html.slice(start + 1).match(/^([a-z][\w:-]*)\b/i)?.[1];
    if (!name) {
      index = start + 1;
      continue;
    }

    const attributesStart = start + 1 + name.length;
    let quote;
    let end = attributesStart;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      } else if (character === '<') {
        assert.fail(`nested < before tag close in ${path}`);
      }
    }
    assert.equal(quote, undefined, `unterminated quoted attribute in ${path}`);
    assert.ok(end < html.length, `unterminated <${name}> in ${path}`);
    tags.push({
      name: name.toLowerCase(),
      source: html.slice(attributesStart, end),
    });
    index = end + 1;
  }
  return tags;
}

const namedHtmlCharacterReferences = new Map([
  ['AMP', '&'],
  ['GT', '>'],
  ['LT', '<'],
  ['QUOT', '"'],
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"'],
]);

const htmlNumericReferenceReplacements = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6],
  [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c],
  [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
  [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
]);

function numericHtmlCharacterReference(token, radix) {
  let codePoint = Number.parseInt(token, radix);
  codePoint = htmlNumericReferenceReplacements.get(codePoint) ?? codePoint;
  if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    codePoint = 0xfffd;
  }
  return String.fromCodePoint(codePoint);
}

function decodeFailClosedHtmlAttribute(rawValue, tagName, attributeName) {
  if (rawValue === undefined) return undefined;
  let decoded = '';
  let index = 0;
  while (index < rawValue.length) {
    const ampersand = rawValue.indexOf('&', index);
    if (ampersand === -1) return decoded + rawValue.slice(index);
    decoded += rawValue.slice(index, ampersand);
    const reference = rawValue.slice(ampersand);
    const hexadecimal = reference.match(/^&#[xX]([0-9a-fA-F]+);?/);
    const decimal = reference.match(/^&#([0-9]+);?/);
    const named = reference.match(/^&([A-Za-z]+);/);
    if (hexadecimal) {
      decoded += numericHtmlCharacterReference(hexadecimal[1], 16);
      index = ampersand + hexadecimal[0].length;
    } else if (decimal) {
      decoded += numericHtmlCharacterReference(decimal[1], 10);
      index = ampersand + decimal[0].length;
    } else if (named && namedHtmlCharacterReferences.has(named[1])) {
      decoded += namedHtmlCharacterReferences.get(named[1]);
      index = ampersand + named[0].length;
    } else {
      assert.fail(`unsupported or malformed character reference in ${attributeName} of <${tagName}>`);
    }
  }
  return decoded;
}

function parsedTagAttributes(source, tagName) {
  const attributes = new Map();
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index])) index += 1;
    if (index >= source.length) break;
    if (source[index] === '/') {
      assert.equal(source.slice(index).trim(), '/', `malformed self-close in <${tagName}>`);
      break;
    }

    const nameStart = index;
    while (index < source.length && !/[\s=/]/.test(source[index])) index += 1;
    const name = source.slice(nameStart, index).toLowerCase();
    assert.match(name, /^[^\u0000-\u001f\u007f"'<>/=]+$/, `malformed attribute in <${tagName}>`);
    while (/\s/.test(source[index])) index += 1;

    let value;
    let quoted = false;
    if (source[index] === '=') {
      index += 1;
      while (/\s/.test(source[index])) index += 1;
      const delimiter = source[index];
      if (delimiter === '"' || delimiter === "'") {
        quoted = true;
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== delimiter) index += 1;
        assert.ok(index < source.length, `unterminated ${name} in <${tagName}>`);
        value = source.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !/\s/.test(source[index])) index += 1;
        value = source.slice(valueStart, index);
        assert.notEqual(value, '', `empty unquoted ${name} in <${tagName}>`);
      }
    }
    assert.equal(attributes.has(name), false, `duplicate ${name} attribute in <${tagName}>`);
    attributes.set(name, {
      quoted,
      rawValue: value,
      value: decodeFailClosedHtmlAttribute(value, tagName, name),
    });
  }
  return attributes;
}

function assertStaticLegalSurface(html, path, expectedCanonicalUrl) {
  assert.doesNotMatch(html, /<!--/, `HTML comments are forbidden in ${path}`);
  assert.doesNotMatch(html, /<(?:form|input|textarea|select|button|script|iframe|frame|frameset|object|embed|applet|svg)\b/i);
  assert.doesNotMatch(html, /<link\b(?=[^>]*\brel=["'][^"']*\bstylesheet\b)/i);
  assert.doesNotMatch(html, /@import\b/i);
  assert.doesNotMatch(html, /\burl\s*\(/i);
  assert.doesNotMatch(html, /window\.open|google-analytics|googletagmanager|tracking pixel|track(?:ing)?-id/i);

  const allowedActions = exactExplicitActionUrls();
  const activeResourceAttributes = new Set([
    'action',
    'archive',
    'attributionsrc',
    'background',
    'codebase',
    'data',
    'formaction',
    'imagesizes',
    'imagesrcset',
    'longdesc',
    'manifest',
    'ping',
    'poster',
    'profile',
    'src',
    'srcdoc',
    'srcset',
    'xlink:href',
  ]);
  let canonicalLinks = 0;
  for (const tag of openingTags(html, path)) {
    const attributes = parsedTagAttributes(tag.source, tag.name);
    for (const name of attributes.keys()) {
      assert.equal(activeResourceAttributes.has(name), false, `${name} is forbidden in <${tag.name}> in ${path}`);
      assert.equal(name.startsWith('on'), false, `event attribute ${name} is forbidden in ${path}`);
    }
    assert.equal(attributes.has('target'), false, `target is forbidden in ${path}`);
    if (tag.name === 'meta' && attributes.get('http-equiv')?.value?.trim().toLowerCase() === 'refresh') {
      assert.fail(`meta refresh is forbidden in ${path}`);
    }

    const hrefAttribute = attributes.get('href');
    if (tag.name === 'link') {
      assert.deepEqual([...attributes.keys()].sort(), ['href', 'rel'], `only an exact canonical <link> is allowed in ${path}`);
      const relAttribute = attributes.get('rel');
      assert.equal(relAttribute?.quoted, true, `canonical rel must be quoted in ${path}`);
      assert.equal(relAttribute?.value, 'canonical', `only a canonical <link> is allowed in ${path}`);
      assert.equal(hrefAttribute?.quoted, true, `canonical href must be quoted in ${path}`);
      assert.equal(hrefAttribute?.value, expectedCanonicalUrl, `wrong canonical href in ${path}`);
      canonicalLinks += 1;
      continue;
    }
    if (!hrefAttribute) continue;

    assert.equal(tag.name, 'a', `href is forbidden on <${tag.name}> in ${path}`);
    assert.equal(hrefAttribute.quoted, true, `anchor href must be quoted in ${path}`);
    assert.equal(allowedActions.has(hrefAttribute.value), true, `unsafe anchor href in ${path}: ${hrefAttribute.value}`);
    assert.equal(attributes.has('download'), false, `download is forbidden in ${path}`);
  }
  assert.equal(canonicalLinks, 1, `${path} must contain exactly one canonical link`);
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
    reportContent: {
      scope: [/Healthy Recipes and CaboHealth Clinic Guide/i, /Recetas Saludables y la Guía de la Clínica CaboHealth/i],
      contact: [/prefix the subject with “Report Content”/i, /comienza el asunto con “Reportar contenido”/i],
      details: [/module, public page, and concern/i, /módulo, la página pública y el problema/i],
      privacy: [/Do not include health or other sensitive information/i, /No incluyas información de salud ni otra información sensible/i],
      review: [/no response deadline is promised/i, /no se promete un plazo de respuesta/i],
      support: [/Support page/i, /página de Soporte/i],
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

test('Report Content route uses only the frozen email contact and an explicit support fallback', () => {
  const contactRecord = readJson('release/public-contact-facts.json');
  const html = readArtifact(pagePaths.reportContent);
  const hrefs = attributeValues(html, 'href');
  const emailAction = `mailto:${contactRecord.facts.publicEmail.value}`;

  assert.equal(contactRecord.status, 'owner-confirmed');
  assert.equal(hrefs.filter((href) => href === emailAction).length, 2, 'email must render once per locale');
  assert.equal(hrefs.includes(`tel:${contactRecord.facts.phone.value}`), false);
  assert.equal(hrefs.includes(contactRecord.facts.whatsApp.value), false);
  assert.equal(hrefs.includes(contactRecord.facts.appleMapsDestination.value), false);
  assert.equal(hrefs.includes(legalUrls.support), true, 'support fallback must be explicit');
  assert.match(html, /data-contact-record=["']release\/public-contact-facts\.json["']/i);
});

test('Report Content reuses the exact legal-page visual and CSP contract', () => {
  const reference = readArtifact(pagePaths.privacy);
  const reportContent = readArtifact(pagePaths.reportContent);
  const styleBlock = (html) => html.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
  const csp = (html) => html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']+)["']>/i)?.[1];

  assert.equal(styleBlock(reportContent), styleBlock(reference));
  assert.equal(csp(reportContent), csp(reference));
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
  for (const [page, path] of Object.entries(pagePaths)) {
    assertStaticLegalSurface(readArtifact(path), path, legalUrls[page]);
  }
});

test('active-resource mutation matrix rejects every supported remote loading mechanism', async (t) => {
  const baseline = readArtifact(pagePaths.privacy);
  const mutations = [
    '<script src="https://tracker.example/script.js"></script>',
    '<link rel="stylesheet" href="https://cdn.example/style.css">',
    '<style>@import "https://cdn.example/style.css";</style>',
    '<style>.remote { background-image: url(https://cdn.example/pixel.png); }</style>',
    '<form action="https://collector.example/"><input name="health"></form>',
    '<a target="_blank" href="https://cabohealth.org/app/privacy/">Popup</a>',
    '<iframe src="https://collector.example/"></iframe>',
    '<link rel="preload" as="style" href="https://cabohealth.org/asset.css">',
    '<link rel="prefetch" href="https://cabohealth.org/future.html">',
    '<link rel="modulepreload" href="https://cabohealth.org/module.js">',
    '<svg><use href="https://cabohealth.org/sprite.svg#logo"></use></svg>',
    '<svg><image xlink:href="https://cabohealth.org/image.svg"></image></svg>',
    '<a href="https://cabohealth.org/app/privacy/" ping="https://cabohealth.org/ping">Tracked link</a>',
    '<meta http-equiv="refresh" content="0;url=https://cabohealth.org/app/privacy/">',
    '<base href="https://cabohealth.org/app/privacy/">',
    '<link title=">" rel="preload" href="https://cabohealth.org/asset.css">',
    '<img src=https://tracker.example/pixel>',
    '<meta http-equiv="ref&#114;esh" content="0;url=https://tracker.example/">',
    '<!--><img src=https://tracker.example/p>-->',
  ];

  for (const mutation of mutations) {
    await t.test(mutation, () => {
      assert.throws(
        () => assertStaticLegalSurface(`${baseline}\n${mutation}`, 'mutated privacy', legalUrls.privacy),
        assert.AssertionError,
        mutation,
      );
    });
  }
});

test('draft compliance facts preserve confirmed owner facts and every unresolved gate', () => {
  const facts = readJson('release/compliance-facts.json');
  assert.equal(facts.schemaVersion, 1);
  assert.equal(facts.brand, 'Cabo Health');
  assert.deepEqual(facts.legalEntity, {
    name: 'Ivan Guaderrama',
    nameStatus: 'owner-confirmed',
    sellerType: 'individual',
    registeredOrganization: false,
    dunsApplicable: false,
    dunsNumber: null,
    legalSignOffStatus: 'pending',
  });
  assert.deepEqual(facts.appStore, {
    seller: {
      value: { sellerType: 'individual', legalSeller: 'Ivan Guaderrama' },
      status: 'verified',
    },
    sellerRelationship: {
      value: {
        publicBrand: 'Cabo Health',
        brandIsSeparateLegalEntity: false,
        relationship: 'trade brand owned and operated by Ivan Guaderrama',
      },
      status: 'verified',
    },
  });
  assert.deepEqual(facts.phiRemediation, {
    value: {
      completed: true,
      evidenceRef: 'private-evidence:owner-authorized-phi-remediation',
    },
    status: 'verified',
  });
  assert.equal(facts.releaseReady, false);

  const requiredPendingPaths = [
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
  ];
  for (const path of requiredPendingPaths) {
    const gate = path.reduce((value, key) => value?.[key], facts);
    assert.deepEqual(gate, { value: null, status: 'pending' }, `${path.join('.')} must fail closed`);
  }
});

test('release verification fails closed and names every still-unresolved gate', () => {
  const result = spawnSync(process.execPath, [verifierPath, projectRoot], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  for (const gate of [
    'legalEntity.legalSignOffStatus',
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
