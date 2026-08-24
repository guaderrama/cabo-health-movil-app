import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  TransitionFailure,
  runTransition,
} from '../scripts/access-code-schema-transition.mjs';

const project = 'cabohealth-owner-prod';
const database = '(default)';
const region = 'us-central1';
const operatorAccount = 'owner.secret@example.test';
const alternateOperatorAccount = 'unexpected.secret@example.test';
const accessToken = 'ya29.secret-access-token-never-print';
const documentName = `projects/${project}/databases/${database}/documents/_private_access_codes/ac_${'Q'.repeat(32)}`;
const beforeUpdateTime = '2026-08-24T19:00:00.123456Z';
const afterUpdateTime = '2026-08-24T19:05:00.999999Z';
const readTime = '2026-08-24T19:06:00.000000Z';
const transaction = 'dHJhbnNhY3Rpb24tc2VjcmV0';
const unsafeEnvironmentNames = [
  'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_DATABASE_EMULATOR_HOST',
  'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
  'CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT',
  'CLOUDSDK_CONFIG',
  'CLOUDSDK_CORE_ACCOUNT',
  'CLOUDSDK_CORE_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fakeGcloudProgram() {
  const fs = require('node:fs');

  const args = process.argv.slice(2);
  const controlPath = process.env.FAKE_GCLOUD_CONTROL;
  const logPath = process.env.FAKE_GCLOUD_LOG;
  const archivePath = process.env.FAKE_GCLOUD_ARCHIVE;
  const control = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
  fs.appendFileSync(logPath, `${JSON.stringify(args)}\n`, { mode: 0o600 });

  const outputJson = (value) => process.stdout.write(JSON.stringify(value));
  const functionName = args[2];
  const serviceName = args[3];
  const runtimeServiceAccount = 'cabohealth-functions@cabohealth-owner-prod.iam.gserviceaccount.com';
  const project = 'cabohealth-owner-prod';
  const region = 'us-central1';
  const schedulerJob = 'firebase-schedule-retryClientAccountDeletions-us-central1';

  if (args[0] === 'version') {
    outputJson({ 'Google Cloud SDK': control.gcloudVersion });
    return;
  }
  if (args[0] === 'auth' && args[1] === 'list') {
    outputJson([{ account: control.operatorAccount, status: 'ACTIVE' }]);
    return;
  }
  if (args[0] === 'auth' && args[1] === 'print-access-token') {
    process.stdout.write(control.accessToken);
    return;
  }
  if (args[0] === 'functions' && args[1] === 'describe') {
    const limits = functionName === 'brokerApi'
      ? { maxInstanceCount: 10, timeoutSeconds: 15 }
      : functionName === 'retryClientAccountDeletions'
        ? { maxInstanceCount: 1, timeoutSeconds: 120 }
        : { maxInstanceCount: 10, timeoutSeconds: 30 };
    outputJson({
      buildConfig: {
        entryPoint: functionName,
        runtime: 'nodejs22',
        source: {
          storageSource: {
            bucket: 'gcf-v2-sources-123456789-us-central1',
            generation: '123456789',
            object: 'bridge/function-source.zip',
          },
        },
      },
      labels: {
        'deployment-tool': 'cli-firebase',
        'firebase-functions-codebase': 'client-access',
        'firebase-functions-hash': 'a'.repeat(40),
      },
      name: `projects/${project}/locations/${region}/functions/${functionName}`,
      serviceConfig: {
        allTrafficOnLatestRevision: true,
        maxInstanceCount: limits.maxInstanceCount,
        service: `projects/${project}/locations/${region}/services/${functionName.toLowerCase()}`,
        serviceAccountEmail: runtimeServiceAccount,
        timeoutSeconds: limits.timeoutSeconds,
      },
      state: 'ACTIVE',
      updateTime: '2026-08-24T18:00:00.000000Z',
    });
    return;
  }
  if (args[0] === 'run' && args[1] === 'services' && args[2] === 'describe') {
    const revision = `${serviceName}-${control.runtimeRevision}`;
    outputJson({
      invokerIamDisabled: false,
      metadata: { annotations: {}, name: serviceName },
      spec: { template: { spec: { serviceAccountName: runtimeServiceAccount } } },
      status: {
        conditions: [{ status: 'True', type: 'Ready' }],
        latestCreatedRevisionName: revision,
        latestReadyRevisionName: revision,
        observedGeneration: control.observedGeneration,
        traffic: [{ latestRevision: true, percent: 100, revisionName: revision }],
      },
    });
    return;
  }
  if (args[0] === 'run' && args[1] === 'services' && args[2] === 'get-iam-policy') {
    const isPublic = control.publicServices.includes(serviceName);
    outputJson({
      bindings: isPublic ? [{ members: ['allUsers'], role: 'roles/run.invoker' }] : [],
      etag: `etag-${serviceName}`,
      version: 1,
    });
    return;
  }
  if (args[0] === 'scheduler' && args[1] === 'jobs' && args[2] === 'describe') {
    outputJson({
      httpTarget: {
        httpMethod: 'POST',
        oidcToken: { serviceAccountEmail: runtimeServiceAccount },
        uri: `https://${region}-${project}.cloudfunctions.net/retryClientAccountDeletions`,
      },
      name: `projects/${project}/locations/${region}/jobs/${schedulerJob}`,
      schedule: 'every 5 minutes',
      state: control.schedulerState,
      timeZone: 'UTC',
      userUpdateTime: '2026-08-24T18:30:00.000000Z',
    });
    return;
  }
  if (args[0] === 'projects' && args[1] === 'get-iam-policy') {
    outputJson({
      bindings: [
        ...(control.projectWideInvoker
          ? [{ members: ['allUsers'], role: 'roles/run.invoker' }]
          : []),
        ...(control.projectWidePublicCustom
          ? [{ members: ['allAuthenticatedUsers'], role: `projects/${project}/roles/customInvoker` }]
          : []),
      ],
      etag: 'project-etag',
      version: 1,
    });
    return;
  }
  if (args[0] === 'projects' && args[1] === 'get-ancestors') {
    outputJson([
      { id: project, type: 'project' },
      ...(control.hasParent ? [{ id: 'parent-folder', type: 'folder' }] : []),
    ]);
    return;
  }
  if (args[0] === 'storage' && args[1] === 'cat') {
    process.stdout.write(fs.readFileSync(archivePath));
    return;
  }

  process.stderr.write(`unsupported fake gcloud invocation: ${JSON.stringify(args)}\n`);
  process.exitCode = 91;
}

function writeJson(path, value, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode });
  chmodSync(path, mode);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function response(status, value, {
  contentType = 'application/json; charset=utf-8',
  rawText = null,
  sequence = false,
} = {}) {
  return {
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    status,
    async json() {
      return value;
    },
    async text() {
      if (rawText !== null) return rawText;
      return sequence
        ? value.map((item) => JSON.stringify(item)).join('\n')
        : JSON.stringify(value);
    },
  };
}

function createFirestoreFake(controlPath) {
  const state = {
    calls: [],
    onPatch: null,
    patchCalls: 0,
    patchMode: 'success',
    schemaVersion: 1,
    updateTime: beforeUpdateTime,
  };

  const fakeFetch = async (urlValue, request) => {
    const url = new URL(urlValue);
    const body = request.body === undefined ? null : JSON.parse(request.body);
    state.calls.push({
      authorization: request.headers.authorization,
      body,
      method: request.method,
      url: url.toString(),
    });
    if (url.hostname.endsWith('.cloudfunctions.net')) {
      const control = readJson(controlPath);
      if (control.dataPlaneDenied) {
        return response(403, null, {
          contentType: 'text/html; charset=UTF-8',
          rawText: '<html><head><title>403 Forbidden</title></head><body>Forbidden</body></html>',
        });
      }
      return response(401, { error: 'application-level rejection' });
    }
    if (url.pathname.endsWith(':beginTransaction')) {
      return response(200, { transaction });
    }
    if (url.pathname.endsWith(':runQuery')) {
      const collectionId = body?.structuredQuery?.from?.[0]?.collectionId;
      if (collectionId === '_private_access_codes') {
        return response(200, [{
          document: {
            fields: { schemaVersion: { integerValue: String(state.schemaVersion) } },
            name: documentName,
            updateTime: state.updateTime,
          },
          readTime,
        }]);
      }
      if (collectionId === '_private_client_slots') return response(200, []);
      return response(499, { error: 'unexpected collection' });
    }
    if (url.pathname.endsWith(':batchGet')) {
      const counterName = `projects/${project}/databases/${database}/documents/_private_admin_counters/active_client_codes`;
      return response(200, [{ missing: counterName, readTime }], { sequence: true });
    }
    if (url.pathname.endsWith(':rollback')) return response(200, {});
    if (request.method === 'PATCH') {
      state.patchCalls += 1;
      state.onPatch?.();
      if (state.patchMode === 'precondition-412') return response(412, { error: 'precondition' });
      state.schemaVersion = 2;
      state.updateTime = afterUpdateTime;
      if (state.patchMode === 'lost-response') {
        throw new Error(`${accessToken} ${documentName} ${beforeUpdateTime}`);
      }
      return response(200, {
        fields: { schemaVersion: { integerValue: '2' } },
        name: documentName,
        updateTime: afterUpdateTime,
      });
    }
    return response(499, { error: 'unexpected request' });
  };

  return { fakeFetch, state };
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-transition-harness-'));
  const functionsDirectory = join(root, 'functions');
  const bridgePath = join(functionsDirectory, 'src/repositories/firestoreClientAccessStore.ts');
  const buildDirectory = join(functionsDirectory, 'lib');
  const privateDirectory = join(root, 'release/private');
  const binDirectory = join(root, 'bin');
  const controlPath = join(root, 'fake-gcloud-control.json');
  const logPath = join(root, 'fake-gcloud-log.jsonl');
  const archivePath = join(root, 'function-source.zip');
  const packageJsonPath = join(functionsDirectory, 'package.json');
  const packageLockPath = join(functionsDirectory, 'package-lock.json');
  const fakeGcloudPath = join(binDirectory, 'gcloud');
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const originalEnvironment = new Map([
    ['PATH', process.env.PATH],
    ['FAKE_GCLOUD_ARCHIVE', process.env.FAKE_GCLOUD_ARCHIVE],
    ['FAKE_GCLOUD_CONTROL', process.env.FAKE_GCLOUD_CONTROL],
    ['FAKE_GCLOUD_LOG', process.env.FAKE_GCLOUD_LOG],
    ...unsafeEnvironmentNames.map((name) => [name, process.env[name]]),
  ]);

  mkdirSync(dirname(bridgePath), { mode: 0o700, recursive: true });
  mkdirSync(join(buildDirectory, 'repositories'), { mode: 0o700, recursive: true });
  mkdirSync(privateDirectory, { mode: 0o700, recursive: true });
  chmodSync(privateDirectory, 0o700);
  mkdirSync(binDirectory, { mode: 0o700 });
  writeFileSync(bridgePath, 'export const bridgeReader = true;\n', { mode: 0o600 });
  writeFileSync(join(buildDirectory, 'index.js'), 'export const functions = 11;\n', { mode: 0o600 });
  writeFileSync(
    join(buildDirectory, 'repositories/firestoreClientAccessStore.js'),
    'export const acceptedSchemaVersions = [1, 2];\n',
    { mode: 0o600 },
  );
  const packageJson = {
    dependencies: { 'firebase-admin': '14.3.0', 'firebase-functions': '7.3.2' },
    devDependencies: { typescript: '5.9.2' },
    engines: { node: '22' },
    main: 'lib/index.js',
    name: 'cabohealth-secure-functions',
    scripts: { build: 'tsc' },
    type: 'module',
    version: '1.0.0',
  };
  const packageLock = {
    lockfileVersion: 3,
    name: packageJson.name,
    packages: {
      '': {
        dependencies: packageJson.dependencies,
        devDependencies: packageJson.devDependencies,
        engines: packageJson.engines,
        name: packageJson.name,
        version: packageJson.version,
      },
    },
    requires: true,
    version: packageJson.version,
  };
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson)}\n`, { mode: 0o600 });
  writeFileSync(packageLockPath, `${JSON.stringify(packageLock)}\n`, { mode: 0o600 });
  execFileSync(
    '/usr/bin/zip',
    ['-q', '-r', archivePath, 'lib', 'package.json', 'package-lock.json'],
    {
    cwd: functionsDirectory,
    env: { LANG: 'C', PATH: '/usr/bin:/bin' },
    stdio: 'ignore',
    },
  );
  writeFileSync(
    fakeGcloudPath,
    `#!${process.execPath}\n(${fakeGcloudProgram.toString()})();\n`,
    { mode: 0o700 },
  );
  chmodSync(fakeGcloudPath, 0o700);
  writeFileSync(logPath, '', { mode: 0o600 });
  writeJson(controlPath, {
    accessToken,
    dataPlaneDenied: true,
    gcloudVersion: '567.0.0',
    hasParent: false,
    observedGeneration: 7,
    operatorAccount,
    projectWidePublicCustom: false,
    projectWideInvoker: false,
    publicServices: [],
    runtimeRevision: '00001-abc',
    schedulerState: 'PAUSED',
  });

  const firestore = createFirestoreFake(controlPath);
  process.chdir(root);
  process.env.PATH = `${binDirectory}:${originalEnvironment.get('PATH') ?? ''}`;
  process.env.FAKE_GCLOUD_ARCHIVE = archivePath;
  process.env.FAKE_GCLOUD_CONTROL = controlPath;
  process.env.FAKE_GCLOUD_LOG = logPath;
  for (const name of unsafeEnvironmentNames) delete process.env[name];
  globalThis.fetch = firestore.fakeFetch;

  return {
    archivePath,
    bridgePath,
    buildDirectory,
    controlPath,
    firestore: firestore.state,
    journalPath: join(privateDirectory, 'access-code-schema-transition.journal.json'),
    logPath,
    observationPath: join(privateDirectory, 'access-code-writer-pause-observation.json'),
    packageJsonPath,
    packageLockPath,
    privateDirectory,
    async check(expected = 'before') {
      return runTransition([
        'check',
        `--project=${project}`,
        `--database=${database}`,
        `--expect=${expected}`,
      ]);
    },
    dispose() {
      globalThis.fetch = originalFetch;
      process.chdir(originalCwd);
      for (const [name, value] of originalEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(root, { force: true, recursive: true });
    },
    gcloudCalls() {
      return readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    migrationArguments(checkEvidence) {
      return [
        'migrate',
        `--project=${project}`,
        `--database=${database}`,
        '--apply',
        `--reviewed-bridge-build-tree-sha256=${checkEvidence.bridgeBuildTreeSha256}`,
        `--reviewed-bridge-runtime-sha256=${checkEvidence.functionsRuntimeSha256}`,
        `--reviewed-script-sha256=${checkEvidence.scriptSha256}`,
        `--reviewed-bridge-source-sha256=${checkEvidence.bridgeSourceSha256}`,
        `--reviewed-before-state-sha256=${checkEvidence.stateSha256}`,
        `--reviewed-gcloud-version=${checkEvidence.gcloudVersion}`,
        `--reviewed-node-version=${checkEvidence.nodeVersion}`,
        `--reviewed-operator-account-sha256=${checkEvidence.operatorAccountSha256}`,
      ];
    },
    setControl(changes) {
      writeJson(controlPath, { ...readJson(controlPath), ...changes });
    },
  };
}

async function captureTransitionFailure(operation) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TransitionFailure);
  return caught;
}

function assertNoSecrets(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of [
    operatorAccount,
    alternateOperatorAccount,
    accessToken,
    documentName,
    beforeUpdateTime,
    afterUpdateTime,
    transaction,
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked secret: ${secret}`);
  }
}

function assertTransactionCycle(calls) {
  const operations = calls.map(({ method, url }) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith(':beginTransaction')) return 'begin';
    if (pathname.endsWith(':runQuery')) return 'query';
    if (pathname.endsWith(':batchGet')) return 'batchGet';
    if (pathname.endsWith(':rollback')) return 'rollback';
    if (method === 'PATCH') return 'patch';
    return 'other';
  });
  const begin = operations.indexOf('begin');
  assert.notEqual(begin, -1);
  assert.deepEqual(operations.slice(begin, begin + 5), [
    'begin',
    'query',
    'query',
    'batchGet',
    'rollback',
  ]);
  const cycle = calls.slice(begin, begin + 5);
  for (const call of cycle.slice(1, 4)) assert.equal(call.body.transaction, transaction);
  assert.deepEqual(cycle[4].body, { transaction });
}

async function prepareMigration(harness, { assertDrain = false } = {}) {
  const checkEvidence = await harness.check('before');
  const migrationArguments = harness.migrationArguments(checkEvidence);
  const created = await captureTransitionFailure(() => runTransition(migrationArguments));
  assert.equal(created.code, 'writer_pause_observation_created');
  assert.equal(statSync(harness.privateDirectory).mode & 0o777, 0o700);
  assert.equal(statSync(harness.observationPath).mode & 0o777, 0o600);
  assertNoSecrets(readFileSync(harness.observationPath, 'utf8'));
  if (assertDrain) {
    const incomplete = await captureTransitionFailure(() => runTransition(migrationArguments));
    assert.equal(incomplete.code, 'writer_drain_incomplete');
    assertNoSecrets({
      code: incomplete.code,
      message: incomplete.message,
      name: incomplete.name,
      stack: incomplete.stack,
    });
  }
  const observation = readJson(harness.observationPath);
  writeJson(harness.observationPath, {
    ...observation,
    observedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  return { checkEvidence, migrationArguments };
}

test('runTransition is end-to-end fail-closed with fake gcloud, Firestore, archive, and private state', async (t) => {
  await t.test('check and successful migration pin every boundary, drain, rerun, and redact evidence', async () => {
    const harness = createHarness();
    try {
      const { checkEvidence, migrationArguments } = await prepareMigration(harness, {
        assertDrain: true,
      });
      assert.equal(checkEvidence.status, 'verified');
      assert.equal(checkEvidence.expectedState, 'before');
      assert.equal(checkEvidence.deployedBuildMatchesLocal, true);
      assert.equal(checkEvidence.deployedArtifactCount, 1);
      assert.equal(checkEvidence.operatorAccountSha256, sha256(operatorAccount));
      assertNoSecrets(checkEvidence);

      const evidence = await runTransition(migrationArguments);
      assert.equal(evidence.status, 'migrated-and-verified');
      assert.equal(evidence.recoveredAfterUncertainResponse, false);
      assert.deepEqual(evidence.updatedFields, ['schemaVersion']);
      assertNoSecrets(evidence);
      assert.equal(statSync(harness.journalPath).mode & 0o777, 0o600);
      assertNoSecrets(readFileSync(harness.journalPath, 'utf8'));

      const patchCall = harness.firestore.calls.find(({ method }) => method === 'PATCH');
      assert.ok(patchCall);
      const patchUrl = new URL(patchCall.url);
      assert.deepEqual(patchCall.body, {
        fields: { schemaVersion: { integerValue: '2' } },
      });
      assert.deepEqual([...patchUrl.searchParams.keys()], [
        'updateMask.fieldPaths',
        'currentDocument.updateTime',
        'mask.fieldPaths',
      ]);
      assert.equal(patchUrl.searchParams.get('updateMask.fieldPaths'), 'schemaVersion');
      assert.equal(patchUrl.searchParams.get('mask.fieldPaths'), 'schemaVersion');
      assert.equal(patchUrl.searchParams.get('currentDocument.updateTime'), beforeUpdateTime);
      assert.equal(patchCall.authorization, `Bearer ${accessToken}`);
      assertTransactionCycle(harness.firestore.calls);

      const patchCount = harness.firestore.patchCalls;
      const rerun = await runTransition(migrationArguments);
      assert.equal(rerun.status, 'migrated-and-verified-recovered');
      assert.equal(rerun.recoveredAfterUncertainResponse, true);
      assert.equal(harness.firestore.patchCalls, patchCount);
      assertNoSecrets(rerun);

      const finalCheck = await harness.check('after');
      assert.equal(finalCheck.status, 'verified');
      assert.equal(finalCheck.expectedState, 'after');
      assertNoSecrets(finalCheck);

      const gcloudCalls = harness.gcloudCalls();
      const accountBoundCalls = gcloudCalls.filter((args) => (
        ['functions', 'run', 'scheduler', 'storage', 'projects'].includes(args[0])
        || (args[0] === 'auth' && args[1] === 'print-access-token')
      ));
      assert.ok(accountBoundCalls.length > 0);
      for (const args of accountBoundCalls) {
        assert.ok(args.includes(`--account=${operatorAccount}`));
        if (args[0] === 'projects') assert.equal(args[2], project);
        else if (args[0] !== 'auth') assert.ok(args.includes(`--project=${project}`));
      }
      assert.ok(gcloudCalls.some((args) => args[0] === 'functions' && args[1] === 'describe'));
      assert.ok(gcloudCalls.some((args) => args[0] === 'run' && args[2] === 'describe'));
      assert.ok(gcloudCalls.some((args) => args[0] === 'storage' && args[1] === 'cat'));
      assert.ok(gcloudCalls.some((args) => args[0] === 'scheduler' && args[1] === 'jobs'));
    } finally {
      harness.dispose();
    }
  });

  await t.test('412 preserves before state and journal, then a pinned retry succeeds', async () => {
    const harness = createHarness();
    try {
      const { migrationArguments } = await prepareMigration(harness);
      harness.firestore.patchMode = 'precondition-412';
      const failed = await captureTransitionFailure(() => runTransition(migrationArguments));
      assert.equal(failed.code, 'firestore_http_412');
      assert.equal(harness.firestore.schemaVersion, 1);
      assert.equal(harness.firestore.patchCalls, 1);
      assert.equal(statSync(harness.journalPath).mode & 0o777, 0o600);
      assertNoSecrets({
        code: failed.code,
        message: failed.message,
        name: failed.name,
        stack: failed.stack,
      });
      assertNoSecrets(readFileSync(harness.journalPath, 'utf8'));

      harness.firestore.patchMode = 'success';
      const recovered = await runTransition(migrationArguments);
      assert.equal(recovered.status, 'migrated-and-verified');
      assert.equal(harness.firestore.patchCalls, 2);
      assertNoSecrets(recovered);
    } finally {
      harness.dispose();
    }
  });

  await t.test('lost PATCH response is recovered from remote after-state without leaking cause', async () => {
    const harness = createHarness();
    try {
      const { migrationArguments } = await prepareMigration(harness);
      harness.firestore.patchMode = 'lost-response';
      const recovered = await runTransition(migrationArguments);
      assert.equal(recovered.status, 'migrated-and-verified-recovered');
      assert.equal(recovered.recoveredAfterUncertainResponse, true);
      assert.equal(harness.firestore.patchCalls, 1);
      assert.equal(harness.firestore.schemaVersion, 2);
      assertNoSecrets(recovered);
    } finally {
      harness.dispose();
    }
  });

  await t.test('final runtime revalidation fails closed after PATCH and permits journaled recovery', async () => {
    const harness = createHarness();
    try {
      const { migrationArguments } = await prepareMigration(harness);
      harness.firestore.onPatch = () => harness.setControl({ runtimeRevision: '00002-drift' });
      const failed = await captureTransitionFailure(() => runTransition(migrationArguments));
      assert.equal(failed.code, 'bridge_runtime_changed_during_migration');
      assert.equal(harness.firestore.schemaVersion, 2);
      assertNoSecrets({
        code: failed.code,
        message: failed.message,
        name: failed.name,
        stack: failed.stack,
      });

      harness.firestore.onPatch = null;
      harness.setControl({ runtimeRevision: '00001-abc' });
      const recovered = await runTransition(migrationArguments);
      assert.equal(recovered.status, 'migrated-and-verified-recovered');
      assert.equal(harness.firestore.patchCalls, 1);
      assertNoSecrets(recovered);
    } finally {
      harness.dispose();
    }
  });

  await t.test('account, IAM, scheduler, local build, and deployed archive drift stop before PATCH', async (driftTest) => {
    const cases = [
      {
        code: 'reviewed_operator_account_sha256_mismatch',
        mutate(harness) {
          harness.setControl({ operatorAccount: alternateOperatorAccount });
        },
        name: 'active operator account',
      },
      {
        code: 'https_writer_not_paused',
        mutate(harness) {
          harness.setControl({ publicServices: ['admincreateclientaccesscode'] });
        },
        name: 'IAM public invoker',
      },
      {
        code: 'scheduled_writer_not_paused',
        mutate(harness) {
          harness.setControl({ schedulerState: 'ENABLED' });
        },
        name: 'scheduler resumed',
      },
      {
        code: 'https_writer_data_plane_not_denied',
        mutate(harness) {
          harness.setControl({ dataPlaneDenied: false });
        },
        name: 'writer data-plane still reachable',
      },
      {
        code: 'project_hierarchy_not_isolated',
        mutate(harness) {
          harness.setControl({ hasParent: true });
        },
        name: 'inherited project hierarchy',
      },
      {
        code: 'project_wide_invoker_not_paused',
        mutate(harness) {
          harness.setControl({ projectWidePublicCustom: true });
        },
        name: 'public principal through a custom project role',
      },
      {
        code: 'reviewed_bridge_build_tree_sha256_mismatch',
        mutate(harness) {
          writeFileSync(
            join(harness.buildDirectory, 'index.js'),
            'export const functions = 12;\n',
            { mode: 0o600 },
          );
        },
        name: 'local build',
      },
      {
        code: 'deployed_bridge_build_tree_mismatch',
        mutate(harness) {
          const driftDirectory = join(dirname(harness.archivePath), 'drift');
          mkdirSync(join(driftDirectory, 'lib/repositories'), { recursive: true });
          writeFileSync(join(driftDirectory, 'lib/index.js'), 'export const drift = true;\n');
          writeFileSync(
            join(driftDirectory, 'lib/repositories/firestoreClientAccessStore.js'),
            'export const acceptedSchemaVersions = [2];\n',
          );
          execFileSync('/usr/bin/zip', ['-q', '-r', harness.archivePath, 'lib'], {
            cwd: driftDirectory,
            env: { LANG: 'C', PATH: '/usr/bin:/bin' },
            stdio: 'ignore',
          });
        },
        name: 'deployed source archive',
      },
      {
        code: 'deployed_bridge_source_control_mismatch',
        mutate(harness) {
          const driftDirectory = join(dirname(harness.archivePath), 'package-drift');
          mkdirSync(driftDirectory);
          writeFileSync(
            join(driftDirectory, 'package.json'),
            `${JSON.stringify({
              dependencies: { 'firebase-admin': '14.3.0', 'firebase-functions': '7.3.2' },
              devDependencies: { typescript: '5.9.2' },
              engines: { node: '22' },
              main: 'different-entry.js',
              name: 'cabohealth-secure-functions',
              scripts: { build: 'tsc' },
              type: 'module',
              version: '1.0.0',
            })}\n`,
            { mode: 0o600 },
          );
          execFileSync('/usr/bin/zip', ['-q', harness.archivePath, 'package.json'], {
            cwd: driftDirectory,
            env: { LANG: 'C', PATH: '/usr/bin:/bin' },
            stdio: 'ignore',
          });
        },
        name: 'deployed package entry point',
      },
      {
        code: 'deployed_bridge_source_control_mismatch',
        mutate(harness) {
          const driftDirectory = join(dirname(harness.archivePath), 'lock-drift');
          mkdirSync(driftDirectory);
          writeFileSync(
            join(driftDirectory, 'package-lock.json'),
            `${JSON.stringify({ lockfileVersion: 3, packages: {}, requires: true })}\n`,
            { mode: 0o600 },
          );
          execFileSync('/usr/bin/zip', ['-q', harness.archivePath, 'package-lock.json'], {
            cwd: driftDirectory,
            env: { LANG: 'C', PATH: '/usr/bin:/bin' },
            stdio: 'ignore',
          });
        },
        name: 'deployed dependency lockfile',
      },
    ];

    for (const drift of cases) {
      await driftTest.test(drift.name, async () => {
        const harness = createHarness();
        try {
          const { migrationArguments } = await prepareMigration(harness);
          drift.mutate(harness);
          const failed = await captureTransitionFailure(() => runTransition(migrationArguments));
          assert.equal(failed.code, drift.code);
          assert.equal(harness.firestore.patchCalls, 0);
          assertNoSecrets({
            code: failed.code,
            message: failed.message,
            name: failed.name,
            stack: failed.stack,
          });
        } finally {
          harness.dispose();
        }
      });
    }
  });
});
