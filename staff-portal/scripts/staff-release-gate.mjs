import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

export const STAFF_PRODUCTION_URL = 'https://cabohealth.org/staff/';
export const STAFF_PRODUCTION_PROMOTE_TARGET = 'public_html/staff';
export const STAFF_FUNCTIONS_REGION = 'us-central1';

const ARTIFACT_KEYS = Object.freeze([
  'appEnv',
  'artifactKind',
  'artifactSha256',
  'backendStaffWebAppId',
  'expectedProjectId',
  'expectedWebAppId',
  'files',
  'functionsRegion',
  'inventorySha256',
  'promoteTargets',
  'releaseId',
  'schemaVersion',
]);
const FILE_KEYS = Object.freeze(['deployMode', 'mediaType', 'path', 'sha256', 'size']);
const PROJECT_PATTERN = /^cabohealth-[a-z0-9](?:[a-z0-9-]{0,17}[a-z0-9])?$/u;
const WEB_APP_ID_PATTERN = /^1:[0-9]{6,20}:web:[0-9a-f]{8,64}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export function createStaffReleaseArtifact({ distDir, identity }) {
  const normalizedIdentity = normalizeIdentity(identity);
  if (normalizedIdentity.appEnv !== 'production') {
    throw new Error('staff_release_production_only');
  }
  assertBuildIdentity(distDir, normalizedIdentity);
  const files = Object.freeze(readDistInventory(distDir));
  assertRequiredFiles(files);
  const inventorySha256 = sha256(canonical(files));
  const releaseDigest = sha256(canonical({ identity: normalizedIdentity, inventorySha256 }));
  const core = Object.freeze({
    schemaVersion: 1,
    artifactKind: 'cabohealth-staff-portal-v1',
    releaseId: `staff-v1-${releaseDigest}`,
    inventorySha256,
    appEnv: normalizedIdentity.appEnv,
    expectedProjectId: normalizedIdentity.expectedProjectId,
    expectedWebAppId: normalizedIdentity.expectedWebAppId,
    backendStaffWebAppId: normalizedIdentity.backendStaffWebAppId,
    functionsRegion: normalizedIdentity.functionsRegion,
    promoteTargets: Object.freeze([STAFF_PRODUCTION_PROMOTE_TARGET]),
    files,
  });
  return Object.freeze({
    ...core,
    artifactSha256: sha256(canonical(core)),
  });
}

export function verifyStaffReleaseArtifact({
  artifact,
  distDir,
  expectedIdentity,
  expectedReleaseId,
  expectedInventorySha256,
  expectedArtifactSha256,
}) {
  assertPinnedValues(expectedReleaseId, expectedInventorySha256, expectedArtifactSha256);
  const expected = createStaffReleaseArtifact({ distDir, identity: expectedIdentity });
  if (expected.releaseId !== expectedReleaseId
    || expected.inventorySha256 !== expectedInventorySha256
    || expected.artifactSha256 !== expectedArtifactSha256
    || canonical(expected) !== canonical(artifact)) {
    throw new Error('staff_release_artifact_mismatch');
  }
  return expected;
}

export function expectedStaffSecurityHeaders(functionsOrigin) {
  if (!/^https:\/\/us-central1-cabohealth-[a-z0-9-]+\.cloudfunctions\.net$/u.test(functionsOrigin)) {
    throw new Error('staff_release_functions_origin_invalid');
  }
  return Object.freeze({
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; base-uri 'self'; connect-src 'self' https://content-firebaseappcheck.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ${functionsOrigin} https://www.google.com/recaptcha/; font-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src https://www.google.com/recaptcha/; img-src 'self' data:; manifest-src 'self'; object-src 'none'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; style-src 'self'; upgrade-insecure-requests`,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
}

export async function verifyLiveStaffRelease({
  artifact,
  baseUrl,
  fetchImpl = globalThis.fetch,
  expectedReleaseId,
  expectedInventorySha256,
  expectedArtifactSha256,
}) {
  assertPinnedValues(expectedReleaseId, expectedInventorySha256, expectedArtifactSha256);
  assertArtifactManifest(artifact);
  if (artifact.appEnv !== 'production'
    || baseUrl !== STAFF_PRODUCTION_URL
    || artifact.releaseId !== expectedReleaseId
    || artifact.inventorySha256 !== expectedInventorySha256
    || artifact.artifactSha256 !== expectedArtifactSha256) {
    throw new Error('staff_live_identity_mismatch');
  }
  const functionsOrigin = `https://${STAFF_FUNCTIONS_REGION}-${artifact.expectedProjectId}.cloudfunctions.net`;
  const securityHeaders = expectedStaffSecurityHeaders(functionsOrigin);
  const liveFiles = artifact.files.filter((file) => (
    file.path === 'index.html' || file.path.endsWith('.js') || file.path.endsWith('.css')
  ));
  for (const file of liveFiles) {
    const url = file.path === 'index.html' ? baseUrl : new URL(file.path, baseUrl).href;
    const response = await fetchImpl(url, { cache: 'no-store', redirect: 'manual' });
    await verifyLiveResponse(response, file, securityHeaders, 200);
  }

  const fallbackFile = artifact.files.find((file) => file.path === '404.html');
  if (!fallbackFile) throw new Error('staff_live_fallback_missing');
  const fallback = await fetchImpl(new URL('__staff_release_probe__', baseUrl).href, {
    cache: 'no-store',
    redirect: 'manual',
  });
  if (fallback.status !== 404) throw new Error('staff_live_fallback_open');
  await verifyLiveResponse(fallback, fallbackFile, securityHeaders, 404);
  return Object.freeze({
    releaseId: artifact.releaseId,
    inventorySha256: artifact.inventorySha256,
    artifactSha256: artifact.artifactSha256,
    verifiedUrl: baseUrl,
  });
}

async function verifyLiveResponse(response, file, expectedHeaders, expectedStatus) {
  if (!response || response.status !== expectedStatus || response.redirected === true) {
    throw new Error('staff_live_response_invalid');
  }
  for (const [name, value] of Object.entries(expectedHeaders)) {
    if (response.headers.get(name) !== value) throw new Error('staff_live_header_mismatch');
  }
  if (!hasExpectedContentType(response.headers.get('content-type'), file.mediaType)
    || response.headers.get('set-cookie') !== null) {
    throw new Error('staff_live_header_mismatch');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
    throw new Error('staff_live_bytes_mismatch');
  }
}

function hasExpectedContentType(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  return normalizeContentType(actual) === normalizeContentType(expected);
}

function normalizeContentType(value) {
  const match = /^([^;\s]+)\s*;\s*charset\s*=\s*([^;\s]+)$/iu.exec(value);
  if (!match) return value;
  return `${match[1].toLowerCase()}; charset=${match[2].toLowerCase()}`;
}

function assertArtifactManifest(artifact) {
  if (!isRecord(artifact)
    || !hasExactKeys(artifact, ARTIFACT_KEYS)
    || artifact.schemaVersion !== 1
    || artifact.artifactKind !== 'cabohealth-staff-portal-v1'
    || artifact.releaseId !== `staff-v1-${sha256(canonical({
      identity: normalizeIdentity(artifact),
      inventorySha256: artifact.inventorySha256,
    }))}`
    || !HASH_PATTERN.test(artifact.inventorySha256)
    || !Array.isArray(artifact.promoteTargets)
    || canonical(artifact.promoteTargets) !== canonical([STAFF_PRODUCTION_PROMOTE_TARGET])
    || !Array.isArray(artifact.files)) {
    throw new Error('staff_release_artifact_invalid');
  }
  let previousPath = '';
  for (const file of artifact.files) {
    if (!isRecord(file)
      || !hasExactKeys(file, FILE_KEYS)
      || !isSafeRelativePath(file.path)
      || !isAllowedReleasePath(file.path)
      || file.path <= previousPath
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !HASH_PATTERN.test(file.sha256)
      || file.deployMode !== '0644'
      || file.mediaType !== mediaTypeFor(file.path)) {
      throw new Error('staff_release_artifact_invalid');
    }
    previousPath = file.path;
  }
  if (artifact.inventorySha256 !== sha256(canonical(artifact.files))) {
    throw new Error('staff_release_artifact_invalid');
  }
  const { artifactSha256, ...core } = artifact;
  if (!HASH_PATTERN.test(artifactSha256) || artifactSha256 !== sha256(canonical(core))) {
    throw new Error('staff_release_artifact_invalid');
  }
  assertRequiredFiles(artifact.files);
}

function assertPinnedValues(releaseId, inventorySha256, artifactSha256) {
  if (typeof releaseId !== 'string'
    || !/^staff-v1-[a-f0-9]{64}$/u.test(releaseId)
    || typeof inventorySha256 !== 'string'
    || !HASH_PATTERN.test(inventorySha256)
    || typeof artifactSha256 !== 'string'
    || !HASH_PATTERN.test(artifactSha256)) {
    throw new Error('staff_release_pins_required');
  }
}

function normalizeIdentity(identity) {
  if (!isRecord(identity)) throw new Error('staff_release_identity_invalid');
  const value = {
    appEnv: typeof identity.appEnv === 'string' ? identity.appEnv.trim() : '',
    expectedProjectId: typeof identity.expectedProjectId === 'string' ? identity.expectedProjectId.trim() : '',
    expectedWebAppId: typeof identity.expectedWebAppId === 'string' ? identity.expectedWebAppId.trim() : '',
    backendStaffWebAppId: typeof identity.backendStaffWebAppId === 'string' ? identity.backendStaffWebAppId.trim() : '',
    functionsRegion: typeof identity.functionsRegion === 'string' ? identity.functionsRegion.trim() : '',
  };
  if ((value.appEnv !== 'production' && value.appEnv !== 'staging')
    || !PROJECT_PATTERN.test(value.expectedProjectId)
    || !value.expectedProjectId.endsWith(value.appEnv === 'production' ? '-prod' : '-staging')
    || !WEB_APP_ID_PATTERN.test(value.expectedWebAppId)
    || value.backendStaffWebAppId !== value.expectedWebAppId
    || value.functionsRegion !== STAFF_FUNCTIONS_REGION) {
    throw new Error('staff_release_identity_invalid');
  }
  return Object.freeze(value);
}

function readDistInventory(distDir) {
  const root = resolve(distDir);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('staff_release_dist_invalid');
  }
  const paths = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('staff_release_symlink_rejected');
      if (stat.isDirectory()) {
        walk(absolute);
      } else if (stat.isFile()) {
        const relativePath = relative(root, absolute).split(sep).join('/');
        if (!isSafeRelativePath(relativePath)) throw new Error('staff_release_path_invalid');
        paths.push(relativePath);
      } else {
        throw new Error('staff_release_special_file_rejected');
      }
    }
  };
  walk(root);
  paths.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (paths.some((path) => !isAllowedReleasePath(path))) {
    throw new Error('staff_release_unexpected_file');
  }
  return paths.map((path) => {
    const bytes = readFileSync(join(root, ...path.split('/')));
    return Object.freeze({
      path,
      size: bytes.length,
      sha256: sha256(bytes),
      mediaType: mediaTypeFor(path),
      deployMode: '0644',
    });
  });
}

function assertRequiredFiles(files) {
  const paths = new Set(files.map((file) => file.path));
  for (const required of ['.htaccess', '_headers', '404.html', 'index.html', 'staff-build-identity.json']) {
    if (!paths.has(required)) throw new Error('staff_release_required_file_missing');
  }
  if (!files.some((file) => file.path.endsWith('.js'))
    || !files.some((file) => file.path.endsWith('.css'))
    || files.some((file) => file.path.endsWith('.map'))) {
    throw new Error('staff_release_inventory_invalid');
  }
}

function assertBuildIdentity(distDir, identity) {
  const path = resolve(distDir, 'staff-build-identity.json');
  let actual;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('closed');
    actual = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('staff_release_build_identity_mismatch');
  }
  const expected = {
    schemaVersion: 1,
    ...identity,
    functionsOrigin: `https://${STAFF_FUNCTIONS_REGION}-${identity.expectedProjectId}.cloudfunctions.net`,
  };
  if (!isRecord(actual)
    || !hasExactKeys(actual, Object.keys(expected))
    || canonical(actual) !== canonical(expected)) {
    throw new Error('staff_release_build_identity_mismatch');
  }
}

function mediaTypeFor(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path === '.htaccess' || path === '_headers') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function isSafeRelativePath(path) {
  return typeof path === 'string'
    && path !== ''
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.includes('\0')
    && posix.normalize(path) === path
    && !path.split('/').includes('..');
}

function isAllowedReleasePath(path) {
  return path === '.htaccess'
    || path === '_headers'
    || path === '404.html'
    || path === 'favicon.svg'
    || path === 'index.html'
    || path === 'staff-build-identity.json'
    || /^assets\/[A-Za-z0-9_-]+\.(?:css|js)$/u.test(path);
}

function canonical(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
