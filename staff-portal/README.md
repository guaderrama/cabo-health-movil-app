# CaboHealth Staff Portal

Separate React/Vite surface for authorized CaboHealth staff at the canonical URL `https://cabohealth.org/staff/`.

## Design brief

- **Audience:** at most four authorized CaboHealth staff/client-access operators.
- **Outcome:** issue or revoke one of four client codes, prepare bilingual resource drafts, and inspect a read-only activity feed.
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
- Production and review-sandbox transports use disjoint callable names. The review transport is unavailable until its separate backend exists; it cannot fall back to production.
- Full client codes are held in React/controller memory only, copied once, then explicitly cleared.
- Resource entries are drafts only. There is no publication or runtime-activation operation.
- CSP is present in HTML, portable `_headers`, and Hostinger/Apache `.htaccess`; build source maps are disabled.
- Every callable requests a limited-use App Check token because the production Functions consume replay-protected tokens.
- The build validates the non-secret Firebase project/region and replaces the CSP template with one exact Functions origin. Missing or malformed values produce `https://invalid.invalid`, so an unconfigured build remains closed.

## Required production environment

Set these at build time in the approved deployment system; do not commit values:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_APPCHECK_ENTERPRISE_SITE_KEY`
- `VITE_FIREBASE_FUNCTIONS_REGION` (defaults to `us-central1`)

The portal fails closed with a bilingual setup message when configuration is absent.
It also rejects the legacy project and every non-dedicated identity: the project
ID must start with `cabohealth-`, the Auth domain must be exactly
`<projectId>.firebaseapp.com`, the App ID must be a Firebase web App ID, and the
Functions region must be exactly `us-central1`.
Deploy only the generated `dist/` directory, never the `public/` templates directly. Hostinger must allow Apache `mod_headers` and `mod_rewrite` for the versioned `.htaccess` to enforce headers and client-side routing.

## Backend contracts

Connected code callables:

- `adminGetStaffSession({})`
- `adminListClientAccessCodes({})`
- `adminCreateClientAccessCode({ slot, expiresAtMs, resourceIds })`
- `adminRevokeClientAccessCode({ codeId })`

For this release candidate, code issuance grants the single reviewed entitlement
`client-resources`. Before activation, seed an active
`_private_client_resources/client-resources` document exactly as specified by
the backend operations runbook. The portal deliberately has no arbitrary
resource-ID field; expanding the entitlement set requires a reviewed source
change or a future server-authoritative resource-list callable.

Deferred and visibly fail-closed adapters (must receive approved server contracts before enabling the UI):

- `CatalogDraftGateway.list/create/update/archive`
- `AuditGateway.list`

No callable names or response schemas are assumed for those two adapters. The current production composition injects unavailable gateways, returns no simulated data, and renders a visible unavailable state.

There is intentionally no publish callable. Review-sandbox equivalents must use a separate repository/claim and `reviewSandbox…` callable namespace; they must never proxy or fall back to production.

## Local checks

```sh
npm --prefix staff-portal ci
npm run staff:test
npm run typecheck
npm --prefix staff-portal run typecheck
npm run staff:build
```
