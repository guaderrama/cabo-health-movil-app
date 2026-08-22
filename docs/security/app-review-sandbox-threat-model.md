# App Review sandbox threat model

Status: source implementation and automated tests only. Nothing in this file
authorizes deployment or issuance of a review credential.

## Objective and non-objectives

Apple needs a stable, multi-device way to exercise one representative gated
flow without receiving a real client code or access to production client data.
The sandbox is not a staff account, master code, production fallback, generic
URL launcher, or catalog preview. It can expose only the compiled non-clinical
sample `review-sandbox-app-review-sample-v1`.

## Assets and boundaries

- Production client codes, four production slots, grants, catalog resources,
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
  Firebase App IDs. Staff rotation additionally requires a recent Auth session,
  exact TOTP, active production staff document, and the exact
  `app_review_credential` permission.

## Threats and controls

| Threat | Control |
| --- | --- |
| Review credential consumes or bypasses a client slot | Independent service/store/database; no slot or production-code APIs |
| Caller selects a production resource or URL | Redeem/launch accept no resource, URL, purpose, or scope; fixed compiled grant and launch URL |
| Credential disclosure at rest | Versioned HMAC lookup only; complete value exists only in one rotation response |
| Guessing/brute force | 128-bit CSPRNG credential; IP-only and IP/installation HMAC rate buckets; generic errors |
| One reviewer installation impersonates another | Installation-specific HMAC grant and derived `review_*` UID; refresh/launch revalidate both |
| Old credential/session survives rotation | Every redeem, refresh, launch, nonce consume, and web introspection checks current generation |
| Review Auth token reaches production | UID prefix and authority checks are exact and realm-disjoint |
| Production broker request crosses into review | Separate export, secret, storage and canonical string `cabohealth-app-review-broker-v1` |
| Replay or stolen launch URL | Signed S2S requests, stable realm-specific replay digest, 60-second one-use nonce, ≤1-hour HMAC-only web session |
| Staff claim alone rotates credential | Exact App Check app ID + consumed token + `catalogAdmin` claim + exact TOTP + auth ≤15m + active staff doc + permission |
| Client SDK reads sandbox documents | Dedicated default-deny rules; server IAM remains a deployment gate |

## Failure behavior

All client and broker failures are generic. Rotation uses compare-and-swap on
`expectedGeneration`; two operators cannot silently overwrite one another.
Rotating the credential immediately denies prior generations even if Firestore
TTL cleanup has not run. No runtime path falls back to production storage,
production broker keys, a caller-selected realm, or a broad admin role.

## Residual risks and activation gates

1. Provision a separately named `cabohealth-review-*` Firestore database and a
   least-privilege runtime identity; verify IAM denies default/production data.
   Prefer a dedicated review runtime service account. Prefix validation alone
   is not an IAM boundary.
2. Map `firestore.review.rules` and `firestore.review.indexes.json` explicitly
   to that named database and verify default deny plus all five TTL policies.
3. Generate seven independent review key rings. Never reuse production raw key
   material, despite canonical-domain cross-realm protection.
4. Implement and test the portal status/rotation adapter. The one-time result
   must not enter local storage, analytics, logs, screenshots, or support chat.
5. Implement native redeem/sign-in/refresh/launch parsing as the documented
   discriminated `review_sandbox` grant. Never retain the AR credential.
6. Implement a separate fail-closed Hostinger adapter for
   `appReviewBrokerApi` and the fixed `/apps/app-review/launch/` page.
7. Define and verify bounded physical cleanup for authorization-dead review
   grant records after rotation. Current authorization does not depend on that
   cleanup, but activation needs an explicit retention decision.
8. Run staging tests on two clean physical iPhones, rotate during active native
   and web sessions, and prove both realms reject cross-use before production.
9. Rotate immediately after Apple review or suspected disclosure. Do not use a
   production client credential in App Review notes.

Until every gate is evidenced, metadata must say the review realm is prepared
in source but not activated; it must not claim a working reviewer credential.
