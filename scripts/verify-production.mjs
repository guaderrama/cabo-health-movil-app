import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalAasaBytes, readReleaseIdentity } from './generate-aasa.mjs';
import { CONTENT_SECURITY_POLICY, MINIAPP_SECURITY_HEADERS } from './build-miniapps.mjs';
import { assertStaticWebPolicy } from './web-release-policy.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const RELEASE_ID = /^web-v1-[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const ROLLBACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const LEGAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ORIGIN_PAYLOAD_PATHS = Object.freeze([
  '.well-known/apple-app-site-association',
  'app/privacy/index.html',
  'app/report-content/index.html',
  'app/support/index.html',
  'app/terms/index.html',
  'apps/.htaccess',
  'apps/clinic-guide/app.js',
  'apps/clinic-guide/index.html',
  'apps/healthy-recipes/app.js',
  'apps/healthy-recipes/index.html',
  'apps/shared/logo.png',
  'apps/shared/motion.js',
  'apps/shared/shell.js',
  'apps/shared/styles.css',
]);
const LEGAL_URLS = Object.freeze([
  'https://cabohealth.org/app/privacy/',
  'https://cabohealth.org/app/terms/',
  'https://cabohealth.org/app/support/',
  'https://cabohealth.org/app/report-content/',
]);
const PROMOTE_TARGETS = Object.freeze([
  'public_html/apps/.htaccess',
  'public_html/apps/shared',
  'public_html/app/privacy',
  'public_html/app/terms',
  'public_html/app/support',
  'public_html/app/report-content',
  'public_html/apps/healthy-recipes',
  'public_html/apps/clinic-guide',
  'public_html/.well-known/apple-app-site-association',
]);
const INPUT_POLICY = Object.freeze([
  Object.freeze(['miniapps/dist', 'task6b-miniapp']),
  Object.freeze(['web-hosting/cabohealth.org/app/privacy/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/app/terms/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/app/support/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/app/report-content/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/.well-known/apple-app-site-association', 'aasa']),
  Object.freeze(['miniapps/shared/security-headers.conf', 'apache-security']),
  Object.freeze(['web-hosting/cabohealth.org/apps/.htaccess', 'apache-security']),
]);
const ARTIFACT_KEYS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'releaseId',
  'inventorySha256',
  'appId',
  'entrySlugs',
  'legalSlugs',
  'promoteTargets',
  'inputs',
  'files',
]);

function assertExactKeys(value, keys, label) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))
  ) throw new Error(`${label}_SCHEMA_INVALID`);
}

function isCanonicalUtcTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && new Date(value).toISOString() === value;
}

function publicUrlPath(path) {
  return `/${path.replace(/index\.html$/u, '')}`;
}

function headerProfile(path) {
  if (path.startsWith('apps/')) return 'miniapp-security';
  if (path.startsWith('app/')) return 'legal-frame-blocked';
  return 'aasa';
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function expectedMediaType(path) {
  if (path.endsWith('apple-app-site-association')) return 'application/json';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'text/plain; charset=utf-8';
}

function expectedKind(path) {
  if (path === 'apps/.htaccess') return 'apache-security';
  if (path.startsWith('apps/')) return 'task6b-miniapp';
  if (path.startsWith('app/')) return 'task7-legal';
  return 'aasa';
}

export function validateArtifactAuthority(artifact, authority) {
  assertExactKeys(authority, ['reviewedReleaseId', 'reviewedArtifactSha256'], 'REVIEWED_ARTIFACT_AUTHORITY');
  if (
    typeof authority.reviewedReleaseId !== 'string'
    || !RELEASE_ID.test(authority.reviewedReleaseId)
    || typeof authority.reviewedArtifactSha256 !== 'string'
    || !SHA256.test(authority.reviewedArtifactSha256)
  ) throw new Error('REVIEWED_ARTIFACT_AUTHORITY_INVALID');
  assertExactKeys(artifact, ARTIFACT_KEYS, 'WEB_ARTIFACT');
  if (
    artifact.schemaVersion !== 1
    || artifact.artifactKind !== 'cabohealth-public-web-v1'
    || artifact.appId !== 'DQ8PH2DZ3R.com.cabohealth.app'
    || JSON.stringify(artifact.entrySlugs) !== JSON.stringify(['healthy-recipes', 'clinic-guide'])
    || JSON.stringify(artifact.legalSlugs) !== JSON.stringify(['privacy', 'terms', 'support', 'report-content'])
    || JSON.stringify(artifact.promoteTargets) !== JSON.stringify(PROMOTE_TARGETS)
    || !Array.isArray(artifact.inputs)
    || artifact.inputs.length !== INPUT_POLICY.length
    || !Array.isArray(artifact.files)
    || artifact.files.length !== ORIGIN_PAYLOAD_PATHS.length
  ) throw new Error('WEB_ARTIFACT_POLICY_INVALID');
  for (const [index, entry] of artifact.inputs.entries()) {
    assertExactKeys(entry, ['path', 'size', 'sha256', 'kind'], 'WEB_ARTIFACT_INPUT');
    const [path, kind] = INPUT_POLICY[index];
    if (
      entry.path !== path
      || entry.kind !== kind
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || typeof entry.sha256 !== 'string'
      || !SHA256.test(entry.sha256)
    ) throw new Error('WEB_ARTIFACT_INPUT_INVALID');
  }
  for (const [index, entry] of artifact.files.entries()) {
    assertExactKeys(entry, ['path', 'size', 'sha256', 'mediaType', 'deployMode', 'kind'], 'WEB_ARTIFACT_FILE');
    const path = ORIGIN_PAYLOAD_PATHS[index];
    if (
      entry.path !== path
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || typeof entry.sha256 !== 'string'
      || !SHA256.test(entry.sha256)
      || entry.mediaType !== expectedMediaType(path)
      || entry.deployMode !== '0644'
      || entry.kind !== expectedKind(path)
    ) throw new Error(`WEB_ARTIFACT_FILE_INVALID: ${path}`);
  }
  const policy = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [...PROMOTE_TARGETS],
    files: artifact.files,
  };
  const inventorySha256 = sha256(Buffer.from(canonicalJson(policy)));
  if (
    artifact.inventorySha256 !== inventorySha256
    || artifact.releaseId !== `web-v1-${inventorySha256}`
    || artifact.releaseId !== authority.reviewedReleaseId
    || sha256(Buffer.from(canonicalJson(artifact))) !== authority.reviewedArtifactSha256
  ) throw new Error('WEB_ARTIFACT_AUTHORITY_RECONCILIATION_FAILED');
  return artifact;
}

export function createUnknownSlug() {
  return `task-8-unknown-${randomBytes(16).toString('hex')}`;
}

function assertActionPath(path) {
  const protectedPaths = new Set([
    '/',
    '/apps/',
    '/apps/.htaccess',
    ...ORIGIN_PAYLOAD_PATHS.filter((item) => item !== 'apps/.htaccess').map(publicUrlPath),
  ]);
  if (
    typeof path !== 'string'
    || !path.startsWith('/')
    || path.startsWith('//')
    || path.includes('\\')
    || /[?#\u0000-\u001f\u007f]/u.test(path)
    || /(?:^|\/)\.\.?(?:\/|$)/u.test(path)
    || /%2e|%2f|%5c/iu.test(path)
    || protectedPaths.has(path)
  ) throw new Error('SENSITIVE_CONTROLS_INVALID');
}

export function validateSensitiveControls(value) {
  assertExactKeys(value, [
    'unrelatedPath',
    'unrelatedExpectedStatuses',
    'terminalPath',
    'terminalExpectedStatuses',
  ], 'SENSITIVE_CONTROLS');
  assertActionPath(value.unrelatedPath);
  assertActionPath(value.terminalPath);
  if (
    value.unrelatedPath === value.terminalPath
    || JSON.stringify(value.unrelatedExpectedStatuses) !== JSON.stringify([200])
    || !Array.isArray(value.terminalExpectedStatuses)
    || value.terminalExpectedStatuses.length < 1
    || value.terminalExpectedStatuses.length > 3
    || value.terminalExpectedStatuses.some((status, index, array) => (
      ![403, 404, 410].includes(status) || (index > 0 && array[index - 1] >= status)
    ))
  ) throw new Error('SENSITIVE_CONTROLS_INVALID');
  return value;
}

export function validateServerInventoryEvidence(value) {
  assertExactKeys(value, ['status', 'rootCount', 'fileCount', 'inventorySha256'], 'SERVER_INVENTORY');
  if (
    value.status !== 'verified'
    || value.rootCount !== 3
    || value.fileCount !== 8
    || typeof value.inventorySha256 !== 'string'
    || !SHA256.test(value.inventorySha256)
  ) throw new Error('SERVER_INVENTORY_INVALID');
  return true;
}

export function validateBrowserEvidence(value) {
  assertExactKeys(value, [
    'status',
    'viewportCount',
    'localeCount',
    'javascriptModeCount',
    'unexpectedRequests',
    'consoleErrors',
    'noJsReadable',
  ], 'BROWSER_EVIDENCE');
  if (
    value.status !== 'verified'
    || value.viewportCount !== 2
    || value.localeCount !== 2
    || value.javascriptModeCount !== 2
    || value.unexpectedRequests !== 0
    || value.consoleErrors !== 0
    || value.noJsReadable !== true
  ) throw new Error('BROWSER_EVIDENCE_INVALID');
  return true;
}

function assertAllowedBaseUrl(baseUrl, productionConfirmation) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('ORIGIN_BASE_URL_INVALID');
  }
  if (
    productionConfirmation === 'cabohealth.org'
    && parsed.href === 'https://cabohealth.org/'
  ) return parsed;
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) throw new Error('ORIGIN_NETWORK_FORBIDDEN_WITHOUT_EXPLICIT_PRODUCTION_CONFIRMATION');
  return parsed;
}

function tags(text, name) {
  return text.match(new RegExp(`<${name}\\b[^>]*>`, 'giu')) ?? [];
}

function attribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function assertPublicHtml(path, bytes) {
  assertStaticWebPolicy(path, bytes);
  const text = bytes.toString('utf8');
  const expectedCanonical = `https://cabohealth.org/${path.replace(/index\.html$/u, '')}`;
  const canonicals = tags(text, 'link').filter((tag) => attribute(tag, 'rel')?.toLowerCase() === 'canonical');
  if (canonicals.length !== 1 || attribute(canonicals[0], 'href') !== expectedCanonical) {
    throw new Error(`ORIGIN_CANONICAL_INVALID: ${path}`);
  }
  const cspTags = tags(text, 'meta').filter((tag) => attribute(tag, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  const expectedCsp = path.startsWith('apps/') ? CONTENT_SECURITY_POLICY : LEGAL_CSP;
  if (cspTags.length !== 1 || attribute(cspTags[0], 'content') !== expectedCsp) {
    throw new Error(`ORIGIN_META_CSP_INVALID: ${path}`);
  }
  for (const url of LEGAL_URLS) {
    if (!text.includes(`href="${url}"`) && !text.includes(`href='${url}'`)) {
      throw new Error(`ORIGIN_LEGAL_LINK_MISSING: ${path}`);
    }
  }
  if (
    /<(?:form|input|textarea|iframe|object|embed)\b/iu.test(text)
    || /\btarget\s*=\s*["']?_blank/iu.test(text)
    || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/iu.test(text)
    || /<(?:script|img|iframe|source|video|audio)\b[^>]*\bsrc\s*=\s*["']?https?:/iu.test(text)
    || /<link\b(?=[^>]*\brel\s*=\s*["']?(?:stylesheet|preload|prefetch|modulepreload))[^>]*\bhref\s*=\s*["']?https?:/iu.test(text)
    || /@import\s+["']?https?:|url\(\s*["']?https?:|http:\/\//iu.test(text)
    || /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|Worker|SharedWorker)\s*\(/u.test(text)
    || /\bdocument\.cookie\b/u.test(text)
  ) throw new Error(`ORIGIN_ACTIVE_CONTENT_FORBIDDEN: ${path}`);
}

function assertPublicJavascript(path, bytes) {
  const text = bytes.toString('utf8');
  if (
    /http:\/\//iu.test(text)
    || /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|Worker|SharedWorker)\s*\(/u.test(text)
    || /\bdocument\.cookie\b/u.test(text)
    || /\bimport\s*\(/u.test(text)
  ) throw new Error(`ORIGIN_SCRIPT_NETWORK_SURFACE_FORBIDDEN: ${path}`);
}

async function exactFetch(base, path) {
  const expectedUrl = new URL(path, base).href;
  const response = await fetch(expectedUrl, { redirect: 'manual', headers: { 'Accept-Encoding': 'identity' } });
  if (response.url !== expectedUrl) throw new Error(`ORIGIN_FINAL_URL_INVALID: ${path}`);
  return response;
}

export async function verifyOrigin({
  artifact,
  reviewedReleaseId,
  reviewedArtifactSha256,
  baseUrl,
  sensitiveControls,
  productionConfirmation = null,
}) {
  validateArtifactAuthority(artifact, { reviewedReleaseId, reviewedArtifactSha256 });
  const controls = validateSensitiveControls(sensitiveControls);
  const base = assertAllowedBaseUrl(baseUrl, productionConfirmation);

  const rootResponse = await exactFetch(base, '/');
  if (rootResponse.status !== 200) throw new Error('ORIGIN_WORDPRESS_CONTROL_FAILED');
  await rootResponse.arrayBuffer();
  const unrelatedResponse = await exactFetch(base, controls.unrelatedPath);
  if (!controls.unrelatedExpectedStatuses.includes(unrelatedResponse.status)) {
    throw new Error('ORIGIN_UNRELATED_CONTROL_FAILED');
  }
  await unrelatedResponse.arrayBuffer();
  const terminalResponse = await exactFetch(base, controls.terminalPath);
  if (!controls.terminalExpectedStatuses.includes(terminalResponse.status)) {
    throw new Error('ORIGIN_TERMINAL_CONTROL_FAILED');
  }
  await terminalResponse.arrayBuffer();

  const urls = [];
  for (const entry of artifact.files) {
    if (entry.path === 'apps/.htaccess') continue;
    const urlPath = publicUrlPath(entry.path);
    const response = await exactFetch(base, urlPath);
    if (response.status !== 200) throw new Error(`ORIGIN_STATUS_INVALID: ${urlPath}`);
    if (response.headers.has('set-cookie')) throw new Error(`ORIGIN_SET_COOKIE_FORBIDDEN: ${urlPath}`);
    const contentType = response.headers.get('content-type');
    if (contentType !== entry.mediaType) throw new Error(`ORIGIN_CONTENT_TYPE_INVALID: ${urlPath}`);
    if (entry.path.startsWith('apps/')) {
      for (const [name, expected] of Object.entries(MINIAPP_SECURITY_HEADERS)) {
        if (response.headers.get(name) !== expected) throw new Error(`ORIGIN_SECURITY_HEADER_INVALID: ${urlPath}`);
      }
    } else if (entry.path.startsWith('app/')) {
      const responseCsp = response.headers.get('content-security-policy') ?? '';
      if (
        response.headers.get('x-frame-options') !== 'DENY'
        && !/(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/u.test(responseCsp)
      ) throw new Error(`ORIGIN_LEGAL_FRAMING_UNPROTECTED: ${urlPath}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error(`ORIGIN_BODY_HASH_INVALID: ${urlPath}`);
    }
    if (entry.path.endsWith('.html')) assertPublicHtml(entry.path, bytes);
    if (entry.path.endsWith('.js')) assertPublicJavascript(entry.path, bytes);
    if (entry.path === '.well-known/apple-app-site-association') {
      const { appId } = readReleaseIdentity(projectRoot);
      if (!bytes.equals(Buffer.from(canonicalAasaBytes(appId), 'utf8'))) {
        throw new Error('ORIGIN_AASA_INVALID');
      }
    }
    urls.push({
      path: urlPath,
      status: 200,
      redirects: 0,
      contentType,
      sha256: entry.sha256,
      headerProfile: headerProfile(entry.path),
      cookieFree: true,
      canonical: true,
    });
  }

  const directoryResponse = await exactFetch(base, '/apps/');
  if (![403, 404].includes(directoryResponse.status)) throw new Error('ORIGIN_DIRECTORY_LISTING_EXPOSED');
  await directoryResponse.arrayBuffer();
  const htaccessResponse = await exactFetch(base, '/apps/.htaccess');
  if (![403, 404].includes(htaccessResponse.status)) throw new Error('ORIGIN_HTACCESS_EXPOSED');
  await htaccessResponse.arrayBuffer();
  const unknownSlug = createUnknownSlug();
  const unknownPath = `/apps/${unknownSlug}/`;
  const unknownResponse = await exactFetch(base, unknownPath);
  if (![404, 410].includes(unknownResponse.status)) throw new Error('ORIGIN_UNKNOWN_SLUG_NOT_MISSING');
  await unknownResponse.arrayBuffer();

  return {
    rootStatus: 200,
    unknownSlugStatus: unknownResponse.status,
    unknownSlugNonceSha256: sha256(Buffer.from(unknownSlug)),
    controls: { unrelatedAssetRetained: true, terminalRouteRetained: true },
    urls,
  };
}

export function validateProductionEvidence(evidence, artifact, authority) {
  validateArtifactAuthority(artifact, authority);
  assertExactKeys(evidence, [
    'schemaVersion',
    'artifactKind',
    'releaseId',
    'sourceCommit',
    'deployedAt',
    'origin',
    'serverInventory',
    'browser',
    'controls',
    'appleCdn',
    'rollback',
  ], 'PRODUCTION_EVIDENCE');
  if (
    evidence.schemaVersion !== 1
    || evidence.artifactKind !== 'cabohealth-production-verification'
    || typeof evidence.releaseId !== 'string'
    || !RELEASE_ID.test(evidence.releaseId)
    || evidence.releaseId !== artifact?.releaseId
    || artifact.inventorySha256 !== evidence.releaseId.slice('web-v1-'.length)
    || typeof evidence.sourceCommit !== 'string'
    || !COMMIT.test(evidence.sourceCommit)
    || !isCanonicalUtcTimestamp(evidence.deployedAt)
  ) throw new Error('PRODUCTION_EVIDENCE_RECONCILIATION_FAILED');

  assertExactKeys(evidence.origin, [
    'status',
    'checkedAt',
    'rootStatus',
    'unknownSlugStatus',
    'unknownSlugNonceSha256',
    'urls',
  ], 'PRODUCTION_ORIGIN');
  if (
    evidence.origin.status !== 'verified'
    || !isCanonicalUtcTimestamp(evidence.origin.checkedAt)
    || evidence.origin.rootStatus !== 200
    || ![404, 410].includes(evidence.origin.unknownSlugStatus)
    || typeof evidence.origin.unknownSlugNonceSha256 !== 'string'
    || !SHA256.test(evidence.origin.unknownSlugNonceSha256)
    || !Array.isArray(evidence.origin.urls)
  ) throw new Error('PRODUCTION_ORIGIN_INVALID');

  const expectedFiles = artifact?.files?.filter(({ path }) => path !== 'apps/.htaccess');
  if (!Array.isArray(expectedFiles) || evidence.origin.urls.length !== expectedFiles.length) {
    throw new Error('PRODUCTION_URL_SET_INVALID');
  }

  validateServerInventoryEvidence(evidence.serverInventory);
  validateBrowserEvidence(evidence.browser);
  assertExactKeys(evidence.controls, ['unrelatedAssetRetained', 'terminalRouteRetained'], 'PRODUCTION_CONTROLS');
  if (
    evidence.controls.unrelatedAssetRetained !== true
    || evidence.controls.terminalRouteRetained !== true
  ) throw new Error('PRODUCTION_CONTROLS_INVALID');
  for (const [index, expected] of expectedFiles.entries()) {
    const actual = evidence.origin.urls[index];
    assertExactKeys(actual, [
      'path',
      'status',
      'redirects',
      'contentType',
      'sha256',
      'headerProfile',
      'cookieFree',
      'canonical',
    ], 'PRODUCTION_URL');
    if (
      actual.path !== publicUrlPath(expected.path)
      || actual.status !== 200
      || actual.redirects !== 0
      || actual.contentType !== expected.mediaType
      || actual.sha256 !== expected.sha256
      || !SHA256.test(actual.sha256)
      || actual.headerProfile !== headerProfile(expected.path)
      || actual.cookieFree !== true
      || actual.canonical !== true
    ) throw new Error(`PRODUCTION_URL_INVALID: ${actual.path ?? index}`);
  }

  assertExactKeys(evidence.appleCdn, ['status', 'checkedAt', 'sha256'], 'APPLE_CDN');
  if (!isCanonicalUtcTimestamp(evidence.appleCdn.checkedAt)) throw new Error('APPLE_CDN_INVALID');
  const aasaHash = artifact.files.find(({ path }) => path === '.well-known/apple-app-site-association')?.sha256;
  if (
    !(
      evidence.appleCdn.status === 'pending-propagation'
      && evidence.appleCdn.sha256 === null
    )
    && !(
      evidence.appleCdn.status === 'verified'
      && typeof evidence.appleCdn.sha256 === 'string'
      && evidence.appleCdn.sha256 === aasaHash
    )
  ) throw new Error('APPLE_CDN_INVALID');

  assertExactKeys(evidence.rollback, ['version', 'stagedVerified', 'rehearsal'], 'ROLLBACK');
  if (
    typeof evidence.rollback.version !== 'string'
    || !ROLLBACK_ID.test(evidence.rollback.version)
    || evidence.rollback.stagedVerified !== true
    || evidence.rollback.rehearsal !== 'verified'
  ) throw new Error('ROLLBACK_EVIDENCE_INVALID');
  return true;
}

function parseCanonicalFile(path, label) {
  const raw = readFileSync(path, 'utf8');
  if (raw.startsWith('\ufeff')) throw new Error(`${label}_NONCANONICAL`);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}_JSON_INVALID`);
  }
  if (`${JSON.stringify(value)}\n` !== raw) throw new Error(`${label}_NONCANONICAL`);
  return value;
}

export async function verifyAppleCdn({
  artifact,
  reviewedReleaseId,
  reviewedArtifactSha256,
  url = 'https://app-site-association.cdn-apple.com/a/v1/cabohealth.org',
  productionConfirmation = null,
}) {
  validateArtifactAuthority(artifact, { reviewedReleaseId, reviewedArtifactSha256 });
  const parsed = new URL(url);
  const productionUrl = 'https://app-site-association.cdn-apple.com/a/v1/cabohealth.org';
  const local = parsed.protocol === 'http:'
    && ['127.0.0.1', '[::1]'].includes(parsed.hostname)
    && Boolean(parsed.port)
    && !parsed.username
    && !parsed.password
    && !parsed.search
    && !parsed.hash;
  if (!(local || (productionConfirmation === 'cabohealth.org' && parsed.href === productionUrl))) {
    throw new Error('APPLE_CDN_NETWORK_FORBIDDEN_WITHOUT_EXPLICIT_PRODUCTION_CONFIRMATION');
  }
  const response = await fetch(parsed.href, { redirect: 'manual', headers: { 'Accept-Encoding': 'identity' } });
  if (response.url !== parsed.href || response.status !== 200) throw new Error('APPLE_CDN_RESPONSE_INVALID');
  if (response.headers.has('set-cookie')) throw new Error('APPLE_CDN_SET_COOKIE_FORBIDDEN');
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (!['application/json', 'application/pkcs7-mime'].includes(contentType ?? '')) {
    throw new Error('APPLE_CDN_CONTENT_TYPE_INVALID');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = artifact?.files?.find(({ path }) => path === '.well-known/apple-app-site-association');
  if (!expected || bytes.byteLength !== expected.size || sha256(bytes) !== expected.sha256) {
    throw new Error('APPLE_CDN_PENDING_PROPAGATION');
  }
  const { appId } = readReleaseIdentity(projectRoot);
  if (!bytes.equals(Buffer.from(canonicalAasaBytes(appId), 'utf8'))) throw new Error('APPLE_CDN_AASA_INVALID');
  return { status: 'verified', sha256: expected.sha256 };
}

export function checkSanitizedProductionEvidence(root = projectRoot, authority = undefined) {
  const evidencePath = resolve(root, 'release/production-urls.json');
  if (!existsSync(evidencePath)) throw new Error('PRODUCTION_EVIDENCE_MISSING');
  const artifactPath = resolve(root, 'release/web-artifacts.json');
  if (!existsSync(artifactPath)) throw new Error('WEB_ARTIFACT_EVIDENCE_MISSING');
  const evidence = parseCanonicalFile(evidencePath, 'PRODUCTION_EVIDENCE');
  const artifact = parseCanonicalFile(artifactPath, 'WEB_ARTIFACT_EVIDENCE');
  validateProductionEvidence(evidence, artifact, authority);
  if (evidence.appleCdn.status !== 'verified') throw new Error('APPLE_CDN_PENDING_PROPAGATION');
  return true;
}

function optionValue(arguments_, name) {
  const prefix = `--${name}=`;
  const matches = arguments_.filter((argument) => argument.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`CLI_OPTION_INVALID: ${name}`);
  return matches[0].slice(prefix.length);
}

function assertArgumentSet(arguments_, expected) {
  if (
    arguments_.length !== expected.length
    || [...arguments_].sort().some((argument, index) => argument !== [...expected].sort()[index])
  ) throw new Error('CLI_ARGUMENT_SET_INVALID');
}

function reviewedAuthority(arguments_) {
  return {
    reviewedReleaseId: optionValue(arguments_, 'reviewed-release-id'),
    reviewedArtifactSha256: optionValue(arguments_, 'reviewed-artifact-sha256'),
  };
}

function parseCanonicalStdin(label) {
  const raw = readFileSync(0, 'utf8');
  if (raw.startsWith('\ufeff')) throw new Error(`${label}_NONCANONICAL`);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}_JSON_INVALID`);
  }
  if (canonicalJson(value) !== raw) throw new Error(`${label}_NONCANONICAL`);
  return value;
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === '--check') {
    if (arguments_.length > 1) assertArgumentSet(arguments_.slice(1), [
      `--reviewed-release-id=${optionValue(arguments_.slice(1), 'reviewed-release-id')}`,
      `--reviewed-artifact-sha256=${optionValue(arguments_.slice(1), 'reviewed-artifact-sha256')}`,
    ]);
    const authority = arguments_.length === 1 ? undefined : reviewedAuthority(arguments_.slice(1));
    checkSanitizedProductionEvidence(projectRoot, authority);
    console.log('Sanitized production evidence verified.');
    return;
  }
  if (
    arguments_[0] === '--verify-production-origin'
    && arguments_.includes('--confirm-production=cabohealth.org')
  ) {
    assertArgumentSet(arguments_.slice(1), [
      '--confirm-production=cabohealth.org',
      `--reviewed-release-id=${optionValue(arguments_.slice(1), 'reviewed-release-id')}`,
      `--reviewed-artifact-sha256=${optionValue(arguments_.slice(1), 'reviewed-artifact-sha256')}`,
    ]);
    const authority = reviewedAuthority(arguments_.slice(1));
    const artifact = parseCanonicalFile(resolve(projectRoot, 'release/web-artifacts.json'), 'WEB_ARTIFACT_EVIDENCE');
    const result = await verifyOrigin({
      artifact,
      ...authority,
      baseUrl: 'https://cabohealth.org',
      sensitiveControls: validateSensitiveControls(parseCanonicalStdin('SENSITIVE_CONTROLS')),
      productionConfirmation: 'cabohealth.org',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (
    arguments_[0] === '--verify-apple-cdn'
    && arguments_.includes('--confirm-production=cabohealth.org')
  ) {
    assertArgumentSet(arguments_.slice(1), [
      '--confirm-production=cabohealth.org',
      `--reviewed-release-id=${optionValue(arguments_.slice(1), 'reviewed-release-id')}`,
      `--reviewed-artifact-sha256=${optionValue(arguments_.slice(1), 'reviewed-artifact-sha256')}`,
    ]);
    const authority = reviewedAuthority(arguments_.slice(1));
    const artifact = parseCanonicalFile(resolve(projectRoot, 'release/web-artifacts.json'), 'WEB_ARTIFACT_EVIDENCE');
    const result = await verifyAppleCdn({ artifact, ...authority, productionConfirmation: 'cabohealth.org' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (arguments_.length === 1 && arguments_[0] === '--validate-browser-evidence') {
    validateBrowserEvidence(parseCanonicalStdin('BROWSER_EVIDENCE'));
    console.log('Browser evidence verified.');
    return;
  }
  throw new Error('Usage: node scripts/verify-production.mjs <--check|--verify-production-origin|--verify-apple-cdn|--validate-browser-evidence> [reviewed authority and explicit production confirmation]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
