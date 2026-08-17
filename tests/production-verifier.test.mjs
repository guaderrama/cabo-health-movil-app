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
    kind: 'fixture',
  }));
  return {
    artifact: { releaseId: `web-v1-${'d'.repeat(64)}`, inventorySha256: 'd'.repeat(64), files },
    bodies,
  };
}

async function runMutatedOrigin(verifyOrigin, mutate) {
  const { artifact, bodies } = localOriginArtifact();
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
    return await verifyOrigin({ artifact, baseUrl: `http://127.0.0.1:${address.port}` });
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

  const files = [
    ['.well-known/apple-app-site-association', 'application/json'],
    ['app/privacy/index.html', 'text/html; charset=utf-8'],
    ['app/report-content/index.html', 'text/html; charset=utf-8'],
    ['app/support/index.html', 'text/html; charset=utf-8'],
    ['app/terms/index.html', 'text/html; charset=utf-8'],
    ['apps/.htaccess', 'text/plain; charset=utf-8'],
    ['apps/clinic-guide/app.js', 'text/javascript; charset=utf-8'],
    ['apps/clinic-guide/index.html', 'text/html; charset=utf-8'],
    ['apps/healthy-recipes/app.js', 'text/javascript; charset=utf-8'],
    ['apps/healthy-recipes/index.html', 'text/html; charset=utf-8'],
    ['apps/shared/logo.png', 'image/png'],
    ['apps/shared/motion.js', 'text/javascript; charset=utf-8'],
    ['apps/shared/shell.js', 'text/javascript; charset=utf-8'],
    ['apps/shared/styles.css', 'text/css; charset=utf-8'],
  ].map(([path, mediaType]) => ({
    path,
    size: 1,
    sha256: 'a'.repeat(64),
    mediaType,
    deployMode: '0644',
    kind: path.startsWith('apps/') ? 'task6b-miniapp' : 'task7-legal',
  }));
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    releaseId: `web-v1-${'b'.repeat(64)}`,
    inventorySha256: 'b'.repeat(64),
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [],
    inputs: [],
    files,
  };
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
      urls: evidenceUrls,
    },
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

  assert.equal(validateProductionEvidence(evidence, artifact), true);
  assert.throws(
    () => validateProductionEvidence({ ...evidence, rawHeaders: { server: 'secret' } }, artifact),
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
    assert.throws(() => validateProductionEvidence(changed, artifact), undefined, name);
  }
});

test('origin verification accepts exact local HTTP responses and emits only sanitized booleans and hashes', async () => {
  const { verifyOrigin } = await import('../scripts/verify-production.mjs');
  assert.equal(typeof verifyOrigin, 'function');
  const { artifact, bodies } = localOriginArtifact();
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
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    assert.equal(result.rootStatus, 200);
    assert.equal(result.urls.length, 13);
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
