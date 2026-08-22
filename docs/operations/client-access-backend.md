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
- Client refresh, remove, account delete, and launch re-check the live code,
  grant, installation binding, resource, and expiry. A launch nonce is
  one-use, valid for 60 seconds, and opens only the fixed CaboHealth POST URL.
- The web broker consumes the launch nonce into a one-hour-or-shorter hashed
  session. Every introspection re-checks the live production grant/code and
  exact entitlement. CSRF is exact, versioned HMAC material; revoke is
  one-session only.
- Firestore client rules are default-deny. Only the Admin SDK in Functions can
  access backend documents. Production source contains no application logging
  of codes, credentials, digests, IP addresses, grants, or identifiers.

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
| `removeClientAccess` | `{installationId}` | `{removed:true}` |
| `deleteClientAccount` | `{installationId}` | `{deleted:true}` |
| `createClientLaunch` | `{installationId, resourceId}` | fixed HTTPS POST URL, nonce, expiry |

Admin operations additionally require all of the following server-side:

1. Firebase Auth with `catalogAdmin: true`.
2. A second-factor sign-in claim.
3. `auth_time` no older than 15 minutes.
4. An active `_private_admins/{uid}` document with `scope: "production"`.
5. The exact permission (`client_codes` or `client_resource_drafts`).

Claims alone never authorize an administrator. A review-sandbox admin document
cannot operate on production.

`deleteClientAccount` currently removes the authoritative code and grant, so
all native and web authorization fails immediately. It is **not yet a complete
privacy erasure**: already-hashed launch/session records remain until TTL, and
sanitized audit events follow the retention policy. Full cascade deletion and
an approved audit-retention policy are mandatory before this response may be
described to users as completed account deletion.

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
default. `firestore.indexes.json` is intentionally empty; no legacy catalog
index is deployed.

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

Enable Firestore TTL on `expiresAtMs` for:

- `_private_rate_limits`
- `_private_redemption_requests`
- `_private_launch_nonces`
- `_private_web_sessions`
- `_private_broker_requests`

Expiry is already enforced in transactions; TTL is retention cleanup, not an
authorization mechanism.

Current maximum residual retention after `deleteClientAccount` is governed by
those TTL policies: broker requests two minutes, launch nonces one minute,
rate-limit/redemption request records up to thirty/five minutes, and web
sessions up to one hour. These records contain digests rather than plaintext,
but launch/session records remain linkable to the pseudonymous subject/code
until cleanup. Audit retention must be explicitly approved and documented.

## Release gates still open

Do not call this Apple-ready or production-ready until all are complete:

1. Create separate staging and production Firebase projects and explicit CLI
   aliases; provision the seven independent secrets without exposing values.
2. Enable App Check with App Attest for the production iOS bundle and verify
   consumed-token replay behavior on a physical iPhone.
3. Bootstrap the owner Auth account, MFA, custom claim, and active private
   admin document through a separately controlled process.
4. Deploy rules and Functions to staging, configure TTL, seed the signed fixed
   catalog, and run Firebase Emulator and concurrency/failure tests.
5. Integrate and test the native adapter, staff portal, and PHP broker adapter
   end-to-end; verify remove/delete/revoke during active native and web sessions.
6. Implement and test cascade deletion (or a bounded deletion job) for all
   subject/code-linked launch and web-session artifacts, configure/verify TTL,
   and approve a minimal sanitized-audit retention schedule. Until then, do not
   market `deleteClientAccount` as completed privacy erasure.
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
