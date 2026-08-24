<?php

declare(strict_types=1);

const CLIENT_RESOURCES_APP_ID = 'client-resources';
const CLIENT_RESOURCES_CANONICAL_ORIGIN = 'https://cabohealth.org';
const CLIENT_RESOURCES_BASE_PATH = '/apps/client-resources/';
const CLIENT_RESOURCES_COOKIE_NAME = '__Secure-cabohealth_client';
const CLIENT_RESOURCES_MAX_SESSION_SECONDS = 3600;
const CLIENT_RESOURCES_MAX_REQUEST_BODY_BYTES = 512;

interface ClientResourcesBackend
{
    /** @return array{sessionId:string, expiresAt:int} */
    public function redeemLaunchNonce(string $nonce): array;

    /** @return array{active:bool, expiresAt:int, entitlements:list<string>, csrfToken:string} */
    public function introspectSession(string $sessionId): array;

    public function revokeSession(string $sessionId, string $csrfToken): void;
}

interface ClientResourcesPrivateContentStore
{
    /** @return array<string, mixed> */
    public function read(string $locale): array;
}

final class ClientResourcesAccessDenied extends RuntimeException
{
}

final class ClientResourcesUnavailable extends RuntimeException
{
}

final class ClientResourcesTransportResponse
{
    /** @param array<string, string> $headers */
    public function __construct(
        public readonly int $status,
        public readonly string $contentType,
        public readonly string $body,
        public readonly array $headers = [],
    ) {
    }
}

interface ClientResourcesHttpTransport
{
    /** @param list<string> $headers */
    public function post(string $url, array $headers, string $body): ClientResourcesTransportResponse;
}

final class CurlClientResourcesHttpTransport implements ClientResourcesHttpTransport
{
    private const CONNECT_TIMEOUT_MS = 1500;
    private const TOTAL_TIMEOUT_MS = 12000;
    private const MAX_RESPONSE_BYTES = 16384;

    public function post(string $url, array $headers, string $body): ClientResourcesTransportResponse
    {
        if (!extension_loaded('curl')) {
            throw new ClientResourcesUnavailable('Secure HTTP transport is unavailable.');
        }
        $handle = curl_init($url);
        if ($handle === false) {
            throw new ClientResourcesUnavailable('Secure HTTP transport could not initialize.');
        }

        $responseBody = '';
        $responseHeaders = [];
        $responseHeadersValid = true;
        curl_setopt_array($handle, [
            CURLOPT_CONNECTTIMEOUT_MS => self::CONNECT_TIMEOUT_MS,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HEADERFUNCTION => static function ($unused, string $line) use (&$responseHeaders, &$responseHeadersValid): int {
                $length = strlen($line);
                $separator = strpos($line, ':');
                if ($separator === false) {
                    return $length;
                }
                $name = strtolower(trim(substr($line, 0, $separator)));
                if (!in_array($name, [
                    'x-cabohealth-key-id',
                    'x-cabohealth-request-id',
                    'x-cabohealth-response-signature',
                ], true)) {
                    return $length;
                }
                $value = trim(substr($line, $separator + 1));
                if (
                    array_key_exists($name, $responseHeaders)
                    || $value === ''
                    || preg_match('/[[:cntrl:]]/u', $value) === 1
                ) {
                    $responseHeadersValid = false;
                    return 0;
                }
                $responseHeaders[$name] = $value;
                return $length;
            },
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_TIMEOUT_MS => self::TOTAL_TIMEOUT_MS,
            CURLOPT_WRITEFUNCTION => static function ($unused, string $chunk) use (&$responseBody): int {
                if (strlen($responseBody) + strlen($chunk) > self::MAX_RESPONSE_BYTES) {
                    return 0;
                }
                $responseBody .= $chunk;
                return strlen($chunk);
            },
        ]);

        $succeeded = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $contentType = (string) (curl_getinfo($handle, CURLINFO_CONTENT_TYPE) ?: '');
        curl_close($handle);
        if ($succeeded !== true || $status < 100 || !$responseHeadersValid) {
            throw new ClientResourcesUnavailable('Secure HTTP request failed.');
        }
        return new ClientResourcesTransportResponse($status, $contentType, $responseBody, $responseHeaders);
    }
}

function client_resources_base64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function client_resources_random_request_id(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-'
        . substr($hex, 8, 4) . '-'
        . substr($hex, 12, 4) . '-'
        . substr($hex, 16, 4) . '-'
        . substr($hex, 20, 12);
}

final class SignedFunctionsClientResourcesBackend implements ClientResourcesBackend
{
    private const SIGNATURE_VERSION = 'cabohealth-broker-v1';
    private const RESPONSE_SIGNATURE_VERSION = 'cabohealth-broker-response-v1';
    private const ALLOWED_PATHS = [
        '/v1/launch/redeem',
        '/v1/sessions/introspect',
        '/v1/sessions/revoke',
    ];

    /** @var callable():int */
    private $clock;

    /** @var callable():string */
    private $requestIdFactory;

    public function __construct(
        private readonly string $baseUrl,
        private readonly string $expectedHost,
        private readonly string $keyId,
        private readonly string $signingKey,
        private readonly ClientResourcesHttpTransport $transport = new CurlClientResourcesHttpTransport(),
        ?callable $clock = null,
        ?callable $requestIdFactory = null,
    ) {
        $this->assertConfiguration();
        $this->clock = $clock ?? time(...);
        $this->requestIdFactory = $requestIdFactory ?? client_resources_random_request_id(...);
    }

    public static function fromPrivateConfigFile(
        string $configPath,
        string $documentRoot,
        ?ClientResourcesHttpTransport $transport = null,
    ): self {
        $resolvedConfig = realpath($configPath);
        $resolvedDocroot = realpath($documentRoot);
        if ($resolvedConfig === false || $resolvedDocroot === false || !is_file($resolvedConfig)) {
            throw new ClientResourcesUnavailable('Private broker configuration is unavailable.');
        }
        $docrootPrefix = rtrim($resolvedDocroot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if ($resolvedConfig === $resolvedDocroot || str_starts_with($resolvedConfig, $docrootPrefix)) {
            throw new ClientResourcesUnavailable('Private broker configuration must be outside the document root.');
        }
        $mode = fileperms($resolvedConfig);
        if ($mode === false || ($mode & 0777) !== 0600) {
            throw new ClientResourcesUnavailable('Private broker configuration must use mode 0600.');
        }
        $size = filesize($resolvedConfig);
        if ($size === false || $size < 2 || $size > 4096) {
            throw new ClientResourcesUnavailable('Private broker configuration size is invalid.');
        }
        $bytes = file_get_contents($resolvedConfig, false, null, 0, 4097);
        if (!is_string($bytes) || strlen($bytes) !== $size) {
            throw new ClientResourcesUnavailable('Private broker configuration is unreadable.');
        }
        try {
            $config = json_decode($bytes, true, 16, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new ClientResourcesUnavailable('Private broker configuration is invalid.');
        }
        if (!is_array($config)) {
            throw new ClientResourcesUnavailable('Private broker configuration is invalid.');
        }
        $keys = array_keys($config);
        sort($keys);
        if ($keys !== ['baseUrl', 'expectedHost', 'hmacKeyBase64', 'keyId', 'schemaVersion'] || ($config['schemaVersion'] ?? null) !== 1) {
            throw new ClientResourcesUnavailable('Private broker configuration schema is invalid.');
        }
        $encodedKey = is_string($config['hmacKeyBase64'] ?? null) ? $config['hmacKeyBase64'] : '';
        $signingKey = base64_decode($encodedKey, true);
        if (!is_string($signingKey)) {
            throw new ClientResourcesUnavailable('Private broker signing key is invalid.');
        }
        return new self(
            is_string($config['baseUrl'] ?? null) ? $config['baseUrl'] : '',
            is_string($config['expectedHost'] ?? null) ? $config['expectedHost'] : '',
            is_string($config['keyId'] ?? null) ? $config['keyId'] : '',
            $signingKey,
            $transport ?? new CurlClientResourcesHttpTransport(),
        );
    }

    public function redeemLaunchNonce(string $nonce): array
    {
        if (preg_match('/\A[A-Za-z0-9_-]{32}\z/u', $nonce) !== 1) {
            throw new ClientResourcesAccessDenied('Invalid access.');
        }
        $response = $this->post('/v1/launch/redeem', ['nonce' => $nonce]);
        if (!$this->hasExactKeys($response, ['expiresAtMs', 'sessionId'])) {
            throw new ClientResourcesUnavailable('Broker response schema is invalid.');
        }
        $sessionId = is_string($response['sessionId'] ?? null) ? $response['sessionId'] : '';
        $expiresAtMs = is_int($response['expiresAtMs'] ?? null) ? $response['expiresAtMs'] : 0;
        if (!client_resources_is_opaque_value($sessionId) || $expiresAtMs <= 0) {
            throw new ClientResourcesUnavailable('Broker response values are invalid.');
        }
        return ['sessionId' => $sessionId, 'expiresAt' => intdiv($expiresAtMs, 1000)];
    }

    public function introspectSession(string $sessionId): array
    {
        if (!client_resources_is_opaque_value($sessionId)) {
            throw new ClientResourcesAccessDenied('Invalid access.');
        }
        $response = $this->post('/v1/sessions/introspect', ['sessionId' => $sessionId]);
        if (!$this->hasExactKeys($response, ['active', 'csrfToken', 'entitlements', 'expiresAtMs'])) {
            throw new ClientResourcesUnavailable('Broker response schema is invalid.');
        }
        $active = $response['active'] ?? null;
        $expiresAtMs = $response['expiresAtMs'] ?? null;
        $entitlements = $response['entitlements'] ?? null;
        $csrfToken = $response['csrfToken'] ?? null;
        if (
            !is_bool($active)
            || !is_int($expiresAtMs)
            || !is_array($entitlements)
            || !array_is_list($entitlements)
            || count($entitlements) > 16
            || !is_string($csrfToken)
            || !client_resources_is_opaque_value($csrfToken)
        ) {
            throw new ClientResourcesUnavailable('Broker response values are invalid.');
        }
        foreach ($entitlements as $entitlement) {
            if (!is_string($entitlement) || preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/u', $entitlement) !== 1) {
                throw new ClientResourcesUnavailable('Broker entitlement is invalid.');
            }
        }
        return [
            'active' => $active,
            'expiresAt' => intdiv($expiresAtMs, 1000),
            'entitlements' => array_values(array_unique($entitlements)),
            'csrfToken' => $csrfToken,
        ];
    }

    public function revokeSession(string $sessionId, string $csrfToken): void
    {
        if (!client_resources_is_opaque_value($sessionId) || !client_resources_is_opaque_value($csrfToken)) {
            throw new ClientResourcesAccessDenied('Invalid access.');
        }
        $response = $this->post('/v1/sessions/revoke', [
            'sessionId' => $sessionId,
            'csrfToken' => $csrfToken,
        ]);
        if (!$this->hasExactKeys($response, ['revoked']) || ($response['revoked'] ?? null) !== true) {
            throw new ClientResourcesUnavailable('Broker response schema is invalid.');
        }
    }

    private function assertConfiguration(): void
    {
        $parts = parse_url($this->baseUrl);
        $host = is_array($parts) && is_string($parts['host'] ?? null) ? $parts['host'] : '';
        $path = is_array($parts) && is_string($parts['path'] ?? null) ? $parts['path'] : '';
        $allowedCloudHost = str_ends_with($host, '.cloudfunctions.net') || str_ends_with($host, '.run.app');
        if (
            !is_array($parts)
            || ($parts['scheme'] ?? null) !== 'https'
            || $host === ''
            || $host !== strtolower($host)
            || $host !== $this->expectedHost
            || !$allowedCloudHost
            || $path !== '/brokerApi'
            || isset($parts['port'])
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])
            || str_ends_with($this->baseUrl, '/')
            || str_contains($this->baseUrl, '%')
            || str_contains($this->baseUrl, '\\')
            || preg_match('/[[:space:][:cntrl:]]/u', $this->baseUrl) === 1
            || preg_match('/\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\z/u', $this->keyId) !== 1
            || strlen($this->signingKey) < 32
        ) {
            throw new ClientResourcesUnavailable('Broker adapter configuration is invalid.');
        }
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    private function post(string $path, array $payload): array
    {
        if (!in_array($path, self::ALLOWED_PATHS, true)) {
            throw new ClientResourcesUnavailable('Broker path is not allowed.');
        }
        try {
            $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new ClientResourcesUnavailable('Broker request encoding failed.');
        }
        $timestamp = ($this->clock)();
        $requestId = ($this->requestIdFactory)();
        if (!is_int($timestamp) || $timestamp <= 0 || !is_string($requestId) || preg_match(
            '/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/u',
            $requestId,
        ) !== 1) {
            throw new ClientResourcesUnavailable('Broker request metadata is invalid.');
        }
        $bodyDigest = client_resources_base64url(hash('sha256', $body, true));
        $canonical = self::SIGNATURE_VERSION . "\n"
            . "POST\n"
            . $path . "\n"
            . $timestamp . "\n"
            . $requestId . "\n"
            . $bodyDigest;
        $signature = client_resources_base64url(hash_hmac('sha256', $canonical, $this->signingKey, true));
        $headers = [
            'Accept: application/json',
            'Content-Type: application/json',
            'X-CaboHealth-Key-Id: ' . $this->keyId,
            'X-CaboHealth-Timestamp: ' . $timestamp,
            'X-CaboHealth-Request-Id: ' . $requestId,
            'X-CaboHealth-Signature: ' . $signature,
        ];

        try {
            $response = $this->transport->post($this->baseUrl . $path, $headers, $body);
        } catch (ClientResourcesAccessDenied | ClientResourcesUnavailable $error) {
            throw $error;
        } catch (Throwable) {
            throw new ClientResourcesUnavailable('Broker request failed.');
        }
        if (in_array($response->status, [401, 403, 404], true)) {
            throw new ClientResourcesAccessDenied('Invalid access.');
        }
        if ($response->status !== 200 || preg_match('/\Aapplication\/json(?:\s*;\s*charset=utf-8)?\z/ui', trim($response->contentType)) !== 1) {
            throw new ClientResourcesUnavailable('Broker response was not accepted.');
        }
        if (!$this->hasExactKeys($response->headers, [
            'x-cabohealth-key-id',
            'x-cabohealth-request-id',
            'x-cabohealth-response-signature',
        ])) {
            throw new ClientResourcesUnavailable('Broker response authentication is missing.');
        }
        $responseKeyId = $response->headers['x-cabohealth-key-id'] ?? '';
        $responseRequestId = $response->headers['x-cabohealth-request-id'] ?? '';
        $responseSignature = $response->headers['x-cabohealth-response-signature'] ?? '';
        if (
            $responseKeyId !== $this->keyId
            || $responseRequestId !== $requestId
            || preg_match('/\A[A-Za-z0-9_-]{43}\z/u', $responseSignature) !== 1
        ) {
            throw new ClientResourcesUnavailable('Broker response authentication is invalid.');
        }
        $responseBodyDigest = client_resources_base64url(hash('sha256', $response->body, true));
        $responseCanonical = self::RESPONSE_SIGNATURE_VERSION . "\n"
            . "200\n"
            . $path . "\n"
            . $requestId . "\n"
            . $this->keyId . "\n"
            . $responseBodyDigest;
        $expectedResponseSignature = client_resources_base64url(hash_hmac(
            'sha256',
            $responseCanonical,
            $this->signingKey,
            true,
        ));
        if (!hash_equals($expectedResponseSignature, $responseSignature)) {
            throw new ClientResourcesUnavailable('Broker response authentication is invalid.');
        }
        try {
            $decoded = json_decode($response->body, true, 16, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new ClientResourcesUnavailable('Broker response is invalid.');
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new ClientResourcesUnavailable('Broker response is invalid.');
        }
        return $decoded;
    }

    /** @param array<string, mixed> $value @param list<string> $expected */
    private function hasExactKeys(array $value, array $expected): bool
    {
        $keys = array_keys($value);
        sort($keys);
        sort($expected);
        return $keys === $expected;
    }
}

final class ClientResourcesRequest
{
    /** @param array<string, string> $cookies */
    public function __construct(
        public readonly string $method,
        public readonly string $contentType = '',
        public readonly string $queryString = '',
        public readonly string $body = '',
        public readonly array $cookies = [],
        public readonly string $origin = '',
        public readonly string $csrfToken = '',
    ) {
    }

    public static function fromGlobals(): self
    {
        $cookies = [];
        foreach ($_COOKIE as $name => $value) {
            if (is_string($name) && is_string($value)) {
                $cookies[$name] = $value;
            }
        }

        $body = file_get_contents(
            'php://input',
            false,
            null,
            0,
            CLIENT_RESOURCES_MAX_REQUEST_BODY_BYTES + 1,
        );

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            (string) ($_SERVER['CONTENT_TYPE'] ?? ''),
            (string) ($_SERVER['QUERY_STRING'] ?? ''),
            is_string($body) ? $body : '',
            $cookies,
            (string) ($_SERVER['HTTP_ORIGIN'] ?? ''),
            (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''),
        );
    }
}

final class ClientResourcesResponse
{
    /** @param array<string, string> $headers */
    public function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly string $body = '',
    ) {
    }
}

/** @return array<string, string> */
function client_resources_security_headers(string $contentType): array
{
    return [
        'Cache-Control' => 'no-store, max-age=0',
        'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'Content-Type' => $contentType,
        'Cross-Origin-Resource-Policy' => 'same-origin',
        'Permissions-Policy' => 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Referrer-Policy' => 'no-referrer',
        'X-Content-Type-Options' => 'nosniff',
        'X-Frame-Options' => 'DENY',
    ];
}

function client_resources_error_response(int $status, string $allow = ''): ClientResourcesResponse
{
    $headers = client_resources_security_headers('text/plain; charset=utf-8');
    if ($allow !== '') {
        $headers['Allow'] = $allow;
    }

    $messages = [
        400 => 'Invalid request.',
        401 => 'Client session required.',
        403 => 'Request not allowed.',
        405 => 'Method not allowed.',
        415 => 'Unsupported media type.',
        503 => 'Resource temporarily unavailable.',
    ];

    return new ClientResourcesResponse($status, $headers, ($messages[$status] ?? 'Request failed.') . "\n");
}

function client_resources_is_opaque_value(string $value): bool
{
    return preg_match('/\A[A-Za-z0-9_-]{32,256}\z/u', $value) === 1;
}

function client_resources_cookie_header(string $name, string $value, int $maxAge, string $path): string
{
    if (str_starts_with($name, '__Host-') && $path !== '/') {
        throw new LogicException('__Host- cookies require Path=/; use __Secure- for a scoped cookie.');
    }
    if (!str_starts_with($name, '__Secure-') || !client_resources_is_opaque_value($value)) {
        throw new ClientResourcesUnavailable('Invalid session cookie contract.');
    }
    if ($maxAge < 1 || $maxAge > CLIENT_RESOURCES_MAX_SESSION_SECONDS || $path !== CLIENT_RESOURCES_BASE_PATH) {
        throw new ClientResourcesUnavailable('Invalid session cookie lifetime or path.');
    }

    return rawurlencode($name) . '=' . rawurlencode($value)
        . '; Max-Age=' . $maxAge
        . '; Path=' . $path
        . '; Secure; HttpOnly; SameSite=Strict';
}

function client_resources_expired_cookie_header(): string
{
    return rawurlencode(CLIENT_RESOURCES_COOKIE_NAME) . '=deleted'
        . '; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
        . '; Max-Age=0'
        . '; Path=' . CLIENT_RESOURCES_BASE_PATH
        . '; Secure; HttpOnly; SameSite=Strict';
}

function client_resources_parse_launch_nonce(ClientResourcesRequest $request): ?string
{
    $contentType = strtolower(str_replace([' ', "\t"], '', $request->contentType));
    if ($contentType !== 'application/x-www-form-urlencoded;charset=utf-8') {
        return null;
    }
    if (preg_match('/\Anonce=([A-Za-z0-9_-]{32})\z/u', $request->body, $matches) !== 1) {
        return null;
    }
    return $matches[1];
}

/** @param callable():int|null $clock */
function client_resources_launch_response(
    ClientResourcesRequest $request,
    ClientResourcesBackend $backend,
    ?callable $clock = null,
): ClientResourcesResponse {
    if ($request->method !== 'POST') {
        return client_resources_error_response(405, 'POST');
    }
    if ($request->queryString !== '') {
        return client_resources_error_response(400);
    }

    $nonce = client_resources_parse_launch_nonce($request);
    if ($nonce === null) {
        return str_starts_with(strtolower($request->contentType), 'application/x-www-form-urlencoded')
            ? client_resources_error_response(400)
            : client_resources_error_response(415);
    }

    try {
        $session = $backend->redeemLaunchNonce($nonce);
        $sessionId = is_string($session['sessionId'] ?? null) ? $session['sessionId'] : '';
        $expiresAt = is_int($session['expiresAt'] ?? null) ? $session['expiresAt'] : 0;
        $now = $clock === null ? time() : $clock();
        $maxAge = min(CLIENT_RESOURCES_MAX_SESSION_SECONDS, $expiresAt - $now);
        $cookie = client_resources_cookie_header(
            CLIENT_RESOURCES_COOKIE_NAME,
            $sessionId,
            $maxAge,
            CLIENT_RESOURCES_BASE_PATH,
        );
    } catch (ClientResourcesAccessDenied) {
        return client_resources_error_response(401);
    } catch (Throwable) {
        return client_resources_error_response(503);
    }

    $headers = client_resources_security_headers('text/plain; charset=utf-8');
    $headers['Location'] = CLIENT_RESOURCES_BASE_PATH;
    $headers['Set-Cookie'] = $cookie;
    return new ClientResourcesResponse(303, $headers);
}

/** @return array{locale:string}|null */
function client_resources_parse_resource_query(string $queryString): ?array
{
    if (preg_match('/\Alang=(en|es-MX)\z/u', $queryString, $matches) !== 1) {
        return null;
    }
    return ['locale' => $matches[1]];
}

/** @param callable():int|null $clock */
function client_resources_resources_response(
    ClientResourcesRequest $request,
    ClientResourcesBackend $backend,
    ClientResourcesPrivateContentStore $store,
    ?callable $clock = null,
): ClientResourcesResponse {
    if ($request->method !== 'GET') {
        return client_resources_error_response(405, 'GET');
    }
    if ($request->body !== '') {
        return client_resources_error_response(400);
    }
    $query = client_resources_parse_resource_query($request->queryString);
    if ($query === null) {
        return client_resources_error_response(400);
    }
    $sessionId = $request->cookies[CLIENT_RESOURCES_COOKIE_NAME] ?? '';
    if (!is_string($sessionId) || !client_resources_is_opaque_value($sessionId)) {
        return client_resources_error_response(401);
    }

    try {
        $session = $backend->introspectSession($sessionId);
        $now = $clock === null ? time() : $clock();
        $active = ($session['active'] ?? false) === true;
        $expiresAt = is_int($session['expiresAt'] ?? null) ? $session['expiresAt'] : 0;
        $entitlements = is_array($session['entitlements'] ?? null) ? $session['entitlements'] : [];
        $csrfToken = is_string($session['csrfToken'] ?? null) ? $session['csrfToken'] : '';
        if (!$active || $expiresAt <= $now || !in_array(CLIENT_RESOURCES_APP_ID, $entitlements, true)) {
            throw new ClientResourcesAccessDenied('Session is not authorized.');
        }
        if (!client_resources_is_opaque_value($csrfToken)) {
            throw new ClientResourcesUnavailable('Invalid CSRF contract.');
        }
        $document = $store->read($query['locale']);
        $body = json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (ClientResourcesAccessDenied) {
        return client_resources_error_response(401);
    } catch (Throwable) {
        return client_resources_error_response(503);
    }

    $headers = client_resources_security_headers('application/json; charset=utf-8');
    $headers['Vary'] = 'Cookie';
    $headers['X-CaboHealth-CSRF-Token'] = $csrfToken;
    return new ClientResourcesResponse(200, $headers, $body . "\n");
}

function client_resources_delete_session_response(
    ClientResourcesRequest $request,
    ClientResourcesBackend $backend,
): ClientResourcesResponse {
    if ($request->method !== 'DELETE') {
        return client_resources_error_response(405, 'DELETE');
    }
    if ($request->queryString !== '' || $request->body !== '') {
        return client_resources_error_response(400);
    }
    if ($request->origin !== CLIENT_RESOURCES_CANONICAL_ORIGIN) {
        return client_resources_error_response(403);
    }
    $sessionId = $request->cookies[CLIENT_RESOURCES_COOKIE_NAME] ?? '';
    if (!is_string($sessionId) || !client_resources_is_opaque_value($sessionId)) {
        return client_resources_error_response(401);
    }
    if (!client_resources_is_opaque_value($request->csrfToken)) {
        return client_resources_error_response(403);
    }

    try {
        $backend->revokeSession($sessionId, $request->csrfToken);
    } catch (ClientResourcesAccessDenied) {
        return client_resources_error_response(403);
    } catch (Throwable) {
        return client_resources_error_response(503);
    }

    $headers = client_resources_security_headers('text/plain; charset=utf-8');
    $headers['Set-Cookie'] = client_resources_expired_cookie_header();
    return new ClientResourcesResponse(204, $headers);
}

function client_resources_emit(ClientResourcesResponse $response): never
{
    http_response_code($response->status);
    foreach ($response->headers as $name => $value) {
        header($name . ': ' . $value, true);
    }
    if ($response->status !== 204) {
        echo $response->body;
    }
    exit;
}

function client_resources_path_is_outside_docroot(string $path, string $documentRoot): bool
{
    $resolvedPath = realpath($path);
    $resolvedDocroot = realpath($documentRoot);
    if ($resolvedPath === false || $resolvedDocroot === false || !is_dir($resolvedPath)) {
        return false;
    }
    $prefix = rtrim($resolvedDocroot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    return $resolvedPath !== $resolvedDocroot && !str_starts_with($resolvedPath . DIRECTORY_SEPARATOR, $prefix);
}

function client_resources_validate_document(array $document, string $locale): bool
{
    $expectedKeys = ['introduction', 'locale', 'schemaVersion', 'sections', 'title'];
    $actualKeys = array_keys($document);
    sort($actualKeys);
    if ($actualKeys !== $expectedKeys || ($document['schemaVersion'] ?? null) !== 1 || ($document['locale'] ?? null) !== $locale) {
        return false;
    }
    if (!client_resources_is_text($document['title'] ?? null, 120) || !client_resources_is_text($document['introduction'] ?? null, 500)) {
        return false;
    }
    $sections = $document['sections'] ?? null;
    if (!is_array($sections) || count($sections) < 1 || count($sections) > 8 || !array_is_list($sections)) {
        return false;
    }
    foreach ($sections as $section) {
        if (!is_array($section)) {
            return false;
        }
        $keys = array_keys($section);
        sort($keys);
        if ($keys !== ['id', 'items', 'summary', 'title']) {
            return false;
        }
        if (!is_string($section['id'] ?? null) || preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/u', $section['id']) !== 1) {
            return false;
        }
        if (!client_resources_is_text($section['title'] ?? null, 120) || !client_resources_is_text($section['summary'] ?? null, 500)) {
            return false;
        }
        $items = $section['items'] ?? null;
        if (!is_array($items) || !array_is_list($items) || count($items) < 1 || count($items) > 12) {
            return false;
        }
        foreach ($items as $item) {
            if (!client_resources_is_text($item, 500)) {
                return false;
            }
        }
    }
    return true;
}

function client_resources_is_text(mixed $value, int $maxLength): bool
{
    return is_string($value)
        && $value !== ''
        && trim($value) === $value
        && strlen($value) <= $maxLength;
}

final class JsonClientResourcesPrivateContentStore implements ClientResourcesPrivateContentStore
{
    private string $contentRoot;

    public function __construct(string $contentRoot, string $documentRoot)
    {
        if (!client_resources_path_is_outside_docroot($contentRoot, $documentRoot)) {
            throw new ClientResourcesUnavailable('Private content root must resolve outside the document root.');
        }
        $resolved = realpath($contentRoot);
        if ($resolved === false) {
            throw new ClientResourcesUnavailable('Private content root is unavailable.');
        }
        $this->contentRoot = $resolved;
    }

    public function read(string $locale): array
    {
        $filename = match ($locale) {
            'en' => 'en.json',
            'es-MX' => 'es-MX.json',
            default => throw new ClientResourcesAccessDenied('Unsupported locale.'),
        };
        $path = $this->contentRoot . DIRECTORY_SEPARATOR . $filename;
        $resolved = realpath($path);
        if ($resolved === false || dirname($resolved) !== $this->contentRoot || !is_file($resolved)) {
            throw new ClientResourcesUnavailable('Private release content is unavailable.');
        }
        $size = filesize($resolved);
        if ($size === false || $size < 2 || $size > 65536) {
            throw new ClientResourcesUnavailable('Private release content size is invalid.');
        }
        $bytes = file_get_contents($resolved, false, null, 0, 65537);
        if (!is_string($bytes) || strlen($bytes) !== $size) {
            throw new ClientResourcesUnavailable('Private release content is unreadable.');
        }
        $document = json_decode($bytes, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($document) || !client_resources_validate_document($document, $locale)) {
            throw new ClientResourcesUnavailable('Private release content is invalid.');
        }
        return $document;
    }
}

function client_resources_backend_from_environment(string $documentRoot): ClientResourcesBackend
{
    $factoryPath = getenv('CABOHEALTH_CLIENT_RESOURCES_BACKEND_FACTORY');
    if (!is_string($factoryPath) || $factoryPath === '' || !str_starts_with($factoryPath, DIRECTORY_SEPARATOR)) {
        throw new ClientResourcesUnavailable('Backend factory is not configured.');
    }
    $resolvedFactory = realpath($factoryPath);
    $resolvedDocroot = realpath($documentRoot);
    if ($resolvedFactory === false || $resolvedDocroot === false || !is_file($resolvedFactory)) {
        throw new ClientResourcesUnavailable('Backend factory is unavailable.');
    }
    $docrootPrefix = rtrim($resolvedDocroot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if ($resolvedFactory === $resolvedDocroot || str_starts_with($resolvedFactory, $docrootPrefix)) {
        throw new ClientResourcesUnavailable('Backend factory must be outside the document root.');
    }
    $mode = fileperms($resolvedFactory);
    if ($mode === false || ($mode & 0777) !== 0600) {
        throw new ClientResourcesUnavailable('Backend factory must use mode 0600.');
    }

    $factory = require $resolvedFactory;
    $backend = is_callable($factory) ? $factory() : $factory;
    if (!$backend instanceof ClientResourcesBackend) {
        throw new ClientResourcesUnavailable('Backend factory returned an invalid adapter.');
    }
    return $backend;
}

function client_resources_store_from_environment(string $documentRoot): ClientResourcesPrivateContentStore
{
    $contentRoot = getenv('CABOHEALTH_CLIENT_RESOURCES_PRIVATE_CONTENT_ROOT');
    if (!is_string($contentRoot) || $contentRoot === '' || !str_starts_with($contentRoot, DIRECTORY_SEPARATOR)) {
        throw new ClientResourcesUnavailable('Private content root is not configured.');
    }
    return new JsonClientResourcesPrivateContentStore($contentRoot, $documentRoot);
}
