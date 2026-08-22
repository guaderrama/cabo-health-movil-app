<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/lib/runtime.php';

$documentRoot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
try {
    $backend = client_resources_backend_from_environment($documentRoot);
    $response = client_resources_delete_session_response(ClientResourcesRequest::fromGlobals(), $backend);
} catch (Throwable) {
    $response = client_resources_error_response(503);
}

client_resources_emit($response);
