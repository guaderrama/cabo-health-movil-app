import { CANDIDATE, RESOURCE_ID_PATTERN, SHA256_PATTERN, UUID_PATTERN } from './constants.mjs';
import { reject } from './errors.mjs';

const GROUP_NAME = 'cabo health';
const OBSERVATION_KEYS = [
  'schemaVersion', 'evidenceKind', 'candidate', 'sourceCommit', 'sourceTreeSha256',
  'buildInputAttestationSha256', 'buildArtifactAttestationSha256', 'easBuildId',
  'appStoreConnectBuildResourceId', 'buildProcessingState', 'buildExpired',
  'buildAudienceType', 'buildUploadedAt', 'betaGroupResourceId', 'betaGroupName',
  'betaGroupInternal', 'betaGroupHasAccessToAllBuilds', 'observedAt', 'available',
  'availabilityReason', 'mutationPerformed', 'rawProviderResponseRetained',
  'providerUrlsOmitted', 'credentialFieldsOmitted',
];

export const internalGroupPaths = Object.freeze({
  app: () => '/v1/apps/6758285327?fields%5Bapps%5D=bundleId',
  builds: () => '/v1/builds?filter%5Bapp%5D=6758285327&filter%5Bversion%5D=9&filter%5BpreReleaseVersion.version%5D=3.0&filter%5BpreReleaseVersion.platform%5D=IOS&fields%5Bbuilds%5D=version%2CuploadedDate%2CprocessingState%2Cexpired%2CbuildAudienceType&limit=200',
  preRelease: (buildId) => `/v1/builds/${buildId}/preReleaseVersion?fields%5BpreReleaseVersions%5D=version%2Cplatform`,
  buildApp: (buildId) => `/v1/builds/${buildId}/app?fields%5Bapps%5D=bundleId`,
  groups: () => '/v1/apps/6758285327/betaGroups?fields%5BbetaGroups%5D=name%2CisInternalGroup%2ChasAccessToAllBuilds&limit=200',
  groupApp: (groupId) => `/v1/betaGroups/${groupId}/app?fields%5Bapps%5D=bundleId`,
  relationshipBuilds: (groupId) => `/v1/betaGroups/${groupId}/relationships/builds?limit=200`,
  assign: (groupId) => `/v1/betaGroups/${groupId}/relationships/builds`,
});

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
}

function canonicalTime(milliseconds) {
  if (!Number.isFinite(milliseconds)) reject('INTERNAL_GROUP_LIVE_OBSERVATION_FAILED');
  return new Date(milliseconds).toISOString();
}

function validateBindings(bindings) {
  if (!exactKeys(bindings, [
    'sourceCommit', 'sourceTreeSha256', 'buildInputAttestationSha256',
    'buildArtifactAttestationSha256', 'easBuildId',
  ])
    || !/^[a-f0-9]{40}$/u.test(bindings.sourceCommit ?? '')
    || !SHA256_PATTERN.test(bindings.sourceTreeSha256 ?? '')
    || !SHA256_PATTERN.test(bindings.buildInputAttestationSha256 ?? '')
    || !SHA256_PATTERN.test(bindings.buildArtifactAttestationSha256 ?? '')
    || !UUID_PATTERN.test(bindings.easBuildId ?? '')) reject('INTERNAL_GROUP_INPUT_INVALID');
  return bindings;
}

function validateResourceId(value, code) {
  if (!RESOURCE_ID_PATTERN.test(value ?? '')) reject(code);
  return value;
}

function validateOne(value, type, id, code) {
  if (value?.data?.type !== type || value.data.id !== id) reject(code);
  return value.data;
}

function collection(value, code) {
  const next = value?.links?.next;
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.data) || (next !== null && next !== undefined)) {
    if (next !== null && next !== undefined) {
      reject('INTERNAL_GROUP_PAGINATION_UNSUPPORTED');
    }
    reject(code);
  }
  if (value.meta?.paging?.total !== undefined
    && (!Number.isSafeInteger(value.meta.paging.total)
      || value.meta.paging.total !== value.data.length)) reject(code);
  return value.data;
}

function mapTransportFailure(error) {
  if (error?.message === 'APP_STORE_CONNECT_HTTP_401'
    || error?.message === 'APP_STORE_CONNECT_HTTP_403') reject('INTERNAL_GROUP_AUTHORIZATION_FAILED');
  reject('INTERNAL_GROUP_LIVE_OBSERVATION_FAILED');
}

async function get(transport, path) {
  try {
    const result = await transport.request({ method: 'GET', path });
    if (result?.status !== 200 || result.body === null || typeof result.body !== 'object') {
      reject('INTERNAL_GROUP_LIVE_OBSERVATION_FAILED');
    }
    return result.body;
  } catch (error) {
    if (error?.message?.startsWith('INTERNAL_GROUP_')) throw error;
    mapTransportFailure(error);
  }
}

async function observeTarget(transport) {
  const app = validateOne(
    await get(transport, internalGroupPaths.app()),
    'apps', CANDIDATE.appleId, 'INTERNAL_GROUP_TARGET_INVALID',
  );
  if (app.attributes?.bundleId !== CANDIDATE.bundleIdentifier) reject('INTERNAL_GROUP_TARGET_INVALID');

  const builds = collection(await get(transport, internalGroupPaths.builds()), 'INTERNAL_GROUP_BUILD_INVALID');
  if (builds.length !== 1) reject('INTERNAL_GROUP_BUILD_INVALID');
  const build = builds[0];
  const buildId = validateResourceId(build?.id, 'INTERNAL_GROUP_BUILD_INVALID');
  if (build.type !== 'builds' || build.attributes?.version !== CANDIDATE.buildNumber
    || build.attributes?.processingState !== 'VALID' || build.attributes?.expired !== false
    || build.attributes?.buildAudienceType !== 'APP_STORE_ELIGIBLE'
    || typeof build.attributes?.uploadedDate !== 'string'
    || new Date(Date.parse(build.attributes.uploadedDate)).toISOString()
      !== build.attributes.uploadedDate) reject('INTERNAL_GROUP_BUILD_INVALID');

  const preReleaseResponse = await get(transport, internalGroupPaths.preRelease(buildId));
  const preRelease = preReleaseResponse?.data;
  if (preRelease?.type !== 'preReleaseVersions'
    || !RESOURCE_ID_PATTERN.test(preRelease.id ?? '')) reject('INTERNAL_GROUP_BUILD_INVALID');
  if (preRelease.attributes?.version !== CANDIDATE.marketingVersion
    || preRelease.attributes?.platform !== 'IOS') reject('INTERNAL_GROUP_BUILD_INVALID');
  const buildAppResponse = await get(transport, internalGroupPaths.buildApp(buildId));
  const buildApp = buildAppResponse?.data;
  if (buildApp?.type !== 'apps' || buildApp.id !== CANDIDATE.appleId
    || buildApp.attributes?.bundleId !== CANDIDATE.bundleIdentifier) reject('INTERNAL_GROUP_BUILD_INVALID');

  const groups = collection(await get(transport, internalGroupPaths.groups()), 'INTERNAL_GROUP_TARGET_INVALID');
  const exactName = groups.filter((group) => group?.attributes?.name === GROUP_NAME);
  if (exactName.length !== 1) reject('INTERNAL_GROUP_TARGET_INVALID');
  const group = exactName[0];
  const groupId = validateResourceId(group.id, 'INTERNAL_GROUP_TARGET_INVALID');
  if (group.type !== 'betaGroups' || group.attributes?.isInternalGroup !== true
    || typeof group.attributes?.hasAccessToAllBuilds !== 'boolean') reject('INTERNAL_GROUP_TARGET_INVALID');
  const groupAppResponse = await get(transport, internalGroupPaths.groupApp(groupId));
  const groupApp = groupAppResponse?.data;
  if (groupApp?.type !== 'apps' || groupApp.id !== CANDIDATE.appleId
    || groupApp.attributes?.bundleId !== CANDIDATE.bundleIdentifier) reject('INTERNAL_GROUP_TARGET_INVALID');
  const relationships = collection(
    await get(transport, internalGroupPaths.relationshipBuilds(groupId)),
    'INTERNAL_GROUP_TARGET_INVALID',
  );
  if (relationships.some((item) => item?.type !== 'builds'
    || !RESOURCE_ID_PATTERN.test(item.id ?? ''))) reject('INTERNAL_GROUP_TARGET_INVALID');
  const explicitlyAssigned = relationships.some((item) => item.id === buildId);
  const allBuilds = group.attributes.hasAccessToAllBuilds;
  return { build, buildId, group, groupId, explicitlyAssigned, allBuilds };
}

export async function observeInternalGroup(transport, suppliedBindings, { now = Date.now } = {}) {
  const bindings = validateBindings(suppliedBindings);
  if (typeof transport?.request !== 'function' || typeof now !== 'function') {
    reject('INTERNAL_GROUP_INPUT_INVALID');
  }
  const target = await observeTarget(transport);
  const available = target.allBuilds || target.explicitlyAssigned;
  const availabilityReason = target.allBuilds
    ? 'all-builds' : (target.explicitlyAssigned ? 'explicit-relationship' : 'not-assigned');
  return Object.freeze({
    schemaVersion: 1,
    evidenceKind: 'cabohealth-app-store-connect-internal-group-observation',
    candidate: CANDIDATE,
    sourceCommit: bindings.sourceCommit,
    sourceTreeSha256: bindings.sourceTreeSha256,
    buildInputAttestationSha256: bindings.buildInputAttestationSha256,
    buildArtifactAttestationSha256: bindings.buildArtifactAttestationSha256,
    easBuildId: bindings.easBuildId,
    appStoreConnectBuildResourceId: target.buildId,
    buildProcessingState: target.build.attributes.processingState,
    buildExpired: target.build.attributes.expired,
    buildAudienceType: target.build.attributes.buildAudienceType,
    buildUploadedAt: target.build.attributes.uploadedDate,
    betaGroupResourceId: target.groupId,
    betaGroupName: target.group.attributes.name,
    betaGroupInternal: target.group.attributes.isInternalGroup,
    betaGroupHasAccessToAllBuilds: target.allBuilds,
    observedAt: canonicalTime(now()),
    available,
    availabilityReason,
    mutationPerformed: false,
    rawProviderResponseRetained: false,
    providerUrlsOmitted: true,
    credentialFieldsOmitted: true,
  });
}

function assignmentResult(observation, {
  observedAfterMutationAt,
  mutationAttempted,
  mutationResponse,
  result,
}) {
  return Object.freeze({
    schemaVersion: 1,
    evidenceKind: 'cabohealth-app-store-connect-internal-group-assignment',
    candidate: observation.candidate,
    sourceCommit: observation.sourceCommit,
    sourceTreeSha256: observation.sourceTreeSha256,
    buildInputAttestationSha256: observation.buildInputAttestationSha256,
    buildArtifactAttestationSha256: observation.buildArtifactAttestationSha256,
    easBuildId: observation.easBuildId,
    appStoreConnectBuildResourceId: observation.appStoreConnectBuildResourceId,
    buildProcessingState: observation.buildProcessingState,
    buildExpired: observation.buildExpired,
    buildAudienceType: observation.buildAudienceType,
    buildUploadedAt: observation.buildUploadedAt,
    betaGroupResourceId: observation.betaGroupResourceId,
    betaGroupName: observation.betaGroupName,
    betaGroupInternal: observation.betaGroupInternal,
    betaGroupHasAccessToAllBuilds: observation.betaGroupHasAccessToAllBuilds,
    observedBeforeMutationAt: observation.observedAt,
    availableBeforeMutation: observation.available,
    mutationAttempted,
    mutationResponse,
    observedAfterMutationAt,
    availableAfterMutation: true,
    result,
    groupCreated: false,
    groupEdited: false,
    testerMutationPerformed: false,
    externalTestingMutationPerformed: false,
    appReviewMutationPerformed: false,
  });
}

async function relationshipPresent(transport, groupId, buildId) {
  try {
    const response = await transport.request({
      method: 'GET',
      path: internalGroupPaths.relationshipBuilds(groupId),
    });
    if (response?.status !== 200 || response.body === null || typeof response.body !== 'object') {
      reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
    }
    const relationships = collection(response.body, 'INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
    if (relationships.some((item) => item?.type !== 'builds'
      || !RESOURCE_ID_PATTERN.test(item.id ?? ''))) {
      reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
    }
    return relationships.some((item) => item.id === buildId);
  } catch (error) {
    if (error?.message === 'APP_STORE_CONNECT_HTTP_401'
      || error?.message === 'APP_STORE_CONNECT_HTTP_403') {
      reject('INTERNAL_GROUP_AUTHORIZATION_FAILED');
    }
    reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
  }
}

export async function assignInternalGroup(transport, bindings, {
  now = Date.now,
  sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
  beforeMutation = async () => {},
  afterMutation = async () => {},
} = {}) {
  if (typeof sleep !== 'function' || typeof beforeMutation !== 'function'
    || typeof afterMutation !== 'function') reject('INTERNAL_GROUP_INPUT_INVALID');
  const observation = await observeInternalGroup(transport, bindings, { now });
  if (observation.available) {
    return assignmentResult(observation, {
      observedAfterMutationAt: observation.observedAt,
      mutationAttempted: false,
      mutationResponse: 'none',
      result: observation.availabilityReason === 'all-builds'
        ? 'already-available-all-builds' : 'already-assigned',
    });
  }

  await beforeMutation(observation);
  let responseKind = '204-no-content';
  let postError = null;
  try {
    const response = await transport.request({
      method: 'POST',
      path: internalGroupPaths.assign(observation.betaGroupResourceId),
      body: { data: [{ type: 'builds', id: observation.appStoreConnectBuildResourceId }] },
      responseKind: 'empty',
    });
    if (response?.status !== 204 || response.body !== null) {
      reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
    }
  } catch (error) {
    postError = error;
  }
  try {
    await afterMutation('unknown');
  } catch {
    reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
  }
  if (postError !== null) {
    if (postError?.message === 'APP_STORE_CONNECT_HTTP_409') responseKind = '409-readback';
    else if (['APP_STORE_CONNECT_NETWORK_ERROR', 'APP_STORE_CONNECT_RESPONSE_INVALID',
      'INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN'].includes(postError?.message)) {
      responseKind = 'network-uncertain-readback';
    } else if (postError?.message === 'APP_STORE_CONNECT_HTTP_401'
      || postError?.message === 'APP_STORE_CONNECT_HTTP_403') {
      try {
        await afterMutation('terminal_failure');
      } catch {
        reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
      }
      reject('INTERNAL_GROUP_AUTHORIZATION_FAILED');
    } else {
      try {
        await afterMutation('terminal_failure');
      } catch {
        reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
      }
      reject('INTERNAL_GROUP_ASSIGNMENT_FAILED');
    }
  }

  const readbackLimit = responseKind === '409-readback' ? 1 : 3;
  for (let attempt = 0; attempt < readbackLimit; attempt += 1) {
    if (attempt > 0) await sleep(1_000);
    if (await relationshipPresent(
      transport,
      observation.betaGroupResourceId,
      observation.appStoreConnectBuildResourceId,
    )) {
      const result = responseKind === '204-no-content'
        ? 'assigned'
        : (responseKind === '409-readback'
          ? 'assigned-after-conflict-readback' : 'assigned-after-uncertain-response');
      try {
        await afterMutation('terminal_success');
      } catch {
        reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
      }
      return assignmentResult(observation, {
        observedAfterMutationAt: canonicalTime(now()),
        mutationAttempted: true,
        mutationResponse: responseKind,
        result,
      });
    }
  }
  if (responseKind === '409-readback') {
    try {
      await afterMutation('terminal_failure');
    } catch {
      reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
    }
    reject('INTERNAL_GROUP_ASSIGNMENT_FAILED');
  }
  reject('INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN');
}

export { OBSERVATION_KEYS };
