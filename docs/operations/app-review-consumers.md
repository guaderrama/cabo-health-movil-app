# App Review consumers

Status: **BACKEND AND HOSTINGER OVERLAY ACTIVE / CREDENTIAL INACTIVE**. The
isolated App Review consumers are deployed and fail closed. The public overlay,
separate Functions realm, private Hostinger configuration, and invalid-nonce
boundary were verified on 2026-08-24. No App Review credential has been issued,
the review database remains empty, and valid-credential/two-iPhone QA is still
blocked.

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

The deletion receipt is a different secret. Before requesting deletion, the app
generates 256 random bits, encodes them as exactly 43 unpadded base64url
characters, and stores that raw value only in iOS SecureStore. It must never be
placed in AsyncStorage, logs, analytics, a grant, Firebase Auth claims, or any
server document.

Review uses only these five exact callables:

- `redeemAppReviewCredential({ credential, installationId, requestId })`
- `refreshAppReviewAccess({ installationId })`
- `deleteAppReviewAccount({installationId,deletionReceipt})`
- `getAppReviewAccountDeletionStatus({deletionReceipt})`
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
never be substituted across realms. The review UI hides production removal,
shows the separate **Delete review access and data** action, and calls only
`deleteAppReviewAccount({installationId,deletionReceipt})`. The receipt must
already be durable in SecureStore in a prepared state before this exact request
is sent. The callable marks the review grant removed and creates or reuses its
durable review-deletion job and receipt status atomically before returning. A
pre-acceptance or ambiguous failure keeps the prepared receipt and, while the
authenticated installation still exists, re-submits only the same idempotent
receipt. The resource UI remains locked throughout uncertainty; a missing
status never discards the receipt or restores the previous grant. After
acceptance, the native app marks the same receipt accepted before clearing the
installation identifier and Firebase session;
production remove/delete callables are never invoked for review authority.

The delete response and every successful
`getAppReviewAccountDeletionStatus({deletionReceipt})` response contain
exactly these five fields and no others:

```text
{
  schemaVersion: 1,
  status: 'pending' | 'completed',
  requestedAtMs: <integer>,
  expectedCompletionByMs: <integer>,
  completedAtMs: <integer> | null
}
```

For `pending`, `completedAtMs` is exactly `null`, and
`expectedCompletionByMs` is exactly 30 days after `requestedAtMs`. That date is
an expectation, not a guarantee of physical completion. The status callable
accepts only `{deletionReceipt}`; it reads or requires no Firebase
Authentication state or UID. It still requires a fresh limited-use App Check
assertion, consumes that token, and accepts only the exact configured
`CLIENT_IOS_FIREBASE_APP_ID`.

The raw receipt remains only in SecureStore. The review backend stores only a
versioned keyed-HMAC lookup in
`review_sandbox_account_deletion_receipts`, using the separate
`APP_REVIEW_DELETION_RECEIPT_PEPPER_RING`; neither a production receipt nor the
production receipt pepper ring can resolve review status. A pending status has
no `expiresAtMs` and no TTL, including after its expected-completion date. On
completion, the record retains only schema/status timestamps and receives
`expiresAtMs = completedAtMs + 30 days`, stored as a native Firestore
`Timestamp`. Status expires logically at the exact boundary
`nowMs >= completedAtMs + 30 days`, regardless of asynchronous physical TTL
lag.

Whenever Client Resources is reopened with an accepted receipt, the app polls
status without restoring review authority. It shows the expected date while
pending, offers Support if the date is overdue, and shows completion
confirmation when completed. It clears the SecureStore receipt only after that
confirmation is acknowledged. A malformed, unknown, cross-realm, or logically
expired receipt yields the same generic missing status; a missing accepted
receipt never restores access.

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
   database, IAM/rules/TTL, and all eight `APP_REVIEW_*` secret rings in
   staging, including `APP_REVIEW_DELETION_RECEIPT_PEPPER_RING`. Inspect and
   migrate every historical numeric `expiresAtMs` value to a native Firestore
   `Timestamp` (or remove it under the approved retention procedure) before TTL
   activation, then verify no numeric TTL deadlines remain.
2. Deploy the reviewed backend and Hostinger overlay only through their
   separate release procedures; keep private config/content outside docroot
   with the permissions in the web-broker runbook.
3. Run the Functions App Review suite for all five review callables, the native
   consumer suite, and the PHP 8.2+ harness. No skipped PHP harness is
   acceptable for release. Prove the deletion-status callable works without
   Firebase Auth but rejects a missing, wrong-app, or reused limited-use App
   Check token.
4. On two clean physical iPhones, redeem the same current AR credential,
   refresh both sessions, open the one fixed sample, then delete and poll status
   with a 256-bit SecureStore receipt. Prove no production callable, receipt
   ring, or resource is reached.
5. Rotate the credential while both native and web sessions are active. Old
   redeem, refresh, nonce, and web-session operations must all fail generically.
   Verify stale identities are physically removed, an injected Auth failure
   leaves a retryable deletion job, and the following scheduled retry completes
   without exposing an identifier.
6. Verify a production signature, UID, grant, cookie, session, nonce, or route
   cannot authorize review, and perform the reciprocal review-to-production
   checks. Also prove production receipts cannot resolve review status and
   review receipts cannot resolve production status.
7. Verify pending receipt records have no TTL, completed receipt deadlines are
   native Firestore `Timestamp` values exactly 30 days after completion, status
   stops resolving at that exact logical boundary, and accepted missing status
   never restores access.
8. Only after these gates pass may the one-time review credential be placed in
   App Store Connect. Never place it in source, a build setting, a screenshot,
   analytics, or this runbook.
