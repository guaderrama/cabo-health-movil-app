import {
  lstatSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  createProtectedOverlayActivationPlan,
  createProtectedOverlayArtifact,
  promoteProtectedOverlays,
  rollbackProtectedOverlays,
  verifyProtectedOverlayDeployment,
  verifyProtectedOverlayArtifact,
} from './protected-overlay-release-gate.mjs';

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
    ]);
    const inputs = readCanonicalJson(arguments_['--inputs'], 0o400);
    if (!isRecord(inputs) || !hasExactKeys(inputs, ['realms'])) {
      throw new Error('protected_overlay_activation_inputs_invalid');
    }
    const activation = createProtectedOverlayActivationPlan({
      deploymentRoot: arguments_['--deployment-root'],
      realms: inputs.realms,
    });
    writeImmutableJson(arguments_['--out'], activation);
    print({
      status: 'created',
      activationSha256: activation.activationSha256,
    });
    break;
  }
  case 'promote': {
    assertExactArguments(arguments_, [
      ...deploymentArgumentNames(),
      '--predecessor-release-id',
    ]);
    print(promoteProtectedOverlays({
      ...readDeploymentArguments(arguments_),
      expectedPredecessorReleaseId: arguments_['--predecessor-release-id'],
    }));
    break;
  }
  case 'verify-deployment': {
    assertExactArguments(arguments_, deploymentArgumentNames());
    print(verifyProtectedOverlayDeployment(readDeploymentArguments(arguments_)));
    break;
  }
  case 'rollback': {
    assertExactArguments(arguments_, [
      '--deployment-root',
      '--activation',
      '--activation-sha256',
      '--current-release-id',
      '--current-inventory-sha256',
      '--current-artifact-sha256',
      '--predecessor-release-id',
      '--predecessor-inventory-sha256',
      '--predecessor-artifact-sha256',
    ]);
    print(rollbackProtectedOverlays({
      deploymentRoot: arguments_['--deployment-root'],
      activation: readCanonicalJson(arguments_['--activation'], 0o400),
      expectedActivationSha256: arguments_['--activation-sha256'],
      expectedCurrentReleaseId: arguments_['--current-release-id'],
      expectedPredecessorReleaseId: arguments_['--predecessor-release-id'],
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
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== expectedMode) {
    throw new Error('protected_overlay_input_file_invalid');
  }
  const source = readFileSync(absolute, 'utf8');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('protected_overlay_input_file_invalid');
  }
  if (source !== `${JSON.stringify(value)}\n`) {
    throw new Error('protected_overlay_input_file_invalid');
  }
  return value;
}

function deploymentArgumentNames() {
  return [
    '--project-root',
    '--deployment-root',
    '--artifact',
    '--activation',
    '--release-id',
    '--inventory-sha256',
    '--artifact-sha256',
    '--activation-sha256',
  ];
}

function readDeploymentArguments(arguments_) {
  return {
    projectRoot: arguments_['--project-root'],
    deploymentRoot: arguments_['--deployment-root'],
    artifact: readCanonicalJson(arguments_['--artifact'], 0o400),
    activation: readCanonicalJson(arguments_['--activation'], 0o400),
    expectedReleaseId: arguments_['--release-id'],
    expectedInventorySha256: arguments_['--inventory-sha256'],
    expectedArtifactSha256: arguments_['--artifact-sha256'],
    expectedActivationSha256: arguments_['--activation-sha256'],
  };
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
