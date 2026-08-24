import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIREBASE_DEBUG_LOG_PATTERN = /^firebase-debug[^/]*\.log$/u;
const FIREBASE_SECRET_WORKSPACE_PREFIX = 'cabohealth-firebase-secrets-';
const FIREBASE_DIAGNOSTIC_ENVIRONMENT_KEYS = new Set([
  'DEBUG',
  'DEBUG_COLORS',
  'DEBUG_DEPTH',
  'DEBUG_FD',
  'DEBUG_HIDE_DATE',
  'DEBUG_SHOW_HIDDEN',
  'FIREBASE_DEBUG',
  'FIREBASE_DEBUG_FEATURES',
  'FIREBASE_DEBUG_MODE',
  'FIREBASE_MCP_DEBUG_LOG',
  'FUNCTION_DEBUG_MODE',
  'GOOGLE_CLOUD_CPP_ENABLE_TRACING',
  'GOOGLE_CLOUD_CPP_TRACING_OPTIONS',
  'GRPC_TRACE',
  'GRPC_VERBOSITY',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'VSCODE_DEBUG_MODE',
]);

export const SECRET_RING_NAMES = Object.freeze([
  'CLIENT_CODE_PEPPER_RING',
  'CLIENT_INSTALLATION_PEPPER_RING',
  'CLIENT_DELETION_RECEIPT_PEPPER_RING',
  'CLIENT_RATE_LIMIT_PEPPER_RING',
  'CLIENT_LAUNCH_NONCE_PEPPER_RING',
  'CLIENT_WEB_SESSION_PEPPER_RING',
  'CLIENT_WEB_CSRF_PEPPER_RING',
  'CLIENT_BROKER_HMAC_KEY_RING',
  'APP_REVIEW_CREDENTIAL_PEPPER_RING',
  'APP_REVIEW_INSTALLATION_PEPPER_RING',
  'APP_REVIEW_DELETION_RECEIPT_PEPPER_RING',
  'APP_REVIEW_RATE_LIMIT_PEPPER_RING',
  'APP_REVIEW_LAUNCH_NONCE_PEPPER_RING',
  'APP_REVIEW_WEB_SESSION_PEPPER_RING',
  'APP_REVIEW_WEB_CSRF_PEPPER_RING',
  'APP_REVIEW_BROKER_HMAC_KEY_RING',
]);

export function buildSecretRing(version) {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(version)) {
    throw new Error('firebase_secret_version_invalid');
  }
  return {
    currentVersion: version,
    keys: {
      [version]: randomBytes(32).toString('base64'),
    },
  };
}

export function parseSecretProvisionArguments(argv) {
  if (
    argv.length !== 5
    || argv[0] !== '--project'
    || argv[1] !== 'cabohealth-owner-prod'
    || argv[2] !== '--version'
    || !/^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(argv[3] ?? '')
    || (argv[4] !== '--plan' && argv[4] !== '--apply')
  ) throw new Error('firebase_secret_provision_arguments_invalid');

  return {
    apply: argv[4] === '--apply',
    projectId: argv[1],
    version: argv[3],
  };
}

function commandEvidence(command, status) {
  return {
    artifactKind: 'cabohealth-initial-secret-ring-provision-evidence',
    schemaVersion: 1,
    status,
    projectId: command.projectId,
    version: command.version,
    secretNames: SECRET_RING_NAMES,
    secretCount: SECRET_RING_NAMES.length,
    independentGeneratedKeys: status === 'applied' ? SECRET_RING_NAMES.length : 0,
    containsSensitiveValues: false,
  };
}

function runPreflight(projectId, repositoryRoot) {
  const result = spawnSync(
    'gcloud',
    ['secrets', 'list', '--project', projectId, '--format=value(name)'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    throw new Error('firebase_secret_preflight_failed');
  }
  const existing = new Set(
    result.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean),
  );
  if (SECRET_RING_NAMES.some((name) => existing.has(name))) {
    throw new Error('firebase_secret_initial_provision_refuses_existing_ring');
  }
}

function buildFirebaseCliEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !FIREBASE_DIAGNOSTIC_ENVIRONMENT_KEYS.has(name.toUpperCase()),
    ),
  );
}

function pathIsInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ''
    || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

function createFirebaseSecretWorkspace(repositoryRoot) {
  const resolvedRepositoryRoot = realpathSync(repositoryRoot);
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), FIREBASE_SECRET_WORKSPACE_PREFIX)));

  try {
    chmodSync(workspace, 0o700);
    if ((statSync(workspace).mode & 0o777) !== 0o700) {
      throw new Error('firebase_secret_workspace_permissions_invalid');
    }
    if (pathIsInside(resolvedRepositoryRoot, workspace)) {
      throw new Error('firebase_secret_workspace_must_be_outside_repository');
    }
    return workspace;
  } catch (error) {
    rmSync(workspace, { force: true, recursive: true });
    throw error;
  }
}

function firebaseDebugResidues(workspace) {
  return readdirSync(workspace)
    .filter((name) => FIREBASE_DEBUG_LOG_PATTERN.test(name));
}

function cleanupFirebaseSecretWorkspace(workspace) {
  let cleanupFailed = false;

  try {
    for (const name of firebaseDebugResidues(workspace)) {
      rmSync(join(workspace, name), { force: true });
    }
    if (firebaseDebugResidues(workspace).length !== 0) cleanupFailed = true;
  } catch {
    cleanupFailed = true;
  }

  try {
    rmSync(workspace, { force: true, recursive: true });
    if (existsSync(workspace)) cleanupFailed = true;
  } catch {
    cleanupFailed = true;
  }

  if (cleanupFailed) {
    throw new Error('firebase_secret_workspace_cleanup_failed');
  }
}

function applySecret({ environment, firebaseCli, name, projectId, workspace, version }) {
  const secret = `${JSON.stringify(buildSecretRing(version))}\n`;
  const result = spawnSync(
    process.execPath,
    [
      firebaseCli,
      'functions:secrets:set',
      name,
      '--data-file',
      '-',
      '--format',
      'json',
      '--project',
      projectId,
      '--non-interactive',
    ],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: buildFirebaseCliEnvironment(environment),
      input: secret,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`firebase_secret_apply_failed:${name}`);
  }
}

function applySecretRings({ firebaseCli, projectId, repositoryRoot, version }) {
  const workspace = createFirebaseSecretWorkspace(repositoryRoot);
  try {
    for (const name of SECRET_RING_NAMES) {
      applySecret({
        environment: process.env,
        firebaseCli,
        name,
        projectId,
        version,
        workspace,
      });
    }
  } finally {
    cleanupFirebaseSecretWorkspace(workspace);
  }
}

async function main() {
  const command = parseSecretProvisionArguments(process.argv.slice(2));
  if (!command.apply) {
    process.stdout.write(`${JSON.stringify(commandEvidence(command, 'planned'), null, 2)}\n`);
    return;
  }

  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const firebaseCli = join(
    repositoryRoot,
    'node_modules',
    'firebase-tools',
    'lib',
    'bin',
    'firebase.js',
  );
  runPreflight(command.projectId, repositoryRoot);
  applySecretRings({ firebaseCli, repositoryRoot, ...command });
  process.stdout.write(`${JSON.stringify(commandEvidence(command, 'applied'), null, 2)}\n`);
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown';
    process.stderr.write(`${message.split(':', 1)[0]}\n`);
    process.exitCode = 1;
  });
}
