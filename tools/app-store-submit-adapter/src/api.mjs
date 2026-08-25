import { isDeepStrictEqual } from 'node:util';
import {
  ACTIVE_REVIEW_STATES,
  CANDIDATE,
  INITIAL_VERSION_STATES,
  RESOURCE_ID_PATTERN,
  SUBMITTED_REVIEW_STATES,
} from './constants.mjs';
import { reject } from './errors.mjs';

function query(path, entries) {
  return `${path}?${new URLSearchParams(entries).toString()}`;
}

export const apiPaths = Object.freeze({
  app: () => query(`/v1/apps/${CANDIDATE.appleId}`, [
    ['fields[apps]', 'bundleId'],
  ]),
  versions: () => query(`/v1/apps/${CANDIDATE.appleId}/appStoreVersions`, [
    ['filter[platform]', 'IOS'],
    ['filter[versionString]', CANDIDATE.marketingVersion],
    ['include', 'build'],
    ['fields[appStoreVersions]', 'platform,versionString,appVersionState,build'],
    ['fields[builds]', 'version,processingState,expired'],
    ['limit', '200'],
  ]),
  versionBuild: (versionId) => query(`/v1/appStoreVersions/${versionId}/build`, [
    ['fields[builds]', 'version,processingState,expired'],
  ]),
  buildApp: (buildId) => query(`/v1/builds/${buildId}/app`, [
    ['fields[apps]', 'bundleId'],
  ]),
  activeSubmissions: () => query(`/v1/apps/${CANDIDATE.appleId}/reviewSubmissions`, [
    ['filter[platform]', 'IOS'],
    ['filter[state]', ACTIVE_REVIEW_STATES.join(',')],
    ['fields[reviewSubmissions]', 'platform,submittedDate,state,items,appStoreVersionForReview'],
    ['limit', '200'],
  ]),
  submission: (submissionId) => query(`/v1/reviewSubmissions/${submissionId}`, [
    ['fields[reviewSubmissions]', 'platform,submittedDate,state,appStoreVersionForReview'],
    ['include', 'appStoreVersionForReview'],
  ]),
  submissionItems: (submissionId) => query(`/v1/reviewSubmissions/${submissionId}/items`, [
    ['include', 'appStoreVersion'],
    ['fields[reviewSubmissionItems]', 'state,appStoreVersion'],
    ['fields[appStoreVersions]', 'platform,versionString'],
    ['limit', '200'],
  ]),
});

async function request(transport, method, path, body, expectedStatus, code) {
  const response = await transport.request({ method, path, body });
  if (response.status !== expectedStatus) reject(code);
  return response.body;
}

function resource(value, type, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || value.type !== type || !RESOURCE_ID_PATTERN.test(value.id ?? '')
    || value.attributes === null || typeof value.attributes !== 'object'
    || Array.isArray(value.attributes)) reject(code);
  return value;
}

function resourceIdentifier(value, type, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || value.type !== type || !RESOURCE_ID_PATTERN.test(value.id ?? '')) reject(code);
  return value;
}

function singleDocument(document, type, code) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) reject(code);
  return resource(document.data, type, code);
}

function singleIdentifierDocument(document, type, code) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) reject(code);
  return resourceIdentifier(document.data, type, code);
}

function collectionDocument(document, type, code) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)
    || !Array.isArray(document.data)
    || document.links?.next !== undefined && document.links.next !== null
    || document.meta?.paging?.total !== undefined
      && document.meta.paging.total !== document.data.length) reject(code);
  return document.data.map((value) => resource(value, type, code));
}

function relationshipId(value, name, type, code, { nullable = false } = {}) {
  const data = value.relationships?.[name]?.data;
  if (nullable && data === null) return null;
  if (data === null || typeof data !== 'object' || Array.isArray(data)
    || data.type !== type || !RESOURCE_ID_PATTERN.test(data.id ?? '')) reject(code);
  return data.id;
}

function validateAppResource(app) {
  if (app.id !== CANDIDATE.appleId || app.attributes.bundleId !== CANDIDATE.bundleIdentifier) {
    reject('LIVE_APP_IDENTITY_MISMATCH');
  }
}

function validateVersionResource(version, evidence) {
  if (version.id !== evidence.appStoreVersionId
    || version.attributes.platform !== 'IOS'
    || version.attributes.versionString !== CANDIDATE.marketingVersion
    || typeof version.attributes.appVersionState !== 'string') {
    reject('LIVE_APP_STORE_VERSION_MISMATCH');
  }
  const selectedBuildId = relationshipId(
    version,
    'build',
    'builds',
    'LIVE_SELECTED_BUILD_MISMATCH',
  );
  if (selectedBuildId !== evidence.buildResourceId
  ) {
    reject('LIVE_SELECTED_BUILD_MISMATCH');
  }
  return version.attributes.appVersionState;
}

function validateBuildResource(build, evidence) {
  if (build.id !== evidence.buildResourceId
    || build.attributes.version !== CANDIDATE.buildNumber
    || build.attributes.processingState !== 'VALID'
    || build.attributes.expired !== false) reject('LIVE_BUILD_IDENTITY_MISMATCH');
}

export async function resolveLiveIdentity(transport, evidence) {
  const app = singleDocument(await request(
    transport,
    'GET',
    apiPaths.app(),
    undefined,
    200,
    'LIVE_APP_RESPONSE_INVALID',
  ), 'apps', 'LIVE_APP_RESPONSE_INVALID');
  validateAppResource(app);
  const versions = collectionDocument(await request(
    transport,
    'GET',
    apiPaths.versions(),
    undefined,
    200,
    'LIVE_VERSION_RESPONSE_INVALID',
  ), 'appStoreVersions', 'LIVE_VERSION_RESPONSE_INVALID');
  if (versions.length !== 1) reject('LIVE_APP_STORE_VERSION_AMBIGUOUS');
  const versionState = validateVersionResource(versions[0], evidence);
  const build = singleDocument(await request(
    transport,
    'GET',
    apiPaths.versionBuild(evidence.appStoreVersionId),
    undefined,
    200,
    'LIVE_BUILD_RESPONSE_INVALID',
  ), 'builds', 'LIVE_BUILD_RESPONSE_INVALID');
  validateBuildResource(build, evidence);
  const buildApp = singleDocument(await request(
    transport,
    'GET',
    apiPaths.buildApp(evidence.buildResourceId),
    undefined,
    200,
    'LIVE_BUILD_APP_RESPONSE_INVALID',
  ), 'apps', 'LIVE_BUILD_APP_RESPONSE_INVALID');
  validateAppResource(buildApp);
  return Object.freeze({
    appId: app.id,
    appStoreVersionId: versions[0].id,
    buildId: build.id,
    versionState,
  });
}

async function listSubmissionItems(transport, submissionId, versionId) {
  const items = collectionDocument(await request(
    transport,
    'GET',
    apiPaths.submissionItems(submissionId),
    undefined,
    200,
    'REVIEW_SUBMISSION_ITEMS_RESPONSE_INVALID',
  ), 'reviewSubmissionItems', 'REVIEW_SUBMISSION_ITEMS_RESPONSE_INVALID');
  const versionIds = items.map((item) => relationshipId(
    item,
    'appStoreVersion',
    'appStoreVersions',
    'REVIEW_SUBMISSION_CONTAINS_FOREIGN_ITEM',
  ));
  if (items.some((item) => item.attributes.state !== 'READY_FOR_REVIEW')) {
    reject('REVIEW_SUBMISSION_ITEM_NOT_READY');
  }
  if (versionIds.some((id) => id !== versionId) || versionIds.length > 1) {
    reject('REVIEW_SUBMISSION_CONTAINS_FOREIGN_ITEM');
  }
  return Object.freeze({ items, hasExactVersion: versionIds.length === 1 });
}

async function listActiveSubmissions(transport) {
  const submissions = collectionDocument(await request(
    transport,
    'GET',
    apiPaths.activeSubmissions(),
    undefined,
    200,
    'REVIEW_SUBMISSIONS_RESPONSE_INVALID',
  ), 'reviewSubmissions', 'REVIEW_SUBMISSIONS_RESPONSE_INVALID');
  if (submissions.some((submission) => (
    submission.attributes.platform !== 'IOS'
    || !ACTIVE_REVIEW_STATES.includes(submission.attributes.state)
  ))) reject('REVIEW_SUBMISSIONS_RESPONSE_INVALID');
  if (submissions.length > 1) reject('ACTIVE_REVIEW_SUBMISSION_AMBIGUOUS');
  return submissions;
}

function createSubmissionBody() {
  return {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: {
        app: { data: { type: 'apps', id: CANDIDATE.appleId } },
      },
    },
  };
}

function createItemBody(submissionId, appStoreVersionId) {
  return {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: {
          data: { type: 'reviewSubmissions', id: submissionId },
        },
        appStoreVersion: {
          data: { type: 'appStoreVersions', id: appStoreVersionId },
        },
      },
    },
  };
}

function submitBody(submissionId) {
  return {
    data: {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    },
  };
}

async function createSubmission(transport) {
  return singleIdentifierDocument(await request(
    transport,
    'POST',
    '/v1/reviewSubmissions',
    createSubmissionBody(),
    201,
    'REVIEW_SUBMISSION_CREATE_RESPONSE_INVALID',
  ), 'reviewSubmissions', 'REVIEW_SUBMISSION_CREATE_RESPONSE_INVALID');
}

async function createSubmissionItem(transport, submissionId, versionId) {
  return singleIdentifierDocument(await request(
    transport,
    'POST',
    '/v1/reviewSubmissionItems',
    createItemBody(submissionId, versionId),
    201,
    'REVIEW_SUBMISSION_ITEM_CREATE_RESPONSE_INVALID',
  ), 'reviewSubmissionItems', 'REVIEW_SUBMISSION_ITEM_CREATE_RESPONSE_INVALID');
}

async function readSubmission(transport, submissionId, versionId) {
  const submission = singleDocument(await request(
    transport,
    'GET',
    apiPaths.submission(submissionId),
    undefined,
    200,
    'REVIEW_SUBMISSION_READBACK_INVALID',
  ), 'reviewSubmissions', 'REVIEW_SUBMISSION_READBACK_INVALID');
  if (submission.id !== submissionId || submission.attributes.platform !== 'IOS') {
    reject('REVIEW_SUBMISSION_READBACK_INVALID');
  }
  const versionForReview = relationshipId(
    submission,
    'appStoreVersionForReview',
    'appStoreVersions',
    'REVIEW_SUBMISSION_READBACK_INVALID',
  );
  if (versionForReview !== versionId) {
    reject('REVIEW_SUBMISSION_READBACK_INVALID');
  }
  return submission;
}

function result(status, submission) {
  return Object.freeze({
    schemaVersion: 1,
    status,
    appResourceId: CANDIDATE.appleId,
    appStoreVersionId: null,
    buildResourceId: null,
    reviewSubmissionId: submission.id,
    reviewSubmissionState: submission.attributes.state,
  });
}

export async function submitExactVersion(transport, evidence, {
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof transport?.request !== 'function' || typeof sleep !== 'function') {
    reject('SUBMISSION_RUNTIME_INVALID');
  }
  const live = await resolveLiveIdentity(transport, evidence);
  const active = await listActiveSubmissions(transport);
  let submission = active[0] ?? null;
  let items = submission === null ? null : await listSubmissionItems(
    transport,
    submission.id,
    evidence.appStoreVersionId,
  );

  if (submission !== null && SUBMITTED_REVIEW_STATES.includes(submission.attributes.state)) {
    if (!items.hasExactVersion) reject('ACTIVE_REVIEW_SUBMISSION_CONFLICT');
    const readback = await readSubmission(transport, submission.id, evidence.appStoreVersionId);
    if (!SUBMITTED_REVIEW_STATES.includes(readback.attributes.state)) {
      reject('REVIEW_SUBMISSION_READBACK_INVALID');
    }
    const completed = result('already-submitted', readback);
    return Object.freeze({
      ...completed,
      appStoreVersionId: live.appStoreVersionId,
      buildResourceId: live.buildId,
    });
  }
  if (submission !== null && submission.attributes.state !== 'READY_FOR_REVIEW') {
    reject('ACTIVE_REVIEW_SUBMISSION_CONFLICT');
  }
  if (!INITIAL_VERSION_STATES.includes(live.versionState)
    || (live.versionState !== evidence.appStoreVersionState
      && !(submission !== null
        && items.hasExactVersion
        && evidence.appStoreVersionState === 'PREPARE_FOR_SUBMISSION'
        && live.versionState === 'READY_FOR_REVIEW'))) {
    reject('LIVE_APP_STORE_VERSION_NOT_READY');
  }

  if (submission === null) {
    const created = await createSubmission(transport);
    const relisted = await listActiveSubmissions(transport);
    if (relisted.length !== 1 || relisted[0].id !== created.id
      || relisted[0].attributes.state !== 'READY_FOR_REVIEW') {
      reject('REVIEW_SUBMISSION_CREATE_NOT_BOUND');
    }
    [submission] = relisted;
    items = await listSubmissionItems(transport, submission.id, evidence.appStoreVersionId);
  }
  let createdItem = null;
  if (!items.hasExactVersion) {
    if (items.items.length !== 0) reject('ACTIVE_REVIEW_SUBMISSION_CONFLICT');
    createdItem = await createSubmissionItem(
      transport,
      submission.id,
      evidence.appStoreVersionId,
    );
  }
  const verifiedItems = await listSubmissionItems(
    transport,
    submission.id,
    evidence.appStoreVersionId,
  );
  if (!verifiedItems.hasExactVersion || verifiedItems.items.length !== 1) {
    reject('REVIEW_SUBMISSION_ITEM_NOT_BOUND');
  }
  if (createdItem !== null && verifiedItems.items[0].id !== createdItem.id) {
    reject('REVIEW_SUBMISSION_ITEM_CREATE_NOT_BOUND');
  }

  const freshLive = await resolveLiveIdentity(transport, evidence);
  if (!isDeepStrictEqual(
    freshLive,
    { ...live, versionState: 'READY_FOR_REVIEW' },
  )) {
    reject('LIVE_IDENTITY_CHANGED_BEFORE_SUBMIT');
  }
  const draftReadback = await readSubmission(
    transport,
    submission.id,
    evidence.appStoreVersionId,
  );
  if (draftReadback.attributes.state !== 'READY_FOR_REVIEW') {
    reject('REVIEW_SUBMISSION_NOT_READY');
  }

  await request(
    transport,
    'PATCH',
    `/v1/reviewSubmissions/${submission.id}`,
    submitBody(submission.id),
    200,
    'REVIEW_SUBMISSION_PATCH_RESPONSE_INVALID',
  );
  let finalSubmission;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(1_500);
    finalSubmission = await readSubmission(
      transport,
      submission.id,
      evidence.appStoreVersionId,
    );
    if (SUBMITTED_REVIEW_STATES.includes(finalSubmission.attributes.state)) break;
    if (finalSubmission.attributes.state !== 'READY_FOR_REVIEW') {
      reject('REVIEW_SUBMISSION_FINAL_STATE_INVALID');
    }
  }
  if (!SUBMITTED_REVIEW_STATES.includes(finalSubmission.attributes.state)) {
    reject('REVIEW_SUBMISSION_NOT_ACCEPTED');
  }
  const finalItems = await listSubmissionItems(
    transport,
    submission.id,
    evidence.appStoreVersionId,
  );
  if (!finalItems.hasExactVersion || finalItems.items.length !== 1) {
    reject('REVIEW_SUBMISSION_FINAL_BINDING_INVALID');
  }
  const completed = result('submitted', finalSubmission);
  return Object.freeze({
    ...completed,
    appStoreVersionId: live.appStoreVersionId,
    buildResourceId: live.buildId,
  });
}

export const requestBodies = Object.freeze({
  createSubmission: createSubmissionBody,
  createItem: createItemBody,
  submit: submitBody,
});
