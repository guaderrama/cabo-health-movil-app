<?php

declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/web-hosting/cabohealth.org/apps/client-resources/lib/runtime.php';

const DYNAMIC_TEST_NOW = 2_000_000_000;
const DYNAMIC_TEST_NONCE = 'dddddddddddddddddddddddddddddddd';
const DYNAMIC_TEST_SESSION = 'session_abcdefghijklmnopqrstuvwxyz1234567890';
const DYNAMIC_TEST_CSRF = 'csrf_abcdefghijklmnopqrstuvwxyz123456789012';

function dynamicExpect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function dynamicExpectSame(mixed $actual, mixed $expected, string $message): void
{
    if ($actual !== $expected) {
        throw new RuntimeException(
            $message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true),
        );
    }
}

/** @param class-string<Throwable> $class */
function dynamicExpectThrows(callable $operation, string $class, string $message): void
{
    try {
        $operation();
    } catch (Throwable $error) {
        dynamicExpect($error instanceof $class, $message . ': wrong exception ' . $error::class);
        return;
    }
    throw new RuntimeException($message . ': expected an exception');
}

final class DynamicClientResourcesBackend implements ClientResourcesBackend
{
    /** @param list<string> $entitlements */
    public function __construct(public array $entitlements)
    {
    }

    public function redeemLaunchNonce(string $nonce): array
    {
        if ($nonce !== DYNAMIC_TEST_NONCE) {
            throw new ClientResourcesAccessDenied('Denied.');
        }
        return ['sessionId' => DYNAMIC_TEST_SESSION, 'expiresAt' => DYNAMIC_TEST_NOW + 1800];
    }

    public function introspectSession(string $sessionId): array
    {
        if ($sessionId !== DYNAMIC_TEST_SESSION) {
            throw new ClientResourcesAccessDenied('Denied.');
        }
        return [
            'active' => true,
            'expiresAt' => DYNAMIC_TEST_NOW + 1800,
            'entitlements' => $this->entitlements,
            'csrfToken' => DYNAMIC_TEST_CSRF,
        ];
    }

    public function revokeSession(string $sessionId, string $csrfToken): void
    {
        throw new ClientResourcesAccessDenied('Not used by this harness.');
    }
}

final class DynamicClientResourcesContentStore implements ClientResourcesRoutedPrivateContentStore
{
    /** @var list<array{resourceId:string, locale:string}> */
    public array $reads = [];

    public function read(string $locale): array
    {
        throw new RuntimeException('The legacy reader must not handle a dynamic resource.');
    }

    public function readResource(string $resourceId, string $locale): array
    {
        $this->reads[] = ['resourceId' => $resourceId, 'locale' => $locale];
        return [
            'schemaVersion' => 1,
            'locale' => $locale,
            'title' => 'Private laboratory guide',
            'introduction' => 'General educational information.',
            'sections' => [[
                'id' => 'orientation',
                'title' => 'Orientation',
                'summary' => 'General information.',
                'items' => ['Speak with a qualified professional.'],
            ]],
        ];
    }
}

final class DynamicClientResourcesTransport implements ClientResourcesHttpTransport
{
    public function __construct(private readonly ClientResourcesTransportResponse $response)
    {
    }

    public function post(string $url, array $headers, string $body): ClientResourcesTransportResponse
    {
        return $this->response;
    }
}

function dynamicSignedResponse(string $body): ClientResourcesTransportResponse
{
    $path = '/v1/sessions/introspect';
    $requestId = '123e4567-e89b-42d3-a456-426614174000';
    $keyId = 'dynamic-test';
    $key = 'dynamic-test-broker-key-with-at-least-32-bytes';
    $bodyDigest = client_resources_base64url(hash('sha256', $body, true));
    $canonical = "cabohealth-broker-response-v1\n200\n"
        . $path . "\n" . $requestId . "\n" . $keyId . "\n" . $bodyDigest;
    return new ClientResourcesTransportResponse(200, 'application/json', $body, [
        'x-cabohealth-key-id' => $keyId,
        'x-cabohealth-request-id' => $requestId,
        'x-cabohealth-response-signature' => client_resources_base64url(hash_hmac('sha256', $canonical, $key, true)),
    ]);
}

function dynamicAdapter(string $body): SignedFunctionsClientResourcesBackend
{
    return new SignedFunctionsClientResourcesBackend(
        'https://us-central1-cabohealth-production.cloudfunctions.net/brokerApi',
        'us-central1-cabohealth-production.cloudfunctions.net',
        'dynamic-test',
        'dynamic-test-broker-key-with-at-least-32-bytes',
        new DynamicClientResourcesTransport(dynamicSignedResponse($body)),
        static fn (): int => DYNAMIC_TEST_NOW,
        static fn (): string => '123e4567-e89b-42d3-a456-426614174000',
    );
}

function dynamicResourcesResponse(
    DynamicClientResourcesBackend $backend,
    DynamicClientResourcesContentStore $store,
    string $queryString = 'lang=en',
    string $sessionId = DYNAMIC_TEST_SESSION,
): ClientResourcesResponse {
    return client_resources_resources_response(
        new ClientResourcesRequest(
            'GET',
            '',
            $queryString,
            '',
            [CLIENT_RESOURCES_COOKIE_NAME => $sessionId],
        ),
        $backend,
        $store,
        static fn (): int => DYNAMIC_TEST_NOW,
    );
}

/** @return array<string, mixed> */
function dynamicPrivateDocument(string $locale, string $title): array
{
    return [
        'schemaVersion' => 1,
        'locale' => $locale,
        'title' => $title,
        'introduction' => 'General educational information.',
        'sections' => [[
            'id' => 'orientation',
            'title' => 'Orientation',
            'summary' => 'General information.',
            'items' => ['Speak with a qualified professional.'],
        ]],
    ];
}

function dynamicRemoveFixture(string $path): void
{
    if (!file_exists($path) && !is_link($path)) return;
    if (!is_dir($path) || is_link($path)) {
        unlink($path);
        return;
    }
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        dynamicRemoveFixture($path . DIRECTORY_SEPARATOR . $entry);
    }
    rmdir($path);
}

$dynamicBackend = new DynamicClientResourcesBackend(['vip-lab-guide']);
$dynamicStore = new DynamicClientResourcesContentStore();
$dynamicLaunch = client_resources_launch_response(
    new ClientResourcesRequest(
        'POST',
        'application/x-www-form-urlencoded;charset=UTF-8',
        '',
        'nonce=' . DYNAMIC_TEST_NONCE,
    ),
    $dynamicBackend,
    static fn (): int => DYNAMIC_TEST_NOW,
);
dynamicExpectSame($dynamicLaunch->status, 303, 'A dynamic launch must establish the ordinary scoped web session.');
dynamicExpectSame(
    $dynamicLaunch->headers['Location'] ?? null,
    CLIENT_RESOURCES_BASE_PATH,
    'A dynamic launch must keep the clean shell URL.',
);
$dynamicCookie = $dynamicLaunch->headers['Set-Cookie'] ?? '';
dynamicExpect(
    preg_match('/\A' . preg_quote(CLIENT_RESOURCES_COOKIE_NAME, '/') . '=([^;]+);/u', $dynamicCookie, $cookieMatch) === 1,
    'A dynamic launch must set the scoped opaque session cookie.',
);
$launchedSessionId = rawurldecode($cookieMatch[1]);
dynamicExpect(
    !str_contains(implode("\n", $dynamicLaunch->headers) . $dynamicLaunch->body, 'vip-lab-guide'),
    'The launch response must not expose the routed resource ID.',
);
$dynamicResponse = dynamicResourcesResponse($dynamicBackend, $dynamicStore, 'lang=en', $launchedSessionId);

dynamicExpectSame($dynamicResponse->status, 200, 'A valid dynamic entitlement must load its private resource.');
dynamicExpectSame(
    $dynamicStore->reads,
    [['resourceId' => 'vip-lab-guide', 'locale' => 'en']],
    'The server-selected entitlement must be the only content routing input.',
);
dynamicExpect(!str_contains($dynamicResponse->body, 'client-resources'), 'The legacy resource must not replace a dynamic resource.');

$dynamicBackend->entitlements = ['vip-lab-guide', 'vip-nutrition'];
$dynamicStore->reads = [];
$multipleEntitlements = dynamicResourcesResponse($dynamicBackend, $dynamicStore);
dynamicExpectSame($multipleEntitlements->status, 503, 'A session with multiple entitlements must fail closed.');
dynamicExpectSame($dynamicStore->reads, [], 'Ambiguous authority must never reach private content.');

foreach (['../private', str_repeat('a', 65), '-leading', 'trailing-', 'vip--lab'] as $unsafeResourceId) {
    $dynamicBackend->entitlements = [$unsafeResourceId];
    $dynamicStore->reads = [];
    $unsafeEntitlement = dynamicResourcesResponse($dynamicBackend, $dynamicStore);
    dynamicExpectSame($unsafeEntitlement->status, 503, 'An unsafe resource ID must fail closed.');
    dynamicExpectSame($dynamicStore->reads, [], 'An unsafe resource ID must never reach private content.');
}

$multipleBody = json_encode([
    'active' => true,
    'expiresAtMs' => (DYNAMIC_TEST_NOW + 1800) * 1000,
    'entitlements' => ['vip-lab-guide', 'vip-nutrition'],
    'csrfToken' => DYNAMIC_TEST_CSRF,
], JSON_THROW_ON_ERROR);
$multipleAdapter = dynamicAdapter($multipleBody);
dynamicExpectThrows(
    static fn () => $multipleAdapter->introspectSession(DYNAMIC_TEST_SESSION),
    ClientResourcesUnavailable::class,
    'The signed adapter must reject an introspection response with multiple entitlements.',
);

$unsafeAdapterBody = json_encode([
    'active' => true,
    'expiresAtMs' => (DYNAMIC_TEST_NOW + 1800) * 1000,
    'entitlements' => [str_repeat('a', 65)],
    'csrfToken' => DYNAMIC_TEST_CSRF,
], JSON_THROW_ON_ERROR);
$unsafeAdapter = dynamicAdapter($unsafeAdapterBody);
dynamicExpectThrows(
    static fn () => $unsafeAdapter->introspectSession(DYNAMIC_TEST_SESSION),
    ClientResourcesUnavailable::class,
    'The signed adapter must enforce the 64-character resource ID limit.',
);

$fixtureRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cabohealth-dynamic-private-' . bin2hex(random_bytes(8));
try {
    $fixtureDocroot = $fixtureRoot . DIRECTORY_SEPARATOR . 'public_html';
    $fixtureContent = $fixtureRoot . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'content';
    $dynamicModule = $fixtureContent . DIRECTORY_SEPARATOR . 'vip-lab-guide';
    mkdir($fixtureDocroot, 0700, true);
    mkdir($dynamicModule, 0700, true);
    $spanishDocument = dynamicPrivateDocument('es-MX', 'Guía privada de laboratorio');
    file_put_contents(
        $dynamicModule . DIRECTORY_SEPARATOR . 'es-MX.json',
        json_encode($spanishDocument, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    );
    $jsonStore = new JsonClientResourcesPrivateContentStore($fixtureContent, $fixtureDocroot);
    dynamicExpectSame(
        $jsonStore->readResource('vip-lab-guide', 'es-MX'),
        $spanishDocument,
        'A resource ID must select its exact private subdirectory.',
    );

    $legacyDocument = dynamicPrivateDocument('en', 'Legacy client resources');
    file_put_contents(
        $fixtureContent . DIRECTORY_SEPARATOR . 'en.json',
        json_encode($legacyDocument, JSON_THROW_ON_ERROR),
    );
    dynamicExpectSame(
        $jsonStore->readResource(CLIENT_RESOURCES_APP_ID, 'en'),
        $legacyDocument,
        'The client-resources entitlement must retain the safe flat legacy release.',
    );

    $legacyModule = $fixtureContent . DIRECTORY_SEPARATOR . CLIENT_RESOURCES_APP_ID;
    mkdir($legacyModule, 0700);
    $structuredLegacyDocument = dynamicPrivateDocument('en', 'Structured client resources');
    file_put_contents(
        $legacyModule . DIRECTORY_SEPARATOR . 'en.json',
        json_encode($structuredLegacyDocument, JSON_THROW_ON_ERROR),
    );
    dynamicExpectSame(
        $jsonStore->readResource(CLIENT_RESOURCES_APP_ID, 'en'),
        $structuredLegacyDocument,
        'A structured client-resources release must take precedence over the legacy flat file.',
    );

    dynamicExpectThrows(
        static fn () => $jsonStore->readResource('vip-missing', 'en'),
        ClientResourcesUnavailable::class,
        'A dynamic resource must never fall back to legacy flat content.',
    );

    $outsideModule = $fixtureRoot . DIRECTORY_SEPARATOR . 'outside-module';
    mkdir($outsideModule, 0700);
    file_put_contents(
        $outsideModule . DIRECTORY_SEPARATOR . 'en.json',
        json_encode(dynamicPrivateDocument('en', 'Outside content'), JSON_THROW_ON_ERROR),
    );
    symlink($outsideModule, $fixtureContent . DIRECTORY_SEPARATOR . 'vip-symlink');
    dynamicExpectThrows(
        static fn () => $jsonStore->readResource('vip-symlink', 'en'),
        ClientResourcesUnavailable::class,
        'A resource directory symlink must never escape or alias the private root.',
    );
} finally {
    dynamicRemoveFixture($fixtureRoot);
}

$dynamicBackend->entitlements = ['vip-lab-guide'];
$dynamicStore->reads = [];
$requestSelectedResource = dynamicResourcesResponse(
    $dynamicBackend,
    $dynamicStore,
    'lang=en&resourceId=client-resources',
);
dynamicExpectSame($requestSelectedResource->status, 400, 'A client-selected resource ID must be rejected.');
dynamicExpectSame($dynamicStore->reads, [], 'Request data must never select private content.');

echo "dynamic client resource broker: ok\n";
