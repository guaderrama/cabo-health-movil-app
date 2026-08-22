# Staff Portal release gate

The Staff Portal is a separate security boundary and release artifact. It is separate from the immutable `cabohealth-public-web-v1` capsule. It is never added to,
assembled by, or promoted with that public capsule. Its only production promotion target is the
directory `public_html/staff`, served at exactly
`https://cabohealth.org/staff/`.

No command in this runbook deploys or changes Hostinger. The operator must use
an independently approved deployment channel only after every pre-promotion
gate succeeds.

## 1. Pin the deployment identity outside the repository

The approved release system must inject all values. Never commit them to an
`.env` file:

- `APP_ENV=production` (only `production` can become an artifact; `staging` is
  accepted for isolated builds but cannot target production)
- `STAFF_EXPECTED_FIREBASE_PROJECT_ID` — exact reviewed production project ID,
  ending in `-prod`
- `STAFF_EXPECTED_FIREBASE_WEB_APP_ID` — exact reviewed `1:…:web:…` App ID
- `STAFF_WEB_FIREBASE_APP_ID` — the exact value configured in the deployed
  Functions parameter of the same name
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and
  `VITE_FIREBASE_APPCHECK_ENTERPRISE_SITE_KEY`
- `VITE_FIREBASE_FUNCTIONS_REGION=us-central1`

The build fails unless the public project/App ID, external expected pins, and
backend `STAFF_WEB_FIREBASE_APP_ID` all match. The Auth domain must be exactly
`<projectId>.firebaseapp.com`. Confirm independently that Functions were
deployed to the same exact project; neither a `cabohealth-*` prefix nor a
syntactically valid App ID is sufficient authority.

## 2. Build and create a separate immutable manifest

From the repository root, with the approved environment injected:

```sh
npm run staff:build
npm --prefix staff-portal run release:artifact -- --dist dist --out /approved/evidence/staff-portal-artifact.json
```

The artifact command refuses overwrite, symlinks, source maps, missing
security files, non-production identities, and unexpected deployment targets.
It emits three independent pins. Record `releaseId`, `inventorySha256`, and
`artifactSha256` in the append-only release evidence. Do not infer or replace
these pins during promotion. They are passed to the verifier as
`expectedReleaseId`, `expectedInventorySha256`, and `expectedArtifactSha256`;
omitting any one fails closed.

Before copying any byte, provide those recorded values as
`STAFF_EXPECTED_RELEASE_ID`, `STAFF_EXPECTED_INVENTORY_SHA256`, and
`STAFF_EXPECTED_ARTIFACT_SHA256`, then verify the unchanged directory:

```sh
npm --prefix staff-portal run release:verify-artifact -- \
  --dist dist \
  --manifest /approved/evidence/staff-portal-artifact.json
```

Promote that exact verified directory as one staff-only unit to
`public_html/staff`. Do not add it to `release/web-artifacts.json`, do not run a
public-web capsule promoter for it, and do not use a broad `--delete` against
`public_html`.

## 3. Verify the live server, not `.htaccess`

The versioned `.htaccess` and `_headers` files are defense in depth. Hostinger
or an upstream proxy may ignore either one, so their presence is not release
evidence. If necessary, configure the same policy in hPanel/Apache/CDN before
promotion. Stop if that cannot be done.

With the same three recorded pins, run:

```sh
npm --prefix staff-portal run release:verify-live -- \
  --manifest /approved/evidence/staff-portal-artifact.json
```

This performs redirect-disabled, byte-for-byte checks against the pinned
manifest. It requires exact status, content type, no `Set-Cookie`, and the
exact security policy on HTML, JavaScript, CSS, and the protected 404 fallback.
The unknown-route probe must be a protected `404`; serving `index.html`, a
redirect, an unprotected error page, or any mismatched byte fails closed.

The required live headers on every checked response are:

- `Cache-Control: no-store`
- the artifact's exact CSP with only the pinned Functions origin
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

Retain the manifest, all three pins, build logs, local verification result, and
live verification result together. A rollback must restore a previously pinned
Staff Portal artifact and repeat the same live verification; it must not alter
the public capsule or any mini-app path.
