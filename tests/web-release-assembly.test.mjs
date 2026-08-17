import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureTmp = realpathSync(tmpdir());
const assemblerPath = join(projectRoot, 'scripts/assemble-web-release.mjs');
const helperPath = join(projectRoot, 'scripts/secure_web_release.py');
const payloadPaths = Object.freeze([
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
const promoteTargets = Object.freeze([
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

function fixtureTransport() {
  const files = payloadPaths.map((path) => {
    const bytes = Buffer.from(`fixture:${path}\n`, 'utf8');
    const extension = path.split('.').at(-1);
    const mediaType = path.endsWith('apple-app-site-association')
      ? 'application/json'
      : ({ html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png' }[extension] ?? 'text/plain; charset=utf-8');
    const kind = path.startsWith('apps/')
      ? (path === 'apps/.htaccess' ? 'apache-security' : 'task6b-miniapp')
      : (path.startsWith('app/') ? 'task7-legal' : 'aasa');
    return {
      path,
      size: bytes.byteLength,
      sha256: sha256(bytes),
      mediaType,
      deployMode: '0644',
      kind,
      bytesBase64: bytes.toString('base64'),
    };
  });
  const policy = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [...promoteTargets],
    files: files.map(({ bytesBase64: _bytesBase64, ...entry }) => entry),
  };
  const inventorySha256 = sha256(Buffer.from(canonicalJson(policy)));
  return {
    ...policy,
    artifactKind: 'cabohealth-web-transport-v1',
    releaseId: `web-v1-${inventorySha256}`,
    inventorySha256,
    files,
  };
}

function materializeFixture(transport = fixtureTransport()) {
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-release-fixture-'));
  mkdirSync(join(root, 'release'));
  const result = spawnSync('python3', [helperPath, 'materialize-local', root], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
  });
  return { result, root, transport };
}

function fixtureArtifactManifest(transport) {
  const inputs = [
    'miniapps/dist',
    'web-hosting/cabohealth.org/app/privacy/index.html',
    'web-hosting/cabohealth.org/app/terms/index.html',
    'web-hosting/cabohealth.org/app/support/index.html',
    'web-hosting/cabohealth.org/app/report-content/index.html',
    'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
    'miniapps/shared/security-headers.conf',
    'web-hosting/cabohealth.org/apps/.htaccess',
  ].map((path) => ({
    path,
    size: 1,
    sha256: 'e'.repeat(64),
    kind: path === 'miniapps/dist' ? 'task6b-miniapp'
      : path.includes('/app/') ? 'task7-legal'
        : path.includes('apple-app-site-association') ? 'aasa' : 'apache-security',
  }));
  return {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    releaseId: transport.releaseId,
    inventorySha256: transport.inventorySha256,
    appId: transport.appId,
    entrySlugs: transport.entrySlugs,
    legalSlugs: transport.legalSlugs,
    promoteTargets: transport.promoteTargets,
    inputs,
    files: transport.files.map(({ bytesBase64: _bytesBase64, ...entry }) => entry),
  };
}

function writeFixturePath(root, relativePath, bytes) {
  const components = relativePath.split('/');
  let directory = root;
  for (const component of components.slice(0, -1)) {
    directory = join(directory, component);
    if (!existsSync(directory)) mkdirSync(directory);
  }
  writeFileSync(join(directory, components.at(-1)), bytes, { flag: 'wx' });
}

test('the real assembler fails closed on pending compliance before its first output write', () => {
  const result = spawnSync(process.execPath, [assemblerPath, '--check'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /COMPLIANCE_FACTS_INCOMPLETE/u);
  assert.equal(existsSync(join(projectRoot, 'release/web-artifacts.json')), false);
  assert.equal(existsSync(join(projectRoot, 'release/production-urls.json')), false);
  assert.equal(existsSync(join(projectRoot, 'release/web-bundles')), false);
});

test('descriptor-relative materialization creates the exact immutable 14-file bundle', () => {
  const { result, root, transport } = materializeFixture();
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const bundleRoot = join(root, 'release/web-bundles', transport.releaseId);
  for (const entry of transport.files) {
    const path = join(bundleRoot, entry.path);
    assert.deepEqual(readFileSync(path), Buffer.from(entry.bytesBase64, 'base64'));
    assert.equal(statSync(path).mode & 0o777, 0o444);
  }
  assert.equal(statSync(bundleRoot).mode & 0o777, 0o555);
  const transportPath = join(root, 'release/web-bundles', `${transport.releaseId}.transport.json`);
  assert.equal(readFileSync(transportPath, 'utf8'), canonicalJson(transport));
  assert.equal(statSync(transportPath).mode & 0o777, 0o444);
});

test('two independent captured maps produce the same independently derived release transport', async () => {
  const module = await import('../scripts/assemble-web-release.mjs');
  assert.equal(typeof module.createWebReleaseTransport, 'function');

  const expected = fixtureTransport();
  const firstFiles = new Map(expected.files.map((entry) => [
    entry.path,
    Buffer.from(entry.bytesBase64, 'base64'),
  ]));
  const secondFiles = new Map([...firstFiles].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  const first = module.createWebReleaseTransport(firstFiles);
  const second = module.createWebReleaseTransport(secondFiles);

  assert.equal(canonicalJson(first), canonicalJson(expected));
  assert.equal(canonicalJson(second), canonicalJson(expected));
  assert.equal(first.releaseId, second.releaseId);

  firstFiles.set('apps/third-module/index.html', Buffer.from('unexpected'));
  assert.throws(
    () => module.createWebReleaseTransport(firstFiles),
    /WEB_RELEASE_FILE_SET_INVALID/u,
  );
});

test('input capture reads only the fixed public source allowlist through retained directory descriptors', () => {
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-input-fixture-'));
  const sourcePaths = [
    'miniapps/shared/security-headers.conf',
    'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
    'web-hosting/cabohealth.org/app/privacy/index.html',
    'web-hosting/cabohealth.org/app/report-content/index.html',
    'web-hosting/cabohealth.org/app/support/index.html',
    'web-hosting/cabohealth.org/app/terms/index.html',
    'web-hosting/cabohealth.org/apps/.htaccess',
  ];
  for (const path of sourcePaths) writeFixturePath(root, path, Buffer.from(`source:${path}\n`));

  const result = spawnSync('python3', [helperPath, 'capture-reviewed-inputs', root], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const snapshot = JSON.parse(result.stdout);
  assert.deepEqual(snapshot.files.map(({ path }) => path), sourcePaths);
  for (const entry of snapshot.files) {
    const expected = Buffer.from(`source:${entry.path}\n`);
    assert.equal(entry.size, expected.byteLength);
    assert.equal(entry.sha256, sha256(expected));
    assert.deepEqual(Buffer.from(entry.bytesBase64, 'base64'), expected);
  }
});

test('remote materialization foundation creates only the nine fixed promotion leaves in a private local stage', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-stage-fixture-'));
  const result = spawnSync('python3', [helperPath, 'materialize-stage', root, transport.releaseId], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const publicRoot = join(root, 'stage', transport.releaseId, 'public_html');
  for (const entry of transport.files) {
    assert.deepEqual(
      readFileSync(join(publicRoot, entry.path)),
      Buffer.from(entry.bytesBase64, 'base64'),
    );
  }
  assert.equal(statSync(join(publicRoot, 'apps')).mode & 0o777, 0o755);
  assert.equal(statSync(join(publicRoot, 'apps/shared')).mode & 0o777, 0o755);
});

test('atomic local promotion and rollback change only the nine leaves and restore present and absent targets', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-promote-fixture-'));
  const stageResult = spawnSync('python3', [helperPath, 'materialize-stage', root, transport.releaseId], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
  });
  assert.equal(stageResult.status, 0, stageResult.stderr || stageResult.stdout);

  const oldFiles = new Map([
    ['public_html/apps/.htaccess', Buffer.from('old apache policy\n')],
    ['public_html/apps/shared/logo.png', Buffer.from('old logo\n')],
    ['public_html/apps/shared/motion.js', Buffer.from('old motion\n')],
    ['public_html/apps/shared/shell.js', Buffer.from('old shell\n')],
    ['public_html/apps/shared/styles.css', Buffer.from('old styles\n')],
    ['public_html/app/privacy/index.html', Buffer.from('old privacy\n')],
    ['public_html/.well-known/apple-app-site-association', Buffer.from('old aasa\n')],
  ]);
  for (const [path, bytes] of oldFiles) writeFixturePath(root, path, bytes);
  const sentinels = new Map([
    ['public_html/index.php', Buffer.from('wordpress control\n')],
    ['public_html/.htaccess', Buffer.from('protected remediation rule\n')],
    ['public_html/wp-content/uploads/keep.jpg', Buffer.from('unrelated upload\n')],
    ['database-control.txt', Buffer.from('database unchanged\n')],
  ]);
  for (const [path, bytes] of sentinels) writeFixturePath(root, path, bytes);

  for (let index = 0; index < promoteTargets.length; index += 1) {
    const promoteResult = spawnSync(
      'python3',
      [helperPath, 'promote-next', root, transport.releaseId],
      { cwd: projectRoot, encoding: 'utf8', input: canonicalJson(transport) },
    );
    assert.equal(promoteResult.status, 0, promoteResult.stderr || promoteResult.stdout);
    assert.equal(JSON.parse(promoteResult.stdout).index, index);
  }
  for (const entry of transport.files) {
    assert.deepEqual(
      readFileSync(join(root, 'public_html', entry.path)),
      Buffer.from(entry.bytesBase64, 'base64'),
    );
  }
  for (const [path, bytes] of sentinels) assert.deepEqual(readFileSync(join(root, path)), bytes);

  const rollbackResult = spawnSync(
    'python3',
    [helperPath, 'rollback-local', root, transport.releaseId],
    { cwd: projectRoot, encoding: 'utf8', input: canonicalJson(transport) },
  );
  assert.equal(rollbackResult.status, 0, rollbackResult.stderr || rollbackResult.stdout);
  for (const [path, bytes] of oldFiles) assert.deepEqual(readFileSync(join(root, path)), bytes);
  for (const path of [
    'public_html/app/terms',
    'public_html/app/support',
    'public_html/app/report-content',
    'public_html/apps/healthy-recipes',
    'public_html/apps/clinic-guide',
  ]) assert.equal(existsSync(join(root, path)), false);
  for (const [path, bytes] of sentinels) assert.deepEqual(readFileSync(join(root, path)), bytes);
  const transitions = readdirSync(join(root, 'rollback', transport.releaseId, 'transitions'))
    .map((name) => readFileSync(join(root, 'rollback', transport.releaseId, 'transitions', name), 'utf8'));
  assert.equal(transitions.some((record) => record.includes(root)), false);
});

test('artifact provenance is exclusively published only after independent descriptor-bound assembly', async () => {
  const { createWebReleaseTransport } = await import('../scripts/assemble-web-release.mjs');
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-authoritative-release-fixture-'));
  mkdirSync(join(root, 'release'));
  const inputPaths = [
    'web-hosting/cabohealth.org/app/privacy/index.html',
    'web-hosting/cabohealth.org/app/terms/index.html',
    'web-hosting/cabohealth.org/app/support/index.html',
    'web-hosting/cabohealth.org/app/report-content/index.html',
    'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
    'miniapps/shared/security-headers.conf',
    'web-hosting/cabohealth.org/apps/.htaccess',
  ];
  for (const source of inputPaths) writeFixturePath(root, source, readFileSync(join(projectRoot, source)));
  copyFileSync(join(projectRoot, 'miniapps/dist'), join(root, 'miniapps/dist'));
  linkSync(join(root, 'miniapps/dist'), join(root, 'miniapps/.dist-review-link'));
  chmodSync(join(root, 'miniapps/dist'), 0o400);
  const capsuleBytes = readFileSync(join(root, 'miniapps/dist'));
  const capsule = JSON.parse(capsuleBytes.toString('utf8'));
  const outputs = new Map([
    ['.well-known/apple-app-site-association', readFileSync(join(root, 'web-hosting/cabohealth.org/.well-known/apple-app-site-association'))],
    ['app/privacy/index.html', readFileSync(join(root, 'web-hosting/cabohealth.org/app/privacy/index.html'))],
    ['app/report-content/index.html', readFileSync(join(root, 'web-hosting/cabohealth.org/app/report-content/index.html'))],
    ['app/support/index.html', readFileSync(join(root, 'web-hosting/cabohealth.org/app/support/index.html'))],
    ['app/terms/index.html', readFileSync(join(root, 'web-hosting/cabohealth.org/app/terms/index.html'))],
    ...capsule.files.map(({ path, bytesBase64 }) => [path, Buffer.from(bytesBase64, 'base64')]),
  ]);
  const transport = createWebReleaseTransport(outputs);
  const manifest = fixtureArtifactManifest(transport);
  const inputBytes = new Map([['miniapps/dist', capsuleBytes], ...inputPaths.map((path) => [path, readFileSync(join(root, path))])]);
  manifest.inputs = manifest.inputs.map((entry) => ({
    ...entry,
    size: inputBytes.get(entry.path).byteLength,
    sha256: sha256(inputBytes.get(entry.path)),
  }));
  const publish = (candidate = manifest) => spawnSync('python3', [helperPath, 'materialize-release', root], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson({ transport, manifest: candidate }),
  });

  const first = publish();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const path = join(root, 'release/web-artifacts.json');
  assert.equal(readFileSync(path, 'utf8'), canonicalJson(manifest));
  assert.equal(statSync(path).mode & 0o777, 0o444);
  const before = statSync(path);
  const second = publish();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const after = statSync(path);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  const fabricated = structuredClone(manifest);
  fabricated.inputs[0].sha256 = '0'.repeat(64);
  const rejected = publish(fabricated);
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
});

test('materializer rejects schema, path, metadata, byte, and reviewed-release mutations before output writes', async (context) => {
  const cases = [
    ['unknown root key', (value) => { value.unknown = true; }],
    ['traversal path', (value) => { value.files[0].path = '../outside'; }],
    ['backslash path', (value) => { value.files[0].path = 'apps\\outside'; }],
    ['control path', (value) => { value.files[0].path = 'apps/line\nbreak'; }],
    ['unsorted paths', (value) => { [value.files[0], value.files[1]] = [value.files[1], value.files[0]]; }],
    ['wrong media type', (value) => { value.files[1].mediaType = 'text/plain; charset=utf-8'; }],
    ['executable deploy mode', (value) => { value.files[1].deployMode = '0755'; }],
    ['wrong kind', (value) => { value.files[1].kind = 'aasa'; }],
    ['tampered bytes', (value) => { value.files[1].bytesBase64 = Buffer.from('tampered').toString('base64'); }],
    ['release ID mismatch', (value) => { value.releaseId = `web-v1-${'0'.repeat(64)}`; }],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, () => {
      const value = structuredClone(fixtureTransport());
      mutate(value);
      const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-reject-fixture-'));
      mkdirSync(join(root, 'release'));
      writeFileSync(join(root, 'release/sentinel.txt'), 'unchanged\n', { flag: 'wx' });
      const result = spawnSync('python3', [helperPath, 'materialize-local', root], {
        cwd: projectRoot,
        encoding: 'utf8',
        input: canonicalJson(value),
      });
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.equal(existsSync(join(root, 'release/web-bundles')), false);
      assert.equal(readFileSync(join(root, 'release/sentinel.txt'), 'utf8'), 'unchanged\n');
    });
  }
});

test('pre-existing partial final directory is quarantined in place without replacement or cleanup', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-partial-fixture-'));
  mkdirSync(join(root, 'release'));
  mkdirSync(join(root, 'release/web-bundles'));
  mkdirSync(join(root, 'release/web-bundles', transport.releaseId));
  writeFileSync(join(root, 'release/web-bundles', transport.releaseId, 'sentinel.txt'), 'partial\n', { flag: 'wx' });
  const result = spawnSync('python3', [helperPath, 'materialize-local', root], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
  });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(readFileSync(join(root, 'release/web-bundles', transport.releaseId, 'sentinel.txt'), 'utf8'), 'partial\n');
  assert.equal(existsSync(join(root, 'release/web-bundles', transport.releaseId, '.well-known')), false);
});

test('reviewed input capture rejects a symlinked leaf and leaves the outside sentinel unchanged', () => {
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-symlink-fixture-'));
  const outside = join(root, 'outside-sentinel.html');
  writeFileSync(outside, 'outside\n', { flag: 'wx' });
  const sourcePaths = [
    'miniapps/shared/security-headers.conf',
    'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
    'web-hosting/cabohealth.org/app/privacy/index.html',
    'web-hosting/cabohealth.org/app/report-content/index.html',
    'web-hosting/cabohealth.org/app/support/index.html',
    'web-hosting/cabohealth.org/app/terms/index.html',
    'web-hosting/cabohealth.org/apps/.htaccess',
  ];
  for (const path of sourcePaths.filter((path) => !path.includes('/privacy/'))) {
    writeFixturePath(root, path, Buffer.from(`source:${path}\n`));
  }
  const privacyParent = join(root, 'web-hosting/cabohealth.org/app/privacy');
  if (!existsSync(privacyParent)) mkdirSync(privacyParent);
  symlinkSync(outside, join(privacyParent, 'index.html'));
  const result = spawnSync('python3', [helperPath, 'capture-reviewed-inputs', root], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(readFileSync(outside, 'utf8'), 'outside\n');
});

test('remote stage rejects a coordinated transport edit when the independently reviewed release ID is unchanged', async () => {
  const original = fixtureTransport();
  const module = await import('../scripts/assemble-web-release.mjs');
  const files = new Map(original.files.map((entry) => [entry.path, Buffer.from(entry.bytesBase64, 'base64')]));
  files.set('apps/shared/shell.js', Buffer.from('coordinated tamper\n'));
  const tampered = module.createWebReleaseTransport(files);
  assert.notEqual(tampered.releaseId, original.releaseId);
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-reviewed-id-fixture-'));
  const result = spawnSync(
    'python3',
    [helperPath, 'materialize-stage', root, original.releaseId],
    { cwd: projectRoot, encoding: 'utf8', input: canonicalJson(tampered) },
  );
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(existsSync(join(root, 'stage')), false);
});

test('promotion rejects unexpected target inventory before changing any live leaf', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-inventory-fixture-'));
  const stage = spawnSync(
    'python3',
    [helperPath, 'materialize-stage', root, transport.releaseId],
    { cwd: projectRoot, encoding: 'utf8', input: canonicalJson(transport) },
  );
  assert.equal(stage.status, 0, stage.stderr || stage.stdout);
  writeFixturePath(root, 'public_html/apps/shared/logo.png', 'old logo\n');
  writeFixturePath(root, 'public_html/apps/shared/motion.js', 'old motion\n');
  writeFixturePath(root, 'public_html/apps/shared/shell.js', 'old shell\n');
  writeFixturePath(root, 'public_html/apps/shared/styles.css', 'old styles\n');
  writeFixturePath(root, 'public_html/apps/shared/unexpected.txt', 'must survive\n');
  writeFixturePath(root, 'public_html/index.php', 'wordpress unchanged\n');
  const result = spawnSync(
    'python3',
    [helperPath, 'promote-next', root, transport.releaseId],
    { cwd: projectRoot, encoding: 'utf8', input: canonicalJson(transport) },
  );
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(readFileSync(join(root, 'public_html/apps/shared/unexpected.txt'), 'utf8'), 'must survive\n');
  assert.equal(readFileSync(join(root, 'public_html/index.php'), 'utf8'), 'wordpress unchanged\n');
  assert.equal(existsSync(join(root, 'rollback')), false);
});
