# Client Resources web broker

Status: **NOT ACTIVE**. This source implements the web-side contract, but it is
fail-closed until the matching production `brokerApi`, private signing
configuration, and private content release are installed and verified. No
deployment was performed as part of this change.

## Trust boundary

- The public document root contains only the bilingual shell, JavaScript,
  styles, PHP entry points, and the generic runtime.
- The reviewed EN/ES resource documents, backend factory, endpoint
  configuration, and signing key must live outside the docroot.
- The shell contains no exclusive resource text. The protected API reads a
  private release only after a live server-side session and grant are
  revalidated.
- The browser receives an opaque, host-only `__Secure-cabohealth_client`
  cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and exact
  `Path=/apps/client-resources/`. `__Host-` must not be used because a
  path-scoped cookie is incompatible with that prefix.
- There is no analytics, native JavaScript bridge, PHI, personalized plan,
  upload, or free-text health field in this vertical.

## Exact Functions contract

All three calls are HTTPS `POST` requests to the exact configured
`brokerApi` host. Redirects are disabled. Connect timeout is 1.5 seconds,
total timeout is 4 seconds, TLS peer/host verification is mandatory, and a
response larger than 16 KiB is rejected.

Routes and exact bodies:

- `/v1/launch/redeem`: `{"nonce":"<opaque-32-char-value>"}` →
  `{"sessionId":"<opaque>","expiresAtMs":<integer>}`.
- `/v1/sessions/introspect`: `{"sessionId":"<opaque>"}` →
  `{"active":true,"expiresAtMs":<integer>,"entitlements":["client-resources"],"csrfToken":"<opaque>"}`.
- `/v1/sessions/revoke`:
  `{"sessionId":"<opaque>","csrfToken":"<opaque>"}` →
  `{"revoked":true}`.

Each raw JSON body is signed using these headers:

- `X-CaboHealth-Key-Id`
- `X-CaboHealth-Timestamp` (Unix seconds)
- `X-CaboHealth-Request-Id` (UUID v4)
- `X-CaboHealth-Signature` (base64url HMAC-SHA256)

The canonical bytes are:

```text
cabohealth-broker-v1
POST
<exact path>
<timestamp>
<requestId>
<base64url SHA-256 of the exact raw body>
```

The PHP adapter accepts only an exact JSON success schema. Generic 401/403/404
responses become access denial; redirects, schema drift, wrong content type,
transport errors, and all other statuses fail closed. The adapter contains no
logging calls and never logs nonce, session, CSRF, HMAC key, or response body.

## Private installation gate

Do not activate the public endpoints until all steps below pass:

1. Deploy and freeze the matching Functions `brokerApi`; record its exact
   canonical HTTPS base URL and lowercase host from the backend release.
2. Install the same versioned key ID/key in Functions Secret Manager and in a
   private Hostinger configuration file. Never paste the value into Git,
   screenshots, chat, command history, or App Review notes.
3. Place the signing configuration outside the docroot with directory mode
   `0700` and file mode `0600`. Its shape must validate against
   `client-resources-private/config/broker-config.schema.json`.
4. Copy `backend-factory.php.example` to a private, non-public path. Set
   `CABOHEALTH_CLIENT_RESOURCES_BACKEND_FACTORY` to that absolute file and
   `CABOHEALTH_CLIENT_RESOURCES_SIGNING_CONFIG` to the absolute 0600 JSON file.
5. Deploy the matching reviewed content release outside the docroot and set
   `CABOHEALTH_CLIENT_RESOURCES_PRIVATE_CONTENT_ROOT` to its exact `content`
   directory. Never point this variable at `public_html` or a request value.
6. Confirm PHP 8.2 and the cURL extension, then run
   `tools/hosting/tests/client-resource-broker.php` in a private staging copy.
7. Against staging, verify valid launch, 60-second expiry, replay, GET/query
   rejection, wrong origin/CSRF, live revocation, session expiry, cookie path,
   clean 303 URL, bilingual content, and that direct private-file HTTPS access
   is impossible.
8. Rotate the staging key before production. Production must use its own key
   ID and signing key; never reuse staging material.

If any variable, file, permission, host, key, content release, response schema,
or PHP dependency is missing, the entry points return a sanitized 503 and no
protected content. An interface or example factory alone is not a functioning
deployment.
