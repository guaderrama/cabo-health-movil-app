import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, readdirSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
const promoteTargets = Object.freeze([
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
const hostingOverlayBytes = new Map([
  ['app/.htaccess', Buffer.from(
    "Options -Indexes\n<IfModule mod_headers.c>\n  Header always set Content-Type \"text/html; charset=utf-8\"\n  Header always set Content-Security-Policy \"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\"\n  Header always set X-Content-Type-Options \"nosniff\"\n  Header always set X-Frame-Options \"DENY\"\n  Header always set Referrer-Policy \"no-referrer\"\n  Header always set Permissions-Policy \"camera=(), microphone=(), geolocation=(), payment=(), usb=()\"\n  Header always unset Set-Cookie\n</IfModule>\n<IfModule mod_mime.c>\n  AddDefaultCharset UTF-8\n</IfModule>\n",
  )],
  ['.well-known/.htaccess', Buffer.from(
    'Options -Indexes\n<Files "apple-app-site-association">\n  ForceType application/json\n  <IfModule mod_headers.c>\n    Header always set Content-Type "application/json"\n    Header always set X-Content-Type-Options "nosniff"\n    Header always unset Set-Cookie\n  </IfModule>\n</Files>\n',
  )],
  ...['apps/clinic-guide/.htaccess', 'apps/healthy-recipes/.htaccess', 'apps/shared/.htaccess'].map((path) => [
    path,
    Buffer.from(
      'Options -Indexes\n<FilesMatch "\\.html$">\n  <IfModule mod_headers.c>\n    Header always set Content-Type "text/html; charset=utf-8"\n  </IfModule>\n</FilesMatch>\n<FilesMatch "\\.js$">\n  <IfModule mod_headers.c>\n    Header always set Content-Type "text/javascript; charset=utf-8"\n  </IfModule>\n</FilesMatch>\n<FilesMatch "\\.css$">\n  <IfModule mod_headers.c>\n    Header always set Content-Type "text/css; charset=utf-8"\n  </IfModule>\n</FilesMatch>\n<FilesMatch "\\.png$">\n  <IfModule mod_headers.c>\n    Header always set Content-Type "image/png"\n  </IfModule>\n</FilesMatch>\n',
    ),
  ]),
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function spawnSyncWithPrivateStdin(command, args, options, input, temporaryParent = fixtureTmp) {
  const privateRoot = mkdtempSync(join(temporaryParent, 'cabohealth-private-stdin-'));
  const inputPath = join(privateRoot, 'stdin');
  let inputFd;
  let cleanupError;
  try {
    chmodSync(privateRoot, 0o700);
    writeFileSync(inputPath, input, { flag: 'wx', mode: 0o600 });
    chmodSync(inputPath, 0o600);
    inputFd = openSync(inputPath, 'r');
    unlinkSync(inputPath);
    return spawnSync(command, args, {
      ...options,
      stdio: [inputFd, 'pipe', 'pipe'],
    });
  } finally {
    if (inputFd !== undefined) {
      try {
        closeSync(inputFd);
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      if (existsSync(inputPath)) unlinkSync(inputPath);
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      rmdirSync(privateRoot);
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }
}

function pendingBuild8AgeRating() {
  return {
    host: {
      value: 16,
      legacyOperatingSystemsValue: 17,
      unrestrictedWebAccess: true,
      previousSavedValue: 9,
      status: 'projected-pending-app-store-recalculation',
    },
    miniapps: {
      'healthy-recipes': { value: 9, status: 'verified' },
      'clinic-guide': { value: 9, status: 'verified' },
    },
    externalCatalogItems: {
      fixedAgeRating: null,
      suitabilityReviewRequiredBeforeActivation: true,
    },
  };
}

function verifiedBuild8AgeRating() {
  return {
    host: {
      value: 16,
      legacyOperatingSystemsValue: 17,
      unrestrictedWebAccess: true,
      previousSavedValue: 9,
      status: 'verified',
    },
    miniapps: {
      'healthy-recipes': { value: 9, status: 'verified' },
      'clinic-guide': { value: 9, status: 'verified' },
    },
    externalCatalogItems: {
      fixedAgeRating: null,
      suitabilityReviewRequiredBeforeActivation: true,
    },
  };
}

function fixtureTransport() {
  const files = payloadPaths.map((path) => {
    const bytes = Buffer.from(`fixture:${path}\n`, 'utf8');
    const extension = path.split('.').at(-1);
    const mediaType = path.endsWith('apple-app-site-association')
      ? 'application/json'
      : ({ html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png' }[extension] ?? 'text/plain; charset=utf-8');
    const kind = path === 'app/index.html' ? 'marketing-landing' : path.startsWith('apps/')
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
  const result = spawnSync('python3', [helperPath, 'materialize-stage', root, transport.releaseId], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
  });
  return { result, root, transport };
}

function fixtureArtifactManifest(transport) {
  const inputs = [
    'miniapps/dist',
    'web-hosting/cabohealth.org/app/index.html',
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
      : path === 'web-hosting/cabohealth.org/app/index.html' ? 'marketing-landing'
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

function hostingOverlayFixture() {
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-hosting-overlay-fixture-'));
  mkdirSync(join(root, 'public_html'), { mode: 0o755 });
  mkdirSync(join(root, 'public_html/app'), { mode: 0o755 });
  mkdirSync(join(root, 'public_html/.well-known'), { mode: 0o755 });
  mkdirSync(join(root, 'public_html/apps/clinic-guide'), { recursive: true, mode: 0o755 });
  mkdirSync(join(root, 'public_html/apps/healthy-recipes'), { mode: 0o755 });
  mkdirSync(join(root, 'public_html/apps/shared'), { mode: 0o755 });
  writeFileSync(join(root, 'public_html/index.php'), 'wordpress-control\n', { flag: 'wx', mode: 0o644 });
  const rootInfo = statSync(root);
  return {
    root,
    env: {
      ...process.env,
      CABOHEALTH_EXPECTED_ROOT_ID: `${rootInfo.dev}:${rootInfo.ino}`,
    },
  };
}

test('private Python stdin is an unlinked mode-0600 regular file with exact large payload bytes', () => {
  const contractParent = mkdtempSync(join(fixtureTmp, 'cabohealth-private-stdin-contract-'));
  chmodSync(contractParent, 0o700);
  const payload = Buffer.alloc(815_959);
  for (let index = 0; index < payload.byteLength; index += 1) payload[index] = index % 251;
  const childScript = [
    'import json, os, stat, sys',
    'info = os.fstat(0)',
    'payload = sys.stdin.buffer.read()',
    'os.write(1, payload)',
    "sys.stderr.write(json.dumps({'regular': stat.S_ISREG(info.st_mode), 'mode': format(stat.S_IMODE(info.st_mode), '04o'), 'nlink': info.st_nlink}))",
  ].join('\n');

  try {
    const result = spawnSyncWithPrivateStdin(
      'python3',
      ['-c', childScript],
      { cwd: projectRoot, encoding: null, maxBuffer: 2 * 1024 * 1024 },
      payload,
      contractParent,
    );
    assert.equal(result.status, 0, result.stderr?.toString('utf8') || result.stdout?.toString('utf8'));
    assert.deepEqual(result.stdout, payload);
    assert.deepEqual(JSON.parse(result.stderr.toString('utf8')), {
      regular: true,
      mode: '0600',
      nlink: 0,
    });
    assert.deepEqual(readdirSync(contractParent), []);
  } finally {
    rmSync(contractParent, { recursive: true });
  }
});

test('hosting header overlays publish exact recoverable policies without replacing public files', () => {
  const { root, env } = hostingOverlayFixture();
  const controlBefore = readFileSync(join(root, 'public_html/index.php'));

  const publish = spawnSync('python3', [helperPath, 'publish-hosting-overlays', root], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
  });
  assert.equal(publish.status, 0, publish.stderr || publish.stdout);
  assert.deepEqual(JSON.parse(publish.stdout), {
    schemaVersion: 1,
    status: 'published',
    overlayCount: hostingOverlayBytes.size,
  });
  for (const [path, bytes] of hostingOverlayBytes) {
    assert.deepEqual(
      readFileSync(join(projectRoot, 'web-hosting/cabohealth.org', path)),
      bytes,
    );
    const publicPath = join(root, 'public_html', path);
    assert.deepEqual(readFileSync(publicPath), bytes);
    assert.equal(statSync(publicPath).mode & 0o777, 0o644);
    assert.equal(statSync(publicPath).nlink, 2);
  }
  assert.deepEqual(readFileSync(join(root, 'public_html/index.php')), controlBefore);

  const idempotent = spawnSync('python3', [helperPath, 'publish-hosting-overlays', root], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
  });
  assert.equal(idempotent.status, 0, idempotent.stderr || idempotent.stdout);
  assert.equal(JSON.parse(idempotent.stdout).status, 'verified-existing');

  const rollback = spawnSync('python3', [helperPath, 'rollback-hosting-overlays', root], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
  });
  assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout);
  assert.deepEqual(JSON.parse(rollback.stdout), {
    schemaVersion: 1,
    status: 'rolled-back',
    overlayCount: hostingOverlayBytes.size,
  });
  for (const path of hostingOverlayBytes.keys()) {
    assert.equal(existsSync(join(root, 'public_html', path)), false);
  }
  assert.deepEqual(readFileSync(join(root, 'public_html/index.php')), controlBefore);

  const repeatedRollback = spawnSync('python3', [helperPath, 'rollback-hosting-overlays', root], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
  });
  assert.equal(repeatedRollback.status, 0, repeatedRollback.stderr || repeatedRollback.stdout);
  assert.equal(JSON.parse(repeatedRollback.stdout).status, 'rolled-back');
});

test('hosting header overlays fail closed on existing, tampered, symlinked, or identity-mismatched files', async (context) => {
  await context.test('different existing public file is preserved', () => {
    const { root, env } = hostingOverlayFixture();
    const publicPath = join(root, 'public_html/app/.htaccess');
    writeFileSync(publicPath, 'existing-policy\n', { flag: 'wx', mode: 0o644 });
    const result = spawnSync('python3', [helperPath, 'publish-hosting-overlays', root], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(readFileSync(publicPath, 'utf8'), 'existing-policy\n');
  });

  await context.test('a conflicting second overlay prevents every public write', () => {
    const { root, env } = hostingOverlayFixture();
    const conflict = join(root, 'public_html/.well-known/.htaccess');
    writeFileSync(conflict, 'existing-policy\n', { flag: 'wx', mode: 0o644 });
    const result = spawnSync('python3', [helperPath, 'publish-hosting-overlays', root], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, 'public_html/app/.htaccess')), false);
    assert.equal(readFileSync(conflict, 'utf8'), 'existing-policy\n');
  });

  await context.test('tampered private candidate is rejected before publication', () => {
    const { root, env } = hostingOverlayFixture();
    const privateRoot = join(root, '.cabohealth-private/hosting-overlays-v1');
    mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(privateRoot, 'app-htaccess'), 'tampered\n', { flag: 'wx', mode: 0o644 });
    const result = spawnSync('python3', [helperPath, 'publish-hosting-overlays', root], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, 'public_html/app/.htaccess')), false);
  });

  await context.test('public symlink is rejected without following it', () => {
    const { root, env } = hostingOverlayFixture();
    const control = join(root, 'public_html/index.php');
    symlinkSync('../index.php', join(root, 'public_html/app/.htaccess'));
    const result = spawnSync('python3', [helperPath, 'publish-hosting-overlays', root], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(readFileSync(control, 'utf8'), 'wordpress-control\n');
  });

  await context.test('rollback preserves an exact-looking file with the wrong identity', () => {
    const { root, env } = hostingOverlayFixture();
    const publish = spawnSync('python3', [helperPath, 'publish-hosting-overlays', root], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(publish.status, 0, publish.stderr || publish.stdout);
    const publicPath = join(root, 'public_html/app/.htaccess');
    unlinkSync(publicPath);
    writeFileSync(publicPath, hostingOverlayBytes.get('app/.htaccess'), { flag: 'wx', mode: 0o644 });
    const result = spawnSync('python3', [helperPath, 'rollback-hosting-overlays', root], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.deepEqual(readFileSync(publicPath), hostingOverlayBytes.get('app/.htaccess'));
  });
});

test('server inventory requires exact independently attested hosting overlays', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-hosting-overlay-inventory-'));
  const invoke = (command, args = [], input = '') => spawnSync(
    'python3',
    [helperPath, command, root, ...args],
    { cwd: projectRoot, encoding: 'utf8', input },
  );
  const encodedTransport = canonicalJson(transport);
  const materialize = invoke('materialize-stage', [transport.releaseId], encodedTransport);
  assert.equal(materialize.status, 0, materialize.stderr || materialize.stdout);
  mkdirSync(join(root, 'public_html'), { mode: 0o755 });
  for (let index = 0; index < promoteTargets.length; index += 1) {
    const promoted = invoke('promote-next', [transport.releaseId], encodedTransport);
    assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
  }

  const missing = invoke('inventory-live', [transport.releaseId], encodedTransport);
  assert.equal(missing.status, 1, missing.stderr || missing.stdout);
  assert.match(missing.stderr, /HOSTING_OVERLAY/u);

  const published = invoke('publish-hosting-overlays');
  assert.equal(published.status, 0, published.stderr || published.stdout);
  const verified = invoke('inventory-live', [transport.releaseId], encodedTransport);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.equal(JSON.parse(verified.stdout).fileCount, payloadPaths.length);

  writeFileSync(join(root, 'public_html/app/.htaccess'), 'tampered\n');
  const tampered = invoke('inventory-live', [transport.releaseId], encodedTransport);
  assert.equal(tampered.status, 1, tampered.stderr || tampered.stdout);
  assert.match(tampered.stderr, /HOSTING_OVERLAY/u);
});

test('the real assembler validates the saved age and release-ready compliance without writing in check mode', () => {
  const artifactPath = join(projectRoot, 'release/web-artifacts.json');
  const productionEvidencePath = join(projectRoot, 'release/production-urls.json');
  const bundleRoot = join(projectRoot, 'release/web-bundles');
  const artifactBefore = existsSync(artifactPath) ? readFileSync(artifactPath) : null;
  const productionEvidenceBefore = existsSync(productionEvidencePath)
    ? readFileSync(productionEvidencePath)
    : null;
  const bundlesBefore = existsSync(bundleRoot) ? readdirSync(bundleRoot).sort() : null;
  const result = spawnSync(process.execPath, [assemblerPath, '--check'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /Checked web-v1-/u);
  assert.deepEqual(existsSync(artifactPath) ? readFileSync(artifactPath) : null, artifactBefore);
  assert.deepEqual(
    existsSync(productionEvidencePath) ? readFileSync(productionEvidencePath) : null,
    productionEvidenceBefore,
  );
  assert.deepEqual(existsSync(bundleRoot) ? readdirSync(bundleRoot).sort() : null, bundlesBefore);
});

test('the real assembler binds materialization to the independently reviewed deployment-readiness record', async () => {
  const artifactPath = join(projectRoot, 'release/web-artifacts.json');
  const candidateArtifactPath = join(
    projectRoot,
    'release/web-artifacts.web-v1-40869f4a540a56c420b198aea0fdf58a21053646d280d89ad64d105fd1808948.json',
  );
  const priorCandidateArtifactPath = join(
    projectRoot,
    'release/web-artifacts.web-v1-623fafeb169001829dd63cf701b5eba59f40a487eb71b11521a9d1a9f578c693.json',
  );
  const predecessorArtifactPath = join(
    projectRoot,
    'release/web-artifacts.web-v1-4a3e199b57be00b563dcf4d8e4d6f278b09872705981a0b39aad6a3a80b0f11b.json',
  );
  const bundleRoot = join(projectRoot, 'release/web-bundles');
  const readinessBytes = readFileSync(join(projectRoot, 'release/web-deployment-readiness.json'));
  const {
    WEB_DEPLOYMENT_READINESS_SHA256,
    assertWebDeploymentReadiness,
  } = await import('../scripts/assemble-web-release.mjs');
  assert.equal(sha256(readinessBytes), WEB_DEPLOYMENT_READINESS_SHA256);
  assert.deepEqual(JSON.parse(readinessBytes), {
    schemaVersion: 2,
    artifactKind: 'cabohealth-web-deployment-readiness-v2',
    status: 'ready',
    reviewedAt: '2026-11-08',
    reviewedInputs: {
      miniappCapsuleSha256: 'b569107971f2db55f900e595e08e4d9a8daa54ef4588850424d60a9a8c089929',
      privacySha256: '560f781d4e1d2b6bd65797aaa27dc499b1f74954f548507da78053887ac6c125',
      marketingSha256: '192879c4588af7fe1af07b91c908acc6f017b766e0b61a4108b27eb718ca1532',
      aasaSha256: 'e721827da1fe77d4a34247c9c2c515db73614545c6fb20e03f52b25e8594beae',
    },
    scope: {
      localAssemblyAuthorized: true,
      publicPromotionAuthorized: false,
      deployed: false,
      appleReady: false,
    },
  });
  assert.equal(assertWebDeploymentReadiness(new Map([
    ['release/web-deployment-readiness.json', readinessBytes],
  ])), true);
  assert.equal(
    JSON.parse(readFileSync(candidateArtifactPath, 'utf8')).releaseId,
    'web-v1-40869f4a540a56c420b198aea0fdf58a21053646d280d89ad64d105fd1808948',
  );
  assert.equal(
    JSON.parse(readFileSync(priorCandidateArtifactPath, 'utf8')).releaseId,
    'web-v1-623fafeb169001829dd63cf701b5eba59f40a487eb71b11521a9d1a9f578c693',
  );
  assert.equal(
    JSON.parse(readFileSync(predecessorArtifactPath, 'utf8')).releaseId,
    'web-v1-4a3e199b57be00b563dcf4d8e4d6f278b09872705981a0b39aad6a3a80b0f11b',
  );
  assert.equal(sha256(readFileSync(predecessorArtifactPath)), '79699e2a0b82ea24d8861cad67e7ee252320aec3777693a0c374a90312c7b943');
  assert.deepEqual(readFileSync(candidateArtifactPath), readFileSync(artifactPath));
  const artifactBefore = existsSync(artifactPath) ? readFileSync(artifactPath) : null;
  const bundlesBefore = existsSync(bundleRoot) ? readdirSync(bundleRoot).sort() : null;
  const result = spawnSync(process.execPath, [assemblerPath, '--check'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /Checked web-v1-b478ccac592d05398b3be31ec26f5a34b3cbe61e44fd97d29ceb4d4e85e622d9/u);
  assert.deepEqual(readFileSync(artifactPath), artifactBefore);
  assert.deepEqual(existsSync(bundleRoot) ? readdirSync(bundleRoot).sort() : null, bundlesBefore);
});

test('descriptor-relative staging creates the exact private 17-file tree', () => {
  const { result, root, transport } = materializeFixture();
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const bundleRoot = join(root, 'stage', transport.releaseId, 'public_html');
  for (const entry of transport.files) {
    const path = join(bundleRoot, entry.path);
    assert.deepEqual(readFileSync(path), Buffer.from(entry.bytesBase64, 'base64'));
    assert.equal(statSync(path).mode & 0o777, 0o644);
  }
  assert.equal(statSync(bundleRoot).mode & 0o777, 0o700);
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
    'web-hosting/cabohealth.org/app/index.html',
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

test('remote materialization foundation creates only the ten fixed promotion leaves in a private local stage', () => {
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

test('atomic local promotion and rollback change only the ten leaves and restore present and absent targets', () => {
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
    ['public_html/apps/shared/clinic-map-texture.png', Buffer.from('old map texture\n')],
    ['public_html/apps/shared/logo-wordmark.png', Buffer.from('old wordmark\n')],
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

  for (let index = promoteTargets.length - 1; index >= 0; index -= 1) {
    const rollbackResult = spawnSync(
      'python3',
      [helperPath, 'rollback-next', root, transport.releaseId, String(index)],
      { cwd: projectRoot, encoding: 'utf8', input: canonicalJson(transport) },
    );
    assert.equal(rollbackResult.status, 0, rollbackResult.stderr || rollbackResult.stdout);
    assert.equal(JSON.parse(rollbackResult.stdout).index, index);
  }
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

test('materialize-release rejects pending and coordinated compliance/legal/AASA/header authority before its first inode creation', async (context) => {
  const { createWebReleaseTransport } = await import('../scripts/assemble-web-release.mjs');
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-authoritative-release-fixture-'));
  mkdirSync(join(root, 'release'));
  copyFileSync(join(projectRoot, 'release/compliance-facts.json'), join(root, 'release/compliance-facts.json'));
  const pendingFactsPath = join(root, 'release/compliance-facts.json');
  const pendingFacts = JSON.parse(readFileSync(pendingFactsPath, 'utf8'));
  pendingFacts.releaseReady = false;
  pendingFacts.ageRating = pendingBuild8AgeRating();
  writeFileSync(pendingFactsPath, canonicalJson(pendingFacts));
  const inputPaths = [
    'web-hosting/cabohealth.org/app/index.html',
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
  const envelope = () => {
    const outputs = new Map([
      ['.well-known/apple-app-site-association', readFileSync(join(root, 'web-hosting/cabohealth.org/.well-known/apple-app-site-association'))],
      ['app/index.html', readFileSync(join(root, 'web-hosting/cabohealth.org/app/index.html'))],
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
    return { transport, manifest };
  };
  const publish = (candidate) => spawnSyncWithPrivateStdin(
    'python3',
    [helperPath, 'materialize-release', root],
    { cwd: projectRoot, encoding: 'utf8' },
    canonicalJson(candidate),
  );

  const pending = publish(envelope());
  assert.equal(pending.status, 1, pending.stderr || pending.stdout);
  assert.match(pending.stderr, /COMPLIANCE_FACTS_INCOMPLETE/u);
  assert.equal(existsSync(join(root, 'release/web-bundles')), false);
  assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);

  const factsPath = pendingFactsPath;
  const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
  facts.releaseReady = true;
  facts.legalEntity.legalSignOffStatus = 'approved';
  facts.hosting.logTypes = { value: ['access-log'], status: 'verified' };
  facts.hosting.retention = { value: { description: 'reviewed retention' }, status: 'verified' };
  facts.hosting.deletionProcess = { value: { description: 'reviewed deletion' }, status: 'verified' };
  facts.support.responseSla = { value: { description: 'reviewed response policy' }, status: 'verified' };
  facts.contentRights = { value: { approved: true, scope: 'reviewed scope' }, status: 'verified' };
  facts.exportCompliance = { value: { approved: true, determination: 'reviewed determination' }, status: 'verified' };
  facts.medicalDevice = { value: { basis: 'reviewed basis', isMedicalDevice: false }, status: 'verified' };
  facts.ageRating = verifiedBuild8AgeRating();
  writeFileSync(factsPath, canonicalJson(facts));

  const verifiedFacts = structuredClone(facts);
  const invalidAgeAuthorities = [
    {
      name: 'a missing previous saved age key is rejected before any release output',
      mutate(ageRating) { delete ageRating.host.previousSavedValue; },
      error: /COMPLIANCE_HOST_AGE_RATING_SCHEMA_INVALID/u,
    },
    {
      name: 'an extra age authority key is rejected before any release output',
      mutate(ageRating) { ageRating.unreviewed = true; },
      error: /COMPLIANCE_AGE_RATING_SCHEMA_INVALID/u,
    },
    {
      name: 'disabled unrestricted web access is rejected before any release output',
      mutate(ageRating) { ageRating.host.unrestrictedWebAccess = false; },
      error: /COMPLIANCE_FACTS_INCOMPLETE/u,
    },
    {
      name: 'a fixed external catalog age is rejected before any release output',
      mutate(ageRating) { ageRating.externalCatalogItems.fixedAgeRating = 16; },
      error: /COMPLIANCE_FACTS_INCOMPLETE/u,
    },
    {
      name: 'a release-ready host without verified status is rejected before any release output',
      mutate(ageRating) { ageRating.host.status = 'projected-pending-app-store-recalculation'; },
      error: /COMPLIANCE_FACTS_INCOMPLETE/u,
    },
  ];
  for (const { name, mutate, error } of invalidAgeAuthorities) {
    await context.test(name, () => {
      const invalidFacts = structuredClone(verifiedFacts);
      mutate(invalidFacts.ageRating);
      writeFileSync(factsPath, canonicalJson(invalidFacts));
      const invalid = publish(envelope());
      assert.equal(invalid.status, 1, invalid.stderr || invalid.stdout);
      assert.match(invalid.stderr, error);
      assert.equal(existsSync(join(root, 'release/web-bundles')), false);
      assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);
    });
  }
  writeFileSync(factsPath, canonicalJson(verifiedFacts));
  for (const slug of ['privacy', 'terms', 'support', 'report-content']) {
    const legalPath = join(root, `web-hosting/cabohealth.org/app/${slug}/index.html`);
    writeFileSync(legalPath, `${readFileSync(legalPath, 'utf8')}<!-- coordinated unreviewed legal mutation -->\n`);
  }
  writeFileSync(
    join(root, 'web-hosting/cabohealth.org/apps/.htaccess'),
    '# coordinated unreviewed security-envelope mutation\n',
  );
  const aasaPath = join(root, 'web-hosting/cabohealth.org/.well-known/apple-app-site-association');
  const coordinatedAasa = JSON.parse(readFileSync(aasaPath, 'utf8'));
  coordinatedAasa.applinks.details[0].components.push({ '/': '/apps/unreviewed-third/' });
  writeFileSync(aasaPath, canonicalJson(coordinatedAasa));
  const coordinated = publish(envelope());
  assert.equal(coordinated.status, 1, coordinated.stderr || coordinated.stdout);
  assert.match(coordinated.stderr, /WEB_RELEASE_AASA_INVALID/u);
  assert.equal(existsSync(join(root, 'release/web-bundles')), false);
  assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);

  const bypass = spawnSyncWithPrivateStdin(
    'python3',
    [helperPath, 'materialize-local', root],
    { cwd: projectRoot, encoding: 'utf8' },
    canonicalJson(envelope().transport),
  );
  assert.equal(bypass.status, 1, bypass.stderr || bypass.stdout);
  assert.equal(existsSync(join(root, 'release/web-bundles')), false);
});

test('post-pin materialization independently reaches legal, canonical AASA, and Apache authority gates', async (context) => {
  const { createWebReleaseTransport } = await import('../scripts/assemble-web-release.mjs');
  const legalSlugs = ['privacy', 'report-content', 'support', 'terms'];
  const inputPaths = [
    'web-hosting/cabohealth.org/app/index.html',
    'web-hosting/cabohealth.org/app/privacy/index.html',
    'web-hosting/cabohealth.org/app/terms/index.html',
    'web-hosting/cabohealth.org/app/support/index.html',
    'web-hosting/cabohealth.org/app/report-content/index.html',
    'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
    'miniapps/shared/security-headers.conf',
    'web-hosting/cabohealth.org/apps/.htaccess',
  ];
  const prepare = () => {
    const root = mkdtempSync(join(fixtureTmp, 'cabohealth-post-pin-fixture-'));
    mkdirSync(join(root, 'release'));
    const facts = JSON.parse(readFileSync(join(projectRoot, 'release/compliance-facts.json'), 'utf8'));
    facts.releaseReady = true;
    facts.legalEntity.legalSignOffStatus = 'approved';
    facts.hosting.logTypes = { value: ['access-log'], status: 'verified' };
    facts.hosting.retention = { value: { description: 'reviewed retention' }, status: 'verified' };
    facts.hosting.deletionProcess = { value: { description: 'reviewed deletion' }, status: 'verified' };
    facts.support.responseSla = { value: { description: 'reviewed response policy' }, status: 'verified' };
    facts.contentRights = { value: { approved: true, scope: 'reviewed scope' }, status: 'verified' };
    facts.exportCompliance = { value: { approved: true, determination: 'reviewed determination' }, status: 'verified' };
    facts.medicalDevice = { value: { basis: 'reviewed basis', isMedicalDevice: false }, status: 'verified' };
    facts.ageRating = verifiedBuild8AgeRating();
    writeFileSync(join(root, 'release/compliance-facts.json'), canonicalJson(facts));
    for (const source of inputPaths) {
      const original = readFileSync(join(projectRoot, source));
      const bytes = source.includes('/app/') && source !== 'web-hosting/cabohealth.org/app/index.html'
        ? Buffer.concat([original, Buffer.from('<!-- independently reviewed final fixture -->\n')])
        : original;
      writeFixturePath(root, source, bytes);
    }
    writeFixturePath(root, 'miniapps/dist', readFileSync(join(projectRoot, 'miniapps/dist')));
    linkSync(join(root, 'miniapps/dist'), join(root, 'miniapps/.dist-review-link'));
    chmodSync(join(root, 'miniapps/dist'), 0o400);
    const legalPins = Object.fromEntries(legalSlugs.map((slug) => [
      slug,
      sha256(readFileSync(join(root, `web-hosting/cabohealth.org/app/${slug}/index.html`))),
    ]));
    const helperSource = readFileSync(helperPath, 'utf8');
    const pinsPattern = /FINAL_LEGAL_SHA256: dict\[str, str \| None\] = \{\n(?:    .*\n){4}\}/u;
    assert.match(helperSource, pinsPattern);
    const patchedHelper = helperSource.replace(
      pinsPattern,
      `FINAL_LEGAL_SHA256: dict[str, str | None] = ${JSON.stringify(legalPins, null, 4)}`,
    );
    const patchedHelperPath = join(root, 'secure_web_release_post_pin.py');
    writeFileSync(patchedHelperPath, patchedHelper, { flag: 'wx' });
    const envelope = () => {
      const capsuleBytes = readFileSync(join(root, 'miniapps/dist'));
      const capsule = JSON.parse(capsuleBytes.toString('utf8'));
      const outputs = new Map([
        ['.well-known/apple-app-site-association', readFileSync(join(root, 'web-hosting/cabohealth.org/.well-known/apple-app-site-association'))],
        ['app/index.html', readFileSync(join(root, 'web-hosting/cabohealth.org/app/index.html'))],
        ...legalSlugs.map((slug) => [
          `app/${slug}/index.html`,
          readFileSync(join(root, `web-hosting/cabohealth.org/app/${slug}/index.html`)),
        ]),
        ...capsule.files.map(({ path, bytesBase64 }) => [path, Buffer.from(bytesBase64, 'base64')]),
      ]);
      const transport = createWebReleaseTransport(outputs);
      const manifest = fixtureArtifactManifest(transport);
      const inputBytes = new Map([
        ['miniapps/dist', capsuleBytes],
        ...inputPaths.map((path) => [path, readFileSync(join(root, path))]),
      ]);
      manifest.inputs = manifest.inputs.map((entry) => ({
        ...entry,
        size: inputBytes.get(entry.path).byteLength,
        sha256: sha256(inputBytes.get(entry.path)),
      }));
      return { transport, manifest };
    };
    const publish = () => spawnSyncWithPrivateStdin(
      'python3',
      [patchedHelperPath, 'materialize-release', root],
      { cwd: projectRoot, encoding: 'utf8' },
      canonicalJson(envelope()),
    );
    return { root, publish, legalPins, patchedHelperPath };
  };

  await context.test('valid publication preserves an immutable release-ID manifest', () => {
    const { root, publish, legalPins, patchedHelperPath } = prepare();
    const readiness = JSON.parse(readFileSync(
      join(projectRoot, 'release/web-deployment-readiness.json'),
      'utf8',
    ));
    readiness.reviewedInputs.privacySha256 = legalPins.privacy;
    const readinessBytes = Buffer.from(canonicalJson(readiness));
    writeFixturePath(
      root,
      'release/web-deployment-readiness.json',
      readinessBytes,
    );
    const helper = readFileSync(patchedHelperPath, 'utf8').replace(
      /WEB_DEPLOYMENT_READINESS_SHA256: str \| None = "[a-f0-9]{64}"/u,
      `WEB_DEPLOYMENT_READINESS_SHA256: str | None = "${sha256(readinessBytes)}"`,
    );
    writeFileSync(patchedHelperPath, helper);
    const result = publish();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const current = readFileSync(join(root, 'release/web-artifacts.json'));
    const releaseId = JSON.parse(current).releaseId;
    const immutablePath = join(root, `release/web-artifacts.${releaseId}.json`);
    assert.deepEqual(readFileSync(immutablePath), current);
    assert.equal(statSync(immutablePath).mode & 0o777, 0o444);
  });

  await context.test('final legal bytes', () => {
    const { root, publish } = prepare();
    const legalPath = join(root, 'web-hosting/cabohealth.org/app/privacy/index.html');
    writeFileSync(legalPath, `${readFileSync(legalPath, 'utf8')}<!-- coordinated post-pin change -->\n`);
    const result = publish();
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /FINAL_LEGAL_PIN_MISMATCH/u);
    assert.equal(existsSync(join(root, 'release/web-bundles')), false);
    assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);
  });

  await context.test('canonical AASA bytes', () => {
    const { root, publish } = prepare();
    const path = join(root, 'web-hosting/cabohealth.org/.well-known/apple-app-site-association');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    value.applinks.details[0].components.push({ '/': '/apps/unreviewed-third/' });
    writeFileSync(path, canonicalJson(value));
    const result = publish();
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /WEB_RELEASE_AASA_INVALID/u);
    assert.equal(existsSync(join(root, 'release/web-bundles')), false);
    assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);
  });

  await context.test('Apache authority bytes', () => {
    const { root, publish } = prepare();
    for (const relativePath of [
      'miniapps/shared/security-headers.conf',
      'web-hosting/cabohealth.org/apps/.htaccess',
    ]) {
      const path = join(root, relativePath);
      writeFileSync(path, `${readFileSync(path, 'utf8')}# coordinated post-pin change\n`);
    }
    const result = publish();
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /WEB_RELEASE_APACHE_SECURITY_MISMATCH/u);
    assert.equal(existsSync(join(root, 'release/web-bundles')), false);
    assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);
  });
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
      const result = spawnSync('python3', [helperPath, 'materialize-stage', root, value.releaseId], {
        cwd: projectRoot,
        encoding: 'utf8',
        input: canonicalJson(value),
      });
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.equal(existsSync(join(root, 'stage')), false);
      assert.equal(readFileSync(join(root, 'release/sentinel.txt'), 'utf8'), 'unchanged\n');
    });
  }
});

test('pre-existing partial final directory is quarantined in place without replacement or cleanup', () => {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-web-partial-fixture-'));
  mkdirSync(join(root, 'stage'), { mode: 0o700 });
  mkdirSync(join(root, 'stage', transport.releaseId), { mode: 0o700 });
  mkdirSync(join(root, 'stage', transport.releaseId, 'public_html'), { mode: 0o700 });
  writeFileSync(join(root, 'stage', transport.releaseId, 'public_html/sentinel.txt'), 'partial\n', { flag: 'wx' });
  const result = spawnSync('python3', [helperPath, 'materialize-stage', root, transport.releaseId], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
  });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(readFileSync(join(root, 'stage', transport.releaseId, 'public_html/sentinel.txt'), 'utf8'), 'partial\n');
  assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html/.well-known')), false);
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
  assert.equal(existsSync(join(root, 'rollback', transport.releaseId, 'transitions/operation.lock')), true);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
});
