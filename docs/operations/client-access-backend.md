# Client-access backend: security and activation runbook

Status: implemented and unit/integration tested. The two Firestore rulesets,
indexes, all 13 TTL policies, 16 independent secret rings, the 26-Function
backend, the initial owner bootstrap, and the password-only Staff Portal are
deployed with the verified dedicated runtime identity. On 2026-08-24 the
temporary schema bridge, exact one-field migration, and final strict reader
promotion completed; all 26 Functions and Cloud Run services were re-read as
healthy and the exact writer policies and scheduler were restored.
**The owner's strong-password
reset, exact legacy-factor removal, refresh-token revocation, and sanitized
account read-back are complete. The fresh personal password-only live-portal
E2E also completed without an MFA challenge; the authenticated workspace loaded
and `adminGetStaffSession` returned HTTP 200.** The protected production/App
Review Hostinger overlay is active and hosting-boundary verified.
Physical-iPhone App Check, issuance and controlled rotation of the App Review
credential, valid-credential/nonce/replay/revocation and reciprocal cross-realm
E2E, TestFlight, and the exact release candidate remain separate release gates.
The additive external-HTTPS Functions contracts described below are implemented
and locally verified in source; this document does not claim they have been
deployed. The earlier 26-Function statement above remains historical deployment
evidence, not the current source inventory.

## External HTTPS source contract

The protected administrative catalog remains `_private_catalog/current`
schema version 1. Access codes, stored grants, and
`_private_client_resources/<id>` projections also retain their existing schema
version 1 and contain no destination URL. An external URL exists durably only
in protected catalog authority. New catalog mutation receipts use exact schema
version 2 and omit the URL; their replay re-reads and validates catalog
authority in the same transaction. Sanitized audits contain action, opaque
target identity, time, and retention data, never the destination URL.

Internal CaboHealth IDs retain their canonical URL slug. External entries use
exactly `external-[0-9a-f]{32}`, derived by Functions from the lowercase
UUID-v4 create request ID with domain-separated SHA-256 namespace
`cabohealth/catalog-external-id/v1` plus one NUL byte. The ID is not derived
from the URL, and the URL is immutable after creation.

The version/realm matrix is exact:

| Surface | Version/realm | External behavior |
| --- | --- | --- |
| `getPublishedCatalog` | legacy catalog V1 | external Public items omitted |
| `getPublishedCatalogV2` | legacy catalog V2 | external Public items and VIP previews omitted |
| `getPublishedCatalogV3` | catalog V3 | discriminated Public destinations; all VIP previews URL-free |
| `redeemClientAccessCode`, `refreshClientAccess`, `createClientLaunch` | production V1 / `legacy_cabohealth` | external resources omitted/rejected |
| `redeemClientAccessCodeV2`, `refreshClientAccessV2` | production schema V2 / `v2_all` | URL-free grants may authorize external resource IDs |
| `createClientLaunchV2` | production V2 / `v2_all` | exact broker/external union after live transactional authorization |
| App Review redeem/refresh/launch | `review_sandbox`, schema V1 | fixed review resource only; external launch forbidden |

`createClientLaunchV2` accepts exactly `{installationId,resourceId}`. A caller
cannot provide `targetUrl`. Its response is exactly either:

```text
{kind:'broker',expiresAtMs,launchUrl:'https://cabohealth.org/apps/client-resources/launch/',method:'POST',nonce}
{kind:'external_https',expiresAtMs,url}
```

The broker branch preserves the existing POST nonce flow. The external branch
creates no nonce or hosted session and returns the canonical URL only after one
transaction revalidates the subject, installation, grant, bound code, both
expiries, requested resource, complete active catalog/projection set, and
destination identity. Its expiry is `min(now + 60 seconds, grant expiry, code
expiry)`. Every invalid, revoked, replaced, expired, deactivated, mismatched,
or wrong-installation case fails without returning the URL.

The production native schema-V2 parser has one narrow compatibility exception
for the migrated `client-resources` grant view. Only the full tuple is accepted:
ID `client-resources`, access `client`, native icon `sparkles-outline`, English
title `Client Resources`, Spanish title `Recursos para clientes`, English
summary `Complimentary educational resources for eligible existing CaboHealth
clients.`, and Spanish summary `Recursos educativos incluidos para clientes
actuales elegibles de CaboHealth.` The parser substitutes the already-approved
neutral summary only while validating this exact tuple, then returns the
authoritative legacy copy unchanged. Changed IDs, icons, copy, URL/credential
text, generic “free” wording, and commercial wording do not receive the
exception. App Review remains on its separate exact parser.

VIP gating authorizes CaboHealth's in-app entry point only. It does **not** make
a third-party website private; anyone who independently knows its URL may open
it elsewhere.

## Implemented trust boundaries

- Production client codes use `CH-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`.
  The 32 hexadecimal digits contain 128 bits from Node's cryptographic random
  source. Only `adminCreateClientAccessCode` returns the complete code, once.
- Firestore stores a versioned HMAC lookup and four-character display suffix,
  never a complete code. Installations, rate-limit keys, launch nonces, web
  sessions, CSRF material, and broker replay IDs are also stored only as
  digests/HMAC lookups.
- The owner can create a separate production code for every existing client he
  chooses to authorize. There is no fixed commercial code count, numeric slot
  ledger, or shared master code. Creation remains transactionally collision-safe,
  and listing exposes only currently active summaries.
- The scheduled deletion worker runs every five minutes and reconciles natural
  expiry before retrying cleanup. An expired redeemed code is revoked together
  with its grant, and its durable deletion tombstone is created in the same
  transaction; issuing another independent code cannot bypass cleanup. An unredeemed expiry
  has no Auth identity or grant, so it creates no account-deletion job.
- A code has the fixed purpose `cabohealth_client`, fixed scope
  `production_client`, one installation binding, and only reviewed resource
  IDs. There is no master-code or caller-selected scope path.
- Redemption has an IP-only bucket (10 failures/15 minutes) plus an
  IP-and-installation bucket (5 failures/15 minutes), so rotating a caller-
  supplied installation ID cannot bypass the source limit. All invalid access
  cases are intentionally indistinguishable.
- Client grants contain bilingual presentation metadata only: resource ID,
  title, summary, icon key, access, status, and expiry. Both production grant
  versions contain no client name, code ID, installation ID, destination URL,
  health data, or reusable web credential.
- Client refresh and launch re-check the live code, grant, installation
  binding, resource, and expiry. Remove verifies that same live binding, then
  atomically revokes access and creates the durable deletion job described
  below. Explicit account deletion instead verifies the retained installation
  binding, so an authenticated client can still request erasure after its code
  was revoked or expired. The legacy/broker launch nonce is one-use, valid for
  60 seconds, and opens only the fixed CaboHealth POST URL. A V2 external
  launch has no nonce and exposes its URL only in the transient authorized
  response bounded by the earliest live expiry.
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
- Before either user-initiated deletion callable is invoked, the native app
  generates a raw 256-bit deletion receipt, encodes it as exactly 43 unpadded
  base64url characters, and persists it only in iOS SecureStore. The exact
  production and review requests are respectively
  `deleteClientAccount({installationId,deletionReceipt})` and
  `deleteAppReviewAccount({installationId,deletionReceipt})`. The backend never
  stores the raw receipt: separate production and review Firestore collections
  are addressed only by separate versioned keyed-HMAC lookups derived with
  separate receipt pepper rings.
- The staff draft workflow remains non-publishing. It stores opaque-ID candidates in
  `_private_catalog_drafts` with bilingual title/summary, a reviewed icon key,
  `public|clients` access, and a normalized HTTPS candidate URL. Revision
  checks are transactional. No draft write can modify
  `_private_client_resources` or the live catalog. Separately, the authorized
  **Miniapps** workspace uses exact live-catalog CRUD callables and the
  `client_resource_publish` permission; those mutations atomically maintain
  the catalog and matching projections.
- App Review uses a separate synthetic `purpose: "app_review"` credential,
  `review_*` Firebase Auth subjects, eight independent HMAC key rings, an
  independently named Firestore database, and a separate HTTP broker signing
  realm. It never reads the production catalog or code repositories, never
  consumes a production-client code and can grant only one fixed,
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
the corresponding authenticated server-to-server broker. In addition, only a
successful production `createClientLaunchV2` external branch transiently
returns the server-resolved canonical destination URL. Catalog previews,
grants, receipts, audits, errors, and all App Review responses remain URL-free.

## Callable Functions v2 contracts

The current source callable surface contains 16 staff-web callables and 17 iOS
client callables. Every callable enforces a fresh, consumed limited-use Firebase
App Check assertion and an exact deployment-configured app ID. Client callables
accept only the exact `CLIENT_IOS_FIREBASE_APP_ID`; administrator callables
accept only the exact `STAFF_WEB_FIREBASE_APP_ID`.

The two receipt-status callables deliberately do not read or require Firebase
Authentication, because the account may already be gone. They accept no UID or
installation identifier, but they still consume the limited-use App Check token
and require the exact configured iOS Firebase App ID.

| Callable | Request | Response |
| --- | --- | --- |
| `adminGetStaffSession` | `{}` | `{scope:'production', permissions:[...]}` |
| `adminListClientAccessCodes` | `{}` | active suffix, dates, status, and opaque code ID only |
| `adminCreateClientAccessCode` | `{expiresAtMs, resourceIds}` | `{oneTimeCode, summary}` |
| `adminRevokeClientAccessCode` | `{codeId}` | `{revoked:true}` |
| `adminListCatalogDrafts` | `{}` | `{drafts:[...]}` (maximum 100, newest first) |
| `adminCreateCatalogDraft` | `{access,icon,summary,title,url}` | `{draft}` |
| `adminUpdateCatalogDraft` | `{draftId,revision,access,icon,summary,title,url}` | `{draft}` |
| `adminArchiveCatalogDraft` | `{draftId,revision}` | `{archived:true,draft}` |
| `adminListCatalogItems` | `{}` | `{items:[...]}` exact protected owner views |
| `adminCreateCatalogItem` | `{requestId,item}` | `{item}`; Functions assigns external ID |
| `adminUpdateCatalogItem` | `{id,revision,requestId,item}` | `{item}`; URL is immutable |
| `adminSetCatalogItemActive` | `{id,revision,requestId,active}` | `{item}` |
| `adminDeleteCatalogItem` | `{id,revision,requestId}` | `{deleted:true,id}` |
| `adminListAudit` | `{}` | `{events:[...]}` (maximum 100, newest first) |
| `adminGetAppReviewCredentialStatus` | `{}` | `{configured,generation,rotatedAtMs,purpose:'app_review'}` |
| `adminRotateAppReviewCredential` | `{expectedGeneration:number\|null}` | `{oneTimeCredential,generation,rotatedAtMs,purpose:'app_review'}` |
| `getPublishedCatalog` | `{}` | legacy V1 active internal Public items only |
| `getPublishedCatalogV2` | `{}` | legacy V2 internal Public items plus URL-free internal VIP previews |
| `getPublishedCatalogV3` | `{}` | exact schema 3 discriminated Public items plus URL-free VIP previews |
| `redeemClientAccessCode` | `{code, installationId, requestId}` | `{customToken, grant}` |
| `redeemClientAccessCodeV2` | `{code, installationId, requestId}` | `{customToken, grant}` with URL-free schema-version-2 production grant |
| `refreshClientAccess` | `{installationId}` | `{grant}` |
| `refreshClientAccessV2` | `{installationId}` | `{grant}` with URL-free schema-version-2 production grant |
| `removeClientAccess` | `{installationId}` | `{removed:true}` after revocation and deletion job are durable |
| `deleteClientAccount` | `{installationId,deletionReceipt}` | exact five-field deletion status below |
| `getClientAccountDeletionStatus` | `{deletionReceipt}` | exact five-field deletion status below; no Firebase Auth required |
| `createClientLaunch` | `{installationId, resourceId}` | fixed HTTPS POST URL, nonce, expiry |
| `createClientLaunchV2` | `{installationId,resourceId}` | exact broker/external launch union; no caller URL |
| `redeemAppReviewCredential` | `{credential,installationId,requestId}` | `{customToken,grant}` in the review realm only |
| `refreshAppReviewAccess` | `{installationId}` | `{grant}` for the authenticated `review_*` subject |
| `deleteAppReviewAccount` | `{installationId,deletionReceipt}` | exact five-field deletion status below after a durable review deletion job is accepted |
| `getAppReviewAccountDeletionStatus` | `{deletionReceipt}` | exact five-field deletion status below; no Firebase Auth required |
| `createAppReviewLaunch` | `{installationId}` | fixed review HTTPS POST URL, nonce, expiry |

Both delete callables and both status callables return exactly these five fields
and no others:

```text
{
  schemaVersion: 1,
  status: 'pending' | 'completed',
  requestedAtMs: <integer>,
  expectedCompletionByMs: <integer>,
  completedAtMs: <integer> | null
}
```

For `pending`, `completedAtMs` is exactly `null`. All other timestamps are
integer epoch milliseconds; `expectedCompletionByMs` is exactly
`requestedAtMs + 30 days`. It is an operational expectation, not a guarantee
that physical deletion will complete by that instant.

Admin operations additionally require all of the following server-side:

1. A consumed limited-use App Check token from the exact configured staff web
   App ID.
2. Firebase Auth with `email_verified: true` and
   `firebase.sign_in_provider: "password"`.
3. `auth_time` no older than 15 minutes.
4. The custom claim `catalogAdmin: true`.
5. An exact active `_private_admins/{uid}` document with `schemaVersion: 1`,
   `scope: "production"`, and the exact permission (`client_codes`,
   `client_resource_drafts`, or
   `app_review_credential`).

Claims alone never authorize an administrator. A review-sandbox admin document
cannot operate on production.

Identity Platform must enforce a minimum password length of 14 with uppercase,
lowercase, and numeric characters required, no symbol requirement, and
`forceUpgradeOnSignin: true`. The Staff Portal uses session-only Firebase Auth
persistence, discards the submitted password, and signs out when authorization
is lost or the 15-minute freshness boundary expires. Its password-reset result
is deliberately generic for registered and unregistered addresses; provider
email-enumeration privacy must be enabled and independently verified.

Draft input is exact: icons are `laboratory`, `guide`, `nutrition`, `recipes`,
`wellness`, `location`, `contact`, or `featured`; localized objects contain
only `en` and `es-MX`, with non-empty values of at most 120 characters. URLs
use the shared safe-catalog policy: canonical internal CaboHealth paths or safe
public HTTPS destinations; safe external query/fragment data is preserved, but
credentials, custom ports, local/private/IP targets, controls, whitespace,
backslashes, malformed escapes, traversal, and encoded separators fail closed.
Draft creation/update/archive write only a sanitized 30-day audit event. The
staff audit response exposes
only successful `client_code.created`, `client_code.revoked`, `draft.created`,
`draft.updated`, and `draft.archived` actions, the label `Staff`, an opaque
event ID, a short target suffix, and occurrence time. It never exposes a draft
URL, full access code, Auth UID, or client data.

`removeClientAccess` closes the current pseudonymous client identity: it returns
`{removed:true}` only after access is revoked and cleanup is durably queued,
even if Firebase Auth or Firestore cleanup must finish in the scheduled worker.
The native app may then clear its session. A later valid code creates a new
client identity; removal does not preserve the prior account or grant.

`deleteClientAccount({installationId,deletionReceipt})` returns `pending`
whenever Auth deletion, bounded artifact cleanup, or finalization has not
durably completed. It never reports completion merely because authorization
was revoked. While pending, all native and web authorization is already denied
and the scheduled worker retries idempotently; an authenticated explicit-delete
caller may also retry with the same receipt. `completed` means Auth is deleted
(or was already absent), linked subject/code records are removed, and the
tombstone is finalized.

The native app persists and read-backs the raw receipt in SecureStore before
the first delete request. If the request response is lost and the first status
lookup is still missing, the app keeps access locked, retains the same receipt,
and may re-submit only that same idempotent request while the authenticated
installation remains available. A missing prepared status never restores the
previous grant or discards the only recovery receipt.

After Firebase Auth is unavailable, the client polls
`getClientAccountDeletionStatus({deletionReceipt})`. Pending receipt records
have no `expiresAtMs` field and no TTL, remain queryable after
`expectedCompletionByMs`, and stay durable until cleanup completes. On
completion, the UID-linked tombstone is removed and the receipt record is
reduced to schema version, status, and timestamps. Its TTL deadline is exactly
`expiresAtMs = completedAtMs + 30 days`; the Firestore adapter stores that field
as a native Firestore `Timestamp`, despite its compatibility name. The status
service stops resolving it at the exact logical boundary
`nowMs >= completedAtMs + 30 days`, even if asynchronous physical TTL deletion
has not yet run. Malformed, unknown, cross-realm, and logically expired receipts
all reveal no status through the same generic `not-found/invalid_access`
response.

IP-only rate-limit and broker replay records are deliberately not treated as
account data because they cannot be safely attributed to one client; they
contain no subject/code and remain only until their short TTL. Sanitized audit
event bodies omit Auth UID, installation ID, code plaintext, and health data,
but may retain an opaque code ID; deletion event document names use a one-way
subject-derived suffix. All expire after 30 days.

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

The production realm requires these eight independently generated rings:

- `CLIENT_CODE_PEPPER_RING`
- `CLIENT_INSTALLATION_PEPPER_RING`
- `CLIENT_DELETION_RECEIPT_PEPPER_RING`
- `CLIENT_RATE_LIMIT_PEPPER_RING`
- `CLIENT_LAUNCH_NONCE_PEPPER_RING`
- `CLIENT_WEB_SESSION_PEPPER_RING`
- `CLIENT_WEB_CSRF_PEPPER_RING`
- `CLIENT_BROKER_HMAC_KEY_RING`

The review realm requires eight additional, independently generated rings:

- `APP_REVIEW_CREDENTIAL_PEPPER_RING`
- `APP_REVIEW_INSTALLATION_PEPPER_RING`
- `APP_REVIEW_DELETION_RECEIPT_PEPPER_RING`
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

The committed `.firebaserc` intentionally has no `default` or staging project.
It contains only the configured `cabohealth-prod` alias for the exact dedicated
production project. Every cloud command must still pass that alias or the exact
project ID explicitly; never restore the legacy project as a default.
`firestore.indexes.json` has no composite indexes or legacy catalog entries; it
contains only the explicit TTL field overrides below.

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

No URL belongs in this document. Internal broker resources map the entitlement
ID to bundled/server-controlled content. For an external resource, only the
protected administrative catalog maps the opaque ID to a URL, and only the V2
transactional launch response may disclose it transiently.

The committed Firestore configuration enables TTL on `expiresAtMs` for:

- `_private_account_deletion_receipts` (completed receipts only, 30 days after
  `completedAtMs`; pending receipts have no TTL field)
- `_private_audit_events` (30-day sanitized retention)
- `_private_rate_limits`
- `_private_redemption_requests`
- `_private_launch_nonces`
- `_private_web_sessions`
- `_private_broker_requests`

Expiry is already enforced in transactions; TTL is retention cleanup, not an
authorization mechanism.

The review database has a separate default-deny rules file and TTL overrides
for `review_sandbox_account_deletion_receipts` (completed receipts only),
`review_sandbox_rate_limits`, `review_sandbox_redemption_requests`,
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
have a 30-day expiry. Firestore TTL deletion is asynchronous, so emulator tests
and the controlled synthetic-record production verification must confirm that
every field override is active; authorization never depends on TTL.

Before activating any TTL policy, inspect every TTL-enabled collection in both
the production and review databases for historical documents whose
`expiresAtMs` value is a numeric epoch. Firestore TTL ignores numeric values.
Migrate each retained deadline to a native Firestore `Timestamp` representing
the same instant (or remove an already-expired document under the approved
retention procedure), then verify no historical numeric `expiresAtMs` values
remain. New writes perform this conversion at the Firestore infrastructure
boundary, and reads convert the timestamp back to integer epoch milliseconds
for domain validation and callable responses.

## Release gates still open

Do not call this Apple-ready or production-ready until all are complete:

1. Preserve the owner-approved single project `cabohealth-owner-prod`, its
   exact CLI alias, and the already provisioned independent production/review
   secret rings without exposing values. Do not create a staging project
   without a superseding ADR.
2. Enable App Check with App Attest for the production iOS bundle and verify
   exact app-ID binding and consumed-token replay behavior across all 17 current
   iOS client callables on a physical iPhone.
3. Maintain the completed password-only owner migration and live personal E2E.
   The guarded 2026-08-23
   operation enforced the password-reset prerequisite, verified the enabled and
   email-verified password account, removed only the exact enrolled factor,
   revoked prior sessions, and proved zero factors, `catalogAdmin: true`, and
   the exact active private admin document and permissions. The subsequent
   fresh password-only sign-in loaded the authenticated workspace and
   `adminGetStaffSession` returned HTTP 200. Keep the project-level TOTP
   provider enabled but dormant. Do not treat later source changes as proof of
   deployment.
4. Preserve the completed Firestore rules gate: the pinned emulator rejected
   both production probes (2/2) and both App Review probes (2/2). Re-run it for
   every future rules change. Preserve the completed 2026-08-24 schema
   transition: the reviewed bridge preceded the exact update-time-preconditioned
   `schemaVersion` 1-to-2 patch, the strict reader followed the sanitized
   read-back, and rollback is limited to a reviewed schema-2-compatible build.
   Separately migrate or remove any verified historical numeric `expiresAtMs`
   value and require every retained TTL deadline to be a Firestore `Timestamp`.
5. Integrate and test the native adapter against all nine production client
   access callables—V1/V2 redeem, V1/V2 refresh, remove, delete, deletion
   status, and V1/V2 launch—plus all three catalog callables, the Staff portal,
   and PHP broker adapter end-to-end. Verify the 256-bit
   receipt remains only in SecureStore and exercise remove/delete/revoke during
   active native and web sessions.
6. Exercise the durable deletion worker with injected Auth/Firestore failures
   and malformed tombstones in the emulator, then verify controlled synthetic
   production deletion, the sanitized aggregate alert, deployed TTL status,
   and that the native UI treats `pending` as pending rather than as completed
   erasure.
7. Preserve the deployed App Review realm: the named Firestore database,
   default-deny rules and TTL policies, database-scoped runtime IAM, eight
   separate key rings, five review client callables, portal rotation adapter,
   cleanup worker, and fixed hosting sample are active. Do not issue the
   credential until a controlled operation can run valid-credential,
   nonce/replay/revocation/deletion, reciprocal cross-realm, stale-generation,
   30-day-inactivity, Auth-failure, retry, App Attest, and two-physical-iPhone
   checks end-to-end.
8. Wire the staff portal adapters to the five documented draft/audit callables
   and verify optimistic-conflict/error handling in the local emulator and,
   when necessary, with disposable controlled production records. Draft
   publication remains an intentionally separate, reviewed release process; do
   not add a generic publish endpoint or create a staging project.
9. Resolve or formally accept the current npm-audit residual: seven moderate
   `uuid` advisories arrive transitively through the latest pinned Firebase
   Admin/Functions packages. `npm audit` offers only a breaking downgrade;
   there are no high or critical findings in this package audit.

For external-HTTPS rollback, first deactivate external catalog entries through
new monotonic owner mutations and verify the legacy catalog/redeem/refresh/
launch contracts. Stop compatible-binary distribution and restore the prior
Staff/native artifacts as applicable. If the Functions addition itself must be
reverted, deploy the retained previous schema-compatible release; do not
restore an older catalog snapshot or roll back Firestore schema, rules, broker,
or App Review authority. This source runbook supplies no deployment evidence.

Firestore rules/indexes/TTL, the independent Secret Manager rings, runtime IAM,
and the final strict 26-Function backend have been provisioned in the exact
production project. The exact transition and rollback evidence is recorded in
`access-code-schema-transition-2026-08-24.md`.
The fixed active owner-admin record and the fixed Client Resources runtime
record are present and match the reviewed bootstrap authority exactly; do not
rerun the bootstrap against the historical local schema-1 plan. The isolated
App Review database remains intentionally empty until an authorized portal
rotation creates the reviewer credential atomically. The protected
production/App Review Hostinger overlay is active and hosting-boundary verified
as release
`protected-overlays-v1-f3fc2ffb500f41dbfbf16dd4141eef3ccf87ef7055df63a2054b9cbe042b8213`;
that infrastructure activation does not issue a reviewer credential or
complete valid-flow E2E. TestFlight and Apple submission remain incomplete.
The owner-authorized Artifact Registry cleanup policy deletes Functions images
older than seven days.
