# CaboHealth Secure Backend and Admin Implementation Plan

> **Historical and non-normative:** do not execute unchecked tasks or use this file as current status. Superseded decisions include the two-project staging topology, `reviewSandboxAdmin`/reviewer-staff login, and production MFA/TOTP. Current authority is [ADR 0001](../../decisions/0001-single-firebase-production-project.md), [ADR 0002](../../decisions/0002-password-only-staff-access.md), the client-access, Firebase-activation, and Firestore-containment runbooks, plus dated activation records. Public web, the protected overlay, and password-only Staff are deployed; schema bridge/migration/strict promotion and the Apple RC/TestFlight build remain pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir Firestore abierto, códigos/PIN embebidos y CRUD cliente por un backend Firebase verificable: catálogo público sanitizado, códigos hasheados, sesiones revocables, nonces de lanzamiento, administración con Auth + MFA + rol y auditoría completa.

**Architecture:** Cloud Functions v2 es la única capa que usa Firebase Admin SDK. El shell obtiene el manifiesto sanitizado mediante `GET /v1/catalog` público/cacheable; Firestore no se expone directamente y el catálogo no depende de attestation. Un código válido crea un principal Firebase pseudónimo y un grant ligado a instalación; el SDK nativo administra sus credenciales en Keychain y cada endpoint privado vuelve a comprobar grant + Auth + App Check. El portal de personal usa Firebase Auth con MFA y callables administrativos que aplican rol, revisión optimista, transacciones y release gate.

**Tech Stack:** Node.js 22, TypeScript, Firebase Cloud Functions v2, Firebase Auth/Identity Platform, App Check, Firestore, Secret Manager, Firebase Emulator Suite, Zod contracts, Vitest, `@firebase/rules-unit-testing`, React/Vite para Staff Portal, React Native Firebase para iOS.

## Global Constraints

- No desplegar nada al proyecto legacy `instalacionmariposas` hasta exportarlo y confirmar por escrito su función. Ningún script de este plan usa ese ID como destino por defecto.
- Los aliases remotos operativos serán `cabohealth-staging` y `cabohealth-prod`; cada uno se mapea a un proyecto Firebase dedicado antes del primer deploy. Development usa exclusivamente Emulator Suite con `demo-cabohealth`, no un tercer proyecto remoto ambiguo.
- Emulator usa siempre el ID reservado `demo-cabohealth`; sus secrets son ficticios y nunca se reutilizan fuera del emulador.
- Firestore cliente no puede escribir ninguna colección. Catálogo, grants, códigos, nonces, administración y auditoría sólo pasan por Functions/Admin SDK.
- El valor de un código se devuelve una sola vez al crearlo. Persistencia y lookup usan HMAC versionado; listados muestran únicamente el sufijo.
- App Check reduce abuso, pero cada endpoint también exige autenticación/autorización cuando corresponda, rate limit, idempotencia y validación runtime.
- No hard delete de miniapps, códigos ni auditoría durante operación normal; usar archive/revoke. La acción explícita Delete account elimina principal y grant/datos deletables, y pseudonimiza únicamente la auditoría sujeta a retención.
- Admin puede preparar borradores, pero no publicar un slug fuera del release aprobado. Añadir una miniapp material exige una nueva versión/revisión.
- El manifiesto y catálogo inmutables guardan `releaseId` + versión/build + `contentVersion/artifactHash`, nunca submission ID/estado. Una `ReviewAttestation` privada agrega eventos append-only `candidate → submitted → approved`; submission/approval sólo añaden eventos sin cambiar bytes públicos. Rollback sólo acepta hashes con attestation aprobada; un cambio material del mismo slug crea otro candidate/revisión.
- Los administradores reales requieren MFA. `reviewSandboxAdmin` es una cuenta normal del mismo contexto Firebase Auth con claim y documento activo `scope: 'reviewSandbox'`; puede operar sin segundo factor únicamente sobre repositorios `review_sandbox_*` y nunca recibe permisos de producción. No se configura un directorio de identidad alterno ni un bypass oculto.
- No registrar códigos, installation IDs, tokens, nonces, URLs con nonce, PII o contenido de cliente.
- Los endpoints deben devolver errores tipados y genéricos; no deben permitir enumerar códigos, clientes o entitlements.
- El cambio preexistente de `babel.config.js` pertenece al usuario y queda fuera de todos los commits.
- Escribir primero cada test unitario/integración/reglas, comprobar el fallo esperado, implementar el mínimo y volver a ejecutar antes del commit.
- Cada tarea que añade una Function modifica `functions/src/index.ts` y el test de exports desplegables en el mismo commit; no puede quedar un endpoint implementado pero sin exportar.
- `config/environment-topology.json` contiene la entrada development/emulator y los IDs/URLs públicos exactos de staging/production; es la única topología consumida por Functions, Expo, PHP y release verification. Los secretos siguen fuera de ese archivo.

---

## Dependency and Interface Map

**Consumes**

- `packages/contracts` del plan nativo como fuente canónica de requests, responses y schemas.
- Los tres slugs exactos del release nativo.
- El broker PHP y Client Resources del plan de miniapps/hosting.

**Produces**

- Function HTTP pública `publicApi`: `GET /v1/catalog` y `GET /healthz`.
- Callables privados: `redeemAccessCode`, `refreshSession`, `createLaunchNonce`, `removeClientAccess`, `deleteClientAccount` y operaciones `admin*`.
- Function HTTP HMAC `brokerApi`: `POST /v1/launch/redeem`, `/v1/sessions/introspect` y `/v1/sessions/revoke`.
- Colecciones privadas, reglas cerradas, índices, auditoría y scripts de migración.
- Staff Portal construido en `staff-portal/dist` para desplegar en `https://cabohealth.org/staff/`.
- Adapters nativos de Auth, Functions y App Check consumidos por el shell.

**Authentication contract**

1. `redeemAccessCode` acepta App Check, código transitorio y `DeviceContext`; devuelve `customToken` + `SessionView`.
2. El cliente llama `signInWithCustomToken`; React Native Firebase conserva la credencial de renovación en Keychain. La app nunca la extrae.
3. `refreshSession` exige Auth + App Check y revalida `access_grants/{uid}` e installation hash.
4. `createLaunchNonce` exige Auth + App Check + entitlement y devuelve una URL CaboHealth de 60 segundos.
5. El WebView envía el nonce por POST al broker de `cabohealth.org`; el broker lo canjea server-to-server, establece una cookie HttpOnly de sesión opaca y redirige a URL limpia.

## Target File Map

```text
functions/
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
  .secret.local.example
  src/
    index.ts
    config.ts
    callables/{redeemAccessCode,refreshSession,createLaunchNonce,removeClientAccess,deleteClientAccount}.ts
    callables/admin/{listApps,createApp,updateApp,archiveApp,unpublishApp,activatePreviousRelease,publishRelease,recordReviewAttestation,listCodes,createCode,updateCode,revokeCode,listAuditLogs}.ts
    http/{publicApi,brokerApi}.ts
    domain/{catalog,accessCodes,grants,launch,admin}.ts
    repositories/{catalog,reviewAttestation,accessCode,grant,nonce,audit,rateLimit}.ts
    security/{authorization,appCheck,accessCodeGenerator,codeHash,installationHash,nonce,rateLimit,secrets,urlAllowlist}.ts
    validation/{schemas,normalization}.ts
    tests/{unit,integration}/
staff-portal/
  package.json
  vite.config.ts
  src/{main,App,auth,appCheck,api,i18n}.ts(x)
  src/screens/{SignIn,MfaChallenge,CatalogAdmin,CodeAdmin,AuditLog}.tsx
  src/__tests__/
services/{firebase.native,auth,backend}.ts
features/staff/staffPortal.ts
firebase.json
firestore.rules
firestore.indexes.json
.firebaserc
tools/{migrate-secure-backend,verify-secure-migration,rollback-migration-metadata,bootstrap-admin}.ts
tools/fixtures/emulator-seed.ts
test/rules/firestore.rules.test.ts
docs/operations/{firebase-environments,backend-deploy,admin-recovery,access-code-runbook}.md
config/{environment-topology.schema.json,environment-topology.json}
```

## Task 1: Pin the Firebase toolchain and isolate environments

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `firebase.json`
- Modify: `.firebaserc`
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`
- Create: `functions/vitest.config.ts`
- Create: `functions/.env.example`
- Create: `functions/.secret.local.example`
- Create: `functions/src/config.ts`
- Create: `functions/src/index.ts`
- Create: `functions/src/http/publicApi.ts`
- Create: `functions/src/http/brokerApi.ts`
- Create: `config/environment-topology.json`
- Create: `tools/fixtures/emulator-seed.ts`
- Create: `docs/operations/firebase-environments.md`
- Test: `functions/src/tests/unit/config.test.ts`

- [ ] Require the committed `packages/contracts` gate from Native Task 2, then run the locally pinned Firebase CLI `npm exec -- firebase projects:list` while authenticated and document the legacy project plus dedicated staging/production IDs; create either missing dedicated project before continuing. Development remains the fixed `demo-cabohealth` emulator entry.
- [ ] Write the discovered non-secret IDs into `config/environment-topology.json` and derive/freeze every exact URL defined in the native plan: `publicApi/v1/catalog`, `brokerApi`, each miniapp base, the loopback broker, `https://cabohealth.org/apps-staging/client-resources/launch/` and the production launch URL. No placeholder or arbitrary environment override may remain after this task.
- [ ] Map `.firebaserc` aliases `cabohealth-staging` and `cabohealth-prod`; keep `default` out of deploy scripts so an omitted target fails, and prohibit any deploy to `demo-cabohealth`.
- [ ] Pin `firebase-tools` at the root and `firebase-admin`, `firebase-functions`, `zod`, `vitest`, `typescript` and `@cabohealth/contracts` in `functions/package.json`.
- [ ] Write `config.test.ts` first to reject missing project alias, production deploy from `demo-cabohealth`, absent pepper versions, topology/project mismatch, cross-environment catalog/broker/launch URL, HTTP production origins and a target host outside `cabohealth.org`.
- [ ] Run `npm --prefix functions test -- config.test.ts`; expected result: failure because `config.ts` is incomplete.
- [ ] Implement strict environment parsing plus `publicApi`/`brokerApi` Express shells. `GET /healthz` returns release version, catalog revision and server time but no secrets/user data; `brokerApi` initially returns 404 for every unregistered route.
- [ ] Create `functions/src/index.ts` and export exactly `publicApi` and `brokerApi` at this stage; `/healthz` remains only a route inside `publicApi` and has no standalone Function/export/URL. Subsequent tasks append named callables, and an export-list test must fail on any missing or extra deployable export. Create the base emulator seed here so later tasks modify an existing file.
- [ ] Expand `firebase.json` with Functions, Firestore rules/indexes and Auth/Firestore/Functions Emulator Suite ports. Do not enable Hosting yet.
- [ ] Put only variable names and fictitious emulator values in example files; add all real secret filenames to `.gitignore`.
- [ ] Run `npm --prefix functions run build && npm --prefix functions test`; expected result: exit 0.
- [ ] Commit with `build: isolate Firebase environments and functions`.

## Task 2: Close Firestore and prove the rules before adding APIs

**Files:**

- Replace: `firestore.rules`
- Modify: `firestore.indexes.json`
- Create: `test/rules/firestore.rules.test.ts`
- Modify: `package.json`

- [ ] Write rule tests first for anonymous, authenticated client and admin-claim contexts. Each must fail to read/write `access_codes`, `access_grants`, `apps`, `releases`, `review_attestations`, `published_catalog`, `launch_targets`, `launch_nonces`, `web_sessions`, `admins`, `audit_logs` and `rate_limits` directly.
- [ ] Add a regression test showing that even `catalogAdmin: true` cannot write from a client SDK; administration is Functions-only.
- [ ] Run `npm exec -- firebase emulators:exec --project demo-cabohealth --only firestore "npm run test:rules"`; expected result: current open rules make the denial assertions fail.
- [ ] Replace rules with a default deny for every document. Because catalog is served by the `publicApi` Function through Admin SDK, no direct public Firestore exception is required.
- [ ] Add only indexes required by real repository queries: release membership/status, hash version/status, grant status/expiry, nonce/web-session expiry and audit timestamp. The singleton `published_catalog/current` requires no order index.
- [ ] Re-run emulator rules tests; expected result: all pass and no rule grants client writes.
- [ ] Commit with `security: deny direct Firestore access`.

## Task 3: Implement code hashing, lookup, rate limiting and redemption

**Files:**

- Create: `functions/src/security/codeHash.ts`
- Create: `functions/src/security/accessCodeGenerator.ts`
- Create: `functions/src/security/installationHash.ts`
- Create: `functions/src/security/rateLimit.ts`
- Create: `functions/src/validation/normalization.ts`
- Create: `functions/src/repositories/accessCode.ts`
- Create: `functions/src/repositories/grant.ts`
- Create: `functions/src/repositories/rateLimit.ts`
- Create: `functions/src/repositories/audit.ts`
- Create: `functions/src/domain/accessCodes.ts`
- Create: `functions/src/domain/grants.ts`
- Create: `functions/src/callables/redeemAccessCode.ts`
- Test: `functions/src/tests/unit/codeHash.test.ts`
- Test: `functions/src/tests/unit/rateLimit.test.ts`
- Test: `functions/src/tests/integration/redeemAccessCode.test.ts`

- [ ] Write unit tests for normalization, constant-time HMAC comparison, active/previous pepper versions, lazy lookup rotation and logs that never include input/digest. Add CSPRNG format/entropy tests (minimum 128 bits) and a large collision-free fixture; never use `Math.random`.
- [ ] Write rate-limit tests for five failures in fifteen minutes, fifteen-minute lock, distinct hashed buckets and successful redemption clearing only the appropriate failure state.
- [ ] Write integration tests first for valid, invalid, expired, revoked, device limit, retry with same `requestId`, concurrent redemption and App Check absence.
- [ ] Run the focused tests; expected result: failures because repositories/callable do not exist.
- [ ] Implement `access_codes/{codeId}` with `status`, `displaySuffix`, `hashVersion`, expiry, max devices, entitlements and revision; implement `access_code_lookup/{version_digest}` without plaintext.
- [ ] In one transaction, validate lookup/status/expiry/rate limit, bind a hashed installation, create/reuse deterministic Auth UID + grant, update last seen and append sanitized audit metadata.
- [ ] Return a short-lived Firebase custom token and `SessionView`; do not return or retain the original code. Enforce App Check and optional replay protection supported by the pinned SDK.
- [ ] Map invalid/revoked/expired/device-limit redemption to public `invalid_access`; expose only rate limit/upgrade separately. Authenticated refresh may report revoked/expired/device mismatch.
- [ ] Run unit and emulator integration tests; expected result: all pass including concurrent idempotency.
- [ ] Commit with `feat: redeem hashed client access codes`.

## Task 4: Implement refresh, revocation and native Auth/App Check adapters

**Files:**

- Create: `functions/src/callables/refreshSession.ts`
- Create: `functions/src/callables/removeClientAccess.ts`
- Create: `functions/src/callables/deleteClientAccount.ts`
- Create: `functions/src/security/authorization.ts`
- Modify: `functions/src/domain/grants.ts`
- Create: `services/firebase.native.ts`
- Create: `services/auth.ts`
- Create: `services/backend.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `functions/src/tests/integration/refreshSession.test.ts`
- Test: `functions/src/tests/integration/deleteClientAccount.test.ts`
- Test: `features/access/__tests__/nativeBackendAdapter.test.ts`

- [ ] Write integration tests first for active, expired, revoked, wrong installation, minimum-version failure, offline-until calculation, explicit remove access and full delete account/data.
- [ ] Run `npm --prefix functions test -- refreshSession deleteClientAccount`; expected result: fail before guards/callables exist.
- [ ] Implement a reusable authorization guard that checks Auth, App Check, grant status, expiry, installation hash and minimum app version on every protected callable.
- [ ] On Remove, revoke grant and web sessions transactionally, append audit, call `revokeRefreshTokens(uid)` and return no sensitive reason. On Delete, additionally delete the Firebase Auth principal and deletable data, pseudonymize legally retained audit, and return a completion receipt before local cleanup.
- [ ] Add React Native Firebase `app`, `auth`, `functions` and `app-check` packages. Native `app.config.ts` remains solely owned by the native plan and selects the correct service files/provider by `APP_ENV`; keep Firebase JS only for Staff Portal/web.
- [ ] Configure App Attest with DeviceCheck fallback for production and a debug provider only in development builds. Debug tokens live in local/EAS secrets, never repository files.
- [ ] Implement adapters: redeem callable, immediate `signInWithCustomToken`, forced ID-token refresh when requested, callable refresh and local sign-out. Application code never reads the Firebase refresh token.
- [ ] Verify emulator tests with debug App Check and a development build; then verify real attestation on a TestFlight staging build because Emulator does not prove App Attest.
- [ ] Run `npm --prefix functions test && npm test -- features/access/__tests__/nativeBackendAdapter.test.ts && npm run typecheck`; expected result: all pass.
- [ ] Commit with `feat: add revocable authenticated client sessions`.

## Task 5: Serve a sanitized, release-gated public catalog over HTTP

**Files:**

- Create: `functions/src/repositories/catalog.ts`
- Create: `functions/src/domain/catalog.ts`
- Modify: `functions/src/http/publicApi.ts`
- Create: `functions/src/tests/unit/catalog.test.ts`
- Create: `functions/src/tests/integration/publicCatalog.test.ts`
- Modify: `tools/fixtures/emulator-seed.ts`

- [ ] Seed an emulator release record whose immutable slug list is exactly the three approved miniapps and whose manifest metadata matches the shared contract.
- [ ] Write tests first that reject draft/retired apps, missing privacy/data-use fields, non-HTTPS URLs, unauthorized hosts, duplicate order, an extra fourth slug and an app version absent from the active release.
- [ ] Run focused tests; expected result: failure because publication logic is missing.
- [ ] Implement `apps` as full administrative documents, `releases` as immutable membership with `releaseId` + version/build/hashes, `published_catalog/current` as a sanitized atomic snapshot, and private `review_attestations/{releaseId}/events/{eventId}` as append-only state evidence. The frozen candidate is active and reviewable before a submission ID exists; attestation events never enter or rewrite public bytes.
- [ ] Treat the signed web `release-manifest.json` as canonical input; store its normalized manifest/hash in `published_catalog/current` and make verification compare it with contracts and native upper-bound allowlist.
- [ ] Mount `GET /v1/catalog` under the already exported `publicApi` Function with no Auth requirement, no mandatory App Check, strict GET/CORS policy, ETag and `Cache-Control: public, max-age=60, stale-if-error`; return no code/client/target secrets. App Check may be observed only as non-authorizing telemetry.
- [ ] Validate the whole snapshot at publication and again before response. A bad draft cannot poison the last valid published snapshot.
- [ ] Add short public cache plus an immediate rollback/kill-switch path. The initial snapshot must contain all three; runtime snapshots may contain any approved subset and can never add an unknown slug.
- [ ] Run unit/integration tests and compare the JSON to the three-app fixture in `packages/contracts`; expected result: byte-stable normalized output.
- [ ] Commit with `feat: publish sanitized CaboHealth catalog`.

## Task 6: Implement one-time launch nonces and the Client Resources broker contract

**Files:**

- Create: `functions/src/security/nonce.ts`
- Create: `functions/src/security/urlAllowlist.ts`
- Create: `functions/src/repositories/nonce.ts`
- Create: `functions/src/domain/launch.ts`
- Create: `functions/src/callables/createLaunchNonce.ts`
- Modify: `functions/src/http/brokerApi.ts`
- Test: `functions/src/tests/unit/nonce.test.ts`
- Test: `functions/src/tests/integration/launchNonce.test.ts`
- Create: `docs/operations/launch-broker-contract.md`

- [ ] Write tests first for CSPRNG entropy/format, 60-second expiry, hashed storage, one-time transaction, device mismatch, wrong app/grant, missing entitlement, replay, expired nonce and unapproved target/path.
- [ ] Run `npm --prefix functions test -- nonce launchNonce`; expected result: fail before nonce/web-session implementation.
- [ ] Define an environment-scoped `launch_targets/client-resources`: development uses the fixed loopback launch path, staging uses `/apps-staging/client-resources/launch/`, and production uses `/apps/client-resources/launch/`; audience remains `client` and the broker service identity is bound to that environment.
- [ ] Implement `createLaunchNonce` to require `requestId`, app ID and `DeviceContext`, then return exactly `activeEnvironment.clientLaunchUrl`, `method: POST`, opaque nonce and expiry; reject a stored target from any other environment and never place a nonce in a URL.
- [ ] Mount signed server-to-server routes under `brokerApi`: `/v1/launch/redeem`, `/v1/sessions/introspect` and `/v1/sessions/revoke`. Verify canonical version, environment, audience, method, lowercase host, exact path, timestamp, request ID and SHA-256 of raw body bytes before parsing; require a distinct staging/production key ring and reject cross-route/cross-project/cross-environment signatures. Redemption consumes the nonce atomically and creates hashed `web_sessions/{sessionHash}` linked to grant/app/expiry.
- [ ] Return only opaque `webSessionId`, app ID and expiry needed for a cookie. Client/grant mappings remain server-side; do not return code, subject mapping, display name, PII, medical data or reusable Firebase credential.
- [ ] Implement signed `introspectClientSession` for PHP. It checks web session + live grant/revocation on every request (positive cache at broker ≤30 seconds); Remove/Delete/Revoke invalidates all linked web sessions and the next request becomes 401 within that bound.
- [ ] Implement idempotent signed S2S `revokeClientSession({requestId, webSessionId, reason:'logout'}) -> {revokedAtMs}`. Revoke the stored session before PHP expires its cookie; a copied pre-logout cookie must receive 401.
- [ ] Document exact request signing, cookie claims, `Referrer-Policy: no-referrer`, redirect-to-clean-URL behavior and rotation procedure for the broker secret.
- [ ] Configure Firestore TTL for nonce expiry as cleanup only; authorization must still check expiry synchronously.
- [ ] Run nonce unit/integration tests including 100 concurrent redemption attempts where exactly one succeeds.
- [ ] Commit with `feat: issue one-time client resource launches`.

## Task 7: Build audited admin APIs with an immutable release gate

**Files:**

- Create: `functions/src/security/adminAuthorization.ts`
- Create: `functions/src/domain/admin.ts`
- Create: `functions/src/callables/admin/listApps.ts`
- Create: `functions/src/callables/admin/createApp.ts`
- Create: `functions/src/callables/admin/updateApp.ts`
- Create: `functions/src/callables/admin/archiveApp.ts`
- Create: `functions/src/callables/admin/unpublishApp.ts`
- Create: `functions/src/callables/admin/activatePreviousRelease.ts`
- Create: `functions/src/callables/admin/publishRelease.ts`
- Create: `functions/src/callables/admin/recordReviewAttestation.ts`
- Create: `functions/src/callables/admin/listCodes.ts`
- Create: `functions/src/callables/admin/createCode.ts`
- Create: `functions/src/callables/admin/updateCode.ts`
- Create: `functions/src/callables/admin/revokeCode.ts`
- Create: `functions/src/callables/admin/listAuditLogs.ts`
- Test: `functions/src/tests/integration/adminCatalog.test.ts`
- Test: `functions/src/tests/integration/adminCodes.test.ts`

- [ ] Write authorization tests first for no Auth, no App Check, missing `catalogAdmin` claim, inactive `admins/{uid}`, absent MFA evidence, stale auth time, insufficient permission, client-supplied scope, an alternate identity-directory selector, and a `reviewSandboxAdmin` attempting any production operation or production resource ID.
- [ ] Require active admin document, custom claim, successful second factor and recent sign-in for every production mutation; claims alone never override an inactive admin record. Resolve `scope: 'production' | 'reviewSandbox'` only from verified server identity and route `reviewSandboxAdmin` only to isolated `review_sandbox_*` repositories.
- [ ] Prove the non-expiring review role can exercise create/edit/archive/publish/code/audit against seeded sandbox data, automatically resets without touching production and cannot address any production resource ID.
- [ ] Write CRUD tests for schema validation, HTTPS/host checks, optimistic `expectedRevision`, atomic audit before/after/reason and archive rather than delete.
- [ ] Write publication/attestation tests for immutable release bytes plus server-only append events `candidate → submitted → approved`. Require exact `releaseId`, version/build and artifact hashes; reject skipped/repeated transitions, changed manifest/catalog bytes, mismatched submission/build, missing seller/business approval, unknown slug, age above host, incomplete metadata, or rollback to a hash without an approved event.
- [ ] Write code tests that return plaintext exactly once, list only suffix, enforce max devices/expiry/entitlements and revoke all related grants/sessions atomically.
- [ ] Implement each mutation with transactions/batches and a stable `requestId` idempotency record. `publishRelease` writes the first `candidate` event atomically with activation. `adminRecordReviewAttestation` is production-admin/MFA only (never review sandbox), appends only the legal `submitted`/`approved` successor and recomputes the frozen hash before accepting it. A retry must not duplicate code, audit event, attestation event or release.
- [ ] Run emulator integration tests with seeded admin contexts; expected result: all pass and all unauthorized variants fail closed.
- [ ] Commit with `feat: add audited catalog administration`.

## Task 8: Replace the hidden in-app panel with a visible MFA Staff Portal

**Files:**

- Create: `staff-portal/package.json`
- Create: `staff-portal/vite.config.ts`
- Create: `staff-portal/src/main.tsx`
- Create: `staff-portal/src/App.tsx`
- Create: `staff-portal/src/auth.ts`
- Create: `staff-portal/src/appCheck.ts`
- Create: `staff-portal/src/api.ts`
- Create: `staff-portal/src/i18n.ts`
- Create: `staff-portal/src/screens/SignIn.tsx`
- Create: `staff-portal/src/screens/MfaChallenge.tsx`
- Create: `staff-portal/src/screens/CatalogAdmin.tsx`
- Create: `staff-portal/src/screens/CodeAdmin.tsx`
- Create: `staff-portal/src/screens/AuditLog.tsx`
- Create: `staff-portal/src/screens/ReleaseAdmin.tsx`
- Create: `staff-portal/src/__tests__/authorization.test.tsx`
- Create: `staff-portal/src/__tests__/catalogAdmin.test.tsx`
- Create: `features/staff/staffPortal.ts`

- [ ] Write portal tests first for signed-out, password success requiring second factor, inactive admin, read-only permission, revision conflict, publish gate failure and one-time code reveal.
- [ ] Run `npm --prefix staff-portal test`; expected result: fail before Auth/App Check/screens exist.
- [ ] Implement Firebase Auth sign-in and MFA resolver for real staff. Do not offer a local PIN, master code or security-question bypass. Keep the documented Apple account in the primary Firebase Auth context with verified server claim/document `scope: 'reviewSandbox'`; select repository scope only from that server-verified identity, never from a client toggle or alternate identity directory.
- [ ] Add portal tests proving the server-derived scope controls every screen/API result, the UI has no production/sandbox switch, and the review account cannot address or infer production IDs.
- [ ] Enable web App Check with reCAPTCHA Enterprise for the Staff Portal and enforce it on every admin callable; development uses only an explicitly configured local debug token.
- [ ] Implement catalog draft/edit/archive/unpublish/order/review-ready/publish/activate-previous screens using only admin callables; never initialize a Firestore client in the portal.
- [ ] Add a production-MFA-only Release Admin screen that displays immutable release/version/build/hashes and invokes `adminRecordReviewAttestation` for the next legal transition. It never edits manifest/catalog bytes and is unavailable to `reviewSandboxAdmin`.
- [ ] Implement code create/edit/revoke with a one-time reveal/copy acknowledgment and a list that shows suffix/status only.
- [ ] Show immutable paginated audit entries through `adminListAuditLogs` with actor, resource, action, timestamp and sanitized before/after metadata.
- [ ] Build with no sourcemap in production and strict CSP-compatible assets. The only production origin is `https://cabohealth.org/staff/`.
- [x] **Superseded 2026-08-24:** remove the native `Staff Sign In` row and Staff URL from the consumer binary. Keep the owner portal reachable only by direct web URL and document that exclusion in Review Notes.
- [ ] Run portal tests/build; scan built files with a tool that reports only `file:category`, permits documented public Firebase configuration, and never prints matching secret values. Confirm no private secret/bypass/source map.
- [ ] Commit with `feat: add secure CaboHealth staff portal`.

## Task 9: Migrate legacy data without reopening production

**Files:**

- Create: `tools/migrate-secure-backend.ts`
- Create: `tools/verify-secure-migration.ts`
- Create: `tools/rollback-migration-metadata.ts`
- Create: `tools/bootstrap-admin.ts`
- Modify: `tools/fixtures/emulator-seed.ts`
- Create: `tools/legacy-app-map.json`
- Create: `tools/__tests__/migration.test.ts`
- Create: `docs/operations/access-code-runbook.md`
- Create: `docs/operations/admin-recovery.md`

- [ ] Make every tool default to `--dry-run` and require both `--project-alias` and `--confirm-project-id`; reject `default`, unknown aliases and production without a separately typed confirmation.
- [ ] Write tests first for dry run, idempotent second run, preserved app IDs, duplicate clients, codes without expiry, no plaintext output, checkpoints and rollback metadata.
- [ ] Run the migration-focused tests against fixtures; expected result: fail before tools/mapping/checkpoints exist.
- [ ] Export the legacy Firestore project to a restricted bucket before reads; record counts/checksum and freeze the old admin UI during the migration window.
- [ ] Define an explicit reviewed `legacyId -> approvedSlug | archive` map; new miniapps receive deterministic release IDs, no match occurs by display name, and only a verified ID/URL/slug mapping may be preserved.
- [ ] Convert legacy plaintext codes inside the Admin process to versioned HMAC documents/lookups. Codes without expiry become `needs_review`; only `purpose: app_review` may have null expiry and requires separate `reviewCredentialManager` permission.
- [ ] Bootstrap the first real admin by UID only after MFA enrollment, then set custom claim and active admin document with least privilege. Document two-person recovery/revocation.
- [ ] Verify the migration against staging, run it a second time with zero changes, then rehearse functional rollback without restoring open rules.
- [ ] Commit with `feat: add safe backend migration tooling`.

## Task 10: Prove staging and close production with a non-RC integration build

**Files:**

- Create: `docs/operations/backend-deploy.md`
- Modify: `eas.json`
- Create: `scripts/verify-backend-release.mjs`
- Create: `scripts/verify-backend-release.test.mjs`

- [ ] Store the versioned code/installation peppers plus separate staging and production broker HMAC key rings in each project's Secret Manager; a key value/key ID is never reused across environments. Record versions, owners and rotation dates without values.
- [ ] Write verification-script tests first for wrong project/region, open rule, cross-environment URL/key ID, unsanitized output and missing integration release; run `node --test scripts/verify-backend-release.test.mjs` and confirm failure before implementing the verifier.
- [ ] Run `npm exec -- firebase emulators:exec --project demo-cabohealth --only auth,firestore,functions "npm --prefix functions run test:emulator"`, root tests and migration verification; require exit 0.
- [ ] Deploy Functions, indexes and closed rules to the exact staging project in `environment-topology.json`, then seed only synthetic clients and the three-app integration release. Verify `publicApi` and `brokerApi` directly; the web broker is intentionally not required yet.
- [ ] Pause this task and execute Miniapps Task 7 in staging mode plus Task 8 through the verified `/apps-staging/` deployment. Resume only when PHP uses the exact staging `brokerApi`, all three staging URLs pass and AASA excludes them.
- [ ] Build an iOS development/preview candidate with staging Google service config and test real App Attest, redeem, refresh, revoke, rate limit and nonce on a physical device.
- [ ] Run only the redacted scanner over sources plus generated JS/native bundles to prove absence of master code, PIN, broker secret, peppers and plaintext client codes. It may use `rg` internally for discovery but output is restricted to `file:category`; never print a matching line/value into terminal or saved logs.
- [ ] Back up production and deploy new schema/API additively. Build a clearly marked internal integration build (not RC), test migration/production compatibility in TestFlight, then migrate, verify counts/IDs/zero plaintext, close rules and revoke legacy bypass paths.
- [ ] After closed production passes, discard the integration build for submission purposes. Do not publish the App Store candidate or provision final review credentials yet; App Store Task 1 must now reserve a higher build. Rollback may restore metadata/functions but never public write rules.
- [ ] Commit staging/integration evidence with `ops: verify CaboHealth backend integration`.

## Task 11: Bind the reserved production web release and attest the candidate

**Files:**

- Modify: `docs/operations/backend-deploy.md`
- Modify: `scripts/verify-backend-release.mjs`
- Modify: `scripts/verify-backend-release.test.mjs`
- Create: `docs/qa/backend-production-binding.md`

- [ ] Require App Store Task 1's committed `releaseId` + version/build reservation and Miniapps Task 9's completed activation/public-smoke phase with active production manifest/hashes. Reject staging artifacts, a changed reservation or any manifest containing submission state/ID.
- [ ] Add failing fixtures for a mismatched release ID/build/hash, missing/duplicate candidate event and public bytes that change during attestation; then implement the production-binding checks and rerun the focused test.
- [ ] In one audited production operation, ingest the exact immutable web manifest, publish the sanitized catalog snapshot and append the first private `candidate` attestation event with matching release/version/build/hashes. Verify public bytes before/after the attestation record are identical.
- [ ] Provision and verify in the exact production project the stable client demo credential plus `reviewSandboxAdmin` routed only to production-project `review_sandbox_*` collections; test the exact public `/staff/` URL and clean-install client flow. Production bundle/config scans must find no loopback, staging project ID or `/apps-staging/` URL.
- [ ] Run `scripts/verify-backend-release.mjs` against production health, catalog, immutable manifest digest, candidate attestation, invalid code, demo code, revoke/reissue and one-time nonce; redact all credentials in saved output.
- [ ] Record sanitized IDs/hashes/evidence in `docs/qa/backend-production-binding.md` and commit with `ops: bind CaboHealth production candidate`.

## Plan Acceptance Gate

- [ ] Emulator rules prove that no client, including admin claim, can directly read/write private Firestore collections.
- [ ] Initial catalog is publicly usable without account or App Check and contains exactly three sanitized entries; runtime may serve only an approved subset for emergency withdrawal and never an unknown slug.
- [ ] Valid, invalid, expired, revoked, device-limited and rate-limited code paths are tested; no plaintext remains at rest.
- [ ] Sessions are installation-bound, revocable and revalidated; offline never creates new private access.
- [ ] Launch nonce succeeds once within 60 seconds and every replay/wrong-app/wrong-entitlement path fails.
- [ ] Staff Portal requires real Firebase Auth + MFA + role for production; the documented Apple sandbox role is isolated, audited and unable to read/mutate production.
- [ ] Production deploy, migration and rollback runbooks are reproducible and do not target `instalacionmariposas` accidentally.
- [ ] Backend and Staff Portal are stable before generating the App Store release candidate.
