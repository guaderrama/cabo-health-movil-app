import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REVIEW_DATABASE_PLACEHOLDER = 'UNCONFIGURED_CABOHEALTH_REVIEW_DATABASE_ID';

export function buildDeployFirebaseConfig({
  baseConfig,
  environment,
  projectId,
  reviewDatabaseId,
}) {
  const suffix = environment === 'production'
    ? 'prod'
    : environment === 'staging'
      ? 'staging'
      : null;
  const projectPattern = suffix
    ? new RegExp(`^cabohealth-(?:[a-z0-9]+-)*${suffix}$`, 'u')
    : null;
  const databaseSuffixPattern = environment === 'production'
    ? /-(?:prod|production)$/u
    : /-staging$/u;
  if (
    !projectPattern
    || !projectPattern.test(projectId)
    || !/^cabohealth-review-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u.test(reviewDatabaseId)
    || !databaseSuffixPattern.test(reviewDatabaseId)
  ) throw new Error('firebase_activation_config_invalid');

  const config = structuredClone(baseConfig);
  if (
    !Array.isArray(config.firestore)
    || config.firestore.length !== EXPECTED_FIRESTORE_TEMPLATE.length
    || !config.firestore.every((entry, index) => (
      isExactObject(entry, EXPECTED_FIRESTORE_TEMPLATE[index])
    ))
  ) {
    throw new Error('firebase_activation_config_invalid');
  }
  const review = config.firestore.find(
    (entry) => entry.database === REVIEW_DATABASE_PLACEHOLDER,
  );
  if (!review) throw new Error('firebase_activation_config_invalid');
  review.database = reviewDatabaseId;
  return config;
}

export function parseFirebaseActivationConfigArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !CONFIG_FLAGS.has(flag)
      || typeof value !== 'string'
      || value.startsWith('--')
      || values.has(flag)
    ) throw new Error('firebase_activation_config_arguments_invalid');
    values.set(flag, value);
  }
  const environment = values.get('--environment');
  const out = values.get('--out');
  const projectId = values.get('--project-id');
  const reviewDatabaseId = values.get('--review-database-id');
  if (
    values.size !== 4
    || (environment !== 'production' && environment !== 'staging')
    || !out
    || !projectId
    || !reviewDatabaseId
  ) throw new Error('firebase_activation_config_arguments_invalid');
  return Object.freeze({ environment, out, projectId, reviewDatabaseId });
}

export function serializeFirebaseDeployConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function createFirebaseDeployConfigEvidence({
  config,
  environment,
  projectId,
  reviewDatabaseId,
}) {
  return Object.freeze({
    artifactKind: 'cabohealth-firebase-deploy-config-evidence',
    schemaVersion: 1,
    status: 'rendered',
    environment,
    projectId,
    reviewDatabaseId,
    configSha256: createHash('sha256')
      .update(serializeFirebaseDeployConfig(config), 'utf8')
      .digest('hex'),
    containsSensitiveValues: false,
  });
}

export async function executeFirebaseActivationConfigCommand({ command, repositoryRoot }) {
  await assertPrivateOutputPath(command.out, repositoryRoot);
  const baseConfig = JSON.parse(
    await readFile(resolve(repositoryRoot, 'firebase.json'), 'utf8'),
  );
  const config = buildDeployFirebaseConfig({
    baseConfig,
    environment: command.environment,
    projectId: command.projectId,
    reviewDatabaseId: command.reviewDatabaseId,
  });
  await writeFile(command.out, serializeFirebaseDeployConfig(config), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return createFirebaseDeployConfigEvidence({
    config,
    environment: command.environment,
    projectId: command.projectId,
    reviewDatabaseId: command.reviewDatabaseId,
  });
}

const CONFIG_FLAGS = new Set([
  '--environment',
  '--out',
  '--project-id',
  '--review-database-id',
]);

const EXPECTED_FIRESTORE_TEMPLATE = Object.freeze([
  Object.freeze({
    database: '(default)',
    indexes: 'firestore.indexes.json',
    rules: 'firestore.rules',
  }),
  Object.freeze({
    database: REVIEW_DATABASE_PLACEHOLDER,
    indexes: 'firestore.review.indexes.json',
    rules: 'firestore.review.rules',
  }),
]);

function isExactObject(candidate, expected) {
  return (
    candidate !== null
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && Object.keys(candidate).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => candidate[key] === value)
  );
}

async function assertPrivateOutputPath(path, repositoryRoot) {
  if (!isAbsolute(path)) throw new Error('firebase_activation_config_output_invalid');
  const privateRoot = await realpath(resolve(repositoryRoot, 'release', 'private'));
  const outputParent = await realpath(dirname(path));
  const difference = relative(privateRoot, outputParent);
  const parentMetadata = await stat(outputParent);
  if (
    (difference !== '' && (difference.startsWith('..') || isAbsolute(difference)))
    || (parentMetadata.mode & 0o077) !== 0
  ) throw new Error('firebase_activation_config_output_invalid');
}

async function main() {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const command = parseFirebaseActivationConfigArguments(process.argv.slice(2));
  const evidence = await executeFirebaseActivationConfigCommand({ command, repositoryRoot });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  void main().catch(() => {
    process.stderr.write('firebase_activation_config_failed\n');
    process.exitCode = 1;
  });
}
