<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/lib/runtime.php';

$documentRoot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
try {
    $backend = client_resources_backend_from_environment($documentRoot);
    $store = client_resources_store_from_environment($documentRoot);
    $response = client_resources_resources_response(ClientResourcesRequest::fromGlobals(), $backend, $store);
} catch (Throwable) {
    $response = client_resources_error_response(503);
}

client_resources_emit($response);
