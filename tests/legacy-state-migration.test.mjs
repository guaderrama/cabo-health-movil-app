import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const migrationSource = readFileSync(
  new URL('../features/migrations/removeLegacyPrivateState.ts', import.meta.url),
  'utf8',
);
const compiledMigration = ts.transpileModule(migrationSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  LEGACY_PRIVATE_STATE_KEYS,
  PUBLIC_V1_MIGRATION_MARKER,
  removeLegacyPrivateState,
  settleLegacyPrivateStateMigration,
} = await import(`data:text/javascript;base64,${Buffer.from(compiledMigration).toString('base64')}`);

const PRIVATE_KEYS = [
  '@cabohealth_access_code',
  '@cabohealth_client_name',
  '@cabohealth_biometry_enabled',
  '@cabohealth_last_background_time',
  '@cabohealth_cached_apps',
  '@cabohealth_last_sync',
];

function createStorage(initialEntries) {
  const values = new Map(initialEntries);
  const operations = [];

  return {
    values,
    operations,
    async getItem(key) {
      operations.push(['getItem', key]);
      if (PRIVATE_KEYS.includes(key)) {
        throw new Error(`Migration attempted to read removed state: ${key}`);
      }
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      operations.push(['setItem', key, value]);
      values.set(key, value);
    },
    async multiRemove(keys) {
      operations.push(['multiRemove', [...keys]]);
      for (const key of keys) values.delete(key);
    },
  };
}

test('public-v1 migration removes private state without reading it and preserves public preferences', async () => {
  const preservedEntries = [
    ['@cabohealth_theme', 'dark'],
    ['@cabohealth_language', 'es'],
    ['@cabohealth_haptic_enabled', 'false'],
    ['@cabohealth_has_seen_onboarding', 'true'],
  ];
  const storage = createStorage([
    ...preservedEntries,
    ...PRIVATE_KEYS.map((key) => [key, `secret:${key}`]),
    [
      '@cabohealth_favorites',
      JSON.stringify(['client-resources', 'healthy-recipes', 'sleep-lab', 'clinic-guide']),
    ],
  ]);

  await removeLegacyPrivateState(storage);

  assert.deepEqual(LEGACY_PRIVATE_STATE_KEYS, PRIVATE_KEYS);
  assert.deepEqual(
    storage.operations.filter(([operation]) => operation === 'multiRemove'),
    [['multiRemove', PRIVATE_KEYS]],
  );
  for (const key of PRIVATE_KEYS) assert.equal(storage.values.has(key), false);
  for (const [key, value] of preservedEntries) assert.equal(storage.values.get(key), value);
  assert.equal(
    storage.values.get('@cabohealth_favorites'),
    JSON.stringify(['healthy-recipes', 'clinic-guide']),
  );
  assert.equal(storage.values.get(PUBLIC_V1_MIGRATION_MARKER), '1');
});

test('public-v1 migration is idempotent after its marker is stored', async () => {
  const storage = createStorage([
    ['@cabohealth_favorites', JSON.stringify(['healthy-recipes', 'legacy-module'])],
  ]);

  await removeLegacyPrivateState(storage);
  const valuesAfterFirstRun = [...storage.values.entries()];
  const operationCountAfterFirstRun = storage.operations.length;

  await removeLegacyPrivateState(storage);

  assert.deepEqual([...storage.values.entries()], valuesAfterFirstRun);
  assert.deepEqual(
    storage.operations.slice(operationCountAfterFirstRun),
    [['getItem', PUBLIC_V1_MIGRATION_MARKER]],
  );
});

test('migration bootstrap settles after rejection and reports no rejected value', async () => {
  const reports = [];
  const privateFailure = new Error('secret storage detail');
  let settled = false;

  await settleLegacyPrivateStateMigration(
    async () => Promise.reject(privateFailure),
    (...args) => reports.push(args),
  ).then(() => {
    settled = true;
  });

  assert.equal(settled, true);
  assert.deepEqual(reports, [[]]);
});
