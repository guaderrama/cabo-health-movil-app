import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const landingPath = fileURLToPath(new URL('../web-hosting/cabohealth.org/app/index.html', import.meta.url));
const appHeadersPath = fileURLToPath(new URL('../web-hosting/cabohealth.org/app/.htaccess', import.meta.url));
const marketingGatePath = join(projectRoot, 'scripts/verify-marketing-url.mjs');
const marketingRunbookPath = join(projectRoot, 'docs/operations/marketing-url.md');
const marketingCsp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

test('the Marketing URL publishes the exact bilingual App Store scope', () => {
  const html = readFileSync(landingPath, 'utf8');

  assert.match(html, /<html\s+lang="en">/u);
  assert.match(html, /<link\s+rel="canonical"\s+href="https:\/\/cabohealth\.org\/app\/">/u);
  assert.match(html, /<article\b[^>]*\blang="en"/u);
  assert.match(html, /<article\b[^>]*\blang="es-MX"/u);
  assert.match(html, /Two public editorial resources/u);
  assert.match(html, /Dos recursos editoriales públicos/u);
  assert.match(html, /up to four eligible existing in-person clients/u);
  assert.match(html, /hasta cuatro clientes presenciales existentes que cumplan los requisitos/u);
});

test('the Marketing URL has no executable, tracking, form, or cookie surface', () => {
  const html = readFileSync(landingPath, 'utf8');
  const headers = readFileSync(appHeadersPath, 'utf8');

  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${marketingCsp}">`));
  assert.match(html, /<meta\s+name="referrer"\s+content="no-referrer">/u);
  assert.doesNotMatch(html, /<(?:script|img|iframe|object|embed|form|input|button|video|audio|source)\b/iu);
  assert.doesNotMatch(html, /(?:analytics|tracking|pixel|tagmanager|doubleclick|facebook\.net|localStorage|sessionStorage|document\.cookie)/iu);
  assert.ok(headers.includes(`Header always set Content-Security-Policy "${marketingCsp}"`));
  assert.match(headers, /Header always unset Set-Cookie/u);
  assert.match(headers, /Header always set Referrer-Policy "no-referrer"/u);
  assert.match(headers, /Header always set Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)"/u);
});

test('the bilingual landing remains keyboard, mobile, and landmark accessible', () => {
  const html = readFileSync(landingPath, 'utf8');

  assert.match(html, /<a\s+class="skip-link"\s+href="#content">/u);
  assert.match(html, /<nav\s+class="language-nav"\s+aria-label="Language \/ Idioma">/u);
  assert.match(html, /<a\s+href="#english"\s+hreflang="en">English<\/a>/u);
  assert.match(html, /<a\s+href="#espanol"\s+hreflang="es-MX">Español<\/a>/u);
  assert.match(html, /<main\s+id="content"/u);
  assert.match(html, /<article\s+id="english"\s+lang="en"\s+aria-labelledby="english-title">/u);
  assert.match(html, /<article\s+id="espanol"\s+lang="es-MX"\s+aria-labelledby="espanol-title">/u);
  assert.match(html, /<nav\b[^>]*\baria-label="Legal and support \/ Legal y soporte"/u);
  assert.match(html, /:focus-visible/u);
  assert.match(html, /@media\s*\(max-width:\s*48rem\)/u);
  assert.match(html, /The content is educational only and is not medical advice or an emergency service\./u);
  assert.match(html, /El contenido es únicamente educativo; no es orientación médica ni un servicio de emergencias\./u);
});

test('the Marketing URL source gate reports reviewed source without claiming a live deployment', () => {
  const result = spawnSync(process.execPath, [marketingGatePath, '--source'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    artifactKind: 'cabohealth-marketing-url-source-gate-v1',
    status: 'source-verified',
    marketingUrl: 'https://cabohealth.org/app/',
    sourcePath: 'web-hosting/cabohealth.org/app/index.html',
    sourceSha256: JSON.parse(result.stdout).sourceSha256,
    legacyRepositoryArtifact: 'absent',
    productionVerified: false,
  });
  assert.match(JSON.parse(result.stdout).sourceSha256, /^[a-f0-9]{64}$/u);
});

test('the source gate rejects a second resource link even when CSP would block its fetch', async () => {
  const gate = await import('../scripts/verify-marketing-url.mjs');
  const html = readFileSync(landingPath, 'utf8').replace(
    '<link rel="canonical" href="https://cabohealth.org/app/">',
    '<link rel="canonical" href="https://cabohealth.org/app/">\n  <link rel="preload" href="https://assets.example/marketing.woff2">',
  );

  assert.throws(() => gate.verifyMarketingSource({
    html,
    headers: readFileSync(appHeadersPath, 'utf8'),
    trackedFiles: ['web-hosting/cabohealth.org/app/index.html'],
  }), /MARKETING_URL_EXTERNAL_RESOURCE_FORBIDDEN/u);
});

test('the release gate stays closed until every versioned Marketing URL points to the new canonical page', async (context) => {
  const gate = await import('../scripts/verify-marketing-url.mjs');
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'cabohealth-marketing-metadata-'));
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const metadataRoot = join(fixtureRoot, 'release/app-store/3.0');
  mkdirSync(metadataRoot, { recursive: true });
  const writeMetadata = ({ manifest, en, es }) => {
    writeFileSync(join(metadataRoot, 'release-manifest.json'), `${JSON.stringify({ urls: { marketing: manifest } })}\n`);
    writeFileSync(join(metadataRoot, 'en-US.md'), `## Marketing URL\n${en}\n`);
    writeFileSync(join(metadataRoot, 'es-MX.md'), `## Marketing URL\n${es}\n`);
  };
  const canonical = 'https://cabohealth.org/app/';
  const oldUrl = 'https://cabohealth.org/';

  for (const candidate of [
    { manifest: oldUrl, en: canonical, es: canonical },
    { manifest: canonical, en: oldUrl, es: canonical },
    { manifest: canonical, en: canonical, es: oldUrl },
  ]) {
    writeMetadata(candidate);
    assert.throws(
      () => gate.verifyMarketingReleaseMetadata(fixtureRoot),
      /MARKETING_URL_METADATA_NOT_UPDATED/u,
    );
  }

  writeMetadata({ manifest: canonical, en: canonical, es: canonical });
  assert.deepEqual(gate.verifyMarketingReleaseMetadata(fixtureRoot), {
    manifest: canonical,
    'en-US': canonical,
    'es-MX': canonical,
  });
});

test('the production verifier accepts only the exact live URL, headers, and reviewed bytes', async () => {
  const gate = await import('../scripts/verify-marketing-url.mjs');
  assert.equal(typeof gate.verifyMarketingProductionResponse, 'function');
  const sourceHtml = readFileSync(landingPath, 'utf8');
  const sourceSha256 = JSON.parse(spawnSync(process.execPath, [marketingGatePath, '--source'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).stdout).sourceSha256;

  assert.deepEqual(gate.verifyMarketingProductionResponse({
    sourceHtml,
    responseUrl: 'https://cabohealth.org/app/',
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': marketingCsp,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'set-cookie': null,
    },
    body: sourceHtml,
  }), {
    schemaVersion: 1,
    artifactKind: 'cabohealth-marketing-url-production-gate-v1',
    status: 'production-verified',
    marketingUrl: 'https://cabohealth.org/app/',
    sourceSha256,
    finalUrl: 'https://cabohealth.org/app/',
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
    setCookie: false,
  });
});

test('a live production fetch requires an explicit action-time confirmation and cannot change origin', async () => {
  const gate = await import('../scripts/verify-marketing-url.mjs');
  assert.equal(typeof gate.fetchAndVerifyMarketingProduction, 'function');
  const sourceHtml = readFileSync(landingPath, 'utf8');
  let fetchCalls = 0;
  const fetchImpl = async (url, options) => {
    fetchCalls += 1;
    assert.equal(url, 'https://cabohealth.org/app/');
    assert.deepEqual(options, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    return {
      url,
      status: 200,
      headers: {
        get(name) {
          return {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': marketingCsp,
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            'set-cookie': null,
          }[name.toLowerCase()] ?? null;
        },
      },
      async text() { return sourceHtml; },
    };
  };

  await assert.rejects(
    gate.fetchAndVerifyMarketingProduction({ sourceHtml, confirmed: false, fetchImpl }),
    /MARKETING_URL_PRODUCTION_CONFIRMATION_REQUIRED/u,
  );
  assert.equal(fetchCalls, 0);
  const report = await gate.fetchAndVerifyMarketingProduction({ sourceHtml, confirmed: true, fetchImpl });
  assert.equal(fetchCalls, 1);
  assert.equal(report.status, 'production-verified');
});

test('the legacy-page runbook records the repository audit and requires an authorized origin decision', () => {
  const runbook = readFileSync(marketingRunbookPath, 'utf8');
  const tracked = spawnSync('git', ['ls-files'], { cwd: projectRoot, encoding: 'utf8' });

  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(tracked.stdout.split('\n').filter((path) => path.toLowerCase().endsWith('cabohealth-app.html')).length, 0);
  assert.match(runbook, /Repository result: `cabohealth-app\.html` is not tracked/u);
  assert.match(runbook, /Do not create, overwrite, rename, or delete a remote file to make the repository match an assumption/u);
  assert.match(runbook, /RedirectMatch 301 \^\/cabohealth-app\\\.html\$ https:\/\/cabohealth\.org\/app\//u);
  assert.match(runbook, /410 Gone/u);
  assert.match(runbook, /X-Robots-Tag: noindex, nofollow, noarchive/u);
  assert.match(runbook, /No deployment was performed/u);
  assert.match(runbook, /node scripts\/verify-marketing-url\.mjs --release --confirm-production-fetch/u);
});
