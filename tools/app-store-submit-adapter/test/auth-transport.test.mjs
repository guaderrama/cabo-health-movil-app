import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AppStoreConnectTransport,
  createJwt,
  loadCredentials,
} from '../src/index.mjs';
import { API_ORIGIN, MAX_JSON_BYTES } from '../src/constants.mjs';

const NOW = Date.parse('2026-08-25T20:00:00.000Z');
const KEY_ID = 'ABC123DEFG';
// Apple's documented issuer-ID example is UUID-shaped but not an RFC 4122
// version/variant UUID; the adapter must preserve that official format.
const ISSUER_ID = '57246542-96fe-1a63-e053-0824d011072a';

function credentialFixture(mode = 0o600) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cabohealth-asc-key-')));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keyPath = join(root, 'AuthKey_ABC123DEFG.p8');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode });
  chmodSync(keyPath, mode);
  return {
    publicKey,
    environment: {
      APP_STORE_CONNECT_KEY_KIND: 'team',
      APP_STORE_CONNECT_KEY_ID: KEY_ID,
      APP_STORE_CONNECT_ISSUER_ID: ISSUER_ID,
      APP_STORE_CONNECT_PRIVATE_KEY_PATH: keyPath,
    },
  };
}

test('loads only an owner-mode-0600 P-256 key by absolute path and signs a short-lived ES256 JWT', () => {
  const fixture = credentialFixture();
  const credentials = loadCredentials(fixture.environment);
  const token = createJwt(credentials, { now: NOW });
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, 'base64url')), {
    alg: 'ES256',
    kid: KEY_ID,
    typ: 'JWT',
  });
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url'));
  assert.equal(payload.iss, ISSUER_ID);
  assert.equal(payload.aud, 'appstoreconnect-v1');
  assert.equal(payload.exp - payload.iat, 19 * 60);
  assert.equal(verify(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
    { key: fixture.publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(encodedSignature, 'base64url'),
  ), true);
});

test('supports the current individual-key JWT form with sub=user and no issuer', () => {
  const fixture = credentialFixture();
  fixture.environment.APP_STORE_CONNECT_KEY_KIND = 'individual';
  delete fixture.environment.APP_STORE_CONNECT_ISSUER_ID;
  const token = createJwt(loadCredentials(fixture.environment), { now: NOW });
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(payload.sub, 'user');
  assert.equal(Object.hasOwn(payload, 'iss'), false);

  fixture.environment.APP_STORE_CONNECT_ISSUER_ID = ISSUER_ID;
  assert.throws(
    () => loadCredentials(fixture.environment),
    /APP_STORE_CONNECT_CREDENTIALS_INVALID/u,
  );
});

test('rejects permissive key modes, malformed identity, and every raw-key environment variable', () => {
  const permissive = credentialFixture(0o644);
  assert.throws(
    () => loadCredentials(permissive.environment),
    /APP_STORE_CONNECT_PRIVATE_KEY_FILE_INVALID/u,
  );
  const malformed = credentialFixture();
  malformed.environment.APP_STORE_CONNECT_KEY_ID = 'short';
  assert.throws(
    () => loadCredentials(malformed.environment),
    /APP_STORE_CONNECT_CREDENTIALS_INVALID/u,
  );
  const malformedIssuer = credentialFixture();
  malformedIssuer.environment.APP_STORE_CONNECT_ISSUER_ID = 'not-an-issuer-id';
  assert.throws(
    () => loadCredentials(malformedIssuer.environment),
    /APP_STORE_CONNECT_CREDENTIALS_INVALID/u,
  );
  for (const key of [
    'APP_STORE_CONNECT_PRIVATE_KEY',
    'ASC_PRIVATE_KEY',
    'EXPO_ASC_KEY_P8',
    'EXPO_ASC_KEY',
  ]) {
    const fixture = credentialFixture();
    fixture.environment[key] = 'never-accept-inline-secret';
    assert.throws(
      () => loadCredentials(fixture.environment),
      /RAW_PRIVATE_KEY_ENVIRONMENT_FORBIDDEN/u,
    );
  }
});

test('HTTP transport fixes the Apple origin, signs Authorization, rejects redirects, and returns JSON only', async () => {
  const fixture = credentialFixture();
  const credentials = loadCredentials(fixture.environment);
  let captured;
  const transport = new AppStoreConnectTransport(credentials, {
    now: () => NOW,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '20' },
      });
    },
  });
  const response = await transport.request({ method: 'GET', path: '/v1/apps/6758285327' });
  assert.equal(captured.url, `${API_ORIGIN}/v1/apps/6758285327`);
  assert.equal(captured.options.redirect, 'error');
  assert.match(captured.options.headers.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/u);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { data: { ok: true } });
});

test('HTTP failures expose only a deterministic status code, never the Apple body or token', async () => {
  const fixture = credentialFixture();
  const credentials = loadCredentials(fixture.environment);
  let authorization;
  const transport = new AppStoreConnectTransport(credentials, {
    now: () => NOW,
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify({
        errors: [{ detail: 'supersecret-review-note-and-account-email' }],
      }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  let caught;
  try {
    await transport.request({ method: 'GET', path: '/v1/apps/6758285327' });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught.message, 'APP_STORE_CONNECT_HTTP_422');
  assert.doesNotMatch(caught.message, /supersecret|Bearer|eyJ/u);
  assert.ok(authorization.startsWith('Bearer '));
});

test('transport rejects alternate origins, malformed paths, and unexpected response media types', async () => {
  const fixture = credentialFixture();
  const credentials = loadCredentials(fixture.environment);
  const transport = new AppStoreConnectTransport(credentials, {
    now: () => NOW,
    fetchImpl: async () => new Response('<html>not json</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  });
  await assert.rejects(
    transport.request({ method: 'GET', path: 'https://evil.example/v1/apps' }),
    /APP_STORE_CONNECT_REQUEST_INVALID/u,
  );
  await assert.rejects(
    transport.request({ method: 'DELETE', path: '/v1/apps/6758285327' }),
    /APP_STORE_CONNECT_REQUEST_INVALID/u,
  );
  await assert.rejects(
    transport.request({ method: 'GET', path: '/v1/apps/6758285327' }),
    /APP_STORE_CONNECT_RESPONSE_INVALID/u,
  );
  const oversized = new AppStoreConnectTransport(credentials, {
    now: () => NOW,
    fetchImpl: async () => new Response('x'.repeat(MAX_JSON_BYTES + 1), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(
    oversized.request({ method: 'GET', path: '/v1/apps/6758285327' }),
    /APP_STORE_CONNECT_RESPONSE_INVALID/u,
  );
});
