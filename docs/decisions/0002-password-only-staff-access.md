# ADR 0002: Password-only Staff Portal access

- Status: **Accepted, deployed, and owner E2E verified**
- Decision date: **2026-08-23**
- Supersedes: **only the Staff Portal authentication/MFA requirement in ADR 0001**

## Context

ADR 0001 recorded TOTP as the enabled MFA provider and anticipated an enrolled
owner factor. The owner later completed a TOTP resolver successfully, proving
that the authenticator application and automatic device time were not the cause
of the subsequent authorization failure. Repeating the challenge added
operational friction without changing the server-side authority that was
missing at that point.

The app remains a small, owner-operated wellness product, but removing TOTP
reduces phishing resistance. Password-only access is therefore acceptable only
with the compensating controls below and a controlled migration that does not
create an unverified or stale session.

## Decision

The Staff Portal authenticates with email and password only. It must not enroll,
request, or resolve a TOTP challenge. All of these controls remain mandatory:

1. Identity Platform enforces a minimum password length of 14, requires at
   least one uppercase letter, one lowercase letter, and one number, does not
   require a symbol, and sets `forceUpgradeOnSignin: true`.
2. Both portal and Functions require a verified email and the exact password
   provider. Functions validate `email_verified: true` and
   `firebase.sign_in_provider: "password"` from the authenticated token.
3. Firebase Auth browser persistence is session-only. The portal discards the
   submitted password and signs out on authorization loss or when its fresh
   authorization window ends.
4. Functions reject a missing or invalid `auth_time` and any session older than
   15 minutes.
5. Every staff callable consumes a limited-use App Check token and requires the
   exact configured staff web App ID.
6. Authorization requires both `catalogAdmin: true` and an exact active
   `_private_admins/{uid}` document with `schemaVersion: 1`,
   `scope: "production"`, and the exact permission for the requested operation:
   `client_codes`, `client_resource_drafts`, or `app_review_credential`. The
   claim alone never authorizes access.
7. Password reset always returns the same generic portal message for registered
   and unregistered addresses. Provider email-enumeration privacy remains a
   release requirement, and no account-existence detail enters logs or UI.

The project-level TOTP provider remains enabled but dormant. This ADR does not
authorize disabling it globally. The portal exposes no enrollment or challenge
flow, and a future reviewed decision may reuse the provider if staffing or risk
changes.

## Controlled migration order

1. Verify the intended Identity Platform policy configuration without exposing
   account details, then enable enforcement with `forceUpgradeOnSignin: true`.
2. Have the owner request the portal's generic reset message and complete the
   strong-password reset through the delivered Firebase link.
3. Deploy and independently verify the password-only Functions authorization
   before exposing the password-only portal artifact. A stale portal asset must
   never be accepted as evidence of the deployed flow.
4. Deploy the pinned Staff Portal artifact and verify cache-bypassed loading of
   that exact artifact, session-only persistence, limited-use App Check, and
   generic reset behavior.
5. Only after the strong-password reset, remove the exact enrolled owner factor
   through the separately controlled bootstrap operation, revoke existing Auth
   sessions, and re-read sanitized postconditions. This factor removal was
   pending at initial acceptance and completed through the guarded production
   operation on 2026-08-23.
6. Verify the enabled account is email-verified, has the password provider and
   zero enrolled factors, and retains only the reviewed `catalogAdmin` claim and
   exact active production admin document/permissions. Then run a fresh
   end-to-end sign-in and each authorized callable; also prove wrong provider,
   unverified email, stale/future `auth_time`, wrong App ID, replayed App Check,
   missing claim, wrong scope, inactive document, and wrong permission all fail
   closed.

Production execution on 2026-08-23 completed the strong-password reset, exact
legacy-factor removal, refresh-token revocation, and sanitized account-state
verification. The read-back proved an enabled, email-verified password account,
zero enrolled factors, the reviewed `catalogAdmin` claim, and the exact private
admin document. The owner personally completed a fresh password-only sign-in on
2026-08-23 local time (`2026-08-24T00:20:53.195194Z`). The live authenticated
workspace loaded without an MFA challenge, and an independent sanitized Cloud
Run request record showed `adminGetStaffSession` `POST` with HTTP 200. This
completed the final owner-only E2E gate without changing the separate hostile-
path, TestFlight, physical-iPhone, App Attest, reviewer-sandbox, or Apple gates.

If any step fails, stop with staff access closed. Do not remove the factor before
the strong-password reset and do not weaken or bypass the server authorization
checks to finish the migration.

## Consequences

The owner no longer depends on a separate authenticator challenge for each fresh
Staff Portal session. The mailbox, password, reset flow, App Check boundary, and
server authorization document become more important; alerts, access review, and
fast session revocation must remain operational. Multiple staff operators,
materially more clients, sensitive-data scope, suspicious access, or a security
review should trigger a new ADR considering passkeys or phishing-resistant MFA.

This ADR changes only the Staff Portal authentication/MFA portion of ADR 0001.
ADR 0001's single-project topology, Firestore database separation, App Review
realm, IAM, billing, client-code, deployment, and Apple-review decisions remain
in force. Historical activation records remain historical evidence and must not
be rewritten to imply that earlier TOTP events did not occur.
