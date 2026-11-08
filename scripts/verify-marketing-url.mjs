import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MARKETING_URL = 'https://cabohealth.org/app/';
export const MARKETING_SOURCE_PATH = 'web-hosting/cabohealth.org/app/index.html';
export const MARKETING_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const APP_HEADERS_PATH = 'web-hosting/cabohealth.org/app/.htaccess';
const allowedHrefs = new Set([
  '#content',
  '#english',
  '#espanol',
  MARKETING_URL,
  'https://cabohealth.org/apps/healthy-recipes/',
  'https://cabohealth.org/apps/clinic-guide/',
  'https://cabohealth.org/app/privacy/',
  'https://cabohealth.org/app/terms/',
  'https://cabohealth.org/app/support/',
  'https://cabohealth.org/app/report-content/',
]);
const requiredCopy = Object.freeze([
  'Longevity, grounded in science.',
  'Longevidad, basada en ciencia.',
  'Two public editorial resources',
  'Dos recursos editoriales públicos',
  'An editorial recipe collection with practical filters and favorites kept on your device.',
  'Una colección editorial de recetas con filtros prácticos y favoritos que permanecen en tu dispositivo.',
  'An editorial visit guide with public clinic information and a checklist stored on your device.',
  'Una guía editorial para la visita con información pública de la clínica y una lista que se guarda en tu dispositivo.',
  'people personally invited by CaboHealth. Access is free and is not sold',
  'personas invitadas personalmente por CaboHealth. El acceso es gratuito y no se vende',
  'each invited person receives a separate revocable invitation code, and access cannot be obtained on this public page.',
  'cada persona invitada recibe un código de invitación separado y revocable, y el acceso no se puede obtener en esta página pública.',
  'The content is educational only and is not medical advice or an emergency service.',
  'El contenido es únicamente educativo; no es orientación médica ni un servicio de emergencias.',
]);
const forbiddenCommercialCopy = /\b(?:price|pricing|checkout|subscription|subscribe|iap|purchase|buy|payment|billing|sales?|precio|precios|cobro|pagos?|suscripci[oó]n|suscripciones|suscribir|comprar|compra|ventas?)\b/iu;
const forbiddenOutcomeClaims = /\b(?:cures?|diagnoses?|treats?|treatment|reverse aging|anti-aging|prevents? disease|guaranteed results|cura|curar|diagnostica|tratamiento|revierte el envejecimiento|antienvejecimiento|previene enfermedades|resultados garantizados)\b/iu;
const forbiddenActiveTags = /<(?:script|img|iframe|object|embed|form|input|button|video|audio|source)\b/iu;
const forbiddenRuntimeSurface = /(?:\son[a-z]+\s*=|javascript:|data:|blob:|analytics|tracking|pixel|tagmanager|doubleclick|facebook\.net|localStorage|sessionStorage|document\.cookie)/iu;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'giu')) ?? [];
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'iu'))?.[1];
}

function assertMarketing(condition, code) {
  if (!condition) throw new Error(code);
}

export function verifyMarketingSource({ html, headers, trackedFiles }) {
  assertMarketing(typeof html === 'string' && html.length > 0, 'MARKETING_URL_HTML_MISSING');
  assertMarketing(typeof headers === 'string' && headers.length > 0, 'MARKETING_URL_HEADERS_MISSING');
  assertMarketing(Array.isArray(trackedFiles), 'MARKETING_URL_TRACKED_FILES_INVALID');
  assertMarketing(!html.includes('\r'), 'MARKETING_URL_HTML_NONCANONICAL_LINE_ENDINGS');
  assertMarketing(/^<!doctype html>\n<html lang="en">/u.test(html), 'MARKETING_URL_DOCUMENT_LANGUAGE_INVALID');

  const linkTags = tags(html, 'link');
  assertMarketing(linkTags.length === 1, 'MARKETING_URL_EXTERNAL_RESOURCE_FORBIDDEN');
  const canonicals = linkTags.filter((tag) => attribute(tag, 'rel')?.toLowerCase() === 'canonical');
  assertMarketing(canonicals.length === 1, 'MARKETING_URL_CANONICAL_COUNT_INVALID');
  assertMarketing(attribute(canonicals[0], 'href') === MARKETING_URL, 'MARKETING_URL_CANONICAL_INVALID');

  const cspMetas = tags(html, 'meta').filter((tag) => attribute(tag, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  assertMarketing(cspMetas.length === 1, 'MARKETING_URL_CSP_COUNT_INVALID');
  assertMarketing(attribute(cspMetas[0], 'content') === MARKETING_CSP, 'MARKETING_URL_CSP_INVALID');
  assertMarketing(
    tags(html, 'meta').some((tag) => attribute(tag, 'name') === 'referrer' && attribute(tag, 'content') === 'no-referrer'),
    'MARKETING_URL_REFERRER_META_INVALID',
  );
  assertMarketing(!forbiddenActiveTags.test(html), 'MARKETING_URL_ACTIVE_SURFACE_FORBIDDEN');
  assertMarketing(!forbiddenRuntimeSurface.test(html), 'MARKETING_URL_RUNTIME_SURFACE_FORBIDDEN');
  assertMarketing(!forbiddenCommercialCopy.test(html), 'MARKETING_URL_COMMERCIAL_COPY_FORBIDDEN');
  assertMarketing(!forbiddenOutcomeClaims.test(html), 'MARKETING_URL_OUTCOME_CLAIM_FORBIDDEN');

  for (const copy of requiredCopy) {
    assertMarketing(html.includes(copy), `MARKETING_URL_REQUIRED_COPY_MISSING: ${copy}`);
  }
  for (const href of allowedHrefs) {
    assertMarketing(html.includes(`href="${href}"`), `MARKETING_URL_REQUIRED_LINK_MISSING: ${href}`);
  }
  for (const anchor of tags(html, 'a')) {
    const href = attribute(anchor, 'href');
    assertMarketing(allowedHrefs.has(href), `MARKETING_URL_LINK_FORBIDDEN: ${href ?? 'missing'}`);
    assertMarketing(attribute(anchor, 'target') === undefined, 'MARKETING_URL_NEW_CONTEXT_FORBIDDEN');
  }
  assertMarketing(html.includes('<main id="content"'), 'MARKETING_URL_MAIN_LANDMARK_INVALID');
  assertMarketing(html.includes('<article id="english" lang="en"'), 'MARKETING_URL_ENGLISH_REGION_INVALID');
  assertMarketing(html.includes('<article id="espanol" lang="es-MX"'), 'MARKETING_URL_SPANISH_REGION_INVALID');
  assertMarketing(html.includes('class="skip-link" href="#content"'), 'MARKETING_URL_SKIP_LINK_INVALID');
  assertMarketing(html.includes(':focus-visible'), 'MARKETING_URL_KEYBOARD_FOCUS_INVALID');
  assertMarketing(html.includes('@media (max-width: 48rem)'), 'MARKETING_URL_MOBILE_LAYOUT_INVALID');

  const requiredHeaderLines = [
    `Header always set Content-Security-Policy "${MARKETING_CSP}"`,
    'Header always set X-Content-Type-Options "nosniff"',
    'Header always set X-Frame-Options "DENY"',
    'Header always set Referrer-Policy "no-referrer"',
    'Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"',
    'Header always unset Set-Cookie',
  ];
  for (const line of requiredHeaderLines) {
    assertMarketing(headers.includes(line), `MARKETING_URL_HEADER_POLICY_MISSING: ${line}`);
  }

  const legacyFiles = trackedFiles.filter((path) => basename(path).toLowerCase() === 'cabohealth-app.html');
  assertMarketing(legacyFiles.length === 0, `MARKETING_URL_LEGACY_ARTIFACT_REQUIRES_DISPOSITION: ${legacyFiles.join(',')}`);

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'cabohealth-marketing-url-source-gate-v1',
    status: 'source-verified',
    marketingUrl: MARKETING_URL,
    sourcePath: MARKETING_SOURCE_PATH,
    sourceSha256: sha256(Buffer.from(html, 'utf8')),
    legacyRepositoryArtifact: 'absent',
    productionVerified: false,
  });
}

function trackedRepositoryFiles(root) {
  const result = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`MARKETING_URL_REPOSITORY_AUDIT_FAILED: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter(Boolean);
}

function verifySourceAt(root) {
  return verifyMarketingSource({
    html: readFileSync(join(root, MARKETING_SOURCE_PATH), 'utf8'),
    headers: readFileSync(join(root, APP_HEADERS_PATH), 'utf8'),
    trackedFiles: trackedRepositoryFiles(root),
  });
}

function markdownSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return markdown.match(new RegExp(`^## ${escaped}\\n([^\\n]+)$`, 'mu'))?.[1];
}

export function verifyMarketingReleaseMetadata(root) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'release/app-store/3.0/release-manifest.json'), 'utf8'));
  } catch {
    throw new Error('MARKETING_URL_METADATA_NOT_UPDATED');
  }
  const localizedUrls = ['en-US.md', 'es-MX.md'].map((filename) => markdownSection(
    readFileSync(join(root, 'release/app-store/3.0', filename), 'utf8'),
    'Marketing URL',
  ));
  assertMarketing(
    manifest?.urls?.marketing === MARKETING_URL && localizedUrls.every((url) => url === MARKETING_URL),
    'MARKETING_URL_METADATA_NOT_UPDATED',
  );
  return Object.freeze({
    manifest: MARKETING_URL,
    'en-US': MARKETING_URL,
    'es-MX': MARKETING_URL,
  });
}

export function verifyMarketingProductionResponse({ sourceHtml, responseUrl, status, headers, body }) {
  assertMarketing(typeof sourceHtml === 'string' && sourceHtml.length > 0, 'MARKETING_URL_PRODUCTION_SOURCE_INVALID');
  assertMarketing(responseUrl === MARKETING_URL, 'MARKETING_URL_PRODUCTION_FINAL_URL_INVALID');
  assertMarketing(status === 200, 'MARKETING_URL_PRODUCTION_STATUS_INVALID');
  assertMarketing(headers && typeof headers === 'object' && !Array.isArray(headers), 'MARKETING_URL_PRODUCTION_HEADERS_INVALID');
  assertMarketing(headers['content-type'] === 'text/html; charset=utf-8', 'MARKETING_URL_PRODUCTION_CONTENT_TYPE_INVALID');
  assertMarketing(headers['content-security-policy'] === MARKETING_CSP, 'MARKETING_URL_PRODUCTION_CSP_INVALID');
  assertMarketing(headers['x-content-type-options'] === 'nosniff', 'MARKETING_URL_PRODUCTION_NOSNIFF_INVALID');
  assertMarketing(headers['x-frame-options'] === 'DENY', 'MARKETING_URL_PRODUCTION_FRAMING_INVALID');
  assertMarketing(headers['referrer-policy'] === 'no-referrer', 'MARKETING_URL_PRODUCTION_REFERRER_INVALID');
  assertMarketing(
    headers['permissions-policy'] === 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'MARKETING_URL_PRODUCTION_PERMISSIONS_INVALID',
  );
  assertMarketing(headers['set-cookie'] === null || headers['set-cookie'] === undefined, 'MARKETING_URL_PRODUCTION_COOKIE_FORBIDDEN');
  assertMarketing(typeof body === 'string' && body === sourceHtml, 'MARKETING_URL_PRODUCTION_BYTES_MISMATCH');

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'cabohealth-marketing-url-production-gate-v1',
    status: 'production-verified',
    marketingUrl: MARKETING_URL,
    sourceSha256: sha256(Buffer.from(sourceHtml, 'utf8')),
    finalUrl: responseUrl,
    httpStatus: status,
    contentType: headers['content-type'],
    setCookie: false,
  });
}

export async function fetchAndVerifyMarketingProduction({ sourceHtml, confirmed, fetchImpl = globalThis.fetch }) {
  assertMarketing(confirmed === true, 'MARKETING_URL_PRODUCTION_CONFIRMATION_REQUIRED');
  assertMarketing(typeof fetchImpl === 'function', 'MARKETING_URL_PRODUCTION_FETCH_UNAVAILABLE');
  const response = await fetchImpl(MARKETING_URL, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  const headerNames = [
    'content-type',
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'set-cookie',
  ];
  const headers = Object.fromEntries(headerNames.map((name) => [name, response.headers.get(name)]));
  return verifyMarketingProductionResponse({
    sourceHtml,
    responseUrl: response.url,
    status: response.status,
    headers,
    body: await response.text(),
  });
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  assertMarketing(mode === '--source' || mode === '--release', 'MARKETING_URL_USAGE_INVALID');
  if (mode === '--source') assertMarketing(extra.length === 0, 'MARKETING_URL_USAGE_INVALID');
  if (mode === '--release') {
    assertMarketing(
      extra.length === 0 || (extra.length === 1 && extra[0] === '--confirm-production-fetch'),
      'MARKETING_URL_USAGE_INVALID',
    );
  }
  const source = verifySourceAt(projectRoot);
  if (mode === '--source') {
    process.stdout.write(`${JSON.stringify(source)}\n`);
    return;
  }
  verifyMarketingReleaseMetadata(projectRoot);
  const production = await fetchAndVerifyMarketingProduction({
    sourceHtml: readFileSync(join(projectRoot, MARKETING_SOURCE_PATH), 'utf8'),
    confirmed: extra[0] === '--confirm-production-fetch',
  });
  process.stdout.write(`${JSON.stringify(production)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`MARKETING_URL_GATE_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
