import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  REVIEW_DATABASE_PLACEHOLDER,
  buildDeployFirebaseConfig,
  createFirebaseDeployConfigEvidence,
  executeFirebaseActivationConfigCommand,
  parseFirebaseActivationConfigArguments,
} from '../scripts/firebase-activation-config.mjs';

const repositoryRoot = new URL('../', import.meta.url);

test('deploy config binds the default and exact named review databases to separate rules and indexes', async () => {
  const baseConfig = JSON.parse(await readFile(new URL('firebase.json', repositoryRoot), 'utf8'));
  const config = buildDeployFirebaseConfig({
    baseConfig,
    environment: 'production',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
  });

  assert.deepEqual(config.firestore, [
    {
      database: '(default)',
      indexes: 'firestore.indexes.json',
      rules: 'firestore.rules',
    },
    {
      database: 'cabohealth-review-production',
      indexes: 'firestore.review.indexes.json',
      rules: 'firestore.review.rules',
    },
  ]);
  assert.equal(JSON.stringify(config).includes(REVIEW_DATABASE_PLACEHOLDER), false);
});

test('deploy config fails closed on an ambiguous environment, project, or review database', async () => {
  const baseConfig = JSON.parse(await readFile(new URL('firebase.json', repositoryRoot), 'utf8'));
  const valid = {
    baseConfig,
    environment: 'production',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
  };

  for (const input of [
    { ...valid, environment: 'prod' },
    { ...valid, projectId: 'cabohealth-owner-staging' },
    { ...valid, projectId: 'UNCONFIGURED_CABOHEALTH_PRODUCTION_PROJECT_ID' },
    { ...valid, reviewDatabaseId: '(default)' },
    { ...valid, reviewDatabaseId: 'cabohealth-review-local-only' },
    { ...valid, reviewDatabaseId: REVIEW_DATABASE_PLACEHOLDER },
  ]) {
    assert.throws(() => buildDeployFirebaseConfig(input), /firebase_activation_config_invalid/u);
  }

  assert.equal(
    baseConfig.firestore[1].database,
    REVIEW_DATABASE_PLACEHOLDER,
    'rendering must not mutate the checked-in fail-closed template',
  );
});

test('deploy config refuses a drifted or expanded Firestore topology', async () => {
  const baseConfig = JSON.parse(await readFile(new URL('firebase.json', repositoryRoot), 'utf8'));
  const valid = {
    environment: 'production',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
  };
  const malformed = [
    { ...baseConfig, firestore: [...baseConfig.firestore, baseConfig.firestore[0]] },
    {
      ...baseConfig,
      firestore: [
        { ...baseConfig.firestore[0], rules: 'unexpected.rules' },
        baseConfig.firestore[1],
      ],
    },
    {
      ...baseConfig,
      firestore: [
        baseConfig.firestore[0],
        { ...baseConfig.firestore[1], indexes: 'unexpected.indexes.json' },
      ],
    },
  ];

  for (const candidate of malformed) {
    assert.throws(
      () => buildDeployFirebaseConfig({ ...valid, baseConfig: candidate }),
      /firebase_activation_config_invalid/u,
    );
  }
});

test('emulator configs map each production ruleset to an isolated default database', async () => {
  const expectedEmulators = {
    firestore: { port: 8080 },
    singleProjectMode: true,
    ui: { enabled: false },
  };
  const cases = [
    ['firebase.emulator.json', 'firestore.indexes.json', 'firestore.rules'],
    [
      'firebase.emulator.review.json',
      'firestore.review.indexes.json',
      'firestore.review.rules',
    ],
  ];

  for (const [configFile, indexes, rules] of cases) {
    const config = JSON.parse(
      await readFile(new URL(configFile, repositoryRoot), 'utf8'),
    );

    assert.deepEqual(config.firestore, { indexes, rules });
    assert.deepEqual(config.emulators, expectedEmulators);
  }
});

test('the pinned local Firebase CLI probes both rulesets in separate emulator executions', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', repositoryRoot), 'utf8'),
  );
  const verifier = await readFile(
    new URL('scripts/verify-firestore-rules-emulator.mjs', repositoryRoot),
    'utf8',
  );
  const probe = await readFile(
    new URL('tests/emulator/firestore-deny-all.test.mjs', repositoryRoot),
    'utf8',
  );

  assert.equal(packageJson.devDependencies['firebase-tools'], '15.28.1');
  assert.equal(
    packageJson.scripts['test:firestore-rules:emulator'],
    'node scripts/verify-firestore-rules-emulator.mjs',
  );
  assert.match(verifier, /firebase\.emulator\.json/u);
  assert.match(verifier, /firebase\.emulator\.review\.json/u);
  assert.match(
    verifier,
    /'firebase-tools',\s*'lib',\s*'bin',\s*'firebase\.js'/u,
  );
  assert.match(verifier, /demo-cabohealth/u);
  assert.match(probe, /CABOHEALTH_EMULATOR_RULESET/u);
  assert.match(probe, /databases\/\$\{DATABASE_ID\}/u);
  assert.doesNotMatch(probe, /cabohealth-review-emulator/u);
  assert.match(probe, /method: 'PATCH'/u);
  assert.match(probe, /response\.status, 403/u);
});

test('deploy config renderer requires exact closed arguments and emits a sanitized project-bound hash', async () => {
  const arguments_ = [
    '--environment', 'production',
    '--project-id', 'cabohealth-owner-prod',
    '--review-database-id', 'cabohealth-review-production',
    '--out', '/private/firebase.production.json',
  ];
  assert.deepEqual(parseFirebaseActivationConfigArguments(arguments_), {
    environment: 'production',
    out: '/private/firebase.production.json',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
  });
  for (const candidate of [
    [...arguments_, '--url', 'https://example.org/'],
    [...arguments_, '--project-id', 'cabohealth-other-prod'],
    arguments_.slice(0, -2),
  ]) {
    assert.throws(
      () => parseFirebaseActivationConfigArguments(candidate),
      /firebase_activation_config_arguments_invalid/u,
    );
  }

  const baseConfig = JSON.parse(await readFile(new URL('firebase.json', repositoryRoot), 'utf8'));
  const config = buildDeployFirebaseConfig({
    baseConfig,
    environment: 'production',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
  });
  const evidence = createFirebaseDeployConfigEvidence({
    config,
    environment: 'production',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
  });
  assert.match(evidence.configSha256, /^[a-f0-9]{64}$/u);
  assert.equal(evidence.containsSensitiveValues, false);
  assert.equal(JSON.stringify(evidence).includes('/private/'), false);
});

test('deploy config execution writes only a private reviewed artifact and never deploys it', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'cabohealth-firebase-config-'));
  try {
    const privateDirectory = join(temporaryRoot, 'release', 'private');
    await mkdir(privateDirectory, { mode: 0o700, recursive: true });
    const baseConfig = JSON.parse(await readFile(new URL('firebase.json', repositoryRoot), 'utf8'));
    await writeFile(
      join(temporaryRoot, 'firebase.json'),
      `${JSON.stringify(baseConfig, null, 2)}\n`,
    );
    const out = join(privateDirectory, 'firebase.production.json');

    const evidence = await executeFirebaseActivationConfigCommand({
      command: {
        environment: 'production',
        out,
        projectId: 'cabohealth-owner-prod',
        reviewDatabaseId: 'cabohealth-review-production',
      },
      repositoryRoot: temporaryRoot,
    });
    const rendered = JSON.parse(await readFile(out, 'utf8'));

    assert.equal(rendered.firestore[1].database, 'cabohealth-review-production');
    assert.equal(rendered.functions[0].source, join(temporaryRoot, 'functions'));
    assert.deepEqual(
      rendered.firestore.map(({ indexes, rules }) => ({ indexes, rules })),
      [
        {
          indexes: join(temporaryRoot, 'firestore.indexes.json'),
          rules: join(temporaryRoot, 'firestore.rules'),
        },
        {
          indexes: join(temporaryRoot, 'firestore.review.indexes.json'),
          rules: join(temporaryRoot, 'firestore.review.rules'),
        },
      ],
    );
    assert.equal(JSON.stringify(rendered).includes(REVIEW_DATABASE_PLACEHOLDER), false);
    assert.equal(evidence.status, 'rendered');
    assert.equal((await stat(out)).mode & 0o077, 0);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('activation commands are reproducible and Firebase parameter files stay out of git and EAS', async () => {
  const rootPackage = JSON.parse(await readFile(new URL('package.json', repositoryRoot), 'utf8'));
  const functionsPackage = JSON.parse(
    await readFile(new URL('functions/package.json', repositoryRoot), 'utf8'),
  );
  const gitignore = await readFile(new URL('.gitignore', repositoryRoot), 'utf8');
  const easignore = await readFile(new URL('.easignore', repositoryRoot), 'utf8');

  assert.equal(
    rootPackage.scripts['firebase:config'],
    'node scripts/firebase-activation-config.mjs',
  );
  assert.equal(
    rootPackage.scripts['firebase:bootstrap'],
    'npm --prefix functions run bootstrap:firebase --',
  );
  assert.equal(
    functionsPackage.scripts['bootstrap:firebase'],
    'npm run build && node lib/tools/bootstrapFirebase.js',
  );
  assert.match(gitignore, /^\/functions\/\.env\.\*$/mu);
  assert.match(easignore, /^functions\/$/mu);
  assert.match(easignore, /^release\/private\/$/mu);
});

test('activation runbook keeps local verification separate from owner-approved cloud mutations', async () => {
  const runbook = await readFile(
    new URL('docs/operations/firebase-activation.md', repositoryRoot),
    'utf8',
  );

  for (const expected of [
    'https://firebase.google.com/docs/cli#cloud-firestore',
    'https://firebase.google.com/docs/emulator-suite/connect_firestore',
    'https://firebase.google.com/docs/firestore/manage-databases',
    'npm run test:firestore-rules:emulator',
    'npm run firebase:config --',
    'firebase firestore:databases:create',
    '--config /ABSOLUTE/REPO/release/private/firebase.production.json',
    'npm run firebase:bootstrap --',
    '--reviewed-plan-sha256',
    'OWNER APPROVAL REQUIRED',
  ]) {
    assert.match(runbook, new RegExp(escapeRegExp(expected), 'u'));
  }
  assert.match(runbook, /functions\/\.env\.<project_ID>/u);
  assert.match(runbook, /APP_REVIEW_FIRESTORE_DATABASE_ID/u);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
