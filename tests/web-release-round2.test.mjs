import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const helperPath = join(projectRoot, 'scripts/secure_web_release.py');
const fixtureTmp = realpathSync(tmpdir());
const paths = Object.freeze([
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
const targets = Object.freeze([
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
const slots = Object.freeze([
  '00-apps-htaccess',
  '01-apps-shared',
  '02-app-privacy',
  '03-app-terms',
  '04-app-support',
  '05-app-report-content',
  '06-apps-healthy-recipes',
  '07-apps-clinic-guide',
  '08-aasa',
]);
const inputPolicy = Object.freeze([
  ['miniapps/dist', 'task6b-miniapp'],
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

function mediaType(path) {
  if (path.endsWith('apple-app-site-association')) return 'application/json';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'text/plain; charset=utf-8';
}

function kind(path) {
  if (path === 'apps/.htaccess') return 'apache-security';
  if (path.startsWith('apps/')) return 'task6b-miniapp';
  if (path.startsWith('app/')) return 'task7-legal';
  return 'aasa';
}

function fixtureTransport() {
  const files = paths.map((path) => {
    const bytes = Buffer.from(`round2:${path}\n`);
    return {
      path,
      size: bytes.length,
      sha256: sha256(bytes),
      mediaType: mediaType(path),
      deployMode: '0644',
      kind: kind(path),
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
  const inventorySha256 = sha256(Buffer.from(canonicalJson(policy)));
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
    appId: transport.appId,
    entrySlugs: [...transport.entrySlugs],
    legalSlugs: [...transport.legalSlugs],
    promoteTargets: [...transport.promoteTargets],
    inputs: inputPolicy.map(([path, inputKind], index) => ({
      path,
      size: index + 11,
      sha256: sha256(Buffer.from(`fabricated-input:${index}`)),
      kind: inputKind,
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
  let directory = root;
  for (const component of components.slice(0, -1)) {
    directory = join(directory, component);
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o755 });
  }
  writeFileSync(join(directory, components.at(-1)), bytes, { flag: 'wx', mode });
}

function setupPromotion(original = 'present') {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, `cabohealth-round2-${original}-fixture-`));
  assert.equal(runHelper(root, 'materialize-stage', transport, [transport.releaseId]).status, 0);
  mkdirSync(join(root, 'public_html'), { mode: 0o755 });
  if (original === 'present') writePath(root, 'public_html/apps/.htaccess', 'old htaccess\n');
  return { root, transport };
}

function expectedNew(transport, path = 'apps/.htaccess') {
  return Buffer.from(transport.files.find((entry) => entry.path === path).bytesBase64, 'base64');
}

test('post-namespace promotion failures reverse OSError, UnicodeError, RuntimeError, and directory-fsync failures', async (context) => {
  const cases = [
    ['present-oserror', 'present', 'promotion-post-exchange-oserror'],
    ['present-unicode', 'present', 'promotion-post-exchange-unicode'],
    ['present-runtime', 'present', 'promotion-post-exchange-runtime'],
    ['present-fsync', 'present', 'promotion-post-exchange-fsync-oserror'],
    ['absent-oserror', 'absent', 'promotion-post-noreplace-oserror'],
    ['absent-unicode', 'absent', 'promotion-post-noreplace-unicode'],
    ['absent-runtime', 'absent', 'promotion-post-noreplace-runtime'],
    ['absent-fsync', 'absent', 'promotion-post-noreplace-fsync-oserror'],
  ];
  for (const [name, original, fault] of cases) {
    await context.test(name, () => {
      const { root, transport } = setupPromotion(original);
      const old = original === 'present' ? readFileSync(join(root, 'public_html/apps/.htaccess')) : null;
      const result = runHelper(root, 'promote-next', transport, [transport.releaseId], {
        CABOHEALTH_TEST_FAULT: fault,
      });
      assert.equal(result.status, 1, result.stderr || result.stdout);
      if (old) assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), old);
      else assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
      assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess')), true);
    });
  }
});

test('post-exchange rollback failures and syscall-boundary tamper never leave the unverified operand live', async (context) => {
  for (const fault of [
    'rollback-post-exchange-oserror',
    'rollback-post-exchange-unicode',
    'rollback-post-exchange-runtime',
    'rollback-post-exchange-fsync-oserror',
    'rollback-post-exchange-tamper',
    'rollback-post-exchange-oserror-reversal-fsync-oserror',
  ]) {
    await context.test(fault, () => {
      const { root, transport } = setupPromotion('present');
      assert.equal(runHelper(root, 'promote-next', transport, [transport.releaseId]).status, 0);
      const reviewedNew = expectedNew(transport);
      const result = runHelper(root, 'rollback-local', transport, [transport.releaseId], {
        CABOHEALTH_TEST_FAULT: fault,
      });
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedNew);
      if (fault.includes('reversal')) {
        assert.match(result.stderr, /PRIMARY=.*OSError/u);
        assert.match(result.stderr, /REVERSAL=.*OSError/u);
      }
    });
  }
});

test('rollback reconciles every promotion crash window from durable intent without losing later stage units', async (context) => {
  for (const original of ['present', 'absent']) {
    for (const fault of [
      'promote-crash-after-namespace',
      'promote-crash-after-directory-fsync',
      'promote-crash-transition-partial',
      'promote-crash-after-transition-fsync',
      'promote-crash-before-return',
    ]) {
      await context.test(`${original}-${fault}`, () => {
        const { root, transport } = setupPromotion(original);
        const old = original === 'present' ? readFileSync(join(root, 'public_html/apps/.htaccess')) : null;
        const crashed = runHelper(root, 'promote-next', transport, [transport.releaseId], {
          CABOHEALTH_TEST_FAULT: fault,
        });
        assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
        const rolledBack = runHelper(root, 'rollback-local', transport, [transport.releaseId]);
        assert.equal(rolledBack.status, 0, rolledBack.stderr || rolledBack.stdout);
        if (old) assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), old);
        else assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
        assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html/apps/shared')), true);
      });
    }
  }
});

test('rollback resumes every rollback crash window idempotently for present and absent originals', async (context) => {
  for (const original of ['present', 'absent']) {
    for (const fault of [
      'rollback-crash-after-namespace',
      'rollback-crash-after-directory-fsync',
      'rollback-crash-transition-partial',
      'rollback-crash-after-transition-fsync',
      'rollback-crash-before-return',
    ]) {
      await context.test(`${original}-${fault}`, () => {
        const { root, transport } = setupPromotion(original);
        const old = original === 'present' ? readFileSync(join(root, 'public_html/apps/.htaccess')) : null;
        assert.equal(runHelper(root, 'promote-next', transport, [transport.releaseId]).status, 0);
        const crashed = runHelper(root, 'rollback-local', transport, [transport.releaseId], {
          CABOHEALTH_TEST_FAULT: fault,
        });
        assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
        const resumed = runHelper(root, 'rollback-local', transport, [transport.releaseId]);
        assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
        if (old) assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), old);
        else assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
        assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html/apps/shared')), true);
      });
    }
  }
});

test('canonical out-of-order promoted transition is rejected before the next live mutation', () => {
  const { root, transport } = setupPromotion('absent');
  assert.equal(runHelper(root, 'promote-next', transport, [transport.releaseId]).status, 0);
  const transitionDirectory = join(root, 'rollback', transport.releaseId, 'transitions');
  if (!existsSync(transitionDirectory)) mkdirSync(transitionDirectory, { mode: 0o700 });
  const record = {
    schemaVersion: 1,
    index: 8,
    target: targets[8],
    slot: slots[8],
    original: 'absent',
    oldInventorySha256: null,
    transition: 'promoted',
    attempt: 0,
  };
  writeFileSync(join(transitionDirectory, '08-promoted-000.json'), canonicalJson(record), {
    flag: 'wx',
    mode: 0o600,
  });
  const result = runHelper(root, 'promote-next', transport, [transport.releaseId]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
});

test('descriptor server inventory rejects an extra apps sibling and binds its exact digest to artifact authority', async () => {
  const { validateServerInventoryEvidence } = await import('../scripts/verify-production.mjs');
  const { root, transport } = setupPromotion('absent');
  for (let index = 0; index < targets.length; index += 1) {
    const result = runHelper(root, 'promote-next', transport, [transport.releaseId]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  mkdirSync(join(root, 'public_html/apps/unreviewed-third-sibling'), { mode: 0o755 });
  const inventory = runHelper(root, 'inventory-live', transport, [transport.releaseId]);
  assert.equal(inventory.status, 1, inventory.stderr || inventory.stdout);

  const artifact = fixtureArtifact(transport);
  const authority = {
    reviewedReleaseId: artifact.releaseId,
    reviewedArtifactSha256: sha256(Buffer.from(canonicalJson(artifact))),
  };
  assert.throws(() => validateServerInventoryEvidence({
    status: 'verified',
    rootCount: 3,
    fileCount: 8,
    inventorySha256: 'a'.repeat(64),
  }, artifact, authority), /SERVER_INVENTORY/u);
});

test('browser evidence rejects free-standing booleans and stale or cross-release measurements', async () => {
  const { validateBrowserEvidence } = await import('../scripts/verify-production.mjs');
  const artifact = fixtureArtifact();
  const authority = {
    reviewedReleaseId: artifact.releaseId,
    reviewedArtifactSha256: sha256(Buffer.from(canonicalJson(artifact))),
  };
  const handAuthored = {
    status: 'verified', viewportCount: 2, localeCount: 2, javascriptModeCount: 2,
    unexpectedRequests: 0, consoleErrors: 0, noJsReadable: true,
  };
  assert.throws(() => validateBrowserEvidence(handAuthored, artifact, authority), /BROWSER_EVIDENCE/u);
});

test('reviewed browser measurement executes an exact artifact-bound WebDriver matrix', async () => {
  const { measureBrowserEvidence, validateBrowserEvidence } = await import('../scripts/verify-production.mjs');
  assert.equal(typeof measureBrowserEvidence, 'function');
  const artifact = fixtureArtifact();
  const authority = {
    reviewedReleaseId: artifact.releaseId,
    reviewedArtifactSha256: sha256(Buffer.from(canonicalJson(artifact))),
  };
  const sessions = new Map();
  let nextSession = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const sessionMatch = /^\/session\/([^/]+)(?:\/(.*))?$/u.exec(request.url ?? '');
    let value = null;
    if (request.method === 'POST' && request.url === '/session') {
      const sessionId = `session-${nextSession++}`;
      sessions.set(sessionId, { url: null, capabilities: body.capabilities.alwaysMatch });
      value = { sessionId, capabilities: {} };
    } else if (sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      const command = sessionMatch[2] ?? '';
      if (request.method === 'POST' && command === 'url') session.url = body.url;
      else if (request.method === 'POST' && command === 'execute/sync') {
        value = {
          documentUrl: session.url,
          readyState: 'complete',
          bodyTextLength: 120,
          canonicalHref: session.url,
          unexpectedRequestCount: 0,
          miniappReady: true,
        };
      } else if (request.method === 'POST' && command === 'log') value = [];
      else if (request.method === 'DELETE' && command === '') sessions.delete(sessionMatch[1]);
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ value }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const address = server.address();
    const evidence = await measureBrowserEvidence({
      artifact,
      ...authority,
      baseUrl: 'https://cabohealth.org/',
      webdriverUrl: `http://127.0.0.1:${address.port}/`,
      productionConfirmation: 'cabohealth.org',
      checkedAt: '2026-08-18T02:03:04.000Z',
      nonce: Buffer.alloc(16, 7),
    });
    assert.equal(validateBrowserEvidence(evidence, artifact, authority), true);
    assert.equal(evidence.observations.length, 48);
    const stale = structuredClone(evidence);
    stale.releaseId = `web-v1-${'0'.repeat(64)}`;
    assert.throws(() => validateBrowserEvidence(stale, artifact, authority), /BROWSER_EVIDENCE/u);
    const fabricated = structuredClone(evidence);
    fabricated.observations[0].bodyTextLength = 0;
    assert.throws(() => validateBrowserEvidence(fabricated, artifact, authority), /BROWSER_EVIDENCE/u);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('direct manifest helper rejects fabricated provenance even with a recomputed caller hash', () => {
  const transport = fixtureTransport();
  const artifact = fixtureArtifact(transport);
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-provenance-fixture-'));
  mkdirSync(join(root, 'release'));
  assert.equal(runHelper(root, 'materialize-local', transport).status, 0);
  const manifestHash = sha256(Buffer.from(canonicalJson(artifact)));
  const result = spawnSync(
    'python3',
    [helperPath, 'publish-manifest-local', root, manifestHash],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      input: canonicalJson({ transport, manifest: artifact }),
    },
  );
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);
});

test('bound assembly snapshot ignores a transient root exchange and returns original descriptor bytes', async () => {
  const { captureBoundAssemblySnapshot } = await import('../scripts/assemble-web-release.mjs');
  assert.equal(typeof captureBoundAssemblySnapshot, 'function');
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-assembly-swap-fixture-'));
  const alternate = `${root}.alternate`;
  mkdirSync(alternate, { mode: 0o755 });
  mkdirSync(join(root, 'release'));
  mkdirSync(join(alternate, 'release'));
  writeFileSync(join(root, 'release/compliance-facts.json'), '{"source":"original-pending"}\n', { flag: 'wx' });
  writeFileSync(join(alternate, 'release/compliance-facts.json'), '{"source":"alternate-ready"}\n', { flag: 'wx' });
  for (const [path] of inputPolicy.slice(1)) {
    writePath(root, path, readFileSync(join(projectRoot, path)));
  }
  copyFileSync(join(projectRoot, 'miniapps/dist'), join(root, 'miniapps/dist'));
  linkSync(join(root, 'miniapps/dist'), join(root, 'miniapps/.dist-review-link'));
  chmodSync(join(root, 'miniapps/dist'), 0o400);
  const snapshot = captureBoundAssemblySnapshot(root, 'assembly-transient-root-exchange');
  const captured = snapshot.complianceFiles.find(({ path }) => path === 'release/compliance-facts.json');
  assert.equal(Buffer.from(captured.bytesBase64, 'base64').toString('utf8'), '{"source":"original-pending"}\n');
  assert.equal(readFileSync(join(root, 'release/compliance-facts.json'), 'utf8'), '{"source":"original-pending"}\n');
  assert.equal(readFileSync(join(alternate, 'release/compliance-facts.json'), 'utf8'), '{"source":"alternate-ready"}\n');
  assert.equal(existsSync(join(root, 'release/web-bundles')), false);
  assert.equal(existsSync(join(root, 'release/web-artifacts.json')), false);
});
