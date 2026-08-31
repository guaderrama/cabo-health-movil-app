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

function fixtures({ allBuilds = false, assigned = false, postStatus = 204 } = {}) {
  return {
    app: { data: { type: 'apps', id: '6758285327', attributes: { bundleId: 'com.cabohealth.app' } } },
    builds: page([{
      type: 'builds', id: BUILD_ID,
      attributes: {
        version: '9', uploadedDate: '2026-08-30T11:00:00.000Z',
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
  };
}

class RecordingTransport {
  constructor(values, { revealAfterPost = false } = {}) {
    this.values = values;
    this.requests = [];
    this.revealAfterPost = revealAfterPost;
    this.posted = false;
  }

  async request(request) {
    this.requests.push(structuredClone(request));
    const path = request.path;
    if (request.method === 'POST') {
      this.posted = true;
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
  assert.equal(transport.requests.some(({ path }) => /betaTesters|appStoreVersions|reviewSubmissions/u.test(path)), false);
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
