import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureTmp = realpathSync(tmpdir());
const helperPath = join(projectRoot, 'scripts/secure_web_release.py');
const paths = Object.freeze([
  '.well-known/apple-app-site-association',
  'app/index.html',
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
const targets = Object.freeze([
  'public_html/apps/.htaccess',
  'public_html/apps/shared',
  'public_html/app/index.html',
  'public_html/app/privacy',
  'public_html/app/terms',
  'public_html/app/support',
  'public_html/app/report-content',
  'public_html/apps/healthy-recipes',
  'public_html/apps/clinic-guide',
  'public_html/.well-known/apple-app-site-association',
]);
const inputs = Object.freeze([
  ['miniapps/dist', 'task6b-miniapp'],
  ['web-hosting/cabohealth.org/app/index.html', 'marketing-landing'],
  ['web-hosting/cabohealth.org/app/privacy/index.html', 'task7-legal'],
  ['web-hosting/cabohealth.org/app/terms/index.html', 'task7-legal'],
  ['web-hosting/cabohealth.org/app/support/index.html', 'task7-legal'],
  ['web-hosting/cabohealth.org/app/report-content/index.html', 'task7-legal'],
  ['web-hosting/cabohealth.org/.well-known/apple-app-site-association', 'aasa'],
  ['miniapps/shared/security-headers.conf', 'apache-security'],
  ['web-hosting/cabohealth.org/apps/.htaccess', 'apache-security'],
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function expectedMedia(path) {
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
  if (path === 'app/index.html') return 'marketing-landing';
  if (path.startsWith('app/')) return 'task7-legal';
  return 'aasa';
}

function fixtureTransport() {
  const files = paths.map((path) => {
    const bytes = Buffer.from(`review-fixture:${path}\n`);
    return {
      path,
      size: bytes.length,
      sha256: sha256(bytes),
      mediaType: expectedMedia(path),
      deployMode: '0644',
      kind: expectedKind(path),
      bytesBase64: bytes.toString('base64'),
    };
  });
  const policy = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [...targets],
    files: files.map(({ bytesBase64: _bytesBase64, ...entry }) => entry),
  };
  const inventorySha256 = sha256(canonicalJson(policy));
  return {
    ...policy,
    artifactKind: 'cabohealth-web-transport-v1',
    releaseId: `web-v1-${inventorySha256}`,
    inventorySha256,
    files,
  };
}

function fixtureArtifact(transport = fixtureTransport()) {
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    releaseId: transport.releaseId,
    inventorySha256: transport.inventorySha256,
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [...targets],
    inputs: inputs.map(([path, kind], index) => ({
      path,
      size: index + 101,
      sha256: sha256(Buffer.from(`independent-input:${index}\n`)),
      kind,
    })),
    files: transport.files.map(({ bytesBase64: _bytesBase64, ...entry }) => entry),
  };
}

function runHelper(root, command, transport, extra = [], env = {}) {
  return spawnSync('python3', [helperPath, command, root, ...extra], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
    env: { ...process.env, ...env },
  });
}

function writePath(root, path, bytes, mode = 0o644) {
  const components = path.split('/');
  let current = root;
  for (const component of components.slice(0, -1)) {
    current = join(current, component);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o755 });
  }
  writeFileSync(join(current, components.at(-1)), bytes, { flag: 'wx', mode });
}

test('reviewed artifact authority recomputes exact policy and requires independent pins', async () => {
  const { validateArtifactAuthority } = await import('../scripts/verify-production.mjs');
  assert.equal(typeof validateArtifactAuthority, 'function');
  const artifact = fixtureArtifact();
  const authority = {
    reviewedReleaseId: artifact.releaseId,
    reviewedArtifactSha256: sha256(canonicalJson(artifact)),
  };
  assert.deepEqual(validateArtifactAuthority(artifact, authority), artifact);

  const mutations = [
    (value) => { value.files[1].mediaType = 'text/plain; charset=utf-8'; },
    (value) => { value.files[1].kind = 'aasa'; },
    (value) => { value.files[1].deployMode = '0600'; },
    (value) => { value.inputs[0].sha256 = '0'.repeat(64); },
    (value) => { value.promoteTargets.reverse(); },
    (value) => { value.files[1].sha256 = '1'.repeat(64); },
    (value) => { value.inventorySha256 = '2'.repeat(64); value.releaseId = `web-v1-${'2'.repeat(64)}`; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(artifact);
    mutate(changed);
    assert.throws(() => validateArtifactAuthority(changed, authority));
  }

  const coordinated = structuredClone(artifact);
  coordinated.files[1].sha256 = '3'.repeat(64);
  const policy = {
    schemaVersion: coordinated.schemaVersion,
    artifactKind: coordinated.artifactKind,
    appId: coordinated.appId,
    entrySlugs: coordinated.entrySlugs,
    legalSlugs: coordinated.legalSlugs,
    promoteTargets: coordinated.promoteTargets,
    files: coordinated.files,
  };
  coordinated.inventorySha256 = sha256(canonicalJson(policy));
  coordinated.releaseId = `web-v1-${coordinated.inventorySha256}`;
  assert.throws(() => validateArtifactAuthority(coordinated, authority));
});

test('capsule consumer rejects a deterministic secondary-snapshot swap against eleven reviewed pins', async () => {
  const {
    captureReviewedCapsule,
    REVIEWED_MINIAPP_FILE_PINS,
  } = await import('../scripts/assemble-web-release.mjs');
  const { readVerifiedMiniappArtifact } = await import('../scripts/build-miniapps.mjs');
  assert.equal(typeof captureReviewedCapsule, 'function');
  assert.equal(REVIEWED_MINIAPP_FILE_PINS?.length, 11);
  const independentlyVerified = readVerifiedMiniappArtifact({
    projectRoot,
    outputRoot: join(projectRoot, 'miniapps/dist'),
    expectedEntrySlugs: ['healthy-recipes', 'clinic-guide'],
  });
  const changedFiles = new Map(
    [...independentlyVerified.files].map(([path, bytes]) => [path, Buffer.from(bytes)]),
  );
  changedFiles.set('apps/shared/shell.js', Buffer.alloc(changedFiles.get('apps/shared/shell.js').length, 0x78));
  assert.throws(
    () => captureReviewedCapsule(projectRoot, () => ({
      manifest: { releaseReady: true, mode: 'release', entrySlugs: ['healthy-recipes', 'clinic-guide'] },
      files: changedFiles,
    })),
    /TASK6B_CAPTURED_BUFFER_PIN_MISMATCH: apps\/shared\/shell\.js/u,
  );
});

test('central active-resource policy rejects every reviewed URL-bearing tag and attribute class', async () => {
  const { assertStaticWebPolicy } = await import('../scripts/web-release-policy.mjs');
  assert.equal(typeof assertStaticWebPolicy, 'function');
  const base = '<!doctype html><html><head><link rel="canonical" href="https://cabohealth.org/app/privacy/"></head><body><a href="https://cabohealth.org/app/terms/">Terms</a></body></html>';
  assert.equal(assertStaticWebPolicy('app/privacy/index.html', Buffer.from(base)), true);
  const mutations = [
    '<img src="https://tracker.invalid/pixel.png">',
    '<img srcset="/local.png 1x, https://tracker.invalid/pixel.png 2x">',
    '<source src="https://tracker.invalid/movie.mp4">',
    '<source srcset="https://tracker.invalid/movie.webp 1x">',
    '<video poster="https://tracker.invalid/poster.png"></video>',
    '<video src="https://tracker.invalid/movie.mp4"></video>',
    '<audio src="https://tracker.invalid/audio.mp3"></audio>',
    '<track src="https://tracker.invalid/captions.vtt">',
    '<link rel="icon" href="https://tracker.invalid/icon.png">',
    '<link rel="stylesheet" href="https://tracker.invalid/site.css">',
    '<script src="https://tracker.invalid/site.js"></script>',
    '<iframe src="https://tracker.invalid/frame"></iframe>',
    '<embed src="https://tracker.invalid/object">',
    '<object data="https://tracker.invalid/object"></object>',
    '<form action="https://tracker.invalid/submit"></form>',
    '<input src="https://tracker.invalid/button.png">',
    '<button formaction="https://tracker.invalid/submit">go</button>',
    '<svg><use href="https://tracker.invalid/sprite.svg#logo"></use></svg>',
    '<svg><image xlink:href="https://tracker.invalid/image.svg"></image></svg>',
    '<a href="/local" ping="https://tracker.invalid/ping">tracked</a>',
    '<area href="/local" ping="https://tracker.invalid/ping">',
    '<base href="https://tracker.invalid/">',
    '<body background="https://tracker.invalid/background.png">',
    '<table background="https://tracker.invalid/background.png"></table>',
    '<meta http-equiv="refresh" content="0;url=https://tracker.invalid/">',
  ];
  for (const mutation of mutations) {
    const changed = Buffer.from(base.replace('</body>', `${mutation}</body>`));
    assert.throws(
      () => assertStaticWebPolicy('app/privacy/index.html', changed),
      /WEB_ACTIVE_RESOURCE_FORBIDDEN/u,
      mutation,
    );
  }
});

test('private stage re-verification rejects empty extras and wrong root mode', async (context) => {
  for (const mutation of ['empty-extra', 'unsealed-root']) {
    await context.test(mutation, () => {
      const transport = fixtureTransport();
      const root = mkdtempSync(join(fixtureTmp, 'cabohealth-exact-tree-fixture-'));
      const first = runHelper(root, 'materialize-stage', transport, [transport.releaseId]);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const bundle = join(root, 'stage', transport.releaseId, 'public_html');
      if (mutation === 'empty-extra') {
        mkdirSync(join(bundle, 'unexpected-empty'));
      }
      else chmodSync(bundle, 0o755);
      const second = runHelper(root, 'materialize-stage', transport, [transport.releaseId]);
      assert.equal(second.status, 1, second.stderr || second.stdout);
      assert.equal(existsSync(join(bundle, '.well-known/apple-app-site-association')), true);
    });
  }
});

test('absolute root walk rejects a symlinked intermediate ancestor without touching the outside tree', () => {
  const transport = fixtureTransport();
  const parent = mkdtempSync(join(fixtureTmp, 'cabohealth-ancestor-fixture-'));
  const real = join(parent, 'real');
  const outside = join(parent, 'outside');
  mkdirSync(real);
  mkdirSync(join(real, 'root'));
  mkdirSync(join(real, 'root/release'));
  mkdirSync(outside);
  writeFileSync(join(outside, 'sentinel.txt'), 'outside unchanged\n', { flag: 'wx' });
  symlinkSync(real, join(parent, 'linked-root'));
  const result = runHelper(
    join(parent, 'linked-root/root'),
    'materialize-stage',
    transport,
    [transport.releaseId],
  );
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(readFileSync(join(outside, 'sentinel.txt'), 'utf8'), 'outside unchanged\n');
  assert.equal(existsSync(join(real, 'root/release/web-bundles')), false);
});

test('root identity binding rejects a parent-entry swap without touching either tree', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-parent-swap-fixture-'));
  mkdirSync(join(root, 'release'));
  writeFileSync(join(root, 'original-sentinel.txt'), 'original unchanged\n', { flag: 'wx' });
  const identityResult = spawnSync('python3', [helperPath, 'root-identity', root], { encoding: 'utf8' });
  assert.equal(identityResult.status, 0, identityResult.stderr || identityResult.stdout);
  const identity = JSON.parse(identityResult.stdout);
  const expectedRootIdentity = `${identity.device}:${identity.inode}`;
  const retained = `${root}.retained`;
  renameSync(root, retained);
  mkdirSync(root, { mode: 0o755 });
  mkdirSync(join(root, 'release'));
  writeFileSync(join(root, 'replacement-sentinel.txt'), 'replacement unchanged\n', { flag: 'wx' });
  const result = runHelper(root, 'materialize-stage', transport, [transport.releaseId], {
    CABOHEALTH_EXPECTED_ROOT_ID: expectedRootIdentity,
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(readFileSync(join(retained, 'original-sentinel.txt'), 'utf8'), 'original unchanged\n');
  assert.equal(readFileSync(join(root, 'replacement-sentinel.txt'), 'utf8'), 'replacement unchanged\n');
  assert.equal(existsSync(join(retained, 'release/web-bundles')), false);
  assert.equal(existsSync(join(root, 'release/web-bundles')), false);
});

test('private stage root stays 0700 while all deploy directories are exact public 0755', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-stage-modes-fixture-'));
  const result = runHelper(root, 'materialize-stage', transport, [transport.releaseId]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const release = join(root, 'stage', transport.releaseId);
  assert.equal(statSync(release).mode & 0o777, 0o700);
  assert.equal(statSync(join(release, 'public_html')).mode & 0o777, 0o700);
  for (const relative of [
    'public_html/.well-known',
    'public_html/app',
    'public_html/app/privacy',
    'public_html/app/report-content',
    'public_html/app/support',
    'public_html/app/terms',
    'public_html/apps',
    'public_html/apps/clinic-guide',
    'public_html/apps/healthy-recipes',
    'public_html/apps/shared',
  ]) assert.equal(statSync(join(release, relative)).mode & 0o777, 0o755, relative);
});

test('promote-next stops after one unit and rollback restores a root-probe failure at every index', async (context) => {
  for (let stopIndex = 0; stopIndex < targets.length; stopIndex += 1) {
    await context.test(`probe failure after unit ${stopIndex}`, () => {
      const transport = fixtureTransport();
      const root = mkdtempSync(join(fixtureTmp, 'cabohealth-promote-next-fixture-'));
      assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
      writePath(root, 'public_html/apps/.htaccess', 'old htaccess\n');
      writePath(root, 'public_html/apps/shared/clinic-map-texture.png', 'old map texture\n');
      writePath(root, 'public_html/apps/shared/logo-wordmark.png', 'old wordmark\n');
      writePath(root, 'public_html/apps/shared/logo.png', 'old logo\n');
      writePath(root, 'public_html/apps/shared/motion.js', 'old motion\n');
      writePath(root, 'public_html/apps/shared/shell.js', 'old shell\n');
      writePath(root, 'public_html/apps/shared/styles.css', 'old styles\n');
      writePath(root, 'public_html/index.php', 'wordpress sentinel\n');
      const oldHtaccess = readFileSync(join(root, 'public_html/apps/.htaccess'));
      const oldShared = readFileSync(join(root, 'public_html/apps/shared/shell.js'));
      for (let index = 0; index <= stopIndex; index += 1) {
        const result = runHelper(root, 'promote-next', transport, [transport.releaseId]);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const outcome = JSON.parse(result.stdout);
        assert.equal(outcome.index, index);
        assert.equal(outcome.complete, index === targets.length - 1);
      }
      if (stopIndex === targets.length - 1) {
        const overlays = runHelper(root, 'publish-hosting-overlays', transport);
        assert.equal(overlays.status, 0, overlays.stderr || overlays.stdout);
        const inventory = runHelper(root, 'inventory-live', transport, [transport.releaseId]);
        assert.equal(inventory.status, 0, inventory.stderr || inventory.stdout);
        assert.deepEqual(JSON.parse(inventory.stdout), {
          schemaVersion: 1,
          artifactKind: 'cabohealth-server-inventory-v1',
          status: 'verified',
          releaseId: transport.releaseId,
          rootCount: 3,
          fileCount: 17,
          paths: [...paths],
          inventorySha256: transport.inventorySha256,
        });
        const overlaysRollback = runHelper(root, 'rollback-hosting-overlays', transport);
        assert.equal(
          overlaysRollback.status,
          0,
          overlaysRollback.stderr || overlaysRollback.stdout,
        );
      }
      for (let index = stopIndex + 1; index < targets.length; index += 1) {
        const stageTarget = targets[index].replace(/^public_html\//u, '');
        assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html', stageTarget)), true);
      }
      assert.equal(readFileSync(join(root, 'public_html/index.php'), 'utf8'), 'wordpress sentinel\n');
      for (let index = stopIndex; index >= 0; index -= 1) {
        const rollback = runHelper(root, 'rollback-next', transport, [transport.releaseId, String(index)]);
        assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout);
      }
      assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), oldHtaccess);
      assert.deepEqual(readFileSync(join(root, 'public_html/apps/shared/shell.js')), oldShared);
      for (const target of targets.slice(2)) assert.equal(existsSync(join(root, target)), false, target);
      for (const container of ['apps', 'app', '.well-known']) {
        assert.equal(statSync(join(root, 'public_html', container)).mode & 0o777, 0o755);
      }
    });
  }
});

test('rollback rejects a tampered slot before exchange and keeps reviewed new bytes live', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-rollback-slot-fixture-'));
  assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
  writePath(root, 'public_html/apps/.htaccess', 'old htaccess\n');
  const promoted = runHelper(root, 'promote-next', transport, [transport.releaseId]);
  assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
  const expectedNew = Buffer.from(transport.files.find(({ path }) => path === 'apps/.htaccess').bytesBase64, 'base64');
  const slot = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  writeFileSync(slot, 'tampered rollback slot\n');
  const rollback = runHelper(root, 'rollback-next', transport, [transport.releaseId, '0']);
  assert.equal(rollback.status, 1, rollback.stderr || rollback.stdout);
  assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), expectedNew);
});

test('production action contracts use nonce slugs and sanitize controls, inventory, and browser evidence', async () => {
  const {
    createUnknownSlug,
    validateBrowserEvidence,
    validateSensitiveControls,
    validateServerInventoryEvidence,
  } = await import('../scripts/verify-production.mjs');
  const first = createUnknownSlug();
  const second = createUnknownSlug();
  assert.match(first, /^task-8-unknown-[a-f0-9]{32}$/u);
  assert.match(second, /^task-8-unknown-[a-f0-9]{32}$/u);
  assert.notEqual(first, second);
  assert.deepEqual(validateSensitiveControls({
    unrelatedPath: '/unrelated-control.pdf',
    unrelatedExpectedStatuses: [200],
    terminalPath: '/remediated-terminal-route',
    terminalExpectedStatuses: [404, 410],
  }), {
    unrelatedPath: '/unrelated-control.pdf',
    unrelatedExpectedStatuses: [200],
    terminalPath: '/remediated-terminal-route',
    terminalExpectedStatuses: [404, 410],
  });
  for (const path of ['http://169.254.169.254/latest', '//evil.invalid/x', '/../outside', '/apps/healthy-recipes/']) {
    assert.throws(() => validateSensitiveControls({
      unrelatedPath: path,
      unrelatedExpectedStatuses: [200],
      terminalPath: '/remediated-terminal-route',
      terminalExpectedStatuses: [404],
    }), /SENSITIVE_CONTROLS_INVALID/u);
  }
  const artifact = fixtureArtifact();
  const authority = {
    reviewedReleaseId: artifact.releaseId,
    reviewedArtifactSha256: sha256(canonicalJson(artifact)),
  };
  assert.equal(validateServerInventoryEvidence({
    schemaVersion: 1,
    artifactKind: 'cabohealth-server-inventory-v1',
    status: 'verified',
    releaseId: artifact.releaseId,
    rootCount: 3,
    fileCount: 17,
    paths: [...paths],
    inventorySha256: artifact.inventorySha256,
  }, artifact, authority), true);
  assert.throws(() => validateBrowserEvidence({
    status: 'verified',
    viewportCount: 2,
    localeCount: 2,
    javascriptModeCount: 2,
    unexpectedRequests: 0,
    consoleErrors: 0,
    noJsReadable: true,
  }, artifact, authority), /BROWSER_EVIDENCE/u);
});

test('legal approval pins reject pending and known draft hashes before accepting reviewed finals', async () => {
  const { assertFinalLegalPins } = await import('../scripts/assemble-web-release.mjs');
  assert.equal(typeof assertFinalLegalPins, 'function');
  assert.throws(() => assertFinalLegalPins({
    privacy: null, 'report-content': null, support: null, terms: null,
  }), /FINAL_LEGAL_PINS_PENDING/u);
  assert.throws(() => assertFinalLegalPins({
    privacy: '48a9d5974d234434c200ff272c6dfeecc2d6b05baeae30dc25a37df06fb46b91',
    'report-content': 'a'.repeat(64), support: 'b'.repeat(64), terms: 'c'.repeat(64),
  }), /DRAFT_LEGAL_PIN_FORBIDDEN/u);
  assert.equal(assertFinalLegalPins({
    privacy: 'a'.repeat(64), 'report-content': 'b'.repeat(64), support: 'c'.repeat(64), terms: 'd'.repeat(64),
  }), true);
});

test('reviewed legal pins match the exact final bytes in both release authorities', async () => {
  const { FINAL_LEGAL_SHA256 } = await import('../scripts/assemble-web-release.mjs');
  const expected = Object.fromEntries([
    'privacy',
    'report-content',
    'support',
    'terms',
  ].map((slug) => [
    slug,
    sha256(readFileSync(join(projectRoot, `web-hosting/cabohealth.org/app/${slug}/index.html`))),
  ]));

  assert.deepEqual(FINAL_LEGAL_SHA256, expected);
  const helper = readFileSync(helperPath, 'utf8');
  for (const [slug, hash] of Object.entries(expected)) {
    assert.match(helper, new RegExp(`^    "${slug}": "${hash}",$`, 'mu'));
  }
});

test('stage policy, modes, root identity, and partial journal fail closed without changing unrelated sentinels', async (context) => {
  await context.test('stage mode tamper', () => {
    const transport = fixtureTransport();
    const root = mkdtempSync(join(fixtureTmp, 'cabohealth-stage-tamper-fixture-'));
    assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
    const staged = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
    chmodSync(staged, 0o600);
    writePath(root, 'public_html/index.php', 'wordpress sentinel\n');
    const result = runHelper(root, 'promote-next', transport, [transport.releaseId]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
    assert.equal(readFileSync(join(root, 'public_html/index.php'), 'utf8'), 'wordpress sentinel\n');
  });

  await context.test('stage active remote resource', async () => {
    const { createWebReleaseTransport } = await import('../scripts/assemble-web-release.mjs');
    const original = fixtureTransport();
    const buffers = new Map(original.files.map((entry) => [entry.path, Buffer.from(entry.bytesBase64, 'base64')]));
    buffers.set('app/privacy/index.html', Buffer.from('<img src="https://tracker.invalid/pixel.png">'));
    const changed = createWebReleaseTransport(buffers);
    const root = mkdtempSync(join(fixtureTmp, 'cabohealth-stage-policy-fixture-'));
    const result = runHelper(root, 'materialize-stage', changed, [changed.releaseId]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /WEB_ACTIVE_RESOURCE_FORBIDDEN/u);
    assert.equal(existsSync(join(root, 'stage')), false);
  });

  await context.test('root identity mismatch', () => {
    const transport = fixtureTransport();
    const root = mkdtempSync(join(fixtureTmp, 'cabohealth-root-id-fixture-'));
    mkdirSync(join(root, 'release'));
    const result = runHelper(root, 'materialize-stage', transport, [transport.releaseId], {
      CABOHEALTH_EXPECTED_ROOT_ID: '1:1',
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, 'release/web-bundles')), false);
  });

  await context.test('partial journal', () => {
    const transport = fixtureTransport();
    const root = mkdtempSync(join(fixtureTmp, 'cabohealth-partial-journal-fixture-'));
    assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
    mkdirSync(join(root, 'public_html'), { mode: 0o755 });
    assert.equal(runHelper(root, 'promote-next', transport, [transport.releaseId]).status, 0);
    const firstLive = readFileSync(join(root, 'public_html/apps/.htaccess'));
    writeFileSync(
      join(root, 'rollback', transport.releaseId, 'transitions/01-promoted-000.json'),
      '{',
      { flag: 'wx', mode: 0o600 },
    );
    const result = runHelper(root, 'promote-next', transport, [transport.releaseId]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /ROLLBACK_TRANSITION_INVALID/u);
    assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), firstLive);
    assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
  });

  await context.test('journal mode', () => {
    const transport = fixtureTransport();
    const root = mkdtempSync(join(fixtureTmp, 'cabohealth-journal-mode-fixture-'));
    assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
    mkdirSync(join(root, 'public_html'), { mode: 0o755 });
    assert.equal(runHelper(root, 'promote-next', transport, [transport.releaseId]).status, 0);
    const firstLive = readFileSync(join(root, 'public_html/apps/.htaccess'));
    chmodSync(join(root, 'rollback', transport.releaseId, 'transitions/00-promoted-000.json'), 0o644);
    const result = runHelper(root, 'promote-next', transport, [transport.releaseId]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), firstLive);
    assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
  });
});

test('rollback rejects link, special, directory, mode, and post-exchange mismatch slots without leaving old bytes live', async (context) => {
  for (const mutation of ['symlink', 'fifo', 'directory', 'mode', 'container-mode', 'post-exchange', 'post-exchange-error']) {
    await context.test(mutation, () => {
      const transport = fixtureTransport();
      const root = mkdtempSync(join(fixtureTmp, `cabohealth-rollback-${mutation}-fixture-`));
      assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
      writePath(root, 'public_html/apps/.htaccess', 'old htaccess\n');
      assert.equal(runHelper(root, 'promote-next', transport, [transport.releaseId]).status, 0);
      const expectedNew = Buffer.from(transport.files.find(({ path }) => path === 'apps/.htaccess').bytesBase64, 'base64');
      const slot = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
      if (mutation === 'mode') chmodSync(slot, 0o600);
      if (mutation === 'container-mode') chmodSync(join(root, 'rollback', transport.releaseId), 0o755);
      if (mutation === 'symlink' || mutation === 'fifo' || mutation === 'directory') {
        const retained = `${slot}.retained`;
        renameSync(slot, retained);
        if (mutation === 'symlink') symlinkSync(retained, slot);
        else if (mutation === 'directory') mkdirSync(slot, { mode: 0o755 });
        else {
          const fifo = spawnSync('python3', ['-c', 'import os,sys;os.mkfifo(sys.argv[1],0o600)', slot], { encoding: 'utf8' });
          assert.equal(fifo.status, 0, fifo.stderr || fifo.stdout);
        }
      }
      const env = mutation === 'post-exchange'
        ? { CABOHEALTH_TEST_FAULT: 'rollback-post-exchange-mismatch' }
        : mutation === 'post-exchange-error'
          ? { CABOHEALTH_TEST_FAULT: 'rollback-post-exchange-inventory-error' }
          : {};
      const result = runHelper(root, 'rollback-next', transport, [transport.releaseId, '0'], env);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), expectedNew);
    });
  }
});

test('atomic rename capability failure leaves both operands byte-identical', () => {
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-capability-fixture-'));
  writeFileSync(join(root, 'left'), 'left\n', { flag: 'wx' });
  writeFileSync(join(root, 'right'), 'right\n', { flag: 'wx' });
  const program = [
    'import importlib.util,os,sys;sys.dont_write_bytecode=True',
    `spec=importlib.util.spec_from_file_location("helper", ${JSON.stringify(helperPath)})`,
    'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
    'm.platform.system=lambda:"Unsupported"',
    `fd=os.open(${JSON.stringify(root)}, os.O_RDONLY|os.O_DIRECTORY)`,
    'try:',
    '  m.rename_with_flag(fd,"left",fd,"right","exchange")',
    'except m.ReleaseError as e:',
    '  print(str(e),file=sys.stderr);sys.exit(1)',
    'finally:',
    '  os.close(fd)',
  ].join('\n');
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /ATOMIC_RENAME_CAPABILITY_MISSING/u);
  assert.equal(readFileSync(join(root, 'left'), 'utf8'), 'left\n');
  assert.equal(readFileSync(join(root, 'right'), 'utf8'), 'right\n');
});

test('promotion reverses post-syscall validation exceptions for present and absent targets', async (context) => {
  for (const original of ['present', 'absent']) {
    await context.test(original, () => {
      const transport = fixtureTransport();
      const root = mkdtempSync(join(fixtureTmp, `cabohealth-promotion-${original}-fixture-`));
      assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
      mkdirSync(join(root, 'public_html'), { mode: 0o755 });
      if (original === 'present') writePath(root, 'public_html/apps/.htaccess', 'old htaccess\n');
      const old = original === 'present' ? readFileSync(join(root, 'public_html/apps/.htaccess')) : null;
      const fault = original === 'present'
        ? 'promotion-post-exchange-inventory-error'
        : 'promotion-post-noreplace-inventory-error';
      const result = runHelper(
        root,
        'promote-next',
        transport,
        [transport.releaseId],
        { CABOHEALTH_TEST_FAULT: fault },
      );
      assert.equal(result.status, 1, result.stderr || result.stdout);
      if (old) assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), old);
      else assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
      assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess')), true);
    });
  }
});

test('promotion rejects a simulated cross-device boundary before its first unit mutation', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-cross-device-fixture-'));
  assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
  mkdirSync(join(root, 'public_html'), { mode: 0o755 });
  const result = runHelper(
    root,
    'promote-next',
    transport,
    [transport.releaseId],
    { CABOHEALTH_TEST_FAULT: 'promotion-cross-device' },
  );
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
  assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess')), true);
  assert.equal(existsSync(join(root, 'rollback', transport.releaseId)), false);
});
