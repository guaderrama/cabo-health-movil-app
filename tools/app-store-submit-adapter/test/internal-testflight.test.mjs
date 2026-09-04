import assert from 'node:assert/strict';
import test from 'node:test';

const SOURCE_COMMIT = 'a'.repeat(40);
const INPUT_SHA = 'b'.repeat(64);
const ARTIFACT_SHA = 'c'.repeat(64);
const BUILD_ID = 'build-resource-one';
const GROUP_ID = 'group-resource-one';
const NOW = Date.parse('2026-08-30T12:00:00.000Z');

function page(data) {
  return { data, links: { next: null }, meta: { paging: { total: data.length } } };
}

function fixtures({
  allBuilds = false,
  assigned = false,
  postStatus = 204,
  postError = null,
} = {}) {
  return {
    app: { data: { type: 'apps', id: '6758285327', attributes: { bundleId: 'com.cabohealth.app' } } },
    builds: page([{
      type: 'builds', id: BUILD_ID,
      attributes: {
        version: '12', uploadedDate: '2026-08-30T11:00:00.000Z',
        processingState: 'VALID', expired: false, buildAudienceType: 'APP_STORE_ELIGIBLE',
      },
    }]),
    prerelease: { data: { type: 'preReleaseVersions', id: 'pre-one', attributes: { version: '3.0', platform: 'IOS' } } },
    buildApp: { data: { type: 'apps', id: '6758285327', attributes: { bundleId: 'com.cabohealth.app' } } },
    groups: page([{
      type: 'betaGroups', id: GROUP_ID,
      attributes: { name: 'cabo health', isInternalGroup: true, hasAccessToAllBuilds: allBuilds },
    }]),
    groupApp: { data: { type: 'apps', id: '6758285327', attributes: { bundleId: 'com.cabohealth.app' } } },
    relationships: page(assigned ? [{ type: 'builds', id: BUILD_ID }] : []),
    postStatus,
    postError,
  };
}

function resizeCollection(values, collectionName, count) {
  const original = values[collectionName].data[0] ?? (
    collectionName === 'relationships'
      ? { type: 'builds', id: 'other-build-template' }
      : null
  );
  values[collectionName].data = Array.from({ length: count }, (_, index) => {
    const item = structuredClone(original);
    if (collectionName === 'builds') item.id = index === 0 ? BUILD_ID : `other-build-${index}`;
    if (collectionName === 'groups') {
      item.id = index === 0 ? GROUP_ID : `other-group-${index}`;
      if (index > 0) item.attributes.name = `other group ${index}`;
    }
    if (collectionName === 'relationships') item.id = `other-build-${index}`;
    return item;
  });
  values[collectionName].meta = { paging: { total: count } };
}

class RecordingTransport {
  constructor(values, { revealAfterPost = false, postReadbacks = [] } = {}) {
    this.values = values;
    this.requests = [];
    this.revealAfterPost = revealAfterPost;
    this.postReadbacks = [...postReadbacks];
    this.posted = false;
  }

  async request(request) {
    this.requests.push(structuredClone(request));
    const path = request.path;
    if (request.method === 'POST') {
      this.posted = true;
      if (this.values.postError !== null) throw new Error(this.values.postError);
      if (this.values.postStatus === 409) {
        const error = new Error('APP_STORE_CONNECT_HTTP_409');
        throw error;
      }
      return { status: this.values.postStatus, body: null };
    }
    if (path.startsWith('/v1/apps/6758285327?')) return { status: 200, body: this.values.app };
    if (path.startsWith('/v1/builds?')) return { status: 200, body: this.values.builds };
    if (path.includes('/preReleaseVersion?')) return { status: 200, body: this.values.prerelease };
    if (path === `/v1/builds/${BUILD_ID}/app?fields%5Bapps%5D=bundleId`) return { status: 200, body: this.values.buildApp };
    if (path.includes('/betaGroups?')) return { status: 200, body: this.values.groups };
    if (path === `/v1/betaGroups/${GROUP_ID}/app?fields%5Bapps%5D=bundleId`) return { status: 200, body: this.values.groupApp };
    if (path === `/v1/betaGroups/${GROUP_ID}/relationships/builds?limit=200`) {
      if (this.posted && this.postReadbacks.length > 0) {
        const next = this.postReadbacks.shift();
        if (next instanceof Error) throw next;
        return { status: 200, body: next };
      }
      const body = this.revealAfterPost && this.posted
        ? page([{ type: 'builds', id: BUILD_ID }])
        : this.values.relationships;
      return { status: 200, body };
    }
    throw new Error('unexpected request');
  }
}

const bindings = {
  sourceCommit: SOURCE_COMMIT,
  sourceTreeSha256: 'd'.repeat(64),
  buildInputAttestationSha256: INPUT_SHA,
  buildArtifactAttestationSha256: ARTIFACT_SHA,
  easBuildId: '12345678-1234-4234-8234-123456789abc',
};

const EXACT_GET_REQUESTS = Object.freeze([
  'GET /v1/apps/6758285327?fields%5Bapps%5D=bundleId',
  'GET /v1/builds?filter%5Bapp%5D=6758285327&filter%5Bversion%5D=10&filter%5BpreReleaseVersion.version%5D=3.0&filter%5BpreReleaseVersion.platform%5D=IOS&fields%5Bbuilds%5D=version%2CuploadedDate%2CprocessingState%2Cexpired%2CbuildAudienceType&limit=200',
  `GET /v1/builds/${BUILD_ID}/preReleaseVersion?fields%5BpreReleaseVersions%5D=version%2Cplatform`,
  `GET /v1/builds/${BUILD_ID}/app?fields%5Bapps%5D=bundleId`,
  'GET /v1/apps/6758285327/betaGroups?fields%5BbetaGroups%5D=name%2CisInternalGroup%2ChasAccessToAllBuilds&limit=200',
  `GET /v1/betaGroups/${GROUP_ID}/app?fields%5Bapps%5D=bundleId`,
  `GET /v1/betaGroups/${GROUP_ID}/relationships/builds?limit=200`,
]);
const EXACT_ASSIGN_REQUEST = `POST /v1/betaGroups/${GROUP_ID}/relationships/builds`;

function assertExactRequestAllowlist(requests, { assignment }) {
  const allowed = new Set([
    ...EXACT_GET_REQUESTS,
    ...(assignment ? [EXACT_ASSIGN_REQUEST] : []),
  ]);
  for (const { method, path } of requests) {
    assert.equal(allowed.has(`${method} ${path}`), true, `unexpected internal request: ${method} ${path}`);
  }
  assert.equal(requests.some(({ method }) => ['PATCH', 'DELETE'].includes(method)), false);
  assert.equal(requests.some(({ path }) => (
    /betaTesters|betaAppReview|appStoreVersions|reviewSubmissions|externalTest|\/v1\/betaGroups(?:\?|$)|\/v1\/betaGroups\/[^/]+(?:\?|$)/u.test(path)
  )), false);
}

test('observer performs only the exact read-only sequence and emits canonical unavailable evidence', async () => {
  const { observeInternalGroup, internalGroupPaths } = await import('../src/internal-testflight.mjs');
  const transport = new RecordingTransport(fixtures());
  const result = await observeInternalGroup(transport, bindings, { now: () => NOW });
  assert.equal(result.available, false);
  assert.equal(result.availabilityReason, 'not-assigned');
  assert.equal(result.mutationPerformed, false);
  assert.deepEqual(transport.requests.map(({ method }) => method), Array(7).fill('GET'));
  assert.deepEqual(transport.requests.map(({ path }) => path), [
    internalGroupPaths.app(), internalGroupPaths.builds(),
    internalGroupPaths.preRelease(BUILD_ID), internalGroupPaths.buildApp(BUILD_ID),
    internalGroupPaths.groups(), internalGroupPaths.groupApp(GROUP_ID),
    internalGroupPaths.relationshipBuilds(GROUP_ID),
  ]);
  assertExactRequestAllowlist(transport.requests, { assignment: false });
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'evidenceKind', 'candidate', 'sourceCommit', 'sourceTreeSha256',
    'buildInputAttestationSha256', 'buildArtifactAttestationSha256', 'easBuildId',
    'appStoreConnectBuildResourceId', 'buildProcessingState', 'buildExpired',
    'buildAudienceType', 'buildUploadedAt', 'betaGroupResourceId', 'betaGroupName',
    'betaGroupInternal', 'betaGroupHasAccessToAllBuilds', 'observedAt', 'available',
    'availabilityReason', 'mutationPerformed', 'rawProviderResponseRetained',
    'providerUrlsOmitted', 'credentialFieldsOmitted',
  ]);
});

test('assignment makes one exact relationship POST, accepts bodyless 204, and verifies readback', async () => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  const transport = new RecordingTransport(fixtures(), { revealAfterPost: true });
  const result = await assignInternalGroup(transport, bindings, { now: () => NOW, sleep: async () => {} });
  const posts = transport.requests.filter(({ method }) => method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], {
    method: 'POST',
    path: `/v1/betaGroups/${GROUP_ID}/relationships/builds`,
    body: { data: [{ type: 'builds', id: BUILD_ID }] },
    responseKind: 'empty',
  });
  assert.equal(result.mutationResponse, '204-no-content');
  assert.equal(result.availableAfterMutation, true);
  assert.equal(result.result, 'assigned');
  assert.equal(result.groupCreated, false);
  assert.equal(result.groupEdited, false);
  assert.equal(result.testerMutationPerformed, false);
  assert.equal(result.externalTestingMutationPerformed, false);
  assert.equal(result.appReviewMutationPerformed, false);
  assertExactRequestAllowlist(transport.requests, { assignment: true });
});

test('assignment is zero-mutation when access already exists and conflict readback never repeats POST', async () => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  const already = new RecordingTransport(fixtures({ allBuilds: true }));
  const noMutation = await assignInternalGroup(already, bindings, { now: () => NOW });
  assert.equal(noMutation.mutationAttempted, false);
  assert.equal(noMutation.result, 'already-available-all-builds');
  assert.equal(already.requests.some(({ method }) => method === 'POST'), false);

  const conflict = new RecordingTransport(fixtures({ postStatus: 409 }), { revealAfterPost: true });
  const recovered = await assignInternalGroup(conflict, bindings, { now: () => NOW });
  assert.equal(conflict.requests.filter(({ method }) => method === 'POST').length, 1);
  assert.equal(recovered.mutationResponse, '409-readback');
  assert.equal(recovered.result, 'assigned-after-conflict-readback');
});

test('HTTP 409 performs exactly one readback and fails when that readback is absent', async () => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  const transport = new RecordingTransport(fixtures({ postStatus: 409 }), {
    postReadbacks: [page([]), page([{ type: 'builds', id: BUILD_ID }])],
  });
  await assert.rejects(
    assignInternalGroup(transport, bindings, { now: () => NOW, sleep: async () => {} }),
    /INTERNAL_GROUP_ASSIGNMENT_FAILED/u,
  );
  assert.equal(transport.requests.filter(({ method }) => method === 'POST').length, 1);
  assert.equal(transport.requests.filter(({ path }) => (
    path === `/v1/betaGroups/${GROUP_ID}/relationships/builds?limit=200`
  )).length, 2, 'one initial observation plus exactly one conflict readback');
});

test('post-send readback network and format failures report an unknown mutation outcome', async (t) => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  for (const code of [
    'APP_STORE_CONNECT_NETWORK_ERROR',
    'APP_STORE_CONNECT_RESPONSE_INVALID',
  ]) {
    await t.test(code, async () => {
      const transport = new RecordingTransport(fixtures(), {
        postReadbacks: [new Error(code)],
      });
      await assert.rejects(
        assignInternalGroup(transport, bindings, { now: () => NOW, sleep: async () => {} }),
        /INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN/u,
      );
      assert.equal(transport.requests.filter(({ method }) => method === 'POST').length, 1);
    });
  }
});

test('204 and network-uncertain outcomes retain three readbacks while absent outcomes stop safely', async (t) => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  const present = page([{ type: 'builds', id: BUILD_ID }]);
  const absent = page([]);
  for (const scenario of [
    { name: '204 becomes present on third read', values: fixtures(), want: 'assigned' },
    {
      name: 'uncertain POST becomes present on third read',
      values: fixtures({ postError: 'APP_STORE_CONNECT_NETWORK_ERROR' }),
      want: 'assigned-after-uncertain-response',
    },
  ]) {
    await t.test(scenario.name, async () => {
      const transport = new RecordingTransport(scenario.values, {
        postReadbacks: [absent, absent, present],
      });
      const result = await assignInternalGroup(transport, bindings, {
        now: () => NOW,
        sleep: async () => {},
      });
      assert.equal(result.result, scenario.want);
      assert.equal(transport.requests.filter(({ path }) => (
        path === `/v1/betaGroups/${GROUP_ID}/relationships/builds?limit=200`
      )).length, 4, 'one initial observation plus all three post-send readbacks');
      assert.equal(transport.requests.filter(({ method }) => method === 'POST').length, 1);
    });
  }

  for (const scenario of [
    { name: '204 remains absent', values: fixtures() },
    {
      name: 'uncertain POST remains absent',
      values: fixtures({ postError: 'APP_STORE_CONNECT_NETWORK_ERROR' }),
    },
  ]) {
    await t.test(scenario.name, async () => {
      const transport = new RecordingTransport(scenario.values, {
        postReadbacks: [absent, absent, absent],
      });
      await assert.rejects(
        assignInternalGroup(transport, bindings, { now: () => NOW, sleep: async () => {} }),
        /INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN/u,
      );
      assert.equal(transport.requests.filter(({ path }) => (
        path === `/v1/betaGroups/${GROUP_ID}/relationships/builds?limit=200`
      )).length, 4, 'one initial observation plus exactly three post-send readbacks');
      assert.equal(transport.requests.filter(({ method }) => method === 'POST').length, 1);
    });
  }
});

test('a successful assignment is idempotent on the next exact observation', async () => {
  const { assignInternalGroup, observeInternalGroup } = await import('../src/internal-testflight.mjs');
  const first = new RecordingTransport(fixtures(), { revealAfterPost: true });
  assert.equal((await assignInternalGroup(first, bindings, { now: () => NOW })).result, 'assigned');

  const observationTransport = new RecordingTransport(fixtures({ assigned: true }));
  const observation = await observeInternalGroup(observationTransport, bindings, { now: () => NOW });
  assert.equal(observation.available, true);
  assert.equal(observation.availabilityReason, 'explicit-relationship');
  assert.equal(observationTransport.requests.some(({ method }) => method === 'POST'), false);

  const followup = new RecordingTransport(fixtures({ assigned: true }));
  const result = await assignInternalGroup(followup, bindings, { now: () => NOW });
  assert.equal(result.result, 'already-assigned');
  assert.equal(result.mutationAttempted, false);
  assert.equal(followup.requests.some(({ method }) => method === 'POST'), false);
});

test('wrong and ambiguous build or group variants fail closed before mutation', async (t) => {
  const { observeInternalGroup } = await import('../src/internal-testflight.mjs');
  const cases = [
    ['no exact build', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.builds = page([]); }],
    ['ambiguous exact build', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.builds.data.push(structuredClone(value.builds.data[0])); value.builds.meta.paging.total = 2; }],
    ['invalid build resource id', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.builds.data[0].id = 'bad/id'; }],
    ['wrong build number', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.builds.data[0].attributes.version = '8'; }],
    ['wrong processing state', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.builds.data[0].attributes.processingState = 'PROCESSING'; }],
    ['expired build', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.builds.data[0].attributes.expired = true; }],
    ['wrong build audience', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.builds.data[0].attributes.buildAudienceType = 'INTERNAL_ONLY'; }],
    ['wrong prerelease version', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.prerelease.data.attributes.version = '2.0'; }],
    ['wrong prerelease platform', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.prerelease.data.attributes.platform = 'MAC_OS'; }],
    ['wrong build app', 'INTERNAL_GROUP_BUILD_INVALID', (value) => { value.buildApp.data.attributes.bundleId = 'com.example.other'; }],
    ['wrong top-level app', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.app.data.attributes.bundleId = 'com.example.other'; }],
    ['no exact group', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.groups.data[0].attributes.name = 'Cabo Health'; }],
    ['ambiguous exact group', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.groups.data.push(structuredClone(value.groups.data[0])); value.groups.meta.paging.total = 2; }],
    ['invalid group resource id', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.groups.data[0].id = 'bad/id'; }],
    ['external group', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.groups.data[0].attributes.isInternalGroup = false; }],
    ['invalid all-builds flag', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.groups.data[0].attributes.hasAccessToAllBuilds = 'false'; }],
    ['wrong group app', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.groupApp.data.id = 'other-app'; }],
    ['invalid relationship item', 'INTERNAL_GROUP_TARGET_INVALID', (value) => { value.relationships = page([{ type: 'betaTesters', id: 'tester-one' }]); }],
  ];
  for (const [name, code, mutate] of cases) {
    await t.test(name, async () => {
      const value = fixtures();
      mutate(value);
      const transport = new RecordingTransport(value);
      await assert.rejects(
        observeInternalGroup(transport, bindings, { now: () => NOW }),
        new RegExp(code, 'u'),
      );
      assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
    });
  }
});

test('authorization and pre-mutation network failures use only finite internal-group errors', async (t) => {
  const { observeInternalGroup } = await import('../src/internal-testflight.mjs');
  for (const [providerCode, publicCode] of [
    ['APP_STORE_CONNECT_HTTP_401', 'INTERNAL_GROUP_AUTHORIZATION_FAILED'],
    ['APP_STORE_CONNECT_HTTP_403', 'INTERNAL_GROUP_AUTHORIZATION_FAILED'],
    ['APP_STORE_CONNECT_NETWORK_ERROR', 'INTERNAL_GROUP_LIVE_OBSERVATION_FAILED'],
    ['APP_STORE_CONNECT_RESPONSE_INVALID', 'INTERNAL_GROUP_LIVE_OBSERVATION_FAILED'],
  ]) {
    await t.test(providerCode, async () => {
      const transport = { request: async () => { throw new Error(providerCode); } };
      await assert.rejects(
        observeInternalGroup(transport, bindings, { now: () => NOW }),
        (error) => error?.message === publicCode,
      );
    });
  }
});

test('the exact request allowlist excludes group creation/editing, testers, external testing, Beta Review, and App Review', async () => {
  const { assignInternalGroup, observeInternalGroup } = await import('../src/internal-testflight.mjs');
  const observer = new RecordingTransport(fixtures());
  await observeInternalGroup(observer, bindings, { now: () => NOW });
  assertExactRequestAllowlist(observer.requests, { assignment: false });

  const assignment = new RecordingTransport(fixtures(), { revealAfterPost: true });
  await assignInternalGroup(assignment, bindings, { now: () => NOW });
  assertExactRequestAllowlist(assignment.requests, { assignment: true });
  assert.equal(assignment.requests.filter(({ method }) => method === 'POST').length, 1);
});

test('ambiguous build/group and pagination fail closed before mutation', async () => {
  const { observeInternalGroup } = await import('../src/internal-testflight.mjs');
  const paginated = fixtures();
  paginated.builds.links.next = 'https://api.appstoreconnect.apple.com/v1/builds?cursor=secret';
  const transport = new RecordingTransport(paginated);
  await assert.rejects(
    observeInternalGroup(transport, bindings, { now: () => NOW }),
    /INTERNAL_GROUP_PAGINATION_UNSUPPORTED/u,
  );
  assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
});

test('collections with omitted links or links.next are accepted as unpaginated', async (t) => {
  const { observeInternalGroup } = await import('../src/internal-testflight.mjs');
  for (const omission of ['links', 'next']) {
    await t.test(omission, async () => {
      const values = fixtures();
      for (const collectionName of ['builds', 'groups', 'relationships']) {
        if (omission === 'links') delete values[collectionName].links;
        else values[collectionName].links = {};
      }
      const transport = new RecordingTransport(values);
      const result = await observeInternalGroup(transport, bindings, { now: () => NOW });
      assert.equal(result.available, false);
      assert.equal(result.availabilityReason, 'not-assigned');
      assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
    });
  }
});

test('malformed collection links and meta shapes fail before the sole POST', async (t) => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  const malformedCases = [
    ['null links', (value) => { value.links = null; }],
    ['scalar links', (value) => { value.links = 1; }],
    ['array links', (value) => { value.links = []; }],
    ['null meta', (value) => { value.meta = null; }],
    ['scalar meta', (value) => { value.meta = 'meta'; }],
    ['null paging', (value) => { value.meta = { paging: null }; }],
    ['array paging', (value) => { value.meta = { paging: [] }; }],
    ['undefined next field', (value) => { value.links = { next: undefined }; }],
    ['negative total', (value) => { value.meta.paging.total = -1; }],
    ['fractional total', (value) => { value.meta.paging.total = 0.5; }],
    ['mismatched total', (value) => { value.meta.paging.total = value.data.length + 1; }],
  ];
  for (const collectionName of ['builds', 'groups', 'relationships']) {
    for (const [caseName, mutate] of malformedCases) {
      await t.test(`${collectionName}: ${caseName}`, async () => {
        const values = fixtures();
        mutate(values[collectionName]);
        const transport = new RecordingTransport(values);
        const code = collectionName === 'builds'
          ? 'INTERNAL_GROUP_BUILD_INVALID' : 'INTERNAL_GROUP_TARGET_INVALID';
        await assert.rejects(
          assignInternalGroup(transport, bindings, { now: () => NOW, sleep: async () => {} }),
          new RegExp(code, 'u'),
        );
        assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
      });
    }
  }
});

test('every collection rejects a defined non-null next link before mutation', async (t) => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  for (const collectionName of ['builds', 'groups', 'relationships']) {
    await t.test(collectionName, async () => {
      const values = fixtures();
      values[collectionName].links.next = 'https://api.appstoreconnect.apple.com/v1/next';
      const transport = new RecordingTransport(values);
      await assert.rejects(
        assignInternalGroup(transport, bindings, { now: () => NOW }),
        /INTERNAL_GROUP_PAGINATION_UNSUPPORTED/u,
      );
      assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
    });
  }
});

test('collections reject over-limit and ambiguous full pages before mutation', async (t) => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  for (const collectionName of ['builds', 'groups', 'relationships']) {
    for (const [caseName, count] of [['over limit', 201], ['full without proof', 200]]) {
      await t.test(`${collectionName}: ${caseName}`, async () => {
        const values = fixtures();
        resizeCollection(values, collectionName, count);
        values[collectionName].links = {};
        if (count === 200) delete values[collectionName].meta;
        const transport = new RecordingTransport(values);
        await assert.rejects(
          assignInternalGroup(transport, bindings, { now: () => NOW, sleep: async () => {} }),
          /INTERNAL_GROUP_PAGINATION_UNSUPPORTED/u,
        );
        assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
      });
    }
  }
});

test('a full page is bounded when explicit null-next or exact total proves completion', async (t) => {
  const { observeInternalGroup } = await import('../src/internal-testflight.mjs');
  for (const completionProof of ['null-next', 'exact-total']) {
    for (const collectionName of ['builds', 'groups', 'relationships']) {
      await t.test(`${collectionName}: ${completionProof}`, async () => {
        const values = fixtures();
        resizeCollection(values, collectionName, 200);
        if (completionProof === 'null-next') {
          values[collectionName].links = { next: null };
          delete values[collectionName].meta;
        } else {
          values[collectionName].links = {};
          values[collectionName].meta = { paging: { total: 200 } };
        }
        const transport = new RecordingTransport(values);
        if (collectionName === 'builds') {
          await assert.rejects(
            observeInternalGroup(transport, bindings, { now: () => NOW }),
            (error) => error?.message === 'INTERNAL_GROUP_BUILD_INVALID',
          );
        } else {
          const result = await observeInternalGroup(transport, bindings, { now: () => NOW });
          assert.equal(result.available, false);
        }
        assert.equal(transport.requests.some(({ method }) => method === 'POST'), false);
      });
    }
  }
});

test('malformed, over-limit, and ambiguous full post-send readbacks stop after one GET', async (t) => {
  const { assignInternalGroup } = await import('../src/internal-testflight.mjs');
  const malformed = page([]);
  malformed.links = null;
  const malformedMeta = page([]);
  malformedMeta.meta = null;
  const malformedPaging = page([]);
  malformedPaging.meta = { paging: [] };
  const paginated = page([]);
  paginated.links.next = 'https://api.appstoreconnect.apple.com/v1/next';
  const overLimit = page([]);
  resizeCollection({ relationships: overLimit }, 'relationships', 201);
  const ambiguousFull = page([]);
  resizeCollection({ relationships: ambiguousFull }, 'relationships', 200);
  ambiguousFull.links = {};
  delete ambiguousFull.meta;
  for (const [caseName, readback] of [
    ['malformed links', malformed],
    ['malformed meta', malformedMeta],
    ['malformed paging', malformedPaging],
    ['defined next', paginated],
    ['over limit', overLimit],
    ['full without completion proof', ambiguousFull],
  ]) {
    await t.test(caseName, async () => {
      const transport = new RecordingTransport(fixtures(), {
        postReadbacks: [readback, page([{ type: 'builds', id: BUILD_ID }])],
      });
      await assert.rejects(
        assignInternalGroup(transport, bindings, { now: () => NOW, sleep: async () => {} }),
        /INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN/u,
      );
      assert.equal(transport.requests.filter(({ method }) => method === 'POST').length, 1);
      assert.equal(transport.requests.filter(({ path }) => (
        path === `/v1/betaGroups/${GROUP_ID}/relationships/builds?limit=200`
      )).length, 2, 'one initial relationship GET plus one invalid readback');
    });
  }
});
