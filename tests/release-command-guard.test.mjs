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

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const guardPath = join(projectRoot, 'scripts/release-command-guard.mjs');

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function write(root, relativePath, value) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('production build and submit scripts cannot bypass the release guard', () => {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  assert.match(readFileSync(join(projectRoot, '.gitignore'), 'utf8'), /^\/release\/private\/$/mu);
  assert.equal(packageJson.scripts['build:prod'], 'node scripts/release-command-guard.mjs build');
  assert.equal(
    packageJson.scripts['upload:testflight'],
    'node scripts/release-command-guard.mjs upload-testflight',
  );
  assert.equal(packageJson.scripts.submit, 'node scripts/release-command-guard.mjs submit-review');
  assert.doesNotMatch(packageJson.scripts['build:prod'], /\beas\s+build\b/u);
  assert.doesNotMatch(packageJson.scripts['upload:testflight'], /\beas\s+submit\b/u);
  assert.doesNotMatch(packageJson.scripts.submit, /\beas\s+submit\b/u);
});

test('each release phase refuses to run while its independently reviewed authority is unpinned', async (t) => {
  for (const [action, error] of [
    ['build', 'EXACT_BUILD_INPUT_ATTESTATION_MISSING'],
    ['upload-testflight', 'EXACT_BUILD_ARTIFACT_ATTESTATION_MISSING'],
    ['submit-review', 'EXACT_RC_ATTESTATION_MISSING'],
  ]) {
    await t.test(action, () => {
      const result = spawnSync(process.execPath, [guardPath, action], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, new RegExp(error, 'u'));
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /EAS command started/iu);
    });
  }
});

test('release guard separates source, built artifact, and final reviewed RC authorities', () => {
  const source = readFileSync(guardPath, 'utf8');
  assert.match(source, /BUILD_INPUT_ATTESTATION_SHA256/u);
  assert.match(source, /BUILD_ARTIFACT_ATTESTATION_SHA256/u);
  assert.match(source, /computeTrackedSourceSha256/u);
  assert.match(source, /ipaSha256/u);
  assert.match(source, /--path/u);
  assert.doesNotMatch(source, /\['submit', '--platform', 'ios'\]/u);
});

test('tracked source includes guard behavior while normalizing only reviewed pin values', async (t) => {
  const { computeTrackedSourceSha256, normalizeReleaseGuardAuthority } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-guard-authority-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'scripts/release-command-guard.mjs', [
    'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
    'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
    'const RC_ATTESTATION_SHA256 = null;',
    'const PINNED_EAS_CLI = null;',
    'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
    "export const guardedBehavior = 'v1';",
    '',
  ].join('\n'));
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'guard fixture');
  const initial = computeTrackedSourceSha256(root);

  const source = readFileSync(join(root, 'scripts/release-command-guard.mjs'), 'utf8');
  write(root, 'scripts/release-command-guard.mjs', source.replace(
    'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
    `const BUILD_INPUT_ATTESTATION_SHA256 = '${'a'.repeat(64)}';`,
  ));
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'reviewed pin only');
  assert.equal(computeTrackedSourceSha256(root), initial);

  write(root, 'scripts/release-command-guard.mjs', readFileSync(
    join(root, 'scripts/release-command-guard.mjs'),
    'utf8',
  ).replace("guardedBehavior = 'v1'", "guardedBehavior = 'v2'"));
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'behavior drift');
  assert.notEqual(computeTrackedSourceSha256(root), initial);

  assert.throws(() => normalizeReleaseGuardAuthority(Buffer.from(guardFixtureForAttack())),
    /BUILD_SOURCE_GUARD_AUTHORITY_INVALID/u);

  function guardFixtureForAttack() {
    return [
      'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
      'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
      'const RC_ATTESTATION_SHA256 = null;',
      'const PINNED_EAS_CLI = (globalThis.compromised = true, null);',
      'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
      '',
    ].join('\n');
  }
});

test('a pinned Node tool authority covers its complete runtime tree and Node binary', async (t) => {
  const {
    computeRuntimeTreeSha256,
    decodePinnedNodeToolAuthority,
    resolvePinnedNodeTool,
  } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-tool-closure-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'tool-runtime/eas-cli/bin/run.mjs', "import '../dependency.mjs';\n");
  write(root, 'tool-runtime/eas-cli/dependency.mjs', "export const reviewed = 'v1';\n");
  write(root, 'tool-runtime/eas-cli/package.json', '{"name":"eas-cli","version":"99.1.0"}\n');

  const pin = {
    entryRelativePath: 'eas-cli/bin/run.mjs',
    nodeExecutableSha256: hash(readFileSync(process.execPath)),
    nodeVersion: process.version,
    packageJsonRelativePath: 'eas-cli/package.json',
    packageVersion: '99.1.0',
    runtimeRootRelativePath: 'tool-runtime',
    runtimeTreeSha256: computeRuntimeTreeSha256(join(root, 'tool-runtime')),
  };
  const encodedPin = Buffer.from(JSON.stringify(pin), 'utf8').toString('base64');
  assert.deepEqual(
    decodePinnedNodeToolAuthority(encodedPin, 'TOOL_MISSING', 'TOOL_INVALID'),
    pin,
  );
  const resolved = resolvePinnedNodeTool(root, pin, 'TOOL_MISSING', 'TOOL_INVALID');
  assert.equal(resolved.executable, join(root, 'tool-runtime/eas-cli/bin/run.mjs'));
  assert.equal(resolved.nodeExecutable, process.execPath);

  write(root, 'tool-runtime/eas-cli/dependency.mjs', "export const reviewed = 'drifted';\n");
  assert.throws(
    () => resolvePinnedNodeTool(root, pin, 'TOOL_MISSING', 'TOOL_INVALID'),
    /TOOL_INVALID/u,
  );
  write(root, 'tool-runtime/eas-cli/dependency.mjs', "export const reviewed = 'v1';\n");
  assert.throws(
    () => resolvePinnedNodeTool(root, {
      ...pin,
      nodeExecutableSha256: '0'.repeat(64),
    }, 'TOOL_MISSING', 'TOOL_INVALID'),
    /TOOL_INVALID/u,
  );
});

test('build and upload use unique private snapshots whose exact bytes survive Dropbox drift', async (t) => {
  const {
    computeTrackedSourceSha256,
    createPrivateBuildSnapshot,
    createPrivateUploadSnapshot,
    removePrivateOperationSnapshot,
    verifyPrivateBuildSnapshot,
    verifyPrivateUploadIpa,
  } = await import(guardPath);
  const sourceContainer = realpathSync(mkdtempSync(
    join(tmpdir(), 'cabohealth-release-snapshot-source-'),
  ));
  mkdirSync(join(sourceContainer, 'Dropbox/project'), { recursive: true });
  const root = realpathSync(join(sourceContainer, 'Dropbox/project'));
  const privateParent = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-snapshot-parent-')));
  t.after(() => rmSync(sourceContainer, { recursive: true, force: true }));
  t.after(() => rmSync(privateParent, { recursive: true, force: true }));
  const guardFixture = [
    'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
    'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
    'const RC_ATTESTATION_SHA256 = null;',
    'const PINNED_EAS_CLI = null;',
    'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
    "export const guardedBehavior = 'reviewed';",
    '',
  ].join('\n');
  write(root, 'scripts/release-command-guard.mjs', guardFixture);
  write(root, 'app.json', '{"expo":{"version":"3.0"}}\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'snapshot fixture');
  const expectedSourceSha256 = computeTrackedSourceSha256(root);

  assert.throws(() => createPrivateBuildSnapshot(root, expectedSourceSha256, {
    privateParent: join(sourceContainer, 'Dropbox'),
  }), /PRIVATE_BUILD_SNAPSHOT_INVALID/u);
  const build = createPrivateBuildSnapshot(root, expectedSourceSha256, { privateParent });
  assert.notEqual(build.operationRoot, root);
  assert.equal(build.operationRoot.startsWith(join(sourceContainer, 'Dropbox')), false);
  assert.equal((statSync(build.operationRoot).mode & 0o777), 0o700);
  assert.equal(readFileSync(join(build.workspaceRoot, 'app.json'), 'utf8'),
    '{"expo":{"version":"3.0"}}\n');
  write(root, 'app.json', '{"expo":{"version":"drifted"}}\n');
  assert.equal(readFileSync(join(build.workspaceRoot, 'app.json'), 'utf8'),
    '{"expo":{"version":"3.0"}}\n');
  assert.equal(verifyPrivateBuildSnapshot(build.workspaceRoot, expectedSourceSha256),
    expectedSourceSha256);
  writeFileSync(join(build.workspaceRoot, 'app.json'), '{"expo":{"version":"private drift"}}\n');
  assert.throws(
    () => verifyPrivateBuildSnapshot(build.workspaceRoot, expectedSourceSha256),
    /PRIVATE_BUILD_SNAPSHOT_INVALID/u,
  );
  removePrivateOperationSnapshot(build.operationRoot, { privateParent });
  assert.equal(existsSync(build.operationRoot), false);

  const ipa = join(root, 'CaboHealth.ipa');
  writeFileSync(ipa, 'reviewed ipa bytes', { mode: 0o600 });
  chmodSync(ipa, 0o600);
  const expectedIpaSha256 = hash(Buffer.from('reviewed ipa bytes'));
  const upload = createPrivateUploadSnapshot(ipa, expectedIpaSha256, { privateParent });
  assert.notEqual(upload.ipaPath, ipa);
  assert.equal((statSync(upload.ipaPath).mode & 0o777), 0o600);
  writeFileSync(ipa, 'Dropbox drift after private copy', { mode: 0o600 });
  assert.equal(verifyPrivateUploadIpa(upload.ipaPath, expectedIpaSha256), expectedIpaSha256);
  writeFileSync(upload.ipaPath, 'private drift', { mode: 0o600 });
  assert.throws(
    () => verifyPrivateUploadIpa(upload.ipaPath, expectedIpaSha256),
    /PRIVATE_UPLOAD_IPA_INVALID/u,
  );
  removePrivateOperationSnapshot(upload.operationRoot, { privateParent });
  assert.equal(existsSync(upload.operationRoot), false);
});

test('the executable Node tool closure is copied and rehashed inside the private operation', async (t) => {
  const {
    computeRuntimeTreeSha256,
    createPrivateUploadSnapshot,
    removePrivateOperationSnapshot,
    resolvePinnedNodeTool,
    snapshotPinnedNodeTool,
    verifyPrivateNodeToolSnapshot,
  } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-tool-source-')));
  const privateParent = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-tool-parent-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(privateParent, { recursive: true, force: true }));
  write(root, 'runtime/tool/bin/run.mjs', "import '../dependency.mjs';\n");
  write(root, 'runtime/tool/dependency.mjs', "export const value = 'reviewed';\n");
  write(root, 'runtime/tool/package.json', '{"version":"1.0.0"}\n');
  const pin = {
    entryRelativePath: 'tool/bin/run.mjs',
    nodeExecutableSha256: hash(readFileSync(process.execPath)),
    nodeVersion: process.version,
    packageJsonRelativePath: 'tool/package.json',
    packageVersion: '1.0.0',
    runtimeRootRelativePath: 'runtime',
    runtimeTreeSha256: computeRuntimeTreeSha256(join(root, 'runtime')),
  };
  const resolved = resolvePinnedNodeTool(root, pin, 'TOOL_MISSING', 'TOOL_INVALID');
  const ipa = join(root, 'fixture.ipa');
  writeFileSync(ipa, 'ipa', { mode: 0o600 });
  chmodSync(ipa, 0o600);
  const operation = createPrivateUploadSnapshot(ipa, hash(Buffer.from('ipa')), { privateParent });
  const privateTool = snapshotPinnedNodeTool(operation.operationRoot, resolved, pin);
  assert.ok(privateTool.executable.startsWith(operation.operationRoot));
  assert.ok(privateTool.nodeExecutable.startsWith(operation.operationRoot));
  const privateExecution = spawnSync(privateTool.nodeExecutable, [privateTool.executable], {
    encoding: 'utf8',
  });
  assert.equal(privateExecution.status, 0, privateExecution.stderr);

  write(root, 'runtime/tool/dependency.mjs', "export const value = 'Dropbox drift';\n");
  assert.deepEqual(verifyPrivateNodeToolSnapshot(privateTool, pin), privateTool);
  writeFileSync(privateTool.executable, 'private drift\n');
  assert.throws(
    () => verifyPrivateNodeToolSnapshot(privateTool, pin),
    /PRIVATE_TOOL_SNAPSHOT_INVALID/u,
  );
  removePrivateOperationSnapshot(operation.operationRoot, { privateParent });
});

test('the final adapter receives every exact ASC build identity and reviewed evidence binding', async () => {
  const { appStoreSubmitArguments } = await import(guardPath);
  const rcSha256 = 'a'.repeat(64);
  const rcAttestation = {
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '4',
    },
    buildArtifactAttestationSha256: 'b'.repeat(64),
    testFlightBuildId: '987654321',
    physicalIphoneQaSha256: 'c'.repeat(64),
    screenshotsManifestSha256: 'd'.repeat(64),
    appStoreMetadataEvidenceSha256: 'e'.repeat(64),
  };
  const authorization = { nonce: 'F'.repeat(32) };
  const args = appStoreSubmitArguments(projectRoot, {
    rcAttestation,
    rcAttestationSha256: rcSha256,
    authorization,
  });
  assert.deepEqual(args, [
    '--operation', 'submit-for-review',
    '--apple-id', '6758285327',
    '--bundle-identifier', 'com.cabohealth.app',
    '--marketing-version', '3.0',
    '--build-number', '4',
    '--testflight-build-id', '987654321',
    '--rc-attestation', join(projectRoot, 'release/app-store/3.0/rc-attestation.json'),
    '--rc-attestation-sha256', rcSha256,
    '--build-artifact-attestation', join(
      projectRoot,
      'release/app-store/3.0/build-artifact-attestation.json',
    ),
    '--build-artifact-attestation-sha256', 'b'.repeat(64),
    '--app-store-connect-evidence', join(
      projectRoot,
      'release/private/rc/app-store-connect-evidence.json',
    ),
    '--app-store-connect-evidence-sha256', 'e'.repeat(64),
    '--physical-iphone-qa', join(projectRoot, 'release/private/rc/physical-iphone-qa.json'),
    '--physical-iphone-qa-sha256', 'c'.repeat(64),
    '--screenshots-manifest', join(
      projectRoot,
      'release/app-store/3.0/screenshots-manifest.json',
    ),
    '--screenshots-manifest-sha256', 'd'.repeat(64),
    '--authorization-nonce', 'F'.repeat(32),
  ]);
});

test('release guard requires a recent one-time authorization bound to the reviewed RC', () => {
  const source = readFileSync(guardPath, 'utf8');
  assert.match(source, /SUBMIT_AUTHORIZATION_REQUIRED/u);
  assert.match(source, /authorization\.rcAttestationSha256 !== RC_ATTESTATION_SHA256/u);
  assert.match(source, /now - issuedAtMs > 10 \* 60 \* 1000/u);
  assert.match(source, /expiresAtMs - issuedAtMs > 10 \* 60 \* 1000/u);
  assert.match(source, /expiresAtMs - now > 10 \* 60 \* 1000/u);
  assert.match(source, /privateMode: 0o600/u);
  assert.match(source, /mode & 0o777\) !== privateMode/u);
  assert.match(source, /consumeAuthorizationNonce/u);
});

test('authorization validation rejects stale, overlong, wrong-RC, and replayed grants', async () => {
  const {
    confirmationChallengeForAuthorization,
    consumeAuthorizationNonce,
    validateAuthorization,
  } = await import(guardPath);
  const requestedRoot = join(tmpdir(), `cabohealth-release-authorization-${process.pid}-${Date.now()}`);
  mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  const root = realpathSync(requestedRoot);
  const store = join(root, 'release/private/submit-authorizations');
  mkdirSync(store, { recursive: true, mode: 0o700 });
  chmodSync(store, 0o700);
  const now = 1_800_000_000_000;
  const rc = 'a'.repeat(64);
  const valid = {
    schemaVersion: 1,
    action: 'submit-for-review',
    rcAttestationSha256: rc,
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 60_000,
    nonce: 'A'.repeat(32),
    confirmationMethod: 'codex-explicit-user-confirmation',
    identityAssurance: 'operational-only-not-cryptographic',
    confirmationChallenge: '',
  };
  valid.confirmationChallenge = confirmationChallengeForAuthorization(valid);

  assert.deepEqual(validateAuthorization(valid, {
    expectedAction: 'submit-for-review',
    expectedRcSha256: rc,
    now,
  }), valid);
  assert.throws(() => validateAuthorization({ ...valid, issuedAtMs: now - 600_001 }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);
  assert.throws(() => validateAuthorization({ ...valid, expiresAtMs: valid.issuedAtMs + 600_001 }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);
  assert.throws(() => validateAuthorization({ ...valid, rcAttestationSha256: 'b'.repeat(64) }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);
  assert.throws(() => validateAuthorization({ ...valid, confirmationChallenge: '0'.repeat(32) }, {
    expectedAction: 'submit-for-review', expectedRcSha256: rc, now,
  }), /SUBMIT_AUTHORIZATION_INVALID/u);

  const authorizationPath = join(root, 'authorization.json');
  writeFileSync(authorizationPath, `${JSON.stringify(valid)}\n`, { mode: 0o600 });
  chmodSync(authorizationPath, 0o600);
  consumeAuthorizationNonce({
    authorizationPath,
    authorization: valid,
    projectRoot: root,
  });
  writeFileSync(authorizationPath, `${JSON.stringify(valid)}\n`, { mode: 0o600 });
  chmodSync(authorizationPath, 0o600);
  assert.throws(() => consumeAuthorizationNonce({
    authorizationPath,
    authorization: valid,
    projectRoot: root,
  }), /SUBMIT_AUTHORIZATION_REPLAYED/u);
});

test('submission authorization is documented as an operational challenge, not identity proof', () => {
  const gates = readFileSync(
    join(projectRoot, 'release/app-store/3.0/submission-gates.md'),
    'utf8',
  );
  assert.match(gates, /cannot cryptographically authenticate Ivan's identity/iu);
  assert.match(gates, /Codex must ask Ivan.*separate explicit confirmation/isu);
  assert.match(gates, /confirmation challenge.*RC-bound/iu);
  assert.match(gates, /submit adapter pin remains `null`/iu);
});

test('phase attestations recompute tracked source and exact IPA bytes', async (t) => {
  const {
    computeTrackedSourceSha256,
    verifyBuildArtifactAttestation,
    verifyBuildInputAttestation,
  } = await import(guardPath);
  const requestedRoot = mkdtempSync(join(tmpdir(), 'cabohealth-release-phases-'));
  const root = realpathSync(requestedRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const initial = {
    '.gitignore': 'release/private/\n',
    'app.json': '{"expo":{"version":"3.0","ios":{"buildNumber":"4"}}}\n',
    'constants/config.ts': "export const version = '3.0';\nexport const buildNumber = '4';\n",
    'package-lock.json': '{"lockfileVersion":3}\n',
    'release/app-store/3.0/release-manifest.json': '{"status":"ready-for-build"}\n',
    'scripts/verify-release-v3.mjs': 'process.exitCode = 0;\n',
    'scripts/verify-app-store-metadata.mjs': 'process.exitCode = 0;\n',
    'scripts/release-command-guard.mjs': [
      'const BUILD_INPUT_ATTESTATION_SHA256 = null;',
      'const BUILD_ARTIFACT_ATTESTATION_SHA256 = null;',
      'const RC_ATTESTATION_SHA256 = null;',
      'const PINNED_EAS_CLI = null;',
      'const PINNED_APP_STORE_SUBMIT_ADAPTER = null;',
      "export const guardedBehavior = 'reviewed';",
      '',
    ].join('\n'),
    'release/app-store/3.0/build-input-attestation.json': '{}\n',
    'release/app-store/3.0/build-artifact-attestation.json': '{}\n',
    'release/app-store/3.0/rc-attestation.json': '{}\n',
  };
  for (const [path, value] of Object.entries(initial)) write(root, path, value);
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'fixture');

  const sourceTreeSha256 = computeTrackedSourceSha256(root);
  const buildInput = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-attestation',
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '4',
    },
    sourceTreeSha256,
    appJsonSha256: hash(readFileSync(join(root, 'app.json'))),
    configSha256: hash(readFileSync(join(root, 'constants/config.ts'))),
    packageLockSha256: hash(readFileSync(join(root, 'package-lock.json'))),
    releaseManifestSha256: hash(readFileSync(
      join(root, 'release/app-store/3.0/release-manifest.json'),
    )),
    releaseVerifierSha256: hash(readFileSync(join(root, 'scripts/verify-release-v3.mjs'))),
    metadataVerifierSha256: hash(readFileSync(
      join(root, 'scripts/verify-app-store-metadata.mjs'),
    )),
    reviewedAt: '2026-08-22T08:00:00.000Z',
  };
  const buildInputBytes = Buffer.from(`${JSON.stringify(buildInput)}\n`);
  write(root, 'release/app-store/3.0/build-input-attestation.json', buildInputBytes);
  git(root, 'add', 'release/app-store/3.0/build-input-attestation.json');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'pin build input');
  const buildInputSha256 = hash(buildInputBytes);
  assert.deepEqual(
    verifyBuildInputAttestation(root, buildInputSha256),
    buildInput,
  );

  const evidence = {
    'release/private/rc/CaboHealth-3.0-build-4.ipa': Buffer.from('exact ipa bytes'),
    'release/private/rc/signed-entitlements.plist': Buffer.from('<plist>exact</plist>'),
    'release/private/rc/privacy-report.json': Buffer.from('{"tracking":false}\n'),
  };
  for (const [path, value] of Object.entries(evidence)) write(root, path, value);
  for (const path of Object.keys(evidence)) chmodSync(join(root, path), 0o600);
  const buildArtifact = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-artifact-attestation',
    candidate: buildInput.candidate,
    buildInputAttestationSha256: buildInputSha256,
    sourceTreeSha256,
    easBuildId: '123e4567-e89b-42d3-a456-426614174000',
    ipaSha256: hash(evidence['release/private/rc/CaboHealth-3.0-build-4.ipa']),
    signedEntitlementsSha256: hash(evidence['release/private/rc/signed-entitlements.plist']),
    privacyReportSha256: hash(evidence['release/private/rc/privacy-report.json']),
    reviewedAt: '2026-08-22T09:00:00.000Z',
  };
  const buildArtifactBytes = Buffer.from(`${JSON.stringify(buildArtifact)}\n`);
  write(root, 'release/app-store/3.0/build-artifact-attestation.json', buildArtifactBytes);
  git(root, 'add', 'release/app-store/3.0/build-artifact-attestation.json');
  git(root, '-c', 'user.name=CaboHealth Test', '-c', 'user.email=test@example.invalid',
    'commit', '-qm', 'pin build artifact');
  const buildArtifactSha256 = hash(buildArtifactBytes);
  assert.deepEqual(verifyBuildArtifactAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
  }), buildArtifact);

  write(root, 'release/private/rc/CaboHealth-3.0-build-4.ipa', 'drifted ipa bytes');
  assert.throws(() => verifyBuildArtifactAttestation(root, {
    buildInputSha256,
    buildArtifactSha256,
  }), /EXACT_BUILD_ARTIFACT_ATTESTATION_INVALID/u);

  write(root, 'app.json', '{"expo":{"version":"9.9"}}\n');
  assert.throws(
    () => verifyBuildInputAttestation(root, buildInputSha256),
    /BUILD_SOURCE_NOT_CLEAN|EXACT_BUILD_INPUT_ATTESTATION_INVALID/u,
  );
});

test('the pinned CLI runner receives the exact build and local-IPA upload arguments', async (t) => {
  const { easArgumentsForAction, executeNodeProgram } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeCli = join(root, 'fake-eas.mjs');
  const output = join(root, 'argv.json');
  writeFileSync(fakeCli, [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.CABOHEALTH_FAKE_EAS_OUTPUT, JSON.stringify(process.argv.slice(2)));",
  ].join('\n'));
  const previous = process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
  process.env.CABOHEALTH_FAKE_EAS_OUTPUT = output;
  t.after(() => {
    if (previous === undefined) delete process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
    else process.env.CABOHEALTH_FAKE_EAS_OUTPUT = previous;
  });

  const buildArgs = easArgumentsForAction('build');
  executeNodeProgram(root, fakeCli, buildArgs, 'EAS');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), buildArgs);

  const privateIpaPath = join(root, 'private-upload/CaboHealth-3.0-build-4.ipa');
  const uploadArgs = easArgumentsForAction('upload-testflight', { ipaPath: privateIpaPath });
  executeNodeProgram(root, fakeCli, uploadArgs, 'EAS');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), [
    'submit',
    '--platform', 'ios',
    '--path', privateIpaPath,
    '--non-interactive',
  ]);
  assert.ok(!uploadArgs.includes('--id'));
});

test('the pinned Node runner removes preload and module-path injection variables', async (t) => {
  const { executeNodeProgram } = await import(guardPath);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-release-clean-env-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeCli = join(root, 'capture-env.mjs');
  const output = join(root, 'env.json');
  writeFileSync(fakeCli, [
    "import { writeFileSync } from 'node:fs';",
    "const keys = ['NODE_OPTIONS','NODE_PATH','npm_config_node_options','DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH','LD_PRELOAD','LD_LIBRARY_PATH'];",
    "writeFileSync(process.env.CABOHEALTH_FAKE_EAS_OUTPUT, JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));",
  ].join('\n'));
  const keys = [
    'NODE_OPTIONS',
    'NODE_PATH',
    'npm_config_node_options',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousOutput = process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
  for (const key of keys) process.env[key] = '/unreviewed/injection';
  process.env.CABOHEALTH_FAKE_EAS_OUTPUT = output;
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (previousOutput === undefined) delete process.env.CABOHEALTH_FAKE_EAS_OUTPUT;
    else process.env.CABOHEALTH_FAKE_EAS_OUTPUT = previousOutput;
  });

  executeNodeProgram(root, fakeCli, [], 'Pinned tool');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')),
    Object.fromEntries(keys.map((key) => [key, null])));
});
