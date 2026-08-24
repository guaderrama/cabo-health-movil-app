import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
  symlinkSync,
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
const slots = Object.freeze([
  '00-apps-htaccess',
  '01-apps-shared',
  '02-app-index',
  '03-app-privacy',
  '04-app-terms',
  '05-app-support',
  '06-app-report-content',
  '07-apps-healthy-recipes',
  '08-apps-clinic-guide',
  '09-aasa',
]);
const inputPolicy = Object.freeze([
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
  if (path === 'app/index.html') return 'marketing-landing';
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

test('synchronous reversal revalidates a same-inode operand mutation before leaving anything live', () => {
  const { root, transport } = setupPromotion('present');
  const result = runHelper(root, 'promote-next', transport, [transport.releaseId], {
    CABOHEALTH_TEST_FAULT: 'promotion-post-exchange-reversal-operand-tamper',
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /REVERSAL=.*INVALID/u);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
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
      const result = runHelper(root, 'rollback-next', transport, [transport.releaseId, '0'], {
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
        const rolledBack = runHelper(root, 'rollback-next', transport, [transport.releaseId, '0']);
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
        const crashed = runHelper(root, 'rollback-next', transport, [transport.releaseId, '0'], {
          CABOHEALTH_TEST_FAULT: fault,
        });
        assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
        const resumed = runHelper(root, 'rollback-next', transport, [transport.releaseId, '0']);
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
    index: 9,
    target: targets[9],
    slot: slots[9],
    original: 'absent',
    oldInventorySha256: null,
    transition: 'promoted',
    attempt: 0,
  };
  writeFileSync(join(transitionDirectory, '09-promoted-000.json'), canonicalJson(record), {
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
  const overlays = runHelper(root, 'publish-hosting-overlays', transport);
  assert.equal(overlays.status, 0, overlays.stderr || overlays.stdout);
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

test('descriptor inventory admits only an absent or complete safe protected-overlay pair', async (context) => {
  const setupLive = () => {
    const state = setupPromotion('absent');
    for (let index = 0; index < targets.length; index += 1) {
      const result = runHelper(state.root, 'promote-next', state.transport, [state.transport.releaseId]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const overlays = runHelper(state.root, 'publish-hosting-overlays', state.transport);
    assert.equal(overlays.status, 0, overlays.stderr || overlays.stdout);
    return state;
  };

  await context.test('both protected directories preserve the public 17-file authority', () => {
    const { root, transport } = setupLive();
    mkdirSync(join(root, 'public_html/apps/app-review'), { mode: 0o755 });
    mkdirSync(join(root, 'public_html/apps/client-resources'), { mode: 0o755 });
    const result = runHelper(root, 'inventory-live', transport, [transport.releaseId]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const inventory = JSON.parse(result.stdout);
    assert.equal(inventory.fileCount, 17);
    assert.deepEqual(inventory.paths, paths);
  });

  for (const loneName of ['app-review', 'client-resources']) {
    await context.test(`a lone ${loneName} directory fails closed`, () => {
      const { root, transport } = setupLive();
      mkdirSync(join(root, `public_html/apps/${loneName}`), { mode: 0o755 });
      const result = runHelper(root, 'inventory-live', transport, [transport.releaseId]);
      assert.equal(result.status, 1, result.stderr || result.stdout);
    });
  }

  await context.test('the complete pair plus any third sibling fails closed', () => {
    const { root, transport } = setupLive();
    for (const name of ['app-review', 'client-resources', 'unexpected']) {
      mkdirSync(join(root, `public_html/apps/${name}`), { mode: 0o755 });
    }
    const result = runHelper(root, 'inventory-live', transport, [transport.releaseId]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
  });

  for (const linkedName of ['app-review', 'client-resources']) {
    await context.test(`a symlinked ${linkedName} member fails closed`, () => {
      const { root, transport } = setupLive();
      const otherName = linkedName === 'app-review' ? 'client-resources' : 'app-review';
      mkdirSync(join(root, `public_html/apps/${otherName}`), { mode: 0o755 });
      symlinkSync('shared', join(root, `public_html/apps/${linkedName}`), 'dir');
      const result = runHelper(root, 'inventory-live', transport, [transport.releaseId]);
      assert.equal(result.status, 1, result.stderr || result.stdout);
    });
  }

  await context.test('an insecure protected directory mode fails closed', () => {
    const { root, transport } = setupLive();
    mkdirSync(join(root, 'public_html/apps/app-review'), { mode: 0o755 });
    mkdirSync(join(root, 'public_html/apps/client-resources'), { mode: 0o755 });
    chmodSync(join(root, 'public_html/apps/app-review'), 0o775);
    const result = runHelper(root, 'inventory-live', transport, [transport.releaseId]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
  });
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
  const { browserEvidenceSha256, measureBrowserEvidence, validateBrowserEvidence } = await import('../scripts/verify-production.mjs');
  assert.equal(typeof measureBrowserEvidence, 'function');
  const artifact = fixtureArtifact();
  const authority = {
    reviewedReleaseId: artifact.releaseId,
    reviewedArtifactSha256: sha256(Buffer.from(canonicalJson(artifact))),
  };
  const sessions = new Map();
  let nextSession = 0;
  let driverFault = null;
  let urlCommandCount = 0;
  let tabActionCount = 0;
  let spaceActionCount = 0;
  let enterActionCount = 0;
  let noPreferenceCommandCount = 0;
  let frameTreeCommandCount = 0;
  let networkEnableCommandCount = 0;
  let performanceWaitCount = 0;
  const bootstrapRequestId = 'A'.repeat(32);
  const bootstrapWebview = 'B'.repeat(32);
  const addRequest = (session, sessionId, record) => {
    session.requests.push({
      requestId: `${sessionId}-request-${session.nextRequestId++}`,
      method: 'GET',
      ...record,
    });
  };
  const addDocumentLoad = (session, sessionId, url, { includeResources = true } = {}) => {
    const frameId = session.mainFrameId;
    const loaderId = `${sessionId}-loader-${session.nextLoaderId++}`;
    addRequest(session, sessionId, {
      url,
      type: 'Document',
      frameId,
      loaderId,
      documentURL: url,
    });
    session.currentFrameUrl = url;
    session.currentFrameLoaderId = loaderId;
    const pathname = new URL(url).pathname;
    if (!includeResources) return;
    addRequest(session, sessionId, {
      url: driverFault === 'favicon-external'
        ? 'https://evil.invalid/favicon.ico'
        : 'https://cabohealth.org/favicon.ico',
      type: driverFault === 'favicon-as-script' ? 'Script' : 'Other',
      frameId,
      loaderId,
      documentURL: url,
    });
    if (!pathname.startsWith('/apps/')) return;
    for (const [resourceUrl, type] of [
      ['https://cabohealth.org/apps/shared/styles.css', 'Stylesheet'],
      ['https://cabohealth.org/apps/shared/logo-wordmark.png', 'Image'],
      ...(pathname === '/apps/clinic-guide/' ? [
        ['https://cabohealth.org/apps/shared/clinic-map-texture.png', 'Image'],
      ] : []),
      ...(session.javascriptEnabled ? [
        [new URL('app.js', url).href, 'Script'],
        ['https://cabohealth.org/apps/shared/motion.js', 'Script'],
        ['https://cabohealth.org/apps/shared/shell.js', 'Script'],
      ] : []),
    ]) {
      addRequest(session, sessionId, {
        url: resourceUrl,
        type,
        frameId,
        loaderId,
        documentURL: url,
      });
    }
  };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const sessionMatch = /^\/session\/([^/]+)(?:\/(.*))?$/u.exec(request.url ?? '');
    let value = null;
    if (request.method === 'POST' && request.url === '/session') {
      const sessionId = `session-${nextSession++}`;
      const requested = body.capabilities.alwaysMatch;
      const options = requested['goog:chromeOptions'];
      assert.deepEqual(options?.args, [
        '--headless=new',
        '--disable-background-networking',
        '--no-default-browser-check',
        '--no-first-run',
      ]);
      const requestedMetrics = options?.mobileEmulation?.deviceMetrics ?? { width: 1024, height: 768 };
      const metrics = driverFault === 'ignored-viewport' ? { width: 1024, height: 768 } : requestedMetrics;
      const requestedLocale = options?.prefs?.['intl.accept_languages'] ?? 'en-US';
      const locale = driverFault === 'ignored-locale' ? 'en-US' : requestedLocale;
      let javascriptEnabled = options?.prefs?.['profile.managed_default_content_settings.javascript'] !== 2;
      if (driverFault === 'force-js-disabled') javascriptEnabled = false;
      if (driverFault === 'force-js-enabled') javascriptEnabled = true;
      sessions.set(sessionId, {
        url: null,
        metrics,
        locale,
        selectedLanguage: 'en',
        javascriptEnabled,
        reducedMotion: false,
        activeTarget: null,
        activeHref: null,
        navigationCandidateIndex: 0,
        probedFocusTarget: null,
        pauseActionCount: 0,
        requests: [],
        nextRequestId: 0,
        mainFrameId: `${sessionId}-main-frame`,
        nextLoaderId: 0,
        completedObservationCount: 0,
        previousRouteLoaderId: null,
        browserLogReadCount: 0,
        deferredPerformanceLogs: [],
      });
      value = {
        sessionId,
        capabilities: {
          browserName: driverFault === 'ignored-capabilities' ? 'safari' : 'chrome',
          acceptInsecureCerts: false,
          pageLoadStrategy: 'normal',
        },
      };
    } else if (sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      const command = sessionMatch[2] ?? '';
      if (request.method === 'POST' && command === 'url') {
        urlCommandCount += 1;
        session.url = body.url;
        session.activeTarget = null;
        session.activeHref = null;
        session.navigationCandidateIndex = 0;
        session.probedFocusTarget = null;
        session.pauseActionCount = 0;
        addDocumentLoad(session, sessionMatch[1], body.url);
      }
      else if (request.method === 'GET' && command === 'url') value = session.url;
      else if (request.method === 'GET' && command === 'se/log/types') value = ['browser', 'performance'];
      else if (request.method === 'POST' && command === 'goog/cdp/execute') {
        if (body.cmd === 'Page.getFrameTree') {
          frameTreeCommandCount += 1;
          value = {
            frameTree: {
              frame: {
                id: session.mainFrameId,
                loaderId: session.currentFrameLoaderId,
                url: session.currentFrameUrl,
                ...(driverFault === 'main-frame-has-parent'
                  ? { parentId: `${session.mainFrameId}-parent` }
                  : {}),
              },
            },
          };
        } else if (body.cmd === 'Network.enable') {
          networkEnableCommandCount += 1;
          assert.deepEqual(body.params, { reportDirectSocketTraffic: true });
          value = {};
        } else {
          if (body.params.features[0].value === 'no-preference') noPreferenceCommandCount += 1;
          session.reducedMotion = driverFault === 'ignored-reduced-motion'
            ? false
            : body.params.features[0].value === 'reduce';
          value = {};
        }
      }
      else if (request.method === 'POST' && command === 'actions') {
        for (const source of body.actions ?? []) {
          for (const action of source.actions ?? []) {
            if (action.type !== 'keyDown') continue;
            if (action.value === '\uE004') {
              tabActionCount += 1;
              if (driverFault !== 'ignored-focus') {
                const miniapp = new URL(session.url).pathname.startsWith('/apps/');
                if (miniapp && session.javascriptEnabled && session.pauseActionCount === 0) {
                  session.activeTarget = 'motion-toggle';
                  session.activeHref = null;
                } else {
                  const navigationCandidates = [
                    'https://cabohealth.org/app/',
                    'https://cabohealth.org/app/privacy/#fragment',
                    'https://cabohealth.org/app/privacy/lookalike/',
                    'https://cabohealth.org/app/privacy/',
                  ];
                  session.activeTarget = 'link';
                  session.activeHref = navigationCandidates[Math.min(
                    session.navigationCandidateIndex,
                    navigationCandidates.length - 1,
                  )];
                  session.navigationCandidateIndex += 1;
                }
              }
            } else if (action.value === '\uE00D') {
              spaceActionCount += 1;
              if (
                driverFault !== 'ignored-pause'
                && session.activeTarget === 'motion-toggle'
                && !session.reducedMotion
              ) session.pauseActionCount += 1;
            } else if (action.value === '\uE007') {
              enterActionCount += 1;
              if (session.probedFocusTarget === 'legal-link' && driverFault !== 'ignored-navigation') {
                session.url = session.activeHref;
                addDocumentLoad(session, sessionMatch[1], session.url, { includeResources: false });
              }
            }
          }
        }
        value = null;
      }
      else if (request.method === 'POST' && command === 'execute/async') {
        assert.deepEqual(body, {
          script: 'setTimeout(arguments[arguments.length - 1], 25);',
          args: [],
        });
        performanceWaitCount += 1;
        value = null;
      }
      else if (request.method === 'POST' && command === 'execute/sync') {
        const pathname = new URL(session.url).pathname;
        const miniapp = pathname.startsWith('/apps/');
        const clinicGuide = pathname === '/apps/clinic-guide/';
        const observesClinicControls = body.script.includes('[data-clinic-tab]')
          && body.script.includes('[data-open-clinic-panel]');
        const observesLegalArticles = body.script.includes('article[lang="en"]')
          && body.script.includes('article[lang="es-MX"]');
        const reducedMotionBlocksCanvas = session.reducedMotion
          && driverFault !== 'running-canvas-under-reduced-motion';
        const controlsDisabled = driverFault === 'enabled-disabled-js-controls'
          ? false
          : !session.javascriptEnabled;
        const requestedUiLanguage = session.locale === 'es-MX' ? 'es-MX' : 'en';
        const attemptsLocaleSelection = body.script.includes('[data-language=')
          && body.script.includes('.click()');
        const ignoresImplicitFavicon = body.script.includes("new URL('/favicon.ico', location.href).href");
        const legalUrls = body.args?.[4];
        assert.deepEqual(legalUrls, [
          'https://cabohealth.org/app/privacy/',
          'https://cabohealth.org/app/terms/',
          'https://cabohealth.org/app/support/',
          'https://cabohealth.org/app/report-content/',
        ]);
        assert.equal(body.script.includes('legalUrls.includes(activeHref)'), true);
        const probedFocusTarget = session.activeTarget === 'motion-toggle'
          ? 'motion-toggle'
          : (Array.isArray(legalUrls) && legalUrls.includes(session.activeHref)
            ? 'legal-link'
            : 'other');
        session.probedFocusTarget = probedFocusTarget;
        if (miniapp && session.javascriptEnabled && attemptsLocaleSelection
          && driverFault !== 'ignored-language-selection') {
          session.selectedLanguage = requestedUiLanguage;
        }
        value = {
          documentUrl: session.url,
          readyState: 'complete',
          bodyTextLength: 120,
          canonicalHref: session.url,
          actualWidth: session.metrics.width,
          actualHeight: session.metrics.height,
          visualWidth: session.metrics.width,
          visualHeight: session.metrics.height,
          effectiveLocale: session.locale,
          documentLanguage: driverFault === 'wrong-document-language'
            ? 'en'
            : (miniapp && session.javascriptEnabled ? session.selectedLanguage : 'en'),
          localeVisibilityVerified: driverFault === 'mixed-locale-visibility'
            ? false
            : (!miniapp || !session.javascriptEnabled || session.selectedLanguage === requestedUiLanguage),
          javascriptSentinel: miniapp
            ? (session.javascriptEnabled ? 'enhanced' : 'static')
            : 'not-applicable',
          reducedMotionMatches: session.reducedMotion,
          animationSuppressed: session.reducedMotion,
          pauseKeyboardVerified: !miniapp || !session.javascriptEnabled || session.pauseActionCount >= 2,
          motionToggleDisabled: reducedMotionBlocksCanvas || !session.javascriptEnabled,
          motionStatus: reducedMotionBlocksCanvas || !session.javascriptEnabled
            ? 'Static composition / Composición estática'
            : (session.pauseActionCount % 2 === 1 ? 'paused' : 'playing'),
          motionStatic: !miniapp || reducedMotionBlocksCanvas || !session.javascriptEnabled,
          focusVerified: session.activeTarget !== null,
          focusTarget: probedFocusTarget,
          navigationHref: probedFocusTarget === 'legal-link'
            ? session.activeHref
            : null,
          noJsControlsDisabled: !miniapp || session.javascriptEnabled
            || (controlsDisabled && (!clinicGuide || observesClinicControls)),
          bilingualStaticVisible: miniapp || observesLegalArticles,
          challengeEcho: driverFault === 'stale-challenge' ? 'stale' : body.args?.[1],
          unexpectedResourceCount: driverFault === 'unexpected-performance-resource'
            ? 1
            : (ignoresImplicitFavicon ? 0 : 1),
          miniappReady: miniapp && session.javascriptEnabled,
        };
      } else if (request.method === 'POST' && command === 'se/log') {
        if (body.type === 'performance') {
          const deferredPerformanceLogs = session.deferredPerformanceLogs.splice(0);
          const requestLog = driverFault === 'missing-navigation-request'
            ? session.requests.slice(0, 1)
            : session.requests;
          const records = requestLog.map((record) => ({ ...record }));
          if (
            driverFault === 'bootstrap-id-reused'
            && session.url !== null
            && session.completedObservationCount === 0
            && records.length > 0
          ) records[0].requestId = bootstrapRequestId;
          const firstDocumentIndex = records.findIndex(({ type }) => type === 'Document');
          if (driverFault === 'missing-document-request' && firstDocumentIndex >= 0) {
            records.splice(firstDocumentIndex, 1);
          }
          const firstDocument = records.find(({ type }) => type === 'Document') ?? requestLog[0];
          if (driverFault === 'allowed-url-failure' && records.length > 0) records.push({
            requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
            url: 'https://cabohealth.org/apps/shared/styles.css',
            method: 'GET',
            type: 'Stylesheet',
            frameId: firstDocument.frameId,
            loaderId: firstDocument.loaderId,
            documentURL: firstDocument.documentURL,
            resourceFailure: true,
          });
          if (driverFault === 'resource-redirect-allowed' && records.length > 0) records.push({
            requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
            url: 'https://cabohealth.org/apps/shared/styles.css',
            method: 'GET',
            type: 'Stylesheet',
            frameId: firstDocument.frameId,
            loaderId: firstDocument.loaderId,
            documentURL: firstDocument.documentURL,
            redirectUrl: 'https://cabohealth.org/apps/shared/motion.js',
          });
          if (driverFault === 'navigation-redirect-allowed' && records.length > 1) {
            const navigationIndex = records.findLastIndex(({ type }) => type === 'Document');
            records[navigationIndex] = {
              ...records[navigationIndex],
              redirectUrl: 'https://cabohealth.org/app/terms/',
            };
          }
          if (driverFault === 'external-request' && firstDocument) records.push({
            requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
            url: 'https://evil.invalid/tracker.js',
            method: 'GET',
            type: 'Script',
            frameId: firstDocument.frameId,
            loaderId: firstDocument.loaderId,
            documentURL: firstDocument.documentURL,
          });
          const miniappDocument = firstDocument
            && new URL(firstDocument.url).pathname.startsWith('/apps/') ? firstDocument : null;
          if (miniappDocument && driverFault === 'extra-image') records.push({
            requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
            url: 'https://cabohealth.org/apps/shared/logo.png',
            method: 'GET',
            type: 'Image',
            frameId: miniappDocument.frameId,
            loaderId: miniappDocument.loaderId,
            documentURL: miniappDocument.documentURL,
          });
          for (const [fault, type] of [['extra-fetch', 'Fetch'], ['extra-xhr', 'XHR']]) {
            if (miniappDocument && driverFault === fault) records.push({
              requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
              url: 'https://cabohealth.org/apps/shared/styles.css',
              method: 'GET',
              type,
              frameId: miniappDocument.frameId,
              loaderId: miniappDocument.loaderId,
              documentURL: miniappDocument.documentURL,
            });
          }
          if (firstDocument && driverFault === 'extra-subframe-document') records.push({
            requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
            url: 'https://cabohealth.org/app/terms/',
            method: 'GET',
            type: 'Document',
            frameId: `${firstDocument.frameId}-subframe`,
            loaderId: `${sessionMatch[1]}-loader-${session.nextLoaderId++}`,
            documentURL: 'https://cabohealth.org/app/terms/',
          });
          const documentRecord = records.find(({ type }) => type === 'Document');
          if (documentRecord && driverFault === 'image-as-document') documentRecord.type = 'Image';
          if (documentRecord && driverFault === 'fetch-as-document') documentRecord.type = 'Fetch';
          if (documentRecord && driverFault === 'xhr-as-document') documentRecord.type = 'XHR';
          if (documentRecord && driverFault === 'subframe-document') {
            documentRecord.frameId = `${documentRecord.frameId}-subframe`;
          }
          if (documentRecord && driverFault === 'post-document') documentRecord.method = 'POST';
          if (documentRecord && driverFault === 'missing-request-type') delete documentRecord.type;
          if (documentRecord && driverFault === 'missing-request-method') delete documentRecord.method;
          const resourceRecord = records.find(({ type }) => type !== 'Document');
          if (resourceRecord && driverFault === 'resource-as-fetch') resourceRecord.type = 'Fetch';
          if (resourceRecord && driverFault === 'resource-as-xhr') resourceRecord.type = 'XHR';
          if (resourceRecord && driverFault === 'resource-loader-mismatch') {
            resourceRecord.loaderId = `${resourceRecord.loaderId}-other`;
          }
          if (resourceRecord && driverFault === 'duplicate-resource') {
            records.push({
              ...resourceRecord,
              requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
            });
          }
          if (firstDocument && driverFault === 'route-inappropriate-resource') {
            records.push({
              requestId: `${sessionMatch[1]}-request-${session.nextRequestId++}`,
              url: 'https://cabohealth.org/apps/clinic-guide/app.js',
              method: 'GET',
              type: 'Script',
              frameId: firstDocument.frameId,
              loaderId: firstDocument.loaderId,
              documentURL: firstDocument.documentURL,
            });
          }
          if (driverFault === 'navigation-loader-reused') {
            const documents = records.filter(({ type }) => type === 'Document');
            if (documents.length > 1) documents.at(-1).loaderId = documents[0].loaderId;
          }
          if (firstDocument && driverFault === 'session-document-loader-reuse') {
            if (session.previousRouteLoaderId !== null) {
              const currentRouteLoaderId = firstDocument.loaderId;
              for (const record of records) {
                if (record.loaderId === currentRouteLoaderId) {
                  record.loaderId = session.previousRouteLoaderId;
                }
              }
            }
          }
          if (firstDocument && driverFault === 'session-main-frame-switch'
            && session.completedObservationCount > 0) {
            for (const record of records) record.frameId = `${session.mainFrameId}-replacement`;
          }
          if (driverFault === 'reused-request-id' && records.length > 0) {
            records.push({ ...records[0] });
          }
          const movableResourceIndex = records.findIndex(({ type }) => type !== 'Document');
          if (movableResourceIndex >= 0 && driverFault === 'resource-before-document') {
            records.unshift(...records.splice(movableResourceIndex, 1));
          }
          if (movableResourceIndex >= 0 && driverFault === 'resource-after-navigation') {
            records.push(...records.splice(movableResourceIndex, 1));
          }
          const event = (method, params) => ({
            level: 'INFO',
            message: JSON.stringify({ message: { method, params } }),
          });
          const chromeDriverEvent = (method, params, requestId = bootstrapRequestId) => ({
            level: 'INFO',
            message: JSON.stringify({
              message: { method, params: { ...params, requestId } },
              webview: bootstrapWebview,
            }),
            timestamp: 1,
          });
          value = [...deferredPerformanceLogs, ...records.flatMap((record, index) => {
            const requestEvent = event('Network.requestWillBeSent', {
              requestId: record.requestId,
              type: record.type,
              frameId: record.frameId,
              loaderId: record.loaderId,
              documentURL: record.documentURL,
              request: { url: record.url, method: record.method },
              ...(driverFault === 'orphan-redirect' && index === 0
                ? { redirectResponse: { url: 'https://cabohealth.org/app/support/', status: 302 } }
                : {}),
            });
            if ((driverFault === 'redirect-disallowed' && index === 0) || record.redirectUrl
              || (driverFault === 'redirect-chain' && index === 0)) {
              const redirectUrl = record.redirectUrl ?? 'https://evil.invalid/redirected';
              const redirected = event('Network.requestWillBeSent', {
                requestId: record.requestId,
                type: record.type,
                frameId: record.frameId,
                loaderId: record.loaderId,
                documentURL: redirectUrl,
                request: { url: redirectUrl, method: record.method },
                redirectResponse: { url: record.url, status: 302 },
              });
              const chain = driverFault === 'redirect-chain' && index === 0
                ? [event('Network.requestWillBeSent', {
                  requestId: record.requestId,
                  type: record.type,
                  frameId: record.frameId,
                  loaderId: record.loaderId,
                  documentURL: 'https://cabohealth.org/app/terms/',
                  request: { url: 'https://cabohealth.org/app/terms/', method: record.method },
                  redirectResponse: { url: redirectUrl, status: 307 },
                })]
                : [];
              return [
                requestEvent,
                redirected,
                ...chain,
                event('Network.responseReceived', {
                  requestId: record.requestId,
                  type: record.type,
                  frameId: record.frameId,
                  loaderId: record.loaderId,
                  response: { url: redirectUrl, status: 200 },
                }),
                event('Network.loadingFinished', { requestId: record.requestId }),
              ];
            }
            if (driverFault === 'loading-failed' && index === 0) {
              return [requestEvent, event('Network.loadingFailed', {
                requestId: record.requestId,
                type: record.type,
                errorText: 'fixture network failure',
              })];
            }
            const status = driverFault === 'http-404' && index === 0
              ? 404
              : (driverFault === 'http-500' && index === 1) || record.resourceFailure ? 500 : 200;
            const responseParams = {
              requestId: record.requestId,
              type: driverFault === 'missing-response-type' && index === 0
                ? undefined
                : (driverFault === 'response-type-mismatch' && index === 0 ? 'Fetch' : record.type),
              frameId: driverFault === 'response-frame-mismatch' && index === 0
                ? `${record.frameId}-other`
                : record.frameId,
              loaderId: driverFault === 'response-loader-mismatch' && index === 0
                ? `${record.loaderId}-other`
                : record.loaderId,
              response: driverFault === 'missing-status' && index === 0
                ? { url: record.url }
                : { url: record.url, status },
            };
            const responseEvent = event('Network.responseReceived', responseParams);
            if (driverFault === 'pending-request' && index === 0) return [requestEvent];
            if (driverFault === 'missing-completion' && index === 0) return [requestEvent, responseEvent];
            const finished = event('Network.loadingFinished', { requestId: record.requestId });
            if (driverFault === null && record.url === 'https://cabohealth.org/favicon.ico') {
              return [requestEvent];
            }
            if (
              driverFault === null
              && record.url === 'https://cabohealth.org/apps/shared/styles.css'
              && record.type === 'Stylesheet'
            ) {
              session.deferredPerformanceLogs.push(responseEvent, finished);
              return [requestEvent];
            }
            if (driverFault === 'duplicate-response' && index === 0) {
              return [requestEvent, responseEvent, responseEvent, finished];
            }
            if (driverFault === 'duplicate-terminal' && index === 0) {
              return [requestEvent, responseEvent, finished, finished];
            }
            return [requestEvent, responseEvent, finished];
          })];
          if (session.url === null) {
            value.unshift(chromeDriverEvent('Network.policyUpdated', {}, undefined));
            if (driverFault === 'bootstrap-orphan-response') {
              value.push(chromeDriverEvent('Network.responseReceived', {
                type: 'Document',
                frameId: session.mainFrameId,
                loaderId: `${sessionMatch[1]}-bootstrap-loader`,
                response: { url: 'data:,', status: 200 },
              }));
            } else if (driverFault === 'bootstrap-orphan-loading-failed') {
              value.push(chromeDriverEvent('Network.loadingFailed', {
                type: 'Document',
                errorText: 'bootstrap stopped',
              }));
            } else if (driverFault === 'bootstrap-orphan-nonzero') {
              value.push(chromeDriverEvent('Network.loadingFinished', {
                encodedDataLength: 1,
                timestamp: 1,
              }));
            } else if (driverFault === 'bootstrap-orphan-duplicate') {
              value.push(
                chromeDriverEvent('Network.loadingFinished', {
                  encodedDataLength: 0,
                  timestamp: 1,
                }),
                chromeDriverEvent('Network.loadingFinished', {
                  encodedDataLength: 0,
                  timestamp: 1,
                }, 'C'.repeat(32)),
              );
            } else {
              value.push(chromeDriverEvent('Network.loadingFinished', {
                encodedDataLength: 0,
                timestamp: 1,
              }));
            }
          } else if (driverFault === 'route-orphan-finish') {
            value.push(chromeDriverEvent('Network.loadingFinished', {
              encodedDataLength: 0,
              timestamp: 1,
            }, 'C'.repeat(32)));
          }
          if (driverFault === 'websocket-created') {
            value.push(event('Network.webSocketCreated', {
              requestId: `${sessionMatch[1]}-websocket-0`,
              url: 'wss://cabohealth.org/socket',
            }));
          }
          if (driverFault === 'webtransport-created') {
            value.push(event('Network.webTransportCreated', {
              transportId: `${sessionMatch[1]}-webtransport-0`,
              url: 'https://cabohealth.org/transport',
            }));
          }
          if (driverFault === 'direct-tcp-created') {
            value.push(event('Network.directTCPSocketCreated', {
              identifier: `${sessionMatch[1]}-direct-tcp-0`,
            }));
          }
          if (driverFault === 'direct-udp-created') {
            value.push(event('Network.directUDPSocketCreated', {
              identifier: `${sessionMatch[1]}-direct-udp-0`,
            }));
          }
          if (firstDocument) {
            session.previousRouteLoaderId = firstDocument.loaderId;
            session.completedObservationCount += 1;
          }
          session.requests.length = 0;
        } else {
          session.browserLogReadCount += 1;
          value = driverFault === 'console-error'
            || (driverFault === 'late-console-error' && session.browserLogReadCount === 1)
            ? [{ level: 'SEVERE', source: 'javascript', message: 'fixture error' }]
            : (driverFault === null && session.browserLogReadCount % 2 === 0
              ? [{
                level: 'SEVERE',
                source: 'security',
                message: `${session.url} 5 The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.`,
              }]
              : []);
        }
      }
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
    });
    assert.equal(validateBrowserEvidence(evidence, artifact, authority), true);
    assert.equal(evidence.observations.length, 56);
    assert.equal(Object.hasOwn(evidence, 'measurementSha256'), false);
    assert.deepEqual([...new Set(evidence.observations.map(({ actualWidth, actualHeight }) => `${actualWidth}x${actualHeight}`))], [
      '390x844',
      '320x568',
    ]);
    assert.equal(evidence.observations.every(({ effectiveLocale }) => ['en-US', 'es-MX'].includes(effectiveLocale)), true);
    assert.equal(evidence.observations
      .filter(({ javascript, path, requestedLocale }) => javascript === 'enabled' && path.startsWith('/apps/') && requestedLocale === 'es-MX')
      .every(({ documentLanguage, localeVisibilityVerified }) => documentLanguage === 'es-MX' && localeVisibilityVerified), true);
    assert.equal(evidence.observations
      .filter(({ javascript, path, requestedLocale }) => javascript === 'enabled' && path.startsWith('/apps/') && requestedLocale === 'en-US')
      .every(({ documentLanguage, localeVisibilityVerified }) => documentLanguage === 'en' && localeVisibilityVerified), true);
    assert.equal(evidence.observations
      .filter(({ javascript, path }) => javascript === 'disabled' && path.startsWith('/apps/'))
      .every(({ miniappReady, javascriptSentinel }) => !miniappReady && javascriptSentinel === 'static'), true);
    assert.equal(evidence.observations
      .filter(({ path }) => path.startsWith('/app/'))
      .every(({ bilingualStaticVisible }) => bilingualStaticVisible), true);
    assert.equal(urlCommandCount, 56);
    assert.equal(tabActionCount, 232);
    assert.equal(spaceActionCount, 16);
    assert.equal(enterActionCount, 56);
    assert.equal(noPreferenceCommandCount, 8);
    assert.equal(frameTreeCommandCount, 112);
    assert.equal(networkEnableCommandCount, 8);
    assert.equal(performanceWaitCount > 0, true);
    assert.equal(nextSession, 8);
    const stale = structuredClone(evidence);
    stale.releaseId = `web-v1-${'0'.repeat(64)}`;
    assert.throws(() => validateBrowserEvidence(stale, artifact, authority, {
      reviewedBrowserMeasurementSha256: browserEvidenceSha256(stale),
    }), /BROWSER_EVIDENCE/u);
    const handAuthoredClone = structuredClone(evidence);
    assert.throws(() => validateBrowserEvidence(handAuthoredClone, artifact, authority), /BROWSER_RUNNER_RECEIPT_REQUIRED/u);
    const unexpectedlyAcceptedFaults = [];
    for (const fault of [
      'ignored-capabilities',
      'ignored-viewport',
      'ignored-locale',
      'ignored-language-selection',
      'wrong-document-language',
      'mixed-locale-visibility',
      'force-js-disabled',
      'force-js-enabled',
      'enabled-disabled-js-controls',
      'stale-challenge',
      'ignored-reduced-motion',
      'running-canvas-under-reduced-motion',
      'ignored-pause',
      'ignored-focus',
      'ignored-navigation',
      'missing-document-request',
      'missing-navigation-request',
      'external-request',
      'http-404',
      'http-500',
      'loading-failed',
      'pending-request',
      'missing-completion',
      'missing-status',
      'allowed-url-failure',
      'duplicate-response',
      'duplicate-terminal',
      'image-as-document',
      'fetch-as-document',
      'xhr-as-document',
      'extra-image',
      'extra-fetch',
      'extra-xhr',
      'extra-subframe-document',
      'subframe-document',
      'post-document',
      'missing-request-type',
      'missing-response-type',
      'missing-request-method',
      'response-type-mismatch',
      'response-frame-mismatch',
      'response-loader-mismatch',
      'resource-as-fetch',
      'resource-as-xhr',
      'resource-loader-mismatch',
      'duplicate-resource',
      'route-inappropriate-resource',
      'navigation-loader-reused',
      'session-document-loader-reuse',
      'session-main-frame-switch',
      'reused-request-id',
      'bootstrap-orphan-response',
      'bootstrap-orphan-loading-failed',
      'bootstrap-orphan-nonzero',
      'bootstrap-orphan-duplicate',
      'bootstrap-id-reused',
      'route-orphan-finish',
      'resource-before-document',
      'resource-after-navigation',
      'websocket-created',
      'webtransport-created',
      'direct-tcp-created',
      'direct-udp-created',
      'main-frame-has-parent',
      'favicon-as-script',
      'favicon-external',
      'unexpected-performance-resource',
      'console-error',
      'late-console-error',
    ]) {
      driverFault = fault;
      try {
        await measureBrowserEvidence({
          artifact,
          ...authority,
          baseUrl: 'https://cabohealth.org/',
          webdriverUrl: `http://127.0.0.1:${address.port}/`,
          productionConfirmation: 'cabohealth.org',
          checkedAt: '2026-08-18T02:03:04.000Z',
        });
        unexpectedlyAcceptedFaults.push(fault);
      } catch (error) {
        assert.match(String(error), /(?:BROWSER|WEBDRIVER)_/u, fault);
      }
    }
    driverFault = 'orphan-redirect';
    let orphanRedirectError = '';
    try {
      await measureBrowserEvidence({
        artifact,
        ...authority,
        baseUrl: 'https://cabohealth.org/',
        webdriverUrl: `http://127.0.0.1:${address.port}/`,
        productionConfirmation: 'cabohealth.org',
        checkedAt: '2026-08-18T02:03:04.000Z',
      });
    } catch (error) {
      orphanRedirectError = String(error);
    }
    assert.deepEqual({
      unexpectedlyAcceptedFaults,
      orphanRedirectMalformed: /WEBDRIVER_PERFORMANCE_LOG_INVALID/u.test(orphanRedirectError),
    }, {
      unexpectedlyAcceptedFaults: [],
      orphanRedirectMalformed: true,
    });
    for (const fault of [
      'redirect-disallowed',
      'navigation-redirect-allowed',
      'resource-redirect-allowed',
      'redirect-chain',
    ]) {
      driverFault = fault;
      await assert.rejects(measureBrowserEvidence({
        artifact,
        ...authority,
        baseUrl: 'https://cabohealth.org/',
        webdriverUrl: `http://127.0.0.1:${address.port}/`,
        productionConfirmation: 'cabohealth.org',
        checkedAt: '2026-08-18T02:03:04.000Z',
      }), /BROWSER_NETWORK_REDIRECT_FORBIDDEN/u, fault);
    }
    driverFault = null;

    const cliRoot = mkdtempSync(join(fixtureTmp, 'cabohealth-browser-cli-fixture-'));
    mkdirSync(join(cliRoot, 'scripts'));
    mkdirSync(join(cliRoot, 'release'));
    for (const name of [
      'verify-production.mjs',
      'generate-aasa.mjs',
      'build-miniapps.mjs',
      'web-release-policy.mjs',
    ]) copyFileSync(join(projectRoot, 'scripts', name), join(cliRoot, 'scripts', name));
    writeFileSync(join(cliRoot, 'release/web-artifacts.json'), canonicalJson(artifact), { flag: 'wx' });
    const runBrowserCli = async () => {
      const child = spawn(process.execPath, [
        join(cliRoot, 'scripts/verify-production.mjs'),
        '--measure-browser',
        '--confirm-production=cabohealth.org',
        `--reviewed-release-id=${authority.reviewedReleaseId}`,
        `--reviewed-artifact-sha256=${authority.reviewedArtifactSha256}`,
        `--webdriver-url=http://127.0.0.1:${address.port}/`,
      ], { cwd: cliRoot, stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout = [];
      const stderr = [];
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
      const status = await new Promise((resolvePromise) => child.on('close', resolvePromise));
      return { status, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
    };
    const cliSuccess = await runBrowserCli();
    assert.equal(cliSuccess.status, 0, cliSuccess.stderr || cliSuccess.stdout);
    assert.equal(cliSuccess.stderr, '');
    const cliEvidence = JSON.parse(cliSuccess.stdout);
    assert.equal(cliSuccess.stdout, canonicalJson(cliEvidence));
    assert.equal(validateBrowserEvidence(cliEvidence, artifact, authority, {
      reviewedBrowserMeasurementSha256: browserEvidenceSha256(cliEvidence),
    }), true);
    assert.equal(cliEvidence.observations.length, 56);
    driverFault = 'allowed-url-failure';
    const cliFailure = await runBrowserCli();
    assert.equal(cliFailure.status, 1, cliFailure.stderr || cliFailure.stdout);
    assert.match(cliFailure.stderr, /BROWSER_NETWORK_/u);
    driverFault = null;
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('the real materialize-release boundary rejects caller-fabricated provenance while compliance is pending', () => {
  const transport = fixtureTransport();
  const artifact = fixtureArtifact(transport);
  const root = mkdtempSync(join(fixtureTmp, 'cabohealth-provenance-fixture-'));
  mkdirSync(join(root, 'release'));
  copyFileSync(join(projectRoot, 'release/compliance-facts.json'), join(root, 'release/compliance-facts.json'));
  const factsPath = join(root, 'release/compliance-facts.json');
  const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
  facts.releaseReady = false;
  facts.ageRating.host = { value: null, status: 'pending' };
  facts.ageRating.miniapps['healthy-recipes'] = { value: null, status: 'pending' };
  facts.ageRating.miniapps['clinic-guide'] = { value: null, status: 'pending' };
  writeFileSync(factsPath, canonicalJson(facts));
  const result = spawnSync(
    'python3',
    [helperPath, 'materialize-release', root],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      input: canonicalJson({ transport, manifest: artifact }),
    },
  );
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /COMPLIANCE_FACTS_INCOMPLETE/u);
  assert.equal(existsSync(join(root, 'release/web-bundles')), false);
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
  copyFileSync(join(projectRoot, 'app.json'), join(root, 'app.json'));
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
