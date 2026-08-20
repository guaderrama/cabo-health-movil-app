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
  const approvedFactStatements = [
    'Cabo Health responds within 2 business days.',
    'Cabo Health responde dentro de 2 días hábiles.',
    'Cabo Health responds to content reports within 2 business days.',
    'Cabo Health responde a los reportes de contenido dentro de 2 días hábiles.',
  ];
  const unapprovedClaims = approvedFactStatements.reduce(
    (value, statement) => value.replaceAll(statement, '[OWNER-APPROVED FACT]'),
    html,
  );
  for (const forbidden of forbiddenReleaseClaims) assert.doesNotMatch(unapprovedClaims, forbidden);
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
      operator: [/trade brand owned and operated by Ivan Guaderrama/i, /marca comercial propiedad de Ivan Guaderrama y operada por él/i],
      'data-boundary': [/do not request or collect health information/i, /no solicitan ni recopilan información de salud/i],
      'local-state': [/remain on your device/i, /permanecen en tu dispositivo/i],
      'hosting-logs': [/visible in hPanel for up to 7 days/i, /visibles en hPanel hasta por 7 días/i],
      children: [/no way to submit a child's personal or health information/i, /ni una manera de enviar información personal o de salud de un menor/i],
      contact: [/Do not include health or other sensitive information/i, /No incluyas información de salud ni otra información sensible/i],
      changes: [/Material changes will be published/i, /cambios materiales se publicarán/i],
    },
    terms: {
      scope: [/do not diagnose, treat, or prescribe/i, /No diagnostican, tratan ni prescriben/i],
      emergency: [/Call local emergency services/i, /Llama a los servicios locales de emergencia/i],
      'acceptable-use': [/no user-generated content area/i, /no tienen un área de contenido generado por usuarios/i],
      rights: [/owns or is authorized to use the Cabo Health logo/i, /es propietario o cuenta con autorización para usar el logotipo/i],
      'external-services': [/separate services governed by their providers/i, /servicios separados regidos por sus proveedores/i],
      availability: [/initial App Store release is intended only for Mexico and the United States/i, /lanzamiento inicial en App Store está previsto únicamente para México y Estados Unidos/i],
      'approval-contact': [/Do not include health or other sensitive information/i, /No incluyas información de salud ni otra información sensible/i],
    },
    support: {
      contact: [/responds within 2 business days/i, /responde dentro de 2 días hábiles/i],
      recipes: [/Favorites are local to the device/i, /Los favoritos son locales al dispositivo/i],
      clinic: [/module is not an emergency channel/i, /módulo no es un canal de emergencia/i],
      privacy: [/do not request or collect health information/i, /no solicitan ni recopilan información de salud/i],
      'report-content': [/without including sensitive information/i, /sin incluir información sensible/i],
      scope: [/does not provide medical advice/i, /No ofrece orientación médica/i],
    },
    reportContent: {
      scope: [/Healthy Recipes and CaboHealth Clinic Guide/i, /Recetas Saludables y la Guía de la Clínica CaboHealth/i],
      contact: [/prefix the subject with “Report Content”/i, /comienza el asunto con “Reportar contenido”/i],
      details: [/module, public page, and concern/i, /módulo, la página pública y el problema/i],
      privacy: [/Do not include health or other sensitive information/i, /No incluyas información de salud ni otra información sensible/i],
      review: [/responds to content reports within 2 business days/i, /responde a los reportes de contenido dentro de 2 días hábiles/i],
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
    /IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency/i,
    /IP address, browser or user-agent, requested URL, and technical errors/i,
    /visible in hPanel for up to 7 days/i,
    /additional retention and deletion are controlled by Hostinger/i,
    /no solicitan ni recopilan información de salud/i,
    /sin cuenta/i,
    /sin identificadores generados por la app/i,
    /sin analítica/i,
    /sin publicidad/i,
    /sin permisos sensibles/i,
    /favoritos y preferencias permanecen en tu dispositivo/i,
    /dos módulos públicos/i,
    /dirección IP, marca de tiempo, método HTTP, recurso solicitado, detalles del dispositivo y agente de usuario, país, bytes de respuesta y latencia/i,
    /dirección IP, navegador o agente de usuario, URL solicitada y errores técnicos/i,
    /visibles en hPanel hasta por 7 días/i,
    /retención adicional y la eliminación están bajo el control de Hostinger/i,
  ]) assert.match(html, pattern);
});

test('privacy publishes the owner-authorized operator and Hostinger facts in both languages', () => {
  const html = readArtifact(pagePaths.privacy);

  assert.doesNotMatch(html, /\b(?:draft|pending)\b|\b(?:borrador|pendiente)\b/i);
  for (const pattern of [
    /Cabo Health is a trade brand owned and operated by Ivan Guaderrama/i,
    /Cabo Health es una marca comercial propiedad de Ivan Guaderrama y operada por él/i,
    /IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency/i,
    /dirección IP, marca de tiempo, método HTTP, recurso solicitado, detalles del dispositivo y agente de usuario, país, bytes de respuesta y latencia/i,
    /IP address, browser or user-agent, requested URL, and technical errors/i,
    /dirección IP, navegador o agente de usuario, URL solicitada y errores técnicos/i,
    /visible in hPanel for up to 7 days/i,
    /visibles en hPanel hasta por 7 días/i,
    /additional retention and deletion are controlled by Hostinger/i,
    /cualquier retención adicional y la eliminación están bajo el control de Hostinger/i,
  ]) assert.match(html, pattern);

  assert.doesNotMatch(html, /deleted automatically after (?:7|seven) days/i);
  assert.doesNotMatch(html, /se eliminan automáticamente después de (?:7|siete) días/i);
});

test('terms publish the confirmed educational, rights, and initial-territory scope bilingually', () => {
  const html = readArtifact(pagePaths.terms);

  assert.doesNotMatch(html, /\b(?:draft|pending)\b|\b(?:borrador|pendiente)\b/i);
  for (const pattern of [
    /general educational information and are not medical devices/i,
    /información educativa general y no son dispositivos médicos/i,
    /do not diagnose, treat, or prescribe/i,
    /no diagnostican, tratan ni prescriben/i,
    /Cabo Health is a trade brand owned and operated by Ivan Guaderrama/i,
    /Cabo Health es una marca comercial propiedad de Ivan Guaderrama y operada por él/i,
    /owns or is authorized to use the Cabo Health logo, domain, texts, recipes, and images included in public v1/i,
    /es propietario o cuenta con autorización para usar el logotipo, el dominio, los textos, las recetas y las imágenes de Cabo Health incluidos en la v1 pública/i,
    /initial App Store release is intended only for Mexico and the United States/i,
    /lanzamiento inicial en App Store está previsto únicamente para México y Estados Unidos/i,
  ]) assert.match(html, pattern);

  assert.doesNotMatch(html, /registered (?:company|organization)|empresa u organización registrada/i);
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
  assert.match(html, /Cabo Health responds within 2 business days/i);
  assert.match(html, /Cabo Health responde dentro de 2 días hábiles/i);
  assert.match(html, /Healthy Recipes/);
  assert.match(html, /Recetas Saludables/);
  assert.match(html, /Clinic Guide/);
  assert.match(html, /Guía de la Clínica/);
});

test('support publishes the confirmed bilingual hours and two-business-day response policy', () => {
  const html = readArtifact(pagePaths.support);

  assert.match(html, /Cabo Health responds within 2 business days/i);
  assert.match(html, /Cabo Health responde dentro de 2 días hábiles/i);
  assert.match(html, /Monday–Friday, 10:00 AM–4:00 PM/);
  assert.match(html, /lunes a viernes, de 10:00 a\. m\. a 4:00 p\. m\./i);
  assert.doesNotMatch(html, /no response deadline is promised|no se promete un plazo de respuesta/i);
  assert.doesNotMatch(html, /response service level remains pending|nivel de servicio de respuesta sigue pendiente/i);
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

test('Report Content publishes the confirmed review window and response policy bilingually', () => {
  const html = readArtifact(pagePaths.reportContent);

  assert.match(html, /Cabo Health responds to content reports within 2 business days/i);
  assert.match(html, /Cabo Health responde a los reportes de contenido dentro de 2 días hábiles/i);
  assert.match(html, /Reports are reviewed Monday–Friday, 10:00 AM–4:00 PM/i);
  assert.match(html, /Los reportes se revisan de lunes a viernes, de 10:00 a\. m\. a 4:00 p\. m\./i);
  assert.doesNotMatch(html, /no response deadline is promised|no se promete un plazo de respuesta/i);
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

test('compliance facts preserve every owner-confirmed fact and the saved Apple age rating', () => {
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
    legalSignOffStatus: 'approved',
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
  assert.equal(facts.releaseReady, true);

  assert.deepEqual(facts.hosting, {
    provider: 'Hostinger',
    logTypes: {
      value: ['IP address', 'browser or user-agent', 'requested URL', 'technical errors'],
      status: 'verified',
    },
    retention: {
      value: {
        description: 'Owner authorized 2026-08-17: hPanel visibility is up to 7 days; any additional retention is controlled by Hostinger.',
      },
      status: 'verified',
    },
    deletionProcess: {
      value: {
        description: 'Owner authorized 2026-08-17: deletion beyond hPanel visibility is controlled by Hostinger.',
      },
      status: 'verified',
    },
  });
  assert.deepEqual(facts.support.responseSla, {
    value: {
      description: 'Owner confirmed 2026-08-17: respond within 2 business days, Monday-Friday, 10:00 AM-4:00 PM.',
    },
    status: 'verified',
  });
  assert.deepEqual(facts.contentRights, {
    value: {
      approved: true,
      scope: 'Owner confirmed 2026-08-17: ownership or authorization for the Cabo Health logo, domain, texts, recipes, and images used by public v1.',
    },
    status: 'verified',
  });
  assert.deepEqual(facts.exportCompliance, {
    value: {
      approved: true,
      determination: 'Owner confirmed 2026-08-17: standard iOS platform encryption and HTTPS only; no proprietary or custom cryptography.',
    },
    status: 'verified',
  });
  assert.deepEqual(facts.medicalDevice, {
    value: {
      isMedicalDevice: false,
      basis: 'Owner confirmed 2026-08-17: educational only; no diagnosis, treatment, or medical-device function.',
    },
    status: 'verified',
  });

  const verifiedAgePaths = [
    ['ageRating', 'host'],
    ['ageRating', 'miniapps', 'healthy-recipes'],
    ['ageRating', 'miniapps', 'clinic-guide'],
  ];
  for (const path of verifiedAgePaths) {
    const gate = path.reduce((value, key) => value?.[key], facts);
    assert.deepEqual(gate, { value: 9, status: 'verified' }, `${path.join('.')} must retain Apple 9+`);
  }
});

test('release verification accepts the owner-approved facts and saved Apple age rating', () => {
  const result = spawnSync(process.execPath, [verifierPath, projectRoot], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  for (const resolvedGate of [
    'legalEntity.legalSignOffStatus',
    'hosting.logTypes',
    'hosting.retention',
    'hosting.deletionProcess',
    'support.responseSla',
    'contentRights',
    'exportCompliance',
    'medicalDevice',
  ]) assert.doesNotMatch(result.stderr, new RegExp(`Pending release gate: ${resolvedGate.replaceAll('.', '\\.')}`));
  assert.doesNotMatch(result.stderr, /Release compliance facts are not marked ready/i);
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

test('operational drafts retain only current Hostinger and release blockers', () => {
  const runbook = readArtifact('docs/operations/hostinger-deploy-runbook.md');
  const hostingChecklist = readArtifact('docs/operations/hosting-security-checklist.md');

  assert.match(runbook, /immutable content payload remains exactly 16 files/i);
  assert.match(runbook, /two approved module roots; and six shared assets/i);
  assert.match(runbook, /fixed schema and 16-path allowlist/i);
  assert.match(runbook, /exactly two server-environment overlays/i);
  assert.match(runbook, /do not change the 16-file release inventory or release ID/i);
  assert.doesNotMatch(runbook, /exactly 14 files|14-path allowlist|four shared assets/i);
  assert.doesNotMatch(runbook, /11 external compliance facts|final legal copy\/sign-off/i);
  assert.doesNotMatch(hostingChecklist, /Confirm actual Hostinger technical log types, purpose, retention, access, and deletion process/i);
  assert.match(hostingChecklist, /IP address, browser\/user-agent, requested URL, and technical errors/i);
  assert.match(hostingChecklist, /hPanel visibility is up to 7 days/i);
  assert.match(hostingChecklist, /additional retention and deletion are controlled by Hostinger/i);
  assert.match(hostingChecklist, /linkage and access controls/i);
});
