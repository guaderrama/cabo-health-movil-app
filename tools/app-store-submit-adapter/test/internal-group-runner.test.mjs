import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseInternalGroupArguments } from '../src/internal-group-arguments.mjs';
import { runInternalGroup } from '../src/internal-group-runner.mjs';
import { internalGroupPaths } from '../src/internal-testflight.mjs';
import { FixtureTransport } from '../src/transport.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);
const SOURCE_SHA = 'b'.repeat(64);
const BUILD_ID = '12345678-1234-4234-8234-123456789abc';
const BUILD_RESOURCE_ID = 'build-resource-one';
const GROUP_RESOURCE_ID = 'group-resource-one';
const NOW = '2026-08-30T12:00:00.000Z';
const ASSIGNMENT_ATTEMPT_NAME = 'internal-testflight-group-assignment-attempt.json';
const ASSIGNMENT_ATTEMPT_TEMP_PREFIX = '.internal-testflight-group-assignment-attempt.';
const CANDIDATE = {
  appleId: '6758285327',
  bundleIdentifier: 'com.cabohealth.app',
  marketingVersion: '3.0',
  buildNumber: '11',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const adapterRoot = fileURLToPath(new URL('..', import.meta.url));

function writeCanonical(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
  return sha256(bytes);
}

function page(data) {
  return { data, links: { next: null }, meta: { paging: { total: data.length } } };
}

function expectations() {
  return [
    {
      method: 'GET', path: internalGroupPaths.app(), status: 200,
      response: { data: { type: 'apps', id: CANDIDATE.appleId, attributes: { bundleId: CANDIDATE.bundleIdentifier } } },
    },
    {
      method: 'GET', path: internalGroupPaths.builds(), status: 200,
      response: page([{
        type: 'builds', id: BUILD_RESOURCE_ID,
        attributes: {
          version: '11', uploadedDate: '2026-08-30T11:00:00.000Z',
          processingState: 'VALID', expired: false, buildAudienceType: 'APP_STORE_ELIGIBLE',
        },
      }]),
    },
    {
      method: 'GET', path: internalGroupPaths.preRelease(BUILD_RESOURCE_ID), status: 200,
      response: { data: { type: 'preReleaseVersions', id: 'pre-one', attributes: { version: '3.0', platform: 'IOS' } } },
    },
    {
      method: 'GET', path: internalGroupPaths.buildApp(BUILD_RESOURCE_ID), status: 200,
      response: { data: { type: 'apps', id: CANDIDATE.appleId, attributes: { bundleId: CANDIDATE.bundleIdentifier } } },
    },
    {
      method: 'GET', path: internalGroupPaths.groups(), status: 200,
      response: page([{
        type: 'betaGroups', id: GROUP_RESOURCE_ID,
        attributes: { name: 'cabo health', isInternalGroup: true, hasAccessToAllBuilds: false },
      }]),
    },
    {
      method: 'GET', path: internalGroupPaths.groupApp(GROUP_RESOURCE_ID), status: 200,
      response: { data: { type: 'apps', id: CANDIDATE.appleId, attributes: { bundleId: CANDIDATE.bundleIdentifier } } },
    },
    {
      method: 'GET', path: internalGroupPaths.relationshipBuilds(GROUP_RESOURCE_ID), status: 200,
      response: page([]),
    },
  ];
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-internal-runner-')));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-attestation',
    candidate: CANDIDATE,
    sourceCommit: SOURCE_COMMIT,
    sourceTreeSha256: SOURCE_SHA,
    appJsonSha256: 'c'.repeat(64),
    configSha256: 'd'.repeat(64),
    packageLockSha256: 'e'.repeat(64),
    releaseManifestSha256: 'f'.repeat(64),
    releaseVerifierSha256: '0'.repeat(64),
    metadataVerifierSha256: '1'.repeat(64),
    firebaseProjectId: 'cabohealth-owner-prod',
    googleServicesPlistSha256: '2'.repeat(64),
    resolvedProductionExpoConfigSha256: '3'.repeat(64),
    nodeRuntime: { version: 'v22.22.3', executableSha256: '4'.repeat(64) },
    easCli: {
      packageVersion: '22.2.0', packageJsonRelativePath: 'eas-cli/package.json',
      entryRelativePath: 'eas-cli/bin/run', runtimeRootRelativePath: 'node_modules',
      runtimeTreeSha256: '5'.repeat(64),
    },
    easEnvironmentInventorySha256: '6'.repeat(64),
    easEnvironment: {},
    reviewedAt: '2026-08-30T10:00:00.000Z',
  };
  const inputPath = join(root, 'build-input-attestation.json');
  const inputSha256 = writeCanonical(inputPath, input);
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-artifact-attestation',
    candidate: CANDIDATE,
    buildInputAttestationSha256: inputSha256,
    sourceTreeSha256: SOURCE_SHA,
    easBuildId: BUILD_ID,
    easArtifactAssociation: {},
    ipaSha256: '7'.repeat(64),
    signedEntitlementsSha256: '8'.repeat(64),
    privacyReportSha256: '9'.repeat(64),
    embeddedGoogleServicesPlistSha256: 'a'.repeat(64),
    signingCertificateSha256: 'b'.repeat(64),
    embeddedProvisioningProfileSha256: 'c'.repeat(64),
    reviewedAt: '2026-08-30T11:00:00.000Z',
  };
  const artifactPath = join(root, 'build-artifact-attestation.json');
  const artifactSha256 = writeCanonical(artifactPath, artifact);
  const baseArgs = [
    '--operation', 'observe-existing-internal-testflight-access',
    '--apple-id', CANDIDATE.appleId,
    '--bundle-identifier', CANDIDATE.bundleIdentifier,
    '--marketing-version', CANDIDATE.marketingVersion,
    '--build-number', CANDIDATE.buildNumber,
    '--group-name', 'cabo health',
    '--source-commit', SOURCE_COMMIT,
    '--build-input-attestation', inputPath,
    '--build-input-attestation-sha256', inputSha256,
    '--build-artifact-attestation', artifactPath,
    '--build-artifact-attestation-sha256', artifactSha256,
  ];
  return {
    root,
    baseArgs,
    inputPath,
    artifactPath,
    inputSha256,
    artifactSha256,
  };
}

function exactObservation(value, overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceKind: 'cabohealth-app-store-connect-internal-group-observation',
    candidate: CANDIDATE,
    sourceCommit: SOURCE_COMMIT,
    sourceTreeSha256: SOURCE_SHA,
    buildInputAttestationSha256: value.inputSha256,
    buildArtifactAttestationSha256: value.artifactSha256,
    easBuildId: BUILD_ID,
    appStoreConnectBuildResourceId: BUILD_RESOURCE_ID,
    buildProcessingState: 'VALID',
    buildExpired: false,
    buildAudienceType: 'APP_STORE_ELIGIBLE',
    buildUploadedAt: '2026-08-30T11:00:00.000Z',
    betaGroupResourceId: GROUP_RESOURCE_ID,
    betaGroupName: 'cabo health',
    betaGroupInternal: true,
    betaGroupHasAccessToAllBuilds: false,
    observedAt: NOW,
    available: false,
    availabilityReason: 'not-assigned',
    mutationPerformed: false,
    rawProviderResponseRetained: false,
    providerUrlsOmitted: true,
    credentialFieldsOmitted: true,
    ...overrides,
  };
}

function assignmentArguments(value, observationPath, observationSha256, outputPath) {
  const args = [
    ...value.baseArgs,
    '--observation', observationPath,
    '--observation-sha256', observationSha256,
    '--output', outputPath,
  ];
  args[1] = 'ensure-existing-internal-testflight-access';
  return args;
}

function preparedAssignment(value) {
  const observationPath = join(value.root, 'internal-testflight-group-observation.json');
  const observationSha256 = writeCanonical(observationPath, exactObservation(value));
  const outputPath = join(value.root, 'internal-testflight-group-assignment.json');
  return {
    args: assignmentArguments(value, observationPath, observationSha256, outputPath),
    outputPath,
  };
}

test('internal group argument grammar is exact, ordered, absolute, and build-11-bound', (t) => {
  const value = fixture(t);
  const output = join(value.root, 'internal-testflight-group-observation.json');
  assert.equal(parseInternalGroupArguments([...value.baseArgs, '--output', output]).outputPath, output);
  const swapped = [...value.baseArgs, '--output', output];
  [swapped[0], swapped[2]] = [swapped[2], swapped[0]];
  assert.throws(() => parseInternalGroupArguments(swapped), /INTERNAL_GROUP_ARGUMENT_INVALID/u);
  assert.throws(
    () => parseInternalGroupArguments([...value.baseArgs, '--output', 'relative.json']),
    /INTERNAL_GROUP_ARGUMENT_INVALID/u,
  );
});

test('production observer writes and revalidates one exact canonical mode-0600 result', async (t) => {
  const value = fixture(t);
  const output = join(value.root, 'internal-testflight-group-observation.json');
  const transport = new FixtureTransport(expectations());
  const result = await runInternalGroup([...value.baseArgs, '--output', output], {
    transport,
    now: Date.parse(NOW),
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
  });
  transport.assertConsumed();
  const bytes = readFileSync(output);
  assert.deepEqual(bytes, Buffer.from(`${JSON.stringify(result)}\n`));
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(result.available, false);
  assert.equal(result.mutationPerformed, false);
});

test('an existing output blocks before any live request', async (t) => {
  const value = fixture(t);
  const output = join(value.root, 'internal-testflight-group-observation.json');
  writeFileSync(output, 'preserve', { mode: 0o600 });
  chmodSync(output, 0o600);
  const transport = new FixtureTransport(expectations());
  await assert.rejects(runInternalGroup([...value.baseArgs, '--output', output], {
    transport,
    now: Date.parse(NOW),
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
  }), /INTERNAL_GROUP_OUTPUT_INVALID/u);
  assert.equal(transport.requests.length, 0);
  assert.equal(readFileSync(output, 'utf8'), 'preserve');
});

test('secure outputs reject pre-existing symlinks and hardlinks before any live request', async (t) => {
  for (const kind of ['symlink', 'hardlink']) {
    await t.test(kind, async (subtest) => {
      const value = fixture(subtest);
      const output = join(value.root, 'internal-testflight-group-observation.json');
      const preserved = join(value.root, `${kind}-preserved.json`);
      writeFileSync(preserved, 'preserve', { mode: 0o600 });
      chmodSync(preserved, 0o600);
      if (kind === 'symlink') symlinkSync(preserved, output);
      else linkSync(preserved, output);
      const transport = new FixtureTransport(expectations());
      await assert.rejects(runInternalGroup([...value.baseArgs, '--output', output], {
        transport,
        now: Date.parse(NOW),
        environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
      }), /INTERNAL_GROUP_OUTPUT_INVALID/u);
      assert.equal(transport.requests.length, 0);
      assert.equal(readFileSync(preserved, 'utf8'), 'preserve');
    });
  }
});

test('hardlinked attestation input is rejected before any live request', async (t) => {
  const value = fixture(t);
  linkSync(value.inputPath, join(value.root, 'input-hardlink.json'));
  const output = join(value.root, 'internal-testflight-group-observation.json');
  const transport = new FixtureTransport(expectations());
  await assert.rejects(runInternalGroup([...value.baseArgs, '--output', output], {
    transport,
    now: Date.parse(NOW),
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
  }), /INTERNAL_GROUP_INPUT_INVALID/u);
  assert.equal(transport.requests.length, 0);
});

test('missing production credentials fail before any live request', async (t) => {
  const value = fixture(t);
  const output = join(value.root, 'internal-testflight-group-observation.json');
  await assert.rejects(runInternalGroup([...value.baseArgs, '--output', output], {
    now: Date.parse(NOW),
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
  }), (error) => error?.message === 'INTERNAL_GROUP_CREDENTIALS_INVALID');
});

test('production assignment writes one canonical mode-0600 result', async (t) => {
  const value = fixture(t);
  const observationPath = join(value.root, 'internal-testflight-group-observation.json');
  const observationSha256 = writeCanonical(observationPath, exactObservation(value));
  const output = join(value.root, 'internal-testflight-group-assignment.json');
  const assignmentExpectations = [
    ...expectations(),
    {
      method: 'POST',
      path: internalGroupPaths.assign(GROUP_RESOURCE_ID),
      body: { data: [{ type: 'builds', id: BUILD_RESOURCE_ID }] },
      responseKind: 'empty',
      status: 204,
      response: null,
    },
    {
      method: 'GET',
      path: internalGroupPaths.relationshipBuilds(GROUP_RESOURCE_ID),
      status: 200,
      response: page([{ type: 'builds', id: BUILD_RESOURCE_ID }]),
    },
  ];
  const transport = new FixtureTransport(assignmentExpectations);
  const result = await runInternalGroup(
    assignmentArguments(value, observationPath, observationSha256, output),
    {
      assignment: true,
      transport,
      now: Date.parse(NOW),
      sleep: async () => {},
      environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
    },
  );
  transport.assertConsumed();
  assert.deepEqual(readFileSync(output), Buffer.from(`${JSON.stringify(result)}\n`));
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(result.result, 'assigned');
  const attemptPath = join(value.root, ASSIGNMENT_ATTEMPT_NAME);
  const attemptBytes = readFileSync(attemptPath);
  const attempt = JSON.parse(attemptBytes);
  assert.equal(statSync(attemptPath).mode & 0o777, 0o600);
  assert.equal(attempt.state, 'terminal_success');
  assert.equal(attempt.outcome, 'succeeded');
  assert.equal(attempt.appStoreConnectBuildResourceId, BUILD_RESOURCE_ID);
  assert.equal(attempt.betaGroupResourceId, GROUP_RESOURCE_ID);
  assert.doesNotMatch(attemptBytes.toString(), /Bearer|PRIVATE KEY|credential|jwt|secret/iu);
});

test('an uncertain assignment persists unknown and blocks a second invocation before POST', async (t) => {
  const value = fixture(t);
  const observationPath = join(value.root, 'internal-testflight-group-observation.json');
  const observationSha256 = writeCanonical(observationPath, exactObservation(value));
  const output = join(value.root, 'internal-testflight-group-assignment.json');
  const absentRead = {
    method: 'GET', path: internalGroupPaths.relationshipBuilds(GROUP_RESOURCE_ID),
    status: 200, response: page([]),
  };
  const delegate = new FixtureTransport([
    ...expectations(), absentRead, absentRead, absentRead,
  ]);
  const first = {
    requests: [],
    async request(request) {
      this.requests.push(structuredClone(request));
      if (request.method === 'POST') throw new Error('APP_STORE_CONNECT_NETWORK_ERROR');
      return delegate.request(request);
    },
  };
  const args = assignmentArguments(value, observationPath, observationSha256, output);
  await assert.rejects(runInternalGroup(args, {
    assignment: true,
    transport: first,
    now: Date.parse(NOW),
    sleep: async () => {},
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
  }), /INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN/u);
  delegate.assertConsumed();
  assert.equal(first.requests.filter(({ method }) => method === 'POST').length, 1);
  const attemptPath = join(value.root, ASSIGNMENT_ATTEMPT_NAME);
  const attempt = JSON.parse(readFileSync(attemptPath));
  assert.equal(attempt.state, 'unknown');
  assert.equal(attempt.outcome, 'unknown');
  assert.equal(lstatSync(attemptPath).nlink, 1);
  assert.equal(statSync(attemptPath).mode & 0o777, 0o600);

  const second = {
    requests: [],
    async request(request) {
      this.requests.push(structuredClone(request));
      throw new Error('unexpected live request');
    },
  };
  await assert.rejects(runInternalGroup(args, {
    assignment: true,
    transport: second,
    now: Date.parse(NOW),
    sleep: async () => {},
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
  }), /INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN/u);
  assert.equal(second.requests.length, 0);
  assert.equal(JSON.parse(readFileSync(attemptPath)).state, 'unknown');
});

test('assignment marker is provider_started at POST and unknown before the first readback', async (t) => {
  const value = fixture(t);
  const observationPath = join(value.root, 'internal-testflight-group-observation.json');
  const observationSha256 = writeCanonical(observationPath, exactObservation(value));
  const output = join(value.root, 'internal-testflight-group-assignment.json');
  const delegate = new FixtureTransport([
    ...expectations(),
    {
      method: 'POST', path: internalGroupPaths.assign(GROUP_RESOURCE_ID),
      body: { data: [{ type: 'builds', id: BUILD_RESOURCE_ID }] },
      responseKind: 'empty', status: 204, response: null,
    },
    {
      method: 'GET', path: internalGroupPaths.relationshipBuilds(GROUP_RESOURCE_ID),
      status: 200, response: page([{ type: 'builds', id: BUILD_RESOURCE_ID }]),
    },
  ]);
  const attemptPath = join(value.root, ASSIGNMENT_ATTEMPT_NAME);
  const observedStates = [];
  const transport = {
    async request(request) {
      if (request.method === 'POST') {
        observedStates.push(JSON.parse(readFileSync(attemptPath)).state);
      } else if (request.path === internalGroupPaths.relationshipBuilds(GROUP_RESOURCE_ID)
        && observedStates.length === 1) {
        observedStates.push(JSON.parse(readFileSync(attemptPath)).state);
      }
      return delegate.request(request);
    },
  };
  const result = await runInternalGroup(
    assignmentArguments(value, observationPath, observationSha256, output),
    {
      assignment: true,
      transport,
      now: Date.parse(NOW),
      sleep: async () => {},
      environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
    },
  );
  delegate.assertConsumed();
  assert.deepEqual(observedStates, ['provider_started', 'unknown']);
  assert.equal(result.result, 'assigned');
  assert.equal(JSON.parse(readFileSync(attemptPath)).state, 'terminal_success');
});

test('a durable provider_started marker blocks a later assignment before live access', async (t) => {
  const value = fixture(t);
  const { armAssignmentAttempt, transitionAssignmentAttempt } = await import('../src/assignment-attempt.mjs');
  const environment = { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root };
  const attemptPath = armAssignmentAttempt(exactObservation(value), environment, Date.parse(NOW));
  transitionAssignmentAttempt(attemptPath, 'provider_started', environment, Date.parse(NOW));
  const observationPath = join(value.root, 'internal-testflight-group-observation.json');
  const observationSha256 = writeCanonical(observationPath, exactObservation(value));
  const output = join(value.root, 'internal-testflight-group-assignment.json');
  const transport = new FixtureTransport(expectations());
  await assert.rejects(runInternalGroup(
    assignmentArguments(value, observationPath, observationSha256, output),
    {
      assignment: true,
      transport,
      now: Date.parse(NOW),
      environment,
    },
  ), /INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN/u);
  assert.equal(transport.requests.length, 0);
  assert.equal(JSON.parse(readFileSync(attemptPath)).state, 'provider_started');
});

test('assignment marker transitions are crash-atomic at every durable phase', async (t) => {
  const { armAssignmentAttempt, transitionAssignmentAttempt } = await import('../src/assignment-attempt.mjs');
  const phases = [
    'before_transition_snapshot',
    'temp_created',
    'temp_written',
    'temp_fsynced',
    'temp_validated',
    'destination_validated',
    'before_rename',
    'after_rename',
    'directory_fsynced',
    'before_final_readback',
  ];
  for (const phase of phases) {
    await t.test(phase, async (subtest) => {
      const value = fixture(subtest);
      const environment = { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root };
      const attemptPath = armAssignmentAttempt(exactObservation(value), environment, Date.parse(NOW));
      const oldBytes = readFileSync(attemptPath);
      const oldValue = JSON.parse(oldBytes);
      const expectedNewBytes = Buffer.from(`${JSON.stringify({
        ...oldValue,
        state: 'provider_started',
        providerStartedAt: NOW,
        terminalAt: null,
        outcome: 'pending',
      })}\n`);
      assert.throws(() => transitionAssignmentAttempt(
        attemptPath,
        'provider_started',
        environment,
        Date.parse(NOW),
        {
          failpoint(name) {
            if (name === phase) throw new Error(`injected ${phase}`);
          },
        },
      ), /INTERNAL_GROUP_OUTPUT_INVALID/u);
      const durableBytes = readFileSync(attemptPath);
      const afterRename = [
        'after_rename', 'directory_fsynced', 'before_final_readback',
      ].includes(phase);
      assert.deepEqual(durableBytes, afterRename ? expectedNewBytes : oldBytes);
      assert.equal(statSync(attemptPath).mode & 0o777, 0o600);
      assert.equal(lstatSync(attemptPath).nlink, 1);
      assert.equal(readdirSync(value.root).some((name) => (
        name.startsWith(ASSIGNMENT_ATTEMPT_TEMP_PREFIX) && name.endsWith('.tmp')
      )), false);

      const prepared = preparedAssignment(value);
      const transport = new FixtureTransport(expectations());
      await assert.rejects(runInternalGroup(prepared.args, {
        assignment: true,
        transport,
        now: Date.parse(NOW),
        environment,
      }), /INTERNAL_GROUP_(?:ASSIGNMENT_FAILED|ASSIGNMENT_OUTCOME_UNKNOWN)/u);
      assert.equal(transport.requests.length, 0);
    });
  }
});

test('atomic transition rejects destination and temporary-path inode replacement races', async (t) => {
  const { armAssignmentAttempt, transitionAssignmentAttempt } = await import('../src/assignment-attempt.mjs');
  for (const race of ['destination', 'temporary']) {
    await t.test(race, async (subtest) => {
      const value = fixture(subtest);
      const environment = { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root };
      const attemptPath = armAssignmentAttempt(exactObservation(value), environment, Date.parse(NOW));
      const oldBytes = readFileSync(attemptPath);
      let racedPath;
      assert.throws(() => transitionAssignmentAttempt(
        attemptPath,
        'provider_started',
        environment,
        Date.parse(NOW),
        {
          failpoint(name, context) {
            if (name !== 'temp_validated') return;
            if (race === 'destination') {
              renameSync(attemptPath, `${attemptPath}.original`);
              writeFileSync(attemptPath, oldBytes, { mode: 0o600 });
              chmodSync(attemptPath, 0o600);
            } else {
              racedPath = context.tempPath;
              renameSync(racedPath, `${racedPath}.original`);
              writeFileSync(racedPath, context.newBytes, { mode: 0o600 });
              chmodSync(racedPath, 0o600);
            }
          },
        },
      ), /INTERNAL_GROUP_OUTPUT_INVALID/u);
      assert.deepEqual(readFileSync(attemptPath), oldBytes);
      if (race === 'temporary') {
        assert.deepEqual(readFileSync(racedPath), Buffer.from(`${JSON.stringify({
          ...JSON.parse(oldBytes),
          state: 'provider_started',
          providerStartedAt: NOW,
          terminalAt: null,
          outcome: 'pending',
        })}\n`));
        assert.equal(lstatSync(racedPath).nlink, 1);
        assert.equal(statSync(racedPath).mode & 0o777, 0o600);
      }

      const prepared = preparedAssignment(value);
      const transport = new FixtureTransport(expectations());
      await assert.rejects(runInternalGroup(prepared.args, {
        assignment: true,
        transport,
        now: Date.parse(NOW),
        environment,
      }), /INTERNAL_GROUP_(?:OUTPUT_INVALID|ASSIGNMENT_FAILED|ASSIGNMENT_OUTCOME_UNKNOWN)/u);
      assert.equal(transport.requests.length, 0);
    });
  }
});

test('atomic transition cannot overwrite a concurrent canonical state transition', async (t) => {
  const { armAssignmentAttempt, transitionAssignmentAttempt } = await import('../src/assignment-attempt.mjs');
  const value = fixture(t);
  const environment = { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root };
  const attemptPath = armAssignmentAttempt(exactObservation(value), environment, Date.parse(NOW));
  assert.throws(() => transitionAssignmentAttempt(
    attemptPath,
    'preprovider_failed',
    environment,
    Date.parse(NOW),
    {
      failpoint(name) {
        if (name === 'before_transition_snapshot') {
          transitionAssignmentAttempt(
            attemptPath,
            'provider_started',
            environment,
            Date.parse(NOW),
          );
        }
      },
    },
  ), /INTERNAL_GROUP_OUTPUT_INVALID/u);
  assert.equal(JSON.parse(readFileSync(attemptPath)).state, 'provider_started');
  assert.equal(readdirSync(value.root).some((name) => (
    name.startsWith(ASSIGNMENT_ATTEMPT_TEMP_PREFIX)
  )), false);
});

test('stale assignment transition files of every link kind block before live access', async (t) => {
  for (const kind of ['file', 'symlink', 'hardlink']) {
    await t.test(kind, async (subtest) => {
      const value = fixture(subtest);
      const prepared = preparedAssignment(value);
      const preserved = join(value.root, `${kind}-transition-preserved`);
      const stale = join(value.root, `${ASSIGNMENT_ATTEMPT_TEMP_PREFIX}${kind}.tmp`);
      writeFileSync(preserved, 'preserve', { mode: 0o600 });
      chmodSync(preserved, 0o600);
      if (kind === 'file') writeFileSync(stale, 'stale', { mode: 0o600 });
      else if (kind === 'symlink') symlinkSync(preserved, stale);
      else linkSync(preserved, stale);
      if (kind === 'file') chmodSync(stale, 0o600);
      const transport = new FixtureTransport(expectations());
      await assert.rejects(runInternalGroup(prepared.args, {
        assignment: true,
        transport,
        now: Date.parse(NOW),
        environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
      }), /INTERNAL_GROUP_OUTPUT_INVALID/u);
      assert.equal(transport.requests.length, 0);
      if (kind !== 'file') assert.equal(readFileSync(preserved, 'utf8'), 'preserve');
    });
  }
});

test('a failure after attempt arming but before POST is durably distinguished', async (t) => {
  const value = fixture(t);
  const observationPath = join(value.root, 'internal-testflight-group-observation.json');
  const observationSha256 = writeCanonical(observationPath, exactObservation(value));
  const output = join(value.root, 'internal-testflight-group-assignment.json');
  const transport = new FixtureTransport(expectations());
  await assert.rejects(runInternalGroup(
    assignmentArguments(value, observationPath, observationSha256, output),
    {
      assignment: true,
      transport,
      now: Date.parse(NOW),
      beforeMutation: () => { throw new Error('injected pre-POST failure'); },
      environment: {
        CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root,
        PRIVATE_SENTINEL: 'do-not-persist-this-secret',
      },
    },
  ), /injected pre-POST failure/u);
  transport.assertConsumed();
  assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
  const attemptBytes = readFileSync(join(value.root, ASSIGNMENT_ATTEMPT_NAME));
  const attempt = JSON.parse(attemptBytes);
  assert.equal(attempt.state, 'preprovider_failed');
  assert.equal(attempt.outcome, 'preprovider-blocked');
  assert.doesNotMatch(attemptBytes.toString(), /do-not-persist-this-secret/u);
});

test('pre-existing assignment-attempt files, symlinks, and hardlinks block before live access', async (t) => {
  for (const kind of ['file', 'symlink', 'hardlink']) {
    await t.test(kind, async (subtest) => {
      const value = fixture(subtest);
      const observationPath = join(value.root, 'internal-testflight-group-observation.json');
      const observationSha256 = writeCanonical(observationPath, exactObservation(value));
      const output = join(value.root, 'internal-testflight-group-assignment.json');
      const attemptPath = join(value.root, ASSIGNMENT_ATTEMPT_NAME);
      const preserved = join(value.root, `${kind}-attempt-preserved.json`);
      writeFileSync(preserved, 'preserve', { mode: 0o600 });
      chmodSync(preserved, 0o600);
      if (kind === 'file') writeFileSync(attemptPath, 'preserve', { mode: 0o600 });
      else if (kind === 'symlink') symlinkSync(preserved, attemptPath);
      else linkSync(preserved, attemptPath);
      if (kind === 'file') chmodSync(attemptPath, 0o600);
      const transport = new FixtureTransport(expectations());
      await assert.rejects(runInternalGroup(
        assignmentArguments(value, observationPath, observationSha256, output),
        {
          assignment: true,
          transport,
          now: Date.parse(NOW),
          environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
        },
      ), /INTERNAL_GROUP_(?:OUTPUT_INVALID|ASSIGNMENT_OUTCOME_UNKNOWN|ASSIGNMENT_FAILED)/u);
      assert.equal(transport.requests.length, 0);
      if (kind !== 'file') assert.equal(readFileSync(preserved, 'utf8'), 'preserve');
    });
  }
});

test('production CLI maps an unexpected failure to the finite internal error', (t) => {
  const value = fixture(t);
  const preload = join(value.root, 'throw-date-now.cjs');
  writeFileSync(preload, "Date.now = () => { throw new Error('injected unexpected failure'); };\n", {
    mode: 0o600,
  });
  chmodSync(preload, 0o600);
  const result = spawnSync(process.execPath, [
    join(adapterRoot, 'bin/observe-internal-group.mjs'),
  ], {
    cwd: adapterRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'INTERNAL_GROUP_INTERNAL_ERROR\n');
});

test('assignment rejects a non-exact reviewed observation before any live request', async (t) => {
  const value = fixture(t);
  const observationPath = join(value.root, 'internal-testflight-group-observation.json');
  const observation = exactObservation(value, {
    unexpected: 'forbidden',
  });
  const observationSha256 = writeCanonical(observationPath, observation);
  const output = join(value.root, 'internal-testflight-group-assignment.json');
  const assignmentArgs = assignmentArguments(value, observationPath, observationSha256, output);
  const transport = new FixtureTransport(expectations());
  await assert.rejects(runInternalGroup(assignmentArgs, {
    assignment: true,
    transport,
    now: Date.parse(NOW),
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: value.root },
  }), /INTERNAL_GROUP_INPUT_INVALID/u);
  assert.equal(transport.requests.length, 0);
});
