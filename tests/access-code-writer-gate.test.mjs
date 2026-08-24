import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WRITER_GATE_SCOPE,
  WRITER_GATE_LOCK_FILENAME,
  assertExpectedWriterGateState,
  buildCloudRunSetIamPolicyRequest,
  buildWriterGateMutationPlan,
  buildWriterGatePlan,
  derivePausedIamPolicy,
  evaluateWriterGateState,
  normalizeIamPolicy,
  parseGcloudVersionOutput,
  parseWriterGateArguments,
  validateWriterGatePlan,
  withWriterGateProcessLock,
} from '../scripts/access-code-writer-gate.mjs';

const project = 'cabohealth-owner-prod';
const region = 'us-central1';
const runtimeServiceAccount = 'cabohealth-functions@cabohealth-owner-prod.iam.gserviceaccount.com';
const allServices = [
  ...WRITER_GATE_SCOPE.httpsWriterServices,
  WRITER_GATE_SCOPE.scheduledService,
];

function iamPolicy(serviceName, state = 'running', etagSuffix = 'baseline') {
  const invokerMember = serviceName === WRITER_GATE_SCOPE.scheduledService
    ? `serviceAccount:${runtimeServiceAccount}`
    : 'allUsers';
  return {
    bindings: [
      ...(state === 'running'
        ? [{ members: [invokerMember], role: 'roles/run.invoker' }]
        : []),
    ],
    etag: `Bw-${serviceName}-${etagSuffix}`,
    version: 1,
  };
}

function schedulerJob(state = 'ENABLED', updateTime = '2026-08-24T20:00:00.000Z') {
  return {
    attemptDeadline: '180s',
    httpTarget: {
      httpMethod: 'POST',
      oidcToken: { serviceAccountEmail: runtimeServiceAccount },
      uri: `https://${region}-${project}.cloudfunctions.net/retryClientAccountDeletions`,
    },
    lastAttemptTime: '2026-08-24T19:59:00.000Z',
    name: `projects/${project}/locations/${region}/jobs/${WRITER_GATE_SCOPE.schedulerJob}`,
    retryConfig: { maxBackoffDuration: '3600s', maxDoublings: 5 },
    schedule: 'every 5 minutes',
    scheduleTime: '2026-08-24T20:04:00.000Z',
    state,
    timeZone: 'UTC',
    userUpdateTime: updateTime,
  };
}

function observation({
  projectPolicy = {
    bindings: [{ members: ['user:owner@example.test'], role: 'roles/owner' }],
    etag: 'Bw-project-baseline',
    version: 1,
  },
  schedulerState = 'ENABLED',
  schedulerUpdateTime,
  serviceStates = {},
} = {}) {
  return {
    projectIamPolicy: projectPolicy,
    schedulerJob: schedulerJob(schedulerState, schedulerUpdateTime),
    services: allServices.map((serviceName) => ({
      iamPolicy: iamPolicy(
        serviceName,
        serviceStates[serviceName] ?? 'running',
        serviceStates[serviceName] ?? 'baseline',
      ),
      service: {
        invokerIamDisabled: false,
        name: `projects/${project}/locations/${region}/services/${serviceName}`,
      },
      serviceName,
    })),
  };
}

function buildPlan() {
  return buildWriterGatePlan({
    createdAt: '2026-08-24T20:01:00.000Z',
    gcloudVersion: '567.0.0',
    nodeVersion: '22.22.3',
    observation: observation(),
    operatorAccountSha256: 'a'.repeat(64),
    scriptSha256: 'b'.repeat(64),
  });
}

function observationFromPlan(plan, {
  projectPolicy = plan.projectIamPolicy,
  schedulerState = 'ENABLED',
  schedulerUpdateTime = '2026-08-24T20:02:00.000Z',
  serviceStates = {},
} = {}) {
  return {
    projectIamPolicy: projectPolicy,
    schedulerJob: {
      ...plan.schedulerJob,
      lastAttemptTime: '2026-08-24T20:04:00.000Z',
      scheduleTime: '2026-08-24T20:09:00.000Z',
      state: schedulerState,
      userUpdateTime: schedulerUpdateTime,
    },
    services: plan.services.map((service) => {
      const state = serviceStates[service.serviceName] ?? 'running';
      const semantic = state === 'running'
        ? service.runningIamPolicy
        : service.pausedIamPolicy;
      return {
        iamPolicy: {
          ...structuredClone(semantic),
          etag: `Bw-${service.serviceName}-${state}-current`,
        },
        service: {
          invokerIamDisabled: false,
          name: `projects/${project}/locations/${region}/services/${service.serviceName}`,
        },
        serviceName: service.serviceName,
      };
    }),
  };
}

test('argument parser keeps plan/check read-only and mutations explicitly applied', () => {
  assert.deepEqual(parseWriterGateArguments([
    'plan',
    `--project=${project}`,
    `--region=${region}`,
  ]), { action: 'plan', project, region });
  assert.deepEqual(parseWriterGateArguments([
    'pause',
    `--project=${project}`,
    `--region=${region}`,
    '--apply',
  ]), { action: 'pause', project, region });
  assert.deepEqual(parseWriterGateArguments([
    'check',
    `--project=${project}`,
    `--region=${region}`,
    '--expect=paused',
  ]), { action: 'check', expect: 'paused', project, region });
  assert.deepEqual(parseWriterGateArguments([
    'resume',
    `--project=${project}`,
    `--region=${region}`,
    '--apply',
  ]), { action: 'resume', project, region });
  assert.throws(() => parseWriterGateArguments([
    'pause',
    `--project=${project}`,
    `--region=${region}`,
  ]), /apply_flag_required/u);
  assert.throws(() => parseWriterGateArguments([
    'plan',
    '--project=wrong-project',
    `--region=${region}`,
  ]), /wrong_project/u);
  assert.throws(() => parseWriterGateArguments([
    'check',
    `--project=${project}`,
    `--region=${region}`,
    '--expect=partial',
  ]), /invalid_expected_state/u);
});

test('process lock rejects overlap and safely reuses its persistent sentinel', async () => {
  const privateDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'cabohealth-writer-gate-lock-')),
  );
  chmodSync(privateDirectory, 0o700);
  const lockPath = join(privateDirectory, WRITER_GATE_LOCK_FILENAME);
  try {
    await withWriterGateProcessLock(async () => {
      assert.equal(existsSync(lockPath), true);
      const moduleUrl = new URL('../scripts/access-code-writer-gate.mjs', import.meta.url).href;
      const childSource = `
        import { withWriterGateProcessLock } from ${JSON.stringify(moduleUrl)};
        try {
          await withWriterGateProcessLock(async () => {}, {
            privateDirectory: ${JSON.stringify(privateDirectory)},
          });
          process.exit(0);
        } catch (error) {
          process.exit(error?.code === 'writer_gate_locked' ? 23 : 24);
        }
      `;
      const child = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', childSource],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      assert.equal(child.status, 23);
      await assert.rejects(
        withWriterGateProcessLock(async () => {}, { privateDirectory }),
        /writer_gate_locked/u,
      );
      assert.equal(existsSync(lockPath), true);
    }, { privateDirectory });
    assert.equal(existsSync(lockPath), true);
    await withWriterGateProcessLock(async () => {
      assert.equal(existsSync(lockPath), true);
    }, { privateDirectory });
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(privateDirectory, { force: true, recursive: true });
  }
});

test('gcloud pin is accepted only from validated JSON output', () => {
  assert.equal(parseGcloudVersionOutput(JSON.stringify({
    'Google Cloud SDK': '567.0.0',
    bq: '2.1.31',
  })), '567.0.0');
  assert.throws(() => parseGcloudVersionOutput('Google Cloud SDK 567.0.0'), /gcloud_version_response_invalid/u);
  assert.throws(() => parseGcloudVersionOutput(JSON.stringify({
    'Google Cloud SDK': 'latest',
  })), /gcloud_version_response_invalid/u);
});

test('plan pins exact scope, operator/tool identities, IAM policies, and scheduler', () => {
  const plan = buildPlan();
  assert.deepEqual(validateWriterGatePlan(structuredClone(plan)), plan);
  assert.equal(plan.artifactKind, 'cabohealth-access-code-writer-gate-plan-v1');
  assert.equal(plan.pins.operatorAccountSha256, 'a'.repeat(64));
  assert.equal(plan.pins.gcloudVersion, '567.0.0');
  assert.equal(plan.pins.nodeVersion, '22.22.3');
  assert.equal(plan.pins.scriptSha256, 'b'.repeat(64));
  assert.deepEqual(plan.scope, WRITER_GATE_SCOPE);
  assert.equal(plan.schedulerJob.state, 'ENABLED');
  assert.equal(plan.services.length, 8);
  for (const service of plan.services) {
    assert.equal(service.runningIamPolicy.etag.startsWith('Bw-'), true);
    assert.equal(Object.hasOwn(service.pausedIamPolicy, 'etag'), false);
    assert.equal(service.pausedIamPolicy.bindings.some(({ role }) => role === 'roles/run.invoker'), false);
  }
});

test('paused policy removes every invoker role but preserves unrelated and conditional bindings', () => {
  const policy = normalizeIamPolicy({
    bindings: [
      { members: ['allUsers'], role: 'roles/run.invoker' },
      { members: ['serviceAccount:a@example.test'], role: 'roles/cloudfunctions.invoker' },
      {
        condition: { expression: 'request.time < timestamp("2030-01-01T00:00:00Z")', title: 'expiry' },
        members: ['user:reader@example.test'],
        role: 'roles/viewer',
      },
    ],
    etag: 'Bw-policy-etag',
    version: 3,
  });
  const paused = derivePausedIamPolicy(policy);
  assert.equal(paused.bindings.length, 1);
  assert.equal(paused.bindings[0].role, 'roles/viewer');
  assert.equal(paused.bindings[0].condition.title, 'expiry');
  assert.equal(Object.hasOwn(paused, 'etag'), false);
});

test('running state plans scheduler pause first and all service IAM changes after it', () => {
  const plan = buildPlan();
  const current = observationFromPlan(plan);
  const mutation = buildWriterGateMutationPlan(plan, current, 'pause');
  assert.deepEqual(mutation.operations[0], { kind: 'scheduler', targetState: 'paused' });
  assert.equal(mutation.operations.length, 9);
  assert.deepEqual(
    mutation.operations.slice(1).map(({ serviceName }) => serviceName),
    allServices,
  );
  assert.equal(mutation.operations.slice(1).every(({ targetState }) => targetState === 'paused'), true);
});

test('partial pause is idempotent and skips already-paused writers', () => {
  const plan = buildPlan();
  const serviceStates = {
    [allServices[0]]: 'paused',
    [allServices[3]]: 'paused',
  };
  const current = observationFromPlan(plan, { schedulerState: 'PAUSED', serviceStates });
  const mutation = buildWriterGateMutationPlan(plan, current, 'pause');
  assert.equal(mutation.operations.some(({ kind }) => kind === 'scheduler'), false);
  assert.deepEqual(
    mutation.operations.map(({ serviceName }) => serviceName),
    allServices.filter((serviceName) => serviceStates[serviceName] !== 'paused'),
  );
});

test('resume restores service policies first and scheduler only at the end', () => {
  const plan = buildPlan();
  const serviceStates = Object.fromEntries(allServices.map((name) => [name, 'paused']));
  const current = observationFromPlan(plan, { schedulerState: 'PAUSED', serviceStates });
  const mutation = buildWriterGateMutationPlan(plan, current, 'resume');
  assert.equal(mutation.operations.length, 9);
  assert.equal(mutation.operations.slice(0, -1).every(({ kind }) => kind === 'serviceIam'), true);
  assert.deepEqual(mutation.operations.at(-1), { kind: 'scheduler', targetState: 'running' });
});

test('resume repairs an unsafe partial state by pausing scheduler before restoring services', () => {
  const plan = buildPlan();
  const serviceStates = { [allServices[2]]: 'paused' };
  const current = observationFromPlan(plan, { schedulerState: 'ENABLED', serviceStates });
  const mutation = buildWriterGateMutationPlan(plan, current, 'resume');
  assert.deepEqual(mutation.operations, [
    { kind: 'scheduler', targetState: 'paused' },
    { kind: 'serviceIam', serviceName: allServices[2], targetState: 'running' },
    { kind: 'scheduler', targetState: 'running' },
  ]);
});

test('state check requires every writer and scheduler to match the requested state', () => {
  const plan = buildPlan();
  const running = evaluateWriterGateState(plan, observationFromPlan(plan));
  assertExpectedWriterGateState(running, 'running');
  assert.throws(() => assertExpectedWriterGateState(running, 'paused'), /writer_gate_not_paused/u);

  const pausedStates = Object.fromEntries(allServices.map((name) => [name, 'paused']));
  const paused = evaluateWriterGateState(plan, observationFromPlan(plan, {
    schedulerState: 'PAUSED',
    serviceStates: pausedStates,
  }));
  assertExpectedWriterGateState(paused, 'paused');
  assert.equal(paused.sanitized.pausedServiceCount, 8);
  assert.match(paused.stateSha256, /^[0-9a-f]{64}$/u);
  const output = JSON.stringify(paused.sanitized);
  assert.equal(output.includes('owner@example.test'), false);
  assert.equal(output.includes(runtimeServiceAccount), false);
  assert.equal(output.includes('allUsers'), false);
});

test('Cloud Run v2 setIamPolicy request uses the just-fetched etag as precondition', () => {
  const plan = buildPlan();
  const serviceName = allServices[0];
  const current = {
    ...plan.services[0].runningIamPolicy,
    etag: 'Bw-newly-fetched-etag',
  };
  const request = buildCloudRunSetIamPolicyRequest(plan, serviceName, 'paused', current);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${serviceName}:setIamPolicy`);
  assert.deepEqual(JSON.parse(request.body), {
    policy: {
      auditConfigs: [],
      bindings: [],
      etag: 'Bw-newly-fetched-etag',
      version: 1,
    },
    updateMask: 'bindings,etag',
  });
});

test('plan and execution fail closed on project-wide invoker, disabled checks, or drift', () => {
  const projectWide = observation({
    projectPolicy: {
      bindings: [{ members: ['allUsers'], role: 'roles/run.invoker' }],
      etag: 'Bw-project-public',
      version: 1,
    },
  });
  assert.throws(() => buildWriterGatePlan({
    createdAt: '2026-08-24T20:01:00.000Z',
    gcloudVersion: '567.0.0',
    nodeVersion: '22.22.3',
    observation: projectWide,
    operatorAccountSha256: 'a'.repeat(64),
    scriptSha256: 'b'.repeat(64),
  }), /project_wide_invoker_detected/u);

  const publicCustomRole = observation({
    projectPolicy: {
      bindings: [{
        members: ['allAuthenticatedUsers'],
        role: `projects/${project}/roles/customMaybeInvoker`,
      }],
      etag: 'Bw-project-custom-public',
      version: 1,
    },
  });
  assert.throws(() => buildWriterGatePlan({
    createdAt: '2026-08-24T20:01:00.000Z',
    gcloudVersion: '567.0.0',
    nodeVersion: '22.22.3',
    observation: publicCustomRole,
    operatorAccountSha256: 'a'.repeat(64),
    scriptSha256: 'b'.repeat(64),
  }), /project_wide_public_principal_detected/u);

  const customServicePolicy = observation();
  customServicePolicy.services[0].iamPolicy.bindings.push({
    members: ['serviceAccount:unexpected@example.test'],
    role: `projects/${project}/roles/customInvoker`,
  });
  assert.throws(() => buildWriterGatePlan({
    createdAt: '2026-08-24T20:01:00.000Z',
    gcloudVersion: '567.0.0',
    nodeVersion: '22.22.3',
    observation: customServicePolicy,
    operatorAccountSha256: 'a'.repeat(64),
    scriptSha256: 'b'.repeat(64),
  }), /unexpected_writer_service_policy/u);

  const disabled = observation();
  disabled.services[0].service.invokerIamDisabled = true;
  assert.throws(() => buildWriterGatePlan({
    createdAt: '2026-08-24T20:01:00.000Z',
    gcloudVersion: '567.0.0',
    nodeVersion: '22.22.3',
    observation: disabled,
    operatorAccountSha256: 'a'.repeat(64),
    scriptSha256: 'b'.repeat(64),
  }), /service_invoker_iam_not_enabled/u);

  const plan = buildPlan();
  const iamDrift = observationFromPlan(plan);
  iamDrift.services[0].iamPolicy.bindings.push({
    members: ['user:unexpected@example.test'],
    role: 'roles/editor',
  });
  assert.throws(() => evaluateWriterGateState(plan, iamDrift), /service_iam_policy_drift/u);

  const schedulerDrift = observationFromPlan(plan);
  schedulerDrift.schedulerJob.schedule = 'every 10 minutes';
  assert.throws(() => evaluateWriterGateState(plan, schedulerDrift), /scheduler_job_invalid/u);
});
