# Client Resources web broker

Status: **ACTIVE / HOSTING BOUNDARY VERIFIED 2026-08-24**. Production and App
Review are installed as one atomic protected release,
`protected-overlays-v1-f3fc2ffb500f41dbfbf16dd4141eef3ccf87ef7055df63a2054b9cbe042b8213`.
The matching broker configuration and bilingual content remain outside the
docroot. The PHP harness, signed LiteSpeed attestations, exact deployment gate,
and live invalid-nonce denial passed. Native credential, replay, revocation,
and physical-iPhone E2E remain separate Apple-submission gates.

## Trust boundary

- The protected public subtree under `web-hosting/cabohealth.org/apps/client-resources/`
  contains only the bilingual shell, JavaScript,
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
total timeout is 12 seconds, TLS peer/host verification is mandatory, and a
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

Every HTTP 200 response is authenticated before PHP parses or accepts its
JSON. Functions sends the exact request key ID and request ID back in
`X-CaboHealth-Key-Id` and `X-CaboHealth-Request-Id`, plus a base64url
HMAC-SHA256 in `X-CaboHealth-Response-Signature`. The response canonical bytes
are:

```text
cabohealth-broker-response-v1
200
<exact path>
<requestId>
<keyId>
<base64url SHA-256 of the exact raw response body>
```

A missing, duplicated, malformed, wrong-realm, or body-mismatched response
signature fails closed. Denial responses grant no authority and are never
parsed as successful data.

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
   The committed suite must prove that unsigned/tampered HTTP 200 responses
   are rejected before their JSON schema is consumed.
7. Against staging, verify valid launch, 60-second expiry, replay, GET/query
   rejection, wrong origin/CSRF, live revocation, session expiry, cookie path,
   clean 303 URL, bilingual content, and that direct private-file HTTPS access
   is impossible.
8. Rotate the staging key before production. Production must use its own key
   ID and signing key; never reuse staging material.

The production Secret Manager inventory is exactly eight rings:
`CLIENT_CODE_PEPPER_RING`, `CLIENT_INSTALLATION_PEPPER_RING`,
`CLIENT_DELETION_RECEIPT_PEPPER_RING`, `CLIENT_RATE_LIMIT_PEPPER_RING`,
`CLIENT_LAUNCH_NONCE_PEPPER_RING`, `CLIENT_WEB_SESSION_PEPPER_RING`,
`CLIENT_WEB_CSRF_PEPPER_RING`, and `CLIENT_BROKER_HMAC_KEY_RING`. Authenticated
responses reuse `CLIENT_BROKER_HMAC_KEY_RING`; they do not introduce a ninth
secret. During rotation, Functions may retain the explicitly named previous
broker key ID only for the bounded overlap. Hostinger must send and require the
same exact key ID on the response. Run both realm harnesses with the retained
and current IDs, prove each works only with its own realm/domain, prove a
production ID/signature never falls back to App Review, then remove the old ID.

## Signed Hostinger activation evidence

The release gate does not trust a typed `status: passed`. Before activation:

1. Generate two independent Ed25519 keypairs outside Git and outside
   `public_html`. Production uses
   `CABOHEALTH_CLIENT_RESOURCES_ATTESTATION_KEY`; App Review uses
   `CABOHEALTH_APP_REVIEW_ATTESTATION_KEY`. Each private key document is
   canonical JSON with exact keys `schemaVersion`, `algorithm`, and
   `secretKeyBase64`, directory mode `0700`, file mode `0600`. Never put a
   private key, signing-config bytes, or HMAC value in the trust policy,
   evidence, command line, screenshot, chat, or repository.
2. Create one canonical read-only trust-policy JSON containing the exact
   production Firebase project URL and the exact App Review project URL, their
   two distinct Ed25519 SPKI public keys, and, for each realm, the exact
   `runtimeIdentity.documentRoot` returned by the serving web runtime and its
   exact `runtimeIdentity.phpSapi` (`fpm-fcgi`, `apache2handler`, or the exact
   lowercase value `litespeed`; never `cli`, `cgi-fcgi`, or an alias). The
   `litespeed` value may be recorded only after a one-shot probe from the real
   serving runtime confirms it. Also pin `phpCliPath`, `phpCliSha256`,
   `phpCliSize`, `phpCliMode: "0755"`, `phpCliOwnerUid`, and the exact numeric
   `phpCliVersionId` for a real PHP 8.2+ CLI binary
   outside the docroot. [Hostinger documents the versioned CLI pattern](https://www.hostinger.com/support/5792082-how-to-solve-common-composer-issues-at-hostinger/)
   `/opt/alt/[php-version]/usr/bin/php`; discover and measure the actual binary
   for this account rather than hard-coding that example. Include the pinned attestor
   `tools/hosting/protected-overlay-attestor.php` with SHA-256
   `c509d78a0c4696f36ba86543b7236142e4c241b14990921b912b0c60cc336c68`.
   Obtain its SHA-256 independently and have Ivan approve/record that pin in
   the secured release record **outside** the activation/evidence capsule.
3. Run `protected-overlays:release create-activation` with the external
   `--trust-policy` and independently recorded `--trust-policy-sha256`. A URL
   is accepted only when it is exactly
   `https://us-central1-<approved-project>.cloudfunctions.net/brokerApi` (or
   the separately pinned `appReviewBrokerApi` URL), never merely because its
   hostname ends in `cloudfunctions.net` or `run.app`.
4. Run `create-evidence-request` for the exact artifact and activation pins.
   Copy that read-only request to Hostinger without editing it.
5. Have Hostinger create an authenticated, internal-only, one-shot mapping to
   the pinned attestor in the **same effective web PHP handler** that serves
   the protected endpoints: the measured PHP-FPM pool, Apache handler, or
   LiteSpeed LSAPI runtime. The mapping supplies
   `CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_REQUEST`,
   `CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_REALM`,
   `CABOHEALTH_PROTECTED_OVERLAY_PROJECT_ROOT`, and
   `CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_OUTPUT` as server configuration,
   never as request headers, query parameters, or body fields. Invoke it with
   an empty HTTPS `POST` and no query string, first for production and then for
   review, changing the server-side realm/output mapping between calls. The
   normal six factory/config/content environment variables and two key-path
   variables must be inherited from that same effective web runtime. Set
   `CABOHEALTH_PROTECTED_OVERLAY_PHP_CLI` there to the exact canonical
   `phpCliPath`; it must not come from the HTTP request.
6. The attestor obtains `PHP_SAPI` and `DOCUMENT_ROOT` from the executing web
   runtime, reads each configured path from real `getenv` values, opens every
   request/config/factory/key file before measuring it, compares descriptor
   identity and metadata before and after the bounded read, re-hashes private
   content, requires the pinned CLI's numeric `PHP_VERSION_ID` to equal the
   independently approved `phpCliVersionId`, and runs
   the harness through the still-open measured descriptor
   (`/proc/self/fd/3`), so a path swap cannot select different bytes. It never invokes the FPM/CGI
   `PHP_BINARY`. Both child processes receive only `LANG=C` and `LC_ALL=C`;
   they never inherit attestation-key, broker-HMAC, path, or server variables
   from the web process. Environment B for request A,
   `cli`, document-root drift, a decoy or swapped file, failed harness, wrong
   realm key, or missing Sodium/`proc_open` fails without an attestation. An
   SSH command such as `php ...` with manually exported values is only a
   negative test and can never satisfy the pinned web runtime identity.
7. Confirm both read-only attestation files were created outside the docroot,
   then immediately disable and remove the one-shot mapping and its server
   control variables. Keep the private Ed25519 keys outside the docroot; do
   not copy them back to the release machine.
8. Back on the controlled release machine, run `assemble-evidence` with the
   two read-only attestation files and the pinned trust policy. Record its
   `evidenceSha256` independently, then pass that exact evidence file and pin
   to `promote` and `verify-deployment`. Never derive the expected pin from the
   same capsule inside the promotion command.

Current external gate: **COMPLETED/VERIFIED 2026-08-24**. Hostinger proved the
exact LiteSpeed serving identity, document root, pinned PHP CLI, immutable
private inputs, both distinct signing realms, and both harnesses through signed
one-shot attestations. The authenticated mappings and credentials were removed
immediately and returned 404 afterward. The independently reassembled evidence
pin is `763bb35ce0a7b320aabc8e8bcbb7231d91d375e4b3161fce33c6ad319ade657d`.

## First-release deactivation to absence

When the managed state records the live protected release's predecessor as the
literal `absent`, use only `protected-overlays:release deactivate-first` with
the exact current release, inventory, artifact, activation, evidence, and trust
policy pins. The command rejects predecessor-release arguments: it is not a
general downgrade. Under the exclusive deployment lock it recovers any durable
journal, verifies the current activation and both live realms, records an
immutable private deactivation receipt, then durably replaces the private
`current-deactivation.json` authority with the exact current pins and receipt
digest before starting the rollback journal. It sets the committed managed
state to `null` and durably renames each live realm back into the existing
private `candidates/<releaseId>/` archive. It does not recursively delete either
realm.

After the command, run `protected-overlays:release verify-absence` with the
same current release, inventory, artifact, activation, and evidence pins. This
proves that both public targets are absent and that the exact archived bytes
remain available for a later promotion. It also requires the exact receipt to
be the current deactivation authority, so a historical receipt cannot be
replayed after the same release bytes are reactivated with new activation or
evidence pins. Retrying `deactivate-first` with the same pins is idempotent,
including after a lost response or process crash. A release whose recorded
predecessor is another release must use the separately pinned general rollback
path; `deactivate-first` fails closed in that state.

If any variable, file, permission, host, key, content release, response schema,
or PHP dependency is missing, the entry points return a sanitized 503 and no
protected content. An interface or example factory alone is not a functioning
deployment.
