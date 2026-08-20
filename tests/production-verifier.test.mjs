import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const verifierPath = join(projectRoot, 'scripts/verify-production.mjs');
const miniappCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; media-src 'none'";
const legalCsp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function legalHtml(slug) {
  const links = ['privacy', 'terms', 'support', 'report-content']
    .map((item) => `<a href="https://cabohealth.org/app/${item}/">${item}</a>`)
    .join('');
  return Buffer.from(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${legalCsp}"><link rel="canonical" href="https://cabohealth.org/app/${slug}/"></head><body><article lang="en">English</article><article lang="es-MX">Español</article>${links}</body></html>`);
}

function moduleHtml(slug) {
  const links = ['privacy', 'terms', 'support', 'report-content']
    .map((item) => `<a href="https://cabohealth.org/app/${item}/">${item}</a>`)
    .join('');
  return Buffer.from(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${miniappCsp}"><link rel="canonical" href="https://cabohealth.org/apps/${slug}/"></head><body>${links}<script src="/apps/${slug}/app.js"></script></body></html>`);
}

function localOriginArtifact() {
  const bodies = new Map([
    ['.well-known/apple-app-site-association', readFileSync(join(projectRoot, 'web-hosting/cabohealth.org/.well-known/apple-app-site-association'))],
    ['app/privacy/index.html', legalHtml('privacy')],
    ['app/report-content/index.html', legalHtml('report-content')],
    ['app/support/index.html', legalHtml('support')],
    ['app/terms/index.html', legalHtml('terms')],
    ['apps/.htaccess', Buffer.from('not public\n')],
    ['apps/clinic-guide/app.js', Buffer.from("document.documentElement.dataset.ready = 'true';\n")],
    ['apps/clinic-guide/index.html', moduleHtml('clinic-guide')],
    ['apps/healthy-recipes/app.js', Buffer.from("document.documentElement.dataset.ready = 'true';\n")],
    ['apps/healthy-recipes/index.html', moduleHtml('healthy-recipes')],
    ['apps/shared/clinic-map-texture.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01])],
    ['apps/shared/logo-wordmark.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02])],
    ['apps/shared/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['apps/shared/motion.js', Buffer.from('export const motion = false;\n')],
    ['apps/shared/shell.js', Buffer.from('export const shell = true;\n')],
    ['apps/shared/styles.css', Buffer.from('body { color: #123; }\n')],
  ]);
  const mediaType = (path) => path.endsWith('apple-app-site-association')
    ? 'application/json'
    : path.endsWith('.html') ? 'text/html; charset=utf-8'
      : path.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : path.endsWith('.css') ? 'text/css; charset=utf-8'
          : path.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8';
  const files = [...bodies].map(([path, bytes]) => ({
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    mediaType: mediaType(path),
    deployMode: '0644',
    kind: path === 'apps/.htaccess' ? 'apache-security'
      : path.startsWith('apps/') ? 'task6b-miniapp'
        : path.startsWith('app/') ? 'task7-legal' : 'aasa',
  }));
  const promoteTargets = [
    'public_html/apps/.htaccess', 'public_html/apps/shared', 'public_html/app/privacy',
    'public_html/app/terms', 'public_html/app/support', 'public_html/app/report-content',
    'public_html/apps/healthy-recipes', 'public_html/apps/clinic-guide',
    'public_html/.well-known/apple-app-site-association',
  ];
  const policy = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets,
    files,
  };
  const inventorySha256 = sha256(Buffer.from(`${JSON.stringify(policy)}\n`));
  const inputPolicy = [
    ['miniapps/dist', 'task6b-miniapp'],
    ['web-hosting/cabohealth.org/app/privacy/index.html', 'task7-legal'],
    ['web-hosting/cabohealth.org/app/terms/index.html', 'task7-legal'],
    ['web-hosting/cabohealth.org/app/support/index.html', 'task7-legal'],
    ['web-hosting/cabohealth.org/app/report-content/index.html', 'task7-legal'],
    ['web-hosting/cabohealth.org/.well-known/apple-app-site-association', 'aasa'],
    ['miniapps/shared/security-headers.conf', 'apache-security'],
    ['web-hosting/cabohealth.org/apps/.htaccess', 'apache-security'],
  ];
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    releaseId: `web-v1-${inventorySha256}`,
    inventorySha256,
    appId: policy.appId,
    entrySlugs: policy.entrySlugs,
    legalSlugs: policy.legalSlugs,
    promoteTargets,
    inputs: inputPolicy.map(([path, kind], index) => ({ path, size: index + 1, sha256: `${index}`.repeat(64), kind })),
    files,
  };
  return {
    artifact,
    authority: {
      reviewedReleaseId: artifact.releaseId,
      reviewedArtifactSha256: sha256(Buffer.from(`${JSON.stringify(artifact)}\n`)),
    },
    bodies,
  };
}

function fixtureBrowserEvidence(artifact, authority) {
  const routes = artifact.files
    .filter(({ path }) => path.endsWith('.html'))
    .map(({ path }) => `/${path.replace(/index\.html$/u, '')}`);
  const observations = [];
  for (const viewport of [
    { id: 'iphone-390x844', width: 390, height: 844 },
    { id: 'compact-320x568', width: 320, height: 568 },
  ]) {
    for (const locale of ['en-US', 'es-MX']) {
      for (const javascript of ['enabled', 'disabled']) {
        for (const path of routes) {
          const url = new URL(path, 'https://cabohealth.org/').href;
          const miniapp = path.startsWith('/apps/');
          observations.push({
            path,
            requestedViewport: viewport.id,
            requestedLocale: locale,
            javascript,
            actualWidth: viewport.width,
            actualHeight: viewport.height,
            visualWidth: viewport.width,
            visualHeight: viewport.height,
            effectiveLocale: locale,
            documentLanguage: miniapp && javascript === 'enabled'
              ? (locale === 'es-MX' ? 'es-MX' : 'en')
              : 'en',
            localeVisibilityVerified: true,
            documentUrl: url,
            readyState: 'complete',
            bodyTextLength: 120,
            canonicalHref: url,
            javascriptSentinel: miniapp
              ? (javascript === 'enabled' ? 'enhanced' : 'static')
              : 'not-applicable',
            reducedMotionMatches: true,
            animationSuppressed: true,
            pauseKeyboardVerified: true,
            focusVerified: true,
            navigationVerified: true,
            documentRequestSeen: true,
            unexpectedRequestCount: 0,
            consoleErrorCount: 0,
            miniappReady: javascript === 'enabled' && miniapp,
            noJsControlsDisabled: true,
            bilingualStaticVisible: true,
            challengeSha256: 'e'.repeat(64),
          });
        }
      }
    }
  }
  const evidence = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-browser-measurement-v1',
    status: 'verified',
    releaseId: artifact.releaseId,
    artifactSha256: authority.reviewedArtifactSha256,
    checkedAt: '2026-08-18T01:03:30.000Z',
    nonceSha256: 'f'.repeat(64),
    routes,
    observations,
  };
  return evidence;
}

async function runMutatedOrigin(verifyOrigin, mutate) {
  const { artifact, authority, bodies } = localOriginArtifact();
  const routeToPath = new Map([...bodies.keys()].map((path) => [
    `/${path.replace(/index\.html$/u, '')}`,
    path,
  ]));
  const server = createServer((request, response) => {
    const path = routeToPath.get(request.url ?? '') ?? null;
    let status = 200;
    let body = path ? bodies.get(path) : Buffer.from('control');
    const headers = { 'Content-Type': path
      ? artifact.files.find((item) => item.path === path).mediaType
      : 'text/plain; charset=utf-8' };
    if (request.url === '/apps/') status = 403;
    else if (request.url === '/apps/.htaccess' || request.url?.startsWith('/apps/task-8-unknown-')) status = 404;
    else if (request.url === '/unrelated-control.pdf') status = 200;
    else if (request.url === '/remediated-terminal-route') status = 410;
    else if (request.url !== '/' && !path) status = 404;
    if (path?.startsWith('apps/')) Object.assign(headers, {
      'Content-Security-Policy': miniappCsp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    });
    if (path?.startsWith('app/')) headers['X-Frame-Options'] = 'DENY';
    const changed = mutate({ body, headers, path, requestUrl: request.url ?? '', status }) ?? {};
    status = changed.status ?? status;
    body = changed.body ?? body;
    Object.assign(headers, changed.headers ?? {});
    for (const name of changed.removeHeaders ?? []) delete headers[name];
    response.writeHead(status, headers);
    response.end(body);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const address = server.address();
    return await verifyOrigin({
      artifact,
      ...authority,
      baseUrl: `http://127.0.0.1:${address.port}`,
      sensitiveControls: {
        unrelatedPath: '/unrelated-control.pdf',
        unrelatedExpectedStatuses: [200],
        terminalPath: '/remediated-terminal-route',
        terminalExpectedStatuses: [410],
      },
    });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

test('normal production check mode is offline and fails closed without sanitized evidence', () => {
  const result = spawnSync(process.execPath, [verifierPath, '--check'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' },
  });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /PRODUCTION_EVIDENCE_MISSING/u);
});

test('sanitized production evidence reconciles the exact artifact URL set without raw headers or secrets', async () => {
  const { validateProductionEvidence } = await import('../scripts/verify-production.mjs');
  assert.equal(typeof validateProductionEvidence, 'function');

  const { artifact, authority } = localOriginArtifact();
  const { files } = artifact;
  const evidenceUrls = files
    .filter(({ path }) => path !== 'apps/.htaccess')
    .map(({ path, sha256, mediaType }) => ({
      path: `/${path.replace(/index\.html$/u, '')}`,
      status: 200,
      redirects: 0,
      contentType: mediaType,
      sha256,
      headerProfile: path.startsWith('apps/') ? 'miniapp-security' : (path.startsWith('app/') ? 'legal-frame-blocked' : 'aasa'),
      cookieFree: true,
      canonical: true,
    }));
  const evidence = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-production-verification',
    releaseId: artifact.releaseId,
    sourceCommit: 'c'.repeat(40),
    deployedAt: '2026-08-18T01:02:03.000Z',
    origin: {
      status: 'verified',
      checkedAt: '2026-08-18T01:03:03.000Z',
      rootStatus: 200,
      unknownSlugStatus: 404,
      unknownSlugNonceSha256: 'f'.repeat(64),
      urls: evidenceUrls,
    },
    serverInventory: {
      schemaVersion: 1,
      artifactKind: 'cabohealth-server-inventory-v1',
      status: 'verified',
      releaseId: artifact.releaseId,
      rootCount: 3,
      fileCount: 16,
      paths: artifact.files.map(({ path }) => path),
      inventorySha256: artifact.inventorySha256,
    },
    browser: fixtureBrowserEvidence(artifact, authority),
    controls: { unrelatedAssetRetained: true, terminalRouteRetained: true },
    appleCdn: {
      status: 'pending-propagation',
      checkedAt: '2026-08-18T01:04:03.000Z',
      sha256: null,
    },
    rollback: {
      version: 'rollback-v1-opaque',
      stagedVerified: true,
      rehearsal: 'verified',
    },
  };

  const reviewedBrowserMeasurement = {
    reviewedBrowserMeasurementSha256: sha256(Buffer.from(`${JSON.stringify(evidence.browser)}\n`)),
  };
  assert.equal(validateProductionEvidence(evidence, artifact, authority, reviewedBrowserMeasurement), true);
  assert.throws(
    () => validateProductionEvidence(
      { ...evidence, rawHeaders: { server: 'secret' } },
      artifact,
      authority,
      reviewedBrowserMeasurement,
    ),
    /PRODUCTION_EVIDENCE_SCHEMA_INVALID/u,
  );
  const mutations = [
    ['missing URL', (value) => { value.origin.urls.pop(); }],
    ['release mismatch', (value) => { value.releaseId = `web-v1-${'0'.repeat(64)}`; }],
    ['timestamp type', (value) => { value.origin.checkedAt = 123; }],
    ['raw cookie key', (value) => { value.origin.urls[0].setCookie = 'secret=value'; }],
    ['private rollback path', (value) => { value.rollback.version = '/home/account/private/backup'; }],
    ['wrong CDN hash', (value) => { value.appleCdn = { ...value.appleCdn, status: 'verified', sha256: '0'.repeat(64) }; }],
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.throws(
      () => validateProductionEvidence(changed, artifact, authority, reviewedBrowserMeasurement),
      undefined,
      name,
    );
  }
});

test('origin verification accepts exact local HTTP responses and emits only sanitized booleans and hashes', async () => {
  const { verifyOrigin } = await import('../scripts/verify-production.mjs');
  assert.equal(typeof verifyOrigin, 'function');
  const { artifact, authority, bodies } = localOriginArtifact();
  const routeToPath = new Map([...bodies.keys()].map((path) => [
    `/${path.replace(/index\.html$/u, '')}`,
    path,
  ]));
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>control</title>');
      return;
    }
    if (request.url === '/unrelated-control.pdf') {
      response.writeHead(200, { 'Content-Type': 'application/pdf' });
      response.end('control');
      return;
    }
    if (request.url === '/remediated-terminal-route') {
      response.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('gone');
      return;
    }
    if (request.url === '/apps/' || request.url === '/apps/.htaccess') {
      response.writeHead(request.url === '/apps/' ? 403 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('blocked');
      return;
    }
    if (request.url?.startsWith('/apps/task-8-unknown-')) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('missing');
      return;
    }
    const path = routeToPath.get(request.url ?? '');
    const body = path ? bodies.get(path) : null;
    if (!path || !body) {
      response.writeHead(404);
      response.end();
      return;
    }
    const entry = artifact.files.find((item) => item.path === path);
    const headers = { 'Content-Type': entry.mediaType };
    if (path.startsWith('apps/')) {
      Object.assign(headers, {
        'Content-Security-Policy': miniappCsp,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      });
    } else if (path.startsWith('app/')) {
      headers['X-Frame-Options'] = 'DENY';
    }
    response.writeHead(200, headers);
    response.end(body);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const address = server.address();
    const result = await verifyOrigin({
      artifact,
      ...authority,
      baseUrl: `http://127.0.0.1:${address.port}`,
      sensitiveControls: {
        unrelatedPath: '/unrelated-control.pdf', unrelatedExpectedStatuses: [200],
        terminalPath: '/remediated-terminal-route', terminalExpectedStatuses: [410],
      },
    });
    assert.equal(result.rootStatus, 200);
    assert.equal(result.urls.length, 15);
    assert.equal(JSON.stringify(result).includes('headers'), false);
    assert.equal(JSON.stringify(result).includes('set-cookie'), false);
    assert.equal(result.urls.every(({ cookieFree }) => cookieFree === true), true);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('origin verifier rejects response, header, body, content, and negative-route mutations', async (context) => {
  const { verifyOrigin } = await import('../scripts/verify-production.mjs');
  const cases = [
    ['root outage', ({ requestUrl }) => requestUrl === '/' ? { status: 503 } : null, /WORDPRESS_CONTROL_FAILED/u],
    ['module redirect', ({ requestUrl }) => requestUrl === '/apps/healthy-recipes/' ? { status: 302, headers: { Location: '/' } } : null, /STATUS_INVALID/u],
    ['wrong content type', ({ path }) => path === 'apps/shared/styles.css' ? { headers: { 'Content-Type': 'text/plain; charset=utf-8' } } : null, /CONTENT_TYPE_INVALID/u],
    ['body tamper', ({ path, body }) => path === 'apps/shared/shell.js' ? { body: Buffer.concat([body, Buffer.from('tamper')]) } : null, /BODY_HASH_INVALID/u],
    ['missing CSP', ({ path }) => path === 'apps/clinic-guide/index.html' ? { removeHeaders: ['Content-Security-Policy'] } : null, /SECURITY_HEADER_INVALID/u],
    ['cookie', ({ path }) => path === 'apps/healthy-recipes/app.js' ? { headers: { 'Set-Cookie': 'secret=value' } } : null, /SET_COOKIE_FORBIDDEN/u],
    ['legal framing weakened', ({ path }) => path === 'app/privacy/index.html' ? { removeHeaders: ['X-Frame-Options'] } : null, /LEGAL_FRAMING_UNPROTECTED/u],
    ['canonical changed', ({ path, body }) => path === 'app/terms/index.html' ? { body: Buffer.from(body.toString().replace('/app/terms/', '/app/privacy/')) } : null, /BODY_HASH_INVALID|CANONICAL_INVALID/u],
    ['directory listing exposed', ({ requestUrl }) => requestUrl === '/apps/' ? { status: 200 } : null, /DIRECTORY_LISTING_EXPOSED/u],
    ['htaccess exposed', ({ requestUrl }) => requestUrl === '/apps/.htaccess' ? { status: 200 } : null, /HTACCESS_EXPOSED/u],
    ['unknown slug fallback', ({ requestUrl }) => requestUrl.startsWith('/apps/task-8-unknown-') ? { status: 200 } : null, /UNKNOWN_SLUG_NOT_MISSING/u],
    ['AASA tamper', ({ path, body }) => path === '.well-known/apple-app-site-association' ? { body: Buffer.concat([body, Buffer.from(' ')]) } : null, /BODY_HASH_INVALID|AASA_INVALID/u],
  ];
  for (const [name, mutate, expected] of cases) {
    await context.test(name, async () => {
      await assert.rejects(() => runMutatedOrigin(verifyOrigin, mutate), expected);
    });
  }
});

test('Apple CDN verifier rejects stale, redirecting, cookie-bearing, wrong-type, and unauthorized endpoints', async (context) => {
  const { verifyAppleCdn } = await import('../scripts/verify-production.mjs');
  const { artifact, authority, bodies } = localOriginArtifact();
  const expectedBody = bodies.get('.well-known/apple-app-site-association');
  async function run({ body = expectedBody, status = 200, headers = { 'Content-Type': 'application/json' } } = {}) {
    const server = createServer((_request, response) => {
      response.writeHead(status, headers);
      response.end(body);
    });
    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    try {
      const address = server.address();
      return await verifyAppleCdn({
        artifact,
        ...authority,
        url: `http://127.0.0.1:${address.port}/aasa`,
      });
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
  }
  assert.deepEqual(await run(), { status: 'verified', sha256: artifact.files[0].sha256 });
  const cases = [
    ['stale body', { body: Buffer.from('{}\n') }, /APPLE_CDN_PENDING_PROPAGATION/u],
    ['redirect', { status: 302, headers: { Location: '/other' } }, /APPLE_CDN_RESPONSE_INVALID/u],
    ['wrong type', { headers: { 'Content-Type': 'text/plain' } }, /APPLE_CDN_CONTENT_TYPE_INVALID/u],
    ['cookie', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=value' } }, /APPLE_CDN_SET_COOKIE_FORBIDDEN/u],
  ];
  for (const [name, options, expected] of cases) {
    await context.test(name, async () => assert.rejects(() => run(options), expected));
  }
  await assert.rejects(
    () => verifyAppleCdn({ artifact, ...authority, url: 'http://169.254.169.254/latest/meta-data' }),
    /APPLE_CDN_NETWORK_FORBIDDEN/u,
  );
  await assert.rejects(
    () => verifyAppleCdn({ artifact, ...authority, url: 'http://127.0.0.1:1/aasa?target=https://evil.invalid' }),
    /APPLE_CDN_NETWORK_FORBIDDEN/u,
  );
  await assert.rejects(
    () => verifyAppleCdn({ artifact, ...authority, productionConfirmation: 'wrong-host' }),
    /APPLE_CDN_NETWORK_FORBIDDEN/u,
  );
});
