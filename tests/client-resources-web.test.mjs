import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isClientResourceDocument,
  requestClientResources,
  requestEndClientSession,
} from '../web-hosting/cabohealth.org/apps/client-resources/client-resources-api.js';

test('the public shell fails closed when the protected API returns 401', async () => {
  let bodyRead = false;
  const result = await requestClientResources({
    language: 'en',
    fetchImpl: async (url, options) => {
      assert.equal(url, './api/resources/?lang=en');
      assert.deepEqual(options, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      return {
        ok: false,
        status: 401,
        async json() {
          bodyRead = true;
          return { protected: 'must not be interpreted' };
        },
      };
    },
  });

  assert.deepEqual(result, { kind: 'unauthorized' });
  assert.equal(bodyRead, false);
});

test('an authorized shell accepts the small reviewed resource document', async () => {
  const content = {
    schemaVersion: 1,
    locale: 'es-MX',
    title: 'Recursos generales para clientes',
    introduction: 'Material educativo general; no contiene información clínica personal.',
    sections: [{
      id: 'healthy-aging-basics',
      title: 'Fundamentos de envejecimiento saludable',
      summary: 'Ideas generales para conversar con tu equipo de atención.',
      items: ['Prepara tus preguntas antes de una consulta.'],
    }],
  };

  const result = await requestClientResources({
    language: 'es-MX',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name === 'X-CaboHealth-CSRF-Token' ? 'csrf_abcdefghijklmnopqrstuvwxyz123456789012' : null },
      json: async () => content,
    }),
  });

  assert.deepEqual(result, {
    kind: 'ready',
    content,
    csrfToken: 'csrf_abcdefghijklmnopqrstuvwxyz123456789012',
  });
});

test('403, 429, and server errors stay generic and never interpret a response body', async () => {
  for (const status of [403, 429, 500, 503]) {
    let bodyRead = false;
    const result = await requestClientResources({
      language: 'en',
      fetchImpl: async () => ({
        ok: false,
        status,
        async json() {
          bodyRead = true;
          return { error: 'must remain opaque' };
        },
      }),
    });
    assert.deepEqual(result, { kind: 'error' });
    assert.equal(bodyRead, false);
  }
});

test('reviewed private documents match the strict non-personalized schema', () => {
  const forbiddenKeys = new Set([
    'clientId',
    'dateOfBirth',
    'diagnosis',
    'dose',
    'labResult',
    'medicalRecord',
    'name',
    'patientId',
    'protocol',
  ]);

  function assertNoForbiddenKeys(value) {
    if (Array.isArray(value)) {
      for (const item of value) assertNoForbiddenKeys(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `private content must not contain ${key}`);
      assertNoForbiddenKeys(child);
    }
  }

  for (const locale of ['en', 'es-MX']) {
    const document = JSON.parse(readFileSync(`client-resources-private/content/${locale}.json`, 'utf8'));
    assert.equal(isClientResourceDocument(document, locale), true);
    assertNoForbiddenKeys(document);
  }
});

test('ending a client session uses same-origin credentials and an in-memory CSRF token', async () => {
  const csrfToken = 'csrf_abcdefghijklmnopqrstuvwxyz123456789012';
  const result = await requestEndClientSession({
    csrfToken,
    fetchImpl: async (url, options) => {
      assert.equal(url, './api/session/');
      assert.deepEqual(options, {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      });
      return { status: 204 };
    },
  });

  assert.deepEqual(result, { kind: 'ended' });
});

test('the public shell contains no protected educational material', () => {
  const publicBundle = [
    'web-hosting/cabohealth.org/apps/client-resources/index.html',
    'web-hosting/cabohealth.org/apps/client-resources/app.js',
    'web-hosting/cabohealth.org/apps/client-resources/client-resources-api.js',
    'web-hosting/cabohealth.org/apps/client-resources/styles.css',
  ].map((path) => readFileSync(path, 'utf8')).join('\n');

  for (const locale of ['en', 'es-MX']) {
    const privateDocument = JSON.parse(readFileSync(`client-resources-private/content/${locale}.json`, 'utf8'));
    for (const section of privateDocument.sections) {
      assert.equal(publicBundle.includes(section.summary), false);
      for (const item of section.items) assert.equal(publicBundle.includes(item), false);
    }
  }

  assert.doesNotMatch(publicBundle, /ReactNativeWebView|postMessage\s*\(|analytics|indexedDB|serviceWorker/iu);
  assert.match(publicBundle, /data-end-session/u);
  assert.match(publicBundle, /End client session/u);
  assert.match(publicBundle, /Cerrar sesión de cliente/u);
  assert.match(publicBundle, /within 2 business days/u);
  assert.match(publicBundle, /dentro de 2 días hábiles/u);
  assert.match(publicBundle, /connect-src 'self'/u);
  assert.doesNotMatch(publicBundle, /\{\{CSP\}\}/u);
});

test('the broker surface is POST-only and uses a valid path-scoped secure cookie', () => {
  const runtime = readFileSync('web-hosting/cabohealth.org/apps/client-resources/lib/runtime.php', 'utf8');
  const launch = readFileSync('web-hosting/cabohealth.org/apps/client-resources/launch/index.php', 'utf8');
  const endpoints = `${runtime}\n${launch}`;

  assert.match(runtime, /__Secure-cabohealth_client/u);
  assert.doesNotMatch(runtime, /__Host-cabohealth_client/u);
  assert.match(runtime, /\/apps\/client-resources\//u);
  assert.doesNotMatch(endpoints, /\$_GET\s*\[\s*['"]nonce['"]\s*\]/u);
  assert.match(launch, /client_resources_launch_response/u);
  assert.match(runtime, /final class SignedFunctionsClientResourcesBackend/u);
  assert.match(runtime, /SIGNATURE_VERSION = 'cabohealth-broker-v1'/u);
  assert.match(runtime, /RESPONSE_SIGNATURE_VERSION = 'cabohealth-broker-response-v1'/u);
  assert.match(runtime, /self::SIGNATURE_VERSION \. "\\n"/u);
  for (const header of [
    'X-CaboHealth-Key-Id',
    'X-CaboHealth-Timestamp',
    'X-CaboHealth-Request-Id',
    'X-CaboHealth-Signature',
  ]) assert.match(runtime, new RegExp(header, 'u'));
  assert.match(runtime, /x-cabohealth-response-signature/u);
  assert.match(runtime, /hash_equals\(\$expectedResponseSignature, \$responseSignature\)/u);
  assert.match(runtime, /CURLOPT_FOLLOWLOCATION\s*=>\s*false/u);
  assert.doesNotMatch(runtime, /error_log\s*\(|trigger_error\s*\(/u);
  const apache = readFileSync('web-hosting/cabohealth.org/apps/client-resources/.htaccess', 'utf8');
  assert.match(apache, /<Files "runtime\.php">[\s\S]*Require all denied/u);
});

test('the PHP broker behavior suite is present and runs when PHP 8 is available', (context) => {
  const harness = 'tools/hosting/tests/client-resource-broker.php';
  assert.equal(existsSync(harness), true);

  const version = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
  if (version.error?.code === 'ENOENT') {
    context.skip('PHP is not installed in this local workspace; CI/Hostinger must run the committed PHP suite.');
    return;
  }
  assert.equal(version.status, 0, version.stderr);
  assert.ok(Number(version.stdout) >= 80200, `PHP 8.2+ required, received ${version.stdout}`);

  const result = spawnSync('php', [harness], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /client resource broker: ok/u);
});

test('production activation remains fail closed until private broker configuration is installed', () => {
  const factory = readFileSync('client-resources-private/config/backend-factory.php.example', 'utf8');
  const schema = JSON.parse(readFileSync('client-resources-private/config/broker-config.schema.json', 'utf8'));
  const runbook = readFileSync('docs/operations/client-resources-web-broker.md', 'utf8');
  const gitignore = readFileSync('.gitignore', 'utf8');

  assert.match(factory, /CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG/u);
  assert.match(factory, /fromPrivateConfigFile/u);
  assert.doesNotMatch(factory, /hmacKeyBase64\s*['"]?\s*=>/u);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['schemaVersion', 'baseUrl', 'expectedHost', 'keyId', 'hmacKeyBase64']);
  assert.match(runbook, /NOT ACTIVE/u);
  assert.match(runbook, /outside.*docroot/iu);
  assert.match(runbook, /0600/u);
  assert.match(runbook, /no\s+deployment was performed/iu);
  assert.match(runbook, /exactly eight rings/iu);
  assert.match(runbook, /CLIENT_DELETION_RECEIPT_PEPPER_RING/u);
  assert.match(runbook, /CLIENT_BROKER_HMAC_KEY_RING/u);
  assert.match(runbook, /protected-overlay-attestor\.php/u);
  assert.match(runbook, /c509d78a0c4696f36ba86543b7236142e4c241b14990921b912b0c60cc336c68/u);
  assert.match(runbook, /same PHP-FPM pool or Apache handler/iu);
  assert.match(runbook, /phpCliPath/u);
  assert.match(runbook, /phpCliVersionId/u);
  assert.match(runbook, /never invokes[\s\S]*PHP_BINARY/iu);
  assert.match(runbook, /never inherit attestation-key, broker-HMAC/iu);
  assert.match(runbook, /SSH command[\s\S]*negative test/iu);
  assert.match(runbook, /Current external gate:\s*\*\*BLOCKED\*\*/u);
  assert.match(gitignore, /^\/client-resources-private\/config\/broker-config\.json$/mu);
  assert.match(gitignore, /^\/client-resources-private\/config\/backend-factory\.php$/mu);
});
