import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  createProtectedOverlayActivationPlan,
  createProtectedOverlayArtifact,
  createProtectedOverlayDeploymentEvidence,
  createProtectedOverlayDeploymentEvidenceRequest,
  promoteProtectedOverlays,
  rollbackProtectedOverlays,
  verifyProtectedOverlayActivationPlan,
  verifyProtectedOverlayArtifact,
  verifyProtectedOverlayDeployment,
} from '../scripts/protected-overlay-release-gate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
    { documentRoot: realpathSync(join(fixture.root, 'public_html')), phpSapi: 'fpm-fcgi' },
    { documentRoot: realpathSync(join(fixture.root, 'public_html')), phpSapi: 'fpm-fcgi' },
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

test('activation rejects unapproved CLI and document-root runtime identities', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  fixture.trustPolicy.realms[0].runtimeIdentity.phpSapi = 'cli';
  fixture.trustPolicySha256 = sha256Json(fixture.trustPolicy);
  assert.throws(() => createActivation(fixture), /protected_overlay_trust_policy_invalid/u);

  fixture.trustPolicy.realms[0].runtimeIdentity.phpSapi = 'fpm-fcgi';
  fixture.trustPolicy.realms[0].runtimeIdentity.documentRoot = join(fixture.root, 'decoy-html');
  fixture.trustPolicySha256 = sha256Json(fixture.trustPolicy);
  assert.throws(() => createActivation(fixture), /protected_overlay_runtime_identity_invalid/u);
});

test('the pinned Hostinger attestor derives signed evidence from runtime measurements', () => {
  const path = join(projectRoot, 'tools/hosting/protected-overlay-attestor.php');
  const source = readFileSync(path);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    'bfe8eb02df77d328b6698cd3eb9a14dee0653533c0b126b435870998b5adf8a9',
  );
  const text = source.toString('utf8');
  assert.match(text, /getenv\(\$name\)/u);
  assert.match(text, /attestor_measure_file/u);
  assert.match(text, /fopen/u);
  assert.match(text, /fstat/u);
  assert.match(text, /proc_open/u);
  assert.match(text, /sodium_crypto_sign_detached/u);
  assert.doesNotMatch(text, /file_get_contents/u);
  assert.doesNotMatch(text, /hash_file/u);
  assert.doesNotMatch(text, /--result/u);
});

test('Hostinger attestor measures getenv and rejects environment B for request A', (context) => {
  const version = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
  if (version.error?.code === 'ENOENT') {
    context.skip('PHP is not installed; CI and Hostinger must execute the attestor mismatch proof.');
    return;
  }
  assert.equal(version.status, 0, version.stderr);
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(fixture);
  const request = createDeploymentEvidence(fixture, artifact, activation).request;
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
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /protected_overlay_attestor_environment_mismatch/u);
  assert.equal(existsSync(outputPath), false);
});

test('signed evidence rejects CLI and document-root drift even with the right realm key', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createActivation(fixture);
  const { request } = createDeploymentEvidence(fixture, artifact, activation);

  for (const runtimeIdentity of [
    { documentRoot: realpathSync(join(fixture.root, 'public_html')), phpSapi: 'cli' },
    { documentRoot: join(fixture.root, 'decoy-html'), phpSapi: 'fpm-fcgi' },
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

function runCli(arguments_) {
  return spawnSync(
    process.execPath,
    [join(projectRoot, 'scripts/protected-overlay-release.mjs'), ...arguments_],
    { cwd: projectRoot, encoding: 'utf8' },
  );
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
  for (const [realm, definition] of Object.entries(definitions)) {
    attestationKeys[realm] = generateKeyPairSync('ed25519');
    const realmRoot = join(privateRoot, realm);
    const contentRoot = join(realmRoot, 'content');
    mkdirSync(realmRoot, { mode: 0o700 });
    mkdirSync(contentRoot, { mode: 0o700 });
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
        phpSapi: 'fpm-fcgi',
      },
      attestationPublicKeyDerBase64: attestationKeys[realm].publicKey
        .export({ format: 'der', type: 'spki' }).toString('base64'),
      attestorPath: 'tools/hosting/protected-overlay-attestor.php',
      attestorSha256: 'bfe8eb02df77d328b6698cd3eb9a14dee0653533c0b126b435870998b5adf8a9',
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
      phpVersionId: 80200,
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
