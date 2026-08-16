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
  INTRO_AUTO_CONTINUE_MS,
  createIntroContinuation,
  getIntroAutoContinueDelay,
  shouldShowIntro,
} = require(join(projectRoot, '.test-build/features/onboarding/introTiming.js'));
const {
  ONBOARDING_COMPLETION_KEY,
  readOnboardingCompletion,
  writeOnboardingCompletion,
} = require(join(projectRoot, '.test-build/features/onboarding/onboardingStore.js'));

test('normal intro continuation waits exactly 1600 ms and stays below the launch limit', () => {
  assert.equal(INTRO_AUTO_CONTINUE_MS, 1600);
  assert.equal(getIntroAutoContinueDelay(false), 1600);
  assert.ok(getIntroAutoContinueDelay(false) < 1800);
});

test('first use shows the intro while later launches skip unless replay is requested', () => {
  assert.equal(shouldShowIntro({ completed: false }), true);
  assert.equal(shouldShowIntro({ completed: true }), false);
  assert.equal(shouldShowIntro({ completed: true, replay: '1' }), true);
  assert.equal(shouldShowIntro({ completed: true, replay: ['1', 'ignored'] }), true);
  assert.equal(shouldShowIntro({ completed: true, replay: '0' }), false);
});

test('reduced motion completes without scheduling a forced delay', async () => {
  const scheduledDelays = [];
  let completionCount = 0;
  const continuation = createIntroContinuation({
    reduceMotion: true,
    schedule(callback, delayMs) {
      scheduledDelays.push(delayMs);
      return { callback };
    },
    cancel() {},
    async onComplete() {
      completionCount += 1;
    },
  });

  continuation.start();
  await continuation.completion;

  assert.equal(getIntroAutoContinueDelay(true), 0);
  assert.deepEqual(scheduledDelays, []);
  assert.equal(completionCount, 1);
});

test('CTA completion is idempotent and cancels the pending automatic path', async () => {
  let scheduledCallback;
  const cancelledHandles = [];
  let completionCount = 0;
  const timerHandle = { id: 'intro-timer' };
  const continuation = createIntroContinuation({
    reduceMotion: false,
    schedule(callback, delayMs) {
      assert.equal(delayMs, 1600);
      scheduledCallback = callback;
      return timerHandle;
    },
    cancel(handle) {
      cancelledHandles.push(handle);
    },
    async onComplete() {
      completionCount += 1;
    },
  });

  continuation.start();
  await Promise.all([continuation.complete(), continuation.complete()]);
  scheduledCallback();
  await continuation.completion;

  assert.equal(completionCount, 1);
  assert.deepEqual(cancelledHandles, [timerHandle]);
});

test('blur cancellation invalidates an already dequeued automatic callback', async () => {
  let scheduledCallback;
  let completionCount = 0;
  const continuation = createIntroContinuation({
    reduceMotion: false,
    schedule(callback) {
      scheduledCallback = callback;
      return { id: 'focus-owned-timer' };
    },
    cancel() {},
    async onComplete() {
      completionCount += 1;
    },
  });

  continuation.start();
  continuation.cancelPending();
  scheduledCallback();
  await Promise.resolve();

  assert.equal(completionCount, 0);
});

test('onboarding completion persists one boolean under the single onboarding key', async () => {
  const values = new Map();
  const operations = [];
  const storage = {
    async getItem(key) {
      operations.push(['getItem', key]);
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      operations.push(['setItem', key, value]);
      values.set(key, value);
    },
  };

  assert.equal(await readOnboardingCompletion(storage), false);
  await writeOnboardingCompletion(storage, true);

  assert.equal(await readOnboardingCompletion(storage), true);
  assert.deepEqual([...values.entries()], [[ONBOARDING_COMPLETION_KEY, 'true']]);
  assert.deepEqual(
    [...new Set(operations.map(([, key]) => key))],
    [ONBOARDING_COMPLETION_KEY],
  );
});
