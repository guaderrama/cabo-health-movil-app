# App Review consumers

Status: **NOT ACTIVE**. This tracer adds fail-closed iPhone and Hostinger
consumers for the isolated App Review realm. It does not deploy Functions or
Hostinger files, rotate a credential, change App Store metadata, or enable the
review surface.

## iPhone contract

The existing secure code field accepts exactly two 128-bit hexadecimal
credential families after presentation-only normalization:

- `CH-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX` selects the production client
  callables.
- `AR-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX` selects the App Review callables.

The submitted value is cleared before the request and is never written to
SecureStore, AsyncStorage, logs, a grant, or an opaque session. Firebase Auth
persists only its own realm-specific authenticated state. The locally persisted
installation identifier is not the credential.

Review uses only these exact callables:

- `redeemAppReviewCredential({ credential, installationId, requestId })`
- `refreshAppReviewAccess({ installationId })`
- `createAppReviewLaunch({ installationId })`

Redeem must return `{ customToken, grant }`, and the custom token must establish
a UID matching `review_[A-Za-z0-9_-]{32}`. The grant is accepted only with this
exact authority and fixed resource:

```text
scope: review_sandbox
purpose: app_review
status: active
expiresAtMs: null
resource: review-sandbox-app-review-sample-v1
```

The resource has the compiled bilingual title and summary defined by the
backend. A review UID, review grant, production UID, or production grant can
never be substituted across realms. Review removal signs out locally; the
production remove/delete callables are never invoked for review authority.

The current review identity becomes eligible for scheduled physical cleanup
after 30 days of inactivity. A successful redeem, refresh, native launch,
hosted launch redemption, or hosted-session introspection resets that boundary.
Rotation makes every stale credential generation eligible immediately. The
five-minute cleanup worker first denies the grant, then durably retries linked
record and Firebase Auth deletion; the 30-day boundary is an eligibility rule,
not a guarantee that an unavailable dependency will finish deletion at that
instant.

Review launch must return exactly
`{ launchUrl, method: 'POST', nonce, expiresAtMs }`, where `launchUrl` is
`https://cabohealth.org/apps/app-review/launch/`, `nonce` is 32 base64url
characters, and expiry is live and no more than two minutes away. The WebView
posts only `nonce=<urlencoded>` as
`application/x-www-form-urlencoded;charset=UTF-8`. Its main-frame navigation is
restricted to that exact HTTPS host and path with no credentials, port, query,
fragment, path extension, native bridge, or external-browser fallback.

## Hostinger contract

The fixed, non-clinical sample and its broker adapter are described in
`docs/operations/app-review-web-broker.md`. Hostinger uses the separate
`appReviewBrokerApi`, HMAC domain, private config, cookie, session, CSRF token,
and private content directory. It must not reuse the production client broker
or any production key material. The POST launch must render at the fixed launch
path; a redirect to another App Review path would be blocked by the iPhone
policy.

## Activation gates

1. Configure the dedicated Firebase client App ID, named review Firestore
   database, IAM/rules/TTL, and all `APP_REVIEW_*` secret rings in staging.
2. Deploy the reviewed backend and Hostinger overlay only through their
   separate release procedures; keep private config/content outside docroot
   with the permissions in the web-broker runbook.
3. Run the Functions App Review suite, native consumer suite, and PHP 8.2+
   harness. No skipped PHP harness is acceptable for release.
4. On two clean physical iPhones, redeem the same current AR credential,
   refresh both sessions, open the one fixed sample, and prove no production
   callable or resource is reached.
5. Rotate the credential while both native and web sessions are active. Old
   redeem, refresh, nonce, and web-session operations must all fail generically.
   Verify stale identities are physically removed, an injected Auth failure
   leaves a retryable deletion job, and the following scheduled retry completes
   without exposing an identifier.
6. Verify a production signature, UID, grant, cookie, session, nonce, or route
   cannot authorize review, and perform the reciprocal review-to-production
   checks.
7. Only after these gates pass may the one-time review credential be placed in
   App Store Connect. Never place it in source, a build setting, a screenshot,
   analytics, or this runbook.
