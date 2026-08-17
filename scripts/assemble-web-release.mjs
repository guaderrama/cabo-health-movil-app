import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MINIAPP_APACHE_SECURITY_CONFIG,
  readVerifiedMiniappArtifact,
} from './build-miniapps.mjs';
import { canonicalAasaBytes, readReleaseIdentity } from './generate-aasa.mjs';
import { assertStaticWebPolicy } from './web-release-policy.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_ID = 'DQ8PH2DZ3R.com.cabohealth.app';
const helperPath = resolve(projectRoot, 'scripts/secure_web_release.py');
const CAPSULE_SHA256 = 'b5f4f2a39a46df12f12c017e6ef31fbff0aeb71045b3af5a7456be852fea9334';
const CAPSULE_SIZE = 161867;
export const REVIEWED_MINIAPP_FILE_PINS = Object.freeze([
  Object.freeze({ path: 'apps/.htaccess', size: 568, sha256: '0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da' }),
  Object.freeze({ path: 'apps/clinic-guide/app.js', size: 1436, sha256: '1565868ae2bc74769e5d036bc697a4e1d81f91740345ba67edf0628af5813243' }),
  Object.freeze({ path: 'apps/clinic-guide/index.html', size: 20481, sha256: 'a0246074ba7734df7e28354a6ecfff39ac08d7ddd1da4e295f66f11ec77a18ee' }),
  Object.freeze({ path: 'apps/healthy-recipes/app.js', size: 4049, sha256: '70a2537bcf2b858eef98535cc48e691fbd081bd3e180347207aecfc04550e090' }),
  Object.freeze({ path: 'apps/healthy-recipes/index.html', size: 55957, sha256: '5f22027afcd1600fa36cd77974d48b6d2ddc4fe26e27fcf57f206a8520413829' }),
  Object.freeze({ path: 'apps/shared/logo.png', size: 13598, sha256: 'e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117' }),
  Object.freeze({ path: 'apps/shared/motion.js', size: 8996, sha256: '9ac97593f7339f6b7f1b9f4da6dafed4084185440022604b75754377291e56b7' }),
  Object.freeze({ path: 'apps/shared/shell.js', size: 3769, sha256: 'd53f7caab7fbcaee1739b5aada9773b443289022f8e9c3b11578b84ab98a3103' }),
  Object.freeze({ path: 'apps/shared/styles.css', size: 9887, sha256: 'db0f0c531c453455d63aadba1dd4a99008337e555a746a7cbfee19e5a3d8f3ef' }),
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

// These remain deliberately unset until owner/legal sign-off and independent
// review of the final bytes.  Current draft hashes are rejected below.
export const FINAL_LEGAL_SHA256 = Object.freeze({
  privacy: null,
  'report-content': null,
  support: null,
  terms: null,
});
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

function runInputCapture(root, expectedRootIdentity = attestRoot(root)) {
  const result = spawnSync('python3', [helperPath, 'capture-reviewed-inputs', root], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, CABOHEALTH_EXPECTED_ROOT_ID: expectedRootIdentity },
  });
  if (result.status !== 0) throw new Error(`WEB_INPUT_CAPTURE_FAILED: ${result.stderr.trim()}`);
  let snapshot;
  try {
    snapshot = JSON.parse(result.stdout);
  } catch {
    throw new Error('WEB_INPUT_CAPTURE_SCHEMA_INVALID');
  }
  if (`${JSON.stringify(snapshot)}\n` !== result.stdout) throw new Error('WEB_INPUT_CAPTURE_NONCANONICAL');
  assertExactKeys(snapshot, ['schemaVersion', 'artifactKind', 'files'], 'WEB_INPUT_CAPTURE');
  if (
    snapshot.schemaVersion !== 1
    || snapshot.artifactKind !== 'cabohealth-reviewed-web-input-snapshot-v1'
    || !Array.isArray(snapshot.files)
    || snapshot.files.length !== INPUT_PATHS.length
  ) throw new Error('WEB_INPUT_CAPTURE_SCHEMA_INVALID');
  const files = new Map();
  for (const [index, entry] of snapshot.files.entries()) {
    assertExactKeys(entry, ['path', 'size', 'sha256', 'bytesBase64'], 'WEB_INPUT_CAPTURE_FILE');
    let bytes;
    try {
      bytes = Buffer.from(entry.bytesBase64, 'base64');
    } catch {
      throw new Error(`WEB_INPUT_CAPTURE_ENCODING_INVALID: ${entry.path}`);
    }
    if (
      entry.path !== INPUT_PATHS[index]
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || bytes.byteLength !== entry.size
      || sha256(bytes) !== entry.sha256
      || bytes.toString('base64') !== entry.bytesBase64
    ) throw new Error(`WEB_INPUT_CAPTURE_INVALID: ${entry.path ?? index}`);
    files.set(entry.path, bytes);
  }
  if (attestRoot(root) !== expectedRootIdentity) throw new Error('WEB_RELEASE_PROJECT_ROOT_CHANGED');
  return files;
}

function attestRoot(root) {
  const result = spawnSync('python3', [helperPath, 'root-identity', resolve(root)], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`WEB_RELEASE_PROJECT_ROOT_UNSAFE: ${result.stderr.trim()}`);
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error('WEB_RELEASE_ROOT_IDENTITY_INVALID');
  }
  assertExactKeys(value, ['schemaVersion', 'device', 'inode'], 'WEB_RELEASE_ROOT_IDENTITY');
  if (
    value.schemaVersion !== 1
    || !Number.isSafeInteger(value.device)
    || !Number.isSafeInteger(value.inode)
    || value.device < 0
    || value.inode <= 0
    || `${JSON.stringify(value)}\n` !== result.stdout
  ) throw new Error('WEB_RELEASE_ROOT_IDENTITY_INVALID');
  return `${value.device}:${value.inode}`;
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

export function planWebRelease(
  root = projectRoot,
  reviewedLegalSha256 = FINAL_LEGAL_SHA256,
  expectedRootIdentity = attestRoot(root),
) {
  const lexicalRoot = resolve(root);
  if (attestRoot(lexicalRoot) !== expectedRootIdentity) throw new Error('WEB_RELEASE_PROJECT_ROOT_CHANGED');
  const rootStats = lstatSync(lexicalRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || realpathSync(lexicalRoot) !== lexicalRoot) {
    throw new Error('WEB_RELEASE_PROJECT_ROOT_UNSAFE');
  }
  assertFinalLegalPins(reviewedLegalSha256);
  const capsule = captureReviewedCapsule(lexicalRoot);
  const capturedInputs = runInputCapture(lexicalRoot, expectedRootIdentity);
  const { appId } = readReleaseIdentity(lexicalRoot);
  if (appId !== APP_ID) throw new Error('WEB_RELEASE_APP_ID_INVALID');

  const aasaPath = 'web-hosting/cabohealth.org/.well-known/apple-app-site-association';
  const aasaBytes = capturedInputs.get(aasaPath);
  if (!aasaBytes?.equals(Buffer.from(canonicalAasaBytes(appId), 'utf8'))) {
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
  if (attestRoot(lexicalRoot) !== expectedRootIdentity) throw new Error('WEB_RELEASE_PROJECT_ROOT_CHANGED');
  return Object.freeze({ manifest, transport });
}

function assertComplianceReady(root, rootIdentity) {
  const result = spawnSync(
    process.execPath,
    [resolve(projectRoot, 'scripts/verify-minimal-v1.mjs'), root],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error('COMPLIANCE_FACTS_INCOMPLETE');
  }
  if (attestRoot(root) !== rootIdentity) throw new Error('WEB_RELEASE_PROJECT_ROOT_CHANGED');
}

function runMutationHelper(arguments_, root, input, rootIdentity) {
  const result = spawnSync('python3', [helperPath, ...arguments_], {
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
  const rootIdentity = attestRoot(root);
  assertComplianceReady(root, rootIdentity);
  const plan = planWebRelease(root, FINAL_LEGAL_SHA256, rootIdentity);
  if (mode === 'check') return plan;
  runMutationHelper(
    ['materialize-local', root],
    root,
    canonicalJson(plan.transport),
    rootIdentity,
  );
  runMutationHelper(
    ['publish-manifest-local', root, sha256(Buffer.from(canonicalJson(plan.manifest)))],
    root,
    canonicalJson({ transport: plan.transport, manifest: plan.manifest }),
    rootIdentity,
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
