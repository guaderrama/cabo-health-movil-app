import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const BUILD_ID = '12345678-1234-4234-8234-123456789abc';
const SUBMISSION_ID = '87654321-4321-4234-8234-cba987654321';
const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function ownedDirectory(prefix, mode = 0o700) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(path, mode);
  return path;
}

function sddEvidenceRoot(task) {
  const base = ownedDirectory('cabohealth-build9-sdd-');
  const path = join(
    base,
    '.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release',
    `${task}-evidence`,
  );
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return { base, path: realpathSync(path) };
}

function buildView({ status = 'FINISHED', artifactUrl = 'https://example.invalid/exact.ipa' } = {}) {
  return {
    id: BUILD_ID,
    status,
    platform: 'IOS',
    error: status === 'ERRORED' ? { errorCode: 'EAS_BUILD_FAILED', message: 'omitted' } : null,
    artifacts: artifactUrl === null ? {} : { buildUrl: artifactUrl },
    app: {
      id: '3ebd1d12-4aeb-4d65-8e17-b7726c65018d',
      slug: 'cabohealth',
      ownerAccount: { id: 'provider-id-omitted', name: 'guaderrama' },
    },
    distribution: 'STORE',
    buildProfile: 'production',
    appIdentifier: 'com.cabohealth.app',
    appVersion: '3.0',
    appBuildVersion: '9',
    createdAt: '2026-08-30T11:00:00.000Z',
    completedAt: status === 'FINISHED' ? '2026-08-30T11:10:00.000Z' : null,
    logFiles: ['https://provider.invalid/omitted'],
  };
}

function submissionView({ status = 'FINISHED' } = {}) {
  return {
    id: SUBMISSION_ID,
    status,
    platform: 'IOS',
    createdAt: '2026-08-30T11:20:00.000Z',
    completedAt: status === 'FINISHED' ? '2026-08-30T11:25:00.000Z' : null,
    error: null,
    iosConfig: { ascAppIdentifier: '6758285327', appleIdUsername: 'omitted' },
    app: { slug: 'cabohealth', ownerAccount: { name: 'guaderrama' } },
    submittedBuild: {
      ...buildView(),
      id: BUILD_ID,
      artifacts: {},
    },
    logFiles: ['https://provider.invalid/omitted'],
  };
}

const ENV_LONG = [
  'Environment: production',
  'Variables for this project:',
  'ID            provider-id-one',
  'Name          CABOHEALTH_FIREBASE_PROJECT_ID',
  'Value         ***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)',
  'Scope         PROJECT',
  'Visibility    SENSITIVE',
  'Environments  production',
  'type          string',
  'Created at    Aug 29 12:00:00',
  'Updated at    Aug 30 12:00:00',
  '',
  '———',
  '',
  'ID            provider-id-two',
  'Name          CABOHEALTH_GOOGLE_SERVICES_PLIST',
  "Value         ***** (This is a secret env variable that can only be accessed on EAS builder and can't be read in any UI. Learn more.)",
  'Scope         PROJECT',
  'Visibility    SECRET',
  'Environments  production',
  'type          file',
  'Created at    Aug 29 12:00:00',
  'Updated at    Aug 30 12:00:00',
  '',
].join('\n');

test('environment sanitizer emits only the exact canonical value-free inventory in mode 0600', async (t) => {
  const { sanitizeEasEnvironment } = await import('../scripts/release-eas-environment-sanitizer.mjs');
  const fixture = sddEvidenceRoot('task-2');
  t.after(() => rmSync(fixture.base, { recursive: true, force: true }));
  const easConfig = join(fixture.base, 'eas.json');
  writeFileSync(easConfig, `${JSON.stringify({
    build: { production: { environment: 'production', env: { APP_ENV: 'production' } } },
  })}\n`);
  const output = join(fixture.path, 'eas-environment.json');
  const previousUmask = process.umask(0o077);
  try {
    sanitizeEasEnvironment({
      stdinBytes: Buffer.from(ENV_LONG),
      environmentName: 'production',
      easConfigPath: easConfig,
      outputPath: output,
    });
  } finally {
    process.umask(previousUmask);
  }
  const bytes = readFileSync(output);
  const value = JSON.parse(bytes);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(value), [
    'schemaVersion', 'evidenceKind', 'environmentName', 'profileVariables',
    'projectVariables', 'extras', 'valuesIncluded', 'providerValuesRetained',
  ]);
  assert.deepEqual(value.profileVariables, [
    { name: 'APP_ENV', source: 'eas-profile', kind: 'plain' },
  ]);
  assert.deepEqual(value.projectVariables, [
    { name: 'CABOHEALTH_FIREBASE_PROJECT_ID', source: 'eas-project-environment', kind: 'sensitive' },
    { name: 'CABOHEALTH_GOOGLE_SERVICES_PLIST', source: 'eas-project-environment', kind: 'secret-file' },
  ]);
  assert.deepEqual(value.extras, []);
  assert.equal(value.valuesIncluded, false);
  assert.equal(value.providerValuesRetained, false);
  assert.deepEqual(bytes, Buffer.from(`${JSON.stringify(value)}\n`));
  assert.doesNotMatch(bytes.toString(), /provider-id|Aug 3|example-secret/u);
});

test('environment sanitizer rejects value-bearing, duplicate, extra, and oversized input', async () => {
  const {
    parseEasEnvironmentLongOutput,
    sanitizeEasEnvironment,
  } = await import('../scripts/release-eas-environment-sanitizer.mjs');
  assert.throws(
    () => parseEasEnvironmentLongOutput(Buffer.from(ENV_LONG.replace('***** (This is a sensitive', 'revealed-value (This is a sensitive'))),
    /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
  );
  assert.throws(
    () => parseEasEnvironmentLongOutput(Buffer.from(`${ENV_LONG}\n${ENV_LONG.split('\n').slice(3).join('\n')}`)),
    /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
  );
  assert.throws(
    () => parseEasEnvironmentLongOutput(Buffer.alloc(1024 * 1024 + 1, 65)),
    /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
  );

  const fixture = sddEvidenceRoot('task-2');
  const easConfig = join(fixture.base, 'eas.json');
  writeFileSync(easConfig, `${JSON.stringify({
    build: { production: { environment: 'production', env: { APP_ENV: 'production' } } },
  })}\n`);
  const wrongOutput = join(fixture.path, 'wrong-name.json');
  try {
    assert.throws(() => sanitizeEasEnvironment({
      stdinBytes: Buffer.from(ENV_LONG),
      environmentName: 'production',
      easConfigPath: easConfig,
      outputPath: wrongOutput,
    }), /EAS_ENVIRONMENT_SANITIZATION_FAILED/u);
    assert.equal(existsSync(wrongOutput), false);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test('build status sanitizer validates exact build 9 identity and omits provider URLs and fields', async (t) => {
  const { sanitizeBuildStatus } = await import('../scripts/release-eas-build-status-sanitizer.mjs');
  const root = ownedDirectory('cabohealth-build9-external-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, 'build-reconciliation.json');
  sanitizeBuildStatus({
    stdinBytes: Buffer.from(JSON.stringify(buildView())),
    buildId: BUILD_ID,
    outputPath: output,
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: root },
  });
  const bytes = readFileSync(output);
  const value = JSON.parse(bytes);
  assert.deepEqual(Object.keys(value), [
    'schemaVersion', 'evidenceKind', 'easBuildId', 'status', 'terminal', 'platform',
    'distribution', 'account', 'projectSlug', 'buildProfile', 'bundleIdentifier',
    'marketingVersion', 'buildNumber', 'artifactAvailable', 'createdAt', 'completedAt',
    'errorPresent', 'errorCode', 'mutationPerformed', 'rawProviderResponseRetained',
    'providerUrlsOmitted', 'providerFieldsOmitted', 'credentialFieldsOmitted',
  ]);
  assert.equal(value.buildNumber, '9');
  assert.equal(value.artifactAvailable, true);
  assert.equal(value.mutationPerformed, false);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.doesNotMatch(bytes.toString(), /example\.invalid|provider-id/u);
});

test('artifact downloader validates identity before a bounded ZIP download and hashes final bytes', async (t) => {
  const { downloadEasArtifact } = await import('../scripts/release-eas-artifact-downloader.mjs');
  const privateRoot = ownedDirectory('cabohealth-build9-private-');
  const rcRoot = join(privateRoot, 'rc-build-9');
  mkdirSync(rcRoot, { mode: 0o700 });
  chmodSync(rcRoot, 0o700);
  const evidence = sddEvidenceRoot('task-5');
  t.after(() => {
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(evidence.base, { recursive: true, force: true });
  });
  const ipaBytes = Buffer.from('504b030414000000', 'hex');
  let fetchCount = 0;
  const output = join(rcRoot, 'CaboHealth-3.0-build-9.ipa');
  const associationOutput = join(evidence.path, 'eas-artifact-association.json');
  await downloadEasArtifact({
    stdinBytes: Buffer.from(JSON.stringify(buildView())),
    buildId: BUILD_ID,
    outputPath: output,
    associationOutputPath: associationOutput,
    now: () => NOW,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(ipaBytes, {
        status: 200,
        headers: { 'content-length': String(ipaBytes.length) },
      });
    },
  });
  const associationBytes = readFileSync(associationOutput);
  const association = JSON.parse(associationBytes);
  assert.equal(fetchCount, 1);
  assert.deepEqual(readFileSync(output), ipaBytes);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(statSync(associationOutput).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(association), [
    'schemaVersion', 'evidenceKind', 'candidate', 'easBuildId', 'account',
    'projectSlug', 'platform', 'distribution', 'buildProfile', 'buildStatus',
    'artifactAvailable', 'downloadedIpaByteCount', 'downloadedIpaSha256',
    'associationGuardProven', 'providerUrlsOmitted', 'credentialFieldsOmitted',
    'reviewedAt',
  ]);
  assert.equal(association.downloadedIpaSha256, sha256(ipaBytes));
  assert.equal(association.associationGuardProven, false);
  assert.doesNotMatch(associationBytes.toString(), /example\.invalid/u);

  let invalidFetchCount = 0;
  await assert.rejects(
    downloadEasArtifact({
      stdinBytes: Buffer.from(JSON.stringify({ ...buildView(), appBuildVersion: '8' })),
      buildId: BUILD_ID,
      outputPath: join(rcRoot, 'wrong.ipa'),
      associationOutputPath: join(evidence.path, 'wrong.json'),
      fetchImpl: async () => { invalidFetchCount += 1; },
    }),
    /EAS_ARTIFACT_DOWNLOAD_FAILED/u,
  );
  assert.equal(invalidFetchCount, 0);

  const invalidZipOutput = join(rcRoot, 'CaboHealth-3.0-build-9.ipa');
  rmSync(output);
  rmSync(associationOutput);
  await assert.rejects(
    downloadEasArtifact({
      stdinBytes: Buffer.from(JSON.stringify(buildView())),
      buildId: BUILD_ID,
      outputPath: invalidZipOutput,
      associationOutputPath: associationOutput,
      fetchImpl: async () => new Response(Buffer.from('not-a-zip'), { status: 200 }),
    }),
    /EAS_ARTIFACT_DOWNLOAD_FAILED/u,
  );
  assert.equal(existsSync(invalidZipOutput), false);

  writeFileSync(invalidZipOutput, 'preserve-existing-ipa', { mode: 0o600 });
  chmodSync(invalidZipOutput, 0o600);
  let duplicateFetchCount = 0;
  await assert.rejects(downloadEasArtifact({
    stdinBytes: Buffer.from(JSON.stringify(buildView())),
    buildId: BUILD_ID,
    outputPath: invalidZipOutput,
    associationOutputPath: associationOutput,
    fetchImpl: async () => {
      duplicateFetchCount += 1;
      return new Response(ipaBytes, { status: 200 });
    },
  }), /EAS_ARTIFACT_DOWNLOAD_FAILED/u);
  assert.equal(duplicateFetchCount, 0);
  assert.equal(readFileSync(invalidZipOutput, 'utf8'), 'preserve-existing-ipa');
});

test('artifact producer binds the canonical association and exact six-file build 9 inventory', async (t) => {
  const { createBuildArtifactAttestation } = await import('../scripts/create-build-artifact-attestation.mjs');
  const privateRoot = ownedDirectory('cabohealth-artifact-private-');
  const evidenceDir = join(privateRoot, 'rc-build-9');
  mkdirSync(evidenceDir, { mode: 0o700 });
  chmodSync(evidenceDir, 0o700);
  const fixture = sddEvidenceRoot('task-5');
  t.after(() => {
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(fixture.base, { recursive: true, force: true });
  });
  const files = {
    'CaboHealth-3.0-build-9.ipa': Buffer.from('504b030414000000', 'hex'),
    'signed-entitlements.plist': Buffer.from('<plist/>'),
    'privacy-report.json': Buffer.from('{"status":"passed"}\n'),
    'embedded-GoogleService-Info.plist': Buffer.from('<plist/>'),
    'signing-certificate.der': Buffer.from('certificate'),
    'embedded.mobileprovision': Buffer.from('provision'),
  };
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(evidenceDir, name);
    writeFileSync(path, bytes, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const association = {
    schemaVersion: 1,
    evidenceKind: 'cabohealth-eas-artifact-association',
    candidate: { appleId: '6758285327', bundleIdentifier: 'com.cabohealth.app', marketingVersion: '3.0', buildNumber: '9' },
    easBuildId: BUILD_ID,
    account: 'guaderrama',
    projectSlug: 'cabohealth',
    platform: 'IOS',
    distribution: 'STORE',
    buildProfile: 'production',
    buildStatus: 'FINISHED',
    artifactAvailable: true,
    downloadedIpaByteCount: files['CaboHealth-3.0-build-9.ipa'].length,
    downloadedIpaSha256: sha256(files['CaboHealth-3.0-build-9.ipa']),
    associationGuardProven: false,
    providerUrlsOmitted: true,
    credentialFieldsOmitted: true,
    reviewedAt: '2026-08-30T11:10:00.000Z',
  };
  const associationPath = join(fixture.path, 'eas-artifact-association.json');
  writeFileSync(associationPath, `${JSON.stringify(association)}\n`, { mode: 0o600 });
  chmodSync(associationPath, 0o600);
  const output = join(fixture.path, 'build-artifact-candidate.json');
  createBuildArtifactAttestation({
    reviewedAt: '2026-08-30T12:00:00.000Z',
    buildInputAttestationSha256: 'a'.repeat(64),
    sourceTreeSha256: 'b'.repeat(64),
    associationPath,
    evidenceDir,
    outputPath: output,
  });
  const value = JSON.parse(readFileSync(output));
  assert.deepEqual(Object.keys(value), [
    'schemaVersion', 'artifactKind', 'candidate', 'buildInputAttestationSha256',
    'sourceTreeSha256', 'easBuildId', 'easArtifactAssociation', 'ipaSha256',
    'signedEntitlementsSha256', 'privacyReportSha256',
    'embeddedGoogleServicesPlistSha256', 'signingCertificateSha256',
    'embeddedProvisioningProfileSha256', 'reviewedAt',
  ]);
  assert.equal(value.candidate.buildNumber, '9');
  assert.equal(value.ipaSha256, association.downloadedIpaSha256);
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('submission sanitizer emits the exact build-bound read-only status for both allowed purposes', async (t) => {
  const { sanitizeSubmissionStatus } = await import('../scripts/release-eas-submission-sanitizer.mjs');
  const task = sddEvidenceRoot('task-7');
  const external = ownedDirectory('cabohealth-submission-external-');
  t.after(() => {
    rmSync(task.base, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  });
  const taskOutput = join(task.path, 'eas-submission-status.json');
  sanitizeSubmissionStatus({
    stdinBytes: Buffer.from(JSON.stringify(submissionView())),
    submissionId: SUBMISSION_ID,
    easBuildId: BUILD_ID,
    purpose: 'task-evidence',
    outputPath: taskOutput,
    environment: {},
  });
  const value = JSON.parse(readFileSync(taskOutput));
  assert.deepEqual(Object.keys(value), [
    'schemaVersion', 'evidenceKind', 'submissionId', 'status', 'terminal', 'platform',
    'createdAt', 'completedAt', 'errorPresent', 'errorCode', 'app',
    'appleProcessingStatus', 'appleProcessingPendingReadOnlyVerification',
    'appStoreConnectBuildSelectionPerformed', 'mutationPerformed',
    'rawProviderResponseRetained', 'providerUrlsOmitted', 'providerFieldsOmitted',
    'credentialFieldsOmitted',
  ]);
  assert.deepEqual(Object.keys(value.app), [
    'appleId', 'account', 'projectSlug', 'submittedBuildIdentityAvailable',
    'bundleIdentifier', 'marketingVersion', 'buildNumber', 'easBuildId',
  ]);
  assert.equal(value.app.buildNumber, '9');
  assert.equal(value.appleProcessingStatus, 'not-proven-by-eas-submission');
  assert.equal(value.mutationPerformed, false);
  assert.equal(statSync(taskOutput).mode & 0o777, 0o600);

  const reconcileOutput = join(external, 'upload-testflight-reconciliation.json');
  sanitizeSubmissionStatus({
    stdinBytes: Buffer.from(JSON.stringify(submissionView())),
    submissionId: SUBMISSION_ID,
    easBuildId: BUILD_ID,
    purpose: 'attempt-reconciliation',
    outputPath: reconcileOutput,
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: external },
  });
  assert.deepEqual(readFileSync(reconcileOutput), readFileSync(taskOutput));
});
