import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
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
const TRUST_POLICY_KIND = 'cabohealth-protected-overlay-trust-policy-v1';
const EVIDENCE_REQUEST_KIND = 'cabohealth-protected-overlay-evidence-request-v1';
const EVIDENCE_KIND = 'cabohealth-protected-overlay-deployment-evidence-v1';
const ATTESTATION_KIND = 'cabohealth-protected-overlay-hostinger-attestation-v1';
const ATTESTATION_SIGNATURE_DOMAIN = 'cabohealth-protected-overlay-hostinger-attestation-v1';
const ACTIVATION_REALM_INPUT_KEYS = Object.freeze([
  'backendFactoryPath',
  'brokerConfigPath',
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
      responseSignatureDomain: 'cabohealth-broker-response-v1',
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
      phpHarnessSha256: 'c8977a71d740ac7be0a745548e0a0c3fc3904028a19fe4b460bdb2755a67ca21',
      phpHarnessOutput: 'client resource broker: ok\n',
      attestorPath: 'tools/hosting/protected-overlay-attestor.php',
      attestorSha256: 'c509d78a0c4696f36ba86543b7236142e4c241b14990921b912b0c60cc336c68',
      attestationKeyEnvironmentVariable: 'CABOHEALTH_CLIENT_RESOURCES_ATTESTATION_KEY',
      contentFiles: Object.freeze(['en.json', 'es-MX.json']),
      factoryClass: 'SignedFunctionsClientResourcesBackend',
      backendFactorySha256: '8debc4e5bcf1fbbaef8426fa47f9def98ce0718146b1ee5cab61235d892a2972',
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
      responseSignatureDomain: 'cabohealth-app-review-broker-response-v1',
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
      phpHarnessSha256: 'd30b39aa480a02897868ec33ca7f434adec8e833bce4e53e33c889095edf171b',
      phpHarnessOutput: 'app review broker: ok\n',
      attestorPath: 'tools/hosting/protected-overlay-attestor.php',
      attestorSha256: 'c509d78a0c4696f36ba86543b7236142e4c241b14990921b912b0c60cc336c68',
      attestationKeyEnvironmentVariable: 'CABOHEALTH_APP_REVIEW_ATTESTATION_KEY',
      contentFiles: Object.freeze(['sample.json']),
      factoryClass: 'SignedFunctionsAppReviewBackend',
      backendFactorySha256: '2b8ab60cc1c023d3e652127adb5e2a1be8dc5c746f7314957d16a589dbde13bf',
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
    const phpHarnessBytes = readRegularFile(resolve(root, definition.externalInputs.phpHarnessPath));
    if (sha256(phpHarnessBytes) !== definition.externalInputs.phpHarnessSha256) {
      throw new Error('protected_overlay_php_harness_source_invalid');
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
          size: phpHarnessBytes.length,
          sha256: sha256(phpHarnessBytes),
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

export function createProtectedOverlayActivationPlan({
  deploymentRoot,
  expectedTrustPolicySha256,
  realms,
  trustPolicy,
}) {
  const root = realDirectory(deploymentRoot, 0o700, 0o755);
  const documentRoot = realDirectory(resolve(root, 'public_html'), 0o755);
  const verifiedTrustPolicy = validateTrustPolicy(trustPolicy, expectedTrustPolicySha256);
  if (!isRecord(realms) || !hasExactKeys(realms, ['production', 'review'])) {
    throw new Error('protected_overlay_activation_invalid');
  }
  const privateIdentities = new Set();
  const signingKeys = [];
  const normalizedRealms = Object.freeze(REALM_DEFINITIONS.map((definition, index) => {
    const input = realms[definition.realm];
    const trustedRealm = verifiedTrustPolicy.realms[index];
    if (!isRecord(input) || !hasExactKeys(input, ACTIVATION_REALM_INPUT_KEYS)) {
      throw new Error('protected_overlay_activation_invalid');
    }
    if (trustedRealm.runtimeIdentity.documentRoot !== documentRoot) {
      throw new Error('protected_overlay_runtime_identity_invalid');
    }
    const brokerConfig = readPrivateActivationFile(
      input.brokerConfigPath,
      documentRoot,
      privateIdentities,
      4096,
    );
    const config = parseBrokerConfig(
      brokerConfig.bytes,
      definition,
      trustedRealm,
    );
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
    return Object.freeze({
      realm: definition.realm,
      runtimeIdentity: trustedRealm.runtimeIdentity,
      attestorIdentity: Object.freeze({
        keyEnvironmentVariable: definition.externalInputs.attestationKeyEnvironmentVariable,
        path: definition.externalInputs.attestorPath,
        publicKeyDerBase64: trustedRealm.publicKeyDerBase64,
        sha256: definition.externalInputs.attestorSha256,
      }),
      brokerIdentity: Object.freeze({
        baseUrl: config.baseUrl,
        expectedHost: config.expectedHost,
        firebaseProjectId: config.firebaseProjectId,
        functionName: definition.brokerIdentity.functionName,
        keyId: config.keyId,
      }),
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
    });
  }));
  if (signingKeys[0].equals(signingKeys[1])) {
    throw new Error('protected_overlay_broker_identity_invalid');
  }
  const core = Object.freeze({
    schemaVersion: 1,
    artifactKind: ACTIVATION_KIND,
    trustPolicySha256: verifiedTrustPolicy.trustPolicySha256,
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
  expectedTrustPolicySha256,
  trustPolicy,
}) {
  if (typeof expectedActivationSha256 !== 'string' || !HASH_PATTERN.test(expectedActivationSha256)) {
    throw new Error('protected_overlay_activation_pin_required');
  }
  if (
    !isRecord(activation)
    || !hasExactKeys(activation, [
      'schemaVersion',
      'artifactKind',
      'trustPolicySha256',
      'realms',
      'activationSha256',
    ])
    || activation.schemaVersion !== 1
    || activation.artifactKind !== ACTIVATION_KIND
    || activation.trustPolicySha256 !== expectedTrustPolicySha256
    || !Array.isArray(activation.realms)
    || activation.realms.length !== REALM_DEFINITIONS.length
  ) throw new Error('protected_overlay_activation_invalid');
  const inputRealms = Object.fromEntries(activation.realms.map((realm) => [realm.realm, {
    backendFactoryPath: realm.backendFactory?.path,
    brokerConfigPath: realm.brokerConfig?.path,
    privateContentRoot: realm.privateContent?.path,
  }]));
  let expected;
  try {
    expected = createProtectedOverlayActivationPlan({
      deploymentRoot,
      expectedTrustPolicySha256,
      realms: inputRealms,
      trustPolicy,
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

export function createProtectedOverlayDeploymentEvidenceRequest({
  activation,
  artifact,
  deploymentRoot,
  expectedActivationSha256,
  expectedArtifactSha256,
  expectedInventorySha256,
  expectedReleaseId,
  expectedTrustPolicySha256,
  projectRoot,
  trustPolicy,
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
    expectedTrustPolicySha256,
    trustPolicy,
  });
  return buildDeploymentEvidenceRequest(
    verifiedArtifact,
    verifiedActivation,
    expectedTrustPolicySha256,
  );
}

export function verifyProtectedOverlayDeploymentEvidence({
  evidence,
  evidenceRequest,
  expectedEvidenceSha256,
  expectedTrustPolicySha256,
  trustPolicy,
}) {
  if (typeof expectedEvidenceSha256 !== 'string' || !HASH_PATTERN.test(expectedEvidenceSha256)) {
    throw new Error('protected_overlay_evidence_pin_required');
  }
  const verifiedTrustPolicy = validateTrustPolicy(trustPolicy, expectedTrustPolicySha256);
  validateEvidenceRequest(
    evidenceRequest,
    expectedTrustPolicySha256,
    verifiedTrustPolicy,
  );
  if (
    !isRecord(evidence)
    || !hasExactKeys(evidence, [
      'schemaVersion',
      'evidenceKind',
      'requestSha256',
      'attestations',
      'evidenceSha256',
    ])
    || evidence.schemaVersion !== 1
    || evidence.evidenceKind !== EVIDENCE_KIND
    || evidence.requestSha256 !== evidenceRequest.requestSha256
    || !Array.isArray(evidence.attestations)
    || evidence.attestations.length !== REALM_DEFINITIONS.length
    || evidence.evidenceSha256 !== expectedEvidenceSha256
  ) throw new Error('protected_overlay_evidence_invalid');
  const core = {
    schemaVersion: evidence.schemaVersion,
    evidenceKind: evidence.evidenceKind,
    requestSha256: evidence.requestSha256,
    attestations: evidence.attestations,
  };
  if (sha256(canonical(core)) !== expectedEvidenceSha256) {
    throw new Error('protected_overlay_evidence_invalid');
  }
  for (let index = 0; index < REALM_DEFINITIONS.length; index += 1) {
    const attestation = evidence.attestations[index];
    const request = evidenceRequest.realms[index];
    if (
      !isRecord(attestation)
      || !hasExactKeys(attestation, ['realm', 'result', 'signatureBase64'])
      || attestation.realm !== request.realm
      || !isRecord(attestation.result)
      || !hasExactKeys(attestation.result, [
        'configuredEnvironment',
        'phpHarness',
        'runtimeIdentity',
        'status',
      ])
      || attestation.result.status !== 'passed'
      || canonical(attestation.result.configuredEnvironment)
        !== canonical(request.configuredEnvironment)
      || canonical(attestation.result.runtimeIdentity) !== canonical(request.runtimeIdentity)
      || !isRecord(attestation.result.phpHarness)
      || !hasExactKeys(attestation.result.phpHarness, [
        'outputBase64',
        'outputSha256',
        'path',
        'phpVersionId',
        'sourceSha256',
        'status',
      ])
      || attestation.result.phpHarness.path !== request.phpHarness.path
      || attestation.result.phpHarness.sourceSha256 !== request.phpHarness.sourceSha256
      || attestation.result.phpHarness.outputBase64 !== request.phpHarness.expectedOutputBase64
      || attestation.result.phpHarness.outputSha256 !== request.phpHarness.expectedOutputSha256
      || attestation.result.phpHarness.status !== 'passed'
      || !Number.isSafeInteger(attestation.result.phpHarness.phpVersionId)
      || attestation.result.phpHarness.phpVersionId
        !== request.runtimeIdentity.phpCliVersionId
      || typeof attestation.signatureBase64 !== 'string'
    ) throw new Error('protected_overlay_evidence_invalid');
    const signature = Buffer.from(attestation.signatureBase64, 'base64');
    if (
      signature.length !== 64
      || signature.toString('base64') !== attestation.signatureBase64
    ) throw new Error('protected_overlay_evidence_invalid');
    const signed = Object.freeze({
      schemaVersion: 1,
      attestationKind: ATTESTATION_KIND,
      request,
      result: attestation.result,
    });
    if (!verifySignature(
      null,
      Buffer.from(`${ATTESTATION_SIGNATURE_DOMAIN}\n${canonical(signed)}`, 'utf8'),
      verifiedTrustPolicy.realms[index].publicKey,
      signature,
    )) throw new Error('protected_overlay_evidence_invalid');
  }
  return evidence;
}

export function createProtectedOverlayDeploymentEvidence({
  attestations,
  evidenceRequest,
  expectedTrustPolicySha256,
  trustPolicy,
}) {
  if (!isRecord(attestations) || !hasExactKeys(attestations, ['production', 'review'])) {
    throw new Error('protected_overlay_evidence_invalid');
  }
  const core = Object.freeze({
    schemaVersion: 1,
    evidenceKind: EVIDENCE_KIND,
    requestSha256: evidenceRequest?.requestSha256,
    attestations: Object.freeze(REALM_DEFINITIONS.map(({ realm }) => attestations[realm])),
  });
  const evidence = Object.freeze({
    ...core,
    evidenceSha256: sha256(canonical(core)),
  });
  return verifyProtectedOverlayDeploymentEvidence({
    evidence,
    evidenceRequest,
    expectedEvidenceSha256: evidence.evidenceSha256,
    expectedTrustPolicySha256,
    trustPolicy,
  });
}

function buildDeploymentEvidenceRequest(artifact, activation, trustPolicySha256) {
  const realms = Object.freeze(REALM_DEFINITIONS.map((definition, index) => {
    const artifactRealm = artifact.realms[index];
    const activationRealm = activation.realms[index];
    const harnessOutput = Buffer.from(definition.externalInputs.phpHarnessOutput, 'utf8');
    return Object.freeze({
      realm: definition.realm,
      artifactRealmSha256: sha256(canonical(artifactRealm)),
      activationRealmSha256: sha256(canonical(activationRealm)),
      attestor: activationRealm.attestorIdentity,
      brokerIdentity: activationRealm.brokerIdentity,
      configuredEnvironment: Object.freeze([
        Object.freeze({
          name: definition.externalInputs.backendFactoryEnvironmentVariable,
          value: activationRealm.backendFactory.path,
        }),
        Object.freeze({
          name: definition.externalInputs.brokerConfigEnvironmentVariable,
          value: activationRealm.brokerConfig.path,
        }),
        Object.freeze({
          name: definition.externalInputs.privateContentEnvironmentVariable,
          value: activationRealm.privateContent.path,
        }),
      ]),
      runtimeIdentity: activationRealm.runtimeIdentity,
      inputs: Object.freeze({
        backendFactory: activationRealm.backendFactory,
        brokerConfig: activationRealm.brokerConfig,
        privateContent: activationRealm.privateContent,
      }),
      phpHarness: Object.freeze({
        path: definition.externalInputs.phpHarnessPath,
        sourceSha256: definition.externalInputs.phpHarnessSha256,
        minimumVersionId: 80200,
        expectedOutputBase64: harnessOutput.toString('base64'),
        expectedOutputSha256: sha256(harnessOutput),
      }),
    });
  }));
  const core = Object.freeze({
    schemaVersion: 1,
    requestKind: EVIDENCE_REQUEST_KIND,
    releaseId: artifact.releaseId,
    inventorySha256: artifact.inventorySha256,
    artifactSha256: artifact.artifactSha256,
    activationSha256: activation.activationSha256,
    trustPolicySha256,
    realms,
  });
  return Object.freeze({
    ...core,
    requestSha256: sha256(canonical(core)),
  });
}

function validateEvidenceRequest(request, expectedTrustPolicySha256, verifiedTrustPolicy) {
  if (
    !isRecord(request)
    || !hasExactKeys(request, [
      'schemaVersion',
      'requestKind',
      'releaseId',
      'inventorySha256',
      'artifactSha256',
      'activationSha256',
      'trustPolicySha256',
      'realms',
      'requestSha256',
    ])
    || request.schemaVersion !== 1
    || request.requestKind !== EVIDENCE_REQUEST_KIND
    || request.trustPolicySha256 !== expectedTrustPolicySha256
    || typeof request.releaseId !== 'string'
    || !request.releaseId.startsWith(RELEASE_PREFIX)
    || !HASH_PATTERN.test(request.releaseId.slice(RELEASE_PREFIX.length))
    || !HASH_PATTERN.test(request.inventorySha256)
    || !HASH_PATTERN.test(request.artifactSha256)
    || !HASH_PATTERN.test(request.activationSha256)
    || !Array.isArray(request.realms)
    || request.realms.length !== REALM_DEFINITIONS.length
  ) throw new Error('protected_overlay_evidence_request_invalid');
  const core = {
    schemaVersion: request.schemaVersion,
    requestKind: request.requestKind,
    releaseId: request.releaseId,
    inventorySha256: request.inventorySha256,
    artifactSha256: request.artifactSha256,
    activationSha256: request.activationSha256,
    trustPolicySha256: request.trustPolicySha256,
    realms: request.realms,
  };
  if (sha256(canonical(core)) !== request.requestSha256) {
    throw new Error('protected_overlay_evidence_request_invalid');
  }
  for (let index = 0; index < REALM_DEFINITIONS.length; index += 1) {
    const definition = REALM_DEFINITIONS[index];
    const realm = request.realms[index];
    const trustedRealm = verifiedTrustPolicy.realms[index];
    if (
      !isRecord(realm)
      || !hasExactKeys(realm, [
        'realm',
        'artifactRealmSha256',
        'activationRealmSha256',
        'attestor',
        'brokerIdentity',
        'configuredEnvironment',
        'inputs',
        'phpHarness',
        'runtimeIdentity',
      ])
      || realm.realm !== definition.realm
      || !HASH_PATTERN.test(realm.artifactRealmSha256)
      || !HASH_PATTERN.test(realm.activationRealmSha256)
      || !isRecord(realm.attestor)
      || !hasExactKeys(realm.attestor, [
        'keyEnvironmentVariable',
        'path',
        'publicKeyDerBase64',
        'sha256',
      ])
      || realm.attestor.keyEnvironmentVariable
        !== definition.externalInputs.attestationKeyEnvironmentVariable
      || realm.attestor.path !== definition.externalInputs.attestorPath
      || realm.attestor.sha256 !== definition.externalInputs.attestorSha256
      || realm.attestor.publicKeyDerBase64 !== trustedRealm.publicKeyDerBase64
      || !isRecord(realm.brokerIdentity)
      || !hasExactKeys(realm.brokerIdentity, [
        'baseUrl',
        'expectedHost',
        'firebaseProjectId',
        'functionName',
        'keyId',
      ])
      || realm.brokerIdentity.firebaseProjectId !== trustedRealm.firebaseProjectId
      || realm.brokerIdentity.baseUrl !== trustedRealm.brokerBaseUrl
      || realm.brokerIdentity.expectedHost !== trustedRealm.expectedHost
      || realm.brokerIdentity.functionName !== definition.brokerIdentity.functionName
      || typeof realm.brokerIdentity.keyId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(realm.brokerIdentity.keyId)
      || !Array.isArray(realm.configuredEnvironment)
      || realm.configuredEnvironment.length !== 3
      || realm.configuredEnvironment.some((entry) => (
        !isRecord(entry)
        || !hasExactKeys(entry, ['name', 'value'])
        || typeof entry.name !== 'string'
        || typeof entry.value !== 'string'
        || !entry.value.startsWith('/')
      ))
      || canonical(realm.configuredEnvironment.map(({ name }) => name)) !== canonical([
        definition.externalInputs.backendFactoryEnvironmentVariable,
        definition.externalInputs.brokerConfigEnvironmentVariable,
        definition.externalInputs.privateContentEnvironmentVariable,
      ])
      || !isRecord(realm.runtimeIdentity)
      || !hasExactKeys(realm.runtimeIdentity, [
        'documentRoot',
        'phpCliMode',
        'phpCliOwnerUid',
        'phpCliPath',
        'phpCliSha256',
        'phpCliSize',
        'phpCliVersionId',
        'phpSapi',
      ])
      || canonical(realm.runtimeIdentity) !== canonical(trustedRealm.runtimeIdentity)
      || !isRecord(realm.inputs)
      || !hasExactKeys(realm.inputs, ['backendFactory', 'brokerConfig', 'privateContent'])
      || !isActivationFileMetadata(realm.inputs.backendFactory)
      || !isActivationFileMetadata(realm.inputs.brokerConfig)
      || !isRecord(realm.inputs.privateContent)
      || !hasExactKeys(realm.inputs.privateContent, [
        'path',
        'inventorySha256',
        'files',
      ])
      || typeof realm.inputs.privateContent.path !== 'string'
      || !HASH_PATTERN.test(realm.inputs.privateContent.inventorySha256)
      || !Array.isArray(realm.inputs.privateContent.files)
      || !isRecord(realm.phpHarness)
      || !hasExactKeys(realm.phpHarness, [
        'path',
        'sourceSha256',
        'minimumVersionId',
        'expectedOutputBase64',
        'expectedOutputSha256',
      ])
      || realm.phpHarness.path !== definition.externalInputs.phpHarnessPath
      || realm.phpHarness.sourceSha256 !== definition.externalInputs.phpHarnessSha256
      || realm.phpHarness.minimumVersionId !== 80200
      || typeof realm.phpHarness.expectedOutputBase64 !== 'string'
      || !HASH_PATTERN.test(realm.phpHarness.expectedOutputSha256)
    ) throw new Error('protected_overlay_evidence_request_invalid');
  }
}

export function promoteProtectedOverlays({
  activation,
  artifact,
  deploymentRoot,
  evidence,
  expectedActivationSha256,
  expectedArtifactSha256,
  expectedEvidenceSha256,
  expectedInventorySha256,
  expectedPredecessorReleaseId,
  expectedReleaseId,
  expectedTrustPolicySha256,
  projectRoot,
  trustPolicy,
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
    expectedTrustPolicySha256,
    trustPolicy,
  });
  const evidenceRequest = buildDeploymentEvidenceRequest(
    verifiedArtifact,
    verifiedActivation,
    expectedTrustPolicySha256,
  );
  verifyProtectedOverlayDeploymentEvidence({
    evidence,
    evidenceRequest,
    expectedEvidenceSha256,
    expectedTrustPolicySha256,
    trustPolicy,
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
        evidenceSha256: expectedEvidenceSha256,
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
  expectedCurrentEvidenceSha256,
  expectedPredecessorReleaseId,
  expectedPredecessorEvidenceSha256,
  expectedTrustPolicySha256,
  predecessorPins,
  trustPolicy,
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
    || typeof expectedCurrentEvidenceSha256 !== 'string'
    || !HASH_PATTERN.test(expectedCurrentEvidenceSha256)
    || typeof expectedPredecessorEvidenceSha256 !== 'string'
    || !HASH_PATTERN.test(expectedPredecessorEvidenceSha256)
  ) throw new Error('protected_overlay_predecessor_mismatch');
  assertPinObject(currentPins);
  assertPinObject(predecessorPins);
  const verifiedActivation = verifyProtectedOverlayActivationPlan({
    activation,
    deploymentRoot,
    expectedActivationSha256,
    expectedTrustPolicySha256,
    trustPolicy,
  });
  const root = realDirectory(deploymentRoot, 0o700, 0o755);
  const documentRoot = realDirectory(resolve(root, 'public_html'), 0o755);
  const state = readManagedState(root);
  if (
    state === null
    || state.current.releaseId !== expectedCurrentReleaseId
    || state.predecessorReleaseId !== expectedPredecessorReleaseId
    || !stateMatchesArtifactPins(state.current, currentPins)
    || state.current.evidenceSha256 !== expectedCurrentEvidenceSha256
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
    || transition.predecessor.current.evidenceSha256 !== expectedPredecessorEvidenceSha256
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
  evidence,
  expectedActivationSha256,
  expectedArtifactSha256,
  expectedEvidenceSha256,
  expectedInventorySha256,
  expectedReleaseId,
  expectedTrustPolicySha256,
  projectRoot,
  trustPolicy,
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
    expectedTrustPolicySha256,
    trustPolicy,
  });
  const evidenceRequest = buildDeploymentEvidenceRequest(
    verifiedArtifact,
    verifiedActivation,
    expectedTrustPolicySha256,
  );
  verifyProtectedOverlayDeploymentEvidence({
    evidence,
    evidenceRequest,
    expectedEvidenceSha256,
    expectedTrustPolicySha256,
    trustPolicy,
  });
  const root = realDirectory(deploymentRoot, 0o700, 0o755);
  const state = readManagedState(root);
  if (
    state === null
    || state.current.releaseId !== verifiedArtifact.releaseId
    || state.current.inventorySha256 !== verifiedArtifact.inventorySha256
    || state.current.artifactSha256 !== verifiedArtifact.artifactSha256
    || state.current.activationSha256 !== verifiedActivation.activationSha256
    || state.current.evidenceSha256 !== expectedEvidenceSha256
  ) throw new Error('protected_overlay_deployment_state_invalid');
  for (const realm of verifiedArtifact.realms) {
    verifyRealmDirectory(resolve(root, ...realm.promoteTarget.split('/')), realm);
  }
  return Object.freeze({
    status: 'verified',
    releaseId: verifiedArtifact.releaseId,
    artifactSha256: verifiedArtifact.artifactSha256,
    activationSha256: verifiedActivation.activationSha256,
    evidenceSha256: expectedEvidenceSha256,
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
        'size',
        'sha256',
        'status',
      ])
      || realm.externalInputs.phpHarness.path !== definition.externalInputs.phpHarnessPath
      || realm.externalInputs.phpHarness.minimumVersion !== '8.2'
      || !Number.isSafeInteger(realm.externalInputs.phpHarness.size)
      || realm.externalInputs.phpHarness.size < 1
      || realm.externalInputs.phpHarness.sha256 !== definition.externalInputs.phpHarnessSha256
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
      'evidenceSha256',
    ])
    && typeof state.current.releaseId === 'string'
    && state.current.releaseId.startsWith(RELEASE_PREFIX)
    && HASH_PATTERN.test(state.current.releaseId.slice(RELEASE_PREFIX.length))
    && HASH_PATTERN.test(state.current.inventorySha256)
    && HASH_PATTERN.test(state.current.artifactSha256)
    && HASH_PATTERN.test(state.current.activationSha256)
    && HASH_PATTERN.test(state.current.evidenceSha256)
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

function validateTrustPolicy(policy, expectedTrustPolicySha256) {
  if (
    typeof expectedTrustPolicySha256 !== 'string'
    || !HASH_PATTERN.test(expectedTrustPolicySha256)
  ) throw new Error('protected_overlay_trust_policy_pin_required');
  if (
    !isRecord(policy)
    || !hasExactKeys(policy, [
      'schemaVersion',
      'policyKind',
      'region',
      'realms',
    ])
    || policy.schemaVersion !== 1
    || policy.policyKind !== TRUST_POLICY_KIND
    || policy.region !== 'us-central1'
    || !Array.isArray(policy.realms)
    || policy.realms.length !== REALM_DEFINITIONS.length
    || sha256(canonical(policy)) !== expectedTrustPolicySha256
  ) throw new Error('protected_overlay_trust_policy_invalid');
  const realms = Object.freeze(REALM_DEFINITIONS.map((definition, index) => {
    const realm = policy.realms[index];
    if (
      !isRecord(realm)
      || !hasExactKeys(realm, [
        'realm',
        'firebaseProjectId',
        'brokerBaseUrl',
        'runtimeIdentity',
        'attestationPublicKeyDerBase64',
        'attestorPath',
        'attestorSha256',
      ])
      || realm.realm !== definition.realm
      || typeof realm.firebaseProjectId !== 'string'
      || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(realm.firebaseProjectId)
      || realm.firebaseProjectId.startsWith('demo-')
      || realm.firebaseProjectId.includes('unconfigured')
      || typeof realm.brokerBaseUrl !== 'string'
      || realm.brokerBaseUrl !== `https://us-central1-${realm.firebaseProjectId}.cloudfunctions.net/${definition.brokerIdentity.functionName}`
      || !isRecord(realm.runtimeIdentity)
      || !hasExactKeys(realm.runtimeIdentity, [
        'documentRoot',
        'phpCliMode',
        'phpCliOwnerUid',
        'phpCliPath',
        'phpCliSha256',
        'phpCliSize',
        'phpCliVersionId',
        'phpSapi',
      ])
      || typeof realm.runtimeIdentity.documentRoot !== 'string'
      || realm.runtimeIdentity.documentRoot === '/'
      || !realm.runtimeIdentity.documentRoot.startsWith('/')
      || resolve(realm.runtimeIdentity.documentRoot) !== realm.runtimeIdentity.documentRoot
      || realm.runtimeIdentity.phpCliMode !== '0755'
      || !Number.isSafeInteger(realm.runtimeIdentity.phpCliOwnerUid)
      || realm.runtimeIdentity.phpCliOwnerUid < 0
      || typeof realm.runtimeIdentity.phpCliPath !== 'string'
      || !realm.runtimeIdentity.phpCliPath.startsWith('/')
      || resolve(realm.runtimeIdentity.phpCliPath) !== realm.runtimeIdentity.phpCliPath
      || !isOutsideDirectory(
        realm.runtimeIdentity.phpCliPath,
        realm.runtimeIdentity.documentRoot,
      )
      || !HASH_PATTERN.test(realm.runtimeIdentity.phpCliSha256)
      || !Number.isSafeInteger(realm.runtimeIdentity.phpCliSize)
      || realm.runtimeIdentity.phpCliSize < 1
      || !Number.isSafeInteger(realm.runtimeIdentity.phpCliVersionId)
      || realm.runtimeIdentity.phpCliVersionId < 80200
      || !['fpm-fcgi', 'apache2handler'].includes(realm.runtimeIdentity.phpSapi)
      || typeof realm.attestationPublicKeyDerBase64 !== 'string'
      || realm.attestorPath !== definition.externalInputs.attestorPath
      || realm.attestorSha256 !== definition.externalInputs.attestorSha256
    ) throw new Error('protected_overlay_trust_policy_invalid');
    const publicKeyDer = Buffer.from(realm.attestationPublicKeyDerBase64, 'base64');
    if (
      publicKeyDer.length < 32
      || publicKeyDer.length > 512
      || publicKeyDer.toString('base64') !== realm.attestationPublicKeyDerBase64
    ) throw new Error('protected_overlay_trust_policy_invalid');
    let publicKey;
    try {
      publicKey = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    } catch {
      throw new Error('protected_overlay_trust_policy_invalid');
    }
    if (
      publicKey.asymmetricKeyType !== 'ed25519'
      || !Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).equals(publicKeyDer)
    ) throw new Error('protected_overlay_trust_policy_invalid');
    return Object.freeze({
      realm: realm.realm,
      firebaseProjectId: realm.firebaseProjectId,
      brokerBaseUrl: realm.brokerBaseUrl,
      expectedHost: `us-central1-${realm.firebaseProjectId}.cloudfunctions.net`,
      runtimeIdentity: Object.freeze({
        documentRoot: realm.runtimeIdentity.documentRoot,
        phpCliMode: realm.runtimeIdentity.phpCliMode,
        phpCliOwnerUid: realm.runtimeIdentity.phpCliOwnerUid,
        phpCliPath: realm.runtimeIdentity.phpCliPath,
        phpCliSha256: realm.runtimeIdentity.phpCliSha256,
        phpCliSize: realm.runtimeIdentity.phpCliSize,
        phpCliVersionId: realm.runtimeIdentity.phpCliVersionId,
        phpSapi: realm.runtimeIdentity.phpSapi,
      }),
      publicKey,
      publicKeyDerBase64: realm.attestationPublicKeyDerBase64,
    });
  }));
  if (realms[0].publicKeyDerBase64 === realms[1].publicKeyDerBase64) {
    throw new Error('protected_overlay_trust_policy_invalid');
  }
  return Object.freeze({
    trustPolicySha256: expectedTrustPolicySha256,
    realms,
  });
}

function parseBrokerConfig(bytes, definition, trustedRealm) {
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
    || config.baseUrl !== trustedRealm.brokerBaseUrl
    || config.expectedHost !== trustedRealm.expectedHost
    || url.hostname !== config.expectedHost
    || url.hostname !== url.hostname.toLowerCase()
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
  return Object.freeze({
    baseUrl: config.baseUrl,
    expectedHost: config.expectedHost,
    firebaseProjectId: trustedRealm.firebaseProjectId,
    keyId: config.keyId,
    signingKey,
  });
}

function assertBackendFactory(bytes, definition) {
  if (sha256(bytes) !== definition.externalInputs.backendFactorySha256) {
    throw new Error('protected_overlay_backend_factory_invalid');
  }
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
  const {
    cookieName,
    functionName,
    responseSignatureDomain,
    signatureDomain,
  } = definition.brokerIdentity;
  if (
    !source.includes(`'${cookieName}'`)
    || !source.includes(`'${signatureDomain}'`)
    || !source.includes(`'${responseSignatureDomain}'`)
    || !source.includes(`'/${functionName}'`)
    || !source.includes('x-cabohealth-response-signature')
    || !source.includes('hash_equals($expectedResponseSignature, $responseSignature)')
  ) {
    throw new Error('protected_overlay_broker_identity_invalid');
  }
  const otherDefinition = REALM_DEFINITIONS.find(({ realm }) => realm !== definition.realm);
  if (
    source.includes(`'${otherDefinition.brokerIdentity.cookieName}'`)
    || source.includes(`'${otherDefinition.brokerIdentity.signatureDomain}'`)
    || source.includes(`'${otherDefinition.brokerIdentity.responseSignatureDomain}'`)
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

function isActivationFileMetadata(value) {
  return isRecord(value)
    && hasExactKeys(value, ['path', 'size', 'sha256'])
    && typeof value.path === 'string'
    && value.path.startsWith('/')
    && Number.isSafeInteger(value.size)
    && value.size > 0
    && HASH_PATTERN.test(value.sha256);
}

function hasExactKeys(value, keys) {
  return canonical(Object.keys(value).sort(compareText)) === canonical([...keys].sort(compareText));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
