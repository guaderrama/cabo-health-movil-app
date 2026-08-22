import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MINIAPP_APACHE_SECURITY_CONFIG,
  readVerifiedMiniappArtifact,
} from './build-miniapps.mjs';
import { canonicalAasaBytes } from './generate-aasa.mjs';
import { assertStaticWebPolicy } from './web-release-policy.mjs';
import { verifyCapturedReleaseV3 } from './verify-release-v3.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_ID = 'DQ8PH2DZ3R.com.cabohealth.app';
const helperPath = resolve(projectRoot, 'scripts/secure_web_release.py');
const helperSource = readFileSync(helperPath, 'utf8');
const CAPSULE_SHA256 = '2c839893cca416fdd471fef037bdfb8fc099960d9855e9d7b47981b13892602b';
const CAPSULE_SIZE = 719595;
export const REVIEWED_MINIAPP_FILE_PINS = Object.freeze([
  Object.freeze({ path: 'apps/.htaccess', size: 568, sha256: '0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da' }),
  Object.freeze({ path: 'apps/clinic-guide/app.js', size: 3868, sha256: 'f9b6b5284574ff3dfd3856a30b59b9d6ffe546550bce6f7595cd82eaa6e8ddd7' }),
  Object.freeze({ path: 'apps/clinic-guide/index.html', size: 28285, sha256: '0a18f4f307e2c58189cf9471b71accd779adbfa0415142ac5be584a9a4ff2c8e' }),
  Object.freeze({ path: 'apps/healthy-recipes/app.js', size: 4049, sha256: '70a2537bcf2b858eef98535cc48e691fbd081bd3e180347207aecfc04550e090' }),
  Object.freeze({ path: 'apps/healthy-recipes/index.html', size: 57591, sha256: 'd756583df4e13221bb24dd8bf44d5712b5c1bc6a409af2f6c33d6051f630114b' }),
  Object.freeze({ path: 'apps/shared/clinic-map-texture.png', size: 382740, sha256: '4b569f0da0cffb9a54dedd93ce672cf7592ae4516dd12663e3b34d731df237c4' }),
  Object.freeze({ path: 'apps/shared/logo-wordmark.png', size: 12584, sha256: '42012a5550f332e531c8d6ea7a99bb06b9c0bd9f0c0c6a45249106dc940f592d' }),
  Object.freeze({ path: 'apps/shared/logo.png', size: 13598, sha256: 'e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117' }),
  Object.freeze({ path: 'apps/shared/motion.js', size: 9370, sha256: 'f6a613929e08e49ee4dea7513f00fdc9fd5e7b1c791ffa512cca1f26a4863d24' }),
  Object.freeze({ path: 'apps/shared/shell.js', size: 5506, sha256: 'edbb90593477cb68de24df0115854d9aeb243c94ff219b211944b2fa3cf93ea9' }),
  Object.freeze({ path: 'apps/shared/styles.css', size: 18319, sha256: 'e98ad07424d4210208542468b25e1841aa3ade7dc505aee2aebd37064c466523' }),
]);
const LEGAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const LEGAL_SOURCES = Object.freeze([
  Object.freeze({ slug: 'privacy', source: 'web-hosting/cabohealth.org/app/privacy/index.html', output: 'app/privacy/index.html' }),
  Object.freeze({ slug: 'report-content', source: 'web-hosting/cabohealth.org/app/report-content/index.html', output: 'app/report-content/index.html' }),
  Object.freeze({ slug: 'support', source: 'web-hosting/cabohealth.org/app/support/index.html', output: 'app/support/index.html' }),
  Object.freeze({ slug: 'terms', source: 'web-hosting/cabohealth.org/app/terms/index.html', output: 'app/terms/index.html' }),
]);
const INPUT_PATHS = Object.freeze([
  'miniapps/shared/security-headers.conf',
  'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
  'web-hosting/cabohealth.org/app/privacy/index.html',
  'web-hosting/cabohealth.org/app/report-content/index.html',
  'web-hosting/cabohealth.org/app/support/index.html',
  'web-hosting/cabohealth.org/app/terms/index.html',
  'web-hosting/cabohealth.org/apps/.htaccess',
]);
const DRAFT_LEGAL_SHA256 = Object.freeze({
  privacy: '48a9d5974d234434c200ff272c6dfeecc2d6b05baeae30dc25a37df06fb46b91',
  'report-content': '35d304f3ee82364616ab9b0f96013319857d4acc347b6764579a7604392bffb5',
  support: '4580d6de3db45af3830428497715d903cad557c143a5312d95b6c73f7f575a1a',
  terms: '0dfc0b40144db111e78e2a2e6a1de1c0e978c9a31bb9dceb819599d7b5e70d44',
});

// Pinned after owner-authorized fact reconciliation and independent byte review.
// Any later legal-copy edit must fail closed until a new review updates both authorities.
export const FINAL_LEGAL_SHA256 = Object.freeze({
  privacy: 'dd1caa532ca16a610a54c360ef4c911e6927043d2cfe2ba133808b17cf49ea86',
  'report-content': '0c54770920813168eba4480ded96a396c2858dfbedc73590082ee55185dd4dde',
  support: 'e1fd847e6f8495f7dd4391989046845d5fa7c4bd3a8900ed3295ef956d9a875c',
  terms: '2de6286af27e9f4547c58b1204f29bada4ceb7ff7b9597fbb5894279baee06d8',
});
// Set only after the final legal/AASA/Firebase/Hostinger staging evidence receives
// a separate byte review. A null pin makes every materialization path fail closed.
export const WEB_DEPLOYMENT_READINESS_SHA256 = null;
export const WEB_RELEASE_PATHS = Object.freeze([
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
  'apps/shared/clinic-map-texture.png',
  'apps/shared/logo-wordmark.png',
  'apps/shared/logo.png',
  'apps/shared/motion.js',
  'apps/shared/shell.js',
  'apps/shared/styles.css',
]);
const MINIAPP_PATHS = Object.freeze(WEB_RELEASE_PATHS.filter((path) => path.startsWith('apps/')));
export const WEB_PROMOTE_TARGETS = Object.freeze([
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function assertWebDeploymentReadiness(complianceBuffers) {
  if (typeof WEB_DEPLOYMENT_READINESS_SHA256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(WEB_DEPLOYMENT_READINESS_SHA256)) {
    throw new Error('WEB_DEPLOYMENT_GATES_INCOMPLETE');
  }
  const bytes = complianceBuffers.get('release/web-deployment-readiness.json');
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== WEB_DEPLOYMENT_READINESS_SHA256) {
    throw new Error('WEB_DEPLOYMENT_GATES_INCOMPLETE');
  }
  let readiness;
  try {
    readiness = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('WEB_DEPLOYMENT_GATES_INCOMPLETE');
  }
  assertExactKeys(readiness, ['schemaVersion', 'artifactKind', 'status'], 'WEB_DEPLOYMENT_READINESS');
  if (readiness.schemaVersion !== 1
    || readiness.artifactKind !== 'cabohealth-web-deployment-readiness-v1'
    || readiness.status !== 'ready') {
    throw new Error('WEB_DEPLOYMENT_GATES_INCOMPLETE');
  }
}

function mediaTypeFor(path) {
  if (path.endsWith('apple-app-site-association')) return 'application/json';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'text/plain; charset=utf-8';
}

function kindFor(path) {
  if (path === 'apps/.htaccess') return 'apache-security';
  if (path.startsWith('apps/')) return 'task6b-miniapp';
  if (path.startsWith('app/')) return 'task7-legal';
  return 'aasa';
}

export function createWebReleaseTransport(capturedFiles) {
  if (!(capturedFiles instanceof Map)) throw new Error('WEB_RELEASE_FILE_SET_INVALID');
  const actualPaths = [...capturedFiles.keys()];
  if (
    actualPaths.length !== WEB_RELEASE_PATHS.length
    || actualPaths.some((path, index) => path !== WEB_RELEASE_PATHS[index])
  ) {
    throw new Error('WEB_RELEASE_FILE_SET_INVALID');
  }

  const files = WEB_RELEASE_PATHS.map((path) => {
    const bytes = capturedFiles.get(path);
    if (!Buffer.isBuffer(bytes)) throw new Error(`WEB_RELEASE_BUFFER_INVALID: ${path}`);
    return {
      path,
      size: bytes.byteLength,
      sha256: sha256(bytes),
      mediaType: mediaTypeFor(path),
      deployMode: '0644',
      kind: kindFor(path),
      bytesBase64: Buffer.from(bytes).toString('base64'),
    };
  });
  const policy = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    appId: APP_ID,
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [...WEB_PROMOTE_TARGETS],
    files: files.map(({ bytesBase64: _bytesBase64, ...entry }) => entry),
  };
  const inventorySha256 = sha256(Buffer.from(canonicalJson(policy), 'utf8'));
  return {
    ...policy,
    artifactKind: 'cabohealth-web-transport-v1',
    releaseId: `web-v1-${inventorySha256}`,
    inventorySha256,
    files,
  };
}

function assertExactKeys(value, keys, label) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))
  ) throw new Error(`${label}_SCHEMA_INVALID`);
}

function decodeCapturedFile(entry, label, expectedPath) {
  assertExactKeys(entry, ['path', 'size', 'sha256', 'bytesBase64'], label);
  const bytes = Buffer.from(entry.bytesBase64, 'base64');
  if (
    entry.path !== expectedPath
    || !Number.isSafeInteger(entry.size)
    || entry.size < 0
    || !/^[a-f0-9]{64}$/u.test(entry.sha256)
    || bytes.byteLength !== entry.size
    || sha256(bytes) !== entry.sha256
    || bytes.toString('base64') !== entry.bytesBase64
  ) throw new Error(`${label}_INVALID: ${entry.path ?? expectedPath}`);
  return bytes;
}

export function captureBoundAssemblySnapshot(root, testFault = undefined) {
  const lexicalRoot = resolve(root);
  const environment = { ...process.env };
  if (testFault !== undefined) environment.CABOHEALTH_TEST_FAULT = testFault;
  const result = spawnSync(
    'python3',
    ['-c', helperSource, 'capture-assembly-snapshot', lexicalRoot],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: environment,
    },
  );
  if (result.status !== 0) throw new Error(`WEB_BOUND_SNAPSHOT_FAILED: ${result.stderr.trim()}`);
  let snapshot;
  try {
    snapshot = JSON.parse(result.stdout);
  } catch {
    throw new Error('WEB_BOUND_SNAPSHOT_SCHEMA_INVALID');
  }
  if (`${JSON.stringify(snapshot)}\n` !== result.stdout) throw new Error('WEB_BOUND_SNAPSHOT_NONCANONICAL');
  assertExactKeys(
    snapshot,
    ['schemaVersion', 'artifactKind', 'rootIdentity', 'complianceFiles', 'reviewedInputs', 'capsule', 'snapshotSha256'],
    'WEB_BOUND_SNAPSHOT',
  );
  assertExactKeys(snapshot.rootIdentity, ['device', 'inode'], 'WEB_BOUND_SNAPSHOT_ROOT');
  if (
    snapshot.schemaVersion !== 1
    || snapshot.artifactKind !== 'cabohealth-bound-assembly-snapshot-v1'
    || !Number.isSafeInteger(snapshot.rootIdentity.device)
    || snapshot.rootIdentity.device < 0
    || !Number.isSafeInteger(snapshot.rootIdentity.inode)
    || snapshot.rootIdentity.inode <= 0
    || !Array.isArray(snapshot.complianceFiles)
    || !Array.isArray(snapshot.reviewedInputs)
    || snapshot.reviewedInputs.length !== INPUT_PATHS.length
    || !/^[a-f0-9]{64}$/u.test(snapshot.snapshotSha256)
  ) throw new Error('WEB_BOUND_SNAPSHOT_SCHEMA_INVALID');
  const unsigned = { ...snapshot };
  delete unsigned.snapshotSha256;
  if (sha256(Buffer.from(canonicalJson(unsigned))) !== snapshot.snapshotSha256) {
    throw new Error('WEB_BOUND_SNAPSHOT_DIGEST_INVALID');
  }
  const compliancePaths = snapshot.complianceFiles.map(({ path }) => path);
  if (
    compliancePaths.some((path, index) => typeof path !== 'string' || (index > 0 && path <= compliancePaths[index - 1]))
  ) throw new Error('WEB_BOUND_SNAPSHOT_COMPLIANCE_SET_INVALID');
  for (const entry of snapshot.complianceFiles) {
    decodeCapturedFile(entry, 'WEB_BOUND_SNAPSHOT_COMPLIANCE_FILE', entry.path);
  }
  for (const [index, entry] of snapshot.reviewedInputs.entries()) {
    decodeCapturedFile(entry, 'WEB_BOUND_SNAPSHOT_REVIEWED_INPUT', INPUT_PATHS[index]);
  }
  assertExactKeys(snapshot.capsule, ['path', 'size', 'sha256', 'bytesBase64', 'mode', 'nlink'], 'WEB_BOUND_SNAPSHOT_CAPSULE');
  const capsuleBytes = decodeCapturedFile(
    {
      path: snapshot.capsule.path,
      size: snapshot.capsule.size,
      sha256: snapshot.capsule.sha256,
      bytesBase64: snapshot.capsule.bytesBase64,
    },
    'WEB_BOUND_SNAPSHOT_CAPSULE',
    'miniapps/dist',
  );
  if (
    snapshot.capsule.mode !== '0400'
    || snapshot.capsule.nlink !== 2
    || snapshot.capsule.size !== CAPSULE_SIZE
    || snapshot.capsule.sha256 !== CAPSULE_SHA256
  ) throw new Error('TASK6B_CAPSULE_ATTESTATION_FAILED');
  return Object.freeze({
    ...snapshot,
    rootPath: lexicalRoot,
    rootIdentityString: `${snapshot.rootIdentity.device}:${snapshot.rootIdentity.inode}`,
    complianceBuffers: new Map(snapshot.complianceFiles.map((entry) => [entry.path, decodeCapturedFile(entry, 'WEB_BOUND_SNAPSHOT_COMPLIANCE_FILE', entry.path)])),
    reviewedInputBuffers: new Map(snapshot.reviewedInputs.map((entry, index) => [INPUT_PATHS[index], decodeCapturedFile(entry, 'WEB_BOUND_SNAPSHOT_REVIEWED_INPUT', INPUT_PATHS[index])])),
    capsuleBytes,
  });
}

export function assertFinalLegalPins(reviewedLegalSha256) {
  assertExactKeys(reviewedLegalSha256, ['privacy', 'report-content', 'support', 'terms'], 'FINAL_LEGAL_PINS');
  for (const [slug, hash] of Object.entries(reviewedLegalSha256)) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash)) {
      throw new Error('FINAL_LEGAL_PINS_PENDING');
    }
    if (hash === DRAFT_LEGAL_SHA256[slug]) throw new Error(`DRAFT_LEGAL_PIN_FORBIDDEN: ${slug}`);
  }
  return true;
}

export function captureReviewedCapsule(root, artifactReader = readVerifiedMiniappArtifact) {
  const capsulePath = resolve(root, 'miniapps/dist');
  const beforePathStats = lstatSync(capsulePath);
  if (
    !beforePathStats.isFile()
    || beforePathStats.isSymbolicLink()
    || (beforePathStats.mode & 0o777) !== 0o400
    || beforePathStats.size !== CAPSULE_SIZE
    || beforePathStats.nlink !== 2
  ) throw new Error('TASK6B_CAPSULE_ATTESTATION_FAILED');
  const fd = openSync(capsulePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let bytes;
  let fdStats;
  try {
    fdStats = fstatSync(fd);
    bytes = readFileSync(fd);
    const afterReadStats = fstatSync(fd);
    if (
      fdStats.dev !== afterReadStats.dev
      || fdStats.ino !== afterReadStats.ino
      || fdStats.size !== afterReadStats.size
    ) throw new Error('TASK6B_CAPSULE_CHANGED_DURING_CAPTURE');
  } finally {
    closeSync(fd);
  }
  if (bytes.byteLength !== CAPSULE_SIZE || sha256(bytes) !== CAPSULE_SHA256) {
    throw new Error('TASK6B_CAPSULE_ATTESTATION_FAILED');
  }
  const artifact = artifactReader({
    projectRoot: root,
    outputRoot: capsulePath,
    expectedEntrySlugs: ['healthy-recipes', 'clinic-guide'],
  });
  const afterPathStats = lstatSync(capsulePath);
  if (
    afterPathStats.dev !== fdStats.dev
    || afterPathStats.ino !== fdStats.ino
    || afterPathStats.size !== fdStats.size
    || (afterPathStats.mode & 0o777) !== 0o400
    || afterPathStats.nlink !== 2
  ) throw new Error('TASK6B_CAPSULE_CHANGED_DURING_CAPTURE');
  if (
    artifact.manifest.releaseReady !== true
    || artifact.manifest.mode !== 'release'
    || JSON.stringify(artifact.manifest.entrySlugs) !== JSON.stringify(['healthy-recipes', 'clinic-guide'])
    || JSON.stringify([...artifact.files.keys()]) !== JSON.stringify(MINIAPP_PATHS)
  ) throw new Error('TASK6B_CAPSULE_PAYLOAD_INVALID');
  for (const pin of REVIEWED_MINIAPP_FILE_PINS) {
    const captured = artifact.files.get(pin.path);
    if (!Buffer.isBuffer(captured) || captured.byteLength !== pin.size || sha256(captured) !== pin.sha256) {
      throw new Error(`TASK6B_CAPTURED_BUFFER_PIN_MISMATCH: ${pin.path}`);
    }
  }
  return {
    bytes,
    files: new Map([...artifact.files].map(([path, contents]) => [path, Buffer.from(contents)])),
  };
}

function capturedCapsulePayload(snapshot, artifactReader = readVerifiedMiniappArtifact) {
  let capsule;
  try {
    capsule = JSON.parse(snapshot.capsuleBytes.toString('utf8'));
  } catch {
    throw new Error('TASK6B_CAPSULE_PAYLOAD_INVALID');
  }
  assertExactKeys(capsule, ['schemaVersion', 'kind', 'manifest', 'files'], 'TASK6B_CAPSULE');
  if (
    capsule.schemaVersion !== 1
    || capsule.kind !== 'cabohealth-miniapps-task-6b-release-capsule-v1'
    || !capsule.manifest
    || capsule.manifest.releaseReady !== true
    || capsule.manifest.mode !== 'release'
    || JSON.stringify(capsule.manifest.entrySlugs) !== JSON.stringify(['healthy-recipes', 'clinic-guide'])
    || !Array.isArray(capsule.files)
    || capsule.files.length !== REVIEWED_MINIAPP_FILE_PINS.length
  ) throw new Error('TASK6B_CAPSULE_PAYLOAD_INVALID');
  const files = new Map();
  for (const [index, entry] of capsule.files.entries()) {
    const pin = REVIEWED_MINIAPP_FILE_PINS[index];
    const bytes = decodeCapturedFile(entry, 'TASK6B_CAPSULE_FILE', pin.path);
    if (entry.size !== pin.size || entry.sha256 !== pin.sha256) {
      throw new Error(`TASK6B_CAPTURED_BUFFER_PIN_MISMATCH: ${pin.path}`);
    }
    files.set(pin.path, bytes);
  }
  if (JSON.stringify([...files.keys()]) !== JSON.stringify(MINIAPP_PATHS)) {
    throw new Error('TASK6B_CAPSULE_PAYLOAD_INVALID');
  }
  const verifiedCapture = captureReviewedCapsule(snapshot.rootPath, artifactReader);
  if (!verifiedCapture.bytes.equals(snapshot.capsuleBytes)) {
    throw new Error('TASK6B_CAPSULE_CHANGED_DURING_CAPTURE');
  }
  for (const path of MINIAPP_PATHS) {
    if (!verifiedCapture.files.get(path)?.equals(files.get(path))) {
      throw new Error(`TASK6B_CAPTURED_BUFFER_PIN_MISMATCH: ${path}`);
    }
  }
  return { bytes: snapshot.capsuleBytes, files: verifiedCapture.files };
}

function tags(text, name) {
  return text.match(new RegExp(`<${name}\\b[^>]*>`, 'giu')) ?? [];
}

function attribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function assertFinalLegalHtml(slug, bytes) {
  assertStaticWebPolicy(`app/${slug}/index.html`, bytes);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`LEGAL_UTF8_INVALID: ${slug}`);
  const canonicals = tags(text, 'link').filter((tag) => attribute(tag, 'rel')?.toLowerCase() === 'canonical');
  if (
    canonicals.length !== 1
    || attribute(canonicals[0], 'href') !== `https://cabohealth.org/app/${slug}/`
  ) throw new Error(`LEGAL_CANONICAL_INVALID: ${slug}`);
  const policies = tags(text, 'meta').filter((tag) => attribute(tag, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (policies.length !== 1 || attribute(policies[0], 'content') !== LEGAL_CSP) {
    throw new Error(`LEGAL_CSP_INVALID: ${slug}`);
  }
  for (const legalSlug of ['privacy', 'terms', 'support', 'report-content']) {
    if (!text.includes(`https://cabohealth.org/app/${legalSlug}/`)) {
      throw new Error(`LEGAL_NAVIGATION_INVALID: ${slug}`);
    }
  }
  if (
    /\b(?:draft|pending|borrador|pendiente)\b/iu.test(text)
    || /<(?:form|input|textarea|script|iframe|object|embed)\b/iu.test(text)
    || /\btarget\s*=\s*["']?_blank/iu.test(text)
    || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/iu.test(text)
    || /<link\b(?=[^>]*\brel\s*=\s*["']?(?:stylesheet|preload|prefetch|modulepreload))[^>]*\bhref\s*=\s*["']?https?:/iu.test(text)
    || /@import\s+["']?https?:|url\(\s*["']?https?:|http:\/\//iu.test(text)
  ) throw new Error(`LEGAL_PRODUCTION_CONTENT_INVALID: ${slug}`);
}

export function createWebArtifactManifest(transport, inputs) {
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    releaseId: transport.releaseId,
    inventorySha256: transport.inventorySha256,
    appId: transport.appId,
    entrySlugs: [...transport.entrySlugs],
    legalSlugs: [...transport.legalSlugs],
    promoteTargets: [...transport.promoteTargets],
    inputs,
    files: transport.files.map(({ bytesBase64: _bytesBase64, ...entry }) => entry),
  };
}

export function planWebRelease(snapshot, reviewedLegalSha256 = FINAL_LEGAL_SHA256) {
  if (!snapshot || !(snapshot.reviewedInputBuffers instanceof Map) || !Buffer.isBuffer(snapshot.capsuleBytes)) {
    throw new Error('WEB_BOUND_SNAPSHOT_SCHEMA_INVALID');
  }
  assertFinalLegalPins(reviewedLegalSha256);
  const capsule = capturedCapsulePayload(snapshot);
  const capturedInputs = snapshot.reviewedInputBuffers;

  const aasaPath = 'web-hosting/cabohealth.org/.well-known/apple-app-site-association';
  const aasaBytes = capturedInputs.get(aasaPath);
  if (!aasaBytes?.equals(Buffer.from(canonicalAasaBytes(APP_ID), 'utf8'))) {
    throw new Error('WEB_RELEASE_AASA_INVALID');
  }
  const apacheBytes = Buffer.from(MINIAPP_APACHE_SECURITY_CONFIG, 'utf8');
  for (const candidate of [
    capsule.files.get('apps/.htaccess'),
    capturedInputs.get('miniapps/shared/security-headers.conf'),
    capturedInputs.get('web-hosting/cabohealth.org/apps/.htaccess'),
  ]) {
    if (!candidate?.equals(apacheBytes)) throw new Error('WEB_RELEASE_APACHE_SECURITY_MISMATCH');
  }

  const outputBuffers = new Map();
  outputBuffers.set('.well-known/apple-app-site-association', Buffer.from(aasaBytes));
  for (const legal of LEGAL_SOURCES) {
    const bytes = capturedInputs.get(legal.source);
    if (!bytes || sha256(bytes) !== reviewedLegalSha256[legal.slug]) {
      throw new Error(`FINAL_LEGAL_PIN_MISMATCH: ${legal.slug}`);
    }
    assertFinalLegalHtml(legal.slug, bytes);
    outputBuffers.set(legal.output, Buffer.from(bytes));
  }
  for (const path of MINIAPP_PATHS) outputBuffers.set(path, Buffer.from(capsule.files.get(path)));
  if (JSON.stringify([...outputBuffers.keys()]) !== JSON.stringify(WEB_RELEASE_PATHS)) {
    throw new Error('WEB_RELEASE_FILE_SET_INVALID');
  }

  const transport = createWebReleaseTransport(outputBuffers);
  const inputFor = (path, kind, bytes) => ({
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    kind,
  });
  const legalBySlug = new Map(LEGAL_SOURCES.map((item) => [item.slug, item]));
  const inputs = [
    inputFor('miniapps/dist', 'task6b-miniapp', capsule.bytes),
    ...['privacy', 'terms', 'support', 'report-content'].map((slug) => {
      const legal = legalBySlug.get(slug);
      return inputFor(legal.source, 'task7-legal', capturedInputs.get(legal.source));
    }),
    inputFor(aasaPath, 'aasa', aasaBytes),
    inputFor('miniapps/shared/security-headers.conf', 'apache-security', capturedInputs.get('miniapps/shared/security-headers.conf')),
    inputFor('web-hosting/cabohealth.org/apps/.htaccess', 'apache-security', capturedInputs.get('web-hosting/cabohealth.org/apps/.htaccess')),
  ];
  const manifest = createWebArtifactManifest(transport, inputs);
  return Object.freeze({ manifest, transport });
}

function runMutationHelper(arguments_, root, input, rootIdentity) {
  const result = spawnSync('python3', ['-c', helperSource, ...arguments_], {
    cwd: root,
    encoding: 'utf8',
    input,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CABOHEALTH_EXPECTED_ROOT_ID: rootIdentity },
  });
  if (result.status !== 0) {
    throw new Error(`WEB_RELEASE_DESCRIPTOR_HELPER_FAILED: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function assembleWebRelease({ root = projectRoot, mode = 'check' } = {}) {
  if (!['check', 'assemble'].includes(mode)) throw new Error('WEB_RELEASE_MODE_INVALID');
  const snapshot = captureBoundAssemblySnapshot(root);
  const complianceErrors = verifyCapturedReleaseV3(snapshot.complianceBuffers);
  if (complianceErrors.length > 0) throw new Error('COMPLIANCE_FACTS_INCOMPLETE');
  const plan = planWebRelease(snapshot, FINAL_LEGAL_SHA256);
  if (mode === 'check') return plan;
  assertWebDeploymentReadiness(snapshot.complianceBuffers);
  runMutationHelper(
    ['materialize-release', root],
    root,
    canonicalJson({ transport: plan.transport, manifest: plan.manifest }),
    snapshot.rootIdentityString,
  );
  return plan;
}

export function checkWebRelease(root = projectRoot) {
  return assembleWebRelease({ root, mode: 'check' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !['--check', '--assemble'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/assemble-web-release.mjs <--check|--assemble>');
    }
    const plan = assembleWebRelease({ mode: process.argv[2] === '--check' ? 'check' : 'assemble' });
    console.log(`${process.argv[2] === '--check' ? 'Checked' : 'Assembled'} ${plan.manifest.releaseId}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
