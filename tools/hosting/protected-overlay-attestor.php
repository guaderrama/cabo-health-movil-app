<?php

declare(strict_types=1);

const PROTECTED_OVERLAY_ATTESTATION_DOMAIN = 'cabohealth-protected-overlay-hostinger-attestation-v1';
const PROTECTED_OVERLAY_ATTESTATION_KIND = 'cabohealth-protected-overlay-hostinger-attestation-v1';
const PROTECTED_OVERLAY_CHILD_ENVIRONMENT = ['LANG' => 'C', 'LC_ALL' => 'C'];
const PROTECTED_OVERLAY_PINNED_PHP_CLI = '/proc/self/fd/3';

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
    foreach (['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtime', 'ctime'] as $name) {
        if (!isset($left[$name], $right[$name]) || $left[$name] !== $right[$name]) return false;
    }
    return true;
}

/** @return array<string, mixed> */
function attestor_read_regular_file(
    string $path,
    int $mode,
    int $minimumBytes,
    int $maximumBytes,
    string $failureCode,
    bool $keepOpen = false,
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
    $closed = $keepOpen || fclose($handle);
    if (
        $overflow !== ''
        || !is_array($after)
        || !attestor_same_file_stat($before, $after)
        || strlen($bytes) !== $before['size']
        || !$closed
    ) attestor_fail($failureCode);
    $result = [
        'bytes' => $bytes,
        'path' => $resolved,
        'size' => strlen($bytes),
        'sha256' => hash('sha256', $bytes),
        'stat' => $after,
    ];
    if ($keepOpen) $result['handle'] = $handle;
    return $result;
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
        $canonical = json_encode(
            $value,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        ) . "\n";
    } catch (Throwable) {
        attestor_fail('protected_overlay_attestor_input_invalid');
    }
    if (!is_array($value) || array_is_list($value) || $source !== $canonical) {
        attestor_fail('protected_overlay_attestor_input_invalid');
    }
    return $value;
}

/** @return array{bytes:string,path:string,size:int,sha256:string,stat:array<string,int>} */
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

/** @return array<string,mixed> */
function attestor_open_pinned_executable(string $path): array
{
    return attestor_read_regular_file(
        $path,
        0755,
        1,
        134217728,
        'protected_overlay_attestor_measurement_invalid',
        true,
    );
}

function attestor_is_resource_id(string $value): bool
{
    return strlen($value) <= 64
        && preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/D', $value) === 1;
}

/** @param array<string, true> $identities @return array<string, int> */
function attestor_measure_direct_directory(
    string $path,
    string $expectedParent,
    array &$identities,
): array {
    $before = @lstat($path);
    $resolved = @realpath($path);
    $resolvedStat = $resolved === false ? false : @lstat($resolved);
    if (
        !is_array($before)
        || $resolved === false
        || $resolved !== $path
        || dirname($resolved) !== $expectedParent
        || !is_array($resolvedStat)
        || is_link($path)
        || ($resolvedStat['mode'] & 0170000) !== 0040000
        || ($resolvedStat['mode'] & 0777) !== 0700
        || !attestor_same_file_stat($before, $resolvedStat)
    ) attestor_fail('protected_overlay_attestor_measurement_mismatch');
    $identity = $resolvedStat['dev'] . ':' . $resolvedStat['ino'];
    if (isset($identities[$identity])) {
        attestor_fail('protected_overlay_attestor_measurement_mismatch');
    }
    $identities[$identity] = true;
    return $resolvedStat;
}

/** @return list<string> */
function attestor_direct_names(string $path): array
{
    $names = @scandir($path);
    if (!is_array($names)) attestor_fail('protected_overlay_attestor_measurement_mismatch');
    $names = array_values(array_filter(
        $names,
        static fn (string $name): bool => $name !== '.' && $name !== '..',
    ));
    sort($names, SORT_STRING);
    return $names;
}

/** @return array<string, mixed> */
function attestor_measure_private_content(string $contentRoot, array $definition): array
{
    $rootBefore = @lstat($contentRoot);
    if (
        !is_array($rootBefore)
        || realpath($contentRoot) !== $contentRoot
        || is_link($contentRoot)
        || ($rootBefore['mode'] & 0170000) !== 0040000
        || ($rootBefore['mode'] & 0777) !== 0700
    ) attestor_fail('protected_overlay_attestor_measurement_mismatch');
    $identities = [($rootBefore['dev'] . ':' . $rootBefore['ino']) => true];
    $names = attestor_direct_names($contentRoot);
    $directories = [];
    $files = [];
    $directoryStats = [];
    $fileStats = [];
    $policy = $definition['contentPolicy'] ?? null;

    if ($policy === 'resource-catalog') {
        $flatPaths = array_values(array_filter(
            $names,
            static fn (string $name): bool => in_array($name, ['en.json', 'es-MX.json'], true),
        ));
        $hasLegacyFlat = $flatPaths === ['en.json', 'es-MX.json'];
        if ($flatPaths !== [] && !$hasLegacyFlat) {
            attestor_fail('protected_overlay_attestor_measurement_mismatch');
        }
        $resourceIds = array_values(array_filter(
            $names,
            static fn (string $name): bool => !in_array($name, ['en.json', 'es-MX.json'], true),
        ));
        if (count($resourceIds) > 12 || (count($resourceIds) === 0 && !$hasLegacyFlat)) {
            attestor_fail('protected_overlay_attestor_measurement_mismatch');
        }
        foreach ($resourceIds as $resourceId) {
            if (!attestor_is_resource_id($resourceId)) {
                attestor_fail('protected_overlay_attestor_measurement_mismatch');
            }
            $resourceRoot = $contentRoot . DIRECTORY_SEPARATOR . $resourceId;
            $directoryStats[$resourceId] = attestor_measure_direct_directory(
                $resourceRoot,
                $contentRoot,
                $identities,
            );
            if (attestor_direct_names($resourceRoot) !== ['en.json', 'es-MX.json']) {
                attestor_fail('protected_overlay_attestor_measurement_mismatch');
            }
            $directories[] = ['path' => $resourceId, 'mode' => '0700'];
        }
        $hasStructuredClientResources = in_array('client-resources', $resourceIds, true);
        if ($hasLegacyFlat && count($resourceIds) > 0 && !$hasStructuredClientResources) {
            attestor_fail('protected_overlay_attestor_measurement_mismatch');
        }
        $layout = $hasLegacyFlat
            ? (count($resourceIds) === 0
                ? 'legacy-flat'
                : 'structured-with-client-resources-fallback')
            : 'structured';
        $resourceCount = count($resourceIds) + ($hasLegacyFlat && !$hasStructuredClientResources ? 1 : 0);
        $filePaths = $flatPaths;
        foreach ($resourceIds as $resourceId) {
            $filePaths[] = $resourceId . '/en.json';
            $filePaths[] = $resourceId . '/es-MX.json';
        }
    } elseif (is_array($policy) && array_keys($policy) === ['fixedFiles']) {
        $filePaths = $policy['fixedFiles'];
        if (!is_array($filePaths) || $names !== $filePaths) {
            attestor_fail('protected_overlay_attestor_measurement_mismatch');
        }
        $layout = 'fixed-flat';
        $resourceCount = 0;
    } else {
        attestor_fail('protected_overlay_attestor_measurement_mismatch');
    }

    foreach ($filePaths as $relativePath) {
        $path = $contentRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
        if (realpath($path) !== $path) attestor_fail('protected_overlay_attestor_measurement_mismatch');
        $measured = attestor_measure_file($path, 0600, 65536);
        if ($measured['size'] < 2) attestor_fail('protected_overlay_attestor_measurement_mismatch');
        $identity = $measured['stat']['dev'] . ':' . $measured['stat']['ino'];
        if (isset($identities[$identity])) {
            attestor_fail('protected_overlay_attestor_measurement_mismatch');
        }
        $identities[$identity] = true;
        $fileStats[$path] = $measured['stat'];
        $files[] = [
            'path' => $relativePath,
            'mode' => '0600',
            'size' => $measured['size'],
            'sha256' => $measured['sha256'],
        ];
    }
    foreach ($directoryStats as $resourceId => $before) {
        $after = @lstat($contentRoot . DIRECTORY_SEPARATOR . $resourceId);
        if (!is_array($after) || !attestor_same_file_stat($before, $after)) {
            attestor_fail('protected_overlay_attestor_measurement_mismatch');
        }
    }
    foreach ($fileStats as $path => $before) {
        $after = @lstat($path);
        if (!is_array($after) || !attestor_same_file_stat($before, $after)) {
            attestor_fail('protected_overlay_attestor_measurement_mismatch');
        }
    }
    $rootAfter = @lstat($contentRoot);
    if (!is_array($rootAfter) || !attestor_same_file_stat($rootBefore, $rootAfter)) {
        attestor_fail('protected_overlay_attestor_measurement_mismatch');
    }
    $inventory = [
        'layout' => $layout,
        'rootMode' => '0700',
        'resourceCount' => $resourceCount,
        'directories' => $directories,
        'files' => $files,
    ];
    return [
        'path' => $contentRoot,
        'layout' => $layout,
        'rootMode' => '0700',
        'resourceCount' => $resourceCount,
        'directories' => $directories,
        'inventorySha256' => hash(
            'sha256',
            json_encode(
                $inventory,
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
            ),
        ),
        'files' => $files,
    ];
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
    $expectedContent = $inputs['privateContent'] ?? null;
    $measuredContent = attestor_measure_private_content($contentRoot, $definition);
    if (!is_array($expectedContent) || $expectedContent !== $measuredContent) {
        attestor_fail('protected_overlay_attestor_measurement_mismatch');
    }
    return ['configuredEnvironment' => $observed, 'privateContent' => $measuredContent];
}

/** @param array<string, mixed> $requestRealm @return array{identity:array<string,mixed>,phpCli:array<string,mixed>} */
function attestor_verify_runtime(array $requestRealm, string $documentRoot): array
{
    $expected = $requestRealm['runtimeIdentity'] ?? null;
    $configuredPhpCli = getenv('CABOHEALTH_PROTECTED_OVERLAY_PHP_CLI');
    $resolvedPhpCli = is_string($configuredPhpCli) ? realpath($configuredPhpCli) : false;
    if (
        !is_array($expected)
        || array_keys($expected) !== [
            'documentRoot',
            'phpCliMode',
            'phpCliOwnerUid',
            'phpCliPath',
            'phpCliSha256',
            'phpCliSize',
            'phpCliVersionId',
            'phpSapi',
        ]
        || !is_string($configuredPhpCli)
        || $configuredPhpCli === ''
        || $resolvedPhpCli === false
        || $configuredPhpCli !== $resolvedPhpCli
        || PHP_OS_FAMILY !== 'Linux'
        || !is_dir('/proc/self/fd')
        || ($expected['phpCliPath'] ?? null) !== $resolvedPhpCli
        || !is_int($expected['phpCliVersionId'] ?? null)
        || $expected['phpCliVersionId'] < 80200
        || $resolvedPhpCli === $documentRoot
        || str_starts_with($resolvedPhpCli, $documentRoot . DIRECTORY_SEPARATOR)
    ) attestor_fail('protected_overlay_attestor_runtime_mismatch');
    $phpCli = attestor_open_pinned_executable($resolvedPhpCli);
    $observed = [
        'documentRoot' => $documentRoot,
        'phpCliMode' => '0755',
        'phpCliOwnerUid' => $phpCli['stat']['uid'],
        'phpCliPath' => $phpCli['path'],
        'phpCliSha256' => $phpCli['sha256'],
        'phpCliSize' => $phpCli['size'],
        'phpCliVersionId' => $expected['phpCliVersionId'],
        'phpSapi' => PHP_SAPI,
    ];
    if ($expected !== $observed) attestor_fail('protected_overlay_attestor_runtime_mismatch');
    return ['identity' => $observed, 'phpCli' => $phpCli];
}

/** @param array<string, mixed> $requestRealm @return list<array<string, mixed>> */
function attestor_run_harnesses(
    array $requestRealm,
    array $definition,
    string $projectRoot,
    array $phpCli,
): array
{
    $expectedHarnesses = $requestRealm['phpHarnesses'] ?? null;
    $definedHarnesses = $definition['harnesses'] ?? null;
    if (
        !is_array($expectedHarnesses)
        || !array_is_list($expectedHarnesses)
        || !is_array($definedHarnesses)
        || !array_is_list($definedHarnesses)
        || count($expectedHarnesses) !== count($definedHarnesses)
    ) {
        attestor_fail('protected_overlay_attestor_request_invalid');
    }
    $attestorPath = realpath($projectRoot . DIRECTORY_SEPARATOR . (string) (($requestRealm['attestor']['path'] ?? '')));
    $attestorSource = attestor_measure_file(__FILE__, 0644, 262144);
    if (
        $attestorPath !== $attestorSource['path']
        || $attestorSource['sha256'] !== ($requestRealm['attestor']['sha256'] ?? null)
        || !function_exists('proc_open')
    ) attestor_fail('protected_overlay_attestor_harness_invalid');
    $versionPipes = [];
    $versionProcess = proc_open(
        [PROTECTED_OVERLAY_PINNED_PHP_CLI, '-r', 'echo PHP_VERSION_ID;'],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w'], 3 => $phpCli['handle']],
        $versionPipes,
        $projectRoot,
        PROTECTED_OVERLAY_CHILD_ENVIRONMENT,
        ['bypass_shell' => true],
    );
    if (!is_resource($versionProcess)) attestor_fail('protected_overlay_attestor_php_cli_invalid');
    fclose($versionPipes[0]);
    $versionStdout = stream_get_contents($versionPipes[1], 16);
    $versionStderr = stream_get_contents($versionPipes[2], 1025);
    fclose($versionPipes[1]);
    fclose($versionPipes[2]);
    $versionStatus = proc_close($versionProcess);
    if (
        !is_string($versionStdout)
        || !preg_match('/\A[0-9]{5,6}\z/D', $versionStdout)
        || !is_string($versionStderr)
        || $versionStderr !== ''
        || $versionStatus !== 0
    ) attestor_fail('protected_overlay_attestor_php_cli_invalid');
    $phpVersionId = (int) $versionStdout;
    if ($phpVersionId !== ($requestRealm['runtimeIdentity']['phpCliVersionId'] ?? null)) {
        attestor_fail('protected_overlay_attestor_php_cli_invalid');
    }
    $results = [];
    foreach ($definedHarnesses as $index => $defined) {
        $expected = $expectedHarnesses[$index] ?? null;
        if (
            !is_array($defined)
            || array_keys($defined) !== ['path', 'sha256', 'output']
            || !is_array($expected)
            || array_keys($expected) !== [
                'path',
                'sourceSha256',
                'minimumVersionId',
                'expectedOutputBase64',
                'expectedOutputSha256',
            ]
            || ($expected['path'] ?? null) !== ($defined['path'] ?? null)
            || ($expected['sourceSha256'] ?? null) !== ($defined['sha256'] ?? null)
            || ($expected['minimumVersionId'] ?? null) !== 80200
            || $phpVersionId < 80200
            || ($expected['expectedOutputBase64'] ?? null) !== base64_encode($defined['output'])
            || ($expected['expectedOutputSha256'] ?? null) !== hash('sha256', $defined['output'])
        ) attestor_fail('protected_overlay_attestor_harness_invalid');
        $harnessPath = realpath($projectRoot . DIRECTORY_SEPARATOR . $defined['path']);
        $expectedPath = realpath($projectRoot . DIRECTORY_SEPARATOR . (string) $expected['path']);
        $harnessSource = $harnessPath === false
            ? null
            : attestor_measure_file($harnessPath, 0644, 262144);
        if (
            $harnessPath === false
            || !is_array($harnessSource)
            || $expectedPath !== $harnessPath
            || $harnessSource['sha256'] !== $defined['sha256']
        ) attestor_fail('protected_overlay_attestor_harness_invalid');
        $pipes = [];
        $process = proc_open(
            [PROTECTED_OVERLAY_PINNED_PHP_CLI, $harnessPath],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w'], 3 => $phpCli['handle']],
            $pipes,
            $projectRoot,
            PROTECTED_OVERLAY_CHILD_ENVIRONMENT,
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
        $results[] = [
            'outputBase64' => base64_encode($stdout),
            'outputSha256' => hash('sha256', $stdout),
            'path' => $defined['path'],
            'phpVersionId' => $phpVersionId,
            'sourceSha256' => $defined['sha256'],
            'status' => 'passed',
        ];
    }
    $phpCliAfter = attestor_measure_file($phpCli['path'], 0755, 134217728);
    $pinnedPhpCliAfter = fstat($phpCli['handle']);
    $pinnedPhpCliClosed = fclose($phpCli['handle']);
    if (
        !is_array($pinnedPhpCliAfter)
        || !attestor_same_file_stat($pinnedPhpCliAfter, $phpCli['stat'])
        || !$pinnedPhpCliClosed
        || $phpCliAfter['sha256'] !== $phpCli['sha256']
        || !attestor_same_file_stat($phpCliAfter['stat'], $phpCli['stat'])
    ) attestor_fail('protected_overlay_attestor_harness_failed');
    return $results;
}

function attestor_write_output(string $path, array $value): void
{
    $source = json_encode(
        $value,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    ) . "\n";
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
        'harnesses' => [
            [
                'path' => 'tools/hosting/tests/client-resource-broker.php',
                'sha256' => 'c8977a71d740ac7be0a745548e0a0c3fc3904028a19fe4b460bdb2755a67ca21',
                'output' => "client resource broker: ok\n",
            ],
            [
                'path' => 'tools/hosting/tests/dynamic-client-resource-broker.php',
                'sha256' => '9a9df9f409d87555851aaf7e14c4f3e1e430d394bfd304ded2ab90bd6b2518af',
                'output' => "dynamic client resource broker: ok\n",
            ],
        ],
        'contentPolicy' => 'resource-catalog',
    ],
    'review' => [
        'factoryEnvironment' => 'CABOHEALTH_APP_REVIEW_BACKEND_FACTORY',
        'configEnvironment' => 'CABOHEALTH_APP_REVIEW_SIGNING_CONFIG',
        'contentEnvironment' => 'CABOHEALTH_APP_REVIEW_PRIVATE_CONTENT_ROOT',
        'keyEnvironment' => 'CABOHEALTH_APP_REVIEW_ATTESTATION_KEY',
        'harnesses' => [[
            'path' => 'tools/hosting/tests/app-review-broker.php',
            'sha256' => 'd30b39aa480a02897868ec33ca7f434adec8e833bce4e53e33c889095edf171b',
            'output' => "app review broker: ok\n",
        ]],
        'contentPolicy' => ['fixedFiles' => ['sample.json']],
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
$runtime = attestor_verify_runtime($requestRealm, $documentRoot);
$environmentBefore = attestor_verify_environment($requestRealm, $definition, $documentRoot);
$phpHarnesses = attestor_run_harnesses($requestRealm, $definition, $projectRoot, $runtime['phpCli']);
$environment = attestor_verify_environment($requestRealm, $definition, $documentRoot);
if ($environmentBefore !== $environment) {
    attestor_fail('protected_overlay_attestor_measurement_mismatch');
}
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
    'configuredEnvironmentNames' => array_map(
        static fn (array $entry): string => $entry['name'],
        $environment['configuredEnvironment'],
    ),
    'inputsSha256' => hash(
        'sha256',
        json_encode(
            $requestRealm['inputs'],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        ),
    ),
    'phpHarnesses' => $phpHarnesses,
    'privateContent' => [
        'layout' => $environment['privateContent']['layout'],
        'resourceCount' => $environment['privateContent']['resourceCount'],
        'inventorySha256' => $environment['privateContent']['inventorySha256'],
    ],
    'runtimeIdentitySha256' => hash(
        'sha256',
        json_encode(
            $runtime['identity'],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        ),
    ),
    'status' => 'passed',
];
$signed = [
    'schemaVersion' => 1,
    'attestationKind' => PROTECTED_OVERLAY_ATTESTATION_KIND,
    'request' => $requestRealm,
    'result' => $result,
];
$message = PROTECTED_OVERLAY_ATTESTATION_DOMAIN . "\n"
    . json_encode(
        $signed,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
$attestation = [
    'realm' => $realm,
    'result' => $result,
    'signatureBase64' => base64_encode(sodium_crypto_sign_detached($message, $secretKey)),
];
attestor_write_output($arguments['--out'], $attestation);
if (PHP_SAPI !== 'cli') header('Content-Type: application/json; charset=utf-8');
echo json_encode(['status' => 'attested', 'realm' => $realm], JSON_THROW_ON_ERROR) . "\n";
