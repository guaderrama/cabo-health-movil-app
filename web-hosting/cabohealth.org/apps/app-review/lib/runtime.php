<?php

declare(strict_types=1);

const APP_REVIEW_SAMPLE_ID = 'review-sandbox-app-review-sample-v1';
const APP_REVIEW_CANONICAL_ORIGIN = 'https://cabohealth.org';
const APP_REVIEW_BASE_PATH = '/apps/app-review/';
const APP_REVIEW_COOKIE_NAME = '__Secure-cabohealth_app_review';
const APP_REVIEW_MAX_SESSION_SECONDS = 3600;
const APP_REVIEW_MAX_REQUEST_BODY_BYTES = 512;

interface AppReviewBackend
{
    /** @return array{sessionId:string, expiresAt:int} */
    public function redeemLaunchNonce(string $nonce): array;

    /** @return array{active:bool, expiresAt:int, entitlements:list<string>, csrfToken:string} */
    public function introspectSession(string $sessionId): array;

    public function revokeSession(string $sessionId, string $csrfToken): void;
}

interface AppReviewPrivateContentStore
{
    /** @return array<string, mixed> */
    public function read(): array;
}

final class AppReviewAccessDenied extends RuntimeException
{
}

final class AppReviewUnavailable extends RuntimeException
{
}

final class AppReviewTransportResponse
{
    public function __construct(
        public readonly int $status,
        public readonly string $contentType,
        public readonly string $body,
    ) {
    }
}

interface AppReviewHttpTransport
{
    /** @param list<string> $headers */
    public function post(string $url, array $headers, string $body): AppReviewTransportResponse;
}

final class CurlAppReviewHttpTransport implements AppReviewHttpTransport
{
    private const CONNECT_TIMEOUT_MS = 1500;
    private const TOTAL_TIMEOUT_MS = 4000;
    private const MAX_RESPONSE_BYTES = 16384;

    public function post(string $url, array $headers, string $body): AppReviewTransportResponse
    {
        if (!extension_loaded('curl')) {
            throw new AppReviewUnavailable('Secure App Review transport is unavailable.');
        }
        $handle = curl_init($url);
        if ($handle === false) {
            throw new AppReviewUnavailable('Secure App Review transport could not initialize.');
        }
        $responseBody = '';
        curl_setopt_array($handle, [
            CURLOPT_CONNECTTIMEOUT_MS => self::CONNECT_TIMEOUT_MS,
            CURLOPT_FOLLOWLOCATION => false,
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
        if ($succeeded !== true || $status < 100) {
            throw new AppReviewUnavailable('Secure App Review request failed.');
        }
        return new AppReviewTransportResponse($status, $contentType, $responseBody);
    }
}

function app_review_base64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function app_review_random_request_id(): string
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

final class SignedFunctionsAppReviewBackend implements AppReviewBackend
{
    private const SIGNATURE_VERSION = 'cabohealth-app-review-broker-v1';
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
        private readonly AppReviewHttpTransport $transport = new CurlAppReviewHttpTransport(),
        ?callable $clock = null,
        ?callable $requestIdFactory = null,
    ) {
        $this->assertConfiguration();
        $this->clock = $clock ?? time(...);
        $this->requestIdFactory = $requestIdFactory ?? app_review_random_request_id(...);
    }

    public static function fromPrivateConfigFile(
        string $configPath,
        string $documentRoot,
        ?AppReviewHttpTransport $transport = null,
    ): self {
        $resolvedConfig = realpath($configPath);
        $resolvedDocroot = realpath($documentRoot);
        if ($resolvedConfig === false || $resolvedDocroot === false || !is_file($resolvedConfig)) {
            throw new AppReviewUnavailable('Private App Review broker configuration is unavailable.');
        }
        $docrootPrefix = rtrim($resolvedDocroot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if ($resolvedConfig === $resolvedDocroot || str_starts_with($resolvedConfig, $docrootPrefix)) {
            throw new AppReviewUnavailable('Private App Review broker configuration must be outside the document root.');
        }
        $mode = fileperms($resolvedConfig);
        if ($mode === false || ($mode & 0777) !== 0600) {
            throw new AppReviewUnavailable('Private App Review broker configuration must use mode 0600.');
        }
        $size = filesize($resolvedConfig);
        if ($size === false || $size < 2 || $size > 4096) {
            throw new AppReviewUnavailable('Private App Review broker configuration size is invalid.');
        }
        $bytes = file_get_contents($resolvedConfig, false, null, 0, 4097);
        if (!is_string($bytes) || strlen($bytes) !== $size) {
            throw new AppReviewUnavailable('Private App Review broker configuration is unreadable.');
        }
        try {
            $config = json_decode($bytes, true, 16, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new AppReviewUnavailable('Private App Review broker configuration is invalid.');
        }
        if (!is_array($config)) {
            throw new AppReviewUnavailable('Private App Review broker configuration is invalid.');
        }
        $keys = array_keys($config);
        sort($keys);
        if ($keys !== ['baseUrl', 'expectedHost', 'hmacKeyBase64', 'keyId', 'schemaVersion'] || ($config['schemaVersion'] ?? null) !== 1) {
            throw new AppReviewUnavailable('Private App Review broker configuration schema is invalid.');
        }
        $encodedKey = is_string($config['hmacKeyBase64'] ?? null) ? $config['hmacKeyBase64'] : '';
        $signingKey = base64_decode($encodedKey, true);
        if (!is_string($signingKey)) {
            throw new AppReviewUnavailable('Private App Review broker signing key is invalid.');
        }
        return new self(
            is_string($config['baseUrl'] ?? null) ? $config['baseUrl'] : '',
            is_string($config['expectedHost'] ?? null) ? $config['expectedHost'] : '',
            is_string($config['keyId'] ?? null) ? $config['keyId'] : '',
            $signingKey,
            $transport ?? new CurlAppReviewHttpTransport(),
        );
    }

    public function redeemLaunchNonce(string $nonce): array
    {
        if (preg_match('/\A[A-Za-z0-9_-]{32}\z/u', $nonce) !== 1) {
            throw new AppReviewAccessDenied('Invalid access.');
        }
        $response = $this->post('/v1/launch/redeem', ['nonce' => $nonce]);
        if (!$this->hasExactKeys($response, ['expiresAtMs', 'sessionId'])) {
            throw new AppReviewUnavailable('App Review broker response schema is invalid.');
        }
        $sessionId = is_string($response['sessionId'] ?? null) ? $response['sessionId'] : '';
        $expiresAtMs = is_int($response['expiresAtMs'] ?? null) ? $response['expiresAtMs'] : 0;
        if (!app_review_is_opaque_value($sessionId) || $expiresAtMs <= 0) {
            throw new AppReviewUnavailable('App Review broker response values are invalid.');
        }
        return ['sessionId' => $sessionId, 'expiresAt' => intdiv($expiresAtMs, 1000)];
    }

    public function introspectSession(string $sessionId): array
    {
        if (!app_review_is_opaque_value($sessionId)) {
            throw new AppReviewAccessDenied('Invalid access.');
        }
        $response = $this->post('/v1/sessions/introspect', ['sessionId' => $sessionId]);
        if (!$this->hasExactKeys($response, ['active', 'csrfToken', 'entitlements', 'expiresAtMs'])) {
            throw new AppReviewUnavailable('App Review broker response schema is invalid.');
        }
        $active = $response['active'] ?? null;
        $expiresAtMs = $response['expiresAtMs'] ?? null;
        $entitlements = $response['entitlements'] ?? null;
        $csrfToken = $response['csrfToken'] ?? null;
        if (
            $active !== true
            || !is_int($expiresAtMs)
            || $entitlements !== [APP_REVIEW_SAMPLE_ID]
            || !is_string($csrfToken)
            || !app_review_is_opaque_value($csrfToken)
        ) {
            throw new AppReviewUnavailable('App Review broker response values are invalid.');
        }
        return [
            'active' => true,
            'expiresAt' => intdiv($expiresAtMs, 1000),
            'entitlements' => [APP_REVIEW_SAMPLE_ID],
            'csrfToken' => $csrfToken,
        ];
    }

    public function revokeSession(string $sessionId, string $csrfToken): void
    {
        if (!app_review_is_opaque_value($sessionId) || !app_review_is_opaque_value($csrfToken)) {
            throw new AppReviewAccessDenied('Invalid access.');
        }
        $response = $this->post('/v1/sessions/revoke', [
            'sessionId' => $sessionId,
            'csrfToken' => $csrfToken,
        ]);
        if (!$this->hasExactKeys($response, ['revoked']) || ($response['revoked'] ?? null) !== true) {
            throw new AppReviewUnavailable('App Review broker response schema is invalid.');
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
            || $path !== '/appReviewBrokerApi'
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
            throw new AppReviewUnavailable('App Review broker adapter configuration is invalid.');
        }
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    private function post(string $path, array $payload): array
    {
        if (!in_array($path, self::ALLOWED_PATHS, true)) {
            throw new AppReviewUnavailable('App Review broker path is not allowed.');
        }
        try {
            $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new AppReviewUnavailable('App Review broker request encoding failed.');
        }
        $timestamp = ($this->clock)();
        $requestId = ($this->requestIdFactory)();
        if (!is_int($timestamp) || $timestamp <= 0 || !is_string($requestId) || preg_match(
            '/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/u',
            $requestId,
        ) !== 1) {
            throw new AppReviewUnavailable('App Review broker request metadata is invalid.');
        }
        $bodyDigest = app_review_base64url(hash('sha256', $body, true));
        $canonical = self::SIGNATURE_VERSION . "\n"
            . "POST\n"
            . $path . "\n"
            . $timestamp . "\n"
            . $requestId . "\n"
            . $bodyDigest;
        $signature = app_review_base64url(hash_hmac('sha256', $canonical, $this->signingKey, true));
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
        } catch (AppReviewAccessDenied | AppReviewUnavailable $error) {
            throw $error;
        } catch (Throwable) {
            throw new AppReviewUnavailable('App Review broker request failed.');
        }
        if (in_array($response->status, [401, 403, 404], true)) {
            throw new AppReviewAccessDenied('Invalid access.');
        }
        if ($response->status !== 200 || preg_match('/\Aapplication\/json(?:\s*;\s*charset=utf-8)?\z/ui', trim($response->contentType)) !== 1) {
            throw new AppReviewUnavailable('App Review broker response was not accepted.');
        }
        try {
            $decoded = json_decode($response->body, true, 16, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new AppReviewUnavailable('App Review broker response is invalid.');
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new AppReviewUnavailable('App Review broker response is invalid.');
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

final class AppReviewRequest
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

        $body = file_get_contents('php://input', false, null, 0, APP_REVIEW_MAX_REQUEST_BODY_BYTES + 1);
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

final class AppReviewResponse
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
function app_review_security_headers(string $contentType): array
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

/** @return array<string, string> */
function app_review_page_headers(): array
{
    $headers = app_review_security_headers('text/html; charset=utf-8');
    $headers['Content-Security-Policy'] = "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
    return $headers;
}

function app_review_error_response(int $status, string $allow = ''): AppReviewResponse
{
    $headers = app_review_security_headers('text/plain; charset=utf-8');
    if ($allow !== '') {
        $headers['Allow'] = $allow;
    }
    $messages = [
        400 => 'Invalid request.',
        401 => 'App Review session required.',
        403 => 'Request not allowed.',
        405 => 'Method not allowed.',
        415 => 'Unsupported media type.',
        503 => 'Resource temporarily unavailable.',
    ];
    return new AppReviewResponse($status, $headers, ($messages[$status] ?? 'Request failed.') . "\n");
}

function app_review_is_opaque_value(string $value): bool
{
    return preg_match('/\A[A-Za-z0-9_-]{32,256}\z/u', $value) === 1;
}

function app_review_parse_launch_nonce(AppReviewRequest $request): ?string
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

function app_review_cookie_header(string $sessionId, int $maxAge): string
{
    if (
        !app_review_is_opaque_value($sessionId)
        || $maxAge < 1
        || $maxAge > APP_REVIEW_MAX_SESSION_SECONDS
    ) {
        throw new AppReviewUnavailable('Invalid App Review session cookie contract.');
    }
    return rawurlencode(APP_REVIEW_COOKIE_NAME) . '=' . rawurlencode($sessionId)
        . '; Max-Age=' . $maxAge
        . '; Path=' . APP_REVIEW_BASE_PATH
        . '; Secure; HttpOnly; SameSite=Strict';
}

function app_review_expired_cookie_header(): string
{
    return rawurlencode(APP_REVIEW_COOKIE_NAME) . '=deleted'
        . '; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
        . '; Max-Age=0'
        . '; Path=' . APP_REVIEW_BASE_PATH
        . '; Secure; HttpOnly; SameSite=Strict';
}

/** @param callable():int|null $clock */
function app_review_launch_response(
    AppReviewRequest $request,
    AppReviewBackend $backend,
    AppReviewPrivateContentStore $store,
    ?callable $clock = null,
): AppReviewResponse {
    if ($request->method !== 'POST') {
        return app_review_error_response(405, 'POST');
    }
    if ($request->queryString !== '') {
        return app_review_error_response(400);
    }
    $nonce = app_review_parse_launch_nonce($request);
    if ($nonce === null) {
        return str_starts_with(strtolower($request->contentType), 'application/x-www-form-urlencoded')
            ? app_review_error_response(400)
            : app_review_error_response(415);
    }
    try {
        $session = $backend->redeemLaunchNonce($nonce);
        $sessionId = is_string($session['sessionId'] ?? null) ? $session['sessionId'] : '';
        $redeemExpiresAt = is_int($session['expiresAt'] ?? null) ? $session['expiresAt'] : 0;
        $live = $backend->introspectSession($sessionId);
        $now = $clock === null ? time() : $clock();
        if (
            ($live['active'] ?? false) !== true
            || !is_int($live['expiresAt'] ?? null)
            || $live['expiresAt'] <= $now
            || ($live['entitlements'] ?? null) !== [APP_REVIEW_SAMPLE_ID]
            || !is_string($live['csrfToken'] ?? null)
            || !app_review_is_opaque_value($live['csrfToken'])
        ) {
            throw new AppReviewAccessDenied('Session is not authorized.');
        }
        $cookie = app_review_cookie_header(
            $sessionId,
            min(APP_REVIEW_MAX_SESSION_SECONDS, $redeemExpiresAt - $now, $live['expiresAt'] - $now),
        );
        $body = app_review_render_sample($store->read());
    } catch (AppReviewAccessDenied) {
        return app_review_error_response(401);
    } catch (Throwable) {
        return app_review_error_response(503);
    }
    $headers = app_review_page_headers();
    $headers['Set-Cookie'] = $cookie;
    return new AppReviewResponse(200, $headers, $body);
}

function app_review_parse_csrf(AppReviewRequest $request): ?string
{
    $contentType = strtolower(str_replace([' ', "\t"], '', $request->contentType));
    if ($contentType !== 'application/x-www-form-urlencoded;charset=utf-8') {
        return null;
    }
    if (preg_match('/\Acsrf=([A-Za-z0-9_-]{32,256})\z/u', $request->body, $matches) !== 1) {
        return null;
    }
    return $matches[1];
}

function app_review_end_session_response(
    AppReviewRequest $request,
    AppReviewBackend $backend,
): AppReviewResponse {
    if ($request->method !== 'POST') {
        return app_review_error_response(405, 'POST');
    }
    if ($request->queryString !== '') {
        return app_review_error_response(400);
    }
    if ($request->origin !== APP_REVIEW_CANONICAL_ORIGIN) {
        return app_review_error_response(403);
    }
    $sessionId = $request->cookies[APP_REVIEW_COOKIE_NAME] ?? '';
    if (!is_string($sessionId) || !app_review_is_opaque_value($sessionId)) {
        return app_review_error_response(401);
    }
    $csrfToken = app_review_parse_csrf($request);
    if ($csrfToken === null) {
        return str_starts_with(strtolower($request->contentType), 'application/x-www-form-urlencoded')
            ? app_review_error_response(403)
            : app_review_error_response(415);
    }
    try {
        $backend->revokeSession($sessionId, $csrfToken);
    } catch (AppReviewAccessDenied) {
        return app_review_error_response(403);
    } catch (Throwable) {
        return app_review_error_response(503);
    }
    $headers = app_review_security_headers('text/plain; charset=utf-8');
    $headers['Location'] = '/app/support/';
    $headers['Set-Cookie'] = app_review_expired_cookie_header();
    return new AppReviewResponse(303, $headers);
}

function app_review_render_sample(array $sample): string
{
    if (!app_review_validate_sample($sample)) {
        throw new AppReviewUnavailable('The fixed App Review sample is invalid.');
    }
    $renderLocale = static function (array $locale, string $language): string {
        $sections = '';
        foreach ($locale['sections'] as $section) {
            $items = '';
            foreach ($section['items'] as $item) {
                $items .= '<li>' . app_review_escape($item) . '</li>';
            }
            $sections .= '<section class="sample-card"><p class="eyebrow">'
                . app_review_escape($section['title']) . '</p><h2>'
                . app_review_escape($locale['title']) . '</h2><p>'
                . app_review_escape($section['summary']) . '</p><ul>' . $items . '</ul></section>';
        }
        return '<section class="locale" lang="' . app_review_escape($language) . '"><p class="intro">'
            . app_review_escape($locale['introduction']) . '</p>' . $sections . '</section>';
    };
    $english = $renderLocale($sample['locales']['en'], 'en');
    $spanish = $renderLocale($sample['locales']['es-MX'], 'es-MX');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        . '<title>CaboHealth App Review</title><link rel="stylesheet" href="/apps/app-review/styles.css"></head>'
        . '<body><main><header><p class="brand">CABO<br>HEALTH</p><p class="realm">APP REVIEW</p></header>'
        . $english . $spanish
        . '</main></body></html>';
}

function app_review_escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

function app_review_is_text(mixed $value, int $maxLength): bool
{
    return is_string($value)
        && $value !== ''
        && trim($value) === $value
        && strlen($value) <= $maxLength;
}

function app_review_validate_sample(array $sample): bool
{
    $keys = array_keys($sample);
    sort($keys);
    if (
        $keys !== ['locales', 'resourceId', 'schemaVersion']
        || ($sample['schemaVersion'] ?? null) !== 1
        || ($sample['resourceId'] ?? null) !== APP_REVIEW_SAMPLE_ID
        || !is_array($sample['locales'] ?? null)
        || array_keys($sample['locales']) !== ['en', 'es-MX']
    ) {
        return false;
    }
    foreach ($sample['locales'] as $locale) {
        if (!is_array($locale)) {
            return false;
        }
        $localeKeys = array_keys($locale);
        sort($localeKeys);
        if (
            $localeKeys !== ['introduction', 'sections', 'title']
            || !app_review_is_text($locale['title'] ?? null, 120)
            || !app_review_is_text($locale['introduction'] ?? null, 500)
            || !is_array($locale['sections'] ?? null)
            || !array_is_list($locale['sections'])
            || count($locale['sections']) < 1
            || count($locale['sections']) > 4
        ) {
            return false;
        }
        foreach ($locale['sections'] as $section) {
            if (!is_array($section)) {
                return false;
            }
            $sectionKeys = array_keys($section);
            sort($sectionKeys);
            if (
                $sectionKeys !== ['id', 'items', 'summary', 'title']
                || !is_string($section['id'] ?? null)
                || preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/u', $section['id']) !== 1
                || !app_review_is_text($section['title'] ?? null, 120)
                || !app_review_is_text($section['summary'] ?? null, 500)
                || !is_array($section['items'] ?? null)
                || !array_is_list($section['items'])
                || count($section['items']) < 1
                || count($section['items']) > 6
            ) {
                return false;
            }
            foreach ($section['items'] as $item) {
                if (!app_review_is_text($item, 500)) {
                    return false;
                }
            }
        }
    }
    return true;
}

function app_review_path_is_outside_docroot(string $path, string $documentRoot): bool
{
    $resolvedPath = realpath($path);
    $resolvedDocroot = realpath($documentRoot);
    if ($resolvedPath === false || $resolvedDocroot === false || !is_dir($resolvedPath)) {
        return false;
    }
    $prefix = rtrim($resolvedDocroot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    return $resolvedPath !== $resolvedDocroot && !str_starts_with($resolvedPath . DIRECTORY_SEPARATOR, $prefix);
}

final class JsonAppReviewPrivateContentStore implements AppReviewPrivateContentStore
{
    private string $contentRoot;

    public function __construct(string $contentRoot, string $documentRoot)
    {
        if (!app_review_path_is_outside_docroot($contentRoot, $documentRoot)) {
            throw new AppReviewUnavailable('Private App Review content must resolve outside the document root.');
        }
        $resolved = realpath($contentRoot);
        if ($resolved === false) {
            throw new AppReviewUnavailable('Private App Review content is unavailable.');
        }
        $this->contentRoot = $resolved;
    }

    public function read(): array
    {
        $path = $this->contentRoot . DIRECTORY_SEPARATOR . 'sample.json';
        $resolved = realpath($path);
        if ($resolved === false || dirname($resolved) !== $this->contentRoot || !is_file($resolved)) {
            throw new AppReviewUnavailable('Fixed App Review sample is unavailable.');
        }
        $size = filesize($resolved);
        if ($size === false || $size < 2 || $size > 32768) {
            throw new AppReviewUnavailable('Fixed App Review sample size is invalid.');
        }
        $bytes = file_get_contents($resolved, false, null, 0, 32769);
        if (!is_string($bytes) || strlen($bytes) !== $size) {
            throw new AppReviewUnavailable('Fixed App Review sample is unreadable.');
        }
        try {
            $sample = json_decode($bytes, true, 32, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new AppReviewUnavailable('Fixed App Review sample is invalid.');
        }
        if (!is_array($sample) || !app_review_validate_sample($sample)) {
            throw new AppReviewUnavailable('Fixed App Review sample is invalid.');
        }
        return $sample;
    }
}

function app_review_backend_from_environment(string $documentRoot): AppReviewBackend
{
    $factoryPath = getenv('CABOHEALTH_APP_REVIEW_BACKEND_FACTORY');
    if (!is_string($factoryPath) || $factoryPath === '' || !str_starts_with($factoryPath, DIRECTORY_SEPARATOR)) {
        throw new AppReviewUnavailable('Private App Review backend factory is not configured.');
    }
    $resolvedFactory = realpath($factoryPath);
    $resolvedDocroot = realpath($documentRoot);
    if ($resolvedFactory === false || $resolvedDocroot === false || !is_file($resolvedFactory)) {
        throw new AppReviewUnavailable('Private App Review backend factory is unavailable.');
    }
    $docrootPrefix = rtrim($resolvedDocroot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if ($resolvedFactory === $resolvedDocroot || str_starts_with($resolvedFactory, $docrootPrefix)) {
        throw new AppReviewUnavailable('Private App Review backend factory must be outside the document root.');
    }
    $mode = fileperms($resolvedFactory);
    if ($mode === false || ($mode & 0777) !== 0600) {
        throw new AppReviewUnavailable('Private App Review backend factory must use mode 0600.');
    }
    $factory = require $resolvedFactory;
    $backend = is_callable($factory) ? $factory() : null;
    if (!$backend instanceof AppReviewBackend) {
        throw new AppReviewUnavailable('Private App Review backend factory is invalid.');
    }
    return $backend;
}

function app_review_store_from_environment(string $documentRoot): AppReviewPrivateContentStore
{
    $contentRoot = getenv('CABOHEALTH_APP_REVIEW_PRIVATE_CONTENT_ROOT');
    if (!is_string($contentRoot) || $contentRoot === '' || !str_starts_with($contentRoot, DIRECTORY_SEPARATOR)) {
        throw new AppReviewUnavailable('Private App Review content root is not configured.');
    }
    return new JsonAppReviewPrivateContentStore($contentRoot, $documentRoot);
}

function app_review_emit(AppReviewResponse $response): never
{
    http_response_code($response->status);
    foreach ($response->headers as $name => $value) {
        header($name . ': ' . $value, true);
    }
    echo $response->body;
    exit;
}
