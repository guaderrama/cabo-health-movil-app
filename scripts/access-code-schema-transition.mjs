#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_PROJECT = 'cabohealth-owner-prod';
const EXPECTED_DATABASE = '(default)';
const EXPECTED_REGION = 'us-central1';
const EXPECTED_NODE_VERSION = '22.22.3';
const EXPECTED_RUNTIME_SERVICE_ACCOUNT = 'cabohealth-functions@cabohealth-owner-prod.iam.gserviceaccount.com';
const ACCESS_CODE_COLLECTION = '_private_access_codes';
const LEGACY_SLOT_COLLECTION = '_private_client_slots';
const LEGACY_COUNTER_PATH = '_private_admin_counters/active_client_codes';
const BRIDGE_SOURCE_PATH = 'functions/src/repositories/firestoreClientAccessStore.ts';
const BRIDGE_BUILD_PATH = 'functions/lib';
const FUNCTION_SOURCE_CONTROL_PATHS = Object.freeze([
  'functions/package.json',
  'functions/package-lock.json',
]);
const PRIVATE_JOURNAL_PATH = 'release/private/access-code-schema-transition.journal.json';
const PRIVATE_PAUSE_OBSERVATION_PATH = 'release/private/access-code-writer-pause-observation.json';
const REQUIRED_WRITER_DRAIN_MS = 9 * 60 * 1000;
const RETRY_SCHEDULER_JOB = 'firebase-schedule-retryClientAccountDeletions-us-central1';
const BRIDGE_FUNCTIONS = Object.freeze([
  'adminCreateClientAccessCode',
  'adminListClientAccessCodes',
  'adminRevokeClientAccessCode',
  'brokerApi',
  'createClientLaunch',
  'deleteClientAccount',
  'getClientAccountDeletionStatus',
  'redeemClientAccessCode',
  'refreshClientAccess',
  'removeClientAccess',
  'retryClientAccountDeletions',
]);
const HTTPS_WRITERS = Object.freeze([
  Object.freeze({
    functionName: 'adminCreateClientAccessCode',
    serviceName: 'admincreateclientaccesscode',
  }),
  Object.freeze({
    functionName: 'adminListClientAccessCodes',
    serviceName: 'adminlistclientaccesscodes',
  }),
  Object.freeze({
    functionName: 'adminRevokeClientAccessCode',
    serviceName: 'adminrevokeclientaccesscode',
  }),
  Object.freeze({ functionName: 'deleteClientAccount', serviceName: 'deleteclientaccount' }),
  Object.freeze({ functionName: 'redeemClientAccessCode', serviceName: 'redeemclientaccesscode' }),
  Object.freeze({ functionName: 'refreshClientAccess', serviceName: 'refreshclientaccess' }),
  Object.freeze({ functionName: 'removeClientAccess', serviceName: 'removeclientaccess' }),
]);
const HTTPS_WRITER_SERVICES = Object.freeze(HTTPS_WRITERS.map(({ serviceName }) => serviceName));
const SCHEDULED_WRITER_SERVICE = 'retryclientaccountdeletions';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export class TransitionFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'TransitionFailure';
    this.code = code;
  }
}

function failure(code) {
  throw new TransitionFailure(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256DirectoryTree(directoryPath) {
  const root = resolve(directoryPath);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) failure('invalid_build_tree_identity');
  const digest = createHash('sha256');
  let fileCount = 0;
  const visit = (directory, relativeDirectory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) failure('build_tree_contains_symlink');
      if (stat.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!stat.isFile()) failure('build_tree_contains_non_file');
      const bytes = readFileSync(absolute);
      digest.update(`file\0${relative}\0${bytes.length}\0`, 'utf8');
      digest.update(bytes);
      fileCount += 1;
    }
  };
  visit(root, '');
  if (fileCount === 0) failure('build_tree_is_empty');
  return Object.freeze({ fileCount, sha256: digest.digest('hex') });
}

function captureLocalFunctionSourceControls() {
  const files = FUNCTION_SOURCE_CONTROL_PATHS.map((relativePath) => {
    const absolutePath = resolve(process.cwd(), relativePath);
    const stat = lstatSync(absolutePath);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || stat.size < 2
      || stat.size > 2 * 1024 * 1024
    ) failure('local_function_source_control_invalid');
    const bytes = readFileSync(absolutePath);
    return Object.freeze({
      archivePath: relativePath.slice('functions/'.length),
      sha256: sha256(bytes),
    });
  });
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'functions/package.json'), 'utf8'));
  } catch {
    failure('local_function_package_invalid');
  }
  const packageRecord = assertPlainObject(packageJson, 'local_function_package_invalid');
  const engines = assertPlainObject(packageRecord.engines, 'local_function_package_invalid');
  if (
    packageRecord.main !== 'lib/index.js'
    || packageRecord.type !== 'module'
    || engines.node !== '22'
  ) failure('local_function_package_invalid');
  return Object.freeze({
    files,
    sha256: sha256(canonicalJson(files)),
  });
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function assertPlainObject(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) failure(code);
  return value;
}

function parseIntegerField(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(['integerValue'])) return null;
  if (typeof value.integerValue !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(value.integerValue)) return null;
  const parsed = Number(value.integerValue);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseFlags(argv) {
  const values = new Map();
  const booleans = new Set();
  for (const argument of argv) {
    if (argument === '--apply') {
      if (booleans.has(argument)) failure('duplicate_apply_flag');
      booleans.add(argument);
      continue;
    }
    if (!argument.startsWith('--') || !argument.includes('=')) failure('invalid_argument_shape');
    const separator = argument.indexOf('=');
    const name = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (!name || !value || values.has(name)) failure('invalid_or_duplicate_argument');
    values.set(name, value);
  }
  return { booleans, values };
}

export function parseTransitionArguments(argv) {
  if (!Array.isArray(argv) || argv.length < 1) failure('missing_action');
  const [action, ...rest] = argv;
  if (!['check', 'migrate'].includes(action)) failure('unsupported_action');
  const { booleans, values } = parseFlags(rest);
  const common = new Set(['project', 'database']);
  const allowed = action === 'check'
    ? new Set([...common, 'expect'])
    : new Set([
      ...common,
      'reviewed-bridge-build-tree-sha256',
      'reviewed-bridge-runtime-sha256',
      'reviewed-script-sha256',
      'reviewed-bridge-source-sha256',
      'reviewed-before-state-sha256',
      'reviewed-gcloud-version',
      'reviewed-node-version',
      'reviewed-operator-account-sha256',
    ]);
  if ([...values.keys()].some((name) => !allowed.has(name))) failure('unknown_argument');
  if (values.get('project') !== EXPECTED_PROJECT) failure('wrong_project');
  if (values.get('database') !== EXPECTED_DATABASE) failure('wrong_database');
  if (action === 'check') {
    if (booleans.size !== 0) failure('check_is_read_only');
    if (!['before', 'after'].includes(values.get('expect'))) failure('invalid_expected_state');
    return Object.freeze({
      action,
      database: EXPECTED_DATABASE,
      expect: values.get('expect'),
      project: EXPECTED_PROJECT,
    });
  }
  if (!booleans.has('--apply') || booleans.size !== 1) failure('apply_flag_required');
  for (const name of [
    'reviewed-script-sha256',
    'reviewed-bridge-source-sha256',
    'reviewed-bridge-build-tree-sha256',
    'reviewed-bridge-runtime-sha256',
    'reviewed-before-state-sha256',
    'reviewed-operator-account-sha256',
  ]) {
    if (!SHA256_PATTERN.test(values.get(name) ?? '')) failure(`invalid_${name.replaceAll('-', '_')}`);
  }
  if (!/^\d+\.\d+\.\d+$/u.test(values.get('reviewed-gcloud-version') ?? '')) {
    failure('invalid_reviewed_gcloud_version');
  }
  if (values.get('reviewed-node-version') !== EXPECTED_NODE_VERSION) {
    failure('invalid_reviewed_node_version');
  }
  return Object.freeze({
    action,
    database: EXPECTED_DATABASE,
    project: EXPECTED_PROJECT,
    reviewedBeforeStateSha256: values.get('reviewed-before-state-sha256'),
    reviewedBridgeBuildTreeSha256: values.get('reviewed-bridge-build-tree-sha256'),
    reviewedBridgeRuntimeSha256: values.get('reviewed-bridge-runtime-sha256'),
    reviewedBridgeSourceSha256: values.get('reviewed-bridge-source-sha256'),
    reviewedGcloudVersion: values.get('reviewed-gcloud-version'),
    reviewedNodeVersion: values.get('reviewed-node-version'),
    reviewedOperatorAccountSha256: values.get('reviewed-operator-account-sha256'),
    reviewedScriptSha256: values.get('reviewed-script-sha256'),
  });
}

function documentPrefix(project, database) {
  return `projects/${project}/databases/${database}/documents/`;
}

function parseProjectedAccessCode(response, project, database) {
  const document = assertPlainObject(response?.document, 'invalid_query_document');
  const prefix = documentPrefix(project, database);
  const relative = typeof document.name === 'string' && document.name.startsWith(prefix)
    ? document.name.slice(prefix.length)
    : null;
  if (
    relative === null
    || !new RegExp(`^${ACCESS_CODE_COLLECTION}/ac_[A-Za-z0-9_-]{32}$`, 'u').test(relative)
    || typeof document.updateTime !== 'string'
    || Number.isNaN(Date.parse(document.updateTime))
  ) failure('invalid_projected_document_identity');
  const fields = assertPlainObject(document.fields, 'invalid_projected_fields');
  if (Object.keys(fields).some((name) => !['schemaVersion', 'slot'].includes(name))) {
    failure('unexpected_projected_field');
  }
  const schemaVersion = parseIntegerField(fields.schemaVersion);
  const ownsSlot = Object.hasOwn(fields, 'slot');
  const slot = ownsSlot ? parseIntegerField(fields.slot) : null;
  let category = 'invalid';
  if (schemaVersion === 1 && !ownsSlot) category = 'schema1Slotless';
  if (schemaVersion === 1 && ownsSlot && [1, 2, 3, 4].includes(slot)) category = 'schema1Slotted';
  if (schemaVersion === 2 && !ownsSlot) category = 'schema2Slotless';
  return Object.freeze({
    category,
    name: document.name,
    updateTime: document.updateTime,
  });
}

export function classifyTransitionSnapshot({
  accessCodeResponses,
  activeCounterPresent,
  database = EXPECTED_DATABASE,
  legacySlotDocumentCount,
  project = EXPECTED_PROJECT,
}) {
  if (!Array.isArray(accessCodeResponses)) failure('invalid_access_code_response_set');
  if (!Number.isSafeInteger(legacySlotDocumentCount) || legacySlotDocumentCount < 0) {
    failure('invalid_legacy_slot_count');
  }
  if (typeof activeCounterPresent !== 'boolean') failure('invalid_counter_state');
  const records = accessCodeResponses
    .filter((response) => Object.hasOwn(assertPlainObject(response, 'invalid_query_response'), 'document'))
    .map((response) => parseProjectedAccessCode(response, project, database));
  const counts = Object.freeze({
    activeCounterPresent,
    invalid: records.filter(({ category }) => category === 'invalid').length,
    legacySlotDocuments: legacySlotDocumentCount,
    schema1Slotless: records.filter(({ category }) => category === 'schema1Slotless').length,
    schema1Slotted: records.filter(({ category }) => category === 'schema1Slotted').length,
    schema2Slotless: records.filter(({ category }) => category === 'schema2Slotless').length,
    totalAccessCodes: records.length,
  });
  const transitionCandidates = records.filter(({ category }) => (
    category === 'schema1Slotless' || category === 'schema2Slotless'
  ));
  const transition = transitionCandidates.length === 1 ? transitionCandidates[0] : null;
  const sanitizedState = Object.freeze({
    counts,
    transitionDocumentNameSha256: transition ? sha256(transition.name) : null,
    transitionUpdateTimeSha256: transition ? sha256(transition.updateTime) : null,
  });
  return Object.freeze({
    counts,
    internalTransition: transition,
    sanitizedState,
    stateSha256: sha256(canonicalJson(sanitizedState)),
  });
}

export function assertExpectedTransitionState(snapshot, expected) {
  const counts = snapshot?.counts;
  const required = expected === 'before'
    ? {
      activeCounterPresent: false,
      invalid: 0,
      legacySlotDocuments: 0,
      schema1Slotless: 1,
      schema1Slotted: 0,
      schema2Slotless: 0,
      totalAccessCodes: 1,
    }
    : {
      activeCounterPresent: false,
      invalid: 0,
      legacySlotDocuments: 0,
      schema1Slotless: 0,
      schema1Slotted: 0,
      schema2Slotless: 1,
      totalAccessCodes: 1,
    };
  if (expected !== 'before' && expected !== 'after') failure('invalid_expected_state');
  if (canonicalJson(counts) !== canonicalJson(required) || snapshot.internalTransition === null) {
    failure(`unexpected_${expected}_state`);
  }
}

export function buildSchemaVersionPatch({ database, documentName, project, updateTime }) {
  const prefix = documentPrefix(project, database);
  if (typeof documentName !== 'string' || !documentName.startsWith(prefix)) {
    failure('invalid_patch_document_name');
  }
  const relative = documentName.slice(prefix.length);
  if (!new RegExp(`^${ACCESS_CODE_COLLECTION}/ac_[A-Za-z0-9_-]{32}$`, 'u').test(relative)) {
    failure('invalid_patch_document_path');
  }
  if (typeof updateTime !== 'string' || Number.isNaN(Date.parse(updateTime))) {
    failure('invalid_patch_update_time');
  }
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
    + `/databases/${encodeURIComponent(database)}/documents/`
    + relative.split('/').map(encodeURIComponent).join('/');
  const parameters = new URLSearchParams();
  parameters.append('updateMask.fieldPaths', 'schemaVersion');
  parameters.append('currentDocument.updateTime', updateTime);
  parameters.append('mask.fieldPaths', 'schemaVersion');
  return Object.freeze({
    body: canonicalJson({ fields: { schemaVersion: { integerValue: '2' } } }),
    method: 'PATCH',
    url: `${base}?${parameters.toString()}`,
  });
}

function runGcloud(arguments_, failureCode) {
  const result = spawnSync('gcloud', arguments_, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') failure(failureCode);
  return result.stdout.trim();
}

function runGcloudBytes(arguments_, failureCode) {
  const result = spawnSync('gcloud', arguments_, {
    encoding: null,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) failure(failureCode);
  return result.stdout;
}

function runLocalBinary(executable, arguments_, failureCode, encoding = 'utf8') {
  const result = spawnSync(executable, arguments_, {
    encoding,
    env: Object.freeze({
      LANG: 'C',
      PATH: '/usr/bin:/bin',
    }),
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) failure(failureCode);
  return result.stdout;
}

export function parseGcloudVersionOutput(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    failure('gcloud_version_response_invalid');
  }
  const record = assertPlainObject(parsed, 'gcloud_version_response_invalid');
  const version = record['Google Cloud SDK'];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    failure('gcloud_version_response_invalid');
  }
  return version;
}

function parseJsonOutput(output, code) {
  try {
    return JSON.parse(output);
  } catch {
    failure(code);
  }
}

function activeOperatorIdentity() {
  const parsed = parseJsonOutput(runGcloud([
    'auth',
    'list',
    '--filter=status:ACTIVE',
    '--format=json(account,status)',
  ], 'active_operator_unavailable'), 'active_operator_response_invalid');
  if (!Array.isArray(parsed) || parsed.length !== 1) failure('active_operator_not_unique');
  const record = assertPlainObject(parsed[0], 'active_operator_response_invalid');
  if (
    record.status !== 'ACTIVE'
    || typeof record.account !== 'string'
    || !/^[^\s@]+@[^\s@]+$/u.test(record.account)
  ) failure('active_operator_response_invalid');
  return record.account;
}

function expectedServiceLimits(functionName) {
  if (functionName === 'brokerApi') return Object.freeze({ maxInstanceCount: 10, timeoutSeconds: 15 });
  if (functionName === 'retryClientAccountDeletions') {
    return Object.freeze({ maxInstanceCount: 1, timeoutSeconds: 120 });
  }
  return Object.freeze({ maxInstanceCount: 10, timeoutSeconds: 30 });
}

function captureFunctionDeployment(functionName, options) {
  if (typeof options.operatorAccount !== 'string') failure('operator_account_not_bound');
  const raw = parseJsonOutput(runGcloud([
    'functions',
    'describe',
    functionName,
    '--gen2',
    `--region=${EXPECTED_REGION}`,
    `--project=${options.project}`,
    `--account=${options.operatorAccount}`,
    '--format=json(name,state,updateTime,labels,buildConfig.entryPoint,buildConfig.runtime,buildConfig.source.storageSource,serviceConfig.service,serviceConfig.serviceAccountEmail,serviceConfig.allTrafficOnLatestRevision,serviceConfig.timeoutSeconds,serviceConfig.maxInstanceCount)',
  ], 'bridge_function_description_unavailable'), 'bridge_function_description_invalid');
  const record = assertPlainObject(raw, 'bridge_function_description_invalid');
  const build = assertPlainObject(record.buildConfig, 'bridge_function_build_invalid');
  const source = assertPlainObject(build.source, 'bridge_function_source_invalid');
  const storage = assertPlainObject(source.storageSource, 'bridge_function_source_invalid');
  const service = assertPlainObject(record.serviceConfig, 'bridge_function_service_invalid');
  const labels = assertPlainObject(record.labels, 'bridge_function_labels_invalid');
  const serviceName = functionName.toLowerCase();
  const limits = expectedServiceLimits(functionName);
  if (
    record.name !== `projects/${options.project}/locations/${EXPECTED_REGION}/functions/${functionName}`
    || record.state !== 'ACTIVE'
    || typeof record.updateTime !== 'string'
    || Number.isNaN(Date.parse(record.updateTime))
    || build.entryPoint !== functionName
    || build.runtime !== 'nodejs22'
    || labels['deployment-tool'] !== 'cli-firebase'
    || labels['firebase-functions-codebase'] !== 'client-access'
    || typeof labels['firebase-functions-hash'] !== 'string'
    || !/^[0-9a-f]{40}$/u.test(labels['firebase-functions-hash'])
    || service.service !== `projects/${options.project}/locations/${EXPECTED_REGION}/services/${serviceName}`
    || service.serviceAccountEmail !== EXPECTED_RUNTIME_SERVICE_ACCOUNT
    || service.allTrafficOnLatestRevision !== true
    || service.timeoutSeconds !== limits.timeoutSeconds
    || service.maxInstanceCount !== limits.maxInstanceCount
    || typeof storage.bucket !== 'string'
    || !/^gcf-v2-sources-[0-9]+-us-central1$/u.test(storage.bucket)
    || typeof storage.object !== 'string'
    || !/^(?:[A-Za-z0-9_-]+\/)?function-source\.zip$/u.test(storage.object)
    || typeof storage.generation !== 'string'
    || !/^[1-9][0-9]*$/u.test(storage.generation)
  ) failure('bridge_function_deployment_invalid');
  return Object.freeze({
    sanitized: Object.freeze({
      firebaseFunctionsHash: labels['firebase-functions-hash'],
      functionName,
      functionUpdateTime: record.updateTime,
      sourceBucketSha256: sha256(storage.bucket),
      sourceGeneration: storage.generation,
      sourceObject: storage.object,
    }),
    source: Object.freeze({
      bucket: storage.bucket,
      generation: storage.generation,
      object: storage.object,
    }),
  });
}

function captureCloudRunDeployment(functionName, options) {
  if (typeof options.operatorAccount !== 'string') failure('operator_account_not_bound');
  const serviceName = functionName.toLowerCase();
  const raw = parseJsonOutput(runGcloud([
    'run',
    'services',
    'describe',
    serviceName,
    `--region=${EXPECTED_REGION}`,
    `--project=${options.project}`,
    `--account=${options.operatorAccount}`,
    '--format=json(invokerIamDisabled,metadata.name,metadata.annotations,status.latestReadyRevisionName,status.latestCreatedRevisionName,status.observedGeneration,status.traffic,status.conditions,spec.template.spec.serviceAccountName)',
  ], 'bridge_run_description_unavailable'), 'bridge_run_description_invalid');
  const record = assertPlainObject(raw, 'bridge_run_description_invalid');
  const metadata = assertPlainObject(record.metadata, 'bridge_run_metadata_invalid');
  const annotations = assertPlainObject(metadata.annotations ?? {}, 'bridge_run_metadata_invalid');
  const spec = assertPlainObject(record.spec, 'bridge_run_spec_invalid');
  const template = assertPlainObject(spec.template, 'bridge_run_spec_invalid');
  const templateSpec = assertPlainObject(template.spec, 'bridge_run_spec_invalid');
  const status = assertPlainObject(record.status, 'bridge_run_status_invalid');
  const traffic = status.traffic;
  const conditions = status.conditions;
  const ready = Array.isArray(conditions)
    ? conditions.find((condition) => condition?.type === 'Ready')
    : null;
  if (
    metadata.name !== serviceName
    || record.invokerIamDisabled === true
    || annotations['run.googleapis.com/invoker-iam-disabled'] === 'true'
    || templateSpec.serviceAccountName !== EXPECTED_RUNTIME_SERVICE_ACCOUNT
    || typeof status.latestReadyRevisionName !== 'string'
    || status.latestCreatedRevisionName !== status.latestReadyRevisionName
    || !status.latestReadyRevisionName.startsWith(`${serviceName}-`)
    || !Number.isSafeInteger(status.observedGeneration)
    || status.observedGeneration < 1
    || !Array.isArray(traffic)
    || traffic.length !== 1
    || traffic[0]?.latestRevision !== true
    || traffic[0]?.percent !== 100
    || traffic[0]?.revisionName !== status.latestReadyRevisionName
    || ready?.status !== 'True'
  ) failure('bridge_run_deployment_invalid');
  return Object.freeze({
    cloudRunObservedGeneration: status.observedGeneration,
    cloudRunRevision: status.latestReadyRevisionName,
  });
}

function inspectDeployedSourceArchive(source, options, localSourceControls) {
  const archiveBytes = runGcloudBytes([
    'storage',
    'cat',
    `gs://${source.bucket}/${source.object}#${source.generation}`,
    `--project=${options.project}`,
    `--account=${options.operatorAccount}`,
  ], 'deployed_source_download_failed');
  if (
    archiveBytes.length < 4
    || archiveBytes[0] !== 0x50
    || archiveBytes[1] !== 0x4b
  ) failure('deployed_source_archive_invalid');
  const temporaryDirectory = mkdtempSync('/tmp/cabohealth-deployed-source-');
  const archivePath = resolve(temporaryDirectory, 'source.zip');
  const extractionPath = resolve(temporaryDirectory, 'extracted');
  try {
    writeFileSync(archivePath, archiveBytes, { flag: 'wx', mode: 0o600 });
    const listing = runLocalBinary(
      '/usr/bin/unzip',
      ['-Z1', archivePath],
      'deployed_source_listing_failed',
    );
    const entries = listing.split('\n').filter(Boolean);
    if (entries.length === 0) failure('deployed_source_archive_empty');
    if (new Set(entries).size !== entries.length) failure('deployed_source_entry_duplicate');
    for (const entry of entries) {
      const segments = entry.replace(/\/$/u, '').split('/');
      if (
        entry.startsWith('/')
        || entry.includes('\\')
        || entry.includes('\0')
        || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
      ) failure('deployed_source_entry_unsafe');
    }
    if (
      !entries.includes('lib/index.js')
      || !entries.includes('lib/repositories/firestoreClientAccessStore.js')
      || localSourceControls.files.some(({ archivePath }) => !entries.includes(archivePath))
    ) failure('deployed_source_build_missing');
    runLocalBinary(
      '/usr/bin/unzip',
      [
        '-qq',
        archivePath,
        'lib/*',
        ...localSourceControls.files.map(({ archivePath }) => archivePath),
        '-d',
        extractionPath,
      ],
      'deployed_source_extraction_failed',
    );
    const buildTree = sha256DirectoryTree(resolve(extractionPath, 'lib'));
    const deployedSourceControls = localSourceControls.files.map((expected) => {
      const extractedPath = resolve(extractionPath, expected.archivePath);
      const stat = lstatSync(extractedPath);
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || stat.size < 2
        || stat.size > 2 * 1024 * 1024
      ) failure('deployed_source_control_invalid');
      return Object.freeze({
        archivePath: expected.archivePath,
        sha256: sha256(readFileSync(extractedPath)),
      });
    });
    const sourceControlSha256 = sha256(canonicalJson(deployedSourceControls));
    return Object.freeze({
      archiveSha256: sha256(archiveBytes),
      buildFileCount: buildTree.fileCount,
      buildTreeSha256: buildTree.sha256,
      sourceControlMatchesLocal: sourceControlSha256 === localSourceControls.sha256,
      sourceControlSha256,
      sourceIdentitySha256: sha256(canonicalJson(source)),
    });
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function captureBridgeRuntimeSnapshot(options, expectedBuildTreeSha256, requireBuildMatch) {
  const localSourceControls = captureLocalFunctionSourceControls();
  const deployments = BRIDGE_FUNCTIONS.map((functionName) => Object.freeze({
    function: captureFunctionDeployment(functionName, options),
    run: captureCloudRunDeployment(functionName, options),
  }));
  const artifacts = new Map();
  for (const deployment of deployments) {
    const key = canonicalJson(deployment.function.source);
    if (!artifacts.has(key)) {
      artifacts.set(
        key,
        inspectDeployedSourceArchive(deployment.function.source, options, localSourceControls),
      );
    }
  }
  const functions = deployments.map((deployment) => {
    const artifact = artifacts.get(canonicalJson(deployment.function.source));
    return Object.freeze({
      ...deployment.function.sanitized,
      ...deployment.run,
      deployedSourceArchiveSha256: artifact.archiveSha256,
      deployedSourceBuildFileCount: artifact.buildFileCount,
      deployedSourceBuildTreeSha256: artifact.buildTreeSha256,
      deployedSourceIdentitySha256: artifact.sourceIdentitySha256,
      deployedSourceControlMatchesLocal: artifact.sourceControlMatchesLocal,
      deployedSourceControlSha256: artifact.sourceControlSha256,
    });
  });
  const deployedBuildTreesMatchExpected = typeof expectedBuildTreeSha256 === 'string'
    && functions.every(({ deployedSourceBuildTreeSha256 }) => (
      deployedSourceBuildTreeSha256 === expectedBuildTreeSha256
    ));
  const deployedSourceControlsMatchLocal = functions.every((entry) => (
    entry.deployedSourceControlMatchesLocal === true
  ));
  if (requireBuildMatch && !deployedBuildTreesMatchExpected) {
    failure('deployed_bridge_build_tree_mismatch');
  }
  if (requireBuildMatch && !deployedSourceControlsMatchLocal) {
    failure('deployed_bridge_source_control_mismatch');
  }
  const deployedBuildMatchesExpected = deployedBuildTreesMatchExpected
    && deployedSourceControlsMatchLocal;
  const artifactSet = [...artifacts.values()]
    .map((artifact) => Object.freeze({
      archiveSha256: artifact.archiveSha256,
      buildFileCount: artifact.buildFileCount,
      buildTreeSha256: artifact.buildTreeSha256,
      sourceControlMatchesLocal: artifact.sourceControlMatchesLocal,
      sourceControlSha256: artifact.sourceControlSha256,
      sourceIdentitySha256: artifact.sourceIdentitySha256,
    }))
    .sort((left, right) => left.sourceIdentitySha256.localeCompare(right.sourceIdentitySha256));
  const snapshot = Object.freeze({
    artifactKind: 'cabohealth-access-code-bridge-runtime-v1',
    deployedArtifactSetSha256: sha256(canonicalJson(artifactSet)),
    functions,
    localSourceControlSha256: localSourceControls.sha256,
    project: options.project,
    region: EXPECTED_REGION,
    runtimeServiceAccountSha256: sha256(EXPECTED_RUNTIME_SERVICE_ACCOUNT),
    schemaVersion: 1,
  });
  return Object.freeze({
    deployedArtifactCount: artifactSet.length,
    deployedArtifactSetSha256: snapshot.deployedArtifactSetSha256,
    deployedBuildMatchesExpected,
    localSourceControlSha256: localSourceControls.sha256,
    sanitizedState: snapshot,
    sha256: sha256(canonicalJson(snapshot)),
  });
}

function assertRunServiceNotPublic(serviceName, options) {
  if (typeof options.operatorAccount !== 'string') failure('operator_account_not_bound');
  const raw = parseJsonOutput(runGcloud([
    'run',
    'services',
    'get-iam-policy',
    serviceName,
    `--region=${EXPECTED_REGION}`,
    `--project=${options.project}`,
    `--account=${options.operatorAccount}`,
    '--format=json',
  ], 'writer_pause_policy_unavailable'), 'writer_pause_policy_invalid');
  const policy = assertPlainObject(raw, 'writer_pause_policy_invalid');
  const bindings = policy.bindings ?? [];
  if (!Array.isArray(bindings)) failure('writer_pause_policy_invalid');
  for (const value of bindings) {
    const binding = assertPlainObject(value, 'writer_pause_policy_invalid');
    if (
      typeof binding.role !== 'string'
      || !Array.isArray(binding.members)
      || binding.members.some((member) => typeof member !== 'string')
    ) {
      failure('writer_pause_policy_invalid');
    }
    if (
      ['roles/run.invoker', 'roles/cloudfunctions.invoker'].includes(binding.role)
      && binding.members.length > 0
    ) failure('https_writer_not_paused');
  }
  if (typeof policy.etag !== 'string' || policy.etag.length < 4) {
    failure('writer_pause_policy_invalid');
  }
  return Object.freeze({ policyEtagSha256: sha256(policy.etag), serviceName });
}

function assertScheduledWriterPaused(options) {
  if (typeof options.operatorAccount !== 'string') failure('operator_account_not_bound');
  const raw = parseJsonOutput(runGcloud([
    'scheduler',
    'jobs',
    'describe',
    RETRY_SCHEDULER_JOB,
    `--location=${EXPECTED_REGION}`,
    `--project=${options.project}`,
    `--account=${options.operatorAccount}`,
    '--format=json(name,state,schedule,timeZone,updateTime,httpTarget.uri,httpTarget.httpMethod,httpTarget.oidcToken.serviceAccountEmail)',
  ], 'writer_scheduler_description_unavailable'), 'writer_scheduler_description_invalid');
  const record = assertPlainObject(raw, 'writer_scheduler_description_invalid');
  const target = assertPlainObject(record.httpTarget, 'writer_scheduler_description_invalid');
  const oidc = assertPlainObject(target.oidcToken, 'writer_scheduler_description_invalid');
  if (
    record.name !== `projects/${options.project}/locations/${EXPECTED_REGION}/jobs/${RETRY_SCHEDULER_JOB}`
    || record.state !== 'PAUSED'
    || typeof record.updateTime !== 'string'
    || Number.isNaN(Date.parse(record.updateTime))
    || record.schedule !== 'every 5 minutes'
    || record.timeZone !== 'UTC'
    || target.httpMethod !== 'POST'
    || target.uri !== `https://${EXPECTED_REGION}-${options.project}.cloudfunctions.net/retryClientAccountDeletions`
    || oidc.serviceAccountEmail !== EXPECTED_RUNTIME_SERVICE_ACCOUNT
  ) failure('scheduled_writer_not_paused');
  const rawPolicy = parseJsonOutput(runGcloud([
    'run',
    'services',
    'get-iam-policy',
    SCHEDULED_WRITER_SERVICE,
    `--region=${EXPECTED_REGION}`,
    `--project=${options.project}`,
    `--account=${options.operatorAccount}`,
    '--format=json',
  ], 'scheduled_writer_policy_unavailable'), 'scheduled_writer_policy_invalid');
  const policy = assertPlainObject(rawPolicy, 'scheduled_writer_policy_invalid');
  const bindings = policy.bindings ?? [];
  if (!Array.isArray(bindings)) failure('scheduled_writer_policy_invalid');
  if (bindings.some((value) => {
    const binding = assertPlainObject(value, 'scheduled_writer_policy_invalid');
    if (
      typeof binding.role !== 'string'
      || !Array.isArray(binding.members)
      || binding.members.some((member) => typeof member !== 'string')
    ) {
      failure('scheduled_writer_policy_invalid');
    }
    return ['roles/run.invoker', 'roles/cloudfunctions.invoker'].includes(binding.role)
      && binding.members.length > 0;
  })) failure('scheduled_writer_invoker_not_paused');
  if (typeof policy.etag !== 'string' || policy.etag.length < 4) {
    failure('scheduled_writer_policy_invalid');
  }
  return Object.freeze({
    policyEtagSha256: sha256(policy.etag),
    schedulerJob: RETRY_SCHEDULER_JOB,
    schedulerState: record.state,
    schedulerUpdateTime: record.updateTime,
    serviceName: SCHEDULED_WRITER_SERVICE,
  });
}

function assertNoProjectWideInvoker(options) {
  if (typeof options.operatorAccount !== 'string') failure('operator_account_not_bound');
  const raw = parseJsonOutput(runGcloud([
    'projects',
    'get-iam-policy',
    options.project,
    `--account=${options.operatorAccount}`,
    '--format=json(bindings,etag,version)',
  ], 'project_invoker_policy_unavailable'), 'project_invoker_policy_invalid');
  const policy = assertPlainObject(raw, 'project_invoker_policy_invalid');
  const bindings = policy.bindings ?? [];
  if (!Array.isArray(bindings)) failure('project_invoker_policy_invalid');
  for (const value of bindings) {
    const binding = assertPlainObject(value, 'project_invoker_policy_invalid');
    if (
      typeof binding.role !== 'string'
      || !Array.isArray(binding.members)
      || binding.members.some((member) => typeof member !== 'string')
    ) failure('project_invoker_policy_invalid');
    if (
      (['roles/run.invoker', 'roles/cloudfunctions.invoker'].includes(binding.role)
        && binding.members.length > 0)
      || binding.members.some((member) => (
        ['allUsers', 'allAuthenticatedUsers'].includes(member)
      ))
    ) failure('project_wide_invoker_not_paused');
  }
  if (
    typeof policy.etag !== 'string'
    || policy.etag.length < 4
    || !Number.isSafeInteger(policy.version)
    || policy.version < 1
  ) failure('project_invoker_policy_invalid');
  return Object.freeze({
    policyEtagSha256: sha256(policy.etag),
    policyVersion: policy.version,
  });
}

function assertProjectHierarchyIsolated(options) {
  const raw = parseJsonOutput(runGcloud([
    'projects',
    'get-ancestors',
    options.project,
    `--account=${options.operatorAccount}`,
    '--format=json(id,type)',
  ], 'project_hierarchy_unavailable'), 'project_hierarchy_invalid');
  if (
    !Array.isArray(raw)
    || raw.length !== 1
    || raw[0]?.type !== 'project'
    || typeof raw[0]?.id !== 'string'
    || raw[0].id.length === 0
  ) failure('project_hierarchy_not_isolated');
  return Object.freeze({
    ancestorCount: 1,
    projectIdentitySha256: sha256(raw[0].id),
  });
}

async function probeHttpsWriterDenied({ functionName, serviceName }, options) {
  let response;
  try {
    response = await fetch(
      `https://${EXPECTED_REGION}-${options.project}.cloudfunctions.net/${functionName}`,
      {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    failure('https_writer_data_plane_probe_failed');
  }
  let body;
  try {
    body = await response.text();
  } catch {
    failure('https_writer_data_plane_probe_failed');
  }
  const contentType = response.headers?.get?.('content-type');
  if (
    response.status !== 403
    || typeof contentType !== 'string'
    || !contentType.toLowerCase().startsWith('text/html')
    || typeof body !== 'string'
    || body.length < 20
    || body.length > 64 * 1024
    || !body.includes('<title>403 Forbidden</title>')
  ) failure('https_writer_data_plane_not_denied');
  return Object.freeze({
    denialBodySha256: sha256(body),
    denialStatus: response.status,
    serviceName,
  });
}

async function assertAllWritersPaused(options) {
  const httpsWriters = [];
  for (const writer of HTTPS_WRITERS) {
    httpsWriters.push(Object.freeze({
      ...assertRunServiceNotPublic(writer.serviceName, options),
      ...await probeHttpsWriterDenied(writer, options),
    }));
  }
  const scheduledWriter = assertScheduledWriterPaused(options);
  const projectPolicy = assertNoProjectWideInvoker(options);
  const projectHierarchy = assertProjectHierarchyIsolated(options);
  const state = Object.freeze({
    artifactKind: 'cabohealth-access-code-writer-pause-v1',
    httpsWriters,
    project: options.project,
    projectHierarchy,
    projectPolicy,
    region: EXPECTED_REGION,
    scheduledWriter,
    schemaVersion: 1,
  });
  return Object.freeze({ sha256: sha256(canonicalJson(state)) });
}

function privateArtifactPath(relativePath) {
  const privateDirectory = resolve(process.cwd(), 'release/private');
  const directoryStat = lstatSync(privateDirectory);
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || (directoryStat.mode & 0o777) !== 0o700
  ) failure('private_directory_identity_invalid');
  const path = resolve(process.cwd(), relativePath);
  if (!path.startsWith(`${privateDirectory}/`)) failure('private_artifact_path_invalid');
  return Object.freeze({ path, privateDirectory });
}

function readPrivateJson(relativePath, missingCode, invalidCode) {
  const { path } = privateArtifactPath(relativePath);
  if (!existsSync(path)) {
    if (missingCode === null) return null;
    failure(missingCode);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) failure(invalidCode);
  const parsed = parseJsonOutput(readFileSync(path, 'utf8'), invalidCode);
  return assertPlainObject(parsed, invalidCode);
}

function writePrivateJsonExclusive(relativePath, value, existsCode) {
  const { path, privateDirectory } = privateArtifactPath(relativePath);
  const serialized = `${canonicalJson(value)}\n`;
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(12).toString('hex')}`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, serialized, { encoding: 'utf8' });
    fsyncSync(descriptor);
  } catch (error) {
    failure('private_artifact_write_failed');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  try {
    linkSync(temporaryPath, path);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // A private orphan is safer than deleting an unexpected path.
    }
    if (error?.code === 'EEXIST') failure(existsCode);
    failure('private_artifact_publish_failed');
  }
  try {
    unlinkSync(temporaryPath);
  } catch {
    // The final hard link is already durable; a same-content private orphan is harmless.
  }
  const published = lstatSync(path);
  if (
    !published.isFile()
    || published.isSymbolicLink()
    || (published.mode & 0o777) !== 0o600
    || published.nlink !== 1
    || (typeof process.getuid === 'function' && published.uid !== process.getuid())
    || readFileSync(path, 'utf8') !== serialized
  ) failure('private_artifact_publish_verification_failed');
  const directoryDescriptor = openSync(privateDirectory, 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function assertWriterDrain({ pauseStateSha256, runtimeSha256 }) {
  const existing = readPrivateJson(
    PRIVATE_PAUSE_OBSERVATION_PATH,
    null,
    'writer_pause_observation_invalid',
  );
  if (existing === null) {
    writePrivateJsonExclusive(PRIVATE_PAUSE_OBSERVATION_PATH, Object.freeze({
      artifactKind: 'cabohealth-access-code-writer-pause-observation-v1',
      bridgeRuntimeSha256: runtimeSha256,
      observedAt: new Date().toISOString(),
      pauseStateSha256,
      schemaVersion: 1,
    }), 'writer_pause_observation_race');
    failure('writer_pause_observation_created');
  }
  const expectedKeys = [
    'artifactKind',
    'bridgeRuntimeSha256',
    'observedAt',
    'pauseStateSha256',
    'schemaVersion',
  ];
  if (
    canonicalJson(Object.keys(existing).sort()) !== canonicalJson(expectedKeys)
    || existing.artifactKind !== 'cabohealth-access-code-writer-pause-observation-v1'
    || existing.schemaVersion !== 1
    || existing.bridgeRuntimeSha256 !== runtimeSha256
    || existing.pauseStateSha256 !== pauseStateSha256
    || typeof existing.observedAt !== 'string'
    || Number.isNaN(Date.parse(existing.observedAt))
  ) failure('writer_pause_observation_invalid');
  const elapsed = Date.now() - Date.parse(existing.observedAt);
  if (elapsed < REQUIRED_WRITER_DRAIN_MS) failure('writer_drain_incomplete');
  return existing.observedAt;
}

function acquireAccessToken(account) {
  const token = runGcloud([
    'auth',
    'print-access-token',
    `--account=${account}`,
  ], 'access_token_unavailable');
  if (token.length < 20 || /\s/u.test(token)) failure('invalid_access_token');
  return token;
}

async function assertRuntimePins(options) {
  for (const name of [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_DATABASE_EMULATOR_HOST',
    'GCLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'CLOUDSDK_AUTH_ACCESS_TOKEN',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
    'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT',
    'CLOUDSDK_CONFIG',
    'CLOUDSDK_CORE_ACCOUNT',
    'CLOUDSDK_CORE_PROJECT',
  ]) {
    if (process.env[name]) failure('unsafe_ambient_environment');
  }
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptStat = lstatSync(scriptPath);
  if (!scriptStat.isFile() || scriptStat.isSymbolicLink()) failure('invalid_script_identity');
  if (sha256(readFileSync(scriptPath)) !== options.reviewedScriptSha256) {
    failure('reviewed_script_sha256_mismatch');
  }
  const bridgePath = resolve(process.cwd(), BRIDGE_SOURCE_PATH);
  const bridgeStat = lstatSync(bridgePath);
  if (!bridgeStat.isFile() || bridgeStat.isSymbolicLink()) failure('invalid_bridge_source_identity');
  if (sha256(readFileSync(bridgePath)) !== options.reviewedBridgeSourceSha256) {
    failure('reviewed_bridge_source_sha256_mismatch');
  }
  const buildIdentity = sha256DirectoryTree(resolve(process.cwd(), BRIDGE_BUILD_PATH));
  if (buildIdentity.sha256 !== options.reviewedBridgeBuildTreeSha256) {
    failure('reviewed_bridge_build_tree_sha256_mismatch');
  }
  if (process.versions.node !== options.reviewedNodeVersion) {
    failure('reviewed_node_version_mismatch');
  }
  const version = parseGcloudVersionOutput(runGcloud(
    ['version', '--format=json'],
    'gcloud_version_unavailable',
  ));
  if (version !== options.reviewedGcloudVersion) failure('reviewed_gcloud_version_mismatch');
  const account = activeOperatorIdentity();
  if (sha256(account) !== options.reviewedOperatorAccountSha256) {
    failure('reviewed_operator_account_sha256_mismatch');
  }
  const boundOptions = Object.freeze({ ...options, operatorAccount: account });
  const runtime = captureBridgeRuntimeSnapshot(boundOptions, buildIdentity.sha256, true);
  if (runtime.sha256 !== options.reviewedBridgeRuntimeSha256) {
    failure('reviewed_bridge_runtime_sha256_mismatch');
  }
  const pauseState = await assertAllWritersPaused(boundOptions);
  const pauseObservedAt = assertWriterDrain({
    pauseStateSha256: pauseState.sha256,
    runtimeSha256: runtime.sha256,
  });
  if (activeOperatorIdentity() !== account) failure('active_operator_changed');
  return Object.freeze({
    account,
    buildIdentity,
    pauseObservedAt,
    pauseStateSha256: pauseState.sha256,
    runtimeSha256: runtime.sha256,
  });
}

async function assertRuntimePinsStillHold(options, runtimePins) {
  if (activeOperatorIdentity() !== runtimePins.account) failure('active_operator_changed');
  const boundOptions = Object.freeze({ ...options, operatorAccount: runtimePins.account });
  const runtime = captureBridgeRuntimeSnapshot(
    boundOptions,
    runtimePins.buildIdentity.sha256,
    true,
  );
  if (runtime.sha256 !== runtimePins.runtimeSha256) failure('bridge_runtime_changed_during_migration');
  const pauseState = await assertAllWritersPaused(boundOptions);
  if (pauseState.sha256 !== runtimePins.pauseStateSha256) {
    failure('writer_pause_changed_during_migration');
  }
}

function apiRoot(project, database) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
    + `/databases/${encodeURIComponent(database)}/documents`;
}

async function requestResponse(url, { body, method = 'GET', token }, expectedStatuses = [200]) {
  let response;
  try {
    response = await fetch(url, {
      body,
      headers: Object.freeze({
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      }),
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    failure('firestore_request_failed');
  }
  if (!expectedStatuses.includes(response.status)) failure(`firestore_http_${response.status}`);
  return response;
}

async function requestJson(url, request, expectedStatuses = [200]) {
  const response = await requestResponse(url, request, expectedStatuses);
  if (response.status === 404) return null;
  try {
    return await response.json();
  } catch {
    failure('firestore_response_invalid');
  }
}

export function parseJsonSequence(text) {
  if (typeof text !== 'string' || text.trim() === '') failure('firestore_response_invalid');
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Firestore streaming REST methods may return whitespace-separated JSON objects.
  }
  const values = [];
  let depth = 0;
  let escaped = false;
  let inString = false;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start === -1) {
      if (/\s/u.test(character)) continue;
      if (character !== '{') failure('firestore_response_invalid');
      start = index;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') depth += 1;
    if (character === '}' || character === ']') depth -= 1;
    if (depth < 0) failure('firestore_response_invalid');
    if (depth === 0) {
      try {
        values.push(JSON.parse(text.slice(start, index + 1)));
      } catch {
        failure('firestore_response_invalid');
      }
      start = -1;
    }
  }
  if (start !== -1 || inString || values.length === 0) failure('firestore_response_invalid');
  return values;
}

async function requestJsonSequence(url, request) {
  const response = await requestResponse(url, request, [200]);
  let text;
  try {
    text = await response.text();
  } catch {
    failure('firestore_response_invalid');
  }
  return parseJsonSequence(text);
}

async function beginReadOnlyTransaction(options, token) {
  const result = await requestJson(
    `${apiRoot(options.project, options.database)}:beginTransaction`,
    {
      body: canonicalJson({ options: { readOnly: {} } }),
      method: 'POST',
      token,
    },
  );
  if (
    typeof result?.transaction !== 'string'
    || result.transaction.length < 8
    || !/^[A-Za-z0-9_+/=-]+$/u.test(result.transaction)
  ) failure('firestore_transaction_invalid');
  return result.transaction;
}

async function rollbackReadOnlyTransaction(options, token, transaction) {
  await requestJson(
    `${apiRoot(options.project, options.database)}:rollback`,
    {
      body: canonicalJson({ transaction }),
      method: 'POST',
      token,
    },
  );
}

async function queryCollectionProjection({ collectionId, fieldPaths, options, token, transaction }) {
  const body = canonicalJson({
    structuredQuery: {
      from: [{ collectionId }],
      select: { fields: fieldPaths.map((fieldPath) => ({ fieldPath })) },
    },
    transaction,
  });
  const result = await requestJson(
    `${apiRoot(options.project, options.database)}:runQuery`,
    { body, method: 'POST', token },
  );
  if (!Array.isArray(result)) failure('firestore_query_response_invalid');
  return result;
}

async function captureRemoteSnapshot(options, token) {
  const transaction = await beginReadOnlyTransaction(options, token);
  try {
    const accessCodeResponses = await queryCollectionProjection({
      collectionId: ACCESS_CODE_COLLECTION,
      fieldPaths: ['schemaVersion', 'slot'],
      options,
      token,
      transaction,
    });
    const legacySlotResponses = await queryCollectionProjection({
      collectionId: LEGACY_SLOT_COLLECTION,
      fieldPaths: ['__name__'],
      options,
      token,
      transaction,
    });
    const legacySlotDocumentCount = legacySlotResponses.filter((response) => (
      Object.hasOwn(assertPlainObject(response, 'invalid_legacy_slot_response'), 'document')
    )).length;
    const counterName = `${documentPrefix(options.project, options.database)}${LEGACY_COUNTER_PATH}`;
    const counterResponses = await requestJsonSequence(
      `${apiRoot(options.project, options.database)}:batchGet`,
      {
        body: canonicalJson({
          documents: [counterName],
          mask: { fieldPaths: ['schemaVersion'] },
          transaction,
        }),
        method: 'POST',
        token,
      },
    );
    if (counterResponses.length !== 1) failure('counter_batch_response_invalid');
    const counterResponse = assertPlainObject(
      counterResponses[0],
      'counter_batch_response_invalid',
    );
    const found = Object.hasOwn(counterResponse, 'found');
    const missing = Object.hasOwn(counterResponse, 'missing');
    const foundDocument = found
      ? assertPlainObject(counterResponse.found, 'counter_batch_response_invalid')
      : null;
    const foundFields = foundDocument
      ? assertPlainObject(foundDocument.fields ?? {}, 'counter_batch_response_invalid')
      : null;
    if (
      found === missing
      || typeof counterResponse.readTime !== 'string'
      || Number.isNaN(Date.parse(counterResponse.readTime))
      || (foundDocument && foundDocument.name !== counterName)
      || (foundFields && Object.keys(foundFields).some((name) => name !== 'schemaVersion'))
      || (missing && counterResponse.missing !== counterName)
    ) failure('counter_batch_response_invalid');
    return classifyTransitionSnapshot({
      accessCodeResponses,
      activeCounterPresent: found,
      database: options.database,
      legacySlotDocumentCount,
      project: options.project,
    });
  } finally {
    await rollbackReadOnlyTransaction(options, token, transaction);
  }
}

function sanitizedCheckEvidence(snapshot, expected, identity) {
  return Object.freeze({
    artifactKind: 'cabohealth-access-code-schema-transition-check-v1',
    bridgeBuildFileCount: identity.bridgeBuildFileCount,
    bridgeBuildTreeSha256: identity.bridgeBuildTreeSha256,
    bridgeSourceSha256: identity.bridgeSourceSha256,
    containsSensitiveValues: false,
    counts: snapshot.counts,
    expectedState: expected,
    functionsRuntimeSha256: identity.functionsRuntimeSha256,
    deployedArtifactCount: identity.deployedArtifactCount,
    deployedArtifactSetSha256: identity.deployedArtifactSetSha256,
    deployedBuildMatchesLocal: identity.deployedBuildMatchesLocal,
    functionSourceControlSha256: identity.functionSourceControlSha256,
    gcloudVersion: identity.gcloudVersion,
    nodeVersion: process.versions.node,
    observedAt: new Date().toISOString(),
    operatorAccountSha256: identity.operatorAccountSha256,
    schemaVersion: 1,
    scriptSha256: identity.scriptSha256,
    stateSha256: snapshot.stateSha256,
    status: 'verified',
    transitionDocumentNameSha256: snapshot.sanitizedState.transitionDocumentNameSha256,
    transitionUpdateTimeSha256: snapshot.sanitizedState.transitionUpdateTimeSha256,
  });
}

async function executeCheck(options) {
  const account = activeOperatorIdentity();
  const boundOptions = Object.freeze({ ...options, operatorAccount: account });
  const token = acquireAccessToken(account);
  const snapshot = await captureRemoteSnapshot(boundOptions, token);
  assertExpectedTransitionState(snapshot, options.expect);
  const scriptPath = fileURLToPath(import.meta.url);
  const bridgePath = resolve(process.cwd(), BRIDGE_SOURCE_PATH);
  const buildIdentity = sha256DirectoryTree(resolve(process.cwd(), BRIDGE_BUILD_PATH));
  const runtime = captureBridgeRuntimeSnapshot(boundOptions, buildIdentity.sha256, false);
  const gcloudVersion = parseGcloudVersionOutput(runGcloud(
    ['version', '--format=json'],
    'gcloud_version_unavailable',
  ));
  if (activeOperatorIdentity() !== account) failure('active_operator_changed');
  return sanitizedCheckEvidence(snapshot, options.expect, Object.freeze({
    bridgeBuildFileCount: buildIdentity.fileCount,
    bridgeBuildTreeSha256: buildIdentity.sha256,
    bridgeSourceSha256: sha256(readFileSync(bridgePath)),
    functionsRuntimeSha256: runtime.sha256,
    deployedArtifactCount: runtime.deployedArtifactCount,
    deployedArtifactSetSha256: runtime.deployedArtifactSetSha256,
    deployedBuildMatchesLocal: runtime.deployedBuildMatchesExpected,
    functionSourceControlSha256: runtime.localSourceControlSha256,
    gcloudVersion,
    operatorAccountSha256: sha256(account),
    scriptSha256: sha256(readFileSync(scriptPath)),
  }));
}

function isExpectedTransitionState(snapshot, expected) {
  try {
    assertExpectedTransitionState(snapshot, expected);
    return true;
  } catch (error) {
    if (error instanceof TransitionFailure && error.code === `unexpected_${expected}_state`) return false;
    throw error;
  }
}

function readMigrationJournal() {
  const journal = readPrivateJson(
    PRIVATE_JOURNAL_PATH,
    null,
    'migration_journal_invalid',
  );
  if (journal === null) return null;
  const keys = [
    'artifactKind',
    'beforeStateSha256',
    'bridgeBuildTreeSha256',
    'bridgeRuntimeSha256',
    'bridgeSourceSha256',
    'database',
    'operatorAccountSha256',
    'pauseObservedAt',
    'pauseStateSha256',
    'preparedAt',
    'project',
    'schemaVersion',
    'scriptSha256',
    'transitionDocumentNameSha256',
    'transitionUpdateTimeSha256',
  ];
  if (
    canonicalJson(Object.keys(journal).sort()) !== canonicalJson(keys)
    || journal.artifactKind !== 'cabohealth-access-code-schema-transition-journal-v1'
    || journal.project !== EXPECTED_PROJECT
    || journal.database !== EXPECTED_DATABASE
    || journal.schemaVersion !== 1
    || typeof journal.preparedAt !== 'string'
    || Number.isNaN(Date.parse(journal.preparedAt))
    || typeof journal.pauseObservedAt !== 'string'
    || Number.isNaN(Date.parse(journal.pauseObservedAt))
    || [
      journal.beforeStateSha256,
      journal.bridgeBuildTreeSha256,
      journal.bridgeRuntimeSha256,
      journal.bridgeSourceSha256,
      journal.operatorAccountSha256,
      journal.pauseStateSha256,
      journal.scriptSha256,
      journal.transitionDocumentNameSha256,
      journal.transitionUpdateTimeSha256,
    ].some((value) => typeof value !== 'string' || !SHA256_PATTERN.test(value))
  ) failure('migration_journal_invalid');
  return Object.freeze(journal);
}

function expectedJournalPins(options, runtimePins) {
  return Object.freeze({
    beforeStateSha256: options.reviewedBeforeStateSha256,
    bridgeBuildTreeSha256: options.reviewedBridgeBuildTreeSha256,
    bridgeRuntimeSha256: options.reviewedBridgeRuntimeSha256,
    bridgeSourceSha256: options.reviewedBridgeSourceSha256,
    database: options.database,
    operatorAccountSha256: options.reviewedOperatorAccountSha256,
    pauseObservedAt: runtimePins.pauseObservedAt,
    pauseStateSha256: runtimePins.pauseStateSha256,
    project: options.project,
    scriptSha256: options.reviewedScriptSha256,
  });
}

function assertJournalMatchesPins(journal, options, runtimePins) {
  const expected = expectedJournalPins(options, runtimePins);
  for (const [name, value] of Object.entries(expected)) {
    if (journal?.[name] !== value) failure('migration_journal_pin_mismatch');
  }
}

function ensureMigrationJournal(options, runtimePins, transition) {
  const expected = Object.freeze({
    artifactKind: 'cabohealth-access-code-schema-transition-journal-v1',
    ...expectedJournalPins(options, runtimePins),
    schemaVersion: 1,
    transitionDocumentNameSha256: sha256(transition.name),
    transitionUpdateTimeSha256: sha256(transition.updateTime),
  });
  let journal = readMigrationJournal();
  if (journal === null) {
    writePrivateJsonExclusive(PRIVATE_JOURNAL_PATH, Object.freeze({
      ...expected,
      preparedAt: new Date().toISOString(),
    }), 'migration_journal_race');
    journal = readMigrationJournal();
  }
  assertJournalMatchesPins(journal, options, runtimePins);
  for (const [name, value] of Object.entries(expected)) {
    if (journal[name] !== value) failure('migration_journal_identity_mismatch');
  }
  return journal;
}

function migrationEvidence({ after, journal, recovered }) {
  return Object.freeze({
    afterStateSha256: after.stateSha256,
    artifactKind: 'cabohealth-access-code-schema-transition-migration-v1',
    beforeStateSha256: journal.beforeStateSha256,
    containsSensitiveValues: false,
    migratedAt: new Date().toISOString(),
    postconditionUpdateTimeSha256: after.sanitizedState.transitionUpdateTimeSha256,
    preconditionUpdateTimeSha256: journal.transitionUpdateTimeSha256,
    recoveredAfterUncertainResponse: recovered,
    schemaVersion: 1,
    status: recovered ? 'migrated-and-verified-recovered' : 'migrated-and-verified',
    transitionDocumentNameSha256: journal.transitionDocumentNameSha256,
    updatedFields: Object.freeze(['schemaVersion']),
    writerPauseStateSha256: journal.pauseStateSha256,
  });
}

async function executeMigration(options) {
  const runtimePins = await assertRuntimePins(options);
  const boundOptions = Object.freeze({ ...options, operatorAccount: runtimePins.account });
  const token = acquireAccessToken(runtimePins.account);
  const observed = await captureRemoteSnapshot(boundOptions, token);
  if (isExpectedTransitionState(observed, 'after')) {
    const journal = readMigrationJournal();
    if (journal === null) failure('migration_journal_required_for_recovery');
    assertJournalMatchesPins(journal, options, runtimePins);
    if (sha256(observed.internalTransition.name) !== journal.transitionDocumentNameSha256) {
      failure('migration_recovery_identity_mismatch');
    }
    await assertRuntimePinsStillHold(options, runtimePins);
    return migrationEvidence({ after: observed, journal, recovered: true });
  }
  assertExpectedTransitionState(observed, 'before');
  if (observed.stateSha256 !== options.reviewedBeforeStateSha256) {
    failure('reviewed_before_state_sha256_mismatch');
  }
  const transition = observed.internalTransition;
  const journal = ensureMigrationJournal(options, runtimePins, transition);
  const patch = buildSchemaVersionPatch({
    database: options.database,
    documentName: transition.name,
    project: options.project,
    updateTime: transition.updateTime,
  });
  let updated;
  try {
    updated = await requestJson(
      patch.url,
      { body: patch.body, method: patch.method, token },
    );
  } catch (error) {
    const recovery = await captureRemoteSnapshot(boundOptions, token);
    if (
      isExpectedTransitionState(recovery, 'after')
      && sha256(recovery.internalTransition.name) === journal.transitionDocumentNameSha256
    ) {
      await assertRuntimePinsStillHold(options, runtimePins);
      return migrationEvidence({ after: recovery, journal, recovered: true });
    }
    throw error;
  }
  const updatedFields = assertPlainObject(updated?.fields, 'patch_response_fields_invalid');
  if (
    updated?.name !== transition.name
    || canonicalJson(Object.keys(updatedFields).sort()) !== canonicalJson(['schemaVersion'])
    || parseIntegerField(updatedFields.schemaVersion) !== 2
    || typeof updated?.updateTime !== 'string'
    || updated.updateTime === transition.updateTime
  ) failure('patch_response_postcondition_failed');
  const after = await captureRemoteSnapshot(boundOptions, token);
  assertExpectedTransitionState(after, 'after');
  if (
    after.internalTransition.name !== transition.name
    || after.internalTransition.updateTime !== updated.updateTime
  ) failure('transition_postcondition_changed');
  await assertRuntimePinsStillHold(options, runtimePins);
  return migrationEvidence({ after, journal, recovered: false });
}

export async function runTransition(argv) {
  const options = parseTransitionArguments(argv);
  return options.action === 'check'
    ? executeCheck(options)
    : executeMigration(options);
}

async function main() {
  try {
    const evidence = await runTransition(process.argv.slice(2));
    process.stdout.write(`${canonicalJson(evidence)}\n`);
  } catch (error) {
    const code = error instanceof TransitionFailure ? error.code : 'unexpected_failure';
    process.stderr.write(`${canonicalJson({ code, status: 'failed' })}\n`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) await main();
