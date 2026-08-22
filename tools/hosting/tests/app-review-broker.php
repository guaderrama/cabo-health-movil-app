<?php

declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/web-hosting/cabohealth.org/apps/app-review/lib/runtime.php';

const REVIEW_TEST_NOW = 2_000_000_000;
const REVIEW_TEST_NONCE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REVIEW_TEST_SESSION = 'review_session_abcdefghijklmnopqrstuvwxyz123456';
const REVIEW_TEST_CSRF = 'review_csrf_abcdefghijklmnopqrstuvwxyz1234567890';

function review_expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function review_expect_same(mixed $actual, mixed $expected, string $message): void
{
    if ($actual !== $expected) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}

/** @param class-string<Throwable> $class */
function review_expect_throws(callable $operation, string $class, string $message): void
{
    try {
        $operation();
    } catch (Throwable $error) {
        review_expect($error instanceof $class, $message . ': wrong exception ' . $error::class);
        return;
    }
    throw new RuntimeException($message . ': expected an exception');
}

final class FakeAppReviewBackend implements AppReviewBackend
{
    public int $redeemCalls = 0;
    public int $introspectCalls = 0;
    public int $revokeCalls = 0;
    public bool $active = true;
    public bool $exactEntitlement = true;
    public int $sessionExpiresAt = REVIEW_TEST_NOW + 1800;

    public function redeemLaunchNonce(string $nonce): array
    {
        $this->redeemCalls += 1;
        if ($nonce !== REVIEW_TEST_NONCE) {
            throw new AppReviewAccessDenied('Denied.');
        }
        return ['sessionId' => REVIEW_TEST_SESSION, 'expiresAt' => $this->sessionExpiresAt];
    }

    public function introspectSession(string $sessionId): array
    {
        $this->introspectCalls += 1;
        if ($sessionId !== REVIEW_TEST_SESSION) {
            throw new AppReviewAccessDenied('Denied.');
        }
        return [
            'active' => $this->active,
            'expiresAt' => $this->sessionExpiresAt,
            'entitlements' => $this->exactEntitlement ? [APP_REVIEW_SAMPLE_ID] : ['client-resources'],
            'csrfToken' => REVIEW_TEST_CSRF,
        ];
    }

    public function revokeSession(string $sessionId, string $csrfToken): void
    {
        $this->revokeCalls += 1;
        if ($sessionId !== REVIEW_TEST_SESSION || $csrfToken !== REVIEW_TEST_CSRF) {
            throw new AppReviewAccessDenied('Denied.');
        }
        $this->active = false;
    }
}

final class QueueAppReviewTransport implements AppReviewHttpTransport
{
    /** @var list<array{url:string,headers:list<string>,body:string}> */
    public array $calls = [];

    /** @param list<AppReviewTransportResponse> $responses */
    public function __construct(private array $responses)
    {
    }

    public function post(string $url, array $headers, string $body): AppReviewTransportResponse
    {
        $this->calls[] = ['url' => $url, 'headers' => $headers, 'body' => $body];
        $response = array_shift($this->responses);
        if (!$response instanceof AppReviewTransportResponse) {
            throw new RuntimeException('No queued response.');
        }
        return $response;
    }
}

/** @param list<string> $headers */
function review_find_header(array $headers, string $name): string
{
    $prefix = $name . ': ';
    foreach ($headers as $header) {
        if (str_starts_with($header, $prefix)) {
            return substr($header, strlen($prefix));
        }
    }
    return '';
}

$projectRoot = dirname(__DIR__, 3);
$documentRoot = $projectRoot . '/web-hosting/cabohealth.org';
$privateContentRoot = $projectRoot . '/app-review-private/content';
$store = new JsonAppReviewPrivateContentStore($privateContentRoot, $documentRoot);
$backend = new FakeAppReviewBackend();
$clock = static fn (): int => REVIEW_TEST_NOW;

$getLaunch = app_review_launch_response(new AppReviewRequest('GET'), $backend, $store, $clock);
review_expect_same($getLaunch->status, 405, 'GET launch must fail');
review_expect_same($backend->redeemCalls, 0, 'GET must not reach the review broker');

$productionCookieLaunch = app_review_launch_response(
    new AppReviewRequest('GET', '', '', '', ['__Secure-cabohealth_client' => REVIEW_TEST_SESSION]),
    $backend,
    $store,
    $clock,
);
review_expect_same($productionCookieLaunch->status, 405, 'Production cookie must not authorize the review sample');
review_expect_same($backend->introspectCalls, 0, 'A production cookie must not reach the review broker');

$queryLaunch = app_review_launch_response(
    new AppReviewRequest(
        'POST',
        'application/x-www-form-urlencoded;charset=UTF-8',
        'nonce=' . REVIEW_TEST_NONCE,
        'nonce=' . REVIEW_TEST_NONCE,
    ),
    $backend,
    $store,
    $clock,
);
review_expect_same($queryLaunch->status, 400, 'A nonce in the query string must fail');
review_expect_same($backend->redeemCalls, 0, 'Query launch must not reach the review broker');

$launch = app_review_launch_response(
    new AppReviewRequest(
        'POST',
        'application/x-www-form-urlencoded;charset=UTF-8',
        '',
        'nonce=' . REVIEW_TEST_NONCE,
    ),
    $backend,
    $store,
    $clock,
);
review_expect_same($launch->status, 200, 'Launch must render the fixed sample without navigating away');
review_expect(!isset($launch->headers['Location']), 'Launch must keep the main-frame URL at the exact launch path');
review_expect(str_contains($launch->body, 'App Review Sample'), 'Launch must render reviewed private content');
review_expect(!str_contains($launch->body, REVIEW_TEST_CSRF), 'The review CSRF token must not enter the rendered UI');
review_expect_same($backend->introspectCalls, 1, 'Launch must live-introspect before rendering');
$cookie = $launch->headers['Set-Cookie'] ?? '';
review_expect(str_starts_with($cookie, APP_REVIEW_COOKIE_NAME . '='), 'Launch must set the review-only cookie');
review_expect(str_contains($cookie, 'Path=' . APP_REVIEW_BASE_PATH), 'Review cookie must be path scoped');
review_expect(str_contains($cookie, 'Secure; HttpOnly; SameSite=Strict'), 'Review cookie must use secure attributes');
review_expect(!str_contains($cookie, 'Domain='), 'Review cookie must remain host-only');
review_expect(!str_contains(implode("\n", $launch->headers) . $launch->body, REVIEW_TEST_NONCE), 'Launch response must not expose nonce material');

$wrongEntitlementBackend = new FakeAppReviewBackend();
$wrongEntitlementBackend->exactEntitlement = false;
$wrongEntitlement = app_review_launch_response(
    new AppReviewRequest(
        'POST',
        'application/x-www-form-urlencoded;charset=UTF-8',
        '',
        'nonce=' . REVIEW_TEST_NONCE,
    ),
    $wrongEntitlementBackend,
    $store,
    $clock,
);
review_expect_same($wrongEntitlement->status, 401, 'A different entitlement must fail closed');

$crossOriginEnd = app_review_end_session_response(
    new AppReviewRequest(
        'POST',
        'application/x-www-form-urlencoded;charset=UTF-8',
        '',
        'csrf=' . REVIEW_TEST_CSRF,
        [APP_REVIEW_COOKIE_NAME => REVIEW_TEST_SESSION],
        'https://example.org',
    ),
    $backend,
);
review_expect_same($crossOriginEnd->status, 403, 'Cross-origin session end must fail');
review_expect_same($backend->revokeCalls, 0, 'Cross-origin session end must not reach the broker');

$wrongCsrfEnd = app_review_end_session_response(
    new AppReviewRequest(
        'POST',
        'application/x-www-form-urlencoded;charset=UTF-8',
        '',
        'csrf=' . str_repeat('x', 43),
        [APP_REVIEW_COOKIE_NAME => REVIEW_TEST_SESSION],
        APP_REVIEW_CANONICAL_ORIGIN,
    ),
    $backend,
);
review_expect_same($wrongCsrfEnd->status, 403, 'Wrong CSRF must fail');
review_expect_same($backend->revokeCalls, 1, 'Syntactically valid CSRF must be verified by the review broker');

$ended = app_review_end_session_response(
    new AppReviewRequest(
        'POST',
        'application/x-www-form-urlencoded;charset=UTF-8',
        '',
        'csrf=' . REVIEW_TEST_CSRF,
        [APP_REVIEW_COOKIE_NAME => REVIEW_TEST_SESSION],
        APP_REVIEW_CANONICAL_ORIGIN,
    ),
    $backend,
);
review_expect_same($ended->status, 303, 'Valid review session end must redirect away from protected content');
review_expect(str_contains($ended->headers['Set-Cookie'] ?? '', 'Max-Age=0'), 'Session end must expire the review cookie');
review_expect(str_contains($ended->headers['Set-Cookie'] ?? '', 'Path=' . APP_REVIEW_BASE_PATH), 'Expired cookie must retain the review path');

review_expect_throws(
    static fn () => new JsonAppReviewPrivateContentStore($documentRoot . '/apps', $documentRoot),
    AppReviewUnavailable::class,
    'Review content inside public_html must be rejected',
);

$brokerBaseUrl = 'https://us-central1-cabohealth-review.cloudfunctions.net/appReviewBrokerApi';
$brokerHost = 'us-central1-cabohealth-review.cloudfunctions.net';
$brokerKeyId = 'review-2026-08';
$brokerKey = 'test-only-review-key-with-at-least-32-bytes';
$brokerRequestId = '123e4567-e89b-42d3-a456-426614174000';
$transport = new QueueAppReviewTransport([
    new AppReviewTransportResponse(200, 'application/json', json_encode([
        'sessionId' => REVIEW_TEST_SESSION,
        'expiresAtMs' => (REVIEW_TEST_NOW + 1800) * 1000,
    ], JSON_THROW_ON_ERROR)),
    new AppReviewTransportResponse(200, 'application/json; charset=utf-8', json_encode([
        'active' => true,
        'expiresAtMs' => (REVIEW_TEST_NOW + 1800) * 1000,
        'entitlements' => [APP_REVIEW_SAMPLE_ID],
        'csrfToken' => REVIEW_TEST_CSRF,
    ], JSON_THROW_ON_ERROR)),
    new AppReviewTransportResponse(200, 'application/json', '{"revoked":true}'),
]);
$adapter = new SignedFunctionsAppReviewBackend(
    $brokerBaseUrl,
    $brokerHost,
    $brokerKeyId,
    $brokerKey,
    $transport,
    static fn (): int => REVIEW_TEST_NOW,
    static fn (): string => $brokerRequestId,
);
review_expect_same(
    $adapter->redeemLaunchNonce(REVIEW_TEST_NONCE),
    ['sessionId' => REVIEW_TEST_SESSION, 'expiresAt' => REVIEW_TEST_NOW + 1800],
    'Adapter must map the exact App Review redeem response',
);
$call = $transport->calls[0] ?? null;
review_expect(is_array($call), 'Adapter must call its transport');
review_expect_same($call['url'], $brokerBaseUrl . '/v1/launch/redeem', 'Adapter must use appReviewBrokerApi');
review_expect_same($call['body'], '{"nonce":"' . REVIEW_TEST_NONCE . '"}', 'Adapter must sign exact raw JSON');
$digest = app_review_base64url(hash('sha256', $call['body'], true));
$reviewCanonical = "cabohealth-app-review-broker-v1\nPOST\n/v1/launch/redeem\n"
    . REVIEW_TEST_NOW . "\n" . $brokerRequestId . "\n" . $digest;
$productionCanonical = "cabohealth-broker-v1\nPOST\n/v1/launch/redeem\n"
    . REVIEW_TEST_NOW . "\n" . $brokerRequestId . "\n" . $digest;
$reviewSignature = app_review_base64url(hash_hmac('sha256', $reviewCanonical, $brokerKey, true));
$productionSignature = app_review_base64url(hash_hmac('sha256', $productionCanonical, $brokerKey, true));
review_expect_same(review_find_header($call['headers'], 'X-CaboHealth-Signature'), $reviewSignature, 'Review realm signature must match');
review_expect($reviewSignature !== $productionSignature, 'Production and review signatures must remain cross-realm incompatible');

review_expect_same($adapter->introspectSession(REVIEW_TEST_SESSION), [
    'active' => true,
    'expiresAt' => REVIEW_TEST_NOW + 1800,
    'entitlements' => [APP_REVIEW_SAMPLE_ID],
    'csrfToken' => REVIEW_TEST_CSRF,
], 'Review adapter must accept only the fixed review entitlement');
review_expect_same(
    $transport->calls[1]['url'] ?? null,
    $brokerBaseUrl . '/v1/sessions/introspect',
    'Review adapter must introspect only through appReviewBrokerApi',
);
$adapter->revokeSession(REVIEW_TEST_SESSION, REVIEW_TEST_CSRF);
review_expect_same(
    $transport->calls[2]['url'] ?? null,
    $brokerBaseUrl . '/v1/sessions/revoke',
    'Review adapter must revoke only through appReviewBrokerApi',
);

review_expect_throws(
    static fn () => new SignedFunctionsAppReviewBackend(
        'https://us-central1-cabohealth-review.cloudfunctions.net/brokerApi',
        $brokerHost,
        $brokerKeyId,
        $brokerKey,
        new QueueAppReviewTransport([]),
    ),
    AppReviewUnavailable::class,
    'Review adapter must reject the production broker path',
);

echo "app review broker: ok\n";
