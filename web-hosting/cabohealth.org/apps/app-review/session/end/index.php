<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/lib/runtime.php';

$documentRoot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
try {
    $backend = app_review_backend_from_environment($documentRoot);
    $response = app_review_end_session_response(AppReviewRequest::fromGlobals(), $backend);
} catch (Throwable) {
    $response = app_review_error_response(503);
}

app_review_emit($response);
