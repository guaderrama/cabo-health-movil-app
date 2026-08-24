# App Review sandbox threat model

Status: backend infrastructure and the protected Hostinger review overlay are
deployed and hosting-boundary verified. No App Review credential has been
issued; valid-credential, rotation/revocation, reciprocal live isolation,
TestFlight, App Attest, and two-physical-iPhone E2E remain pending. Nothing in
this file authorizes credential issuance.

## Objective and non-objectives

Apple needs a stable, multi-device way to exercise one representative gated
flow without receiving a real client code or access to production client data.
The sandbox is not a staff account, master code, production fallback, generic
URL launcher, or catalog preview. It can expose only the compiled non-clinical
sample `review-sandbox-app-review-sample-v1`.

## Assets and boundaries

- Production client codes, grants, catalog resources,
  broker keys, web sessions, and account-deletion data are out of bounds.
- The review secret is a 128-bit `AR-...` credential stored only as a versioned
  HMAC lookup and displayed only by an authorized rotation response.
- Review grants use `review_*` Auth UIDs with `authority: "app_review"` and live
  credential generation. Production UIDs use `client_*`; neither realm accepts
  the other's UIDs or claims.
- Review documents live in an independently named Firestore database and use
  only `review_sandbox_*` collections. Client SDK rules deny every read/write.
- Review broker traffic uses its own function, key ring, canonical signature
  domain, replay namespace, nonce/session HMAC rings, and fixed entitlement.
- The iOS and staff App Check surfaces remain bound to their exact configured
  Firebase App IDs. Staff rotation additionally requires a consumed limited-use
  App Check token, verified email, the exact password provider, `catalogAdmin`,
  `auth_time` no older than 15 minutes, an active exact production staff
  document, and the exact `app_review_credential` permission.

## Threats and controls

| Threat | Control |
| --- | --- |
| Review credential consumes or bypasses a client code | Independent service/store/database; no production-code APIs |
| Caller selects a production resource or URL | Redeem/launch accept no resource, URL, purpose, or scope; fixed compiled grant and launch URL |
| Credential disclosure at rest | Versioned HMAC lookup only; complete value exists only in one rotation response |
| Guessing/brute force | 128-bit CSPRNG credential; IP-only and IP/installation HMAC rate buckets; generic errors |
| One reviewer installation impersonates another | Installation-specific HMAC grant and derived `review_*` UID; refresh/launch revalidate both |
| Old credential/session survives rotation | Every redeem, refresh, launch, nonce consume, and web introspection checks current generation |
| Review identity persists indefinitely | Stale generations are immediately cleanup-eligible; a current identity is eligible after 30 days of inactivity; a five-minute bounded worker durably retries linked-record, Auth-user, installation-digest, and grant deletion |
| Review Auth token reaches production | UID prefix and authority checks are exact and realm-disjoint |
| Production broker request crosses into review | Separate export, secret, storage and canonical string `cabohealth-app-review-broker-v1` |
| Replay or stolen launch URL | Signed S2S requests, stable realm-specific replay digest, 60-second one-use nonce, ≤1-hour HMAC-only web session |
| Staff claim alone rotates credential | Exact staff App Check app ID + consumed limited-use token + verified email + password provider + `catalogAdmin` + `auth_time` ≤15m + active exact production staff doc + `app_review_credential` |
| Password guessing or account enumeration | Enforced minimum 14 characters with uppercase, lowercase, and numeric characters; symbol optional; `forceUpgradeOnSignin: true`; generic reset response and email-enumeration privacy |
| Staff session survives a shared browser or becomes stale | Firebase session-only browser persistence, explicit sign-out on authorization loss, and client/server rejection at the 15-minute `auth_time` boundary |
| Client SDK reads sandbox documents | Deployed dedicated default-deny rules and exact database-scoped server IAM |

## Failure behavior

All client and broker failures are generic. Rotation uses compare-and-swap on
`expectedGeneration`; two operators cannot silently overwrite one another.
Rotating the credential immediately denies prior generations even if Firestore
TTL cleanup has not run. No runtime path falls back to production storage,
production broker keys, a caller-selected realm, or a broad admin role.

## Verified deployment state and remaining activation gates

1. **Verified:** the named review Firestore database, default-deny rules,
   indexes, all six review TTL policies, and database-scoped IAM are deployed.
   The reviewed Functions identity is limited to the exact production and
   review databases; a separate review-only service account is not used.
2. **Verified:** eight independent review secret rings are provisioned and
   remain disjoint from the eight production rings.
3. **Implemented/deployed, credential pending:** the Staff Portal
   status/rotation adapter and server authorization are live, but no credential
   may be issued until the controlled review E2E begins. The one-time result
   must never enter local storage, analytics, logs, screenshots, or support
   chat.
4. **Implemented, physical-device proof pending:** native
   redeem/sign-in/refresh/delete/status/launch parsing uses the discriminated
   `review_sandbox` grant and never retains the AR credential.
5. **Verified hosting boundary:** the fail-closed `appReviewBrokerApi` adapter
   and fixed `/apps/app-review/launch/` sample are active in the atomic
   protected overlay; signed LiteSpeed attestation, exact bytes, harness, and
   invalid-nonce denial passed.
6. **Deployed, synthetic failure proof pending:** the five-minute physical
   cleanup worker makes stale generations immediately eligible and current
   identities eligible after 30 days; controlled Auth/linked-record failure
   and retry E2E remains required.
7. **Pending:** issue/rotate a controlled credential, exercise valid nonce,
   replay, revocation, deletion, and reciprocal production/review rejection,
   then repeat the reviewer flow on two clean physical iPhones with App
   Attest/TestFlight.
8. Rotate immediately after Apple review or suspected disclosure. Never use a
   production client credential in App Review notes.

Until the credential and remaining valid-flow/device gates are evidenced,
metadata may accurately describe the deployed isolated infrastructure and fixed
hosting sample, but must keep the reviewer credential pending and must not claim
a working credential or completed App Review flow.
