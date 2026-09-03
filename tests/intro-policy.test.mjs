import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  createIntroContinuation,
} = require(join(projectRoot, '.test-build/features/onboarding/introTiming.js'));
const {
  ONBOARDING_COMPLETION_KEY,
  readOnboardingCompletion,
  writeOnboardingCompletion,
} = require(join(projectRoot, '.test-build/features/onboarding/onboardingStore.js'));

test('normal launch waits for explicit ENTER without scheduling a delay', async () => {
  let completionCount = 0;
  const continuation = createIntroContinuation({
    async onComplete() {
      completionCount += 1;
    },
  });

  await Promise.resolve();

  assert.equal(completionCount, 0);

  await continuation.complete();
  assert.equal(completionCount, 1);
});

test('the launch route gates the app behind ENTER without persisted onboarding or timers', () => {
  const entrySource = readFileSync(join(projectRoot, 'app/index.tsx'), 'utf8');
  const introSource = readFileSync(
    join(projectRoot, 'features/onboarding/IntroScreen.tsx'),
    'utf8',
  );

  assert.match(entrySource, /return <IntroScreen onComplete=\{completeIntro\} \/>/u);
  assert.match(entrySource, /router\.replace\('\/\(main\)'\)/u);
  assert.doesNotMatch(entrySource, /OnboardingCompleted|has_seen_onboarding|services\/storage/u);
  assert.doesNotMatch(entrySource, /removeItem|\.clear\(/u);

  assert.match(introSource, /onPress=\{handleEnter\}/u);
  assert.match(introSource, /const \{ t \} = useTranslations\(\)/u);
  assert.match(introSource, /t\('intro\.tagline'\)/u);
  assert.match(introSource, /t\('intro\.message'\)/u);
  assert.match(introSource, /t\('intro\.enter'\)/u);
  assert.match(introSource, /accessibilityLabel=\{t\('intro\.enterLabel'\)\}/u);
  assert.match(introSource, /accessibilityHint=\{t\('intro\.enterHint'\)\}/u);
  assert.doesNotMatch(introSource, /LONGEVITY, GROUNDED IN SCIENCE/u);
  assert.doesNotMatch(introSource, /PRECISION LONGEVITY MEDICINE/u);
  assert.doesNotMatch(introSource, /setTimeout|INTRO_AUTO_CONTINUE_MS/u);
});

test('ENTER completion is idempotent', async () => {
  let completionCount = 0;
  const continuation = createIntroContinuation({
    async onComplete() {
      completionCount += 1;
    },
  });

  await Promise.all([continuation.complete(), continuation.complete()]);

  assert.equal(completionCount, 1);
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
