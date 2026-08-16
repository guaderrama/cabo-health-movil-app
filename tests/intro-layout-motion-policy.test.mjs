import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const compile = spawnSync(
  process.execPath,
  [join(projectRoot, 'node_modules/typescript/bin/tsc'), '--project', join(projectRoot, 'tsconfig.node-tests.json')],
  { cwd: projectRoot, encoding: 'utf8' },
);

assert.equal(compile.status, 0, compile.stderr || compile.stdout);

const require = createRequire(import.meta.url);
const {
  allowsMoleculeMotion,
  createMoleculeLoopController,
  resolveReducedMotion,
} = require(join(projectRoot, '.test-build/features/motion/moleculeMotionPolicy.js'));
const {
  calculateIntroLayout,
} = require(join(projectRoot, '.test-build/features/onboarding/introLayout.js'));

test('molecule policy stays static until focus, foreground, and explicit full motion agree', () => {
  assert.equal(allowsMoleculeMotion({ active: true, appActive: true, reduceMotion: null }), false);
  assert.equal(allowsMoleculeMotion({ active: false, appActive: true, reduceMotion: false }), false);
  assert.equal(allowsMoleculeMotion({ active: true, appActive: false, reduceMotion: false }), false);
  assert.equal(allowsMoleculeMotion({ active: true, appActive: true, reduceMotion: true }), false);
  assert.equal(allowsMoleculeMotion({ active: true, appActive: true, reduceMotion: false }), true);
});

test('failed Reduce Motion lookup resolves conservatively to static motion', async () => {
  assert.equal(await resolveReducedMotion(async () => Promise.reject(new Error('unavailable'))), true);
  assert.equal(await resolveReducedMotion(async () => false), false);
});

test('molecule lifecycle owns one loop and stops before each static transition', () => {
  const events = [];
  let nextHandle = 1;
  const controller = createMoleculeLoopController({
    start() {
      const handle = nextHandle++;
      events.push(['start', handle]);
      return handle;
    },
    stop(handle) {
      events.push(['stop', handle]);
    },
    showStatic() {
      events.push(['static']);
    },
  });

  controller.reconcile(false);
  controller.reconcile(true);
  controller.reconcile(true);
  controller.reconcile(false);
  controller.reconcile(false);
  controller.reconcile(true);
  controller.destroy();

  assert.deepEqual(events, [
    ['static'],
    ['start', 1],
    ['stop', 1],
    ['static'],
    ['start', 2],
    ['stop', 2],
    ['static'],
  ]);
});

test('normal portrait layout keeps the logo near 18 percent and all content in safe flow', () => {
  const result = calculateIntroLayout({
    width: 390,
    height: 844,
    fontScale: 1,
    insets: { top: 47, right: 0, bottom: 34, left: 0 },
  });
  const logoCenter = result.safeTop + result.topSpacer + result.logoSize / 2;

  assert.equal(result.compact, false);
  assert.ok(logoCenter / 844 >= 0.18 && logoCenter / 844 <= 0.2);
  assert.equal(result.contentMinHeight, 763);
  assert.ok(result.logoSize >= 200);
  assert.ok(result.messageCtaGap >= 24);
  assert.equal(result.horizontalPaddingLeft, 27);
  assert.equal(result.horizontalPaddingRight, 27);
});

test('landscape and large text use compact safe flow with scrolling when needed', () => {
  const result = calculateIntroLayout({
    width: 844,
    height: 390,
    fontScale: 2,
    insets: { top: 0, right: 44, bottom: 21, left: 44 },
  });

  assert.equal(result.compact, true);
  assert.equal(result.safeTop, 0);
  assert.equal(result.contentMinHeight, 369);
  assert.equal(result.horizontalPaddingLeft, 71);
  assert.equal(result.horizontalPaddingRight, 71);
  assert.ok(result.logoSize <= 110);
  assert.ok(result.topSpacer >= 0);
  assert.ok(result.identityGap >= 8);
  assert.ok(result.messageGap >= 12);
  assert.ok(result.messageCtaGap >= 18);
  assert.equal(result.requiresScrolling, true);
});
