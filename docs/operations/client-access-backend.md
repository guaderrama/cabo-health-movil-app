# Client-access backend: security and activation runbook

Status: implemented and unit/integration tested in source, but **not deployed or
activated**. Deployment remains an explicit release gate.

## Implemented trust boundaries

- Production client codes use `CH-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`.
  The 32 hexadecimal digits contain 128 bits from Node's cryptographic random
  source. Only `adminCreateClientAccessCode` returns the complete code, once.
- Firestore stores a versioned HMAC lookup and four-character display suffix,
  never a complete code. Installations, rate-limit keys, launch nonces, web
  sessions, CSRF material, and broker replay IDs are also stored only as
  digests/HMAC lookups.
- Exactly four production slots exist (`1` through `4`). Create, list, and
  revoke reconcile expired slots transactionally. A fifth active code is
  rejected even when creates race.
- The scheduled deletion worker runs every five minutes and reconciles natural
  expiry before retrying cleanup. An expired redeemed code is revoked together
  with its grant, and its durable deletion tombstone is created in the same
  transaction; replacing that slot cannot bypass cleanup. An unredeemed expiry
  has no Auth identity or grant, so it creates no account-deletion job.
- A code has the fixed purpose `cabohealth_client`, fixed scope
  `production_client`, one installation binding, and only reviewed resource
  IDs. There is no master-code or caller-selected scope path.
- Redemption has an IP-only bucket (10 failures/15 minutes) plus an
  IP-and-installation bucket (5 failures/15 minutes), so rotating a caller-
  supplied installation ID cannot bypass the source limit. All invalid access
  cases are intentionally indistinguishable.
- Client grants contain bilingual presentation metadata only: resource ID,
  title, summary, icon key, access, status, and expiry. They contain no client
  name, code ID, installation ID, private URL, health data, or reusable web
  credential.
- Client refresh and launch re-check the live code, grant, installation
  binding, resource, and expiry. Remove verifies that same live binding, then
  atomically revokes access and creates the durable deletion job described
  below. Explicit account deletion instead verifies the retained installation
  binding, so an authenticated client can still request erasure after its code
  was revoked or expired. A launch nonce is
  one-use, valid for 60 seconds, and opens only the fixed CaboHealth POST URL.
- The web broker consumes the launch nonce into a one-hour-or-shorter hashed
  session. Every introspection re-checks the live production grant/code and
  exact entitlement. CSRF is exact, versioned HMAC material; revoke is
  one-session only.
- Firestore client rules are default-deny. Only the Admin SDK in Functions can
  access backend documents. Production source contains no application logging
  of codes, credentials, digests, IP addresses, grants, or identifiers.
- Explicit account deletion, client removal, and administrator revocation all
  create a durable `_private_account_deletions` tombstone and revoke the
  code/grant in one transaction. They then remove
  subject/code-linked launch nonces, web sessions, redemption requests, and the
  safely attributable installation rate-limit bucket before deleting Firebase
  Auth. Failures remain pending and a scheduled worker retries every five
  minutes. The tombstone, code, and grant are removed only after Auth and
  linked-data cleanup complete. Each scheduled subject is isolated: a
  Firestore/record failure cannot prevent the remaining valid jobs in that
  bounded batch from progressing. After processing valid jobs, any unexpected
  per-subject exception or malformed tombstone raises one aggregate operational
  error with counts only—never document IDs, Auth UIDs, or underlying error
  text.
- The staff catalog workflow is draft-only. It stores opaque-ID candidates in
  `_private_catalog_drafts` with bilingual title/summary, a reviewed icon key,
  `public|clients` access, and a normalized HTTPS candidate URL. Revision
  checks are transactional. There is deliberately no publish callable and no
  draft write can modify `_private_client_resources` or a signed catalog.
- App Review uses a separate synthetic `purpose: "app_review"` credential,
  `review_*` Firebase Auth subjects, seven independent HMAC key rings, an
  independently named Firestore database, and a separate HTTP broker signing
  realm. It never reads the production catalog or code repositories, never
  consumes one of the four production slots, and can grant only one fixed,
  compiled non-clinical sample. The credential can be used on multiple review
  installations and remains valid until an authorized staff member rotates it.
  A current App Review identity becomes eligible for scheduled physical cleanup
  after 30 days of inactivity; any identity from a stale credential generation
  is eligible immediately. Successful redeem, refresh, native launch, hosted
  launch redemption, and hosted-session introspection move the inactivity
  boundary forward.

The deliberate response exceptions are: a one-time production code or App
Review credential to the authorized administrator, a Firebase custom token
from the corresponding redemption endpoint, the short launch nonce to the
authenticated native client, and the opaque web session and CSRF token across
the corresponding authenticated server-to-server broker. No response contains
a premium target URL.

## Callable Functions v2 contracts

Every callable enforces a fresh, consumed Firebase App Check assertion and an
exact deployment-configured app ID. Client callables accept only the configured
iOS app; administrator callables accept only the configured staff web app.

| Callable | Request | Response |
| --- | --- | --- |
| `adminGetStaffSession` | `{}` | `{scope:'production', permissions:[...]}` |
| `adminListClientAccessCodes` | `{}` | slot, suffix, dates, status, and opaque code ID only |
| `adminCreateClientAccessCode` | `{slot, expiresAtMs, resourceIds}` | `{oneTimeCode, summary}` |
| `adminRevokeClientAccessCode` | `{codeId}` | `{revoked:true}` |
| `adminListCatalogDrafts` | `{}` | `{drafts:[...]}` (maximum 100, newest first) |
| `adminCreateCatalogDraft` | `{access,icon,summary,title,url}` | `{draft}` |
| `adminUpdateCatalogDraft` | `{draftId,revision,access,icon,summary,title,url}` | `{draft}` |
| `adminArchiveCatalogDraft` | `{draftId,revision}` | `{archived:true,draft}` |
| `adminListAudit` | `{}` | `{events:[...]}` (maximum 100, newest first) |
| `adminGetAppReviewCredentialStatus` | `{}` | `{configured,generation,rotatedAtMs,purpose:'app_review'}` |
| `adminRotateAppReviewCredential` | `{expectedGeneration:number\|null}` | `{oneTimeCredential,generation,rotatedAtMs,purpose:'app_review'}` |
| `redeemClientAccessCode` | `{code, installationId, requestId}` | `{customToken, grant}` |
| `refreshClientAccess` | `{installationId}` | `{grant}` |
| `removeClientAccess` | `{installationId}` | `{removed:true}` after revocation and deletion job are durable |
| `deleteClientAccount` | `{installationId}` | `{status:'pending'\|'completed'}` |
| `createClientLaunch` | `{installationId, resourceId}` | fixed HTTPS POST URL, nonce, expiry |
| `redeemAppReviewCredential` | `{credential,installationId,requestId}` | `{customToken,grant}` in the review realm only |
| `refreshAppReviewAccess` | `{installationId}` | `{grant}` for the authenticated `review_*` subject |
| `createAppReviewLaunch` | `{installationId}` | fixed review HTTPS POST URL, nonce, expiry |

Admin operations additionally require all of the following server-side:

1. Firebase Auth with `catalogAdmin: true`.
2. An exact TOTP second-factor claim (`sign_in_second_factor: "totp"`).
3. `auth_time` no older than 15 minutes.
4. An active `_private_admins/{uid}` document with `scope: "production"`.
5. The exact permission (`client_codes`, `client_resource_drafts`, or
   `app_review_credential`).

Claims alone never authorize an administrator. A review-sandbox admin document
cannot operate on production.

Draft input is exact: icons are `laboratory`, `guide`, `nutrition`, `recipes`,
`wellness`, `location`, `contact`, or `featured`; localized objects contain
only `en` and `es-MX`, with non-empty values of at most 120 characters. URLs
must be HTTPS and cannot contain credentials, a custom port, query, fragment,
control characters, whitespace, or a backslash. Draft creation/update/archive
write only a sanitized 30-day audit event. The staff audit response exposes
only successful `client_code.created`, `client_code.revoked`, `draft.created`,
`draft.updated`, and `draft.archived` actions, the label `Staff`, an opaque
event ID, a short target suffix, and occurrence time. It never exposes a draft
URL, full access code, Auth UID, or client data.

`removeClientAccess` closes the current pseudonymous client identity: it returns
`{removed:true}` only after access is revoked and cleanup is durably queued,
even if Firebase Auth or Firestore cleanup must finish in the scheduled worker.
The native app may then clear its session. A later valid code creates a new
client identity; removal does not preserve the prior account or grant.

`deleteClientAccount` returns `pending` whenever Auth deletion, bounded artifact
cleanup, or finalization has not durably completed. It never reports completion
merely because authorization was revoked. While pending, all native and web
authorization is already denied and the scheduled worker retries idempotently;
an authenticated explicit-delete caller may also retry. `completed` means Auth is deleted (or
was already absent), linked subject/code records are removed, and the tombstone
is finalized. IP-only rate-limit and broker replay records are deliberately not
treated as account data because they cannot be safely attributed to one client;
they contain no subject/code and remain only until their short TTL. Sanitized
audit event bodies omit Auth UID, installation ID, code plaintext, and health
data, but may retain an opaque code ID; deletion event document names use a
one-way subject-derived suffix. All expire after 30 days.

## Isolated App Review credential contract

The review credential format is
`AR-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`; every `X` is an uppercase hexadecimal
digit and the 32 digits contain 128 bits of cryptographic entropy. Input may be
normalized for case, spaces, and common dash characters, but Firestore stores
only a versioned HMAC lookup. The complete credential is returned only once by
`adminRotateAppReviewCredential`. It has no expiry date; rotation is its
revocation mechanism and immediately invalidates every prior review grant,
launch nonce, and web session through a live generation check.

The status/rotation portal contracts are exact:

```json
{"configured":true,"generation":3,"purpose":"app_review","rotatedAtMs":1800000000000}
```

```json
{
  "oneTimeCredential":"AR-...",
  "generation":4,
  "purpose":"app_review",
  "rotatedAtMs":1800000000000
}
```

Rotation is optimistic concurrency: the portal must first read status and send
that exact `generation` as `expectedGeneration`; it sends `null` only for the
first generation. A mismatch is `aborted/app_review_generation_conflict` and
must cause a status refresh. The portal must never persist, log, cache, or show
the returned credential again after the operator leaves the one-time result.

`redeemAppReviewCredential` accepts the review credential on any number of
review devices. After signing in with its returned Firebase `customToken`, the
Auth UID is always `review_` plus 32 base64url characters and the token has the
exact claim `authority: "app_review"`. Production client callables accept only
`client_*`; review refresh/launch callables accept only this review UID and
claim. The native app stores only Firebase Auth state after redemption, never
the review credential.

The review grant is a discriminated, UI-compatible grant with no expiry:

```json
{
  "schemaVersion": 1,
  "status": "active",
  "scope": "review_sandbox",
  "purpose": "app_review",
  "credentialGeneration": 4,
  "expiresAtMs": null,
  "resources": [{
    "id": "review-sandbox-app-review-sample-v1",
    "access": "client",
    "iconKey": "featured",
    "title": {
      "en": "App Review Sample",
      "es": "Muestra para App Review"
    },
    "summary": {
      "en": "A fixed, non-clinical sample prepared only for App Review.",
      "es": "Una muestra fija y no clínica preparada sólo para App Review."
    }
  }]
}
```

Neither redeem nor launch accepts a resource ID, URL, scope, purpose, or
entitlement from the caller. `createAppReviewLaunch({installationId})` returns
exactly `{launchUrl,method:'POST',nonce,expiresAtMs}`. `launchUrl` is fixed to
`https://cabohealth.org/apps/app-review/launch/`, `method` is `POST`, and the
nonce is one-use with a 60-second lifetime. The iOS WebView posts exactly
`nonce=<URL-encoded nonce>` using
`application/x-www-form-urlencoded;charset=UTF-8`.

## Server-to-server broker API

The exported HTTP function is `brokerApi`. It accepts `POST` with exact
`application/json` bodies only:

- `/v1/launch/redeem`: `{ "nonce": "..." }` ->
  `{ "sessionId": "...", "expiresAtMs": 0 }`
- `/v1/sessions/introspect`: `{ "sessionId": "..." }` ->
  `{ "active": true, "expiresAtMs": 0, "entitlements": ["resource-id"], "csrfToken": "..." }`
- `/v1/sessions/revoke`: `{ "sessionId": "...", "csrfToken": "..." }` ->
  `{ "revoked": true }`

Every failure is `403 {"error":"invalid_access"}`. Requests need these
headers:

- `X-CaboHealth-Key-Id`
- `X-CaboHealth-Timestamp` (Unix seconds, maximum 60-second skew)
- `X-CaboHealth-Request-Id` (UUID v4, replay-protected)
- `X-CaboHealth-Signature` (unpadded base64url HMAC-SHA256)

The exact signature input is:

```text
cabohealth-broker-v1
POST
<exact /v1 path>
<timestamp>
<request UUID>
<base64url SHA-256 of the exact raw JSON bytes>
```

The shared broker key exists only on the CaboHealth web host and in Secret
Manager. The PHP adapter must fail closed if the broker is unavailable; it must
never receive a Firebase custom token or discover a premium target URL.

The native launch target is fixed to
`https://cabohealth.org/apps/client-resources/launch/` and uses
`application/x-www-form-urlencoded;charset=UTF-8` with exactly
`nonce=<URL-encoded nonce>`.

The App Review web path uses the separate exported HTTP function
`appReviewBrokerApi`. Its three JSON routes and response schemas are identical
to `brokerApi`, but its key ring, replay documents, nonce/session documents,
and signature domain are separate. Its exact canonical first line is:

```text
cabohealth-app-review-broker-v1
```

A production-broker signature is invalid at the review broker and vice versa,
even if an operator accidentally provisions identical raw key bytes. The
review `/v1/sessions/introspect` response can contain only the fixed entitlement
`review-sandbox-app-review-sample-v1`. Hostinger must configure a distinct
fail-closed adapter/base URL for `appReviewBrokerApi`; it must not route review
requests through the production broker adapter.

## Secret Manager parameters

- `CLIENT_CODE_PEPPER_RING`
- `CLIENT_INSTALLATION_PEPPER_RING`
- `CLIENT_RATE_LIMIT_PEPPER_RING`
- `CLIENT_LAUNCH_NONCE_PEPPER_RING`
- `CLIENT_WEB_SESSION_PEPPER_RING`
- `CLIENT_WEB_CSRF_PEPPER_RING`
- `CLIENT_BROKER_HMAC_KEY_RING`

The review realm requires seven additional, independently generated rings:

- `APP_REVIEW_CREDENTIAL_PEPPER_RING`
- `APP_REVIEW_INSTALLATION_PEPPER_RING`
- `APP_REVIEW_RATE_LIMIT_PEPPER_RING`
- `APP_REVIEW_LAUNCH_NONCE_PEPPER_RING`
- `APP_REVIEW_WEB_SESSION_PEPPER_RING`
- `APP_REVIEW_WEB_CSRF_PEPPER_RING`
- `APP_REVIEW_BROKER_HMAC_KEY_RING`

Each secret is an independently generated JSON key ring:

```json
{
  "currentVersion": "YYYY-MM",
  "keys": {
    "YYYY-MM": "BASE64_OF_32_OR_MORE_RANDOM_BYTES"
  }
}
```

A ring may contain the current version plus at most two prior versions. Never
place values in source control, shell history, screenshots, support messages,
build logs, or App Review notes.

Two non-secret deployment parameters are also mandatory and must be exact
Firebase App IDs, not project IDs or bundle IDs:

- `CLIENT_IOS_FIREBASE_APP_ID` (`1:...:ios:...`)
- `STAFF_WEB_FIREBASE_APP_ID` (`1:...:web:...`)

`APP_REVIEW_FIRESTORE_DATABASE_ID` is also mandatory. It must be an
independently provisioned named Firestore database whose verified ID begins
with `cabohealth-review-`; `(default)` is rejected by source validation. The
committed `firestore.review.rules` and `firestore.review.indexes.json` belong
only to that named database. They must never replace the production/default
database configuration.

The committed `.firebaserc` intentionally has no `default` project and contains
only unconfigured `cabohealth-staging` and `cabohealth-prod` aliases. Replace
each placeholder with the independently verified project ID before deployment,
then always pass `--project cabohealth-staging` or
`--project cabohealth-prod`. The legacy project must never be restored as a
default. `firestore.indexes.json` has no composite indexes or legacy catalog
entries; it contains only the explicit TTL field overrides below.

## Firestore activation requirements

Seed only reviewed `_private_client_resources/{resourceId}` documents:

```json
{
  "schemaVersion": 1,
  "status": "active",
  "access": "client",
  "id": "resource-id",
  "iconKey": "approved-icon",
  "title": { "en": "...", "es": "..." },
  "summary": { "en": "...", "es": "..." }
}
```

No URL belongs in this document. The reviewed CaboHealth web release maps the
entitlement ID to bundled/server-controlled content.

The committed Firestore configuration enables TTL on `expiresAtMs` for:

- `_private_audit_events` (30-day sanitized retention)
- `_private_rate_limits`
- `_private_redemption_requests`
- `_private_launch_nonces`
- `_private_web_sessions`
- `_private_broker_requests`

Expiry is already enforced in transactions; TTL is retention cleanup, not an
authorization mechanism.

The review database has a separate default-deny rules file and TTL overrides
for `review_sandbox_rate_limits`, `review_sandbox_redemption_requests`,
`review_sandbox_launch_nonces`, `review_sandbox_web_sessions`, and
`review_sandbox_broker_requests`. Live-generation and active-grant validation,
not asynchronous TTL deletion, revoke review authority. The separate
`cleanupAppReviewData` worker runs every five minutes. It marks a current grant
removed after 30 days of inactivity, or a stale credential generation
immediately, and creates a durable `review_sandbox_account_deletions` job. Each
bounded job removes linked review records, deletes its Firebase Auth user, and
then removes the grant (including its installation digest) and job. A failure
remains pending for the next run every five minutes; one subject cannot block
the rest of the batch, and aggregate errors contain counts only. Review grants
and deletion jobs deliberately have no Firestore TTL because they are cleanup
authority and must not disappear before Auth deletion completes.

Account deletion actively removes linked launch, web-session, redemption, and
safely attributable installation-rate records before returning `completed`.
The residual non-account records are bounded by TTL: broker requests two
minutes and IP-only rate-limit records thirty minutes. Sanitized audit events
have a 30-day expiry. Firestore TTL deletion is asynchronous, so staging must
verify that every field override is active; authorization never depends on TTL.

## Release gates still open

Do not call this Apple-ready or production-ready until all are complete:

1. Create separate staging and production Firebase projects and explicit CLI
   aliases; provision the seven independent secrets without exposing values.
2. Enable App Check with App Attest for the production iOS bundle and verify
   consumed-token replay behavior on a physical iPhone.
3. Bootstrap the owner Auth account, MFA, custom claim, and active private
   admin document through a separately controlled process.
4. Deploy rules, TTL field overrides, and Functions to staging; seed the signed
   fixed catalog and run Firebase Emulator and concurrency/failure tests.
5. Integrate and test the native adapter, staff portal, and PHP broker adapter
   end-to-end; verify remove/delete/revoke during active native and web sessions.
6. Exercise the durable deletion worker with injected Auth/Firestore failures
   and malformed tombstones in staging; verify the sanitized aggregate alert,
   deployed TTL status, and that the native UI treats `pending` as pending
   rather than as completed erasure.
7. Provision and verify the source-implemented App Review realm: the named
   Firestore database, its default-deny rules/TTL policy, least-privilege
   runtime identity, seven separate key rings, fixed Hostinger sample, portal
   status/rotation adapter, and native redeem/refresh/launch adapter. Run
   cross-realm and rotation tests end-to-end; exercise stale-generation,
   30-day-inactivity, Auth-failure, and retry cleanup paths. Do not issue the
   credential until all of those checks pass.
8. Wire the staff portal adapters to the five documented draft/audit callables
   and verify optimistic-conflict/error handling in staging. Draft publication
   remains an intentionally separate, reviewed release process; do not add a
   generic publish endpoint.
9. Resolve or formally accept the current npm-audit residual: seven moderate
   `uuid` advisories arrive transitively through the latest pinned Firebase
   Admin/Functions packages. `npm audit` offers only a breaking downgrade;
   there are no high or critical findings in this package audit.

No Firebase, Hostinger, or Apple deployment was performed while implementing
this backend slice.
