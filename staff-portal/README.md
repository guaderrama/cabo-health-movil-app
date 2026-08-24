# CaboHealth Staff Portal

Separate React/Vite surface for authorized CaboHealth staff at the canonical URL `https://cabohealth.org/staff/`.

## Design brief

- **Audience:** authorized CaboHealth owner/operators.
- **Outcome:** issue or revoke an individual code for every client the owner chooses, prepare bilingual resource drafts, inspect a read-only activity feed, and rotate the isolated App Review credential.
- **Emphasis:** current access state and the next safe action.
- **Tone:** calm, clinical, editorial.
- **Density:** balanced; operational data stays scan-friendly without dashboard clutter.
- **Visual idea:** a dynamic access ledger, using numbered rows and restrained bronze rules from the approved CaboHealth palette.
- **Constraint:** the portal is a separate web surface; the iPhone app only exposes a visible system-browser link.

## Security boundary

- Firebase App Check is initialized with reCAPTCHA Enterprise.
- Firebase Auth requires a verified email and the exact password provider. Both the client and Functions fail closed unless `email_verified` is true and `firebase.sign_in_provider` is exactly `password`.
- Identity Platform must enforce a minimum of 14 characters with at least one uppercase letter, one lowercase letter, and one number. A symbol is permitted but not required, and `forceUpgradeOnSignin` must be `true`.
- Browser persistence is session-only. The portal uses Firebase `browserSessionPersistence`, signs out at the 15-minute authorization boundary, and does not persist the submitted password or workspace state.
- A console-created account that has not completed setup is handled fail-closed: an unverified sign-in sends Firebase's verification email and signs out. Password reset always displays the same generic response whether or not the address is registered, preserving email-enumeration privacy.
- The client imports Firebase Auth, App Check, and callable Functions only. It never imports Firestore.
- `adminGetStaffSession` derives scope and permissions on the server. No URL, form, or browser storage can select scope.
- Every staff callable requires `catalogAdmin: true`, an active exact `_private_admins/{uid}` document with `scope: "production"`, and the exact operation permission: `client_codes`, `client_resource_drafts`, or `app_review_credential`. Claims alone never authorize access. A review-sandbox staff session fails closed before any production callable can run.
- Full client codes and the `AR-…` App Review credential are held in React/controller memory only, copied once, then explicitly cleared after a second confirmation.
- Resource entries are drafts only. There is no publication or runtime-activation operation.
- CSP is present in HTML, portable `_headers`, and Hostinger/Apache `.htaccess`; build source maps are disabled. Its `connect-src` allowlist includes the exchange endpoint actually used by the pinned Firebase App Check SDK (`https://content-firebaseappcheck.googleapis.com`). A regression test derives this origin from the installed SDK and requires it in the HTML, portable headers, Apache policy, and live-release verifier so endpoint drift fails closed.
- Every callable requests a limited-use App Check token because the production Functions consume replay-protected tokens and require the exact configured staff web App ID.
- The release build requires externally pinned `APP_ENV`, project, web App ID, backend App ID parameter, and region. The public config must exactly match those pins. Missing or malformed values stop release builds; ordinary unconfigured test builds use `https://invalid.invalid` and remain closed.
- Callable authorization failures centrally sign out the browser and clear email, password, and workspace state. The server rejects `auth_time` older than 15 minutes, so a new password sign-in is required after expiry.

## First owner password setup

1. Configure the enforced Identity Platform password policy: minimum 14 characters, uppercase, lowercase, and numeric required, no symbol requirement, and `forceUpgradeOnSignin: true`.
2. Create or retain the approved owner email/password user directly in the exact Firebase project. The password belongs only to the owner and must not be copied into source, chat, shell history, logs, or release evidence.
3. Use the portal's reset action and complete the email-delivered reset with a password that satisfies the enforced policy. The portal response stays generic even for an unregistered address.
4. If the address is not verified, sign in once to send Firebase's verification message, open that message, return to the same portal, and sign in again.
5. Through the separately reviewed bootstrap process, verify the enabled account has the password provider, verified email, and zero enrolled factors, then verify or reconcile `catalogAdmin: true` and the exact active production admin document and permissions.
6. Sign in again and run the full callable authorization checks with a fresh session, consumed limited-use App Check tokens, and the exact staff web App ID.

The project-level TOTP provider remains enabled but dormant; the portal neither enrolls nor challenges TOTP. The exact previously enrolled owner factor was removed after the owner completed the strong-password reset on 2026-08-23, and prior refresh tokens were revoked, as recorded in [ADR 0002](../docs/decisions/0002-password-only-staff-access.md). Closing the authorization boundary, a failed sign-in, or signing out clears the submitted password and workspace state. Nothing in this flow writes those values to `localStorage`, IndexedDB, Firestore, or application logging. Source changes and this README are not production evidence; consult the dated [Staff Portal activation record](../docs/operations/staff-portal-production-activation-2026-08-23.md) for deployed pins and remaining gates.

## Required production environment

Set these at build time in the approved deployment system; do not commit values:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_APPCHECK_ENTERPRISE_SITE_KEY`
- `VITE_FIREBASE_FUNCTIONS_REGION` (defaults to `us-central1`)
- `APP_ENV` (`staging` or `production`)
- `STAFF_EXPECTED_FIREBASE_PROJECT_ID`
- `STAFF_EXPECTED_FIREBASE_WEB_APP_ID`
- `STAFF_WEB_FIREBASE_APP_ID` (must equal the deployed backend parameter)

The portal fails closed with a bilingual setup message when configuration is absent.
It also rejects the legacy project and every non-dedicated identity: the project
ID must be the exact external pin for the selected environment, the Auth domain
must be exactly `<projectId>.firebaseapp.com`, the App ID must be the exact
pinned Firebase web App ID and backend `STAFF_WEB_FIREBASE_APP_ID`, and the
Functions region must be exactly `us-central1`.
Deploy only the generated `dist/` directory, never the `public/` templates directly. Hostinger must allow Apache `mod_headers` and `mod_rewrite` for the versioned `.htaccess` to enforce headers and a protected 404 for unknown paths.
The mandatory independent artifact and live-origin procedure is documented in
`docs/operations/staff-portal-release.md`; `.htaccess` alone is never accepted
as proof that Hostinger sent the required policy.

## Backend contracts

Connected code callables:

- `adminGetStaffSession({})`
- `adminListClientAccessCodes({})`
- `adminCreateClientAccessCode({ expiresAtMs, resourceIds })`
- `adminRevokeClientAccessCode({ codeId })`

Connected draft-only and read-only audit callables:

- `adminListCatalogDrafts({})`
- `adminCreateCatalogDraft({ url, title, summary, icon, access })`
- `adminUpdateCatalogDraft({ draftId, revision, url, title, summary, icon, access })`
- `adminArchiveCatalogDraft({ draftId, revision })`
- `adminListAudit({})`

Draft mutations use optimistic revisions and return an exact draft view. There
is no publish or runtime-activation callable.

Connected App Review credential callables:

- `adminGetAppReviewCredentialStatus({})`
- `adminRotateAppReviewCredential({ expectedGeneration })`

Rotation uses compare-and-swap generation. The returned `AR-…` plaintext is
shown once, is marked copied only after the Clipboard API succeeds, and cannot
be hidden until staff confirms. Do not rotate it while App Review is active;
rotation immediately invalidates the previous credential.

For this release candidate, code issuance grants the single reviewed entitlement
`client-resources`. Before activation, seed an active
`_private_client_resources/client-resources` document exactly as specified by
the backend operations runbook. The portal deliberately has no arbitrary
resource-ID field; expanding the entitlement set requires a reviewed source
change or a future server-authoritative resource-list callable.

The production composition uses only these callable contracts through the one
authorization-bound transport with limited-use App Check tokens. Missing
scope or permissions returns a visible fail-closed state and never substitutes
simulated data. Review-sandbox staff cannot proxy or fall back to production.

## Local checks

```sh
npm --prefix staff-portal ci
npm run staff:test
npm run typecheck
npm --prefix staff-portal run typecheck
npm run staff:build
```
