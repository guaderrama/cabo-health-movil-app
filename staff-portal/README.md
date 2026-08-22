# CaboHealth Staff Portal

Separate React/Vite surface for authorized CaboHealth staff at the canonical URL `https://cabohealth.org/staff/`.

## Design brief

- **Audience:** at most four authorized CaboHealth staff/client-access operators.
- **Outcome:** issue or revoke one of four client codes, prepare bilingual resource drafts, inspect a read-only activity feed, and rotate the isolated App Review credential.
- **Emphasis:** current access state and the next safe action.
- **Tone:** calm, clinical, editorial.
- **Density:** balanced; operational data stays scan-friendly without dashboard clutter.
- **Visual idea:** a four-slot ledger, using numbered rows and restrained bronze rules from the approved CaboHealth palette.
- **Constraint:** the portal is a separate web surface; the iPhone app only exposes a visible system-browser link.

## Security boundary

- Firebase App Check is initialized with reCAPTCHA Enterprise.
- Firebase Auth requires a registered TOTP second factor. Browser persistence is session-only.
- The client imports Firebase Auth, App Check, and callable Functions only. It never imports Firestore.
- `adminGetStaffSession` derives scope and permissions on the server. No URL, form, or browser storage can select scope.
- Draft, audit, and App Review administration require a server-derived production scope plus their exact permission. A review-sandbox staff session fails closed before any production callable can run.
- Full client codes and the `AR-…` App Review credential are held in React/controller memory only, copied once, then explicitly cleared after a second confirmation.
- Resource entries are drafts only. There is no publication or runtime-activation operation.
- CSP is present in HTML, portable `_headers`, and Hostinger/Apache `.htaccess`; build source maps are disabled.
- Every callable requests a limited-use App Check token because the production Functions consume replay-protected tokens.
- The release build requires externally pinned `APP_ENV`, project, web App ID, backend App ID parameter, and region. The public config must exactly match those pins. Missing or malformed values stop release builds; ordinary unconfigured test builds use `https://invalid.invalid` and remain closed.
- Callable authorization failures centrally sign out the browser and clear email, password, TOTP, and workspace state so the server's 15-minute freshness boundary always requires a clean email/password plus TOTP sign-in.

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
- `adminCreateClientAccessCode({ slot, expiresAtMs, resourceIds })`
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
