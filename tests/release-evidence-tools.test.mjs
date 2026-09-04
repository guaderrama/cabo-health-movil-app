import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';

const BUILD_ID = '12345678-1234-4234-8234-123456789abc';
const SUBMISSION_ID = '87654321-4321-4234-8234-cba987654321';
const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PROJECT_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const ENVIRONMENT_SANITIZER_CLI = join(PROJECT_ROOT, 'scripts/release-eas-environment-sanitizer.mjs');

function ownedDirectory(prefix, mode = 0o700) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(path, mode);
  return path;
}

function sddEvidenceRoot(task) {
  const base = ownedDirectory('cabohealth-build11-sdd-');
  const recoveryTask = task === 'task-3';
  const releaseTaskRoot = recoveryTask
    ? '2026-09-04-cabohealth-build11-input-authority-recovery'
    : '2026-09-03-cabohealth-build11-app-store-release';
  const path = join(
    base,
    `.superpowers/sdd/${releaseTaskRoot}`,
    recoveryTask ? 'task-3-recovery-evidence' : `${task}-evidence`,
  );
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return { base, path: realpathSync(path) };
}

function staleBuild10SddEvidenceRoot(task) {
  const base = ownedDirectory('cabohealth-build10-sdd-');
  const path = join(
    base,
    '.superpowers/sdd/2026-08-31-cabohealth-build10-testflight-release',
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
    appBuildVersion: '11',
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

const ENV_HIDDEN_CHARACTER_CASES = Object.freeze([
  {
    name: 'prefix TAB',
    input: ENV_LONG.replace('Environment: production', 'Environment:\u0009 production'),
  },
  {
    name: 'prefix CR',
    input: ENV_LONG.replace('Environment: production', 'Environment:\r production'),
  },
  {
    name: 'separator NBSP',
    input: ENV_LONG.replace('———', '—\u00A0——'),
  },
  {
    name: 'label left-to-right mark',
    input: ENV_LONG.replace(
      'ID            provider-id-one',
      'I\u200ED            provider-id-one',
    ),
  },
  {
    name: 'label DEL',
    input: ENV_LONG.replace(
      'ID            provider-id-one',
      'ID\u007F            provider-id-one',
    ),
  },
  {
    name: 'ID TAB',
    input: ENV_LONG.replace('provider-id-one', 'provider\u0009-id-one'),
  },
  {
    name: 'ID NUL',
    input: ENV_LONG.replace('provider-id-one', 'provider\u0000-id-one'),
  },
  {
    name: 'ID byte-order mark',
    input: ENV_LONG.replace('provider-id-one', 'provider\uFEFF-id-one'),
  },
  {
    name: 'Name right-to-left mark',
    input: ENV_LONG.replace(
      'CABOHEALTH_FIREBASE_PROJECT_ID',
      'CABOHEALTH_FIREBASE\u200F_PROJECT_ID',
    ),
  },
  {
    name: 'Value line separator',
    input: ENV_LONG.replace('sensitive env variable', 'sensitive\u2028 env variable'),
  },
  {
    name: 'Scope NBSP',
    input: ENV_LONG.replace('Scope         PROJECT', 'Scope         PROJ\u00A0ECT'),
  },
  {
    name: 'Visibility thin space',
    input: ENV_LONG.replace('Visibility    SENSITIVE', 'Visibility    SENSI\u2009TIVE'),
  },
  {
    name: 'Environments ideographic space',
    input: ENV_LONG.replace('Environments  production', 'Environments  pro\u3000duction'),
  },
  {
    name: 'type paragraph separator',
    input: ENV_LONG.replace('type          string', 'type          stri\u2029ng'),
  },
  {
    name: 'Created at C1 next-line',
    input: ENV_LONG.replace('Aug 29 12:00:00', 'Aug\u0085 29 12:00:00'),
  },
  {
    name: 'Updated at C1 control',
    input: ENV_LONG.replace('Aug 30 12:00:00', 'Aug\u009B 30 12:00:00'),
  },
]);

test('environment sanitizer emits only the exact canonical value-free inventory in mode 0600', async (t) => {
  const { sanitizeEasEnvironment } = await import('../scripts/release-eas-environment-sanitizer.mjs');
  const fixture = sddEvidenceRoot('task-3');
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

  const stale = staleBuild10SddEvidenceRoot('task-2');
  t.after(() => rmSync(stale.base, { recursive: true, force: true }));
  const staleConfig = join(stale.base, 'eas.json');
  writeFileSync(staleConfig, `${JSON.stringify({
    build: { production: { environment: 'production', env: { APP_ENV: 'production' } } },
  })}\n`);
  const staleOutput = join(stale.path, 'eas-environment.json');
  assert.throws(() => sanitizeEasEnvironment({
    stdinBytes: Buffer.from(ENV_LONG),
    environmentName: 'production',
    easConfigPath: staleConfig,
    outputPath: staleOutput,
  }), /EAS_ENVIRONMENT_SANITIZATION_FAILED/u);
  assert.equal(existsSync(staleOutput), false);
});

test('environment sanitizer accepts the current EAS long output with one leading LF', async (t) => {
  const { sanitizeEasEnvironment } = await import('../scripts/release-eas-environment-sanitizer.mjs');
  const fixture = sddEvidenceRoot('task-3');
  t.after(() => rmSync(fixture.base, { recursive: true, force: true }));
  const easConfig = join(fixture.base, 'eas.json');
  writeFileSync(easConfig, `${JSON.stringify({
    build: { production: { environment: 'production', env: { APP_ENV: 'production' } } },
  })}\n`);
  const output = join(fixture.path, 'eas-environment.json');

  const value = sanitizeEasEnvironment({
    stdinBytes: Buffer.from(`\n${ENV_LONG}`),
    environmentName: 'production',
    easConfigPath: easConfig,
    outputPath: output,
  });

  assert.deepEqual(value.projectVariables, [
    { name: 'CABOHEALTH_FIREBASE_PROJECT_ID', source: 'eas-project-environment', kind: 'sensitive' },
    { name: 'CABOHEALTH_GOOGLE_SERVICES_PLIST', source: 'eas-project-environment', kind: 'secret-file' },
  ]);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(output, 'utf8'), /provider-id|Aug 3|\*\*\*\*\*/u);
});

test('environment sanitizer accepts no more than one exact leading LF', async (t) => {
  const { sanitizeEasEnvironment } = await import('../scripts/release-eas-environment-sanitizer.mjs');
  const fixture = sddEvidenceRoot('task-3');
  t.after(() => rmSync(fixture.base, { recursive: true, force: true }));
  const easConfig = join(fixture.base, 'eas.json');
  writeFileSync(easConfig, `${JSON.stringify({
    build: { production: { environment: 'production', env: { APP_ENV: 'production' } } },
  })}\n`);
  const output = join(fixture.path, 'eas-environment.json');
  for (const input of [
    `\n\n${ENV_LONG}`,
    ` ${ENV_LONG}`,
    `\r\n${ENV_LONG}`,
    `\uFEFF${ENV_LONG}`,
    `\n \n${ENV_LONG}`,
  ]) {
    assert.throws(
      () => sanitizeEasEnvironment({
        stdinBytes: Buffer.from(input),
        environmentName: 'production',
        easConfigPath: easConfig,
        outputPath: output,
      }),
      /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
    );
    assert.equal(existsSync(output), false);
  }
});

test('environment parser rejects hidden controls and Unicode blanks in every structural field', async (t) => {
  const { parseEasEnvironmentLongOutput } = await import('../scripts/release-eas-environment-sanitizer.mjs');
  for (const fixture of ENV_HIDDEN_CHARACTER_CASES) {
    await t.test(fixture.name, () => {
      assert.throws(
        () => parseEasEnvironmentLongOutput(Buffer.from(fixture.input)),
        /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
      );
    });
  }
});

test('environment sanitizer CLI rejects hidden characters with one finite error and no artifact', async (t) => {
  for (const hiddenCharacter of ENV_HIDDEN_CHARACTER_CASES) {
    await t.test(hiddenCharacter.name, (subtest) => {
      const fixture = sddEvidenceRoot('task-3');
      subtest.after(() => rmSync(fixture.base, { recursive: true, force: true }));
      writeFileSync(join(fixture.base, 'eas.json'), JSON.stringify({
        build: { production: { environment: 'production', env: { APP_ENV: 'production' } } },
      }) + '\n');
      const output = join(fixture.path, 'eas-environment.json');
      const result = spawnSync(process.execPath, [
        ENVIRONMENT_SANITIZER_CLI,
        '--environment', 'production',
        '--eas-config', 'eas.json',
        '--output', output,
      ], {
        cwd: fixture.base,
        env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
        input: Buffer.from(hiddenCharacter.input),
        encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'EAS_ENVIRONMENT_SANITIZATION_FAILED\n');
      assert.equal(existsSync(output), false);
    });
  }
});

test('environment sanitizer rejects value-bearing, duplicate, extra, config-drift, and oversized input', async () => {
  const {
    parseEasEnvironmentLongOutput,
    sanitizeEasEnvironment,
  } = await import('../scripts/release-eas-environment-sanitizer.mjs');
  assert.throws(
    () => parseEasEnvironmentLongOutput(Buffer.from(`\n${ENV_LONG.replace('***** (This is a sensitive', 'revealed-value (This is a sensitive')}`)),
    /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
  );
  assert.throws(
    () => parseEasEnvironmentLongOutput(Buffer.from(ENV_LONG.replace(
      'Name          CABOHEALTH_GOOGLE_SERVICES_PLIST',
      'Name          CABOHEALTH_FIREBASE_PROJECT_ID',
    ))),
    /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
  );
  assert.throws(
    () => parseEasEnvironmentLongOutput(Buffer.from(`\n${ENV_LONG.replace(
      'Name          CABOHEALTH_GOOGLE_SERVICES_PLIST',
      'Name          CABOHEALTH_UNREVIEWED_EXTRA',
    )}`)),
    /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
  );
  assert.throws(
    () => parseEasEnvironmentLongOutput(Buffer.alloc(1024 * 1024 + 1, 65)),
    /EAS_ENVIRONMENT_SANITIZATION_FAILED/u,
  );

  const fixture = sddEvidenceRoot('task-3');
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

    const output = join(fixture.path, 'eas-environment.json');
    for (const config of [
      { build: { production: { environment: 'preview', env: { APP_ENV: 'production' } } } },
      { build: { production: { environment: 'production', env: { APP_ENV: 'preview' } } } },
      { build: { production: { environment: 'production', env: { APP_ENV: 'production', EXTRA: 'forbidden' } } } },
    ]) {
      writeFileSync(easConfig, `${JSON.stringify(config)}\n`);
      assert.throws(() => sanitizeEasEnvironment({
        stdinBytes: Buffer.from(`\n${ENV_LONG}`),
        environmentName: 'production',
        easConfigPath: easConfig,
        outputPath: output,
      }), /EAS_ENVIRONMENT_SANITIZATION_FAILED/u);
      assert.equal(existsSync(output), false);
    }
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test('build status sanitizer validates exact build 11 identity and omits provider URLs and fields', async (t) => {
  const { sanitizeBuildStatus } = await import('../scripts/release-eas-build-status-sanitizer.mjs');
  const root = ownedDirectory('cabohealth-build11-external-');
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
  assert.equal(value.buildNumber, '11');
  assert.equal(value.artifactAvailable, true);
  assert.equal(value.mutationPerformed, false);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.doesNotMatch(bytes.toString(), /example\.invalid|provider-id/u);
});

test('artifact downloader validates identity before a bounded ZIP download and hashes final bytes', async (t) => {
  const { downloadEasArtifact } = await import('../scripts/release-eas-artifact-downloader.mjs');
  const privateRoot = ownedDirectory('cabohealth-build11-private-');
  const rcRoot = join(privateRoot, 'rc-build-11');
  mkdirSync(rcRoot, { mode: 0o700 });
  chmodSync(rcRoot, 0o700);
  const evidence = sddEvidenceRoot('task-4');
  t.after(() => {
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(evidence.base, { recursive: true, force: true });
  });
  const ipaBytes = Buffer.from('504b030414000000', 'hex');
  let fetchCount = 0;
  const output = join(rcRoot, 'CaboHealth-3.0-build-11.ipa');
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

  const invalidZipOutput = join(rcRoot, 'CaboHealth-3.0-build-11.ipa');
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

test('artifact producer binds the canonical association and exact six-file build 11 inventory', async (t) => {
  const { createBuildArtifactAttestation } = await import('../scripts/create-build-artifact-attestation.mjs');
  const privateRoot = ownedDirectory('cabohealth-artifact-private-');
  const evidenceDir = join(privateRoot, 'rc-build-11');
  mkdirSync(evidenceDir, { mode: 0o700 });
  chmodSync(evidenceDir, 0o700);
  const fixture = sddEvidenceRoot('task-4');
  t.after(() => {
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(fixture.base, { recursive: true, force: true });
  });
  const files = {
    'CaboHealth-3.0-build-11.ipa': Buffer.from('504b030414000000', 'hex'),
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
    candidate: { appleId: '6758285327', bundleIdentifier: 'com.cabohealth.app', marketingVersion: '3.0', buildNumber: '11' },
    easBuildId: BUILD_ID,
    account: 'guaderrama',
    projectSlug: 'cabohealth',
    platform: 'IOS',
    distribution: 'STORE',
    buildProfile: 'production',
    buildStatus: 'FINISHED',
    artifactAvailable: true,
    downloadedIpaByteCount: files['CaboHealth-3.0-build-11.ipa'].length,
    downloadedIpaSha256: sha256(files['CaboHealth-3.0-build-11.ipa']),
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
  assert.equal(value.candidate.buildNumber, '11');
  assert.equal(value.ipaSha256, association.downloadedIpaSha256);
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('submission sanitizer emits the exact build-bound read-only status for both allowed purposes', async (t) => {
  const { sanitizeSubmissionStatus } = await import('../scripts/release-eas-submission-sanitizer.mjs');
  const task = sddEvidenceRoot('task-5');
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
  assert.equal(value.app.buildNumber, '11');
  assert.equal(value.appleProcessingStatus, 'not-proven-by-eas-submission');
  assert.equal(value.mutationPerformed, false);
  assert.equal(statSync(taskOutput).mode & 0o777, 0o600);

  const staleTask = staleBuild10SddEvidenceRoot('task-7');
  t.after(() => rmSync(staleTask.base, { recursive: true, force: true }));
  const staleTaskOutput = join(staleTask.path, 'eas-submission-status.json');
  assert.throws(() => sanitizeSubmissionStatus({
    stdinBytes: Buffer.from(JSON.stringify(submissionView())),
    submissionId: SUBMISSION_ID,
    easBuildId: BUILD_ID,
    purpose: 'task-evidence',
    outputPath: staleTaskOutput,
    environment: {},
  }), /SUBMISSION_STATUS_SANITIZATION_FAILED/u);
  assert.equal(existsSync(staleTaskOutput), false);

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

test('submission sanitizer preserves an explicit provider submittedBuild null and rejects omission', async (t) => {
  const { sanitizeSubmissionStatus } = await import('../scripts/release-eas-submission-sanitizer.mjs');
  const validRoot = ownedDirectory('cabohealth-submission-null-');
  const omittedRoot = ownedDirectory('cabohealth-submission-omitted-');
  t.after(() => {
    rmSync(validRoot, { recursive: true, force: true });
    rmSync(omittedRoot, { recursive: true, force: true });
  });
  const providerNull = submissionView();
  providerNull.submittedBuild = null;
  const validOutput = join(validRoot, 'upload-testflight-reconciliation.json');
  const result = sanitizeSubmissionStatus({
    stdinBytes: Buffer.from(JSON.stringify(providerNull)),
    submissionId: SUBMISSION_ID,
    easBuildId: BUILD_ID,
    purpose: 'attempt-reconciliation',
    outputPath: validOutput,
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: validRoot },
  });
  assert.deepEqual(result.app, {
    appleId: '6758285327',
    account: 'guaderrama',
    projectSlug: 'cabohealth',
    submittedBuildIdentityAvailable: false,
    bundleIdentifier: null,
    marketingVersion: null,
    buildNumber: null,
    easBuildId: null,
  });

  const omitted = submissionView();
  delete omitted.submittedBuild;
  assert.throws(() => sanitizeSubmissionStatus({
    stdinBytes: Buffer.from(JSON.stringify(omitted)),
    submissionId: SUBMISSION_ID,
    easBuildId: BUILD_ID,
    purpose: 'attempt-reconciliation',
    outputPath: join(omittedRoot, 'upload-testflight-reconciliation.json'),
    environment: { CABOHEALTH_RELEASE_EVIDENCE_ROOT: omittedRoot },
  }), /SUBMISSION_STATUS_SANITIZATION_FAILED/u);
});
