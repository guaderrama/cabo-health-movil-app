<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/runtime.php';

$documentRoot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
try {
    $backend = app_review_backend_from_environment($documentRoot);
    $store = app_review_store_from_environment($documentRoot);
    $response = app_review_launch_response(AppReviewRequest::fromGlobals(), $backend, $store);
} catch (Throwable) {
    $response = app_review_error_response(503);
}

app_review_emit($response);
