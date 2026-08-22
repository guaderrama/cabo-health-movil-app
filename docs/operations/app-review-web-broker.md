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
   named review Firestore database, IAM, rules, TTL policies, and seven review
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

Missing variables, files, permissions, PHP/cURL, host mismatch, response drift,
or an unconfigured backend must return a generic unavailable/denied response.
The example factory and schema contain no secret and do not constitute an
active deployment.
