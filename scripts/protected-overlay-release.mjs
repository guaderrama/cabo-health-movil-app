import {
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  createProtectedOverlayActivationPlan,
  createProtectedOverlayArtifact,
  createProtectedOverlayDeploymentEvidence,
  createProtectedOverlayDeploymentEvidenceRequest,
  createProtectedOverlayHistoricalPredecessorEvidenceRequest,
  deactivateFirstProtectedOverlays,
  promoteProtectedOverlays,
  rollbackProtectedOverlays,
  verifyProtectedOverlayAbsence,
  verifyProtectedOverlayDeployment,
  verifyProtectedOverlayArtifact,
} from './protected-overlay-release-gate.mjs';
import {
  readDescriptorBoundCanonicalJson,
} from './protected-overlay-secure-fs.mjs';

const [command, ...argumentList] = process.argv.slice(2);
const arguments_ = parseArguments(argumentList);

switch (command) {
  case 'create-artifact': {
    assertExactArguments(arguments_, ['--project-root', '--out']);
    const artifact = createProtectedOverlayArtifact({
      projectRoot: arguments_['--project-root'],
    });
    writeImmutableJson(arguments_['--out'], artifact);
    print({
      status: 'created',
      releaseId: artifact.releaseId,
      inventorySha256: artifact.inventorySha256,
      artifactSha256: artifact.artifactSha256,
    });
    break;
  }
  case 'verify-artifact': {
    assertExactArguments(arguments_, [
      '--project-root',
      '--artifact',
      '--release-id',
      '--inventory-sha256',
      '--artifact-sha256',
    ]);
    const artifact = readCanonicalJson(arguments_['--artifact'], 0o400);
    const verified = verifyProtectedOverlayArtifact({
      artifact,
      projectRoot: arguments_['--project-root'],
      expectedReleaseId: arguments_['--release-id'],
      expectedInventorySha256: arguments_['--inventory-sha256'],
      expectedArtifactSha256: arguments_['--artifact-sha256'],
    });
    print({
      status: 'verified',
      releaseId: verified.releaseId,
      inventorySha256: verified.inventorySha256,
      artifactSha256: verified.artifactSha256,
    });
    break;
  }
  case 'create-activation': {
    assertExactArguments(arguments_, [
      '--deployment-root',
      '--inputs',
      '--out',
      '--trust-policy',
      '--trust-policy-sha256',
    ]);
    const inputs = readCanonicalJson(arguments_['--inputs'], 0o400);
    if (!isRecord(inputs) || !hasExactKeys(inputs, ['realms'])) {
      throw new Error('protected_overlay_activation_inputs_invalid');
    }
    const activation = createProtectedOverlayActivationPlan({
      deploymentRoot: arguments_['--deployment-root'],
      realms: inputs.realms,
      trustPolicy: readCanonicalJson(arguments_['--trust-policy'], 0o400),
      expectedTrustPolicySha256: arguments_['--trust-policy-sha256'],
    });
    writeImmutableJson(arguments_['--out'], activation);
    print({
      status: 'created',
      activationSha256: activation.activationSha256,
    });
    break;
  }
  case 'create-evidence-request': {
    assertExactArguments(arguments_, [
      ...deploymentArgumentNames({ includeEvidence: false }),
      '--out',
    ]);
    const request = createProtectedOverlayDeploymentEvidenceRequest(
      readDeploymentArguments(arguments_, { includeEvidence: false }),
    );
    writeImmutableJson(arguments_['--out'], request);
    print({
      status: 'created',
      requestSha256: request.requestSha256,
    });
    break;
  }
  case 'create-historical-predecessor-evidence-request': {
    assertExactArguments(arguments_, [
      ...deploymentArgumentNames({ includeEvidence: false }),
      '--out',
    ]);
    const request = createProtectedOverlayHistoricalPredecessorEvidenceRequest(
      readDeploymentArguments(arguments_, { includeEvidence: false }),
    );
    writeImmutableJson(arguments_['--out'], request);
    print({
      status: 'created',
      requestSha256: request.requestSha256,
    });
    break;
  }
  case 'assemble-evidence': {
    assertExactArguments(arguments_, [
      '--request',
      '--production-attestation',
      '--review-attestation',
      '--trust-policy',
      '--trust-policy-sha256',
      '--out',
    ]);
    const evidence = createProtectedOverlayDeploymentEvidence({
      attestations: {
        production: readCanonicalJson(arguments_['--production-attestation'], 0o400),
        review: readCanonicalJson(arguments_['--review-attestation'], 0o400),
      },
      evidenceRequest: readCanonicalJson(arguments_['--request'], 0o400),
      expectedTrustPolicySha256: arguments_['--trust-policy-sha256'],
      trustPolicy: readCanonicalJson(arguments_['--trust-policy'], 0o400),
    });
    writeImmutableJson(arguments_['--out'], evidence);
    print({
      status: 'created',
      evidenceSha256: evidence.evidenceSha256,
    });
    break;
  }
  case 'promote': {
    const historicalArgumentNames = historicalPredecessorArgumentNames();
    const includesHistoricalAuthority = historicalArgumentNames.some((name) => (
      Object.hasOwn(arguments_, name)
    ));
    assertExactArguments(arguments_, [
      ...deploymentArgumentNames(),
      '--predecessor-release-id',
      ...(includesHistoricalAuthority ? historicalArgumentNames : []),
    ]);
    print(promoteProtectedOverlays({
      ...readDeploymentArguments(arguments_),
      expectedPredecessorReleaseId: arguments_['--predecessor-release-id'],
      ...(includesHistoricalAuthority ? {
        historicalPredecessorAuthority: {
          artifact: readCanonicalJson(
            arguments_['--historical-predecessor-artifact'],
            0o400,
          ),
          evidence: readCanonicalJson(
            arguments_['--historical-predecessor-evidence'],
            0o400,
          ),
          expectedReleaseId: arguments_['--historical-predecessor-release-id'],
          expectedInventorySha256:
            arguments_['--historical-predecessor-inventory-sha256'],
          expectedArtifactSha256:
            arguments_['--historical-predecessor-artifact-sha256'],
          expectedEvidenceSha256:
            arguments_['--historical-predecessor-evidence-sha256'],
        },
      } : {}),
    }));
    break;
  }
  case 'verify-deployment': {
    assertExactArguments(arguments_, deploymentArgumentNames());
    print(verifyProtectedOverlayDeployment(readDeploymentArguments(arguments_)));
    break;
  }
  case 'deactivate-first': {
    assertExactArguments(arguments_, [
      '--deployment-root',
      '--activation',
      '--activation-sha256',
      '--current-evidence-sha256',
      '--current-release-id',
      '--current-inventory-sha256',
      '--current-artifact-sha256',
      '--trust-policy',
      '--trust-policy-sha256',
    ]);
    print(deactivateFirstProtectedOverlays({
      deploymentRoot: arguments_['--deployment-root'],
      activation: readCanonicalJson(arguments_['--activation'], 0o400),
      expectedActivationSha256: arguments_['--activation-sha256'],
      expectedCurrentEvidenceSha256: arguments_['--current-evidence-sha256'],
      expectedCurrentReleaseId: arguments_['--current-release-id'],
      expectedTrustPolicySha256: arguments_['--trust-policy-sha256'],
      trustPolicy: readCanonicalJson(arguments_['--trust-policy'], 0o400),
      currentPins: {
        expectedReleaseId: arguments_['--current-release-id'],
        expectedInventorySha256: arguments_['--current-inventory-sha256'],
        expectedArtifactSha256: arguments_['--current-artifact-sha256'],
      },
    }));
    break;
  }
  case 'verify-absence': {
    assertExactArguments(arguments_, [
      '--deployment-root',
      '--activation-sha256',
      '--current-evidence-sha256',
      '--current-release-id',
      '--current-inventory-sha256',
      '--current-artifact-sha256',
    ]);
    print(verifyProtectedOverlayAbsence({
      deploymentRoot: arguments_['--deployment-root'],
      expectedActivationSha256: arguments_['--activation-sha256'],
      expectedCurrentEvidenceSha256: arguments_['--current-evidence-sha256'],
      expectedCurrentReleaseId: arguments_['--current-release-id'],
      currentPins: {
        expectedReleaseId: arguments_['--current-release-id'],
        expectedInventorySha256: arguments_['--current-inventory-sha256'],
        expectedArtifactSha256: arguments_['--current-artifact-sha256'],
      },
    }));
    break;
  }
  case 'rollback': {
    assertExactArguments(arguments_, [
      '--deployment-root',
      '--activation',
      '--activation-sha256',
      '--current-evidence-sha256',
      '--current-release-id',
      '--current-inventory-sha256',
      '--current-artifact-sha256',
      '--predecessor-release-id',
      '--predecessor-inventory-sha256',
      '--predecessor-artifact-sha256',
      '--predecessor-evidence-sha256',
      '--trust-policy',
      '--trust-policy-sha256',
    ]);
    print(rollbackProtectedOverlays({
      deploymentRoot: arguments_['--deployment-root'],
      activation: readCanonicalJson(arguments_['--activation'], 0o400),
      expectedActivationSha256: arguments_['--activation-sha256'],
      expectedCurrentReleaseId: arguments_['--current-release-id'],
      expectedCurrentEvidenceSha256: arguments_['--current-evidence-sha256'],
      expectedPredecessorReleaseId: arguments_['--predecessor-release-id'],
      expectedPredecessorEvidenceSha256: arguments_['--predecessor-evidence-sha256'],
      expectedTrustPolicySha256: arguments_['--trust-policy-sha256'],
      trustPolicy: readCanonicalJson(arguments_['--trust-policy'], 0o400),
      currentPins: {
        expectedReleaseId: arguments_['--current-release-id'],
        expectedInventorySha256: arguments_['--current-inventory-sha256'],
        expectedArtifactSha256: arguments_['--current-artifact-sha256'],
      },
      predecessorPins: {
        expectedReleaseId: arguments_['--predecessor-release-id'],
        expectedInventorySha256: arguments_['--predecessor-inventory-sha256'],
        expectedArtifactSha256: arguments_['--predecessor-artifact-sha256'],
      },
    }));
    break;
  }
  default:
    throw new Error('protected_overlay_command_invalid');
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (
      typeof name !== 'string'
      || !name.startsWith('--')
      || typeof value !== 'string'
      || value.startsWith('--')
      || Object.hasOwn(result, name)
    ) throw new Error('protected_overlay_arguments_invalid');
    result[name] = value;
  }
  return result;
}

function assertExactArguments(arguments_, expectedNames) {
  const actual = Object.keys(arguments_).sort(compareText);
  const expected = [...expectedNames].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('protected_overlay_arguments_invalid');
  }
}

function writeImmutableJson(path, value) {
  writeFileSync(resolve(path), `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o400,
  });
}

function readCanonicalJson(path, expectedMode) {
  return readDescriptorBoundCanonicalJson(path, {
    allowedModes: [expectedMode],
    errorCode: 'protected_overlay_input_file_invalid',
    expectedParentModes: [0o700, 0o755],
    maximumSize: 16 * 1024 * 1024,
  });
}

function deploymentArgumentNames({ includeEvidence = true } = {}) {
  const names = [
    '--project-root',
    '--deployment-root',
    '--artifact',
    '--activation',
    '--release-id',
    '--inventory-sha256',
    '--artifact-sha256',
    '--activation-sha256',
    '--trust-policy',
    '--trust-policy-sha256',
  ];
  if (includeEvidence) names.push('--evidence', '--evidence-sha256');
  return names;
}

function historicalPredecessorArgumentNames() {
  return [
    '--historical-predecessor-artifact',
    '--historical-predecessor-release-id',
    '--historical-predecessor-inventory-sha256',
    '--historical-predecessor-artifact-sha256',
    '--historical-predecessor-evidence',
    '--historical-predecessor-evidence-sha256',
  ];
}

function readDeploymentArguments(arguments_, { includeEvidence = true } = {}) {
  const deployment = {
    projectRoot: arguments_['--project-root'],
    deploymentRoot: arguments_['--deployment-root'],
    artifact: readCanonicalJson(arguments_['--artifact'], 0o400),
    activation: readCanonicalJson(arguments_['--activation'], 0o400),
    expectedReleaseId: arguments_['--release-id'],
    expectedInventorySha256: arguments_['--inventory-sha256'],
    expectedArtifactSha256: arguments_['--artifact-sha256'],
    expectedActivationSha256: arguments_['--activation-sha256'],
    expectedTrustPolicySha256: arguments_['--trust-policy-sha256'],
    trustPolicy: readCanonicalJson(arguments_['--trust-policy'], 0o400),
  };
  if (includeEvidence) {
    deployment.evidence = readCanonicalJson(arguments_['--evidence'], 0o400);
    deployment.expectedEvidenceSha256 = arguments_['--evidence-sha256'];
  }
  return deployment;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return JSON.stringify(Object.keys(value).sort(compareText))
    === JSON.stringify([...keys].sort(compareText));
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
