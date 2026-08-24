# Staff Portal production activation — 2026-08-23

This record contains no account credential, MFA secret, access code, Firebase
secret, or private user identifier.

This record is chronological. Earlier TOTP sections are immutable audit history,
not current instructions. The final password-only section is normative.

## Approved scope

- Public URL: `https://cabohealth.org/staff/`
- Hostinger target: `public_html/staff`
- The target was absent immediately before activation.
- WordPress, DNS, email, the public web capsule, and every other site path were
  outside the approved operation and were not changed.

## Immutable artifact pins

- Release ID: `staff-v1-3994d181ad3806c1fde2c5b31f13b9346df618694bb9964f0f5d9577d16e5d20`
- Inventory SHA-256: `6a2043df3f0f91166d1c54568b42d1fae5b84682951fd5bd35bb268b1688e1de`
- Artifact SHA-256: `2b92abf8bcf87ea18988b5bd9ed04f879f4ba390b87896d54d13d4d92ddf6cb3`
- File count: 8

The local artifact passed `release:verify-artifact` before promotion. The same
eight files were uploaded to a private Hostinger staging directory, and every
remote file SHA-256 was checked before the directory was promoted atomically.

## Rollback evidence

Because no previous `public_html/staff` target existed, the rollback state is
"target absent." Hostinger retains an absence marker at:

`rollback/staff-v1-3994d181ad3806c1fde2c5b31f13b9346df618694bb9964f0f5d9577d16e5d20-absent/target-was-absent`

The verified source copy is retained outside the document root under the same
release ID. Rolling back this first activation means quarantining the published
directory and restoring the recorded absent state; it must not touch any other
path.

## Live verification

- Evidence recorded at: `2026-08-23T14:51:48Z`
- `index.html`, the pinned JavaScript, and the pinned CSS returned `200`.
- The unknown-route probe returned the pinned protected `404.html` with status
  `404`; it did not redirect or serve the portal shell.
- All checked response bodies matched the manifest size and SHA-256.
- No checked response set a cookie.
- The exact required CSP, cache, cross-origin, permissions, referrer, HSTS,
  content-type protection, and frame-denial policies were present.
- `npm --prefix staff-portal run release:verify-live` completed with
  `verified: true` and all three approved pins.

Hostinger writes the semantically equivalent spelling `charset=UTF-8` while the
manifest records `charset=utf-8`. The verifier now normalizes only media-type
and charset casing/spacing. Its regression test proves a different charset is
still rejected. This verifier-only correction did not change any deployed byte
or artifact pin. The Staff Portal suite passed 42/42 tests, and the focused
release-gate suite passed 5/5 after restoring the exact local artifact.

## Owner activation state

Production publication is complete. Email verification and one TOTP enrollment
were completed personally by the owner without placing any credential or setup
secret in repository evidence. The reviewed Firebase owner bootstrap was then
applied and independently verified as recorded below. A fresh
password-plus-TOTP sign-in remains a personal browser action because neither
value may be read or entered by the operator.

## Owner TOTP recovery

At `2026-08-23T15:26:35Z`, the owner explicitly authorized resetting only the
production TOTP factor after multiple fresh Google Authenticator codes failed.
The administrative precondition read found exactly one enabled, email-verified
owner account and exactly one TOTP factor named `CaboHealth Authenticator`.

The factor was removed through the official Identity Platform administrative
account update. An immediate independent account lookup confirmed:

- enrolled factor count changed from one to zero;
- the account remained enabled and email-verified;
- the account identity, email, providers, and custom-claim state were unchanged;
- the password hash and password-updated state were unchanged.

No UID, email address, password state, TOTP enrollment identifier, setup secret,
or one-time code is stored in this evidence. The live portal was reloaded to
discard the stale MFA resolver. The subsequent personal TOTP enrollment and
bootstrap diagnosis are recorded below without sensitive values.

## Owner bootstrap and authentication diagnosis

After recovery, the owner enrolled exactly one new TOTP factor. The first fresh
MFA resolution succeeded, proving that Google Authenticator and the device clock
were not the cause of the visible failure. The following staff-session request
was denied because both required production authorities were still absent:
the `catalogAdmin` claim and the private admin document. A second code could not
work because Firebase had already consumed the successful MFA resolver.

Ivan authorized and the operator applied the exact plan with canonical SHA-256
`098061e629c16f0e6f6df89294726ce35eeb3b4c83b747c3f8a395a478c2111a`.
Sanitized postcondition reads confirmed: account enabled, TOTP preserved,
`catalogAdmin` true, the admin document exact, and the fixed client-resource
document exact. No password, email, verification state, factor, or private
identifier was modified or recorded.

The portal was reloaded after claim activation and now presents a clean sign-in
screen so the next password-plus-TOTP exchange receives a freshly minted token.

## Authentication UX correction candidate

The portal now distinguishes an invalid TOTP, which remains retryable, from a
failure after Firebase has already consumed the MFA challenge. In the latter
case it returns to password sign-in and presents the authorization-specific
message instead of requesting an impossible second code. The full Staff Portal
suite passed 43/43 tests.

The replacement artifact passed the local immutable-artifact gate with:

- Release ID: `staff-v1-c36bbc3c31c04949a0b10591790a5af2cf43a1011333469e72bd1ab90e7adb43`
- Inventory SHA-256: `8a2b9b800d09bf603e75c8f1813f76386725a2e6b7903afc3193af7c9fc08508`
- Artifact SHA-256: `790fad0beb0a0b4f054ac8aee0451451373fdf0abc4a61882da18906fdbcfe85`

These pins describe a verified local candidate only until an independent
Hostinger promotion and live byte/header verification are both completed and
recorded. The currently live portal remains the earlier pinned release above.

## MFA finalization token correction candidate

A monitored fresh owner sign-in produced the exact sequence
`signInWithPassword` → `mfaSignIn:finalize` → `accounts:lookup` → Secure Token
refresh. The MFA finalization and the subsequent forced refresh both returned
success, but no `adminGetStaffSession` request followed. This proves the
one-time code was accepted and confines the visible failure to the portal's
local post-MFA guard; no credential, token, claim value, or one-time code was
read or recorded.

The guard was unnecessarily calling `getIdTokenResult(true)` immediately after
`resolveSignIn`, replacing the fresh MFA-finalized token before validating it.
It also parsed reserved JWT claims directly. The corrected guard now:

- reuses Firebase's fresh finalized token with `getIdTokenResult()` and lets the
  SDK refresh normally only when required;
- checks the public `IdTokenResult.signInSecondFactor` field for TOTP; and
- derives the 15-minute browser boundary from the public `authTime` field.

A regression test requiring those three properties failed against the prior
implementation and passed after the correction. Type checking and the complete
Staff Portal suite passed; the suite remains 43/43.

The new eight-file candidate passed the immutable local artifact verifier with:

- Release ID: `staff-v1-47a165dda8d7f472a44b5864fbb5aaf970b4b6b652e062bffd3f05f95c2bfeba`
- Inventory SHA-256: `d77a770c98183c0b0777470131a7adcc017fd691d35bd910bd9ca5aee3149b84`
- Artifact SHA-256: `ec5a8395068aa4ec2caabeb51dcc167c39e5d829534617644ea9773dcda4d1b4`

The private transfer ZIP is only a container for those verified files; its
SHA-256 is `5b13409db1b6685bc68f5e3d1bb859b0e23ca4a7844aa75fe66acef9bb8a7a43`.
It is not a replacement for the three release pins.

The hPanel session did not expose the hosting plan that owns `cabohealth.org`.
The separately documented, owner-controlled SSH channel was therefore used
instead. Before any mutation, the original live release passed the complete
external verifier again. The new ZIP then matched its transfer SHA-256 on both
hops, passed archive integrity checks, extracted to exactly eight regular files
with no symlinks, and every extracted and staged file matched the manifest.

The previous `public_html/staff` directory was moved intact to the rollback
slot bound to the new release ID, and the verified staged directory was moved
into place on the same filesystem. The first Internet-side verification failed
closed because the promoted directory retained private staging mode `0700`.
A read-only mode check identified this exact cause; the directory was changed
to the required web-readable mode `0755`, without changing any file byte. The
complete external verifier was rerun and passed with `verified: true` for the
new release ID, inventory hash, and artifact hash above, including all security
headers, exact HTML/JavaScript/CSS bytes, and the protected 404.

An independent browser reload then requested
`assets/index-BBsasxoe.js`, confirming that the owner-visible portal is serving
the corrected release. A final personal password-plus-TOTP sign-in remains the
only pending authentication check; neither value may be read or entered by the
operator.

## Password-only migration and current production state

Ivan explicitly authorized migration of the owner account to password-only
authentication. A sanitized browser trace recorded HTTP 200 for
`accounts:signInWithPassword` and HTTP 200 for `mfaSignIn:finalize`, but the
portal failed before any Cloud Functions request was sent. The evidence retained
no email address, UID, password, reset link, verification code, factor secret,
token, request body, or private response.

Identity Platform now enforces a minimum of 14 characters with uppercase,
lowercase, and numeric characters; a symbol is not required. Existing accounts
must upgrade to the policy. Email-enumeration protection remains enabled, and
the portal returns the same privacy-preserving password-reset notice for a
registered or unregistered address. The global TOTP provider remains enabled,
but becomes dormant for this owner after factor removal; neither the current
portal nor the current Functions authorization path requires MFA.

The password-only release passed these focused gates before production:

- Staff Portal: 42/42 tests;
- Functions: 104/104 tests;
- deployment: 11 affected Functions updated in `us-central1`.

The 11 Functions are the affected password-only deployment set inside the
historical inventory of 26 Functions, not a new total inventory.

The immutable current artifact is pinned as follows:

- Release ID:
  `staff-v1-b484ea99005e836cfcc031fe8aadf20387146c60b24a30f6880e8faf9a16a698`;
- inventory SHA-256:
  `9757cc84da930d76dffb787bb633339dc63e73735596a0923ded81723bd13c00`;
- artifact SHA-256:
  `f900652cf530f043b304c410dbb20d1e807f679766b16c968acd396de13c16b5`;
- ZIP transport SHA-256:
  `1e4ab89aa8af804be337ac16734249f58860e9c9ae0df5bd40a9814901703555`;
- file count: 8.

The ZIP was transport only. The verified directory was promoted to
`public_html/staff`, and the previous complete live directory was retained in
the rollback slot bound to:

`rollback/staff-v1-b484ea99005e836cfcc031fe8aadf20387146c60b24a30f6880e8faf9a16a698`

Rollback restores that complete directory and then reruns the external verifier;
it does not change any other site path. The current
`npm --prefix staff-portal run release:verify-live` result is `verified: true`
for the exact release ID, inventory hash, artifact hash, bytes, security headers,
and no-cookie responses recorded above.

## Password-only documentation and legal-source alignment

The current Staff Portal README, backend runbook, App Review threat model, data
inventory, TestFlight checklist, submission gates, and new ADR 0002 now describe
the password-only boundary and its compensating controls. Historical design and
activation documents retain their earlier TOTP facts but carry an explicit ADR
0002 supersession notice so a future operator does not restore the obsolete
requirement.

The bilingual Privacy source was independently reviewed and approved with exact
SHA-256
`def90b1f4ce575a270b5ab0e47d9963ad73393fc56c233c2a8a8a64248ddec4a`.
Both release authorities carry that same pin. Legal-content tests passed 41/41,
the complete repository suite passed 1183 tests with three environment-specific
skips and zero failures, and the offline web assembly check derived candidate
`web-v1-8ff48eacb692ff60889fbd7f6bea26174d9a85761c3a2b4d339a3745efff34ef`.
This is source review and deterministic planning evidence only; it does not
claim that the new Privacy bytes were promoted to Hostinger. Public-web
promotion remains subject to its own exact release-ID authorization, immutable
transport, rollback, origin, browser, and Apple-CDN gates.

## Owner reset and legacy-factor removal completed

On 2026-08-23 the owner personally completed the strong-password reset. The
separately controlled migration guard then re-read the same preapproved account
and required the password-update timestamp to be newer than the private
baseline before permitting any mutation.

The sanitized execution and read-back proved all of these postconditions:

- `migrated: true` and `factorCount: 0` for the exact owner account;
- prior refresh tokens revoked;
- account enabled and email verified;
- password provider retained;
- reviewed `catalogAdmin` authority retained; and
- exact private production admin document preserved.

The project-level TOTP provider remains enabled and dormant; it was not disabled
globally. The operation did not print or retain the email address, UID,
password, reset link, factor identifier, token, or private document contents.
A fresh personal password-only sign-in through the live portal and
`adminGetStaffSession` remains the final owner-only E2E gate.

## App Check CSP diagnosis and corrected live release

A sanitized browser/network trace proved that the password-only Firebase Auth
exchange succeeded, the owner had zero enrolled factors and a recent login, and
no request reached `adminGetStaffSession`. Browser CSP enforcement blocked the
pinned Firebase SDK's reCAPTCHA Enterprise App Check token exchange to
`https://content-firebaseappcheck.googleapis.com` because the deployed
`connect-src` allowed the obsolete `https://firebaseappcheck.googleapis.com`
origin instead. The password, password policy, and MFA state were therefore not
the cause of this failure.

A regression test now extracts every Firebase App Check exchange origin from
the installed pinned SDK and requires the same origin in `index.html`,
`_headers`, `.htaccess`, and the release verifier. The test failed against the
previous policy and passed after replacing only the obsolete origin. The
complete Staff Portal suite passed 43/43 tests.

The corrected eight-file artifact is the current live Staff Portal release:

- Release ID:
  `staff-v1-f4488dbcf43c3660c7b85425471fc876d04bb80dbd6ec318ffc09e3c9f88015f`;
- inventory SHA-256:
  `f6409e00a6084fe2168695237c21f59435ff78255111269058800b290b56152b`;
- artifact SHA-256:
  `f45e7a28c4a2fc3e168fdc4669579b3924e4c9abe876aefb7f9b6a18917993d0`;
- ZIP transport SHA-256:
  `812a4b646e64876d58ea4284f10c1193efc9fed2f4415dceb4e1c8a93c27d0f6`;
- file count: 8.

The previous complete live directory is retained at:

`rollback/staff-v1-f4488dbcf43c3660c7b85425471fc876d04bb80dbd6ec318ffc09e3c9f88015f`

The external `release:verify-live` gate passed for the exact release ID,
inventory hash, artifact hash, bytes, security headers, protected 404, and
no-cookie responses. A browser reload then observed HTTP 200 from the App Check
exchange endpoint with no `connect-src` CSP violation. The remaining blocked
inline-style console noise was unrelated to the successful exchange and did
not justify weakening `style-src`.

The owner personally completed the fresh password-only sign-in on 2026-08-23
local time (`2026-08-24T00:20:53.195194Z`). The authenticated live UI showed
the sign-out action, Staff workspace navigation, and the Client access codes
heading while the sign-in screen was absent. A sanitized Cloud Run request log
independently recorded `adminGetStaffSession` `POST` with HTTP 200 and
`0.629694247s` latency. The previously verified account still had zero enrolled
factors, and no MFA challenge appeared.

This completes the final owner-only password sign-in, App Check, recent-auth,
server-authorization, and workspace-loading E2E gate. No credential, token,
request body, UID, private response, or client record was retained in the
evidence. It does not complete the separate Apple, TestFlight/physical-iPhone,
App Attest, reviewer-sandbox, hosted legal, or remaining release gates.
