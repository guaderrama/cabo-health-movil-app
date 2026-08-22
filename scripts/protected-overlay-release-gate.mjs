import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ARTIFACT_KIND = 'cabohealth-protected-hostinger-overlays-v1';
const RELEASE_PREFIX = 'protected-overlays-v1-';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ACTIVATION_KIND = 'cabohealth-protected-overlay-activation-v1';
const ACTIVATION_REALM_INPUT_KEYS = Object.freeze([
  'backendFactoryPath',
  'brokerConfigPath',
  'phpHarness',
  'privateContentRoot',
]);
const MANAGED_ROOT_NAME = '.cabohealth-protected-overlays';

const REALM_DEFINITIONS = Object.freeze([
  Object.freeze({
    realm: 'production',
    sourceRoot: 'web-hosting/cabohealth.org/apps/client-resources',
    promoteTarget: 'public_html/apps/client-resources',
    files: Object.freeze([
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
    brokerIdentity: Object.freeze({
      functionName: 'brokerApi',
      signatureDomain: 'cabohealth-broker-v1',
      cookieName: '__Secure-cabohealth_client',
    }),
    headersSha256: '585014c18de9768b5aeb969834730be17e7c04491c97cb485496a8219a4efc73',
    externalInputs: Object.freeze({
      backendFactoryEnvironmentVariable: 'CABOHEALTH_CLIENT_RESOURCES_BACKEND_FACTORY',
      brokerConfigEnvironmentVariable: 'CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG',
      privateContentEnvironmentVariable: 'CABOHEALTH_CLIENT_RESOURCES_PRIVATE_CONTENT_ROOT',
      configSchemaPath: 'client-resources-private/config/broker-config.schema.json',
      configSchemaSha256: 'dbb8fc7c0a4b440865de8cfd91e41d30493e2fd57e3b6fbdb5103b7c36bbb6d7',
      phpHarnessPath: 'tools/hosting/tests/client-resource-broker.php',
      contentFiles: Object.freeze(['en.json', 'es-MX.json']),
      factoryClass: 'SignedFunctionsClientResourcesBackend',
    }),
  }),
  Object.freeze({
    realm: 'review',
    sourceRoot: 'web-hosting/cabohealth.org/apps/app-review',
    promoteTarget: 'public_html/apps/app-review',
    files: Object.freeze([
      '.htaccess',
      'launch/index.php',
      'lib/runtime.php',
      'session/end/index.php',
      'styles.css',
    ]),
    brokerIdentity: Object.freeze({
      functionName: 'appReviewBrokerApi',
      signatureDomain: 'cabohealth-app-review-broker-v1',
      cookieName: '__Secure-cabohealth_app_review',
    }),
    headersSha256: '4fb0587ae55d3b6a322663dae10b8710fa1e67f5fa6e4826e8b7a48be05b83ab',
    externalInputs: Object.freeze({
      backendFactoryEnvironmentVariable: 'CABOHEALTH_APP_REVIEW_BACKEND_FACTORY',
      brokerConfigEnvironmentVariable: 'CABOHEALTH_APP_REVIEW_SIGNING_CONFIG',
      privateContentEnvironmentVariable: 'CABOHEALTH_APP_REVIEW_PRIVATE_CONTENT_ROOT',
      configSchemaPath: 'app-review-private/config/broker-config.schema.json',
      configSchemaSha256: '1e6f9cc3c57416df864161d13e4d3dcc1ea10fb1a5369e65a4f706f75a66c7b5',
      phpHarnessPath: 'tools/hosting/tests/app-review-broker.php',
      contentFiles: Object.freeze(['sample.json']),
      factoryClass: 'SignedFunctionsAppReviewBackend',
    }),
  }),
]);

export function createProtectedOverlayArtifact({ projectRoot }) {
  const root = resolve(projectRoot);
  const realms = Object.freeze(REALM_DEFINITIONS.map((definition) => {
    const sourceRoot = resolve(root, definition.sourceRoot);
    assertExactInventory(sourceRoot, definition.files);
    const files = Object.freeze(definition.files.map((path) => {
      const bytes = readRegularFile(resolve(sourceRoot, ...path.split('/')));
      return Object.freeze({
        path,
        size: bytes.length,
        sha256: sha256(bytes),
        mediaType: mediaTypeFor(path),
        deployMode: '0644',
        bytesBase64: bytes.toString('base64'),
      });
    }));
    assertRealmSecurityBoundary(definition, files);
    const configSchemaBytes = readRegularFile(resolve(root, definition.externalInputs.configSchemaPath));
    if (sha256(configSchemaBytes) !== definition.externalInputs.configSchemaSha256) {
      throw new Error('protected_overlay_config_schema_invalid');
    }
    return Object.freeze({
      realm: definition.realm,
      sourceRoot: definition.sourceRoot,
      promoteTarget: definition.promoteTarget,
      brokerIdentity: definition.brokerIdentity,
      externalInputs: Object.freeze({
        status: 'required-outside-docroot',
        backendFactoryEnvironmentVariable:
          definition.externalInputs.backendFactoryEnvironmentVariable,
        brokerConfigEnvironmentVariable:
          definition.externalInputs.brokerConfigEnvironmentVariable,
        privateContentEnvironmentVariable:
          definition.externalInputs.privateContentEnvironmentVariable,
        configSchema: Object.freeze({
          path: definition.externalInputs.configSchemaPath,
          size: configSchemaBytes.length,
          sha256: sha256(configSchemaBytes),
        }),
        phpHarness: Object.freeze({
          path: definition.externalInputs.phpHarnessPath,
          minimumVersion: '8.2',
          status: 'external-required',
        }),
      }),
      files,
    });
  }));
  const promoteTargets = Object.freeze(realms.map(({ promoteTarget }) => promoteTarget));
  const inventorySha256 = sha256(canonical(realms.map((realm) => ({
    ...realm,
    files: realm.files.map(({ bytesBase64: _bytesBase64, ...metadata }) => metadata),
  }))));
  const core = Object.freeze({
    schemaVersion: 1,
    artifactKind: ARTIFACT_KIND,
    releaseId: `${RELEASE_PREFIX}${inventorySha256}`,
    inventorySha256,
    promoteTargets,
    realms,
  });
  return Object.freeze({
    ...core,
    artifactSha256: sha256(canonical(core)),
  });
}

export function verifyProtectedOverlayArtifact({
  artifact,
  projectRoot,
  expectedReleaseId,
  expectedInventorySha256,
  expectedArtifactSha256,
}) {
  const verified = validateArtifactCapsule(artifact, {
    expectedArtifactSha256,
    expectedInventorySha256,
    expectedReleaseId,
  });
  const expected = createProtectedOverlayArtifact({ projectRoot });
  if (
    expected.releaseId !== expectedReleaseId
    || expected.inventorySha256 !== expectedInventorySha256
    || expected.artifactSha256 !== expectedArtifactSha256
    || canonical(expected) !== canonical(verified)
  ) {
    throw new Error('protected_overlay_artifact_invalid');
  }
  return expected;
}

export function createProtectedOverlayActivationPlan({ deploymentRoot, realms }) {
  const root = realDirectory(deploymentRoot, 0o700, 0o755);
  const documentRoot = realDirectory(resolve(root, 'public_html'), 0o755);
  if (!isRecord(realms) || !hasExactKeys(realms, ['production', 'review'])) {
    throw new Error('protected_overlay_activation_invalid');
  }
  const privateIdentities = new Set();
  const signingKeys = [];
  const normalizedRealms = Object.freeze(REALM_DEFINITIONS.map((definition) => {
    const input = realms[definition.realm];
    if (!isRecord(input) || !hasExactKeys(input, ACTIVATION_REALM_INPUT_KEYS)) {
      throw new Error('protected_overlay_activation_invalid');
    }
    const brokerConfig = readPrivateActivationFile(
      input.brokerConfigPath,
      documentRoot,
      privateIdentities,
      4096,
    );
    const config = parseBrokerConfig(brokerConfig.bytes, definition);
    signingKeys.push(config.signingKey);
    const backendFactory = readPrivateActivationFile(
      input.backendFactoryPath,
      documentRoot,
      privateIdentities,
      65536,
    );
    assertBackendFactory(backendFactory.bytes, definition);
    const privateContent = readPrivateContentInventory(
      input.privateContentRoot,
      documentRoot,
      definition.externalInputs.contentFiles,
      privateIdentities,
    );
    const phpHarness = normalizePhpHarness(input.phpHarness);
    return Object.freeze({
      realm: definition.realm,
      brokerConfig: Object.freeze({
        path: brokerConfig.path,
        size: brokerConfig.bytes.length,
        sha256: sha256(brokerConfig.bytes),
      }),
      backendFactory: Object.freeze({
        path: backendFactory.path,
        size: backendFactory.bytes.length,
        sha256: sha256(backendFactory.bytes),
      }),
      privateContent: Object.freeze({
        path: privateContent.path,
        inventorySha256: sha256(canonical(privateContent.files)),
        files: privateContent.files,
      }),
      phpHarness,
    });
  }));
  if (signingKeys[0].equals(signingKeys[1])) {
    throw new Error('protected_overlay_broker_identity_invalid');
  }
  const core = Object.freeze({
    schemaVersion: 1,
    artifactKind: ACTIVATION_KIND,
    realms: normalizedRealms,
  });
  return Object.freeze({
    ...core,
    activationSha256: sha256(canonical(core)),
  });
}

export function verifyProtectedOverlayActivationPlan({
  activation,
  deploymentRoot,
  expectedActivationSha256,
}) {
  if (typeof expectedActivationSha256 !== 'string' || !HASH_PATTERN.test(expectedActivationSha256)) {
    throw new Error('protected_overlay_activation_pin_required');
  }
  if (
    !isRecord(activation)
    || activation.schemaVersion !== 1
    || activation.artifactKind !== ACTIVATION_KIND
    || !Array.isArray(activation.realms)
    || activation.realms.length !== REALM_DEFINITIONS.length
  ) throw new Error('protected_overlay_activation_invalid');
  const inputRealms = Object.fromEntries(activation.realms.map((realm) => [realm.realm, {
    backendFactoryPath: realm.backendFactory?.path,
    brokerConfigPath: realm.brokerConfig?.path,
    privateContentRoot: realm.privateContent?.path,
    phpHarness: realm.phpHarness,
  }]));
  let expected;
  try {
    expected = createProtectedOverlayActivationPlan({
      deploymentRoot,
      realms: inputRealms,
    });
  } catch {
    throw new Error('protected_overlay_activation_invalid');
  }
  if (
    expected.activationSha256 !== expectedActivationSha256
    || canonical(expected) !== canonical(activation)
  ) throw new Error('protected_overlay_activation_invalid');
  return expected;
}

export function promoteProtectedOverlays({
  activation,
  artifact,
  deploymentRoot,
  expectedActivationSha256,
  expectedArtifactSha256,
  expectedInventorySha256,
  expectedPredecessorReleaseId,
  expectedReleaseId,
  projectRoot,
}) {
  const verifiedArtifact = verifyProtectedOverlayArtifact({
    artifact,
    projectRoot,
    expectedArtifactSha256,
    expectedInventorySha256,
    expectedReleaseId,
  });
  const verifiedActivation = verifyProtectedOverlayActivationPlan({
    activation,
    deploymentRoot,
    expectedActivationSha256,
  });
  assertExpectedPredecessor(expectedPredecessorReleaseId);
  const root = realDirectory(deploymentRoot, 0o700, 0o755);
  const documentRoot = realDirectory(resolve(root, 'public_html'), 0o755);
  const existingState = readManagedState(root);
  let predecessorArtifact = null;
  if (existingState === null) {
    if (expectedPredecessorReleaseId !== 'absent') {
      throw new Error('protected_overlay_predecessor_mismatch');
    }
    for (const realm of verifiedArtifact.realms) {
      if (existsSync(resolve(root, ...realm.promoteTarget.split('/')))) {
        throw new Error('protected_overlay_unmanaged_live_target');
      }
    }
  } else {
    if (
      expectedPredecessorReleaseId !== existingState.current.releaseId
      || verifiedArtifact.releaseId === existingState.current.releaseId
    ) throw new Error('protected_overlay_predecessor_mismatch');
    predecessorArtifact = readStoredArtifact(root, stateArtifactPins(existingState.current));
    for (const realm of predecessorArtifact.realms) {
      verifyRealmDirectory(resolve(root, ...realm.promoteTarget.split('/')), realm);
    }
  }

  const managedRoot = ensureDirectory(resolve(root, MANAGED_ROOT_NAME), 0o700);
  const artifactsRoot = ensureDirectory(resolve(managedRoot, 'artifacts'), 0o700);
  const candidatesRoot = ensureDirectory(resolve(managedRoot, 'candidates'), 0o700);
  storeImmutableArtifact(artifactsRoot, verifiedArtifact);
  const releaseCandidateRoot = resolve(candidatesRoot, verifiedArtifact.releaseId);
  prepareEmptyDirectory(releaseCandidateRoot, 0o700, 'protected_overlay_candidate_collision');
  for (const realm of verifiedArtifact.realms) {
    materializeRealm(resolve(releaseCandidateRoot, realm.realm), realm);
  }
  const appsRoot = ensureDirectory(resolve(documentRoot, 'apps'), 0o755);
  let predecessorRoot = null;
  if (predecessorArtifact !== null) {
    const predecessorsRoot = ensureDirectory(resolve(managedRoot, 'predecessors'), 0o700);
    predecessorRoot = resolve(predecessorsRoot, verifiedArtifact.releaseId);
    prepareEmptyDirectory(
      predecessorRoot,
      0o700,
      'protected_overlay_predecessor_store_collision',
    );
  }
  storeImmutableTransition(managedRoot, verifiedArtifact, existingState);

  const moved = [];
  try {
    for (const realm of verifiedArtifact.realms) {
      const source = resolve(releaseCandidateRoot, realm.realm);
      const destination = resolve(root, ...realm.promoteTarget.split('/'));
      if (dirname(destination) !== appsRoot) {
        throw new Error('protected_overlay_live_target_invalid');
      }
      if (predecessorArtifact !== null) {
        const backup = resolve(predecessorRoot, realm.realm);
        if (!existsSync(destination) || existsSync(backup)) {
          throw new Error('protected_overlay_live_target_invalid');
        }
        renameSync(destination, backup);
        moved.push({ destination: backup, source: destination });
      } else if (existsSync(destination)) {
        throw new Error('protected_overlay_live_target_invalid');
      }
      renameSync(source, destination);
      moved.push({ destination, source });
      verifyRealmDirectory(destination, realm);
    }
    writeManagedState(root, Object.freeze({
      schemaVersion: 1,
      current: Object.freeze({
        releaseId: verifiedArtifact.releaseId,
        inventorySha256: verifiedArtifact.inventorySha256,
        artifactSha256: verifiedArtifact.artifactSha256,
        activationSha256: verifiedActivation.activationSha256,
      }),
      predecessorReleaseId: existingState?.current.releaseId ?? 'absent',
    }));
  } catch (error) {
    let reversalFailed = false;
    for (const move of moved.reverse()) {
      try {
        renameSync(move.destination, move.source);
      } catch {
        reversalFailed = true;
      }
    }
    if (reversalFailed) throw new Error('protected_overlay_promotion_reversal_failed');
    throw error;
  }
  return Object.freeze({
    status: 'promoted',
    currentReleaseId: verifiedArtifact.releaseId,
    predecessorReleaseId: existingState?.current.releaseId ?? 'absent',
  });
}

export function rollbackProtectedOverlays({
  activation,
  currentPins,
  deploymentRoot,
  expectedActivationSha256,
  expectedCurrentReleaseId,
  expectedPredecessorReleaseId,
  predecessorPins,
}) {
  assertExpectedPredecessor(expectedCurrentReleaseId);
  assertExpectedPredecessor(expectedPredecessorReleaseId);
  if (
    expectedCurrentReleaseId === 'absent'
    || expectedPredecessorReleaseId === 'absent'
    || !isRecord(currentPins)
    || !isRecord(predecessorPins)
    || currentPins.expectedReleaseId !== expectedCurrentReleaseId
    || predecessorPins.expectedReleaseId !== expectedPredecessorReleaseId
  ) throw new Error('protected_overlay_predecessor_mismatch');
  assertPinObject(currentPins);
  assertPinObject(predecessorPins);
  const verifiedActivation = verifyProtectedOverlayActivationPlan({
    activation,
    deploymentRoot,
    expectedActivationSha256,
  });
  const root = realDirectory(deploymentRoot, 0o700, 0o755);
  const documentRoot = realDirectory(resolve(root, 'public_html'), 0o755);
  const state = readManagedState(root);
  if (
    state === null
    || state.current.releaseId !== expectedCurrentReleaseId
    || state.predecessorReleaseId !== expectedPredecessorReleaseId
    || !stateMatchesArtifactPins(state.current, currentPins)
  ) throw new Error('protected_overlay_predecessor_mismatch');
  const currentArtifact = readStoredArtifact(root, currentPins);
  const predecessorArtifact = readStoredArtifact(root, predecessorPins);
  const transition = readImmutableTransition(root, expectedCurrentReleaseId);
  if (
    transition.releaseId !== expectedCurrentReleaseId
    || transition.artifactSha256 !== currentArtifact.artifactSha256
    || transition.predecessor === null
    || transition.predecessor.current.releaseId !== expectedPredecessorReleaseId
    || !stateMatchesArtifactPins(transition.predecessor.current, predecessorPins)
    || transition.predecessor.current.activationSha256 !== verifiedActivation.activationSha256
  ) throw new Error('protected_overlay_predecessor_mismatch');
  for (const realm of currentArtifact.realms) {
    verifyRealmDirectory(resolve(root, ...realm.promoteTarget.split('/')), realm);
  }
  const managedRoot = realDirectory(resolve(root, MANAGED_ROOT_NAME), 0o700);
  const predecessorRoot = realDirectory(
    resolve(managedRoot, 'predecessors', expectedCurrentReleaseId),
    0o700,
  );
  assertDirectoryNames(
    predecessorRoot,
    predecessorArtifact.realms.map(({ realm }) => realm),
    'protected_overlay_predecessor_store_invalid',
  );
  for (const realm of predecessorArtifact.realms) {
    verifyRealmDirectory(resolve(predecessorRoot, realm.realm), realm);
  }
  const removedRoot = resolve(
    ensureDirectory(resolve(managedRoot, 'removed'), 0o700),
    expectedCurrentReleaseId,
  );
  prepareEmptyDirectory(removedRoot, 0o700, 'protected_overlay_removed_store_collision');
  const appsRoot = realDirectory(resolve(documentRoot, 'apps'), 0o755);

  const moved = [];
  try {
    for (const realm of predecessorArtifact.realms) {
      const destination = resolve(root, ...realm.promoteTarget.split('/'));
      const removed = resolve(removedRoot, realm.realm);
      const predecessor = resolve(predecessorRoot, realm.realm);
      if (dirname(destination) !== appsRoot || existsSync(removed)) {
        throw new Error('protected_overlay_live_target_invalid');
      }
      renameSync(destination, removed);
      moved.push({ destination: removed, source: destination });
      renameSync(predecessor, destination);
      moved.push({ destination, source: predecessor });
      verifyRealmDirectory(destination, realm);
    }
    writeManagedState(root, Object.freeze({
      schemaVersion: 1,
      current: transition.predecessor.current,
      predecessorReleaseId: transition.predecessor.predecessorReleaseId,
    }));
  } catch (error) {
    let reversalFailed = false;
    for (const move of moved.reverse()) {
      try {
        renameSync(move.destination, move.source);
      } catch {
        reversalFailed = true;
      }
    }
    if (reversalFailed) throw new Error('protected_overlay_rollback_reversal_failed');
    throw error;
  }
  return Object.freeze({
    status: 'rolled-back',
    removedReleaseId: expectedCurrentReleaseId,
    restoredReleaseId: expectedPredecessorReleaseId,
  });
}

export function verifyProtectedOverlayDeployment({
  activation,
  artifact,
  deploymentRoot,
  expectedActivationSha256,
  expectedArtifactSha256,
  expectedInventorySha256,
  expectedReleaseId,
  projectRoot,
}) {
  const verifiedArtifact = verifyProtectedOverlayArtifact({
    artifact,
    projectRoot,
    expectedArtifactSha256,
    expectedInventorySha256,
    expectedReleaseId,
  });
  const verifiedActivation = verifyProtectedOverlayActivationPlan({
    activation,
    deploymentRoot,
    expectedActivationSha256,
  });
  const root = realDirectory(deploymentRoot, 0o700, 0o755);
  const state = readManagedState(root);
  if (
    state === null
    || state.current.releaseId !== verifiedArtifact.releaseId
    || state.current.inventorySha256 !== verifiedArtifact.inventorySha256
    || state.current.artifactSha256 !== verifiedArtifact.artifactSha256
    || state.current.activationSha256 !== verifiedActivation.activationSha256
  ) throw new Error('protected_overlay_deployment_state_invalid');
  for (const realm of verifiedArtifact.realms) {
    verifyRealmDirectory(resolve(root, ...realm.promoteTarget.split('/')), realm);
  }
  return Object.freeze({
    status: 'verified',
    releaseId: verifiedArtifact.releaseId,
    artifactSha256: verifiedArtifact.artifactSha256,
    activationSha256: verifiedActivation.activationSha256,
  });
}

function validateArtifactCapsule(artifact, pins) {
  assertPinObject(pins);
  if (
    !isRecord(artifact)
    || !hasExactKeys(artifact, [
      'schemaVersion',
      'artifactKind',
      'releaseId',
      'inventorySha256',
      'promoteTargets',
      'realms',
      'artifactSha256',
    ])
    || artifact.schemaVersion !== 1
    || artifact.artifactKind !== ARTIFACT_KIND
    || !Array.isArray(artifact.promoteTargets)
    || !Array.isArray(artifact.realms)
    || artifact.realms.length !== REALM_DEFINITIONS.length
  ) throw new Error('protected_overlay_artifact_invalid');
  for (let index = 0; index < REALM_DEFINITIONS.length; index += 1) {
    const definition = REALM_DEFINITIONS[index];
    const realm = artifact.realms[index];
    if (
      artifact.promoteTargets[index] !== definition.promoteTarget
      || !isRecord(realm)
      || !hasExactKeys(realm, [
        'realm',
        'sourceRoot',
        'promoteTarget',
        'brokerIdentity',
        'externalInputs',
        'files',
      ])
      || realm.realm !== definition.realm
      || realm.sourceRoot !== definition.sourceRoot
      || realm.promoteTarget !== definition.promoteTarget
      || canonical(realm.brokerIdentity) !== canonical(definition.brokerIdentity)
      || !isRecord(realm.externalInputs)
      || !hasExactKeys(realm.externalInputs, [
        'status',
        'backendFactoryEnvironmentVariable',
        'brokerConfigEnvironmentVariable',
        'privateContentEnvironmentVariable',
        'configSchema',
        'phpHarness',
      ])
      || realm.externalInputs.status !== 'required-outside-docroot'
      || realm.externalInputs.backendFactoryEnvironmentVariable
        !== definition.externalInputs.backendFactoryEnvironmentVariable
      || realm.externalInputs.brokerConfigEnvironmentVariable
        !== definition.externalInputs.brokerConfigEnvironmentVariable
      || realm.externalInputs.privateContentEnvironmentVariable
        !== definition.externalInputs.privateContentEnvironmentVariable
      || !isRecord(realm.externalInputs.configSchema)
      || !hasExactKeys(realm.externalInputs.configSchema, ['path', 'size', 'sha256'])
      || realm.externalInputs.configSchema.path !== definition.externalInputs.configSchemaPath
      || realm.externalInputs.configSchema.sha256
        !== definition.externalInputs.configSchemaSha256
      || !Number.isSafeInteger(realm.externalInputs.configSchema.size)
      || realm.externalInputs.configSchema.size < 1
      || !isRecord(realm.externalInputs.phpHarness)
      || !hasExactKeys(realm.externalInputs.phpHarness, [
        'path',
        'minimumVersion',
        'status',
      ])
      || realm.externalInputs.phpHarness.path !== definition.externalInputs.phpHarnessPath
      || realm.externalInputs.phpHarness.minimumVersion !== '8.2'
      || realm.externalInputs.phpHarness.status !== 'external-required'
      || !Array.isArray(realm.files)
      || realm.files.length !== definition.files.length
    ) throw new Error('protected_overlay_artifact_invalid');
    for (let fileIndex = 0; fileIndex < definition.files.length; fileIndex += 1) {
      const file = realm.files[fileIndex];
      const expectedPath = definition.files[fileIndex];
      if (
        !isRecord(file)
        || !hasExactKeys(file, [
          'path',
          'size',
          'sha256',
          'mediaType',
          'deployMode',
          'bytesBase64',
        ])
        || file.path !== expectedPath
        || !Number.isSafeInteger(file.size)
        || file.size < 1
        || typeof file.sha256 !== 'string'
        || !HASH_PATTERN.test(file.sha256)
        || file.mediaType !== mediaTypeFor(file.path)
        || file.deployMode !== '0644'
        || typeof file.bytesBase64 !== 'string'
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
          .test(file.bytesBase64)
      ) throw new Error('protected_overlay_artifact_invalid');
      const bytes = Buffer.from(file.bytesBase64, 'base64');
      if (
        bytes.length !== file.size
        || bytes.toString('base64') !== file.bytesBase64
        || sha256(bytes) !== file.sha256
      ) throw new Error('protected_overlay_artifact_invalid');
    }
    assertRealmSecurityBoundary(definition, realm.files);
  }
  const inventorySha256 = sha256(canonical(artifact.realms.map((realm) => ({
    ...realm,
    files: realm.files.map(({ bytesBase64: _bytesBase64, ...metadata }) => metadata),
  }))));
  const core = {
    schemaVersion: artifact.schemaVersion,
    artifactKind: artifact.artifactKind,
    releaseId: artifact.releaseId,
    inventorySha256: artifact.inventorySha256,
    promoteTargets: artifact.promoteTargets,
    realms: artifact.realms,
  };
  if (
    artifact.inventorySha256 !== inventorySha256
    || artifact.releaseId !== `${RELEASE_PREFIX}${inventorySha256}`
    || artifact.artifactSha256 !== sha256(canonical(core))
    || artifact.releaseId !== pins.expectedReleaseId
    || artifact.inventorySha256 !== pins.expectedInventorySha256
    || artifact.artifactSha256 !== pins.expectedArtifactSha256
  ) throw new Error('protected_overlay_artifact_invalid');
  return artifact;
}

function materializeRealm(destination, realm) {
  mkdirSync(destination, { mode: 0o755 });
  for (const file of realm.files) {
    const path = resolve(destination, ...file.path.split('/'));
    ensureArtifactParents(destination, dirname(path));
    writeFileSync(path, Buffer.from(file.bytesBase64, 'base64'), {
      flag: 'wx',
      mode: 0o644,
    });
  }
  verifyRealmDirectory(destination, realm);
}

function ensureArtifactParents(root, destination) {
  const relativePath = relative(root, destination);
  if (relativePath === '') return;
  let current = root;
  for (const component of relativePath.split(sep)) {
    current = resolve(current, component);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o755 });
    else realDirectory(current, 0o755);
  }
}

function verifyRealmDirectory(path, realm) {
  const root = realDirectory(path, 0o755);
  assertExactInventory(root, realm.files.map(({ path: filePath }) => filePath));
  const expectedDirectories = new Set(['']);
  for (const file of realm.files) {
    const components = file.path.split('/');
    for (let index = 1; index < components.length; index += 1) {
      expectedDirectories.add(components.slice(0, index).join('/'));
    }
    const absolute = resolve(root, ...components);
    const stat = lstatSync(absolute);
    const bytes = readFileSync(absolute);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || (stat.mode & 0o777) !== 0o644
      || bytes.length !== file.size
      || sha256(bytes) !== file.sha256
      || !bytes.equals(Buffer.from(file.bytesBase64, 'base64'))
    ) throw new Error('protected_overlay_live_bytes_invalid');
  }
  for (const directory of expectedDirectories) {
    realDirectory(resolve(root, ...directory.split('/').filter(Boolean)), 0o755);
  }
}

function storeImmutableArtifact(artifactsRoot, artifact) {
  const path = resolve(artifactsRoot, `${artifact.releaseId}.json`);
  const bytes = Buffer.from(`${canonical(artifact)}\n`, 'utf8');
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || (stat.mode & 0o777) !== 0o400
      || !readFileSync(path).equals(bytes)
    ) throw new Error('protected_overlay_artifact_store_collision');
    return;
  }
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 });
}

function readStoredArtifact(root, pins) {
  assertPinObject(pins);
  const path = resolve(
    root,
    MANAGED_ROOT_NAME,
    'artifacts',
    `${pins.expectedReleaseId}.json`,
  );
  let artifact;
  let bytes;
  let stat;
  try {
    stat = lstatSync(path);
    bytes = readFileSync(path);
    artifact = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('protected_overlay_artifact_store_invalid');
  }
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o400
    || !bytes.equals(Buffer.from(`${canonical(artifact)}\n`, 'utf8'))
  ) throw new Error('protected_overlay_artifact_store_invalid');
  return validateArtifactCapsule(artifact, pins);
}

function storeImmutableTransition(managedRoot, artifact, predecessor) {
  const transitionsRoot = ensureDirectory(resolve(managedRoot, 'transitions'), 0o700);
  const transition = Object.freeze({
    schemaVersion: 1,
    releaseId: artifact.releaseId,
    artifactSha256: artifact.artifactSha256,
    predecessor,
  });
  const path = resolve(transitionsRoot, `${artifact.releaseId}.json`);
  const bytes = Buffer.from(`${canonical(transition)}\n`, 'utf8');
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || (stat.mode & 0o777) !== 0o400
      || !readFileSync(path).equals(bytes)
    ) throw new Error('protected_overlay_transition_collision');
    return;
  }
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 });
}

function readImmutableTransition(root, releaseId) {
  const path = resolve(root, MANAGED_ROOT_NAME, 'transitions', `${releaseId}.json`);
  let transition;
  let bytes;
  let stat;
  try {
    stat = lstatSync(path);
    bytes = readFileSync(path);
    transition = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('protected_overlay_transition_invalid');
  }
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o400
    || !bytes.equals(Buffer.from(`${canonical(transition)}\n`, 'utf8'))
    || !isRecord(transition)
    || !hasExactKeys(transition, [
      'schemaVersion',
      'releaseId',
      'artifactSha256',
      'predecessor',
    ])
    || transition.schemaVersion !== 1
    || transition.releaseId !== releaseId
    || !HASH_PATTERN.test(transition.artifactSha256)
    || (transition.predecessor !== null && !isValidManagedState(transition.predecessor))
  ) throw new Error('protected_overlay_transition_invalid');
  return transition;
}

function ensureDirectory(path, mode) {
  if (!existsSync(path)) mkdirSync(path, { mode });
  return realDirectory(path, mode);
}

function prepareEmptyDirectory(path, mode, errorCode) {
  if (!existsSync(path)) {
    mkdirSync(path, { mode });
    return path;
  }
  const root = realDirectory(path, mode);
  if (readdirSync(root).length !== 0) throw new Error(errorCode);
  return root;
}

function assertDirectoryNames(path, expectedNames, errorCode) {
  const entries = readdirSync(path, { withFileTypes: true }).sort((left, right) => (
    compareText(left.name, right.name)
  ));
  if (
    entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())
    || canonical(entries.map(({ name }) => name))
      !== canonical([...expectedNames].sort(compareText))
  ) throw new Error(errorCode);
}

function readManagedState(root) {
  const path = resolve(root, MANAGED_ROOT_NAME, 'state.json');
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  let state;
  let source;
  try {
    source = readFileSync(path, 'utf8');
    state = JSON.parse(source);
  } catch {
    throw new Error('protected_overlay_deployment_state_invalid');
  }
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o600
    || source !== `${canonical(state)}\n`
    || !isValidManagedState(state)
  ) throw new Error('protected_overlay_deployment_state_invalid');
  return state;
}

function writeManagedState(root, state) {
  if (!isValidManagedState(state)) throw new Error('protected_overlay_deployment_state_invalid');
  const managedRoot = ensureDirectory(resolve(root, MANAGED_ROOT_NAME), 0o700);
  const destination = resolve(managedRoot, 'state.json');
  const candidate = resolve(managedRoot, 'state.candidate.json');
  if (existsSync(candidate)) throw new Error('protected_overlay_deployment_state_collision');
  writeFileSync(candidate, `${canonical(state)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(candidate, destination);
}

function isValidManagedState(state) {
  return isRecord(state)
    && hasExactKeys(state, ['schemaVersion', 'current', 'predecessorReleaseId'])
    && state.schemaVersion === 1
    && isRecord(state.current)
    && hasExactKeys(state.current, [
      'releaseId',
      'inventorySha256',
      'artifactSha256',
      'activationSha256',
    ])
    && typeof state.current.releaseId === 'string'
    && state.current.releaseId.startsWith(RELEASE_PREFIX)
    && HASH_PATTERN.test(state.current.releaseId.slice(RELEASE_PREFIX.length))
    && HASH_PATTERN.test(state.current.inventorySha256)
    && HASH_PATTERN.test(state.current.artifactSha256)
    && HASH_PATTERN.test(state.current.activationSha256)
    && (state.predecessorReleaseId === 'absent'
      || (typeof state.predecessorReleaseId === 'string'
        && state.predecessorReleaseId.startsWith(RELEASE_PREFIX)
        && HASH_PATTERN.test(state.predecessorReleaseId.slice(RELEASE_PREFIX.length))));
}

function stateArtifactPins(current) {
  return Object.freeze({
    expectedReleaseId: current.releaseId,
    expectedInventorySha256: current.inventorySha256,
    expectedArtifactSha256: current.artifactSha256,
  });
}

function stateMatchesArtifactPins(current, pins) {
  return current.releaseId === pins.expectedReleaseId
    && current.inventorySha256 === pins.expectedInventorySha256
    && current.artifactSha256 === pins.expectedArtifactSha256;
}

function assertExpectedPredecessor(value) {
  if (
    value !== 'absent'
    && !(typeof value === 'string'
      && value.startsWith(RELEASE_PREFIX)
      && HASH_PATTERN.test(value.slice(RELEASE_PREFIX.length)))
  ) throw new Error('protected_overlay_predecessor_pin_required');
}

function readPrivateActivationFile(path, documentRoot, identities, maximumSize) {
  const lexical = resolve(path);
  let resolved;
  let lexicalStat;
  try {
    lexicalStat = lstatSync(lexical);
    resolved = realpathSync(lexical);
  } catch {
    throw new Error('protected_overlay_private_input_invalid');
  }
  const stat = lstatSync(resolved);
  const parent = lstatSync(dirname(lexical));
  const identity = `${stat.dev}:${stat.ino}`;
  if (
    lexicalStat.isSymbolicLink()
    || !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o600
    || stat.size < 2
    || stat.size > maximumSize
    || !parent.isDirectory()
    || parent.isSymbolicLink()
    || (parent.mode & 0o777) !== 0o700
    || !isOutsideDirectory(resolved, documentRoot)
    || identities.has(identity)
  ) throw new Error('protected_overlay_private_input_invalid');
  identities.add(identity);
  return Object.freeze({ path: resolved, bytes: readFileSync(resolved) });
}

function parseBrokerConfig(bytes, definition) {
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('protected_overlay_config_invalid');
  }
  if (
    !isRecord(config)
    || !hasExactKeys(config, [
      'schemaVersion',
      'baseUrl',
      'expectedHost',
      'keyId',
      'hmacKeyBase64',
    ])
    || config.schemaVersion !== 1
    || typeof config.baseUrl !== 'string'
    || typeof config.expectedHost !== 'string'
    || typeof config.keyId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(config.keyId)
    || typeof config.hmacKeyBase64 !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(config.hmacKeyBase64)
  ) throw new Error('protected_overlay_config_invalid');
  let url;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error('protected_overlay_config_invalid');
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
    || url.search !== ''
    || url.hash !== ''
    || url.hostname !== config.expectedHost
    || url.hostname !== url.hostname.toLowerCase()
    || (!url.hostname.endsWith('.cloudfunctions.net') && !url.hostname.endsWith('.run.app'))
    || url.pathname !== `/${definition.brokerIdentity.functionName}`
    || url.href !== config.baseUrl
    || config.baseUrl.includes('%')
    || config.baseUrl.includes('\\')
    || /[\s\u0000-\u001f\u007f]/u.test(config.baseUrl)
  ) throw new Error('protected_overlay_config_invalid');
  const signingKey = Buffer.from(config.hmacKeyBase64, 'base64');
  if (signingKey.length < 32 || signingKey.toString('base64') !== config.hmacKeyBase64) {
    throw new Error('protected_overlay_config_invalid');
  }
  return Object.freeze({ signingKey });
}

function assertBackendFactory(bytes, definition) {
  const source = bytes.toString('utf8');
  const expectedVariable = definition.externalInputs.brokerConfigEnvironmentVariable;
  const expectedClass = definition.externalInputs.factoryClass;
  const other = REALM_DEFINITIONS.find(({ realm }) => realm !== definition.realm);
  if (
    !source.includes(expectedVariable)
    || !source.includes(expectedClass)
    || !source.includes('fromPrivateConfigFile')
    || source.includes(other.externalInputs.brokerConfigEnvironmentVariable)
    || source.includes(other.externalInputs.factoryClass)
  ) throw new Error('protected_overlay_backend_factory_invalid');
}

function readPrivateContentInventory(path, documentRoot, expectedFiles, identities) {
  const resolved = realDirectory(path, 0o700);
  if (!isOutsideDirectory(resolved, documentRoot)) {
    throw new Error('protected_overlay_private_content_invalid');
  }
  const directoryStat = lstatSync(resolved);
  const directoryIdentity = `${directoryStat.dev}:${directoryStat.ino}`;
  if (identities.has(directoryIdentity)) throw new Error('protected_overlay_private_content_invalid');
  identities.add(directoryIdentity);
  const entries = readdirSync(resolved, { withFileTypes: true }).sort((left, right) => (
    compareText(left.name, right.name)
  ));
  if (canonical(entries.map(({ name }) => name)) !== canonical(expectedFiles)) {
    throw new Error('protected_overlay_private_content_invalid');
  }
  const files = Object.freeze(entries.map(({ name }) => {
    const file = readPrivateActivationFile(
      resolve(resolved, name),
      documentRoot,
      identities,
      65536,
    );
    return Object.freeze({ path: name, size: file.bytes.length, sha256: sha256(file.bytes) });
  }));
  return Object.freeze({ path: resolved, files });
}

function normalizePhpHarness(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['evidenceSha256', 'phpVersionId', 'status'])
    || value.status !== 'passed'
    || !Number.isSafeInteger(value.phpVersionId)
    || value.phpVersionId < 80200
    || typeof value.evidenceSha256 !== 'string'
    || !HASH_PATTERN.test(value.evidenceSha256)
  ) throw new Error('protected_overlay_php_harness_gate_incomplete');
  return Object.freeze({
    evidenceSha256: value.evidenceSha256,
    phpVersionId: value.phpVersionId,
    status: value.status,
  });
}

function realDirectory(path, ...allowedModes) {
  const lexical = resolve(path);
  let resolved;
  let lexicalStat;
  try {
    lexicalStat = lstatSync(lexical);
    resolved = realpathSync(lexical);
  } catch {
    throw new Error('protected_overlay_directory_invalid');
  }
  const stat = lstatSync(resolved);
  if (
    lexicalStat.isSymbolicLink()
    || !lexicalStat.isDirectory()
    || !stat.isDirectory()
    || stat.isSymbolicLink()
    || !allowedModes.includes(stat.mode & 0o777)
  ) throw new Error('protected_overlay_directory_invalid');
  return resolved;
}

function isOutsideDirectory(path, directory) {
  return path !== directory && !path.startsWith(`${directory}${sep}`);
}

function assertRealmSecurityBoundary(definition, files) {
  const headers = files.find(({ path }) => path === '.htaccess');
  const runtime = files.find(({ path }) => path === 'lib/runtime.php');
  if (!headers || headers.sha256 !== definition.headersSha256 || !runtime) {
    throw new Error('protected_overlay_headers_invalid');
  }
  const source = Buffer.from(runtime.bytesBase64, 'base64').toString('utf8');
  const { cookieName, functionName, signatureDomain } = definition.brokerIdentity;
  if (
    !source.includes(`'${cookieName}'`)
    || !source.includes(`'${signatureDomain}'`)
    || !source.includes(`'/${functionName}'`)
  ) {
    throw new Error('protected_overlay_broker_identity_invalid');
  }
  const otherDefinition = REALM_DEFINITIONS.find(({ realm }) => realm !== definition.realm);
  if (
    source.includes(`'${otherDefinition.brokerIdentity.cookieName}'`)
    || source.includes(`'${otherDefinition.brokerIdentity.signatureDomain}'`)
    || source.includes(`'/${otherDefinition.brokerIdentity.functionName}'`)
  ) {
    throw new Error('protected_overlay_broker_identity_invalid');
  }
}

function assertArtifactPins(releaseId, inventorySha256, artifactSha256) {
  if (
    typeof releaseId !== 'string'
    || !new RegExp(`^${RELEASE_PREFIX}[a-f0-9]{64}$`, 'u').test(releaseId)
    || typeof inventorySha256 !== 'string'
    || !HASH_PATTERN.test(inventorySha256)
    || typeof artifactSha256 !== 'string'
    || !HASH_PATTERN.test(artifactSha256)
  ) {
    throw new Error('protected_overlay_pins_required');
  }
}

function assertPinObject(pins) {
  if (
    !isRecord(pins)
    || !hasExactKeys(pins, [
      'expectedReleaseId',
      'expectedInventorySha256',
      'expectedArtifactSha256',
    ])
  ) throw new Error('protected_overlay_pins_required');
  assertArtifactPins(
    pins.expectedReleaseId,
    pins.expectedInventorySha256,
    pins.expectedArtifactSha256,
  );
}

function assertExactInventory(root, expectedPaths) {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('protected_overlay_source_invalid');
  }
  const found = [];
  const foundDirectories = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('protected_overlay_symlink_rejected');
      if (stat.isDirectory()) {
        foundDirectories.push(relative(root, absolute).split(sep).join('/'));
        walk(absolute);
      }
      else if (stat.isFile()) found.push(relative(root, absolute).split(sep).join('/'));
      else throw new Error('protected_overlay_special_file_rejected');
    }
  };
  walk(root);
  found.sort(compareText);
  foundDirectories.sort(compareText);
  const expectedDirectories = new Set();
  for (const path of expectedPaths) {
    const components = path.split('/');
    for (let index = 1; index < components.length; index += 1) {
      expectedDirectories.add(components.slice(0, index).join('/'));
    }
  }
  if (
    canonical(found) !== canonical(expectedPaths)
    || canonical(foundDirectories) !== canonical([...expectedDirectories].sort(compareText))
  ) {
    throw new Error('protected_overlay_inventory_invalid');
  }
}

function readRegularFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('protected_overlay_file_invalid');
  }
  return readFileSync(path);
}

function mediaTypeFor(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.php')) return 'application/x-httpd-php';
  if (path === '.htaccess') return 'text/plain; charset=utf-8';
  throw new Error('protected_overlay_media_type_invalid');
}

function canonical(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return canonical(Object.keys(value).sort(compareText)) === canonical([...keys].sort(compareText));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
