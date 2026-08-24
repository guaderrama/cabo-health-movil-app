import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const firebaseCli = join(
  repositoryRoot,
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js',
);
const probeCommand = 'node --test tests/emulator/firestore-deny-all.test.mjs';
const runs = [
  { config: 'firebase.emulator.json', ruleset: 'production' },
  { config: 'firebase.emulator.review.json', ruleset: 'review' },
];

for (const run of runs) {
  console.log(`Verifying Firestore ${run.ruleset} rules in an isolated emulator...`);
  const result = spawnSync(
    process.execPath,
    [
      firebaseCli,
      'emulators:exec',
      '--config',
      run.config,
      '--project',
      'demo-cabohealth',
      '--only',
      'firestore',
      probeCommand,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CABOHEALTH_EMULATOR_RULESET: run.ruleset,
      },
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
