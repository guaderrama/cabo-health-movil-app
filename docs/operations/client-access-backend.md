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
  linked-data cleanup complete.

The deliberate response exceptions are: the one-time code to the authorized
administrator, a Firebase custom token from client redemption, the short
launch nonce to the authenticated native client, and the opaque web session
and CSRF token across the authenticated server-to-server broker. No response
contains a premium target URL.

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
| `redeemClientAccessCode` | `{code, installationId, requestId}` | `{customToken, grant}` |
| `refreshClientAccess` | `{installationId}` | `{grant}` |
| `removeClientAccess` | `{installationId}` | `{removed:true}` after revocation and deletion job are durable |
| `deleteClientAccount` | `{installationId}` | `{status:'pending'\|'completed'}` |
| `createClientLaunch` | `{installationId, resourceId}` | fixed HTTPS POST URL, nonce, expiry |

Admin operations additionally require all of the following server-side:

1. Firebase Auth with `catalogAdmin: true`.
2. An exact TOTP second-factor claim (`sign_in_second_factor: "totp"`).
3. `auth_time` no older than 15 minutes.
4. An active `_private_admins/{uid}` document with `scope: "production"`.
5. The exact permission (`client_codes` or `client_resource_drafts`).

Claims alone never authorize an administrator. A review-sandbox admin document
cannot operate on production.

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

## Secret Manager parameters

- `CLIENT_CODE_PEPPER_RING`
- `CLIENT_INSTALLATION_PEPPER_RING`
- `CLIENT_RATE_LIMIT_PEPPER_RING`
- `CLIENT_LAUNCH_NONCE_PEPPER_RING`
- `CLIENT_WEB_SESSION_PEPPER_RING`
- `CLIENT_WEB_CSRF_PEPPER_RING`
- `CLIENT_BROKER_HMAC_KEY_RING`

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
   in staging, verify deployed TTL status, and confirm the native UI treats
   `pending` as pending rather than as completed erasure.
7. Implement a **separate** synthetic `purpose: "app_review"` credential and
   isolated review-sandbox repository. It must be multi-device/non-expiring,
   excluded from the four production slots, and unable to read or mutate
   production. No generic bypass or master code is acceptable.
8. Implement the requested admin draft CRUD as a separate fail-closed tracer.
   Drafts may contain bilingual text, icon key, access, and a reviewed HTTPS
   candidate URL, but must never publish or change the signed production
   catalog automatically.
9. Resolve or formally accept the current npm-audit residual: seven moderate
   `uuid` advisories arrive transitively through the latest pinned Firebase
   Admin/Functions packages. `npm audit` offers only a breaking downgrade;
   there are no high or critical findings in this package audit.

No Firebase, Hostinger, or Apple deployment was performed while implementing
this backend slice.
