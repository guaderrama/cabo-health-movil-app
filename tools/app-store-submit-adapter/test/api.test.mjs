import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FixtureTransport,
  submitExactVersion,
} from '../src/index.mjs';
import { apiPaths, requestBodies } from '../src/api.mjs';
import {
  activeExpectation,
  BUILD_RESOURCE_ID,
  expectation,
  itemResource,
  itemsExpectation,
  liveExpectations,
  readSubmissionExpectation,
  submissionResource,
  successfulNewSubmissionExpectations,
  validAppStoreEvidence,
  VERSION_ID,
} from './helpers.mjs';

function page(data) {
  return { data, links: { self: 'fixture' }, meta: { paging: { total: data.length, limit: 200 } } };
}

test('creates a scoped draft, binds only the exact version, submits, and verifies read-back', async () => {
  const transport = new FixtureTransport(successfulNewSubmissionExpectations());
  const result = await submitExactVersion(transport, validAppStoreEvidence(), {
    sleep: async () => {},
  });
  transport.assertConsumed();
  assert.deepEqual(result, {
    schemaVersion: 1,
    status: 'submitted',
    appResourceId: '6758285327',
    appStoreVersionId: VERSION_ID,
    buildResourceId: BUILD_RESOURCE_ID,
    reviewSubmissionId: 'submission-one',
    reviewSubmissionState: 'WAITING_FOR_REVIEW',
  });
  assert.equal(transport.requests.filter(({ method }) => method === 'PATCH').length, 1);
  assert.equal(transport.requests.filter(({ method }) => method === 'POST').length, 2);
});

test('is idempotent when the exact version is already waiting for review', async () => {
  const submission = submissionResource('submission-existing', 'WAITING_FOR_REVIEW');
  const item = itemResource('item-existing', submission.id);
  const transport = new FixtureTransport([
    ...liveExpectations({ state: 'WAITING_FOR_REVIEW' }),
    activeExpectation([submission]),
    itemsExpectation(submission.id, [item]),
    readSubmissionExpectation(submission),
  ]);
  const result = await submitExactVersion(transport, validAppStoreEvidence(), {
    sleep: async () => {},
  });
  transport.assertConsumed();
  assert.equal(result.status, 'already-submitted');
  assert.equal(result.reviewSubmissionState, 'WAITING_FOR_REVIEW');
  assert.equal(transport.requests.some(({ method }) => method !== 'GET'), false);
});

test('reuses one exact READY_FOR_REVIEW draft without creating another draft or item', async () => {
  const draft = submissionResource('submission-draft', 'READY_FOR_REVIEW');
  const submitted = submissionResource(draft.id, 'WAITING_FOR_REVIEW');
  const item = itemResource('item-draft', draft.id);
  const transport = new FixtureTransport([
    ...liveExpectations({ state: 'READY_FOR_REVIEW' }),
    activeExpectation([draft]),
    itemsExpectation(draft.id, [item]),
    itemsExpectation(draft.id, [item]),
    ...liveExpectations({ state: 'READY_FOR_REVIEW' }),
    readSubmissionExpectation(draft),
    expectation(
      'PATCH',
      `/v1/reviewSubmissions/${draft.id}`,
      200,
      { data: submitted },
      requestBodies.submit(draft.id),
    ),
    readSubmissionExpectation(submitted),
    itemsExpectation(draft.id, [item]),
  ]);
  const result = await submitExactVersion(transport, validAppStoreEvidence(), {
    sleep: async () => {},
  });
  transport.assertConsumed();
  assert.equal(result.status, 'submitted');
  assert.equal(transport.requests.filter(({ method }) => method === 'POST').length, 0);
});

test('fails closed on multiple active submissions before any mutation', async () => {
  const one = submissionResource('one', 'READY_FOR_REVIEW');
  const two = submissionResource('two', 'READY_FOR_REVIEW');
  const transport = new FixtureTransport([
    ...liveExpectations(),
    activeExpectation([one, two]),
  ]);
  await assert.rejects(
    submitExactVersion(transport, validAppStoreEvidence()),
    /ACTIVE_REVIEW_SUBMISSION_AMBIGUOUS/u,
  );
  transport.assertConsumed();
  assert.equal(transport.requests.some(({ method }) => method !== 'GET'), false);
});

test('rejects a draft containing a foreign App Store version or non-version item', async () => {
  const draft = submissionResource('foreign-draft', 'READY_FOR_REVIEW');
  const foreignItem = itemResource('foreign-item', draft.id, 'some-other-version');
  const transport = new FixtureTransport([
    ...liveExpectations(),
    activeExpectation([draft]),
    itemsExpectation(draft.id, [foreignItem]),
  ]);
  await assert.rejects(
    submitExactVersion(transport, validAppStoreEvidence()),
    /REVIEW_SUBMISSION_CONTAINS_FOREIGN_ITEM/u,
  );
  transport.assertConsumed();
});

test('requires the live version state to match the independently captured ready state', async () => {
  const transport = new FixtureTransport([
    ...liveExpectations({ state: 'DEVELOPER_REJECTED' }),
    activeExpectation([]),
  ]);
  await assert.rejects(
    submitExactVersion(transport, validAppStoreEvidence()),
    /LIVE_APP_STORE_VERSION_NOT_READY/u,
  );
  transport.assertConsumed();
});

test('rejects an ambiguous version list and a mismatched selected build', async () => {
  {
    const live = liveExpectations();
    live[1].response = page([
      live[1].response.data[0],
      { ...structuredClone(live[1].response.data[0]), id: 'duplicate-version' },
    ]);
    const transport = new FixtureTransport(live.slice(0, 2));
    await assert.rejects(
      submitExactVersion(transport, validAppStoreEvidence()),
      /LIVE_APP_STORE_VERSION_AMBIGUOUS/u,
    );
    transport.assertConsumed();
  }
  {
    const live = liveExpectations({ buildId: 'cccccccc-1234-4234-8234-123456789abc' });
    const transport = new FixtureTransport(live.slice(0, 2));
    await assert.rejects(
      submitExactVersion(transport, validAppStoreEvidence()),
      /LIVE_SELECTED_BUILD_MISMATCH/u,
    );
    transport.assertConsumed();
  }
});

test('does not claim success until read-back leaves READY_FOR_REVIEW', async () => {
  const submissionId = 'slow-submission';
  const item = itemResource('slow-item', submissionId);
  const draft = submissionResource(submissionId, 'READY_FOR_REVIEW');
  const transport = new FixtureTransport([
    ...liveExpectations(),
    activeExpectation([]),
    expectation('POST', '/v1/reviewSubmissions', 201, {
      data: { type: 'reviewSubmissions', id: submissionId },
    }, requestBodies.createSubmission()),
    activeExpectation([draft]),
    itemsExpectation(submissionId, []),
    expectation(
      'POST',
      '/v1/reviewSubmissionItems',
      201,
      { data: { type: 'reviewSubmissionItems', id: item.id } },
      requestBodies.createItem(submissionId, VERSION_ID),
    ),
    itemsExpectation(submissionId, [item]),
    ...liveExpectations({ state: 'READY_FOR_REVIEW' }),
    readSubmissionExpectation(draft),
    expectation(
      'PATCH',
      `/v1/reviewSubmissions/${submissionId}`,
      200,
      { data: draft },
      requestBodies.submit(submissionId),
    ),
    readSubmissionExpectation(draft),
    readSubmissionExpectation(draft),
    readSubmissionExpectation(draft),
  ]);
  await assert.rejects(
    submitExactVersion(transport, validAppStoreEvidence(), { sleep: async () => {} }),
    /REVIEW_SUBMISSION_NOT_ACCEPTED/u,
  );
  transport.assertConsumed();
});

test('refuses unresolved or canceling states even when the exact item is present', async () => {
  for (const state of ['UNRESOLVED_ISSUES', 'CANCELING', 'COMPLETING']) {
    const safeStateId = state.toLowerCase().replaceAll('_', '-');
    const submission = submissionResource(`submission-${safeStateId}`, state);
    const item = itemResource(`item-${safeStateId}`, submission.id);
    const transport = new FixtureTransport([
      ...liveExpectations(),
      activeExpectation([submission]),
      itemsExpectation(submission.id, [item]),
    ]);
    await assert.rejects(
      submitExactVersion(transport, validAppStoreEvidence()),
      /ACTIVE_REVIEW_SUBMISSION_CONFLICT/u,
    );
    transport.assertConsumed();
  }
});
