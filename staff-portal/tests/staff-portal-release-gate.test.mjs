import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  STAFF_PRODUCTION_URL,
  createStaffReleaseArtifact,
  expectedStaffSecurityHeaders,
  verifyLiveStaffRelease,
  verifyStaffReleaseArtifact,
} from '../scripts/staff-release-gate.mjs';

const identity = Object.freeze({
  appEnv: 'production',
  expectedProjectId: 'cabohealth-prod',
  expectedWebAppId: '1:123456789012:web:abcdef0123456789',
  backendStaffWebAppId: '1:123456789012:web:abcdef0123456789',
  functionsRegion: 'us-central1',
});

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-staff-release-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><script src="/staff/assets/app.js"></script><link rel="stylesheet" href="/staff/assets/app.css">');
  writeFileSync(join(root, '404.html'), '<!doctype html><title>Not found</title>');
  writeFileSync(join(root, 'assets/app.js'), 'export const ok=true;');
  writeFileSync(join(root, 'assets/app.css'), 'body{color:#082a3c}');
  writeFileSync(join(root, 'staff-build-identity.json'), `${JSON.stringify({
    schemaVersion: 1,
    ...identity,
    functionsOrigin: 'https://us-central1-cabohealth-prod.cloudfunctions.net',
  })}\n`);
  writeFileSync(join(root, '.htaccess'), 'Options -Indexes\n');
  writeFileSync(join(root, '_headers'), '/*\n  Cache-Control: no-store\n');
  return root;
}

test('staff dist becomes its own identity-bound artifact with one fixed promotion target', (context) => {
  const root = makeFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const artifact = createStaffReleaseArtifact({ distDir: root, identity });

  assert.equal(artifact.artifactKind, 'cabohealth-staff-portal-v1');
  assert.deepEqual(artifact.promoteTargets, ['public_html/staff']);
  assert.match(artifact.releaseId, /^staff-v1-[a-f0-9]{64}$/u);
  assert.match(artifact.inventorySha256, /^[a-f0-9]{64}$/u);
  assert.match(artifact.artifactSha256, /^[a-f0-9]{64}$/u);
  assert.equal(artifact.files.some((entry) => entry.path === '404.html'), true);

  assert.deepEqual(verifyStaffReleaseArtifact({
    artifact,
    distDir: root,
    expectedIdentity: identity,
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
  }), artifact);

  writeFileSync(join(root, 'assets/app.js'), 'export const tampered=true;');
  assert.throws(() => verifyStaffReleaseArtifact({
    artifact,
    distDir: root,
    expectedIdentity: identity,
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
  }), /staff_release_artifact_mismatch/u);
});

test('artifact creation rejects a dist built for a different pinned backend identity', (context) => {
  const root = makeFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'staff-build-identity.json'), `${JSON.stringify({
    schemaVersion: 1,
    ...identity,
    expectedWebAppId: '1:123456789012:web:1111111111111111',
    backendStaffWebAppId: '1:123456789012:web:1111111111111111',
    functionsOrigin: 'https://us-central1-cabohealth-prod.cloudfunctions.net',
  })}\n`);

  assert.throws(
    () => createStaffReleaseArtifact({ distDir: root, identity }),
    /staff_release_build_identity_mismatch/u,
  );
});

test('artifact creation rejects unexpected files and verification rejects malformed media metadata', async (context) => {
  const root = makeFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'operator-notes.txt'), 'must never ship');
  assert.throws(
    () => createStaffReleaseArtifact({ distDir: root, identity }),
    /staff_release_unexpected_file/u,
  );

  rmSync(join(root, 'operator-notes.txt'));
  const artifact = createStaffReleaseArtifact({ distDir: root, identity });
  const malformed = structuredClone(artifact);
  malformed.files[0].mediaType = 'text/html; charset=utf-8';
  await assert.rejects(() => verifyLiveStaffRelease({
    artifact: malformed,
    baseUrl: STAFF_PRODUCTION_URL,
    fetchImpl: async () => { throw new Error('network_must_not_run'); },
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
  }), /staff_release_artifact_invalid/u);
});

test('live verification pins bytes and semantic content types on HTML, JS, CSS, and a closed fallback', async (context) => {
  const root = makeFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const artifact = createStaffReleaseArtifact({ distDir: root, identity });
  const securityHeaders = expectedStaffSecurityHeaders('https://us-central1-cabohealth-prod.cloudfunctions.net');
  const byPath = new Map(artifact.files.map((file) => [file.path, readFileSync(join(root, file.path))]));
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    const relative = path === '/staff/' ? 'index.html' : path.slice('/staff/'.length);
    const isFallback = relative === '__staff_release_probe__';
    const file = isFallback ? artifact.files.find((entry) => entry.path === '404.html') : artifact.files.find((entry) => entry.path === relative);
    assert.ok(file);
    return new Response(byPath.get(file.path), {
      status: isFallback ? 404 : 200,
      headers: {
        ...securityHeaders,
        'content-type': file.mediaType.replace('charset=utf-8', 'charset=UTF-8'),
      },
    });
  };

  const pins = {
    expectedReleaseId: artifact.releaseId,
    expectedInventorySha256: artifact.inventorySha256,
    expectedArtifactSha256: artifact.artifactSha256,
  };
  await verifyLiveStaffRelease({ artifact, baseUrl: STAFF_PRODUCTION_URL, fetchImpl, ...pins });

  const missingCspFetch = async (url) => {
    const response = await fetchImpl(url);
    const headers = Object.fromEntries(response.headers.entries());
    delete headers['content-security-policy'];
    return new Response(await response.arrayBuffer(), { status: response.status, headers });
  };
  await assert.rejects(
    () => verifyLiveStaffRelease({ artifact, baseUrl: STAFF_PRODUCTION_URL, fetchImpl: missingCspFetch, ...pins }),
    /staff_live_header_mismatch/u,
  );

  const wrongCharsetFetch = async (url) => {
    const response = await fetchImpl(url);
    const headers = Object.fromEntries(response.headers.entries());
    headers['content-type'] = headers['content-type'].replace('charset=UTF-8', 'charset=iso-8859-1');
    return new Response(await response.arrayBuffer(), { status: response.status, headers });
  };
  await assert.rejects(
    () => verifyLiveStaffRelease({ artifact, baseUrl: STAFF_PRODUCTION_URL, fetchImpl: wrongCharsetFetch, ...pins }),
    /staff_live_header_mismatch/u,
  );
});

test('live fallback must be a protected 404 and may not silently serve the portal', async (context) => {
  const root = makeFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const artifact = createStaffReleaseArtifact({ distDir: root, identity });
  const securityHeaders = expectedStaffSecurityHeaders('https://us-central1-cabohealth-prod.cloudfunctions.net');
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    const relative = path === '/staff/' ? 'index.html' : path.slice('/staff/'.length);
    const file = relative === '__staff_release_probe__' ? 'index.html' : relative;
    const entry = artifact.files.find((candidate) => candidate.path === file);
    assert.ok(entry);
    return new Response(readFileSync(join(root, file)), {
      status: 200,
      headers: { ...securityHeaders, 'content-type': entry.mediaType },
    });
  };

  await assert.rejects(
    () => verifyLiveStaffRelease({
      artifact,
      baseUrl: STAFF_PRODUCTION_URL,
      fetchImpl,
      expectedReleaseId: artifact.releaseId,
      expectedInventorySha256: artifact.inventorySha256,
      expectedArtifactSha256: artifact.artifactSha256,
    }),
    /staff_live_fallback_open/u,
  );
});
