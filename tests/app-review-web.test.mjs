import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('App Review launch is a dedicated POST-only nonce surface', () => {
  const runtimePath = 'web-hosting/cabohealth.org/apps/app-review/lib/runtime.php';
  const launchPath = 'web-hosting/cabohealth.org/apps/app-review/launch/index.php';

  assert.equal(existsSync(runtimePath), true);
  assert.equal(existsSync(launchPath), true);

  const runtime = readFileSync(runtimePath, 'utf8');
  const launch = readFileSync(launchPath, 'utf8');
  const surface = `${runtime}\n${launch}`;
  const launchFunction = runtime.slice(
    runtime.indexOf('function app_review_launch_response('),
    runtime.indexOf('function app_review_parse_csrf('),
  );

  assert.match(runtime, /APP_REVIEW_BASE_PATH\s*=\s*'\/apps\/app-review\/'/u);
  assert.match(runtime, /APP_REVIEW_COOKIE_NAME\s*=\s*'__Secure-cabohealth_app_review'/u);
  assert.match(runtime, /request->method\s*!==\s*'POST'/u);
  assert.match(runtime, /queryString\s*!==\s*''/u);
  assert.equal(runtime.includes("preg_match('/\\Anonce=([A-Za-z0-9_-]{32})\\z/u'"), true);
  assert.match(launchFunction, /return new AppReviewResponse\(200, \$headers, \$body\)/u);
  assert.doesNotMatch(launchFunction, /Location/u);
  assert.match(runtime, /href="\/apps\/app-review\/styles\.css"/u);
  assert.match(launch, /app_review_store_from_environment/u);
  assert.doesNotMatch(surface, /\$_GET\s*\[/u);
  assert.doesNotMatch(surface, /ReactNativeWebView|postMessage\s*\(/u);
});

test('Hostinger signs App Review broker calls in a separate realm', () => {
  const runtime = readFileSync('web-hosting/cabohealth.org/apps/app-review/lib/runtime.php', 'utf8');
  const factory = readFileSync('app-review-private/config/backend-factory.php.example', 'utf8');
  const schema = JSON.parse(readFileSync('app-review-private/config/broker-config.schema.json', 'utf8'));

  assert.match(runtime, /final class SignedFunctionsAppReviewBackend/u);
  assert.match(runtime, /SIGNATURE_VERSION\s*=\s*'cabohealth-app-review-broker-v1'/u);
  assert.match(runtime, /RESPONSE_SIGNATURE_VERSION\s*=\s*'cabohealth-app-review-broker-response-v1'/u);
  assert.match(runtime, /path\s*!==\s*'\/appReviewBrokerApi'/u);
  for (const header of [
    'X-CaboHealth-Key-Id',
    'X-CaboHealth-Timestamp',
    'X-CaboHealth-Request-Id',
    'X-CaboHealth-Signature',
  ]) assert.match(runtime, new RegExp(header, 'u'));
  assert.match(runtime, /x-cabohealth-response-signature/u);
  assert.match(runtime, /hash_equals\(\$expectedResponseSignature, \$responseSignature\)/u);

  assert.match(factory, /CABOHEALTH_APP_REVIEW_SIGNING_CONFIG/u);
  assert.match(runtime, /Private App Review backend factory must use mode 0600/u);
  assert.match(factory, /SignedFunctionsAppReviewBackend::fromPrivateConfigFile/u);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['schemaVersion', 'baseUrl', 'expectedHost', 'keyId', 'hmacKeyBase64']);

  assert.doesNotMatch(runtime, /SIGNATURE_VERSION\s*=\s*'cabohealth-broker-v1'/u);
  assert.doesNotMatch(`${runtime}\n${factory}`, /CLIENT_RESOURCES|CABOHEALTH_CLIENT_RESOURCES/u);
});

test('the fixed non-clinical App Review sample stays outside the public bundle', () => {
  const privatePath = 'app-review-private/content/sample.json';
  const publicPaths = [
    'web-hosting/cabohealth.org/apps/app-review/styles.css',
    'web-hosting/cabohealth.org/apps/app-review/launch/index.php',
    'web-hosting/cabohealth.org/apps/app-review/lib/runtime.php',
  ];
  assert.equal(existsSync(privatePath), true);
  for (const path of publicPaths) assert.equal(existsSync(path), true, `${path} must exist`);

  const sample = JSON.parse(readFileSync(privatePath, 'utf8'));
  assert.deepEqual(Object.keys(sample).sort(), ['locales', 'resourceId', 'schemaVersion']);
  assert.equal(sample.schemaVersion, 1);
  assert.equal(sample.resourceId, 'review-sandbox-app-review-sample-v1');
  assert.deepEqual(Object.keys(sample.locales).sort(), ['en', 'es-MX']);

  const serialized = JSON.stringify(sample);
  for (const forbidden of [
    'clientId',
    'dateOfBirth',
    'diagnosis',
    'dose',
    'labResult',
    'medicalRecord',
    'patientId',
    'protocol',
  ]) assert.equal(serialized.includes(`"${forbidden}"`), false);

  const publicBundle = publicPaths.map((path) => readFileSync(path, 'utf8')).join('\n');
  for (const locale of Object.values(sample.locales)) {
    for (const section of locale.sections) {
      assert.equal(publicBundle.includes(section.summary), false);
      for (const item of section.items) assert.equal(publicBundle.includes(item), false);
    }
  }
  assert.doesNotMatch(publicBundle, /ReactNativeWebView|postMessage\s*\(|analytics|indexedDB|serviceWorker/iu);
});

test('the App Review PHP behavior harness runs when PHP 8.2 is available', (context) => {
  const harness = 'tools/hosting/tests/app-review-broker.php';
  assert.equal(existsSync(harness), true);

  const version = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
  if (version.error?.code === 'ENOENT') {
    context.skip('PHP is not installed locally; CI and Hostinger must run the committed App Review harness.');
    return;
  }
  assert.equal(version.status, 0, version.stderr);
  assert.ok(Number(version.stdout) >= 80200, `PHP 8.2+ required, received ${version.stdout}`);

  const result = spawnSync('php', [harness], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /app review broker: ok/u);
});

test('only the exact launch POST can render the fixed review-realm sample', () => {
  const runtime = readFileSync('web-hosting/cabohealth.org/apps/app-review/lib/runtime.php', 'utf8');
  const launch = readFileSync('web-hosting/cabohealth.org/apps/app-review/launch/index.php', 'utf8');
  const session = readFileSync('web-hosting/cabohealth.org/apps/app-review/session/end/index.php', 'utf8');
  const apache = readFileSync('web-hosting/cabohealth.org/apps/app-review/.htaccess', 'utf8');

  assert.match(runtime, /public function introspectSession\(string \$sessionId\): array/u);
  assert.match(runtime, /public function revokeSession\(string \$sessionId, string \$csrfToken\): void/u);
  assert.match(runtime, /function app_review_end_session_response\(/u);
  assert.match(runtime, /\[APP_REVIEW_SAMPLE_ID\]/u);
  assert.match(runtime, /CABOHEALTH_APP_REVIEW_PRIVATE_CONTENT_ROOT/u);
  assert.match(runtime, /final class JsonAppReviewPrivateContentStore/u);
  assert.match(launch, /app_review_launch_response/u);
  assert.match(launch, /app_review_store_from_environment/u);
  assert.match(session, /app_review_end_session_response/u);
  assert.match(apache, /<Files "runtime\.php">[\s\S]*Require all denied/u);

  assert.equal(existsSync('web-hosting/cabohealth.org/apps/app-review/index.php'), false);
  assert.doesNotMatch(`${runtime}\n${launch}\n${session}`, /__Secure-cabohealth_client|client-resources/u);
  assert.match(runtime, /APP_REVIEW_COOKIE_NAME/u);
  assert.match(runtime, /APP_REVIEW_CANONICAL_ORIGIN/u);
  assert.match(runtime, /SameSite=Strict/u);
});

test('the PHP harness covers review-session lifecycle and cross-realm denial', () => {
  const harness = readFileSync('tools/hosting/tests/app-review-broker.php', 'utf8');

  assert.match(harness, /Production cookie must not authorize the review sample/u);
  assert.match(harness, /A different entitlement must fail closed/u);
  assert.match(harness, /Cross-origin session end must fail/u);
  assert.match(harness, /Wrong CSRF must fail/u);
  assert.match(harness, /Launch must render the fixed sample without navigating away/u);
  assert.match(harness, /Review adapter must reject the production broker path/u);
  assert.match(harness, /Production and review signatures must remain cross-realm incompatible/u);
  assert.match(harness, /production-realm response signature must fail/iu);
});

test('App Review web activation is fail-closed and separate from the public release', () => {
  const runbook = readFileSync('docs/operations/app-review-web-broker.md', 'utf8');
  const privateIgnore = readFileSync('app-review-private/.gitignore', 'utf8');
  const factory = readFileSync('app-review-private/config/backend-factory.php.example', 'utf8');
  const publicAssembler = readFileSync('scripts/assemble-web-release.mjs', 'utf8');

  assert.match(runbook, /NOT ACTIVE/u);
  assert.match(runbook, /no deployment was performed/iu);
  assert.match(runbook, /outside.*docroot/iu);
  assert.match(runbook, /0600/u);
  assert.match(runbook, /appReviewBrokerApi/u);
  assert.match(runbook, /cabohealth-app-review-broker-v1/u);
  assert.match(runbook, /never reuse/iu);
  assert.match(runbook, /tools\/hosting\/tests\/app-review-broker\.php/u);
  assert.match(runbook, /rotation/iu);

  assert.match(privateIgnore, /^config\/broker-config\.json$/mu);
  assert.match(privateIgnore, /^config\/backend-factory\.php$/mu);
  assert.match(factory, /CABOHEALTH_APP_REVIEW_SIGNING_CONFIG/u);
  assert.doesNotMatch(factory, /hmacKeyBase64\s*['"]?\s*=>/u);
  assert.doesNotMatch(publicAssembler, /apps\/app-review/u);
});

test('production Client Resources and App Review web realms cannot cross-consume configuration', () => {
  const production = readFileSync('web-hosting/cabohealth.org/apps/client-resources/lib/runtime.php', 'utf8');
  const review = readFileSync('web-hosting/cabohealth.org/apps/app-review/lib/runtime.php', 'utf8');
  const productionFactory = readFileSync('client-resources-private/config/backend-factory.php.example', 'utf8');
  const reviewFactory = readFileSync('app-review-private/config/backend-factory.php.example', 'utf8');

  assert.match(production, /cabohealth-broker-v1/u);
  assert.doesNotMatch(production, /cabohealth-app-review-broker-v1|appReviewBrokerApi|__Secure-cabohealth_app_review/u);
  assert.match(review, /cabohealth-app-review-broker-v1/u);
  assert.doesNotMatch(review, /SIGNATURE_VERSION\s*=\s*'cabohealth-broker-v1'|\/brokerApi|__Secure-cabohealth_client/u);

  assert.match(productionFactory, /CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG/u);
  assert.doesNotMatch(productionFactory, /CABOHEALTH_APP_REVIEW/u);
  assert.match(reviewFactory, /CABOHEALTH_APP_REVIEW_SIGNING_CONFIG/u);
  assert.doesNotMatch(reviewFactory, /CABOHEALTH_CLIENT_RESOURCES/u);
});
