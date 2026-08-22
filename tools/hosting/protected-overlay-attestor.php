<?php

declare(strict_types=1);

const PROTECTED_OVERLAY_ATTESTATION_DOMAIN = 'cabohealth-protected-overlay-hostinger-attestation-v1';
const PROTECTED_OVERLAY_ATTESTATION_KIND = 'cabohealth-protected-overlay-hostinger-attestation-v1';

/** @return never */
function attestor_fail(string $code): void
{
    $stderr = fopen('php://stderr', 'wb');
    if (is_resource($stderr)) {
        fwrite($stderr, $code . "\n");
        fclose($stderr);
    }
    if (PHP_SAPI !== 'cli') http_response_code(503);
    exit(1);
}

/** @return array<string, string> */
function attestor_arguments(array $values): array
{
    $result = [];
    for ($index = 0; $index < count($values); $index += 2) {
        $name = $values[$index] ?? null;
        $value = $values[$index + 1] ?? null;
        if (!is_string($name) || !str_starts_with($name, '--') || !is_string($value) || isset($result[$name])) {
            attestor_fail('protected_overlay_attestor_arguments_invalid');
        }
        $result[$name] = $value;
    }
    $names = array_keys($result);
    sort($names);
    if ($names !== ['--out', '--project-root', '--realm', '--request']) {
        attestor_fail('protected_overlay_attestor_arguments_invalid');
    }
    return $result;
}

/** @return array<string, string> */
function attestor_runtime_arguments(array $values): array
{
    if (PHP_SAPI === 'cli') return attestor_arguments($values);
    if (
        ($_SERVER['REQUEST_METHOD'] ?? null) !== 'POST'
        || ($_SERVER['QUERY_STRING'] ?? '') !== ''
        || !in_array(($_SERVER['CONTENT_LENGTH'] ?? ''), ['', '0'], true)
        || isset($_SERVER['HTTP_TRANSFER_ENCODING'])
    ) attestor_fail('protected_overlay_attestor_request_invalid');
    $mapping = [
        '--request' => 'CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_REQUEST',
        '--realm' => 'CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_REALM',
        '--project-root' => 'CABOHEALTH_PROTECTED_OVERLAY_PROJECT_ROOT',
        '--out' => 'CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_OUTPUT',
    ];
    $result = [];
    foreach ($mapping as $argument => $environmentName) {
        $value = getenv($environmentName);
        if (!is_string($value) || $value === '') {
            attestor_fail('protected_overlay_attestor_environment_invalid');
        }
        $result[$argument] = $value;
    }
    return $result;
}

/** @param array<string, int> $left @param array<string, int> $right */
function attestor_same_file_stat(array $left, array $right): bool
{
    foreach (['dev', 'ino', 'mode', 'nlink', 'size', 'mtime', 'ctime'] as $name) {
        if (!isset($left[$name], $right[$name]) || $left[$name] !== $right[$name]) return false;
    }
    return true;
}

/** @return array{bytes:string,path:string,size:int,sha256:string,stat:array<string, int>} */
function attestor_read_regular_file(
    string $path,
    int $mode,
    int $minimumBytes,
    int $maximumBytes,
    string $failureCode,
): array {
    $lexicalStat = @lstat($path);
    $resolved = @realpath($path);
    $resolvedStat = $resolved === false ? false : @lstat($resolved);
    if (
        !is_array($lexicalStat)
        || $resolved === false
        || !is_array($resolvedStat)
        || is_link($path)
        || ($resolvedStat['mode'] & 0170000) !== 0100000
        || ($resolvedStat['mode'] & 0777) !== $mode
        || $resolvedStat['nlink'] !== 1
        || $resolvedStat['size'] < $minimumBytes
        || $resolvedStat['size'] > $maximumBytes
        || !attestor_same_file_stat($lexicalStat, $resolvedStat)
    ) attestor_fail($failureCode);
    $handle = @fopen($resolved, 'rb');
    if (!is_resource($handle)) attestor_fail($failureCode);
    $before = fstat($handle);
    if (!is_array($before) || !attestor_same_file_stat($resolvedStat, $before)) {
        fclose($handle);
        attestor_fail($failureCode);
    }
    $bytes = '';
    while (strlen($bytes) < $before['size']) {
        $chunk = fread($handle, min(8192, $before['size'] - strlen($bytes)));
        if (!is_string($chunk) || $chunk === '') {
            fclose($handle);
            attestor_fail($failureCode);
        }
        $bytes .= $chunk;
    }
    $overflow = fread($handle, 1);
    $after = fstat($handle);
    $closed = fclose($handle);
    if (
        $overflow !== ''
        || !is_array($after)
        || !attestor_same_file_stat($before, $after)
        || strlen($bytes) !== $before['size']
        || !$closed
    ) attestor_fail($failureCode);
    return [
        'bytes' => $bytes,
        'path' => $resolved,
        'size' => strlen($bytes),
        'sha256' => hash('sha256', $bytes),
        'stat' => $after,
    ];
}

/** @return array<string, mixed> */
function attestor_read_canonical_json(string $path, int $mode, int $maximumBytes): array
{
    $source = attestor_read_regular_file(
        $path,
        $mode,
        3,
        $maximumBytes,
        'protected_overlay_attestor_input_invalid',
    )['bytes'];
    try {
        $value = json_decode($source, true, 64, JSON_THROW_ON_ERROR);
        $canonical = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    } catch (Throwable) {
        attestor_fail('protected_overlay_attestor_input_invalid');
    }
    if (!is_array($value) || array_is_list($value) || $source !== $canonical) {
        attestor_fail('protected_overlay_attestor_input_invalid');
    }
    return $value;
}

/** @return array{bytes:string,path:string,size:int,sha256:string} */
function attestor_measure_file(string $path, int $mode, int $maximumBytes): array
{
    return attestor_read_regular_file(
        $path,
        $mode,
        1,
        $maximumBytes,
        'protected_overlay_attestor_measurement_invalid',
    );
}

/** @param array<string, mixed> $requestRealm */
function attestor_verify_environment(array $requestRealm, array $definition, string $documentRoot): array
{
    $configured = $requestRealm['configuredEnvironment'] ?? null;
    $inputs = $requestRealm['inputs'] ?? null;
    if (!is_array($configured) || !array_is_list($configured) || !is_array($inputs) || array_is_list($inputs)) {
        attestor_fail('protected_overlay_attestor_request_invalid');
    }
    $expectedNames = [
        $definition['factoryEnvironment'],
        $definition['configEnvironment'],
        $definition['contentEnvironment'],
    ];
    $observed = [];
    foreach ($expectedNames as $index => $name) {
        $entry = $configured[$index] ?? null;
        $value = getenv($name);
        if (
            !is_array($entry)
            || array_keys($entry) !== ['name', 'value']
            || ($entry['name'] ?? null) !== $name
            || !is_string($value)
            || $value === ''
            || $value !== ($entry['value'] ?? null)
            || ($entry['value'] ?? null) !== realpath($value)
        ) attestor_fail('protected_overlay_attestor_environment_mismatch');
        $resolved = realpath($value);
        if (!is_string($resolved) || $resolved === $documentRoot || str_starts_with($resolved, $documentRoot . DIRECTORY_SEPARATOR)) {
            attestor_fail('protected_overlay_attestor_environment_mismatch');
        }
        $observed[] = ['name' => $name, 'value' => $resolved];
    }

    $factory = attestor_measure_file($observed[0]['value'], 0600, 65536);
    $config = attestor_measure_file($observed[1]['value'], 0600, 4096);
    foreach ([['backendFactory', $factory], ['brokerConfig', $config]] as [$name, $measured]) {
        $expected = $inputs[$name] ?? null;
        if (
            !is_array($expected)
            || array_keys($expected) !== ['path', 'size', 'sha256']
            || $expected['path'] !== $measured['path']
            || $expected['size'] !== $measured['size']
            || $expected['sha256'] !== $measured['sha256']
        ) attestor_fail('protected_overlay_attestor_measurement_mismatch');
    }

    $contentRoot = $observed[2]['value'];
    $contentStat = lstat($contentRoot);
    $expectedContent = $inputs['privateContent'] ?? null;
    if (
        !is_array($contentStat)
        || !is_dir($contentRoot)
        || is_link($contentRoot)
        || ($contentStat['mode'] & 0777) !== 0700
        || !is_array($expectedContent)
        || array_keys($expectedContent) !== ['path', 'inventorySha256', 'files']
        || $expectedContent['path'] !== $contentRoot
        || !is_array($expectedContent['files'])
        || !array_is_list($expectedContent['files'])
    ) attestor_fail('protected_overlay_attestor_measurement_mismatch');
    $names = scandir($contentRoot);
    if (!is_array($names)) attestor_fail('protected_overlay_attestor_measurement_mismatch');
    $names = array_values(array_filter($names, static fn (string $name): bool => $name !== '.' && $name !== '..'));
    sort($names);
    if ($names !== $definition['contentFiles']) attestor_fail('protected_overlay_attestor_measurement_mismatch');
    $files = [];
    foreach ($names as $name) {
        $measured = attestor_measure_file($contentRoot . DIRECTORY_SEPARATOR . $name, 0600, 65536);
        $files[] = ['path' => $name, 'size' => $measured['size'], 'sha256' => $measured['sha256']];
    }
    $inventory = hash('sha256', json_encode($files, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    if ($expectedContent['files'] !== $files || $expectedContent['inventorySha256'] !== $inventory) {
        attestor_fail('protected_overlay_attestor_measurement_mismatch');
    }
    return $observed;
}

/** @param array<string, mixed> $requestRealm @return array{documentRoot:string,phpSapi:string} */
function attestor_verify_runtime(array $requestRealm, string $documentRoot): array
{
    $expected = $requestRealm['runtimeIdentity'] ?? null;
    $observed = ['documentRoot' => $documentRoot, 'phpSapi' => PHP_SAPI];
    if (
        !is_array($expected)
        || array_keys($expected) !== ['documentRoot', 'phpSapi']
        || $expected !== $observed
    ) attestor_fail('protected_overlay_attestor_runtime_mismatch');
    return $observed;
}

/** @param array<string, mixed> $requestRealm */
function attestor_run_harness(array $requestRealm, array $definition, string $projectRoot): array
{
    $expected = $requestRealm['phpHarness'] ?? null;
    if (!is_array($expected) || array_is_list($expected)) {
        attestor_fail('protected_overlay_attestor_request_invalid');
    }
    $harnessPath = realpath($projectRoot . DIRECTORY_SEPARATOR . $definition['harnessPath']);
    $expectedPath = realpath($projectRoot . DIRECTORY_SEPARATOR . (string) ($expected['path'] ?? ''));
    $attestorPath = realpath($projectRoot . DIRECTORY_SEPARATOR . (string) (($requestRealm['attestor']['path'] ?? '')));
    $attestorSource = attestor_measure_file(__FILE__, 0644, 262144);
    $harnessSource = $harnessPath === false
        ? null
        : attestor_measure_file($harnessPath, 0644, 262144);
    if (
        $harnessPath === false
        || !is_array($harnessSource)
        || $expectedPath !== $harnessPath
        || $attestorPath !== $attestorSource['path']
        || $attestorSource['sha256'] !== ($requestRealm['attestor']['sha256'] ?? null)
        || $harnessSource['sha256'] !== ($expected['sourceSha256'] ?? null)
        || ($expected['sourceSha256'] ?? null) !== $definition['harnessSha256']
        || PHP_VERSION_ID < ($expected['minimumVersionId'] ?? PHP_INT_MAX)
        || !function_exists('proc_open')
    ) attestor_fail('protected_overlay_attestor_harness_invalid');
    $pipes = [];
    $process = proc_open(
        [PHP_BINARY, $harnessPath],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes,
        $projectRoot,
        null,
        ['bypass_shell' => true],
    );
    if (!is_resource($process)) attestor_fail('protected_overlay_attestor_harness_invalid');
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1], 4097);
    $stderr = stream_get_contents($pipes[2], 4097);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $status = proc_close($process);
    $harnessAfter = attestor_measure_file($harnessPath, 0644, 262144);
    if (
        !is_string($stdout)
        || !is_string($stderr)
        || $status !== 0
        || $stderr !== ''
        || base64_encode($stdout) !== ($expected['expectedOutputBase64'] ?? null)
        || hash('sha256', $stdout) !== ($expected['expectedOutputSha256'] ?? null)
        || $harnessAfter['sha256'] !== $harnessSource['sha256']
        || !attestor_same_file_stat($harnessAfter['stat'], $harnessSource['stat'])
    ) attestor_fail('protected_overlay_attestor_harness_failed');
    return [
        'outputBase64' => base64_encode($stdout),
        'outputSha256' => hash('sha256', $stdout),
        'path' => $definition['harnessPath'],
        'phpVersionId' => PHP_VERSION_ID,
        'sourceSha256' => $definition['harnessSha256'],
        'status' => 'passed',
    ];
}

function attestor_write_output(string $path, array $value): void
{
    $source = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    $handle = @fopen($path, 'x');
    if (!is_resource($handle) || !chmod($path, 0400) || fwrite($handle, $source) !== strlen($source) || !fclose($handle)) {
        attestor_fail('protected_overlay_attestor_output_invalid');
    }
}

$arguments = attestor_runtime_arguments(array_slice($argv ?? [], 1));
$realm = $arguments['--realm'];
$definitions = [
    'production' => [
        'factoryEnvironment' => 'CABOHEALTH_CLIENT_RESOURCES_BACKEND_FACTORY',
        'configEnvironment' => 'CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG',
        'contentEnvironment' => 'CABOHEALTH_CLIENT_RESOURCES_PRIVATE_CONTENT_ROOT',
        'keyEnvironment' => 'CABOHEALTH_CLIENT_RESOURCES_ATTESTATION_KEY',
        'harnessPath' => 'tools/hosting/tests/client-resource-broker.php',
        'harnessSha256' => '2f400b61473bf634da2474f0332e56cc79ac6d853353873f08e7674a386a0f8d',
        'contentFiles' => ['en.json', 'es-MX.json'],
    ],
    'review' => [
        'factoryEnvironment' => 'CABOHEALTH_APP_REVIEW_BACKEND_FACTORY',
        'configEnvironment' => 'CABOHEALTH_APP_REVIEW_SIGNING_CONFIG',
        'contentEnvironment' => 'CABOHEALTH_APP_REVIEW_PRIVATE_CONTENT_ROOT',
        'keyEnvironment' => 'CABOHEALTH_APP_REVIEW_ATTESTATION_KEY',
        'harnessPath' => 'tools/hosting/tests/app-review-broker.php',
        'harnessSha256' => '4b7bf67e1a97334995e3033e541f02c282197a17f581dcc2ea47c61b5c28b10a',
        'contentFiles' => ['sample.json'],
    ],
];
$definition = $definitions[$realm] ?? null;
if (!is_array($definition) || !extension_loaded('sodium')) {
    attestor_fail('protected_overlay_attestor_environment_invalid');
}
$projectRoot = realpath($arguments['--project-root']);
$documentRootInput = PHP_SAPI === 'cli'
    ? getenv('DOCUMENT_ROOT')
    : ($_SERVER['DOCUMENT_ROOT'] ?? null);
$documentRoot = is_string($documentRootInput) ? realpath($documentRootInput) : false;
if ($projectRoot === false || $documentRoot === false || !is_dir($projectRoot) || !is_dir($documentRoot)) {
    attestor_fail('protected_overlay_attestor_environment_invalid');
}
$requestPath = realpath($arguments['--request']);
$outputParent = realpath(dirname($arguments['--out']));
$outputParentStat = $outputParent === false ? false : lstat($outputParent);
if (
    $requestPath === false
    || $outputParent === false
    || !is_array($outputParentStat)
    || !str_starts_with($arguments['--out'], '/')
    || !is_dir($outputParent)
    || is_link(dirname($arguments['--out']))
    || ($outputParentStat['mode'] & 0777) !== 0700
    || $requestPath === $documentRoot
    || str_starts_with($requestPath, $documentRoot . DIRECTORY_SEPARATOR)
    || $outputParent === $documentRoot
    || str_starts_with($outputParent, $documentRoot . DIRECTORY_SEPARATOR)
) attestor_fail('protected_overlay_attestor_environment_invalid');
$request = attestor_read_canonical_json($arguments['--request'], 0400, 262144);
$requestRealms = $request['realms'] ?? null;
if (!is_array($requestRealms) || !array_is_list($requestRealms) || count($requestRealms) !== 2) {
    attestor_fail('protected_overlay_attestor_request_invalid');
}
$requestRealm = null;
foreach ($requestRealms as $candidate) {
    if (is_array($candidate) && ($candidate['realm'] ?? null) === $realm) $requestRealm = $candidate;
}
if (!is_array($requestRealm)) attestor_fail('protected_overlay_attestor_request_invalid');
$runtimeIdentity = attestor_verify_runtime($requestRealm, $documentRoot);
$configuredEnvironment = attestor_verify_environment($requestRealm, $definition, $documentRoot);
$phpHarness = attestor_run_harness($requestRealm, $definition, $projectRoot);
$keyPath = getenv($definition['keyEnvironment']);
if (!is_string($keyPath) || $keyPath === '') attestor_fail('protected_overlay_attestor_key_invalid');
$resolvedKeyPath = realpath($keyPath);
$resolvedKeyParent = $resolvedKeyPath === false ? false : realpath(dirname($resolvedKeyPath));
$keyParentStat = $resolvedKeyParent === false ? false : lstat($resolvedKeyParent);
if (
    !str_starts_with($keyPath, '/')
    || $resolvedKeyPath === false
    || $resolvedKeyParent === false
    || is_link($keyPath)
    || realpath(dirname($keyPath)) !== $resolvedKeyParent
    || !is_array($keyParentStat)
    || !is_dir($resolvedKeyParent)
    || is_link(dirname($keyPath))
    || ($keyParentStat['mode'] & 0777) !== 0700
    || $resolvedKeyPath === $documentRoot
    || str_starts_with($resolvedKeyPath, $documentRoot . DIRECTORY_SEPARATOR)
) attestor_fail('protected_overlay_attestor_key_invalid');
$keyDocument = attestor_read_canonical_json($resolvedKeyPath, 0600, 1024);
if (
    array_keys($keyDocument) !== ['schemaVersion', 'algorithm', 'secretKeyBase64']
    || ($keyDocument['schemaVersion'] ?? null) !== 1
    || ($keyDocument['algorithm'] ?? null) !== 'Ed25519'
    || !is_string($keyDocument['secretKeyBase64'] ?? null)
) attestor_fail('protected_overlay_attestor_key_invalid');
$secretKey = base64_decode($keyDocument['secretKeyBase64'], true);
$publicDer = base64_decode((string) (($requestRealm['attestor']['publicKeyDerBase64'] ?? '')), true);
if (
    !is_string($secretKey)
    || strlen($secretKey) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES
    || !is_string($publicDer)
    || $publicDer !== hex2bin('302a300506032b6570032100') . sodium_crypto_sign_publickey_from_secretkey($secretKey)
) attestor_fail('protected_overlay_attestor_key_invalid');
$result = [
    'configuredEnvironment' => $configuredEnvironment,
    'phpHarness' => $phpHarness,
    'runtimeIdentity' => $runtimeIdentity,
    'status' => 'passed',
];
$signed = [
    'schemaVersion' => 1,
    'attestationKind' => PROTECTED_OVERLAY_ATTESTATION_KIND,
    'request' => $requestRealm,
    'result' => $result,
];
$message = PROTECTED_OVERLAY_ATTESTATION_DOMAIN . "\n"
    . json_encode($signed, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
$attestation = [
    'realm' => $realm,
    'result' => $result,
    'signatureBase64' => base64_encode(sodium_crypto_sign_detached($message, $secretKey)),
];
attestor_write_output($arguments['--out'], $attestation);
if (PHP_SAPI !== 'cli') header('Content-Type: application/json; charset=utf-8');
echo json_encode(['status' => 'attested', 'realm' => $realm], JSON_THROW_ON_ERROR) . "\n";
