import {
  CANDIDATE,
  RESOURCE_ID_PATTERN,
  SHA256_PATTERN,
  UUID_PATTERN,
} from './constants.mjs';
import { loadCredentials } from './auth.mjs';
import { reject } from './errors.mjs';
import { parseInternalGroupArguments } from './internal-group-arguments.mjs';
import {
  OBSERVATION_KEYS,
  assignInternalGroup,
  observeInternalGroup,
} from './internal-testflight.mjs';
import {
  readInternalPrivateJson,
  validateInternalOutputTarget,
  writeInternalOutput,
} from './secure-output.mjs';
import { AppStoreConnectTransport } from './transport.mjs';

function candidateExact(value) {
  return JSON.stringify(value) === JSON.stringify(CANDIDATE);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
}

const BUILD_INPUT_KEYS = [
  'schemaVersion', 'artifactKind', 'candidate', 'sourceCommit', 'sourceTreeSha256',
  'appJsonSha256', 'configSha256', 'packageLockSha256', 'releaseManifestSha256',
  'releaseVerifierSha256', 'metadataVerifierSha256', 'firebaseProjectId',
  'googleServicesPlistSha256', 'resolvedProductionExpoConfigSha256', 'nodeRuntime',
  'easCli', 'easEnvironmentInventorySha256', 'easEnvironment', 'reviewedAt',
];
const BUILD_ARTIFACT_KEYS = [
  'schemaVersion', 'artifactKind', 'candidate', 'buildInputAttestationSha256',
  'sourceTreeSha256', 'easBuildId', 'easArtifactAssociation', 'ipaSha256',
  'signedEntitlementsSha256', 'privacyReportSha256',
  'embeddedGoogleServicesPlistSha256', 'signingCertificateSha256',
  'embeddedProvisioningProfileSha256', 'reviewedAt',
];

function canonicalTime(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function readBindings(args) {
  const input = readInternalPrivateJson(
    args.buildInputAttestationPath,
    args.buildInputAttestationSha256,
  ).value;
  const artifact = readInternalPrivateJson(
    args.buildArtifactAttestationPath,
    args.buildArtifactAttestationSha256,
  ).value;
  if (!exactKeys(input, BUILD_INPUT_KEYS)
    || input.schemaVersion !== 1
    || input.artifactKind !== 'cabohealth-ios-build-input-attestation'
    || !candidateExact(input.candidate) || input.sourceCommit !== args.sourceCommit
    || !SHA256_PATTERN.test(input.sourceTreeSha256 ?? '')
    || !exactKeys(artifact, BUILD_ARTIFACT_KEYS)
    || artifact.schemaVersion !== 1
    || artifact.artifactKind !== 'cabohealth-ios-build-artifact-attestation'
    || !candidateExact(artifact.candidate)
    || artifact.buildInputAttestationSha256 !== args.buildInputAttestationSha256
    || artifact.sourceTreeSha256 !== input.sourceTreeSha256
    || !UUID_PATTERN.test(artifact.easBuildId ?? '')) reject('INTERNAL_GROUP_INPUT_INVALID');
  return Object.freeze({
    sourceCommit: args.sourceCommit,
    sourceTreeSha256: input.sourceTreeSha256,
    buildInputAttestationSha256: args.buildInputAttestationSha256,
    buildArtifactAttestationSha256: args.buildArtifactAttestationSha256,
    easBuildId: artifact.easBuildId,
  });
}

function validateObservation(args, bindings, now) {
  const observation = readInternalPrivateJson(
    args.observationPath,
    args.observationSha256,
  ).value;
  const observedAt = Date.parse(observation?.observedAt);
  if (!exactKeys(observation, OBSERVATION_KEYS)
    || observation.schemaVersion !== 1
    || observation.evidenceKind !== 'cabohealth-app-store-connect-internal-group-observation'
    || !candidateExact(observation.candidate)
    || observation.sourceCommit !== bindings.sourceCommit
    || observation.sourceTreeSha256 !== bindings.sourceTreeSha256
    || observation.buildInputAttestationSha256 !== bindings.buildInputAttestationSha256
    || observation.buildArtifactAttestationSha256 !== bindings.buildArtifactAttestationSha256
    || observation.easBuildId !== bindings.easBuildId
    || !RESOURCE_ID_PATTERN.test(observation.appStoreConnectBuildResourceId ?? '')
    || observation.buildProcessingState !== 'VALID'
    || observation.buildExpired !== false
    || observation.buildAudienceType !== 'APP_STORE_ELIGIBLE'
    || !canonicalTime(observation.buildUploadedAt)
    || !RESOURCE_ID_PATTERN.test(observation.betaGroupResourceId ?? '')
    || observation.betaGroupName !== 'cabo health'
    || observation.betaGroupInternal !== true
    || observation.betaGroupHasAccessToAllBuilds !== false
    || observation.available !== false || observation.availabilityReason !== 'not-assigned'
    || observation.mutationPerformed !== false
    || observation.rawProviderResponseRetained !== false
    || observation.providerUrlsOmitted !== true
    || observation.credentialFieldsOmitted !== true
    || !Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== observation.observedAt
    || observedAt > now || now - observedAt > 15 * 60 * 1000) reject('INTERNAL_GROUP_INPUT_INVALID');
}

export async function runInternalGroup(argv, {
  assignment = false,
  environment = process.env,
  transport,
  now = Date.now(),
  sleep,
} = {}) {
  const args = parseInternalGroupArguments(argv, { assignment });
  validateInternalOutputTarget(args.outputPath, args.operation, environment);
  const bindings = readBindings(args);
  if (assignment) validateObservation(args, bindings, now);
  let liveTransport = transport;
  if (liveTransport === undefined) {
    try {
      liveTransport = new AppStoreConnectTransport(loadCredentials(environment), { now: () => now });
    } catch {
      reject('INTERNAL_GROUP_CREDENTIALS_INVALID');
    }
  }
  const result = assignment
    ? await assignInternalGroup(liveTransport, bindings, { now: () => now, sleep })
    : await observeInternalGroup(liveTransport, bindings, { now: () => now });
  writeInternalOutput(args.outputPath, result, args.operation, environment);
  return result;
}
