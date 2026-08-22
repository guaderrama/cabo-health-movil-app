import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
    cookieName: '__Secure-cabohealth_client',
  });
  assert.deepEqual(review.brokerIdentity, {
    functionName: 'appReviewBrokerApi',
    signatureDomain: 'cabohealth-app-review-broker-v1',
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

  const activation = createProtectedOverlayActivationPlan({
    deploymentRoot: fixture.root,
    realms: fixture.realms,
  });
  assert.equal(activation.artifactKind, 'cabohealth-protected-overlay-activation-v1');
  assert.match(activation.activationSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(activation.realms.map(({ realm }) => realm), ['production', 'review']);
  assert.deepEqual(verifyProtectedOverlayActivationPlan({
    activation,
    deploymentRoot: fixture.root,
    expectedActivationSha256: activation.activationSha256,
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
    () => createProtectedOverlayActivationPlan({
      deploymentRoot: fixture.root,
      realms: fixture.realms,
    }),
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

  assert.throws(() => createProtectedOverlayActivationPlan({
    deploymentRoot: fixture.root,
    realms: fixture.realms,
  }), /protected_overlay_private_input_invalid/u);

  production.brokerConfigPath = resolve(production.brokerConfigPath, '..', 'broker-config.json');
  const contentSymlinkPath = join(dirname(production.privateContentRoot), 'content-link');
  symlinkSync(production.privateContentRoot, contentSymlinkPath);
  production.privateContentRoot = contentSymlinkPath;
  assert.throws(() => createProtectedOverlayActivationPlan({
    deploymentRoot: fixture.root,
    realms: fixture.realms,
  }), /protected_overlay_directory_invalid/u);
});

test('promotion fails closed before mutation and then installs both exact public overlays', (context) => {
  const fixture = makeDeploymentFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const artifact = createProtectedOverlayArtifact({ projectRoot });
  const activation = createProtectedOverlayActivationPlan({
    deploymentRoot: fixture.root,
    realms: fixture.realms,
  });
  const pins = {
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
    expectedActivationSha256: activation.activationSha256,
  };
  const invalidActivation = structuredClone(activation);
  invalidActivation.realms[0].phpHarness.status = 'failed';

  assert.throws(() => promoteProtectedOverlays({
    activation: invalidActivation,
    artifact,
    deploymentRoot: fixture.root,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...pins,
  }), /protected_overlay_activation_invalid/u);
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
  const activation = createProtectedOverlayActivationPlan({
    deploymentRoot: deployment.root,
    realms: deployment.realms,
  });
  const activationPin = { expectedActivationSha256: activation.activationSha256 };

  promoteProtectedOverlays({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(firstArtifact),
    ...activationPin,
  });

  assert.throws(() => promoteProtectedOverlays({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    expectedPredecessorReleaseId: 'absent',
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
    ...activationPin,
  }), /protected_overlay_predecessor_mismatch/u);
  verifyProtectedOverlayDeployment({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    projectRoot,
    ...artifactPins(firstArtifact),
    ...activationPin,
  });

  assert.deepEqual(promoteProtectedOverlays({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    expectedPredecessorReleaseId: firstArtifact.releaseId,
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
    ...activationPin,
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
    expectedCurrentReleaseId: successorArtifact.releaseId,
    expectedPredecessorReleaseId: 'absent',
    predecessorPins: artifactPins(firstArtifact),
  }), /protected_overlay_predecessor_mismatch/u);
  verifyProtectedOverlayDeployment({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
    ...activationPin,
  });

  assert.deepEqual(rollbackProtectedOverlays({
    activation,
    currentPins: artifactPins(successorArtifact),
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedCurrentReleaseId: successorArtifact.releaseId,
    expectedPredecessorReleaseId: firstArtifact.releaseId,
    predecessorPins: artifactPins(firstArtifact),
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

  const activated = runCli([
    'create-activation',
    '--deployment-root', deployment.root,
    '--inputs', activationInputsPath,
    '--out', activationPath,
  ]);
  assert.equal(activated.status, 0, activated.stderr || activated.stdout);
  const activation = JSON.parse(readFileSync(activationPath, 'utf8'));
  assert.deepEqual(JSON.parse(activated.stdout), {
    status: 'created',
    activationSha256: activation.activationSha256,
  });
  assert.equal(activated.stdout.includes(deployment.secrets.production), false);
  assert.equal(activated.stdout.includes(deployment.secrets.review), false);

  const commonArguments = [
    '--project-root', projectRoot,
    '--deployment-root', deployment.root,
    '--artifact', artifactPath,
    '--activation', activationPath,
    '--release-id', artifact.releaseId,
    '--inventory-sha256', artifact.inventorySha256,
    '--artifact-sha256', artifact.artifactSha256,
    '--activation-sha256', activation.activationSha256,
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
  const activation = createProtectedOverlayActivationPlan({
    deploymentRoot: deployment.root,
    realms: deployment.realms,
  });
  const activationPath = join(deployment.root, 'activation.json');
  writeFileSync(activationPath, `${JSON.stringify(activation)}\n`, { mode: 0o400 });
  chmodSync(activationPath, 0o400);
  promoteProtectedOverlays({
    activation,
    artifact: firstArtifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedPredecessorReleaseId: 'absent',
    projectRoot,
    ...artifactPins(firstArtifact),
  });
  promoteProtectedOverlays({
    activation,
    artifact: successorArtifact,
    deploymentRoot: deployment.root,
    expectedActivationSha256: activation.activationSha256,
    expectedPredecessorReleaseId: firstArtifact.releaseId,
    projectRoot: successorProject,
    ...artifactPins(successorArtifact),
  });

  const rolledBack = runCli([
    'rollback',
    '--deployment-root', deployment.root,
    '--activation', activationPath,
    '--activation-sha256', activation.activationSha256,
    '--current-release-id', successorArtifact.releaseId,
    '--current-inventory-sha256', successorArtifact.inventorySha256,
    '--current-artifact-sha256', successorArtifact.artifactSha256,
    '--predecessor-release-id', firstArtifact.releaseId,
    '--predecessor-inventory-sha256', firstArtifact.inventorySha256,
    '--predecessor-artifact-sha256', firstArtifact.artifactSha256,
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
  });
});

function makeProjectFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cabohealth-protected-overlay-fixture-'));
  for (const path of [
    'web-hosting/cabohealth.org/apps/client-resources',
    'web-hosting/cabohealth.org/apps/app-review',
    'client-resources-private/config/broker-config.schema.json',
    'app-review-private/config/broker-config.schema.json',
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
  for (const [realm, definition] of Object.entries(definitions)) {
    const realmRoot = join(privateRoot, realm);
    const contentRoot = join(realmRoot, 'content');
    mkdirSync(realmRoot, { mode: 0o700 });
    mkdirSync(contentRoot, { mode: 0o700 });
    const secret = Buffer.alloc(32, definition.keyByte).toString('base64');
    secrets[realm] = secret;
    const brokerConfigPath = join(realmRoot, 'broker-config.json');
    writeFileSync(brokerConfigPath, `${JSON.stringify({
      schemaVersion: 1,
      baseUrl: `https://us-central1-cabohealth-prod.cloudfunctions.net/${definition.functionName}`,
      expectedHost: 'us-central1-cabohealth-prod.cloudfunctions.net',
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
      phpHarness: {
        evidenceSha256: definition.keyByte.toString(16).padStart(64, '0'),
        phpVersionId: 80200,
        status: 'passed',
      },
    };
  }
  return { root, realms, secrets };
}
