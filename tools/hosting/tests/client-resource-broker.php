<?php

declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/web-hosting/cabohealth.org/apps/client-resources/lib/runtime.php';

const TEST_NOW = 2_000_000_000;
const TEST_FRESH_NONCE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEST_SECOND_NONCE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TEST_EXPIRED_NONCE = 'cccccccccccccccccccccccccccccccc';
const TEST_SESSION = 'session_abcdefghijklmnopqrstuvwxyz1234567890';
const TEST_CSRF = 'csrf_abcdefghijklmnopqrstuvwxyz123456789012';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function expectSame(mixed $actual, mixed $expected, string $message): void
{
    if ($actual !== $expected) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}

/** @param class-string<Throwable> $class */
function expectThrows(callable $operation, string $class, string $message): void
{
    try {
        $operation();
    } catch (Throwable $error) {
        expect($error instanceof $class, $message . ': wrong exception ' . $error::class);
        return;
    }
    throw new RuntimeException($message . ': expected an exception');
}

final class FakeClientResourcesBackend implements ClientResourcesBackend
{
    /** @var array<string, int> */
    private array $issuedAt = [
        TEST_FRESH_NONCE => TEST_NOW - 59,
        TEST_SECOND_NONCE => TEST_NOW,
        TEST_EXPIRED_NONCE => TEST_NOW - 60,
    ];

    /** @var array<string, true> */
    private array $used = [];

    public int $redeemCalls = 0;
    public int $revokeCalls = 0;
    public int $sessionExpiresAt = TEST_NOW + 1800;
    public bool $revoked = false;
    public bool $hasEntitlement = true;

    public function redeemLaunchNonce(string $nonce): array
    {
        $this->redeemCalls += 1;
        $issuedAt = $this->issuedAt[$nonce] ?? 0;
        if ($issuedAt <= TEST_NOW - 60 || $issuedAt > TEST_NOW || isset($this->used[$nonce])) {
            throw new ClientResourcesAccessDenied('Denied.');
        }
        $this->used[$nonce] = true;
        return ['sessionId' => TEST_SESSION, 'expiresAt' => $this->sessionExpiresAt];
    }

    public function introspectSession(string $sessionId): array
    {
        if ($sessionId !== TEST_SESSION) {
            throw new ClientResourcesAccessDenied('Denied.');
        }
        return [
            'active' => !$this->revoked,
            'expiresAt' => $this->sessionExpiresAt,
            'entitlements' => $this->hasEntitlement ? [CLIENT_RESOURCES_APP_ID] : [],
            'csrfToken' => TEST_CSRF,
        ];
    }

    public function revokeSession(string $sessionId, string $csrfToken): void
    {
        $this->revokeCalls += 1;
        if ($sessionId !== TEST_SESSION || $csrfToken !== TEST_CSRF) {
            throw new ClientResourcesAccessDenied('Denied.');
        }
        $this->revoked = true;
    }
}

final class FakeClientResourcesContentStore implements ClientResourcesPrivateContentStore
{
    public function read(string $locale): array
    {
        return [
            'schemaVersion' => 1,
            'locale' => $locale,
            'title' => $locale === 'es-MX' ? 'Biblioteca educativa' : 'Education library',
            'introduction' => $locale === 'es-MX' ? 'Educación general.' : 'General education.',
            'sections' => [[
                'id' => 'general-orientation',
                'title' => $locale === 'es-MX' ? 'Orientación general' : 'General orientation',
                'summary' => $locale === 'es-MX' ? 'Información no personalizada.' : 'Non-personalized information.',
                'items' => [$locale === 'es-MX' ? 'Habla con un profesional calificado.' : 'Speak with a qualified professional.'],
            ]],
        ];
    }
}

final class QueueClientResourcesTransport implements ClientResourcesHttpTransport
{
    /** @var list<array{url:string,headers:list<string>,body:string}> */
    public array $calls = [];

    /** @param list<ClientResourcesTransportResponse> $responses */
    public function __construct(private array $responses)
    {
    }

    public function post(string $url, array $headers, string $body): ClientResourcesTransportResponse
    {
        $this->calls[] = ['url' => $url, 'headers' => $headers, 'body' => $body];
        $response = array_shift($this->responses);
        if (!$response instanceof ClientResourcesTransportResponse) {
            throw new ClientResourcesUnavailable('No fake response configured.');
        }
        return $response;
    }
}

/** @param list<string> $headers */
function findHeader(array $headers, string $name): string
{
    $prefix = $name . ': ';
    foreach ($headers as $header) {
        if (str_starts_with($header, $prefix)) {
            return substr($header, strlen($prefix));
        }
    }
    return '';
}

$backend = new FakeClientResourcesBackend();
$store = new FakeClientResourcesContentStore();
$clock = static fn (): int => TEST_NOW;

$getLaunch = client_resources_launch_response(
    new ClientResourcesRequest('GET', '', 'nonce=' . TEST_FRESH_NONCE),
    $backend,
    $clock,
);
expectSame($getLaunch->status, 405, 'GET launch must be rejected');
expectSame($backend->redeemCalls, 0, 'GET must not reach the backend');
expect(!str_contains($getLaunch->body, TEST_FRESH_NONCE), 'GET errors must not reflect a nonce');

$queryLaunch = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/x-www-form-urlencoded;charset=UTF-8', 'nonce=' . TEST_FRESH_NONCE, 'nonce=' . TEST_FRESH_NONCE),
    $backend,
    $clock,
);
expectSame($queryLaunch->status, 400, 'A launch query string must be rejected');
expectSame($backend->redeemCalls, 0, 'A query-bearing launch must not reach the backend');

$wrongMedia = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/json', '', '{"nonce":"redacted"}'),
    $backend,
    $clock,
);
expectSame($wrongMedia->status, 415, 'Launch accepts only the exact form media type');

$extraFormField = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/x-www-form-urlencoded;charset=UTF-8', '', 'nonce=' . TEST_FRESH_NONCE . '&grant=forbidden'),
    $backend,
    $clock,
);
expectSame($extraFormField->status, 400, 'Launch accepts only one nonce field');

$wrongNonceLength = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/x-www-form-urlencoded;charset=UTF-8', '', 'nonce=' . str_repeat('n', 33)),
    $backend,
    $clock,
);
expectSame($wrongNonceLength->status, 400, 'Launch requires the backend 32-character nonce contract');
expectSame($backend->redeemCalls, 0, 'An invalid nonce shape must not reach the backend');

$launch = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/x-www-form-urlencoded;charset=UTF-8', '', 'nonce=' . TEST_FRESH_NONCE),
    $backend,
    $clock,
);
expectSame($launch->status, 303, 'A valid nonce must redirect with 303');
expectSame($launch->headers['Location'] ?? null, CLIENT_RESOURCES_BASE_PATH, 'Redirect must be the clean canonical shell path');
$cookie = $launch->headers['Set-Cookie'] ?? '';
expect(str_starts_with($cookie, CLIENT_RESOURCES_COOKIE_NAME . '='), 'Session cookie name must use the scoped __Secure- contract');
expect(str_contains($cookie, 'Max-Age=1800'), 'Cookie lifetime must be capped by backend session expiry');
expect(str_contains($cookie, 'Path=' . CLIENT_RESOURCES_BASE_PATH), 'Cookie must be path scoped');
expect(str_contains($cookie, 'Secure'), 'Cookie must be Secure');
expect(str_contains($cookie, 'HttpOnly'), 'Cookie must be HttpOnly');
expect(str_contains($cookie, 'SameSite=Strict'), 'Cookie must use SameSite=Strict');
expect(!str_contains($cookie, 'Domain='), 'Cookie must remain host-only');
expect(!str_contains($cookie, '__Host-'), 'A scoped cookie must not use the incompatible __Host- prefix');
expect(!str_contains(implode("\n", $launch->headers) . $launch->body, TEST_FRESH_NONCE), 'Successful responses must not expose nonce material');

$replay = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/x-www-form-urlencoded;charset=UTF-8', '', 'nonce=' . TEST_FRESH_NONCE),
    $backend,
    $clock,
);
expectSame($replay->status, 401, 'A launch nonce must be one-use');

$expiredNonce = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/x-www-form-urlencoded;charset=UTF-8', '', 'nonce=' . TEST_EXPIRED_NONCE),
    $backend,
    $clock,
);
expectSame($expiredNonce->status, 401, 'A launch nonce at its 60-second expiry boundary must fail');

$backend->sessionExpiresAt = TEST_NOW + 7200;
$longSessionLaunch = client_resources_launch_response(
    new ClientResourcesRequest('POST', 'application/x-www-form-urlencoded;charset=UTF-8', '', 'nonce=' . TEST_SECOND_NONCE),
    $backend,
    $clock,
);
expectSame($longSessionLaunch->status, 303, 'A backend session beyond one hour may still launch');
expect(str_contains($longSessionLaunch->headers['Set-Cookie'] ?? '', 'Max-Age=3600'), 'Cookie lifetime must never exceed one hour');
$backend->sessionExpiresAt = TEST_NOW + 1800;

expectThrows(
    static fn () => client_resources_cookie_header('__Host-cabohealth_client', TEST_SESSION, 60, CLIENT_RESOURCES_BASE_PATH),
    LogicException::class,
    'The cookie helper must reject __Host- with a scoped path',
);
expectThrows(
    static fn () => client_resources_cookie_header(CLIENT_RESOURCES_COOKIE_NAME, TEST_SESSION, 60, '/'),
    ClientResourcesUnavailable::class,
    'The scoped cookie must not be widened to the host root',
);

$noSession = client_resources_resources_response(
    new ClientResourcesRequest('GET', '', 'lang=en'),
    $backend,
    $store,
    $clock,
);
expectSame($noSession->status, 401, 'Protected API must fail closed without a session');

$wrongResourceMethod = client_resources_resources_response(
    new ClientResourcesRequest('POST', 'application/json', 'lang=en'),
    $backend,
    $store,
    $clock,
);
expectSame($wrongResourceMethod->status, 405, 'Protected resources are read through GET only');

$extraResourceQuery = client_resources_resources_response(
    new ClientResourcesRequest('GET', '', 'lang=en&debug=1', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION]),
    $backend,
    $store,
    $clock,
);
expectSame($extraResourceQuery->status, 400, 'Protected resource query parameters are allowlisted exactly');

$traversal = client_resources_resources_response(
    new ClientResourcesRequest('GET', '', 'lang=../../private', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION]),
    $backend,
    $store,
    $clock,
);
expectSame($traversal->status, 400, 'Locale path traversal must be rejected before content access');

$resources = client_resources_resources_response(
    new ClientResourcesRequest('GET', '', 'lang=es-MX', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION]),
    $backend,
    $store,
    $clock,
);
expectSame($resources->status, 200, 'A live authorized session may read general resources');
expectSame($resources->headers['Cache-Control'] ?? null, 'no-store, max-age=0', 'Protected resources must never be cached');
expectSame($resources->headers['Vary'] ?? null, 'Cookie', 'Protected resources must vary by session cookie');
expectSame($resources->headers['X-CaboHealth-CSRF-Token'] ?? null, TEST_CSRF, 'The in-memory logout token must come from the live session');
$resourceDocument = json_decode($resources->body, true, 32, JSON_THROW_ON_ERROR);
expectSame($resourceDocument['locale'] ?? null, 'es-MX', 'API must return the requested reviewed locale');

$backend->hasEntitlement = false;
$wrongEntitlement = client_resources_resources_response(
    new ClientResourcesRequest('GET', '', 'lang=en', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION]),
    $backend,
    $store,
    $clock,
);
expectSame($wrongEntitlement->status, 401, 'A live session without the exact entitlement must fail closed');
$backend->hasEntitlement = true;

$backend->sessionExpiresAt = TEST_NOW - 1;
$expiredSession = client_resources_resources_response(
    new ClientResourcesRequest('GET', '', 'lang=en', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION]),
    $backend,
    $store,
    $clock,
);
expectSame($expiredSession->status, 401, 'An expired session must fail closed');
$backend->sessionExpiresAt = TEST_NOW + 1800;

$wrongOriginLogout = client_resources_delete_session_response(
    new ClientResourcesRequest('DELETE', '', '', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION], 'https://example.org', TEST_CSRF),
    $backend,
);
expectSame($wrongOriginLogout->status, 403, 'Logout must reject a cross-origin request');
expectSame($backend->revokeCalls, 0, 'Cross-origin logout must not reach the backend');

$wrongCsrfLogout = client_resources_delete_session_response(
    new ClientResourcesRequest('DELETE', '', '', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION], CLIENT_RESOURCES_CANONICAL_ORIGIN, str_repeat('x', 40)),
    $backend,
);
expectSame($wrongCsrfLogout->status, 403, 'Logout must reject a wrong CSRF token');
expectSame($backend->revokeCalls, 1, 'A syntactically valid CSRF value is verified by the backend');

$logout = client_resources_delete_session_response(
    new ClientResourcesRequest('DELETE', '', '', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION], CLIENT_RESOURCES_CANONICAL_ORIGIN, TEST_CSRF),
    $backend,
);
expectSame($logout->status, 204, 'A same-origin logout with live CSRF must succeed');
expectSame($backend->revokeCalls, 2, 'Valid logout must revoke through the backend');
$expiredCookie = $logout->headers['Set-Cookie'] ?? '';
expect(str_contains($expiredCookie, 'Max-Age=0'), 'Logout must expire the cookie');
expect(str_contains($expiredCookie, 'Path=' . CLIENT_RESOURCES_BASE_PATH), 'Logout must expire the exact scoped cookie');
expect(str_contains($expiredCookie, 'Secure; HttpOnly; SameSite=Strict'), 'Expired cookie must retain security attributes');

$afterRevoke = client_resources_resources_response(
    new ClientResourcesRequest('GET', '', 'lang=en', '', [CLIENT_RESOURCES_COOKIE_NAME => TEST_SESSION]),
    $backend,
    $store,
    $clock,
);
expectSame($afterRevoke->status, 401, 'A revoked session must fail on the next API request');

$projectRoot = dirname(__DIR__, 3);
$documentRoot = $projectRoot . '/web-hosting/cabohealth.org';
$privateContentRoot = $projectRoot . '/client-resources-private/content';
$fileStore = new JsonClientResourcesPrivateContentStore($privateContentRoot, $documentRoot);
$reviewedSpanish = $fileStore->read('es-MX');
expectSame($reviewedSpanish['locale'] ?? null, 'es-MX', 'The reviewed private release must load outside docroot');
expectThrows(
    static fn () => new JsonClientResourcesPrivateContentStore($documentRoot . '/apps', $documentRoot),
    ClientResourcesUnavailable::class,
    'A private content root inside docroot must be rejected',
);

$brokerBaseUrl = 'https://us-central1-cabohealth-production.cloudfunctions.net/brokerApi';
$brokerHost = 'us-central1-cabohealth-production.cloudfunctions.net';
$brokerKeyId = 'production-2026-08';
$brokerKey = 'test-only-broker-key-with-at-least-32-bytes';
$brokerRequestId = '123e4567-e89b-42d3-a456-426614174000';
$adapterNonce = str_repeat('n', 32);
$adapterTransport = new QueueClientResourcesTransport([
    new ClientResourcesTransportResponse(200, 'application/json; charset=utf-8', json_encode([
        'sessionId' => TEST_SESSION,
        'expiresAtMs' => (TEST_NOW + 1800) * 1000,
    ], JSON_THROW_ON_ERROR)),
    new ClientResourcesTransportResponse(200, 'application/json', json_encode([
        'active' => true,
        'expiresAtMs' => (TEST_NOW + 1800) * 1000,
        'entitlements' => [CLIENT_RESOURCES_APP_ID],
        'csrfToken' => TEST_CSRF,
    ], JSON_THROW_ON_ERROR)),
    new ClientResourcesTransportResponse(200, 'application/json', '{"revoked":true}'),
]);
$adapter = new SignedFunctionsClientResourcesBackend(
    $brokerBaseUrl,
    $brokerHost,
    $brokerKeyId,
    $brokerKey,
    $adapterTransport,
    static fn (): int => TEST_NOW,
    static fn (): string => $brokerRequestId,
);
$adapterLaunch = $adapter->redeemLaunchNonce($adapterNonce);
expectSame($adapterLaunch, ['sessionId' => TEST_SESSION, 'expiresAt' => TEST_NOW + 1800], 'Signed adapter must map the exact redeem response');
$redeemCall = $adapterTransport->calls[0] ?? null;
expect(is_array($redeemCall), 'Signed adapter must call the HTTP transport');
expectSame($redeemCall['url'], $brokerBaseUrl . '/v1/launch/redeem', 'Signed adapter must use the exact redeem path and host');
expectSame($redeemCall['body'], '{"nonce":"' . $adapterNonce . '"}', 'Signed adapter must sign exact raw JSON bytes');
expectSame(findHeader($redeemCall['headers'], 'X-CaboHealth-Key-Id'), $brokerKeyId, 'Signed adapter must send the configured key ID');
expectSame(findHeader($redeemCall['headers'], 'X-CaboHealth-Timestamp'), (string) TEST_NOW, 'Signed adapter must send Unix seconds');
expectSame(findHeader($redeemCall['headers'], 'X-CaboHealth-Request-Id'), $brokerRequestId, 'Signed adapter must send the UUID request ID');
$redeemDigest = client_resources_base64url(hash('sha256', $redeemCall['body'], true));
$redeemCanonical = "cabohealth-broker-v1\nPOST\n/v1/launch/redeem\n"
    . TEST_NOW . "\n" . $brokerRequestId . "\n" . $redeemDigest;
$expectedSignature = client_resources_base64url(hash_hmac('sha256', $redeemCanonical, $brokerKey, true));
expectSame(findHeader($redeemCall['headers'], 'X-CaboHealth-Signature'), $expectedSignature, 'Signed adapter canonical signature must match Functions');

$adapterSession = $adapter->introspectSession(TEST_SESSION);
expectSame($adapterSession, [
    'active' => true,
    'expiresAt' => TEST_NOW + 1800,
    'entitlements' => [CLIENT_RESOURCES_APP_ID],
    'csrfToken' => TEST_CSRF,
], 'Signed adapter must map the exact introspection response');
$adapter->revokeSession(TEST_SESSION, TEST_CSRF);
expectSame($adapterTransport->calls[2]['url'] ?? null, $brokerBaseUrl . '/v1/sessions/revoke', 'Signed adapter must use the exact revoke path');
expectSame($adapterTransport->calls[2]['body'] ?? null, json_encode([
    'sessionId' => TEST_SESSION,
    'csrfToken' => TEST_CSRF,
], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), 'Revoke body must contain only the opaque session and CSRF token');

expectThrows(
    static fn () => new SignedFunctionsClientResourcesBackend(
        $brokerBaseUrl,
        'different-project.cloudfunctions.net',
        $brokerKeyId,
        $brokerKey,
        new QueueClientResourcesTransport([]),
    ),
    ClientResourcesUnavailable::class,
    'The signed adapter must reject host mismatch',
);

$deniedAdapter = new SignedFunctionsClientResourcesBackend(
    $brokerBaseUrl,
    $brokerHost,
    $brokerKeyId,
    $brokerKey,
    new QueueClientResourcesTransport([
        new ClientResourcesTransportResponse(403, 'application/json', '{"error":"invalid_access"}'),
    ]),
    static fn (): int => TEST_NOW,
    static fn (): string => $brokerRequestId,
);
expectThrows(
    static fn () => $deniedAdapter->redeemLaunchNonce($adapterNonce),
    ClientResourcesAccessDenied::class,
    'Generic backend denial must remain fail closed',
);

$redirectAdapter = new SignedFunctionsClientResourcesBackend(
    $brokerBaseUrl,
    $brokerHost,
    $brokerKeyId,
    $brokerKey,
    new QueueClientResourcesTransport([
        new ClientResourcesTransportResponse(302, 'text/html', ''),
    ]),
    static fn (): int => TEST_NOW,
    static fn (): string => $brokerRequestId,
);
expectThrows(
    static fn () => $redirectAdapter->redeemLaunchNonce($adapterNonce),
    ClientResourcesUnavailable::class,
    'Backend redirects must be rejected',
);

$schemaDriftAdapter = new SignedFunctionsClientResourcesBackend(
    $brokerBaseUrl,
    $brokerHost,
    $brokerKeyId,
    $brokerKey,
    new QueueClientResourcesTransport([
        new ClientResourcesTransportResponse(200, 'application/json', '{"sessionId":"' . TEST_SESSION . '","expiresAtMs":2000001800000,"extra":true}'),
    ]),
    static fn (): int => TEST_NOW,
    static fn (): string => $brokerRequestId,
);
expectThrows(
    static fn () => $schemaDriftAdapter->redeemLaunchNonce($adapterNonce),
    ClientResourcesUnavailable::class,
    'Unexpected backend fields must fail closed',
);

echo "client resource broker: ok\n";
