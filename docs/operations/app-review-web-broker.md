# App Review web broker

Status: **NOT ACTIVE**. This is source and test coverage for a separate App
Review web realm. It is not included in the reviewed 16-file public release,
and no deployment was performed as part of this change.

## Fixed boundary

- The only reviewer launch target is
  `https://cabohealth.org/apps/app-review/launch/`.
- Launch accepts only HTTPS `POST` with the exact form body `nonce=<32
  base64url characters>`, exact form media type, and no query string. A GET,
  extra form field, query parameter, or JavaScript/native bridge fails closed.
- The successful POST consumes the nonce, live-introspects the resulting review
  session, and renders the private sample with status 200 at that same exact
  `/apps/app-review/launch/` main-frame URL. It never redirects to the disabled
  `/apps/app-review/` directory page or depends on client-side navigation.
- The browser receives only the host-only, path-scoped
  `__Secure-cabohealth_app_review` cookie. It is independent of the production
  client cookie and uses `Secure`, `HttpOnly`, and `SameSite=Strict`.
- Every protected render live-introspects the session and requires exactly the
  fixed entitlement `review-sandbox-app-review-sample-v1`. Rotation invalidates
  that session for every later broker operation; already-rendered static,
  non-clinical HTML contains no continuing authority.
- The fixed bilingual, non-clinical sample lives under
  `app-review-private/content/`, outside the docroot. The public PHP/template
  files contain no sample section text.
- There is no PHI, personalization, upload, free text, analytics, local
  persistence, service worker, or native messaging bridge.

## Separate server-to-server contract

Hostinger must call only the exported `appReviewBrokerApi`, never `brokerApi`.
Its exact HTTPS base URL ends in `/appReviewBrokerApi`; redirects are disabled,
TLS peer and host verification are mandatory, response size is bounded, and
all schema or transport drift fails closed.

The three POST routes and bodies are:

- `/v1/launch/redeem`: `{"nonce":"..."}`
- `/v1/sessions/introspect`: `{"sessionId":"..."}`
- `/v1/sessions/revoke`: `{"sessionId":"...","csrfToken":"..."}`

The raw JSON body is signed with `X-CaboHealth-Key-Id`,
`X-CaboHealth-Timestamp`, `X-CaboHealth-Request-Id`, and
`X-CaboHealth-Signature`. The first canonical line is exactly:

```text
cabohealth-app-review-broker-v1
```

An HTTP 200 response is accepted only when Functions returns the same key ID
and request ID plus `X-CaboHealth-Response-Signature`. The response HMAC covers
these exact canonical bytes:

```text
cabohealth-app-review-broker-response-v1
200
<exact path>
<requestId>
<keyId>
<base64url SHA-256 of the exact raw response body>
```

The response domain is different from production. Missing, duplicated,
malformed, cross-realm, or body-mismatched response authentication fails
closed before JSON parsing.

The review signing key, cookie, session, CSRF token, base URL, environment
variables, and private config are all distinct from production. Generate a new
review key ring and never reuse production or staging key material. Canonical
realm separation remains required even when operators follow this rule.

## Private Hostinger installation gate

Do not publish or enable the paths until every step is green:

1. Deploy and freeze the matching backend `appReviewBrokerApi` only after its
   named review Firestore database, IAM, rules, TTL policies, and eight review
   secret rings have passed staging review.
2. Create the Hostinger signing JSON matching
   `app-review-private/config/broker-config.schema.json`. Store it outside the
   docroot in a directory with mode `0700` and a file with mode `0600`.
3. Copy `backend-factory.php.example` to a private, non-public path. Set
   `CABOHEALTH_APP_REVIEW_BACKEND_FACTORY` to that absolute file,
   `CABOHEALTH_APP_REVIEW_SIGNING_CONFIG` to the absolute `0600` JSON, and
   `CABOHEALTH_APP_REVIEW_PRIVATE_CONTENT_ROOT` to the private content
   directory. None may point into `public_html`.
4. Install the public `apps/app-review/` subtree as a separately reviewed
   Hostinger overlay. Do not add it to or mutate the pinned 16-file release.
5. Confirm PHP 8.2+ and cURL, then run
   `tools/hosting/tests/app-review-broker.php` in the private staging copy.
6. Verify GET/query/extra-field rejection, 60-second nonce expiry and replay,
   wrong cookie, wrong entitlement, wrong origin, wrong CSRF, live rotation,
   session expiry, cookie path, private-file denial, and sanitized errors.
7. With independently generated test keys, prove a production broker signature
   fails at the review broker and a review signature fails at production. Prove
   the same cross-realm rejection for successful response signatures.
8. Exercise the fixed sample on two clean physical iPhones, rotate while both a
   native and web session are active, and prove immediate denial before any
   reviewer credential is placed in App Store Connect.

The App Review Secret Manager inventory is exactly eight rings:
`APP_REVIEW_CREDENTIAL_PEPPER_RING`, `APP_REVIEW_INSTALLATION_PEPPER_RING`,
`APP_REVIEW_DELETION_RECEIPT_PEPPER_RING`,
`APP_REVIEW_RATE_LIMIT_PEPPER_RING`, `APP_REVIEW_LAUNCH_NONCE_PEPPER_RING`,
`APP_REVIEW_WEB_SESSION_PEPPER_RING`, `APP_REVIEW_WEB_CSRF_PEPPER_RING`, and
`APP_REVIEW_BROKER_HMAC_KEY_RING`. Successful response authentication reuses
`APP_REVIEW_BROKER_HMAC_KEY_RING`; it does not add a ninth secret. During a
bounded rotation overlap, Functions may accept only the explicitly named
retained and current review key IDs. Hostinger must require the exact response
key ID it sent. Both IDs must pass in the review response domain, a removed ID
must fail, and neither ID nor signature may fall back to the production ring or
domain.

## Signed Hostinger activation evidence

The web realm remains inactive until the shared protected-overlay gate has
real, externally pinned Hostinger evidence:

1. Generate distinct production and App Review Ed25519 keypairs outside Git
   and outside `public_html`. Keep the review private-key document at the path
   supplied only by `CABOHEALTH_APP_REVIEW_ATTESTATION_KEY`, under a `0700`
   directory with mode `0600`. Its canonical JSON has exact keys
   `schemaVersion`, `algorithm`, and `secretKeyBase64`. Never store either
   private key in the repository, trust policy, evidence, command line, or
   release capsule.
2. Create a canonical read-only trust policy with the two distinct public
   keys, exact production/review Firebase Function URLs, and each realm's exact
   serving `runtimeIdentity`: canonical `DOCUMENT_ROOT` plus `PHP_SAPI`
   (`fpm-fcgi` or `apache2handler`, never `cli`). Pin
   `tools/hosting/protected-overlay-attestor.php` at SHA-256
   `bfe8eb02df77d328b6698cd3eb9a14dee0653533c0b126b435870998b5adf8a9`.
   Compute and approve the trust-policy SHA outside the activation/evidence
   capsule, then pass that independent pin to `create-activation` and
   `create-evidence-request`.
3. Have Hostinger map the pinned attestor through an authenticated,
   internal-only, one-shot route in the **same PHP-FPM pool or Apache handler**
   as the protected endpoints. Server configuration—not request input—sets
   `CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_REQUEST`,
   `CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_REALM`,
   `CABOHEALTH_PROTECTED_OVERLAY_PROJECT_ROOT`, and
   `CABOHEALTH_PROTECTED_OVERLAY_ATTESTATION_OUTPUT`. Invoke an empty HTTPS
   `POST` with no query/body once per realm. Headers, query parameters, body
   fields, or manually exported SSH/CLI environment values are not evidence of
   the serving runtime.
4. The attestor derives `PHP_SAPI`, `DOCUMENT_ROOT`, and the real factory,
   config, content, and key paths from that effective web runtime. It performs
   bounded descriptor-bound reads, exact hashes, and the pinned PHP harness.
   `cli`, runtime drift, environment B for request A, a changed byte, wrong
   realm key, or failed harness produces no acceptable attestation. Store both
   one-shot outputs outside the docroot, then immediately disable/delete the
   route and server control variables.
5. On the controlled release machine, run `assemble-evidence`, independently
   record the resulting `evidenceSha256`, and supply that exact external pin to
   `promote` and `verify-deployment`. Do not derive the expected digest from
   the capsule being accepted.

Current external gate: **BLOCKED** until Hostinger proves the internal mapping,
exact effective `PHP_SAPI`/`DOCUMENT_ROOT`, and both realm attestations from the
serving pool. If that binding is unavailable, App Review activation remains
forbidden.

Missing variables, files, permissions, PHP/cURL, host mismatch, response drift,
or an unconfigured backend must return a generic unavailable/denied response.
The example factory and schema contain no secret and do not constitute an
active deployment.
