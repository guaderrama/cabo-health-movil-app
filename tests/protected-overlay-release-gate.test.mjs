import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { once } from 'node:events';

import {
  createProtectedOverlayActivationPlan,
  createProtectedOverlayArtifact,
  createProtectedOverlayDeploymentEvidence,
  createProtectedOverlayDeploymentEvidenceRequest,
  deactivateFirstProtectedOverlays,
  promoteProtectedOverlays,
  rollbackProtectedOverlays,
  verifyProtectedOverlayActivationPlan,
  verifyProtectedOverlayArtifact,
  verifyProtectedOverlayAbsence,
  verifyProtectedOverlayDeployment,
} from '../scripts/protected-overlay-release-gate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function publishResumeSignal(path) {
  const candidatePath = `${path}.candidate-${process.pid}`;
  writeFileSync(candidatePath, 'resume\n', { flag: 'wx', mode: 0o600 });
  renameSync(candidatePath, path);
}

test('package exposes the protected overlay operator gate without deploying', () => {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['protected-overlays:release'],
    'node scripts/protected-overlay-release.mjs',
  );
});

const expectedFiles = Object.freeze({
  production: Object.freeze([
    '.htaccess',
    'api/resources/index.php',
    'api/session/index.php',
    'app.js',
    'client-resources-api.js',
    'index.html',
    'launch/index.php',
    'lib/runtime.php',
    'styles.css',
  ]),
  review: Object.freeze([
    '.htaccess',
    'launch/index.php',
    'lib/runtime.php',
    'session/end/index.php',
    'styles.css',
  ]),
});

test('one immutable artifact contains the exact public inventories for both isolated broker realms', () => {
  const first = createProtectedOverlayArtifact({ projectRoot });
  const second = createProtectedOverlayArtifact({ projectRoot });

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.artifactKind, 'cabohealth-protected-hostinger-overlays-v1');
  assert.match(first.releaseId, /^protected-overlays-v1-[a-f0-9]{64}$/u);
  assert.match(first.inventorySha256, /^[a-f0-9]{64}$/u);
  assert.match(first.artifactSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(first.promoteTargets, [
    'public_html/apps/client-resources',
    'public_html/apps/app-review',
  ]);

  assert.deepEqual(first.realms.map((realm) => realm.realm), ['production', 'review']);
  for (const realm of first.realms) {
    assert.deepEqual(realm.files.map((file) => file.path), expectedFiles[realm.realm]);
    for (const file of realm.files) {
      const bytes = Buffer.from(file.bytesBase64, 'base64');
      assert.equal(bytes.length, file.size);
      assert.match(file.sha256, /^[a-f0-9]{64}$/u);
      assert.equal(file.deployMode, '0644');
    }
  }

  const production = first.realms[0];
  const review = first.realms[1];
  assert.deepEqual(production.brokerIdentity, {
    functionName: 'brokerApi',
    signatureDomain: 'cabohealth-broker-v1',
    responseSignatureDomain: 'cabohealth-broker-response-v1',
    cookieName: '__Secure-cabohealth_client',
  });
  assert.deepEqual(review.brokerIdentity, {
    functionName: 'appReviewBrokerApi',
    signatureDomain: 'cabohealth-app-review-broker-v1',
    responseSignatureDomain: 'cabohealth-app-review-broker-response-v1',
    cookieName: '__Secure-cabohealth_app_review',
  });
  assert.notDeepEqual(production.brokerIdentity, review.brokerIdentity);

  for (const realm of first.realms) {
    assert.equal(realm.externalInputs.status, 'required-outside-docroot');
    assert.match(realm.externalInputs.configSchema.sha256, /^[a-f0-9]{64}$/u);
    assert.equal('brokerConfig' in realm.externalInputs, false);
    assert.equal('privateContent' in realm.externalInputs, false);
  }
  const artifactPaths = first.realms.flatMap((realm) => realm.files.map((file) => file.path));
  assert.equal(artifactPaths.some((path) => path.includes('-private/')), false);
});

test('artifact verification pins exact bytes, security headers, and distinct broker identities', (context) => {
  const fixture = makeProjectFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot: fixture });
  const pins = {
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
  };

  assert.deepEqual(verifyProtectedOverlayArtifact({
    artifact,
    projectRoot: fixture,
    ...pins,
  }), artifact);

  const tampered = structuredClone(artifact);
  tampered.realms[0].files[0].bytesBase64 = Buffer.from('weakened').toString('base64');
  assert.throws(
    () => verifyProtectedOverlayArtifact({ artifact: tampered, projectRoot: fixture, ...pins }),
    /protected_overlay_artifact_invalid/u,
  );

  const reviewHeadersPath = join(
    fixture,
    'web-hosting/cabohealth.org/apps/app-review/.htaccess',
  );
  writeFileSync(
    reviewHeadersPath,
    readFileSync(reviewHeadersPath, 'utf8').replace(
      'Header always set X-Frame-Options "DENY"',
      'Header always set X-Frame-Options "SAMEORIGIN"',
    ),
  );
  assert.throws(
    () => createProtectedOverlayArtifact({ projectRoot: fixture }),
    /protected_overlay_headers_invalid/u,
  );
});

test('artifact inventory rejects unreviewed files and empty directories', (context) => {
  const fixture = makeProjectFixture();
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const productionRoot = join(
    fixture,
    'web-hosting/cabohealth.org/apps/client-resources',
  );
  mkdirSync(join(productionRoot, 'unreviewed-empty-directory'));
  assert.throws(
    () => createProtectedOverlayArtifact({ projectRoot: fixture }),
    /protected_overlay_inventory_invalid/u,
  );
  writeFileSync(join(productionRoot, 'unreviewed-empty-directory/payload.txt'), 'not reviewed\n');
  assert.throws(
    () => createProtectedOverlayArtifact({ projectRoot: fixture }),
    /protected_overlay_inventory_invalid/u,
  );
});

test('activation pins distinct external private inputs without copying their bytes into evidence', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  assert.throws(() => createProtectedOverlayActivationPlan({
    deploymentRoot: fixture.root,
    realms: fixture.realms,
    trustPolicy: fixture.trustPolicy,
  }), /protected_overlay_trust_policy_pin_required/u);

  const activation = createActivation(fixture);
  assert.equal(activation.artifactKind, 'cabohealth-protected-overlay-activation-v1');
  assert.match(activation.activationSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(activation.realms.map(({ realm }) => realm), ['production', 'review']);
  assert.deepEqual(activation.realms.map(({ runtimeIdentity }) => runtimeIdentity), [
    fixture.trustPolicy.realms[0].runtimeIdentity,
    fixture.trustPolicy.realms[1].runtimeIdentity,
  ]);
  assert.notEqual(
    fixture.trustPolicy.realms[0].attestationPublicKeyDerBase64,
    fixture.trustPolicy.realms[1].attestationPublicKeyDerBase64,
  );
  assert.deepEqual(verifyProtectedOverlayActivationPlan({
    activation,
    deploymentRoot: fixture.root,
    expectedActivationSha256: activation.activationSha256,
    expectedTrustPolicySha256: fixture.trustPolicySha256,
    trustPolicy: fixture.trustPolicy,
  }), activation);

  const serialized = JSON.stringify(activation);
  assert.doesNotMatch(serialized, /exclusive production content|fixed review sample/u);
  assert.equal(serialized.includes(fixture.secrets.production), false);
  assert.equal(serialized.includes(fixture.secrets.review), false);

  const productionConfig = JSON.parse(readFileSync(
    fixture.realms.production.brokerConfigPath,
    'utf8',
  ));
  const reviewConfigPath = fixture.realms.review.brokerConfigPath;
  const reviewConfig = JSON.parse(readFileSync(reviewConfigPath, 'utf8'));
  reviewConfig.hmacKeyBase64 = productionConfig.hmacKeyBase64;
  writeFileSync(reviewConfigPath, `${JSON.stringify(reviewConfig)}\n`, { mode: 0o600 });
  chmodSync(reviewConfigPath, 0o600);
  assert.throws(
    () => createActivation(fixture),
    /protected_overlay_broker_identity_invalid/u,
  );
});

test('activation rejects symlinked private inputs even when their targets are outside docroot', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const production = fixture.realms.production;
  const symlinkPath = join(dirname(production.brokerConfigPath), 'broker-config-link.json');
  symlinkSync(production.brokerConfigPath, symlinkPath);
  production.brokerConfigPath = symlinkPath;

  assert.throws(() => createActivation(fixture), /protected_overlay_private_input_invalid/u);

  production.brokerConfigPath = resolve(production.brokerConfigPath, '..', 'broker-config.json');
  const contentSymlinkPath = join(dirname(production.privateContentRoot), 'content-link');
  symlinkSync(production.privateContentRoot, contentSymlinkPath);
  production.privateContentRoot = contentSymlinkPath;
  assert.throws(() => createActivation(fixture), /protected_overlay_directory_invalid/u);
});

test('activation rejects hard-linked private inputs', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const target = fixture.realms.production.brokerConfigPath;
  const hardlink = join(dirname(target), 'broker-config-hardlink.json');
  linkSync(target, hardlink);
  fixture.realms.production.brokerConfigPath = hardlink;

  assert.throws(() => createActivation(fixture), /protected_overlay_private_input_invalid/u);
});

test('CLI activation rejects a private inode substituted between validation and reading', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const inputsPath = join(fixture.root, 'raced-inputs.json');
  const trustPolicyPath = join(fixture.root, 'raced-trust-policy.json');
  const outputPath = join(fixture.root, 'must-not-exist-activation.json');
  const preloadPath = join(fixture.root, 'swap-private-input.cjs');
  const target = fixture.realms.production.brokerConfigPath;
  const replacement = join(dirname(target), 'broker-config-replacement.json');
  const backup = join(dirname(target), 'broker-config-reviewed.json');
  writeFileSync(replacement, readFileSync(target), { mode: 0o600 });
  chmodSync(replacement, 0o600);
  for (const [path, value] of [
    [inputsPath, { realms: fixture.realms }],
    [trustPolicyPath, fixture.trustPolicy],
  ]) {
    writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o400 });
    chmodSync(path, 0o400);
  }
  writeSwapAfterLstatPreload(preloadPath);

  const result = runCli([
    'create-activation',
    '--deployment-root', fixture.root,
    '--inputs', inputsPath,
    '--out', outputPath,
    '--trust-policy', trustPolicyPath,
    '--trust-policy-sha256', fixture.trustPolicySha256,
  ], {
    NODE_OPTIONS: `--require=${preloadPath}`,
    CABOHEALTH_TEST_SWAP_TARGET: target,
    CABOHEALTH_TEST_SWAP_REPLACEMENT: replacement,
    CABOHEALTH_TEST_SWAP_BACKUP: backup,
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /protected_overlay_private_input_invalid/u);
  assert.equal(existsSync(outputPath), false);
});

test('activation rejects a factory that only names the authorized adapter contract in comments', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const productionFactory = fixture.realms.production.backendFactoryPath;
  writeFileSync(productionFactory, `<?php

declare(strict_types=1);

// CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG
// SignedFunctionsClientResourcesBackend::fromPrivateConfigFile
return static function (): ClientResourcesBackend {
    throw new RuntimeException('attacker-controlled factory');
};
`, { mode: 0o600 });
  chmodSync(productionFactory, 0o600);

  assert.throws(() => createActivation(fixture), /protected_overlay_backend_factory_invalid/u);
});

test('activation rejects an otherwise valid Functions host outside the pinned realm project', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const path = fixture.realms.production.brokerConfigPath;
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.baseUrl = 'https://us-central1-attacker-owned-prod.cloudfunctions.net/brokerApi';
  config.expectedHost = 'us-central1-attacker-owned-prod.cloudfunctions.net';
  writeFileSync(path, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  assert.throws(() => createActivation(fixture), /protected_overlay_config_invalid/u);
});

test('activation rejects unapproved web and PHP CLI runtime identities', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  for (const realm of fixture.trustPolicy.realms) {
    realm.runtimeIdentity.phpSapi = 'litespeed';
  }
  fixture.trustPolicySha256 = sha256Json(fixture.trustPolicy);
  assert.deepEqual(
    createActivation(fixture).realms.map(({ runtimeIdentity }) => runtimeIdentity.phpSapi),
    ['litespeed', 'litespeed'],
  );

  for (const phpSapi of ['cli', 'cgi-fcgi', 'lsapi', 'LITESPEED']) {
    fixture.trustPolicy.realms[0].runtimeIdentity.phpSapi = phpSapi;
    fixture.trustPolicySha256 = sha256Json(fixture.trustPolicy);
    assert.throws(() => createActivation(fixture), /protected_overlay_trust_policy_invalid/u);
  }

  fixture.trustPolicy.realms[0].runtimeIdentity.phpSapi = 'fpm-fcgi';
  fixture.trustPolicy.realms[0].runtimeIdentity.phpCliVersionId = 80199;
  fixture.trustPolicySha256 = sha256Json(fixture.trustPolicy);
  assert.throws(() => createActivation(fixture), /protected_overlay_trust_policy_invalid/u);

  fixture.trustPolicy.realms[0].runtimeIdentity.phpCliVersionId = 80301;
  fixture.trustPolicy.realms[0].runtimeIdentity.documentRoot = join(fixture.root, 'decoy-html');
  fixture.trustPolicySha256 = sha256Json(fixture.trustPolicy);
  assert.throws(() => createActivation(fixture), /protected_overlay_runtime_identity_invalid/u);
});

test('the pinned Hostinger attestor derives signed evidence from runtime measurements', () => {
  const path = join(projectRoot, 'tools/hosting/protected-overlay-attestor.php');
  const source = readFileSync(path);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    'c509d78a0c4696f36ba86543b7236142e4c241b14990921b912b0c60cc336c68',
  );
  const text = source.toString('utf8');
  assert.match(text, /getenv\(\$name\)/u);
  assert.match(text, /attestor_measure_file/u);
  assert.match(text, /fopen/u);
  assert.match(text, /fstat/u);
  assert.match(text, /proc_open/u);
  assert.match(text, /sodium_crypto_sign_detached/u);
  assert.match(text, /CABOHEALTH_PROTECTED_OVERLAY_PHP_CLI/u);
  assert.match(text, /PROTECTED_OVERLAY_PINNED_PHP_CLI\s*=\s*'\/proc\/self\/fd\/3'/u);
  assert.equal((text.match(/3\s*=>\s*\$phpCli\['handle'\]/gu) ?? []).length, 2);
  assert.doesNotMatch(text, /proc_open\(\s*\[PHP_BINARY/u);
  assert.equal((text.match(/PROTECTED_OVERLAY_CHILD_ENVIRONMENT/gu) ?? []).length, 3);
  assert.match(text, /\['LANG'\s*=>\s*'C',\s*'LC_ALL'\s*=>\s*'C'\]/u);
  assert.doesNotMatch(text, /file_get_contents/u);
  assert.doesNotMatch(text, /hash_file/u);
  assert.doesNotMatch(text, /--result/u);
});

test('Hostinger attestor rejects environment B, a non-PHP CLI, and cross-realm CLI drift', (context) => {
  if (process.platform !== 'linux') {
    context.skip('The Hostinger descriptor-bound CLI proof requires Linux /proc/self/fd.');
    return;
  }
  const version = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
  if (version.error?.code === 'ENOENT') {
    context.skip('PHP is not installed; CI and Hostinger must execute the attestor mismatch proof.');
    return;
  }
  assert.equal(version.status, 0, version.stderr);
  const sodium = spawnSync('php', ['-r', 'echo extension_loaded("sodium") ? "yes" : "no";'], {
    encoding: 'utf8',
  });
  if (sodium.status !== 0 || sodium.stdout !== 'yes') {
    context.skip('PHP Sodium is unavailable; CI and Hostinger must execute the attestor proofs.');
    return;
  }
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(fixture);
  const request = structuredClone(createDeploymentEvidence(fixture, artifact, activation).request);
  request.realms[0].runtimeIdentity.phpSapi = 'cli';
  const requestPath = join(fixture.root, 'attestor-request.json');
  const outputPath = join(fixture.root, 'must-not-exist.json');
  writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { mode: 0o400 });
  chmodSync(requestPath, 0o400);

  const result = spawnSync('php', [
    join(projectRoot, 'tools/hosting/protected-overlay-attestor.php'),
    '--request', requestPath,
    '--realm', 'production',
    '--project-root', projectRoot,
    '--out', outputPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCUMENT_ROOT: join(fixture.root, 'public_html'),
      CABOHEALTH_CLIENT_RESOURCES_BACKEND_FACTORY:
        fixture.realms.review.backendFactoryPath,
      CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG:
        fixture.realms.production.brokerConfigPath,
      CABOHEALTH_CLIENT_RESOURCES_PRIVATE_CONTENT_ROOT:
        fixture.realms.production.privateContentRoot,
      CABOHEALTH_PROTECTED_OVERLAY_PHP_CLI:
        request.realms[0].runtimeIdentity.phpCliPath,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /protected_overlay_attestor_environment_mismatch/u);
  assert.equal(existsSync(outputPath), false);

  const nonPhp = spawnSync('php', [
    join(projectRoot, 'tools/hosting/protected-overlay-attestor.php'),
    '--request', requestPath,
    '--realm', 'production',
    '--project-root', projectRoot,
    '--out', outputPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCUMENT_ROOT: join(fixture.root, 'public_html'),
      CABOHEALTH_CLIENT_RESOURCES_BACKEND_FACTORY:
        fixture.realms.production.backendFactoryPath,
      CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG:
        fixture.realms.production.brokerConfigPath,
      CABOHEALTH_CLIENT_RESOURCES_PRIVATE_CONTENT_ROOT:
        fixture.realms.production.privateContentRoot,
      CABOHEALTH_PROTECTED_OVERLAY_PHP_CLI:
        request.realms[0].runtimeIdentity.phpCliPath,
    },
  });
  assert.notEqual(nonPhp.status, 0);
  assert.match(nonPhp.stderr, /protected_overlay_attestor_php_cli_invalid/u);
  assert.equal(existsSync(outputPath), false);

  const crossRealmCli = spawnSync('php', [
    join(projectRoot, 'tools/hosting/protected-overlay-attestor.php'),
    '--request', requestPath,
    '--realm', 'production',
    '--project-root', projectRoot,
    '--out', outputPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCUMENT_ROOT: join(fixture.root, 'public_html'),
      CABOHEALTH_PROTECTED_OVERLAY_PHP_CLI:
        request.realms[1].runtimeIdentity.phpCliPath,
    },
  });
  assert.notEqual(crossRealmCli.status, 0);
  assert.match(crossRealmCli.stderr, /protected_overlay_attestor_runtime_mismatch/u);
  assert.equal(existsSync(outputPath), false);

  const phpBinary = spawnSync('php', ['-r', 'echo realpath(PHP_BINARY);'], { encoding: 'utf8' });
  assert.equal(phpBinary.status, 0, phpBinary.stderr);
  const phpBinaryPath = phpBinary.stdout;
  const phpBinaryStat = statSync(phpBinaryPath);
  if ((phpBinaryStat.mode & 0o777) !== 0o755 || phpBinaryStat.nlink !== 1) {
    context.skip('The local PHP CLI is not an exact mode-0755 single-link binary.');
    return;
  }
  const phpBinaryBytes = readFileSync(phpBinaryPath);
  Object.assign(request.realms[0].runtimeIdentity, {
    phpCliMode: '0755',
    phpCliOwnerUid: phpBinaryStat.uid,
    phpCliPath: phpBinaryPath,
    phpCliSha256: createHash('sha256').update(phpBinaryBytes).digest('hex'),
    phpCliSize: phpBinaryBytes.length,
    phpCliVersionId: Number(version.stdout),
  });
  chmodSync(requestPath, 0o600);
  writeFileSync(requestPath, `${JSON.stringify(request)}\n`);
  chmodSync(requestPath, 0o400);
  const sanitizedChild = spawnSync('php', [
    join(projectRoot, 'tools/hosting/protected-overlay-attestor.php'),
    '--request', requestPath,
    '--realm', 'production',
    '--project-root', projectRoot,
    '--out', outputPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCUMENT_ROOT: join(fixture.root, 'public_html'),
      CABOHEALTH_ATTESTOR_SENTINEL_SECRET: 'must-not-reach-child',
      CABOHEALTH_CLIENT_RESOURCES_BACKEND_FACTORY:
        fixture.realms.production.backendFactoryPath,
      CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG:
        fixture.realms.production.brokerConfigPath,
      CABOHEALTH_CLIENT_RESOURCES_PRIVATE_CONTENT_ROOT:
        fixture.realms.production.privateContentRoot,
      CABOHEALTH_PROTECTED_OVERLAY_PHP_CLI: phpBinaryPath,
    },
  });
  assert.notEqual(sanitizedChild.status, 0);
  assert.match(sanitizedChild.stderr, /protected_overlay_attestor_key_invalid/u);
  assert.doesNotMatch(sanitizedChild.stderr, /protected_overlay_attestor_harness_failed/u);
  assert.equal(existsSync(outputPath), false);
});

test('signed evidence rejects SAPI, document-root, PHP CLI, version, and cross-realm drift', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(fixture);
  const { request } = createDeploymentEvidence(fixture, artifact, activation);

  for (const runtimeIdentity of [
    { ...request.realms[0].runtimeIdentity, phpSapi: 'cli' },
    { ...request.realms[0].runtimeIdentity, documentRoot: join(fixture.root, 'decoy-html') },
    {
      ...request.realms[0].runtimeIdentity,
      phpCliPath: join(fixture.root, 'private', 'wrong-php-cli'),
    },
    { ...request.realms[0].runtimeIdentity, phpCliVersionId: 80499 },
    request.realms[1].runtimeIdentity,
  ]) {
    const realm = request.realms[0];
    const result = deploymentEvidenceResult(realm, runtimeIdentity);
    const signed = {
      schemaVersion: 1,
      attestationKind: 'cabohealth-protected-overlay-hostinger-attestation-v1',
      request: realm,
      result,
    };
    const production = {
      realm: 'production',
      result,
      signatureBase64: signPayload(
        null,
        Buffer.from(`cabohealth-protected-overlay-hostinger-attestation-v1\n${JSON.stringify(signed)}`),
        fixture.attestationKeys.production.privateKey,
      ).toString('base64'),
    };
    const validReview = signedAttestation(
      request.realms[1],
      fixture.attestationKeys.review.privateKey,
    );
    assert.throws(() => createProtectedOverlayDeploymentEvidence({
      attestations: { production, review: validReview },
      evidenceRequest: request,
      expectedTrustPolicySha256: fixture.trustPolicySha256,
      trustPolicy: fixture.trustPolicy,
    }), /protected_overlay_evidence_invalid/u);
  }
});

test('a first protected release deactivates durably to verified absence and can be promoted again', (context) => {
  const deployment = makeDeploymentFixture();
  context.after(() => rmSync(deployment.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(deployment);
  const evidence = createDeploymentEvidence(deployment, artifact, activation).evidence;
  const deploymentArguments = {
    activation,
    artifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(artifact),
    ...securityPins(deployment, evidence),
  };
  promoteProtectedOverlays(deploymentArguments);

  const deactivationArguments = {
    activation,
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentEvidenceSha256: evidence.evidenceSha256,
    expectedCurrentReleaseId: artifact.releaseId,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    trustPolicy: deployment.trustPolicy,
  };
  const expectedResult = {
    status: 'deactivated',
    deactivatedReleaseId: artifact.releaseId,
    restoredReleaseId: 'absent',
  };
  assert.throws(() => deactivateFirstProtectedOverlays({
    ...deactivationArguments,
    expectedCurrentEvidenceSha256: '0'.repeat(64),
  }), /protected_overlay_predecessor_mismatch/u);
  assert.equal(verifyProtectedOverlayDeployment(deploymentArguments).status, 'verified');
  assert.deepEqual(deactivateFirstProtectedOverlays(deactivationArguments), expectedResult);
  assert.equal(
    existsSync(join(deployment.root, '.cabohealth-protected-overlays/state.json')),
    false,
  );
  for (const realm of artifact.realms) {
    assert.equal(existsSync(join(deployment.root, ...realm.promoteTarget.split('/'))), false);
    const archivedRoot = join(
      deployment.root,
      '.cabohealth-protected-overlays/candidates',
      artifact.releaseId,
      realm.realm,
    );
    assert.deepEqual(
      realm.files.map((file) => readFileSync(join(archivedRoot, ...file.path.split('/')))),
      realm.files.map((file) => Buffer.from(file.bytesBase64, 'base64')),
    );
  }
  assert.deepEqual(verifyProtectedOverlayAbsence({
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentEvidenceSha256: evidence.evidenceSha256,
    expectedCurrentReleaseId: artifact.releaseId,
  }), {
    status: 'verified-absent',
    releaseId: artifact.releaseId,
    artifactSha256: artifact.artifactSha256,
    activationSha256: activation.activationSha256,
    evidenceSha256: evidence.evidenceSha256,
  });
  assert.throws(() => verifyProtectedOverlayAbsence({
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentEvidenceSha256: '0'.repeat(64),
    expectedCurrentReleaseId: artifact.releaseId,
  }), /protected_overlay_absence_invalid/u);
  assert.deepEqual(deactivateFirstProtectedOverlays(deactivationArguments), expectedResult);

  assert.deepEqual(promoteProtectedOverlays(deploymentArguments), {
    status: 'promoted',
    currentReleaseId: artifact.releaseId,
    predecessorReleaseId: 'absent',
  });
  assert.equal(verifyProtectedOverlayDeployment(deploymentArguments).status, 'verified');
});

test('verified absence rejects a superseded deactivation receipt for the same release bytes', (context) => {
  const deployment = makeDeploymentFixture();
  context.after(() => rmSync(deployment.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activationA = createActivation(deployment);
  const evidenceA = createDeploymentEvidence(deployment, artifact, activationA).evidence;
  const deploymentArgumentsA = {
    activation: activationA,
    artifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activationA.activationSha256,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(artifact),
    ...securityPins(deployment, evidenceA),
  };
  promoteProtectedOverlays(deploymentArgumentsA);
  deactivateFirstProtectedOverlays({
    activation: activationA,
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activationA.activationSha256,
    expectedCurrentEvidenceSha256: evidenceA.evidenceSha256,
    expectedCurrentReleaseId: artifact.releaseId,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    trustPolicy: deployment.trustPolicy,
  });

  writeFileSync(
    join(deployment.realms.production.privateContentRoot, 'en.json'),
    '{"value":"rotated exclusive production content"}\n',
  );
  const activationB = createActivation(deployment);
  const evidenceB = createDeploymentEvidence(deployment, artifact, activationB).evidence;
  const deploymentArgumentsB = {
    activation: activationB,
    artifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activationB.activationSha256,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(artifact),
    ...securityPins(deployment, evidenceB),
  };
  promoteProtectedOverlays(deploymentArgumentsB);
  deactivateFirstProtectedOverlays({
    activation: activationB,
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activationB.activationSha256,
    expectedCurrentEvidenceSha256: evidenceB.evidenceSha256,
    expectedCurrentReleaseId: artifact.releaseId,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    trustPolicy: deployment.trustPolicy,
  });

  assert.throws(() => verifyProtectedOverlayAbsence({
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activationA.activationSha256,
    expectedCurrentEvidenceSha256: evidenceA.evidenceSha256,
    expectedCurrentReleaseId: artifact.releaseId,
  }), /protected_overlay_absence_invalid/u);
  assert.equal(verifyProtectedOverlayAbsence({
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activationB.activationSha256,
    expectedCurrentEvidenceSha256: evidenceB.evidenceSha256,
    expectedCurrentReleaseId: artifact.releaseId,
  }).status, 'verified-absent');
});

test('deactivate-first rejects a contaminated private candidate without moving live bytes', (context) => {
  const deployment = makeDeploymentFixture();
  const outside = mkdtempSync(join(tmpdir(), 'cabohealth-protected-deactivation-outside-'));
  context.after(() => {
    rmSync(deployment.root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(deployment);
  const evidence = createDeploymentEvidence(deployment, artifact, activation).evidence;
  const deploymentArguments = {
    activation,
    artifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(artifact),
    ...securityPins(deployment, evidence),
  };
  promoteProtectedOverlays(deploymentArguments);
  const candidateRoot = join(
    deployment.root,
    '.cabohealth-protected-overlays/candidates',
    artifact.releaseId,
  );
  symlinkSync(outside, join(candidateRoot, 'production'));

  assert.throws(() => deactivateFirstProtectedOverlays({
    activation,
    currentPins: artifactPins(artifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentEvidenceSha256: evidence.evidenceSha256,
    expectedCurrentReleaseId: artifact.releaseId,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    trustPolicy: deployment.trustPolicy,
  }), /protected_overlay_candidate_collision/u);
  assert.equal(verifyProtectedOverlayDeployment(deploymentArguments).status, 'verified');
  assert.equal(existsSync(join(outside, 'production')), false);
});

test('promotion fails closed before mutation and then installs both exact public overlays', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(fixture);
  const { evidence, request } = createDeploymentEvidence(fixture, artifact, activation);
  const pins = {
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
    expectedActivationSha256: activation.activationSha256,
    ...securityPins(fixture, evidence),
  };
  const invalidEvidence = structuredClone(evidence);
  const forgedSigned = {
    schemaVersion: 1,
    attestationKind: 'cabohealth-protected-overlay-hostinger-attestation-v1',
    request: request.realms[0],
    result: invalidEvidence.attestations[0].result,
  };
  invalidEvidence.attestations[0].signatureBase64 = signPayload(
    null,
    Buffer.from(`cabohealth-protected-overlay-hostinger-attestation-v1\n${JSON.stringify(forgedSigned)}`),
    fixture.attestationKeys.review.privateKey,
  ).toString('base64');
  invalidEvidence.evidenceSha256 = sha256Json({
    schemaVersion: invalidEvidence.schemaVersion,
    evidenceKind: invalidEvidence.evidenceKind,
    requestSha256: invalidEvidence.requestSha256,
    attestations: invalidEvidence.attestations,
  });

  assert.throws(() => promoteProtectedOverlays({
    ...pins,
    activation,
    artifact,
    evidence: invalidEvidence,
    expectedEvidenceSha256: invalidEvidence.evidenceSha256,
    deploymentRoot: fixture.root,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
  }), /protected_overlay_evidence_invalid/u);
  for (const realm of artifact.realms) {
    assert.equal(existsSync(join(fixture.root, ...realm.promoteTarget.split('/'))), false);
  }

  assert.deepEqual(promoteProtectedOverlays({
    activation,
    artifact,
    deploymentRoot: fixture.root,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...pins,
  }), {
    status: 'promoted',
    currentReleaseId: artifact.releaseId,
    predecessorReleaseId: 'absent',
  });
  assert.deepEqual(verifyProtectedOverlayDeployment({
    activation,
    artifact,
    deploymentRoot: fixture.root,
    projectRoot,
    ...pins,
  }), {
    status: 'verified',
    releaseId: artifact.releaseId,
    artifactSha256: artifact.artifactSha256,
    activationSha256: activation.activationSha256,
    evidenceSha256: evidence.evidenceSha256,
  });
  for (const realm of artifact.realms) {
    const liveRoot = join(fixture.root, ...realm.promoteTarget.split('/'));
    assert.deepEqual(
      realm.files.map((file) => readFileSync(join(liveRoot, ...file.path.split('/')))),
      realm.files.map((file) => Buffer.from(file.bytesBase64, 'base64')),
    );
    assert.equal(existsSync(join(liveRoot, 'broker-config.json')), false);
    assert.equal(existsSync(join(liveRoot, 'sample.json')), false);
    assert.equal(existsSync(join(liveRoot, 'en.json')), false);
  }
  const statePath = join(fixture.root, '.cabohealth-protected-overlays/state.json');
  writeFileSync(statePath, ` ${readFileSync(statePath, 'utf8')}`);
  assert.throws(() => verifyProtectedOverlayDeployment({
    activation,
    artifact,
    deploymentRoot: fixture.root,
    projectRoot,
    ...pins,
  }), /protected_overlay_deployment_state_invalid/u);
});

test('successor promotion and rollback are bound to the exact predecessor release', (context) => {
  const deployment = makeDeploymentFixture();
  const successorProject = makeProjectFixture();
  context.after(() => {
    rmSync(deployment.root, { recursive: true, force: true });
    rmSync(successorProject, { recursive: true, force: true });
  });
  const firstArtifact = createProtectedOverlayArtifact({ projectRoot });
  const successorSource = join(
    successorProject,
    'web-hosting/cabohealth.org/apps/client-resources/app.js',
  );
  writeFileSync(
    successorSource,
    `${readFileSync(successorSource, 'utf8')}\n// reviewed successor\n`,
  );
  const successorArtifact = createProtectedOverlayArtifact({ projectRoot: successorProject });
  assert.notEqual(successorArtifact.releaseId, firstArtifact.releaseId);
  const activation = createActivation(deployment);
  const firstEvidence = createDeploymentEvidence(deployment, firstArtifact, activation).evidence;
  const successorEvidence = createDeploymentEvidence(
    deployment,
    successorArtifact,
    activation,
    successorProject,
  ).evidence;
  const activationPin = { expectedActivationSha256: activation.activationSha256 };

  promoteProtectedOverlays({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(firstArtifact),
    ...activationPin,
    ...securityPins(deployment, firstEvidence),
  });

  assert.throws(() => promoteProtectedOverlays({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    expectedPredecessorReleaseId: 'absent',
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
    ...activationPin,
    ...securityPins(deployment, successorEvidence),
  }), /protected_overlay_predecessor_mismatch/u);
  verifyProtectedOverlayDeployment({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    projectRoot,
    ...artifactPins(firstArtifact),
    ...activationPin,
    ...securityPins(deployment, firstEvidence),
  });

  assert.deepEqual(promoteProtectedOverlays({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    expectedPredecessorReleaseId: firstArtifact.releaseId,
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
    ...activationPin,
    ...securityPins(deployment, successorEvidence),
  }), {
    status: 'promoted',
    currentReleaseId: successorArtifact.releaseId,
    predecessorReleaseId: firstArtifact.releaseId,
  });

  assert.throws(() => deactivateFirstProtectedOverlays({
    activation,
    currentPins: artifactPins(successorArtifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentEvidenceSha256: successorEvidence.evidenceSha256,
    expectedCurrentReleaseId: successorArtifact.releaseId,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    trustPolicy: deployment.trustPolicy,
  }), /protected_overlay_predecessor_mismatch/u);

  assert.throws(() => rollbackProtectedOverlays({
    activation,
    currentPins: artifactPins(successorArtifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentEvidenceSha256: successorEvidence.evidenceSha256,
    expectedCurrentReleaseId: successorArtifact.releaseId,
    expectedPredecessorEvidenceSha256: firstEvidence.evidenceSha256,
    expectedPredecessorReleaseId: 'absent',
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    predecessorPins: artifactPins(firstArtifact),
    trustPolicy: deployment.trustPolicy,
  }), /protected_overlay_predecessor_mismatch/u);
  verifyProtectedOverlayDeployment({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
    ...activationPin,
    ...securityPins(deployment, successorEvidence),
  });

  assert.deepEqual(rollbackProtectedOverlays({
    activation,
    currentPins: artifactPins(successorArtifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentEvidenceSha256: successorEvidence.evidenceSha256,
    expectedCurrentReleaseId: successorArtifact.releaseId,
    expectedPredecessorEvidenceSha256: firstEvidence.evidenceSha256,
    expectedPredecessorReleaseId: firstArtifact.releaseId,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    predecessorPins: artifactPins(firstArtifact),
    trustPolicy: deployment.trustPolicy,
  }), {
    status: 'rolled-back',
    removedReleaseId: successorArtifact.releaseId,
    restoredReleaseId: firstArtifact.releaseId,
  });
  verifyProtectedOverlayDeployment({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    projectRoot,
    ...artifactPins(firstArtifact),
    ...activationPin,
    ...securityPins(deployment, firstEvidence),
  });
});

test('operator CLI creates a canonical read-only capsule and verifies explicit pins', (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-protected-cli-fixture-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  const artifactPath = join(fixture, 'protected-overlays.json');
  const created = runCli([
    'create-artifact',
    '--project-root', projectRoot,
    '--out', artifactPath,
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(readFileSync(artifactPath, 'utf8'), `${JSON.stringify(artifact)}\n`);
  assert.equal(statSync(artifactPath).mode & 0o777, 0o400);
  assert.deepEqual(JSON.parse(created.stdout), {
    status: 'created',
    releaseId: artifact.releaseId,
    inventorySha256: artifact.inventorySha256,
    artifactSha256: artifact.artifactSha256,
  });
  assert.equal(created.stdout.includes('bytesBase64'), false);

  const verified = runCli([
    'verify-artifact',
    '--project-root', projectRoot,
    '--artifact', artifactPath,
    '--release-id', artifact.releaseId,
    '--inventory-sha256', artifact.inventorySha256,
    '--artifact-sha256', artifact.artifactSha256,
  ]);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.deepEqual(JSON.parse(verified.stdout), {
    status: 'verified',
    releaseId: artifact.releaseId,
    inventorySha256: artifact.inventorySha256,
    artifactSha256: artifact.artifactSha256,
  });
});

test('operator CLI requires external activation evidence before promoting and verifying both realms', (context) => {
  const deployment = makeDeploymentFixture();
  context.after(() => rmSync(deployment.root, { recursive: true, force: true }));
  const artifactPath = join(deployment.root, 'protected-overlays.json');
  const activationInputsPath = join(deployment.root, 'activation-inputs.json');
  const activationPath = join(deployment.root, 'activation.json');
  const evidencePath = join(deployment.root, 'deployment-evidence.json');
  const evidenceRequestPath = join(deployment.root, 'deployment-evidence-request.json');
  const productionAttestationPath = join(deployment.root, 'production-attestation.json');
  const reviewAttestationPath = join(deployment.root, 'review-attestation.json');
  const trustPolicyPath = join(deployment.root, 'trust-policy.json');
  assert.equal(runCli([
    'create-artifact',
    '--project-root', projectRoot,
    '--out', artifactPath,
  ]).status, 0);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  writeFileSync(
    activationInputsPath,
    `${JSON.stringify({ realms: deployment.realms })}\n`,
    { mode: 0o400 },
  );
  chmodSync(activationInputsPath, 0o400);
  writeFileSync(trustPolicyPath, `${JSON.stringify(deployment.trustPolicy)}\n`, { mode: 0o400 });
  chmodSync(trustPolicyPath, 0o400);

  const activated = runCli([
    'create-activation',
    '--deployment-root', deployment.root,
    '--inputs', activationInputsPath,
    '--out', activationPath,
    '--trust-policy', trustPolicyPath,
    '--trust-policy-sha256', deployment.trustPolicySha256,
  ]);
  assert.equal(activated.status, 0, activated.stderr || activated.stdout);
  const activation = JSON.parse(readFileSync(activationPath, 'utf8'));
  assert.deepEqual(JSON.parse(activated.stdout), {
    status: 'created',
    activationSha256: activation.activationSha256,
  });
  assert.equal(activated.stdout.includes(deployment.secrets.production), false);
  assert.equal(activated.stdout.includes(deployment.secrets.review), false);
  const { evidence, request } = createDeploymentEvidence(deployment, artifact, activation);

  const requested = runCli([
    'create-evidence-request',
    '--project-root', projectRoot,
    '--deployment-root', deployment.root,
    '--artifact', artifactPath,
    '--activation', activationPath,
    '--release-id', artifact.releaseId,
    '--inventory-sha256', artifact.inventorySha256,
    '--artifact-sha256', artifact.artifactSha256,
    '--activation-sha256', activation.activationSha256,
    '--trust-policy', trustPolicyPath,
    '--trust-policy-sha256', deployment.trustPolicySha256,
    '--out', evidenceRequestPath,
  ]);
  assert.equal(requested.status, 0, requested.stderr || requested.stdout);
  assert.deepEqual(JSON.parse(readFileSync(evidenceRequestPath, 'utf8')), request);
  for (const [path, attestation] of [
    [productionAttestationPath, evidence.attestations[0]],
    [reviewAttestationPath, evidence.attestations[1]],
  ]) {
    writeFileSync(path, `${JSON.stringify(attestation)}\n`, { mode: 0o400 });
    chmodSync(path, 0o400);
  }
  const assembled = runCli([
    'assemble-evidence',
    '--request', evidenceRequestPath,
    '--production-attestation', productionAttestationPath,
    '--review-attestation', reviewAttestationPath,
    '--trust-policy', trustPolicyPath,
    '--trust-policy-sha256', deployment.trustPolicySha256,
    '--out', evidencePath,
  ]);
  assert.equal(assembled.status, 0, assembled.stderr || assembled.stdout);
  assert.deepEqual(JSON.parse(readFileSync(evidencePath, 'utf8')), evidence);

  const commonArguments = [
    '--project-root', projectRoot,
    '--deployment-root', deployment.root,
    '--artifact', artifactPath,
    '--activation', activationPath,
    '--release-id', artifact.releaseId,
    '--inventory-sha256', artifact.inventorySha256,
    '--artifact-sha256', artifact.artifactSha256,
    '--activation-sha256', activation.activationSha256,
    '--evidence', evidencePath,
    '--evidence-sha256', evidence.evidenceSha256,
    '--trust-policy', trustPolicyPath,
    '--trust-policy-sha256', deployment.trustPolicySha256,
  ];
  const promoted = runCli([
    'promote',
    ...commonArguments,
    '--predecessor-release-id', 'absent',
  ]);
  assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
  assert.deepEqual(JSON.parse(promoted.stdout), {
    status: 'promoted',
    currentReleaseId: artifact.releaseId,
    predecessorReleaseId: 'absent',
  });

  const verified = runCli(['verify-deployment', ...commonArguments]);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.deepEqual(JSON.parse(verified.stdout), {
    status: 'verified',
    releaseId: artifact.releaseId,
    artifactSha256: artifact.artifactSha256,
    activationSha256: activation.activationSha256,
    evidenceSha256: evidence.evidenceSha256,
  });
});

test('first CLI promotion recovers a SIGKILL to truly absent state before retry', (context) => {
  const deployment = makeDeploymentFixture();
  context.after(() => rmSync(deployment.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(deployment);
  const evidence = createDeploymentEvidence(deployment, artifact, activation).evidence;
  const commonArguments = writeDeploymentCliCapsules({
    activation,
    artifact,
    deployment,
    evidence,
    name: 'first-crash',
    sourceRoot: projectRoot,
  });

  const crashed = runCli([
    'promote',
    ...commonArguments,
    '--predecessor-release-id', 'absent',
  ], {
    NODE_ENV: 'test',
    CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: 'move-1',
  });
  assert.equal(crashed.signal, 'SIGKILL');

  const recovery = runCli(['verify-deployment', ...commonArguments]);
  assert.notEqual(recovery.status, 0, recovery.stdout);
  assert.match(recovery.stderr, /protected_overlay_deployment_state_invalid/u);
  assert.equal(
    existsSync(join(deployment.root, '.cabohealth-protected-overlays/transaction.json')),
    false,
  );
  for (const realm of artifact.realms) {
    assert.equal(existsSync(join(deployment.root, ...realm.promoteTarget.split('/'))), false);
  }

  const retried = runCli([
    'promote',
    ...commonArguments,
    '--predecessor-release-id', 'absent',
  ]);
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(runCli(['verify-deployment', ...commonArguments]).status, 0);
});

test('operator CLI deactivates only a first release, verifies absence, and is idempotent', (context) => {
  const scenario = makeTwoReleaseCliScenario('deactivate-first-cli');
  context.after(() => disposeTwoReleaseCliScenario(scenario));
  const deactivationArguments = deactivateFirstCliArguments(scenario);
  const expected = {
    status: 'deactivated',
    deactivatedReleaseId: scenario.initialArtifact.releaseId,
    restoredReleaseId: 'absent',
  };

  const extraPredecessorPins = runCli([
    'deactivate-first',
    ...deactivationArguments,
    '--predecessor-release-id', 'absent',
  ]);
  assert.notEqual(extraPredecessorPins.status, 0, extraPredecessorPins.stdout);
  assert.match(extraPredecessorPins.stderr, /protected_overlay_arguments_invalid/u);
  assert.equal(runCli(['verify-deployment', ...scenario.initialArguments]).status, 0);

  const deactivated = runCli(['deactivate-first', ...deactivationArguments]);
  assert.equal(deactivated.status, 0, deactivated.stderr || deactivated.stdout);
  assert.deepEqual(JSON.parse(deactivated.stdout), expected);

  const verified = runCli(['verify-absence', ...verifyAbsenceCliArguments(scenario)]);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.deepEqual(JSON.parse(verified.stdout), {
    status: 'verified-absent',
    releaseId: scenario.initialArtifact.releaseId,
    artifactSha256: scenario.initialArtifact.artifactSha256,
    activationSha256: scenario.activation.activationSha256,
    evidenceSha256: scenario.initialEvidence.evidenceSha256,
  });

  const retried = runCli(['deactivate-first', ...deactivationArguments]);
  assert.equal(retried.status, 0, retried.stderr || retried.stdout);
  assert.deepEqual(JSON.parse(retried.stdout), expected);

  const promoted = runCli([
    'promote',
    ...scenario.initialArguments,
    '--predecessor-release-id', 'absent',
  ]);
  assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
  assert.equal(runCli(['verify-deployment', ...scenario.initialArguments]).status, 0);
});

test('deactivate-first recovers every crash window without deleting either realm', (context) => {
  for (const crashStep of [
    'deactivation-authority-written',
    'journal-prepared',
    'move-1',
    'move-2',
    'state-committed',
  ]) {
    const scenario = makeTwoReleaseCliScenario(`deactivate-first-${crashStep}`);
    context.after(() => disposeTwoReleaseCliScenario(scenario));
    const deactivationArguments = deactivateFirstCliArguments(scenario);
    const crashed = runCli(['deactivate-first', ...deactivationArguments], {
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: crashStep,
    });
    assert.equal(crashed.signal, 'SIGKILL', crashStep);

    const retried = runCli(['deactivate-first', ...deactivationArguments]);
    assert.equal(retried.status, 0, `${crashStep}: ${retried.stderr}`);
    const verified = runCli(['verify-absence', ...verifyAbsenceCliArguments(scenario)]);
    assert.equal(verified.status, 0, `${crashStep}: ${verified.stderr}`);
    assert.equal(
      existsSync(join(
        scenario.deployment.root,
        '.cabohealth-protected-overlays/transaction.json',
      )),
      false,
      crashStep,
    );
    for (const realm of scenario.initialArtifact.realms) {
      assert.equal(
        existsSync(join(scenario.deployment.root, ...realm.promoteTarget.split('/'))),
        false,
        crashStep,
      );
      assert.equal(
        existsSync(join(
          scenario.deployment.root,
          '.cabohealth-protected-overlays/candidates',
          scenario.initialArtifact.releaseId,
          realm.realm,
        )),
        true,
        crashStep,
      );
    }
  }
});

test('two real CLI promotions cannot interleave realms or commit the same predecessor', async (context) => {
  const deployment = makeDeploymentFixture();
  const firstProject = makeProjectFixture();
  const secondProject = makeProjectFixture();
  context.after(() => {
    rmSync(deployment.root, { recursive: true, force: true });
    rmSync(firstProject, { recursive: true, force: true });
    rmSync(secondProject, { recursive: true, force: true });
  });
  const initialArtifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(deployment);
  const initialEvidence = createDeploymentEvidence(
    deployment,
    initialArtifact,
    activation,
  ).evidence;
  promoteProtectedOverlays({
    activation,
    artifact: initialArtifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(initialArtifact),
    ...securityPins(deployment, initialEvidence),
  });

  appendReviewedSuccessor(firstProject, 'concurrent-B');
  appendReviewedSuccessor(secondProject, 'concurrent-C');
  const firstArtifact = createProtectedOverlayArtifact({ projectRoot: firstProject });
  const secondArtifact = createProtectedOverlayArtifact({ projectRoot: secondProject });
  const firstEvidence = createDeploymentEvidence(
    deployment,
    firstArtifact,
    activation,
    firstProject,
  ).evidence;
  const secondEvidence = createDeploymentEvidence(
    deployment,
    secondArtifact,
    activation,
    secondProject,
  ).evidence;
  const firstArguments = writeDeploymentCliCapsules({
    activation,
    artifact: firstArtifact,
    deployment,
    evidence: firstEvidence,
    name: 'concurrent-B',
    sourceRoot: firstProject,
  });
  const secondArguments = writeDeploymentCliCapsules({
    activation,
    artifact: secondArtifact,
    deployment,
    evidence: secondEvidence,
    name: 'concurrent-C',
    sourceRoot: secondProject,
  });
  const readyPath = join(deployment.root, 'promotion.ready');
  const resumePath = join(deployment.root, 'promotion.resume');
  const first = spawn(process.execPath, [
    join(projectRoot, 'scripts/protected-overlay-release.mjs'),
    'promote',
    ...firstArguments,
    '--predecessor-release-id', initialArtifact.releaseId,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_PAUSE_AFTER_STEP: 'journal-prepared',
      CABOHEALTH_OVERLAY_TEST_PAUSE_READY_PATH: readyPath,
      CABOHEALTH_OVERLAY_TEST_PAUSE_RESUME_PATH: resumePath,
    },
  });
  const firstOutput = collectChildOutput(first);
  await waitForPathWhileRunning(readyPath, first, firstOutput);

  const contender = runCli([
    'promote',
    ...secondArguments,
    '--predecessor-release-id', initialArtifact.releaseId,
  ]);
  publishResumeSignal(resumePath);
  const [firstStatus] = await once(first, 'exit');
  const firstResult = await firstOutput;

  assert.notEqual(contender.status, 0, contender.stdout);
  assert.match(contender.stderr, /protected_overlay_transaction_locked/u);
  assert.equal(firstStatus, 0, firstResult.stderr);
  assert.equal(runCli(['verify-deployment', ...firstArguments]).status, 0);
  const staleRetry = runCli([
    'promote',
    ...secondArguments,
    '--predecessor-release-id', initialArtifact.releaseId,
  ]);
  assert.notEqual(staleRetry.status, 0, staleRetry.stdout);
  assert.match(staleRetry.stderr, /protected_overlay_predecessor_mismatch/u);
});

test('successor promotion recovers every realm move and state-commit SIGKILL coherently', (context) => {
  for (const crashStep of ['move-1', 'move-2', 'move-3', 'move-4', 'state-committed']) {
    const scenario = makeTwoReleaseCliScenario(`promote-${crashStep}`);
    context.after(() => disposeTwoReleaseCliScenario(scenario));
    const crashed = runCli([
      'promote',
      ...scenario.successorArguments,
      '--predecessor-release-id', scenario.initialArtifact.releaseId,
    ], {
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: crashStep,
    });
    assert.equal(crashed.signal, 'SIGKILL', crashStep);

    const committed = crashStep === 'state-committed';
    const expectedArguments = committed
      ? scenario.successorArguments
      : scenario.initialArguments;
    const recovered = runCli(['verify-deployment', ...expectedArguments]);
    assert.equal(recovered.status, 0, `${crashStep}: ${recovered.stderr}`);
    assert.equal(
      existsSync(join(
        scenario.deployment.root,
        '.cabohealth-protected-overlays/transaction.json',
      )),
      false,
      crashStep,
    );
    if (!committed) {
      const retried = runCli([
        'promote',
        ...scenario.successorArguments,
        '--predecessor-release-id', scenario.initialArtifact.releaseId,
      ]);
      assert.equal(retried.status, 0, `${crashStep}: ${retried.stderr}`);
    }
  }
});

test('rollback recovers every realm move and state-commit SIGKILL coherently', (context) => {
  for (const crashStep of ['move-1', 'move-2', 'move-3', 'move-4', 'state-committed']) {
    const scenario = makeTwoReleaseCliScenario(`rollback-${crashStep}`, {
      promoteSuccessor: true,
    });
    context.after(() => disposeTwoReleaseCliScenario(scenario));
    const rollbackArguments = rollbackCliArguments(scenario);
    const crashed = runCli(['rollback', ...rollbackArguments], {
      NODE_ENV: 'test',
      CABOHEALTH_OVERLAY_TEST_CRASH_AFTER_STEP: crashStep,
    });
    assert.equal(crashed.signal, 'SIGKILL', crashStep);

    const committed = crashStep === 'state-committed';
    const expectedArguments = committed
      ? scenario.initialArguments
      : scenario.successorArguments;
    const recovered = runCli(['verify-deployment', ...expectedArguments]);
    assert.equal(recovered.status, 0, `${crashStep}: ${recovered.stderr}`);
    assert.equal(
      existsSync(join(
        scenario.deployment.root,
        '.cabohealth-protected-overlays/transaction.json',
      )),
      false,
      crashStep,
    );
    if (!committed) {
      const retried = runCli(['rollback', ...rollbackArguments]);
      assert.equal(retried.status, 0, `${crashStep}: ${retried.stderr}`);
    }
  }
});

test('operator CLI rollback requires pins for the live release and its recorded predecessor', (context) => {
  const deployment = makeDeploymentFixture();
  const successorProject = makeProjectFixture();
  context.after(() => {
    rmSync(deployment.root, { recursive: true, force: true });
    rmSync(successorProject, { recursive: true, force: true });
  });
  const firstArtifact = createProtectedOverlayArtifact({ projectRoot });
  const successorSource = join(
    successorProject,
    'web-hosting/cabohealth.org/apps/client-resources/app.js',
  );
  writeFileSync(
    successorSource,
    `${readFileSync(successorSource, 'utf8')}\n// CLI rollback successor\n`,
  );
  const successorArtifact = createProtectedOverlayArtifact({ projectRoot: successorProject });
  const activation = createActivation(deployment);
  const firstEvidence = createDeploymentEvidence(deployment, firstArtifact, activation).evidence;
  const successorEvidence = createDeploymentEvidence(
    deployment,
    successorArtifact,
    activation,
    successorProject,
  ).evidence;
  const activationPath = join(deployment.root, 'activation.json');
  const trustPolicyPath = join(deployment.root, 'trust-policy.json');
  writeFileSync(activationPath, `${JSON.stringify(activation)}\n`, { mode: 0o400 });
  chmodSync(activationPath, 0o400);
  writeFileSync(trustPolicyPath, `${JSON.stringify(deployment.trustPolicy)}\n`, { mode: 0o400 });
  chmodSync(trustPolicyPath, 0o400);
  promoteProtectedOverlays({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(firstArtifact),
    ...securityPins(deployment, firstEvidence),
  });
  promoteProtectedOverlays({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedPredecessorReleaseId: firstArtifact.releaseId,
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
    ...securityPins(deployment, successorEvidence),
  });

  const rolledBack = runCli([
    'rollback',
    '--deployment-root', deployment.root,
    '--activation', activationPath,
    '--activation-sha256', activation.activationSha256,
    '--current-evidence-sha256', successorEvidence.evidenceSha256,
    '--current-release-id', successorArtifact.releaseId,
    '--current-inventory-sha256', successorArtifact.inventorySha256,
    '--current-artifact-sha256', successorArtifact.artifactSha256,
    '--predecessor-release-id', firstArtifact.releaseId,
    '--predecessor-inventory-sha256', firstArtifact.inventorySha256,
    '--predecessor-artifact-sha256', firstArtifact.artifactSha256,
    '--predecessor-evidence-sha256', firstEvidence.evidenceSha256,
    '--trust-policy', trustPolicyPath,
    '--trust-policy-sha256', deployment.trustPolicySha256,
  ]);
  assert.equal(rolledBack.status, 0, rolledBack.stderr || rolledBack.stdout);
  assert.deepEqual(JSON.parse(rolledBack.stdout), {
    status: 'rolled-back',
    removedReleaseId: successorArtifact.releaseId,
    restoredReleaseId: firstArtifact.releaseId,
  });
  verifyProtectedOverlayDeployment({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    projectRoot,
    ...artifactPins(firstArtifact),
    ...securityPins(deployment, firstEvidence),
  });
});

function makeProjectFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-protected-overlay-fixture-'));
  for (const path of [
    'web-hosting/cabohealth.org/apps/client-resources',
    'web-hosting/cabohealth.org/apps/app-review',
    'client-resources-private/config/broker-config.schema.json',
    'app-review-private/config/broker-config.schema.json',
    'tools/hosting/tests/client-resource-broker.php',
    'tools/hosting/tests/app-review-broker.php',
  ]) {
    const source = join(projectRoot, ...path.split('/'));
    const destination = join(fixture, ...path.split('/'));
    cpSync(source, destination, { recursive: true });
  }
  return fixture;
}

function artifactPins(artifact) {
  return {
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
  };
}

function runCli(arguments_, environment = {}) {
  return spawnSync(
    process.execPath,
    [join(projectRoot, 'scripts/protected-overlay-release.mjs'), ...arguments_],
    { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, ...environment } },
  );
}

function writeDeploymentCliCapsules({
  activation,
  artifact,
  deployment,
  evidence,
  name,
  sourceRoot,
}) {
  const artifactPath = join(deployment.root, `${name}-artifact.json`);
  const activationPath = join(deployment.root, `${name}-activation.json`);
  const evidencePath = join(deployment.root, `${name}-evidence.json`);
  const trustPolicyPath = join(deployment.root, `${name}-trust-policy.json`);
  for (const [path, value] of [
    [artifactPath, artifact],
    [activationPath, activation],
    [evidencePath, evidence],
    [trustPolicyPath, deployment.trustPolicy],
  ]) {
    writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o400 });
    chmodSync(path, 0o400);
  }
  return [
    '--project-root', sourceRoot,
    '--deployment-root', deployment.root,
    '--artifact', artifactPath,
    '--activation', activationPath,
    '--release-id', artifact.releaseId,
    '--inventory-sha256', artifact.inventorySha256,
    '--artifact-sha256', artifact.artifactSha256,
    '--activation-sha256', activation.activationSha256,
    '--evidence', evidencePath,
    '--evidence-sha256', evidence.evidenceSha256,
    '--trust-policy', trustPolicyPath,
    '--trust-policy-sha256', deployment.trustPolicySha256,
  ];
}

function appendReviewedSuccessor(sourceRoot, label) {
  const path = join(
    sourceRoot,
    'web-hosting/cabohealth.org/apps/client-resources/app.js',
  );
  writeFileSync(path, `${readFileSync(path, 'utf8')}\n// ${label}\n`);
}

function makeTwoReleaseCliScenario(name, { promoteSuccessor = false } = {}) {
  const deployment = makeDeploymentFixture();
  const successorProject = makeProjectFixture();
  appendReviewedSuccessor(successorProject, name);
  const initialArtifact = createProtectedOverlayArtifact({ projectRoot });
  const successorArtifact = createProtectedOverlayArtifact({ projectRoot: successorProject });
  const activation = createActivation(deployment);
  const initialEvidence = createDeploymentEvidence(
    deployment,
    initialArtifact,
    activation,
  ).evidence;
  const successorEvidence = createDeploymentEvidence(
    deployment,
    successorArtifact,
    activation,
    successorProject,
  ).evidence;
  const initialArguments = writeDeploymentCliCapsules({
    activation,
    artifact: initialArtifact,
    deployment,
    evidence: initialEvidence,
    name: `${name}-initial`,
    sourceRoot: projectRoot,
  });
  const successorArguments = writeDeploymentCliCapsules({
    activation,
    artifact: successorArtifact,
    deployment,
    evidence: successorEvidence,
    name: `${name}-successor`,
    sourceRoot: successorProject,
  });
  const promoted = runCli([
    'promote',
    ...initialArguments,
    '--predecessor-release-id', 'absent',
  ]);
  assert.equal(promoted.status, 0, promoted.stderr);
  if (promoteSuccessor) {
    const successor = runCli([
      'promote',
      ...successorArguments,
      '--predecessor-release-id', initialArtifact.releaseId,
    ]);
    assert.equal(successor.status, 0, successor.stderr);
  }
  return {
    activation,
    deployment,
    initialArguments,
    initialArtifact,
    initialEvidence,
    successorArguments,
    successorArtifact,
    successorEvidence,
    successorProject,
  };
}

function disposeTwoReleaseCliScenario(scenario) {
  rmSync(scenario.deployment.root, { recursive: true, force: true });
  rmSync(scenario.successorProject, { recursive: true, force: true });
}

function rollbackCliArguments(scenario) {
  return [
    '--deployment-root', scenario.deployment.root,
    '--activation', argumentValue(scenario.successorArguments, '--activation'),
    '--activation-sha256', scenario.activation.activationSha256,
    '--current-evidence-sha256', scenario.successorEvidence.evidenceSha256,
    '--current-release-id', scenario.successorArtifact.releaseId,
    '--current-inventory-sha256', scenario.successorArtifact.inventorySha256,
    '--current-artifact-sha256', scenario.successorArtifact.artifactSha256,
    '--predecessor-release-id', scenario.initialArtifact.releaseId,
    '--predecessor-inventory-sha256', scenario.initialArtifact.inventorySha256,
    '--predecessor-artifact-sha256', scenario.initialArtifact.artifactSha256,
    '--predecessor-evidence-sha256', scenario.initialEvidence.evidenceSha256,
    '--trust-policy', argumentValue(scenario.successorArguments, '--trust-policy'),
    '--trust-policy-sha256', scenario.deployment.trustPolicySha256,
  ];
}

function deactivateFirstCliArguments(scenario) {
  return [
    '--deployment-root', scenario.deployment.root,
    '--activation', argumentValue(scenario.initialArguments, '--activation'),
    '--activation-sha256', scenario.activation.activationSha256,
    '--current-evidence-sha256', scenario.initialEvidence.evidenceSha256,
    '--current-release-id', scenario.initialArtifact.releaseId,
    '--current-inventory-sha256', scenario.initialArtifact.inventorySha256,
    '--current-artifact-sha256', scenario.initialArtifact.artifactSha256,
    '--trust-policy', argumentValue(scenario.initialArguments, '--trust-policy'),
    '--trust-policy-sha256', scenario.deployment.trustPolicySha256,
  ];
}

function verifyAbsenceCliArguments(scenario) {
  return [
    '--deployment-root', scenario.deployment.root,
    '--activation-sha256', scenario.activation.activationSha256,
    '--current-evidence-sha256', scenario.initialEvidence.evidenceSha256,
    '--current-release-id', scenario.initialArtifact.releaseId,
    '--current-inventory-sha256', scenario.initialArtifact.inventorySha256,
    '--current-artifact-sha256', scenario.initialArtifact.artifactSha256,
  ];
}

function argumentValue(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index < 0 || typeof arguments_[index + 1] !== 'string') {
    throw new Error(`missing test argument ${name}`);
  }
  return arguments_[index + 1];
}

function writeSwapAfterLstatPreload(path) {
  writeFileSync(path, `'use strict';
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const pathModule = require('node:path');
const originalLstat = fs.lstatSync;
let swapped = false;
fs.lstatSync = function guardedLstat(path, ...args) {
  const stat = originalLstat.call(this, path, ...args);
  if (
    !swapped
    && pathModule.resolve(path) === pathModule.resolve(process.env.CABOHEALTH_TEST_SWAP_TARGET)
  ) {
    swapped = true;
    fs.renameSync(path, process.env.CABOHEALTH_TEST_SWAP_BACKUP);
    fs.renameSync(process.env.CABOHEALTH_TEST_SWAP_REPLACEMENT, path);
  }
  return stat;
};
syncBuiltinESMExports();
`);
}

function collectChildOutput(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolvePromise) => {
    child.on('close', () => resolvePromise({ stderr, stdout }));
  });
}

async function waitForPathWhileRunning(path, child, output) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (child.exitCode !== null) {
      const result = await output;
      throw new Error(`child exited before ${path}: ${result.stderr || result.stdout}`);
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

function makeDeploymentFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-protected-deploy-fixture-'));
  const docroot = join(root, 'public_html');
  const privateRoot = join(root, 'activation-inputs');
  mkdirSync(docroot, { mode: 0o755 });
  mkdirSync(privateRoot, { mode: 0o700 });
  const firebaseProjectId = 'cabohealth-owner-prod';
  const definitions = {
    production: {
      functionName: 'brokerApi',
      factorySource: 'client-resources-private/config/backend-factory.php.example',
      content: {
        'en.json': '{"value":"exclusive production content"}\n',
        'es-MX.json': '{"value":"contenido exclusivo"}\n',
      },
      keyByte: 17,
    },
    review: {
      functionName: 'appReviewBrokerApi',
      factorySource: 'app-review-private/config/backend-factory.php.example',
      content: { 'sample.json': '{"value":"fixed review sample"}\n' },
      keyByte: 29,
    },
  };
  const realms = {};
  const secrets = {};
  const attestationKeys = {};
  const phpCliPins = {};
  for (const [realm, definition] of Object.entries(definitions)) {
    attestationKeys[realm] = generateKeyPairSync('ed25519');
    const realmRoot = join(privateRoot, realm);
    const contentRoot = join(realmRoot, 'content');
    mkdirSync(realmRoot, { mode: 0o700 });
    mkdirSync(contentRoot, { mode: 0o700 });
    const phpCliPath = join(realmRoot, 'php-cli');
    writeFileSync(
      phpCliPath,
      `#!/bin/sh\nexit ${realm === 'production' ? 97 : 98}\n`,
      { mode: 0o755 },
    );
    chmodSync(phpCliPath, 0o755);
    const phpCliBytes = readFileSync(phpCliPath);
    const phpCliStat = statSync(phpCliPath);
    phpCliPins[realm] = {
      phpCliMode: '0755',
      phpCliOwnerUid: phpCliStat.uid,
      phpCliPath: realpathSync(phpCliPath),
      phpCliSha256: createHash('sha256').update(phpCliBytes).digest('hex'),
      phpCliSize: phpCliBytes.length,
      phpCliVersionId: realm === 'production' ? 80301 : 80402,
    };
    const secret = Buffer.alloc(32, definition.keyByte).toString('base64');
    secrets[realm] = secret;
    const brokerConfigPath = join(realmRoot, 'broker-config.json');
    writeFileSync(brokerConfigPath, `${JSON.stringify({
      schemaVersion: 1,
      baseUrl: `https://us-central1-${firebaseProjectId}.cloudfunctions.net/${definition.functionName}`,
      expectedHost: `us-central1-${firebaseProjectId}.cloudfunctions.net`,
      keyId: `${realm}-2026-08`,
      hmacKeyBase64: secret,
    })}\n`, { mode: 0o600 });
    const backendFactoryPath = join(realmRoot, 'backend-factory.php');
    writeFileSync(
      backendFactoryPath,
      readFileSync(join(projectRoot, ...definition.factorySource.split('/'))),
      { mode: 0o600 },
    );
    for (const [name, bytes] of Object.entries(definition.content)) {
      writeFileSync(join(contentRoot, name), bytes, { mode: 0o600 });
    }
    realms[realm] = {
      backendFactoryPath,
      brokerConfigPath,
      privateContentRoot: contentRoot,
    };
  }
  const trustPolicy = {
    schemaVersion: 1,
    policyKind: 'cabohealth-protected-overlay-trust-policy-v1',
    region: 'us-central1',
    realms: Object.entries(definitions).map(([realm, definition]) => ({
      realm,
      firebaseProjectId,
      brokerBaseUrl: `https://us-central1-${firebaseProjectId}.cloudfunctions.net/${definition.functionName}`,
      runtimeIdentity: {
        documentRoot: realpathSync(join(root, 'public_html')),
        ...phpCliPins[realm],
        phpSapi: 'fpm-fcgi',
      },
      attestationPublicKeyDerBase64: attestationKeys[realm].publicKey
        .export({ format: 'der', type: 'spki' }).toString('base64'),
      attestorPath: 'tools/hosting/protected-overlay-attestor.php',
      attestorSha256: 'c509d78a0c4696f36ba86543b7236142e4c241b14990921b912b0c60cc336c68',
    })),
  };
  return {
    root,
    realms,
    secrets,
    attestationKeys,
    trustPolicy,
    trustPolicySha256: sha256Json(trustPolicy),
  };
}

function createActivation(deployment) {
  return createProtectedOverlayActivationPlan({
    deploymentRoot: deployment.root,
    realms: deployment.realms,
    trustPolicy: deployment.trustPolicy,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
  });
}

function createDeploymentEvidence(deployment, artifact, activation, sourceRoot = projectRoot) {
  const request = createProtectedOverlayDeploymentEvidenceRequest({
    activation,
    artifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    projectRoot: sourceRoot,
    trustPolicy: deployment.trustPolicy,
    ...artifactPins(artifact),
  });
  const attestations = Object.fromEntries(request.realms.map((realm) => [
    realm.realm,
    signedAttestation(realm, deployment.attestationKeys[realm.realm].privateKey),
  ]));
  const evidence = createProtectedOverlayDeploymentEvidence({
    attestations,
    evidenceRequest: request,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    trustPolicy: deployment.trustPolicy,
  });
  return { evidence, request };
}

function deploymentEvidenceResult(realm, runtimeIdentity = realm.runtimeIdentity) {
  return {
    configuredEnvironment: realm.configuredEnvironment,
    phpHarness: {
      outputBase64: realm.phpHarness.expectedOutputBase64,
      outputSha256: realm.phpHarness.expectedOutputSha256,
      path: realm.phpHarness.path,
      phpVersionId: runtimeIdentity.phpCliVersionId,
      sourceSha256: realm.phpHarness.sourceSha256,
      status: 'passed',
    },
    runtimeIdentity,
    status: 'passed',
  };
}

function signedAttestation(realm, privateKey) {
  const result = deploymentEvidenceResult(realm);
  const signed = {
    schemaVersion: 1,
    attestationKind: 'cabohealth-protected-overlay-hostinger-attestation-v1',
    request: realm,
    result,
  };
  return {
    realm: realm.realm,
    result,
    signatureBase64: signPayload(
      null,
      Buffer.from(`cabohealth-protected-overlay-hostinger-attestation-v1\n${JSON.stringify(signed)}`),
      privateKey,
    ).toString('base64'),
  };
}

function securityPins(deployment, evidence) {
  return {
    evidence,
    expectedEvidenceSha256: evidence.evidenceSha256,
    expectedTrustPolicySha256: deployment.trustPolicySha256,
    trustPolicy: deployment.trustPolicy,
  };
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
