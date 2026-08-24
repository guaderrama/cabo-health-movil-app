#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  constants as FS_CONSTANTS,
  existsSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_PROJECT = 'cabohealth-owner-prod';
const EXPECTED_REGION = 'us-central1';
const EXPECTED_NODE_VERSION = '22.22.3';
const EXPECTED_SCHEDULE = 'every 5 minutes';
const EXPECTED_TIME_ZONE = 'UTC';
const EXPECTED_RUNTIME_SERVICE_ACCOUNT =
  'cabohealth-functions@cabohealth-owner-prod.iam.gserviceaccount.com';
const SCHEDULER_JOB = 'firebase-schedule-retryClientAccountDeletions-us-central1';
const SCHEDULED_SERVICE = 'retryclientaccountdeletions';
const HTTPS_WRITER_SERVICES = Object.freeze([
  'admincreateclientaccesscode',
  'adminlistclientaccesscodes',
  'adminrevokeclientaccesscode',
  'deleteclientaccount',
  'redeemclientaccesscode',
  'refreshclientaccess',
  'removeclientaccess',
]);
const ALL_WRITER_SERVICES = Object.freeze([
  ...HTTPS_WRITER_SERVICES,
  SCHEDULED_SERVICE,
]);
const INVOKER_ROLES = new Set([
  'roles/run.invoker',
  'roles/cloudfunctions.invoker',
]);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_DIRECTORY = resolve(PROJECT_ROOT, 'release/private');
const PRIVATE_PLAN_PATH = resolve(PRIVATE_DIRECTORY, 'access-code-writer-gate-plan.v1.json');
export const WRITER_GATE_LOCK_FILENAME = 'access-code-writer-gate.lock';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const ALLOWED_POLICY_KEYS = new Set(['auditConfigs', 'bindings', 'etag', 'version']);
const ALLOWED_BINDING_KEYS = new Set(['condition', 'members', 'role']);
const ALLOWED_CONDITION_KEYS = new Set(['description', 'expression', 'location', 'title']);
const ALLOWED_AUDIT_CONFIG_KEYS = new Set(['auditLogConfigs', 'service']);
const ALLOWED_AUDIT_LOG_KEYS = new Set(['exemptedMembers', 'logType']);
const SCHEDULER_VOLATILE_FIELDS = new Set([
  'lastAttemptTime',
  'scheduleTime',
  'state',
  'status',
  'userUpdateTime',
]);
const UNSAFE_ENVIRONMENT_NAMES = Object.freeze([
  'CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT',
  'CLOUDSDK_CONFIG',
  'CLOUDSDK_CORE_ACCOUNT',
  'CLOUDSDK_CORE_PROJECT',
  'FIREBASE_CONFIG',
  'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

export const WRITER_GATE_SCOPE = Object.freeze({
  httpsWriterServices: HTTPS_WRITER_SERVICES,
  project: EXPECTED_PROJECT,
  region: EXPECTED_REGION,
  scheduledService: SCHEDULED_SERVICE,
  schedulerJob: SCHEDULER_JOB,
});

export class WriterGateFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'WriterGateFailure';
    this.code = code;
  }
}

function reject(code) {
  throw new WriterGateFailure(code);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, code) {
  if (!isPlainObject(value)) reject(code);
  return value;
}

function assertExactKeys(value, required, optional, code) {
  const keys = Object.keys(assertPlainObject(value, code));
  if (required.some((key) => !keys.includes(key))) reject(code);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) reject(code);
}

function canonicalValue(value, code = 'non_canonical_value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, code));
  if (!isPlainObject(value)) reject(code);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!key || key.includes('\0')) reject(code);
    result[key] = canonicalValue(value[key], code);
  }
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function semanticSha256(value) {
  return sha256(canonicalJson(value));
}

function parseFlags(arguments_) {
  const values = new Map();
  let apply = false;
  for (const argument of arguments_) {
    if (argument === '--apply') {
      if (apply) reject('duplicate_apply_flag');
      apply = true;
      continue;
    }
    if (typeof argument !== 'string' || !argument.startsWith('--') || !argument.includes('=')) {
      reject('invalid_argument_shape');
    }
    const separator = argument.indexOf('=');
    const name = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (!name || !value || values.has(name)) reject('invalid_or_duplicate_argument');
    values.set(name, value);
  }
  return { apply, values };
}

export function parseWriterGateArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) reject('missing_action');
  const [action, ...rest] = argv;
  if (!['plan', 'pause', 'check', 'resume'].includes(action)) reject('unsupported_action');
  const { apply, values } = parseFlags(rest);
  const allowed = action === 'check'
    ? new Set(['expect', 'project', 'region'])
    : new Set(['project', 'region']);
  if ([...values.keys()].some((name) => !allowed.has(name))) reject('unknown_argument');
  if (values.get('project') !== EXPECTED_PROJECT) reject('wrong_project');
  if (values.get('region') !== EXPECTED_REGION) reject('wrong_region');
  if (action === 'plan' || action === 'check') {
    if (apply) reject(`${action}_is_read_only`);
  } else if (!apply) {
    reject('apply_flag_required');
  }
  if (action === 'check') {
    const expect = values.get('expect');
    if (!['paused', 'running'].includes(expect)) reject('invalid_expected_state');
    return Object.freeze({ action, expect, project: EXPECTED_PROJECT, region: EXPECTED_REGION });
  }
  if (values.has('expect')) reject('unexpected_expected_state');
  return Object.freeze({ action, project: EXPECTED_PROJECT, region: EXPECTED_REGION });
}

function normalizeCondition(value) {
  assertPlainObject(value, 'iam_condition_invalid');
  if (Object.keys(value).some((key) => !ALLOWED_CONDITION_KEYS.has(key))) {
    reject('iam_condition_invalid');
  }
  if (typeof value.expression !== 'string' || value.expression.length === 0) {
    reject('iam_condition_invalid');
  }
  for (const name of ['description', 'location', 'title']) {
    if (Object.hasOwn(value, name) && typeof value[name] !== 'string') {
      reject('iam_condition_invalid');
    }
  }
  return canonicalValue(value);
}

function normalizeBinding(value) {
  assertPlainObject(value, 'iam_binding_invalid');
  if (Object.keys(value).some((key) => !ALLOWED_BINDING_KEYS.has(key))) {
    reject('iam_binding_invalid');
  }
  if (
    typeof value.role !== 'string'
    || !/^(?:roles\/[A-Za-z0-9_.]+|(?:projects\/[A-Za-z0-9:._-]+|organizations\/[0-9]+)\/roles\/[A-Za-z0-9_.-]+)$/u
      .test(value.role)
  ) {
    reject('iam_binding_invalid');
  }
  if (
    !Array.isArray(value.members)
    || value.members.length === 0
    || value.members.some((member) => typeof member !== 'string' || member.length === 0)
  ) reject('iam_binding_invalid');
  const members = [...new Set(value.members)].sort();
  if (members.length !== value.members.length) reject('iam_binding_invalid');
  return Object.freeze({
    ...(Object.hasOwn(value, 'condition') ? { condition: normalizeCondition(value.condition) } : {}),
    members,
    role: value.role,
  });
}

function normalizeAuditLogConfig(value) {
  assertPlainObject(value, 'iam_audit_config_invalid');
  if (Object.keys(value).some((key) => !ALLOWED_AUDIT_LOG_KEYS.has(key))) {
    reject('iam_audit_config_invalid');
  }
  if (typeof value.logType !== 'string' || value.logType.length === 0) {
    reject('iam_audit_config_invalid');
  }
  const exemptedMembers = value.exemptedMembers ?? [];
  if (
    !Array.isArray(exemptedMembers)
    || exemptedMembers.some((member) => typeof member !== 'string' || member.length === 0)
  ) reject('iam_audit_config_invalid');
  const uniqueMembers = [...new Set(exemptedMembers)].sort();
  if (uniqueMembers.length !== exemptedMembers.length) reject('iam_audit_config_invalid');
  return Object.freeze({ exemptedMembers: uniqueMembers, logType: value.logType });
}

function normalizeAuditConfig(value) {
  assertPlainObject(value, 'iam_audit_config_invalid');
  if (Object.keys(value).some((key) => !ALLOWED_AUDIT_CONFIG_KEYS.has(key))) {
    reject('iam_audit_config_invalid');
  }
  if (typeof value.service !== 'string' || value.service.length === 0) {
    reject('iam_audit_config_invalid');
  }
  const auditLogConfigs = value.auditLogConfigs ?? [];
  if (!Array.isArray(auditLogConfigs)) reject('iam_audit_config_invalid');
  const normalized = auditLogConfigs.map(normalizeAuditLogConfig)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return Object.freeze({ auditLogConfigs: normalized, service: value.service });
}

export function normalizeIamPolicy(value, { requireEtag = true } = {}) {
  const policy = assertPlainObject(value, 'iam_policy_invalid');
  if (Object.keys(policy).some((key) => !ALLOWED_POLICY_KEYS.has(key))) {
    reject('iam_policy_invalid');
  }
  const version = policy.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 0 || version > 3) reject('iam_policy_invalid');
  const etag = policy.etag;
  if (requireEtag && (typeof etag !== 'string' || etag.length < 4 || etag.length > 1024)) {
    reject('iam_policy_invalid');
  }
  if (!requireEtag && etag !== undefined) reject('iam_policy_invalid');
  const rawBindings = policy.bindings ?? [];
  const rawAuditConfigs = policy.auditConfigs ?? [];
  if (!Array.isArray(rawBindings) || !Array.isArray(rawAuditConfigs)) reject('iam_policy_invalid');
  const bindings = rawBindings.map(normalizeBinding)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const auditConfigs = rawAuditConfigs.map(normalizeAuditConfig)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  if (bindings.some((binding) => binding.condition) && version !== 3) {
    reject('iam_policy_condition_version_invalid');
  }
  return Object.freeze({
    auditConfigs,
    bindings,
    ...(requireEtag ? { etag } : {}),
    version,
  });
}

function policyWithoutEtag(policy) {
  const normalized = normalizeIamPolicy(policy);
  return Object.freeze({
    auditConfigs: normalized.auditConfigs,
    bindings: normalized.bindings,
    version: normalized.version,
  });
}

export function derivePausedIamPolicy(policy) {
  const normalized = normalizeIamPolicy(policy);
  return Object.freeze({
    auditConfigs: normalized.auditConfigs,
    bindings: normalized.bindings.filter((binding) => !INVOKER_ROLES.has(binding.role)),
    version: normalized.version,
  });
}

function hasInvokerBinding(policy) {
  return normalizeIamPolicy(policy).bindings.some((binding) => INVOKER_ROLES.has(binding.role));
}

function assertExpectedRunningWriterPolicy(serviceName, policy) {
  const normalized = normalizeIamPolicy(policy);
  const expectedMember = serviceName === SCHEDULED_SERVICE
    ? `serviceAccount:${EXPECTED_RUNTIME_SERVICE_ACCOUNT}`
    : 'allUsers';
  if (
    normalized.version !== 1
    || normalized.auditConfigs.length !== 0
    || normalized.bindings.length !== 1
    || normalized.bindings[0].role !== 'roles/run.invoker'
    || Object.hasOwn(normalized.bindings[0], 'condition')
    || normalized.bindings[0].members.length !== 1
    || normalized.bindings[0].members[0] !== expectedMember
  ) reject('unexpected_writer_service_policy');
}

function assertNoProjectWideInvoker(policy) {
  const normalized = normalizeIamPolicy(policy);
  if (hasInvokerBinding(normalized)) reject('project_wide_invoker_detected');
  if (normalized.bindings.some(({ members }) => (
    members.some((member) => ['allUsers', 'allAuthenticatedUsers'].includes(member))
  ))) reject('project_wide_public_principal_detected');
}

function normalizeServiceObservation(value, expectedName) {
  const observation = assertPlainObject(value, 'service_observation_invalid');
  const service = assertPlainObject(observation.service, 'service_description_invalid');
  const expectedResource = `projects/${EXPECTED_PROJECT}/locations/${EXPECTED_REGION}/services/${expectedName}`;
  const annotations = service.annotations === undefined
    ? {}
    : assertPlainObject(service.annotations, 'service_description_invalid');
  if (
    service.name !== expectedResource
    || (Object.hasOwn(service, 'invokerIamDisabled')
      && typeof service.invokerIamDisabled !== 'boolean')
    || service.invokerIamDisabled === true
    || annotations['run.googleapis.com/invoker-iam-disabled'] === 'true'
  ) {
    reject('service_invoker_iam_not_enabled');
  }
  return Object.freeze({
    iamPolicy: normalizeIamPolicy(observation.iamPolicy),
    serviceName: expectedName,
  });
}

function expectedSchedulerName() {
  return `projects/${EXPECTED_PROJECT}/locations/${EXPECTED_REGION}/jobs/${SCHEDULER_JOB}`;
}

function expectedSchedulerUri() {
  return `https://${EXPECTED_REGION}-${EXPECTED_PROJECT}.cloudfunctions.net/retryClientAccountDeletions`;
}

export function normalizeSchedulerJob(value) {
  const job = canonicalValue(assertPlainObject(value, 'scheduler_job_invalid'), 'scheduler_job_invalid');
  const target = assertPlainObject(job.httpTarget, 'scheduler_job_invalid');
  const oidc = assertPlainObject(target.oidcToken, 'scheduler_job_invalid');
  if (
    job.name !== expectedSchedulerName()
    || !['ENABLED', 'PAUSED'].includes(job.state)
    || job.schedule !== EXPECTED_SCHEDULE
    || job.timeZone !== EXPECTED_TIME_ZONE
    || target.httpMethod !== 'POST'
    || target.uri !== expectedSchedulerUri()
    || oidc.serviceAccountEmail !== EXPECTED_RUNTIME_SERVICE_ACCOUNT
  ) reject('scheduler_job_invalid');
  return Object.freeze(job);
}

function schedulerConfiguration(job) {
  const normalized = normalizeSchedulerJob(job);
  const result = {};
  for (const key of Object.keys(normalized)) {
    if (!SCHEDULER_VOLATILE_FIELDS.has(key)) result[key] = normalized[key];
  }
  return canonicalValue(result);
}

function normalizeRemoteObservation(value) {
  const observation = assertPlainObject(value, 'remote_observation_invalid');
  if (!Array.isArray(observation.services)) reject('remote_observation_invalid');
  const indexed = new Map();
  for (const service of observation.services) {
    const name = service?.serviceName;
    if (typeof name !== 'string' || indexed.has(name)) reject('service_set_invalid');
    indexed.set(name, service);
  }
  if (
    indexed.size !== ALL_WRITER_SERVICES.length
    || ALL_WRITER_SERVICES.some((name) => !indexed.has(name))
  ) reject('service_set_invalid');
  const services = ALL_WRITER_SERVICES.map((name) => normalizeServiceObservation(indexed.get(name), name));
  const projectIamPolicy = normalizeIamPolicy(observation.projectIamPolicy);
  assertNoProjectWideInvoker(projectIamPolicy);
  return Object.freeze({
    projectIamPolicy,
    schedulerJob: normalizeSchedulerJob(observation.schedulerJob),
    services,
  });
}

function validatePins({ gcloudVersion, nodeVersion, operatorAccountSha256, scriptSha256 }) {
  if (!/^\d+\.\d+\.\d+$/u.test(gcloudVersion ?? '')) reject('gcloud_version_invalid');
  if (nodeVersion !== EXPECTED_NODE_VERSION) reject('node_version_invalid');
  if (!SHA256_PATTERN.test(operatorAccountSha256 ?? '')) reject('operator_identity_hash_invalid');
  if (!SHA256_PATTERN.test(scriptSha256 ?? '')) reject('script_sha256_invalid');
}

export function buildWriterGatePlan({
  createdAt,
  gcloudVersion,
  nodeVersion,
  observation,
  operatorAccountSha256,
  scriptSha256,
}) {
  validatePins({ gcloudVersion, nodeVersion, operatorAccountSha256, scriptSha256 });
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    reject('plan_created_at_invalid');
  }
  const normalized = normalizeRemoteObservation(observation);
  if (normalized.schedulerJob.state !== 'ENABLED') reject('plan_requires_running_scheduler');
  const services = normalized.services.map(({ iamPolicy, serviceName }) => {
    assertExpectedRunningWriterPolicy(serviceName, iamPolicy);
    if (!hasInvokerBinding(iamPolicy)) reject('plan_requires_running_service');
    if (serviceName === SCHEDULED_SERVICE) {
      const publicInvoker = iamPolicy.bindings.some((binding) => (
        INVOKER_ROLES.has(binding.role)
        && binding.members.some((member) => ['allUsers', 'allAuthenticatedUsers'].includes(member))
      ));
      if (publicInvoker) reject('scheduled_service_public_invoker_detected');
    }
    return Object.freeze({
      kind: serviceName === SCHEDULED_SERVICE ? 'scheduled' : 'https',
      pausedIamPolicy: derivePausedIamPolicy(iamPolicy),
      runningIamPolicy: iamPolicy,
      serviceName,
    });
  });
  return Object.freeze({
    artifactKind: 'cabohealth-access-code-writer-gate-plan-v1',
    createdAt,
    pins: Object.freeze({
      gcloudVersion,
      nodeVersion,
      operatorAccountSha256,
      scriptSha256,
    }),
    projectIamPolicy: normalized.projectIamPolicy,
    schedulerJob: normalized.schedulerJob,
    schemaVersion: 1,
    scope: WRITER_GATE_SCOPE,
    services,
  });
}

export function validateWriterGatePlan(value) {
  assertExactKeys(
    value,
    [
      'artifactKind',
      'createdAt',
      'pins',
      'projectIamPolicy',
      'schedulerJob',
      'schemaVersion',
      'scope',
      'services',
    ],
    [],
    'writer_gate_plan_invalid',
  );
  if (
    value.artifactKind !== 'cabohealth-access-code-writer-gate-plan-v1'
    || value.schemaVersion !== 1
    || !isDeepStrictEqual(value.scope, WRITER_GATE_SCOPE)
    || !Array.isArray(value.services)
  ) reject('writer_gate_plan_invalid');
  const rebuilt = buildWriterGatePlan({
    createdAt: value.createdAt,
    gcloudVersion: value.pins?.gcloudVersion,
    nodeVersion: value.pins?.nodeVersion,
    observation: {
      projectIamPolicy: value.projectIamPolicy,
      schedulerJob: value.schedulerJob,
      services: value.services.map((service) => ({
        iamPolicy: service?.runningIamPolicy,
        service: {
          invokerIamDisabled: false,
          name: `projects/${EXPECTED_PROJECT}/locations/${EXPECTED_REGION}/services/${service?.serviceName}`,
        },
        serviceName: service?.serviceName,
      })),
    },
    operatorAccountSha256: value.pins?.operatorAccountSha256,
    scriptSha256: value.pins?.scriptSha256,
  });
  if (!isDeepStrictEqual(canonicalValue(value), canonicalValue(rebuilt))) {
    reject('writer_gate_plan_invalid');
  }
  return rebuilt;
}

function policiesSemanticallyEqual(left, right) {
  return isDeepStrictEqual(
    canonicalValue(Object.hasOwn(left, 'etag') ? policyWithoutEtag(left) : normalizeIamPolicy(left, { requireEtag: false })),
    canonicalValue(Object.hasOwn(right, 'etag') ? policyWithoutEtag(right) : normalizeIamPolicy(right, { requireEtag: false })),
  );
}

export function evaluateWriterGateState(planValue, observationValue) {
  const plan = validateWriterGatePlan(planValue);
  const observation = normalizeRemoteObservation(observationValue);
  if (!isDeepStrictEqual(observation.projectIamPolicy, plan.projectIamPolicy)) {
    reject('project_iam_policy_drift');
  }
  if (!isDeepStrictEqual(
    schedulerConfiguration(observation.schedulerJob),
    schedulerConfiguration(plan.schedulerJob),
  )) reject('scheduler_configuration_drift');
  const observedServices = new Map(observation.services.map((service) => [service.serviceName, service]));
  const services = plan.services.map((planned) => {
    const current = observedServices.get(planned.serviceName).iamPolicy;
    let state;
    if (policiesSemanticallyEqual(current, planned.runningIamPolicy)) state = 'running';
    else if (policiesSemanticallyEqual(current, planned.pausedIamPolicy)) state = 'paused';
    else reject('service_iam_policy_drift');
    return Object.freeze({
      currentIamPolicy: current,
      policyEtagSha256: sha256(current.etag),
      serviceName: planned.serviceName,
      state,
    });
  });
  const state = Object.freeze({
    schedulerState: observation.schedulerJob.state === 'PAUSED' ? 'paused' : 'running',
    schedulerUpdateTimeSha256: typeof observation.schedulerJob.userUpdateTime === 'string'
      ? sha256(observation.schedulerJob.userUpdateTime)
      : null,
    services,
  });
  const sanitized = Object.freeze({
    pausedServiceCount: services.filter((service) => service.state === 'paused').length,
    runningServiceCount: services.filter((service) => service.state === 'running').length,
    schedulerState: state.schedulerState,
    servicePolicyStateSha256: semanticSha256(services.map((service) => ({
      policyEtagSha256: service.policyEtagSha256,
      serviceName: service.serviceName,
      state: service.state,
    }))),
  });
  return Object.freeze({
    internal: state,
    sanitized,
    stateSha256: semanticSha256(sanitized),
  });
}

export function assertExpectedWriterGateState(evaluation, expected) {
  if (!['paused', 'running'].includes(expected)) reject('invalid_expected_state');
  const { internal } = assertPlainObject(evaluation, 'writer_gate_evaluation_invalid');
  if (
    internal.schedulerState !== expected
    || !Array.isArray(internal.services)
    || internal.services.length !== ALL_WRITER_SERVICES.length
    || internal.services.some((service) => service.state !== expected)
  ) reject(`writer_gate_not_${expected}`);
}

export function buildWriterGateMutationPlan(planValue, observationValue, action) {
  if (!['pause', 'resume'].includes(action)) reject('invalid_mutation_action');
  const plan = validateWriterGatePlan(planValue);
  const evaluation = evaluateWriterGateState(plan, observationValue);
  const operations = [];
  const servicesToChange = evaluation.internal.services.filter((service) => (
    action === 'pause' ? service.state === 'running' : service.state === 'paused'
  ));
  if (action === 'pause' && evaluation.internal.schedulerState === 'running') {
    operations.push(Object.freeze({ kind: 'scheduler', targetState: 'paused' }));
  }
  if (
    action === 'resume'
    && evaluation.internal.schedulerState === 'running'
    && servicesToChange.length > 0
  ) {
    operations.push(Object.freeze({ kind: 'scheduler', targetState: 'paused' }));
  }
  for (const service of servicesToChange) {
    operations.push(Object.freeze({
      kind: 'serviceIam',
      serviceName: service.serviceName,
      targetState: action === 'pause' ? 'paused' : 'running',
    }));
  }
  if (
    action === 'resume'
    && (evaluation.internal.schedulerState === 'paused' || servicesToChange.length > 0)
  ) {
    operations.push(Object.freeze({ kind: 'scheduler', targetState: 'running' }));
  }
  return Object.freeze({
    action,
    initialStateSha256: evaluation.stateSha256,
    operations: Object.freeze(operations),
    planSha256: semanticSha256(plan),
  });
}

export function buildCloudRunSetIamPolicyRequest(planValue, serviceName, targetState, currentPolicyValue) {
  if (!ALL_WRITER_SERVICES.includes(serviceName)) reject('unknown_writer_service');
  if (!['paused', 'running'].includes(targetState)) reject('invalid_policy_target_state');
  const plan = validateWriterGatePlan(planValue);
  const planned = plan.services.find((service) => service.serviceName === serviceName);
  const currentPolicy = normalizeIamPolicy(currentPolicyValue);
  const targetSemantic = targetState === 'paused'
    ? planned.pausedIamPolicy
    : policyWithoutEtag(planned.runningIamPolicy);
  const targetPolicy = Object.freeze({ ...targetSemantic, etag: currentPolicy.etag });
  return Object.freeze({
    body: canonicalJson({ policy: targetPolicy, updateMask: 'bindings,etag' }),
    method: 'POST',
    url: `${cloudRunServiceUrl(serviceName)}:setIamPolicy`,
  });
}

function runGcloud(arguments_, code) {
  const result = spawnSync('gcloud', arguments_, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') reject(code);
  return result.stdout.trim();
}

export function parseGcloudVersionOutput(output) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    reject('gcloud_version_response_invalid');
  }
  const version = value?.['Google Cloud SDK'];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    reject('gcloud_version_response_invalid');
  }
  return version;
}

function activeOperatorAccount() {
  let value;
  try {
    value = JSON.parse(runGcloud([
      'auth',
      'list',
      '--filter=status:ACTIVE',
      '--format=json(account,status)',
    ], 'active_operator_unavailable'));
  } catch (error) {
    if (error instanceof WriterGateFailure) throw error;
    reject('active_operator_response_invalid');
  }
  if (!Array.isArray(value) || value.length !== 1) reject('active_operator_not_unique');
  const account = value[0]?.account;
  if (value[0]?.status !== 'ACTIVE' || typeof account !== 'string' || !EMAIL_PATTERN.test(account)) {
    reject('active_operator_response_invalid');
  }
  return account;
}

function acquireAccessToken(account) {
  const token = runGcloud([
    'auth',
    'print-access-token',
    `--account=${account}`,
  ], 'access_token_unavailable');
  if (token.length < 20 || token.length > 8192 || /\s/u.test(token)) reject('access_token_invalid');
  return token;
}

function currentRuntimePins() {
  for (const name of UNSAFE_ENVIRONMENT_NAMES) {
    if (process.env[name]) reject('unsafe_ambient_environment');
  }
  if (process.versions.node !== EXPECTED_NODE_VERSION) reject('node_version_invalid');
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptStat = lstatSync(scriptPath);
  if (!scriptStat.isFile() || scriptStat.isSymbolicLink()) reject('script_identity_invalid');
  const account = activeOperatorAccount();
  return Object.freeze({
    account,
    gcloudVersion: parseGcloudVersionOutput(runGcloud(
      ['version', '--format=json'],
      'gcloud_version_unavailable',
    )),
    nodeVersion: process.versions.node,
    operatorAccountSha256: sha256(account),
    scriptSha256: sha256(readFileSync(scriptPath)),
  });
}

function assertRuntimePins(plan, runtime) {
  if (!isDeepStrictEqual(plan.pins, {
    gcloudVersion: runtime.gcloudVersion,
    nodeVersion: runtime.nodeVersion,
    operatorAccountSha256: runtime.operatorAccountSha256,
    scriptSha256: runtime.scriptSha256,
  })) reject('runtime_pin_mismatch');
}

async function requestJson({ body, code, method = 'GET', token, url }) {
  let response;
  try {
    response = await fetch(url, {
      body: body === undefined ? undefined : body,
      headers: Object.freeze({
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      }),
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    reject(code);
  }
  if (!response.ok) reject(code);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) reject(code);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    reject(code);
  }
}

function cloudRunServiceResource(serviceName) {
  return `projects/${EXPECTED_PROJECT}/locations/${EXPECTED_REGION}/services/${serviceName}`;
}

function cloudRunServiceUrl(serviceName) {
  return `https://run.googleapis.com/v2/${cloudRunServiceResource(serviceName)}`;
}

async function fetchCloudRunService(token, serviceName) {
  return requestJson({
    code: 'cloud_run_service_read_failed',
    token,
    url: cloudRunServiceUrl(serviceName),
  });
}

async function fetchCloudRunIamPolicy(token, serviceName) {
  return requestJson({
    code: 'cloud_run_iam_read_failed',
    token,
    url: `${cloudRunServiceUrl(serviceName)}:getIamPolicy?options.requestedPolicyVersion=3`,
  });
}

async function fetchProjectIamPolicy(token) {
  return requestJson({
    body: canonicalJson({ options: { requestedPolicyVersion: 3 } }),
    code: 'project_iam_read_failed',
    method: 'POST',
    token,
    url: `https://cloudresourcemanager.googleapis.com/v1/projects/${EXPECTED_PROJECT}:getIamPolicy`,
  });
}

function schedulerUrl() {
  return `https://cloudscheduler.googleapis.com/v1/${expectedSchedulerName()}`;
}

async function fetchSchedulerJob(token) {
  return requestJson({
    code: 'scheduler_job_read_failed',
    token,
    url: schedulerUrl(),
  });
}

async function collectRemoteObservation(token) {
  const [projectIamPolicy, schedulerJob, ...serviceValues] = await Promise.all([
    fetchProjectIamPolicy(token),
    fetchSchedulerJob(token),
    ...ALL_WRITER_SERVICES.flatMap((serviceName) => [
      fetchCloudRunService(token, serviceName),
      fetchCloudRunIamPolicy(token, serviceName),
    ]),
  ]);
  const services = ALL_WRITER_SERVICES.map((serviceName, index) => Object.freeze({
    iamPolicy: serviceValues[(index * 2) + 1],
    service: serviceValues[index * 2],
    serviceName,
  }));
  return Object.freeze({ projectIamPolicy, schedulerJob, services });
}

async function setServiceIamPolicy(token, plan, serviceName, targetState) {
  const service = await fetchCloudRunService(token, serviceName);
  const current = await fetchCloudRunIamPolicy(token, serviceName);
  normalizeServiceObservation({ iamPolicy: current, service }, serviceName);
  const planned = plan.services.find((entry) => entry.serviceName === serviceName);
  const alreadyTarget = policiesSemanticallyEqual(
    current,
    targetState === 'paused' ? planned.pausedIamPolicy : planned.runningIamPolicy,
  );
  if (alreadyTarget) return false;
  const allowedSource = targetState === 'paused' ? planned.runningIamPolicy : planned.pausedIamPolicy;
  if (!policiesSemanticallyEqual(current, allowedSource)) reject('service_iam_policy_drift');
  const request = buildCloudRunSetIamPolicyRequest(plan, serviceName, targetState, current);
  const response = await requestJson({
    body: request.body,
    code: 'cloud_run_set_iam_policy_failed',
    method: request.method,
    token,
    url: request.url,
  });
  if (!policiesSemanticallyEqual(response, targetState === 'paused'
    ? planned.pausedIamPolicy
    : planned.runningIamPolicy)) reject('cloud_run_set_iam_policy_verification_failed');
  const confirmed = await fetchCloudRunIamPolicy(token, serviceName);
  if (!policiesSemanticallyEqual(confirmed, targetState === 'paused'
    ? planned.pausedIamPolicy
    : planned.runningIamPolicy)) reject('cloud_run_set_iam_policy_verification_failed');
  return true;
}

async function setSchedulerState(token, plan, targetState) {
  const current = normalizeSchedulerJob(await fetchSchedulerJob(token));
  if (!isDeepStrictEqual(schedulerConfiguration(current), schedulerConfiguration(plan.schedulerJob))) {
    reject('scheduler_configuration_drift');
  }
  const expectedState = targetState === 'paused' ? 'PAUSED' : 'ENABLED';
  if (current.state === expectedState) return false;
  const allowedState = targetState === 'paused' ? 'ENABLED' : 'PAUSED';
  if (current.state !== allowedState) reject('scheduler_state_drift');
  const response = normalizeSchedulerJob(await requestJson({
    code: targetState === 'paused' ? 'scheduler_pause_failed' : 'scheduler_resume_failed',
    method: 'POST',
    token,
    url: `${schedulerUrl()}:${targetState === 'paused' ? 'pause' : 'resume'}`,
  }));
  if (
    response.state !== expectedState
    || !isDeepStrictEqual(schedulerConfiguration(response), schedulerConfiguration(plan.schedulerJob))
  ) reject('scheduler_mutation_verification_failed');
  const confirmed = normalizeSchedulerJob(await fetchSchedulerJob(token));
  if (
    confirmed.state !== expectedState
    || !isDeepStrictEqual(schedulerConfiguration(confirmed), schedulerConfiguration(plan.schedulerJob))
  ) reject('scheduler_mutation_verification_failed');
  return true;
}

function assertPrivateDirectory(privateDirectory = PRIVATE_DIRECTORY) {
  const absoluteDirectory = resolve(privateDirectory);
  const lexical = lstatSync(absoluteDirectory);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : lexical.uid;
  if (
    !lexical.isDirectory()
    || lexical.isSymbolicLink()
    || (lexical.mode & 0o777) !== 0o700
    || lexical.uid !== currentUid
    || realpathSync(absoluteDirectory) !== absoluteDirectory
  ) reject('private_directory_invalid');
  return absoluteDirectory;
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, FS_CONSTANTS.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export async function withWriterGateProcessLock(
  operation,
  { privateDirectory = PRIVATE_DIRECTORY } = {},
) {
  if (typeof operation !== 'function') reject('writer_gate_lock_operation_invalid');
  const absoluteDirectory = assertPrivateDirectory(privateDirectory);
  const lockPath = resolve(absoluteDirectory, WRITER_GATE_LOCK_FILENAME);
  if (dirname(lockPath) !== absoluteDirectory) reject('writer_gate_lock_configuration_invalid');
  const previousUmask = process.umask(0o077);
  let holder;
  try {
    holder = spawn('/usr/bin/lockf', [
      '-k',
      '-s',
      '-w',
      '-t',
      '0',
      lockPath,
      process.execPath,
      '--input-type=module',
      '--eval',
      'process.stdout.write("ready\\n");process.stdin.resume();',
    ], {
      encoding: 'utf8',
      env: Object.freeze({ LANG: 'C', PATH: '/usr/bin:/bin' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } finally {
    process.umask(previousUmask);
  }
  const exit = new Promise((resolveExit) => {
    holder.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  await new Promise((resolveReady, rejectReady) => {
    let output = '';
    let settled = false;
    const finish = (operation_) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      operation_();
    };
    const timeout = setTimeout(() => {
      holder.kill('SIGTERM');
      finish(() => rejectReady(new WriterGateFailure('writer_gate_lock_start_timeout')));
    }, 5_000);
    holder.once('error', () => {
      finish(() => rejectReady(new WriterGateFailure('writer_gate_lock_start_failed')));
    });
    holder.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output === 'ready\n') finish(resolveReady);
      else if (output.length > 6 || !'ready\n'.startsWith(output)) {
        holder.kill('SIGTERM');
        finish(() => rejectReady(new WriterGateFailure('writer_gate_lock_handshake_invalid')));
      }
    });
    exit.then(({ code }) => {
      finish(() => rejectReady(new WriterGateFailure(
        code === 75 ? 'writer_gate_locked' : 'writer_gate_lock_start_failed',
      )));
    });
  });
  const acquired = lstatSync(lockPath);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : acquired.uid;
  const acquiredIdentityInvalid = (
    !acquired.isFile()
    || acquired.isSymbolicLink()
    || acquired.nlink !== 1
    || acquired.uid !== currentUid
    || (acquired.mode & 0o777) !== 0o600
    || acquired.size !== 0
  );
  if (acquiredIdentityInvalid) {
    holder.stdin.end();
    await exit;
    reject('writer_gate_lock_identity_invalid');
  }
  fsyncDirectory(absoluteDirectory);
  let releaseRequested = false;
  const lost = exit.then(({ code, signal }) => {
    if (!releaseRequested) throw new WriterGateFailure('writer_gate_lock_lost');
    return { code, signal };
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), lost]);
  } finally {
    const current = lstatSync(lockPath);
    if (
      !current.isFile()
      || current.isSymbolicLink()
      || current.nlink !== 1
      || current.uid !== currentUid
      || current.dev !== acquired.dev
      || current.ino !== acquired.ino
      || (current.mode & 0o777) !== 0o600
      || current.size !== 0
    ) reject('writer_gate_lock_identity_changed');
    releaseRequested = true;
    holder.stdin.end();
    const completion = await exit;
    if (completion.code !== 0 || completion.signal !== null) {
      reject('writer_gate_lock_release_failed');
    }
    const released = lstatSync(lockPath);
    if (
      !released.isFile()
      || released.isSymbolicLink()
      || released.nlink !== 1
      || released.uid !== currentUid
      || released.dev !== acquired.dev
      || released.ino !== acquired.ino
      || (released.mode & 0o777) !== 0o600
      || released.size !== 0
    ) reject('writer_gate_lock_release_identity_changed');
    fsyncDirectory(absoluteDirectory);
  }
}

export function writePrivateSnapshotExclusive(path, value, { privateDirectory = PRIVATE_DIRECTORY } = {}) {
  const absoluteDirectory = resolve(privateDirectory);
  const absolutePath = resolve(path);
  if (dirname(absolutePath) !== absoluteDirectory) reject('private_snapshot_path_invalid');
  const directoryStat = lstatSync(absoluteDirectory);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : directoryStat.uid;
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || (directoryStat.mode & 0o777) !== 0o700
    || directoryStat.uid !== currentUid
    || realpathSync(absoluteDirectory) !== absoluteDirectory
  ) reject('private_directory_invalid');
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${randomBytes(16).toString('hex')}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      FS_CONSTANTS.O_WRONLY
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } catch {
    if (descriptor !== undefined) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // A mode-0600 orphan inside the private directory is fail-closed.
      }
    }
    reject('private_snapshot_write_failed');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  try {
    linkSync(temporaryPath, absolutePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve an unexpected private orphan instead of touching another path.
    }
    if (error?.code === 'EEXIST') reject('private_snapshot_already_exists');
    reject('private_snapshot_publish_failed');
  }
  try {
    unlinkSync(temporaryPath);
  } catch {
    reject('private_snapshot_cleanup_failed');
  }
  const published = lstatSync(absolutePath);
  if (
    !published.isFile()
    || published.isSymbolicLink()
    || (published.mode & 0o777) !== 0o600
    || published.nlink !== 1
    || published.uid !== currentUid
    || !readFileSync(absolutePath).equals(bytes)
  ) reject('private_snapshot_verification_failed');
  const directoryDescriptor = openSync(absoluteDirectory, FS_CONSTANTS.O_RDONLY);
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
  return Object.freeze({ path: absolutePath, sha256: sha256(bytes) });
}

function readPrivatePlan() {
  assertPrivateDirectory();
  if (!existsSync(PRIVATE_PLAN_PATH)) reject('writer_gate_plan_missing');
  let descriptor;
  try {
    descriptor = openSync(PRIVATE_PLAN_PATH, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (
      !stat.isFile()
      || stat.nlink !== 1
      || stat.uid !== currentUid
      || (stat.mode & 0o777) !== 0o600
      || stat.size < 2
      || stat.size > 2 * 1024 * 1024
      || realpathSync(PRIVATE_PLAN_PATH) !== PRIVATE_PLAN_PATH
    ) reject('writer_gate_plan_file_invalid');
    const bytes = readFileSync(descriptor);
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      reject('writer_gate_plan_file_invalid');
    }
    const plan = validateWriterGatePlan(parsed);
    if (!bytes.equals(Buffer.from(`${canonicalJson(plan)}\n`, 'utf8'))) {
      reject('writer_gate_plan_file_not_canonical');
    }
    return Object.freeze({ bytes, plan, sha256: sha256(bytes) });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sanitizedOutput(value) {
  process.stdout.write(`${canonicalJson(value)}\n`);
}

async function runPlan(options, runtime) {
  if (existsSync(PRIVATE_PLAN_PATH)) reject('private_snapshot_already_exists');
  const token = acquireAccessToken(runtime.account);
  const observation = await collectRemoteObservation(token);
  const plan = buildWriterGatePlan({
    createdAt: new Date().toISOString(),
    gcloudVersion: runtime.gcloudVersion,
    nodeVersion: runtime.nodeVersion,
    observation,
    operatorAccountSha256: runtime.operatorAccountSha256,
    scriptSha256: runtime.scriptSha256,
  });
  const published = writePrivateSnapshotExclusive(PRIVATE_PLAN_PATH, plan);
  sanitizedOutput({
    action: options.action,
    planFileSha256: published.sha256,
    project: EXPECTED_PROJECT,
    region: EXPECTED_REGION,
    schedulerState: 'running',
    serviceCount: ALL_WRITER_SERVICES.length,
    status: 'ready',
  });
}

async function runCheck(options, runtime, privatePlan) {
  assertRuntimePins(privatePlan.plan, runtime);
  const observation = await collectRemoteObservation(acquireAccessToken(runtime.account));
  const evaluation = evaluateWriterGateState(privatePlan.plan, observation);
  assertExpectedWriterGateState(evaluation, options.expect);
  sanitizedOutput({
    action: options.action,
    expected: options.expect,
    planFileSha256: privatePlan.sha256,
    state: evaluation.sanitized,
    stateSha256: evaluation.stateSha256,
    status: 'confirmed',
  });
}

async function runMutation(options, runtime, privatePlan) {
  assertRuntimePins(privatePlan.plan, runtime);
  const token = acquireAccessToken(runtime.account);
  const before = await collectRemoteObservation(token);
  const mutationPlan = buildWriterGateMutationPlan(privatePlan.plan, before, options.action);
  let changedScheduler = 0;
  let changedServices = 0;
  for (const operation of mutationPlan.operations) {
    if (operation.kind === 'scheduler') {
      if (await setSchedulerState(token, privatePlan.plan, operation.targetState)) {
        changedScheduler += 1;
      }
    } else if (await setServiceIamPolicy(
      token,
      privatePlan.plan,
      operation.serviceName,
      operation.targetState,
    )) {
      changedServices += 1;
    }
  }
  const after = await collectRemoteObservation(token);
  const evaluation = evaluateWriterGateState(privatePlan.plan, after);
  assertExpectedWriterGateState(evaluation, options.action === 'pause' ? 'paused' : 'running');
  sanitizedOutput({
    action: options.action,
    changedSchedulerOperationCount: changedScheduler,
    changedServiceCount: changedServices,
    planFileSha256: privatePlan.sha256,
    state: evaluation.sanitized,
    stateSha256: evaluation.stateSha256,
    status: options.action === 'pause' ? 'paused' : 'running',
  });
}

async function main() {
  const options = parseWriterGateArguments(process.argv.slice(2));
  const runtime = currentRuntimePins();
  if (options.action === 'plan') {
    await runPlan(options, runtime);
    return;
  }
  const privatePlan = readPrivatePlan();
  if (options.action === 'check') {
    await runCheck(options, runtime, privatePlan);
    return;
  }
  await runMutation(options, runtime, privatePlan);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  withWriterGateProcessLock(() => main()).catch((error) => {
    const code = error instanceof WriterGateFailure ? error.code : 'unexpected_failure';
    process.stderr.write(`${canonicalJson({ code, status: 'failed' })}\n`);
    process.exitCode = 1;
  });
}
