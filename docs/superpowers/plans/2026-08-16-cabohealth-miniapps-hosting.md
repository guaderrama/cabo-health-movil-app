# CaboHealth Miniapps and Hosting Implementation Plan

> **Current-state note (2026-08-24):** This file preserves the historical
> implementation plan and its original checkboxes. Production status is
> authoritative only in the dated activation records under `docs/operations/`.
> The public web, protected overlays, Firestore schema-2 migration, and final
> strict Functions reader are deployed and verified; unchecked historical
> steps below must not be read as current deployment state.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir y desplegar las tres miniapps iniciales y la superficie web de soporte con el estilo cinematográfico CaboHealth aprobado, contenido bilingüe útil, accesibilidad, navegación estable, Client Resources protegido y Universal Links válidos.

**Architecture:** `miniapps/` es un workspace web independiente con tres aplicaciones Vite y un paquete UI compartido. Healthy Recipes y Clinic Guide son bundles estáticos públicos con CSP y rewrites propios. Client Resources entrega solamente shell/assets públicos; un broker PHP recibe el nonce por POST, crea una sesión opaca revocable y sirve contenido general desde un release privado fuera de `public_html`. Los artefactos público/privado versionados se activan juntos tras respaldo y QA.

**Tech Stack:** React, Vite, TypeScript, CSS motion/SVG, i18next, Zod, Vitest/Testing Library, Playwright, axe-core, PHP 8.2, WordPress/Hostinger, SSH/rsync, Apple Associated Domains.

## Global Constraints

- Desplegar únicamente bajo `~/domains/cabohealth.org/`; nunca leer, escribir, respaldar ni ejecutar comandos dentro de `ivanguaderrama.com`.
- No cambiar DNS, MX, registrador, correo, tema de WordPress ni plugins existentes salvo que una tarea lo autorice de forma explícita.
- Crear respaldo verificable de base de datos y archivos antes de cualquier cambio remoto. `wp db export` no es válido en este hosting; usar el `mysqldump` documentado.
- No usar Media Library ni editar el tema para alojar miniapps. Publicar artefactos versionados bajo `public_html/apps/` mediante symlink/release directory.
- Healthy Recipes y Clinic Guide no solicitan cuenta, código, cámara, micrófono, fotos, ubicación precisa ni datos de salud.
- Client Resources no contiene PHI ni datos personales; su bundle público no contiene el material exclusivo ni una copia legible del contenido privado.
- No claims de diagnóstico, tratamiento, prevención o recomendación personalizada. Toda afirmación médica restante requiere fuente primaria visible y revisión de contenido.
- Todo contenido, fotografía e icono debe ser original de CaboHealth, de dominio público o contar con licencia registrada en el inventario.
- Inglés y español deben tener paridad funcional y legal; inglés es fallback.
- No analytics, fingerprints, advertising SDKs ni cookies no esenciales en v1.
- La animación molecular respeta `prefers-reduced-motion`, pausa en `visibilitychange` y nunca impide leer o accionar controles.
- No sobrescribir un artefacto activado. Cada release es inmutable, tiene checksum y rollback al symlink anterior.
- Cada hash activable se liga de forma inmutable a `releaseId` + versión/build. Submission/estado viven sólo en la attestation privada del backend; un cambio material dentro del mismo slug requiere nueva revisión y rollback sólo usa un hash con attestation aprobada.
- Staging se sirve únicamente bajo `https://cabohealth.org/apps-staging/`, usa el proyecto/broker staging de `config/environment-topology.json`, queda fuera de AASA y nunca aparece en el manifiesto o binario production.
- La llave privada SSH nunca entra en el repositorio o logs. El cambio preexistente de `babel.config.js` queda fuera de los commits.
- Aplicar TDD: prueba roja, implementación mínima, prueba verde, inspección visual y commit por tarea.

---

## Dependency and Interface Map

**Consumes**

- Brand y decisiones visuales de la especificación aprobada.
- Contratos de catálogo de `packages/contracts`.
- Topología pública exacta de `config/environment-topology.json`.
- `redeemLaunchNonce` y secreto server-to-server del plan de backend.
- `staff-portal/dist` del plan de backend para `/staff/`.

**Produces**

- `https://cabohealth.org/apps/healthy-recipes/`
- `https://cabohealth.org/apps/clinic-guide/`
- `https://cabohealth.org/apps/client-resources/`
- `https://cabohealth.org/app/privacy/`, `/app/terms/`, `/app/support/`
- `https://cabohealth.org/.well-known/apple-app-site-association`
- Manifiesto de release con hashes y link-check report.

**Client Resources browser flow**

1. WebView envía POST al `clientLaunchUrl` exacto del ambiente con `Content-Type: application/x-www-form-urlencoded;charset=UTF-8` y body `nonce=${encodeURIComponent(nonce)}`; GET con nonce se rechaza.
2. PHP no registra body/nonce, firma una solicitud server-to-server y canjea una sola vez.
3. PHP deriva cookie/path de la topología: staging usa `__Secure-cabo_client_staging` + `/apps-staging/client-resources/`; production usa `__Secure-cabo_client` + `/apps/client-resources/`. Ambas son host-only, HttpOnly, Secure, SameSite=Lax y duran máximo 60 minutos; development usa una cookie local separada no desplegable.
4. Responde `302` al `clientResourceBasePath` del mismo ambiente sin query.
5. El shell web solicita `${clientResourceBasePath}api/resources/`; PHP introspecta la sesión/grant revocable (caché positiva ≤30 s) y carga el release privado del mismo ambiente fuera del docroot.
6. Expiración/revocación devuelve 401 y muestra una pantalla localizada para volver a abrir desde la app.

Los punteros privados son físicamente independientes: staging usa `~/domains/cabohealth.org/private/staging/releases/<integration-release-id>/` y `private/staging/current`; production usa `~/domains/cabohealth.org/private/production/releases/<release-id>/` y `private/production/current`. El broker recibe su environment desde configuración validada fuera del docroot y no acepta elegirlo desde request/cookie. Ningún deploy o rollback puede leer o repuntar el puntero del otro ambiente.

## Target File Map

```text
miniapps/
  package.json
  playwright.config.ts
  vitest.workspace.ts
  packages/ui/src/{brand,motion,layout,legal,accessibility}.ts(x)
  packages/ui/src/styles/{tokens,global,motion}.css
  apps/healthy-recipes/src/{main,App,routes,store}.ts(x)
  apps/healthy-recipes/src/content/{en,es}.json
  apps/clinic-guide/src/{main,App,routes}.ts(x)
  apps/clinic-guide/src/content/{en,es}.json
  apps/client-resources/src/{main,App,api,session}.ts(x)
  apps/client-resources/src/content/public-{en,es}.json
  tests/e2e/
web-hosting/cabohealth.org/
  .well-known/apple-app-site-association
  .well-known/.htaccess
  apps/client-resources/launch/index.php
  apps/client-resources/api/resources/index.php
  apps/client-resources/lib/session.php
client-resources-private/
  schema.json
  content/{en,es}.json
  app/{privacy,terms,support}/index.html
  release-manifest.json
tools/hosting/{assemble-release,verify-release,deploy-hostinger,rollback-hostinger}.mjs
docs/content/{source-inventory,medical-review,translation-review}.md
docs/operations/{hostinger-access,hostinger-backup,hostinger-deploy}.md
```

## Task 0: Prove Hostinger capabilities before committing to the deployment design

**Files:**

- Create: `docs/operations/hostinger-capability-report.md`

- [ ] Confirm SSH-key authorization and verified host fingerprint, then run read-only checks for exact CaboHealth docroot, PHP 8.2, WP-CLI, disk space and current LiteSpeed/Apache behavior; abort if the resolved path is outside `~/domains/cabohealth.org/`.
- [ ] In one uniquely named temporary CaboHealth-only directory, prove symlink following, `.htaccess` rewrite/headers, extensionless JSON MIME, PHP POST body handling and filesystem permissions. Remove only that resolved temp directory after recording results.
- [ ] Verify that a release directory outside `public_html` can be read by PHP but not fetched over HTTPS, and that atomic symlink replacement works on this Hostinger account.
- [ ] Record exact supported deployment mechanism and fallbacks. If any capability fails, update Tasks 5/7/8 before building rather than improvising at deploy time.
- [ ] Commit with `docs: verify CaboHealth hosting capabilities`.

## Task 1: Create the isolated web workspace and shared quality gates

**Files:**

- Create: `miniapps/package.json`
- Create: `miniapps/package-lock.json`
- Create: `miniapps/tsconfig.base.json`
- Create: `miniapps/vitest.workspace.ts`
- Create: `miniapps/playwright.config.ts`
- Create: `miniapps/tests/setup.ts`
- Create: `miniapps/packages/ui/package.json`
- Create: `miniapps/packages/ui/src/styles/tokens.css`
- Create: `miniapps/packages/ui/src/styles/global.css`
- Create: `miniapps/packages/ui/src/accessibility.ts`
- Create: `miniapps/packages/ui/src/__tests__/accessibility.test.ts`

- [ ] Create npm workspaces for `apps/*` and `packages/*`; pin Vite, React, TypeScript, Vitest, Testing Library, Playwright, axe-core, i18next and Zod.
- [ ] Depend on the already-built local `@cabohealth/contracts` package from Native Task 2 and test serialized catalog/launch fixtures byte-for-byte across the web workspace.
- [ ] Add scripts `typecheck`, `lint`, `test`, `test:e2e`, `build`, `verify`, `links` and `content:verify` that run from `miniapps/` without changing the Expo dependency tree.
- [ ] Write failing accessibility tests for visible focus, 44 CSS-pixel touch targets, skip link, semantic headings, language attribute and reduced-motion class.
- [ ] Implement shared semantic layout helpers and CaboHealth design tokens for light mineral background, deep navy/teal, gold accent, typography, focus ring, spacing and error states.
- [ ] Configure Playwright projects for iPhone 15 Pro portrait, iPhone SE portrait and desktop Safari/WebKit; fail tests on uncaught page/console error.
- [ ] Run `npm --prefix miniapps run verify`; expected result: all initial package tests pass and all three app builds are still intentionally absent.
- [ ] Commit with `build: scaffold CaboHealth miniapp workspace`.

## Task 2: Recreate the approved CaboHealth brand system and motion safely

**Files:**

- Create: `miniapps/packages/ui/src/BrandHeader.tsx`
- Create: `miniapps/packages/ui/src/MolecularBackground.tsx`
- Create: `miniapps/packages/ui/src/AppShell.tsx`
- Create: `miniapps/packages/ui/src/Footer.tsx`
- Create: `miniapps/packages/ui/src/styles/motion.css`
- Reuse: `assets/logo.png`
- Test: `miniapps/packages/ui/src/__tests__/BrandHeader.test.tsx`
- Test: `miniapps/packages/ui/src/__tests__/MolecularBackground.test.tsx`
- Test: `miniapps/tests/e2e/brand.spec.ts`

- [ ] Extract only public brand assets from cabohealth.org and record source URL, dimensions, hash and ownership in `docs/content/source-inventory.md`; do not copy third-party site code or private WordPress data.
- [ ] Write component tests first for real image alt text, decorative particle semantics, paused hidden state and `prefers-reduced-motion` removing motion.
- [ ] Run `npm --prefix miniapps test -- BrandHeader MolecularBackground`; expected result: fail before shared brand components exist.
- [ ] Implement the approved A4-derived header: CaboHealth wordmark near the upper quarter, precision-longevity tagline, subtle molecular connections, compact interior header and no layout shift.
- [ ] Implement particle density based on viewport area, `requestAnimationFrame` throttling, `visibilitychange` pause and a static reduced-motion fallback.
- [ ] Add footer links to the frozen Privacy/Terms/Support routes and a language switch that preserves the current page/selection.
- [ ] Capture and visually inspect Playwright screenshots at both phone widths; require legible logo, no clipping, no horizontal scroll and stable CTA location.
- [ ] Run unit/E2E brand tests plus an axe scan; expected result: zero serious/critical violations.
- [ ] Commit with `feat: add cinematic CaboHealth web design system`.

## Task 3: Build Healthy Recipes as a useful public miniapp

**Files:**

- Create: `miniapps/apps/healthy-recipes/package.json`
- Create: `miniapps/apps/healthy-recipes/vite.config.ts`
- Create: `miniapps/apps/healthy-recipes/index.html`
- Create: `miniapps/apps/healthy-recipes/.htaccess`
- Create: `miniapps/apps/healthy-recipes/src/main.tsx`
- Create: `miniapps/apps/healthy-recipes/src/App.tsx`
- Create: `miniapps/apps/healthy-recipes/src/routes.tsx`
- Create: `miniapps/apps/healthy-recipes/src/store.ts`
- Create: `miniapps/apps/healthy-recipes/src/content/en.json`
- Create: `miniapps/apps/healthy-recipes/src/content/es.json`
- Create: `miniapps/apps/healthy-recipes/src/__tests__/recipes.test.tsx`
- Create: `miniapps/tests/e2e/healthy-recipes.spec.ts`
- Create: `docs/content/healthy-recipes-review.md`

- [ ] Inventory CaboHealth-owned recipe material already published on the site; record each source/license. Create at least twelve complete bilingual recipes across breakfast, main, snack and beverage categories, each with ingredients, steps, time, portions, allergens and food-safety note.
- [ ] Have content review explicitly remove therapeutic claims, personalized dietary advice, dosing and disease-treatment wording. Filters are descriptive only.
- [ ] Write tests first for localized search, category/dietary filters, recipe detail, allergen visibility, empty results, share/copy fallback and local favorite persistence.
- [ ] Run `npm --prefix miniapps test -- healthy-recipes`; expected result: failure because the app is missing.
- [ ] Implement home → search/filter → detail with direct web URL routes and `/saved/`. Add an app-local Apache rewrite to `index.html`; AASA intentionally handles only the canonical miniapp root so nested web routes do not hit native `+not-found`.
- [ ] Store favorite recipe IDs only in localStorage under a versioned app-specific key; corrupt/retired IDs reconcile safely and no search text is logged.
- [ ] Add a visible educational disclaimer and sources where facts go beyond normal cooking safety; do not use medical-device or treatment language.
- [ ] Add visible `Report content` with support destination and published response/takedown SLA; wire an audited emergency unpublish control through the catalog, not a hidden feature flag.
- [ ] Document that v1 has no UGC and add abuse response: editorial filtering, access-grant revoke for authenticated abuse, WAF/rate-limit for anonymous abuse and audited block/takedown actions.
- [ ] Run component tests, Playwright flows, axe and screenshots; expected result: all pass at both iPhone viewports, including browser refresh on detail/Saved routes.
- [ ] Build and inspect `dist`: no source map, secret, patient term, analytics endpoint or unlicensed remote asset.
- [ ] Commit with `feat: build public Healthy Recipes miniapp`.

## Task 4: Build CaboHealth Clinic Guide without medical intake

**Files:**

- Create: `miniapps/apps/clinic-guide/package.json`
- Create: `miniapps/apps/clinic-guide/vite.config.ts`
- Create: `miniapps/apps/clinic-guide/index.html`
- Create: `miniapps/apps/clinic-guide/.htaccess`
- Create: `miniapps/apps/clinic-guide/src/main.tsx`
- Create: `miniapps/apps/clinic-guide/src/App.tsx`
- Create: `miniapps/apps/clinic-guide/src/routes.tsx`
- Create: `miniapps/apps/clinic-guide/src/content/en.json`
- Create: `miniapps/apps/clinic-guide/src/content/es.json`
- Create: `miniapps/apps/clinic-guide/src/__tests__/clinicGuide.test.tsx`
- Create: `miniapps/tests/e2e/clinic-guide.spec.ts`
- Create: `docs/content/clinic-guide-review.md`

- [ ] Read public CaboHealth pages and verify current clinic name, address, opening/contact channels, languages, parking/arrival facts and service descriptions. Record the public source and date for every operational field.
- [ ] Write tests first for directory navigation, visit-preparation checklist, localized map/WhatsApp/email actions, external-link confirmation, missing optional fact and legal footer.
- [ ] Run `npm --prefix miniapps test -- clinic-guide`; expected result: fail before Clinic Guide exists.
- [ ] Implement neutral service summaries, location/arrival, what to bring, languages and contact. Do not add symptom intake, diagnosis questionnaire, patient identifier, purchase CTA or appointment-payment flow.
- [ ] Make map, WhatsApp, email and phone links ordinary explicit user actions with visible destinations; never auto-open or track them.
- [ ] Add source links adjacent to any medical-context statement and a clear statement that the guide is informational, not emergency advice.
- [ ] Add app-local Apache rewrite, strict CSP and visible Report content/support SLA. Verify Clinic Guide is editorially useful and not dominated by marketing, install/store terminology or WhatsApp promotion.
- [ ] Run component, Playwright, axe, link and visual tests. Confirm every internal route survives a direct reload and every external link is HTTPS or an approved explicit scheme.
- [ ] Build and inspect `dist` for no forms collecting health data, secrets, analytics or third-party scripts.
- [ ] Commit with `feat: build public CaboHealth Clinic Guide`.

## Task 5: Build Client Resources with no exclusive content in the public bundle

**Files:**

- Create: `miniapps/apps/client-resources/package.json`
- Create: `miniapps/apps/client-resources/vite.config.ts`
- Create: `miniapps/apps/client-resources/index.html`
- Create: `miniapps/apps/client-resources/src/main.tsx`
- Create: `miniapps/apps/client-resources/src/App.tsx`
- Create: `miniapps/apps/client-resources/src/api.ts`
- Create: `miniapps/apps/client-resources/src/session.ts`
- Create: `miniapps/apps/client-resources/src/content/public-en.json`
- Create: `miniapps/apps/client-resources/src/content/public-es.json`
- Create: `miniapps/apps/client-resources/src/__tests__/session.test.tsx`
- Create: `miniapps/tests/e2e/client-resources.spec.ts`
- Create: `web-hosting/cabohealth.org/apps/client-resources/lib/session.php`
- Create: `web-hosting/cabohealth.org/apps/client-resources/launch/index.php`
- Create: `web-hosting/cabohealth.org/apps/client-resources/api/resources/index.php`
- Create: `web-hosting/cabohealth.org/apps/client-resources/.htaccess`
- Create: `tools/hosting/tests/client-resource-broker.test.mjs`
- Create: `client-resources-private/schema.json`
- Create: `client-resources-private/content/en.json`
- Create: `client-resources-private/content/es.json`

- [ ] Define a private JSON schema containing only general program orientation, generic documents, schedule/contact and sourced educational resources; prohibit name, DOB, record number, lab, protocol, dose, diagnosis or patient-specific field.
- [ ] Write web tests first for loading, 401/403/429/5xx, expired session, language, logout/clear and absence of protected text before API success.
- [ ] Write PHP/broker tests first for exact form content type/body, GET/body nonce leakage, missing/replayed/expired nonce, bad canonical signature/key ID, wrong app/entitlement, cross-environment broker API, scoped cookie, CSRF/logout, live revocation, redirect without query and path traversal.
- [ ] Run Client Resources component and broker tests; expected result: fail before the shell/PHP/session contract exists.
- [ ] Implement POST-only launch broker with `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, strict timeout, sanitized errors and no nonce body logging. It loads the exact environment `brokerApiBaseUrl`, rejects every other Firebase project URL and stores versioned signing secrets outside docroot with mode 600.
- [ ] Derive the environment-specific host-only cookie name, `clientResourceBasePath`, redirect and API path from validated topology. Staging and production require distinct `__Secure-` names, Secure, HttpOnly, SameSite=Lax and exact scoped Path; maximum life is 60 minutes. The API introspects the opaque web session/live grant on every request (positive cache ≤30 s), then reads only that environment's versioned private JSON release.
- [ ] Add logout with CSRF token that calls signed idempotent S2S `revokeClientSession`, waits for `{revokedAtMs}`, then expires the exact environment-scoped cookie. Prove a copied cookie gets 401, staging/production cookies are mutually absent, neither cookie is sent to `/`, `/staff/` or other miniapps, and revoke/remove/delete becomes 401 within 30 seconds.
- [ ] Build the React shell so its public bundle contains only loading/error/legal UI and public copy. It fetches content from same-origin API and never persists protected response in localStorage, IndexedDB, service worker or analytics.
- [ ] Include a visible Report content/Support action and the same documented response/takedown SLA; reports contain no automatic page/session/client identifier.
- [ ] Validate/hash bilingual private content separately and package it for exactly `private/staging/releases/<integration-release-id>/` or `private/production/releases/<release-id>/`. Deploy only through the guarded environment-aware script; its matching `private/<environment>/current` pointer participates in the same atomic activation/rollback as that environment's public bundle.
- [ ] Run build through root `scripts/security/scan-redacted.mjs` for private-health/content/credential categories; manually inspect each flagged file without printing values and require no exclusive content or credential in public dist.
- [ ] Run tests against a local PHP server plus a fake nonce API, including one-use and clean URL behavior; expected result: all pass.
- [ ] Commit with `feat: protect Client Resources behind launch broker`.

## Task 6: Publish accurate legal, privacy and support pages

**Files:**

- Create: `web-hosting/cabohealth.org/app/privacy/index.html`
- Create: `web-hosting/cabohealth.org/app/terms/index.html`
- Create: `web-hosting/cabohealth.org/app/support/index.html`
- Create: `docs/content/privacy-data-inventory.md`
- Create: `docs/content/medical-review.md`
- Create: `docs/content/translation-review.md`
- Create: `miniapps/tests/e2e/legal.spec.ts`

- [ ] Inventory every SDK, local key, server field, cookie, purpose, retention, processor and deletion/revocation path in the exact release; explicitly record that public search/favorites remain local and v1 requests no health permissions.
- [ ] Draft bilingual Privacy pages covering operator/contact, shell, each miniapp, access/session data, App Check, cookies, retention, removal, children/age and no PHI/AI in v1.
- [ ] Draft bilingual Terms covering educational scope/no diagnosis, client eligibility, acceptable use, IP/licenses, third parties, availability and jurisdiction; mark for legal-owner approval before production.
- [ ] Build Support with real email/phone/contact, public/client troubleshooting, Remove Client Access, compatible iOS version and links to Privacy/Terms.
- [ ] Write E2E/link tests first for anonymous access, language, reciprocal links, contact destination and absence of stale claims such as all-app login, iOS 13, iPad support, analytics/device IDs or `.com` URLs.
- [ ] Run the legal E2E suite against the assembled local site; expected result: fail before the new legal/support pages exist.
- [ ] Run a human Spanish/English parity and legal-owner sign-off; record reviewer/date rather than silently declaring legal approval.
- [ ] Require a signed clinical-content review for every health statement: source/last-reviewed date, context to consult a qualified professional before medical decisions, and no personalized diagnosis/treatment.
- [ ] Commit with `docs: add release-accurate legal and support pages`.

## Task 7: Assemble immutable artifacts, AASA and release manifest

**Files:**

- Create: `web-hosting/cabohealth.org/.well-known/apple-app-site-association`
- Create: `web-hosting/cabohealth.org/.well-known/.htaccess`
- Create: `web-hosting/cabohealth.org/release-manifest.json`
- Create: `tools/hosting/assemble-release.mjs`
- Create: `tools/hosting/verify-release.mjs`
- Create: `tools/hosting/tests/release.test.mjs`

- [ ] Write tests first requiring App ID `DQ8PH2DZ3R.com.cabohealth.app`, exactly the three canonical root paths, explicit exclusions for Client Resources `/launch/` and `/api/`, and no broad wildcard.
- [ ] Run `node --test tools/hosting/tests/release.test.mjs`; expected result: fail before AASA/manifest assembly exists.
- [ ] Create extensionless AASA using modern ordered `components`; `.well-known/.htaccess` forces `application/json`, no redirect and controlled cache. Nested recipe/assets/API/broker routes stay on the web and never resolve to native routing.
- [ ] Make `assemble-release --environment staging|production` build all apps, copy Staff Portal/legal/broker files into a versioned assembly directory, exclude source maps and calculate SHA-256 for every artifact. Staging maps the same generated sources to `/apps-staging/`; production maps to `/apps/`.
- [ ] Explicitly copy each app's `.htaccess` into its deployed root and verify Apache rewrites plus strict CSP (`default-src`, `script-src`, `connect-src`, `img-src`, `style-src`, `frame-src`) match the catalog allowlist; do not assume Vite copies dotfiles.
- [ ] Generate immutable `release-manifest.json` by mode. Staging uses an `integrationReleaseId`, has no App Store version/build or `reviewReady`, and has no AASA/universal-link claim. Production refuses to assemble until App Store Task 1 has committed `releaseId` + reserved version/build, then embeds those values with public/private artifact hashes, access, canonical universal link, hosts, data/permissions, age, monetization and `reviewReady` for exactly three miniapps. Never write submission ID/review state into either artifact.
- [ ] Make local `verify-release` fail on a fourth app, miniapp age above host, missing locale/legal/report link, non-HTTPS link, development URL, candidate hash without frozen `releaseId`/App Store version/build, source map, forbidden permission, missing private artifact or private content in public dist. Cross-system verification separately requires the matching private backend attestation for submitted/approved/rollback states.
- [ ] Before App Store reservation, run assembly/verification in `staging` mode and require an immutable integration release. After App Store Task 1, rerun in `production` mode against the committed reservation and require a different immutable production release; neither mode rewrites a prior artifact.
- [ ] Commit with `build: assemble App Store web release`.

## Task 8: Establish safe Hostinger access and create verified backups

**Files:**

- Create: `docs/operations/hostinger-access.md`
- Create: `docs/operations/hostinger-backup.md`
- Create: `tools/hosting/deploy-hostinger.mjs`
- Create: `tools/hosting/rollback-hostinger.mjs`

- [ ] Confirm `/Users/ivan/.ssh/hostinger_cabo` is mode 600 and its public key is authorized. Verify the server host fingerprint interactively once; do not use `StrictHostKeyChecking=no`.
- [ ] Test read-only access on port 65002 and assert the resolved working directory is exactly `/home/u693946604/domains/cabohealth.org`; abort on any other docroot.
- [ ] Run the documented `mysqldump --no-tablespaces --single-transaction --quick` using credentials read remotely from wp-config; require the final `-- Dump completed` line.
- [ ] Create a timestamped tar backup of `public_html` without crossing symlinks into other domains. Calculate SHA-256 and list both files in a backup manifest outside `public_html`.
- [ ] Download or independently verify backup size/hash before deployment. Do not continue on an empty SQL file, tar error or missing checksum.
- [ ] Make deploy script require `--environment staging|production`, verify its exact topology, check disk, upload immutable public release plus matching private release, compare checksums and show `rsync --dry-run` without printing private content. Staging can write only `public_html/apps-staging/` and `private/staging/`; production can write only approved production public paths and `private/production/`.
- [ ] Make staging activation atomically update only `apps-staging` + `private/staging/current` and never Staff/legal/AASA. Make production activation atomically update `apps/staff/app` + `private/production/current` + AASA only after all checks. Never pass `--delete` against `public_html`; each rollback restores matching public/private hashes from the same environment.
- [ ] Make rollback select the immediately previous release from that environment's validated manifest and repoint only its own symlinks; reject a staging/production mismatch and never restore database or touch WordPress/theme.
- [ ] Execute a no-change dry run and save sanitized output in the deployment record.
- [ ] Before any production activation, deploy and verify the staging assembly at all three `/apps-staging/` URLs against the exact staging `publicApi`/`brokerApi`; confirm AASA does not match those paths and production configuration contains none of them.
- [ ] Commit with `ops: add guarded Hostinger deployment`.

## Task 9: Deploy, verify production and prove rollback

**Files:**

- Create: `docs/qa/web-production-verification.md`
- Create: `miniapps/tests/e2e/production.spec.ts`

- [ ] Repeat the guarded database/files backup immediately before production upload and require fresh checksums; a backup created for staging is not sufficient. Upload but do not activate the release, then test each versioned URL through an SSH tunnel or temporary unguessable preview path with Playwright and link checks.
- [ ] Activate the new release, purge only CaboHealth LiteSpeed/cache and verify WordPress root, `/es/`, About, Contact and other key pages remain 200.
- [ ] Before credentials/catalog publication, require anonymous 200 for both public apps, the locked Client Resources shell, all legal pages and the `/staff/` sign-in page; require zero unexpected redirect and correct AASA content type.
- [ ] Pause after that public smoke. Execute Backend Task 11 to ingest this exact manifest, publish the candidate catalog/attestation and provision the stable client demo plus `reviewSandboxAdmin`; do not run credential-dependent web tests before it completes.
- [ ] Resume and smoke the mandatory reviewer sandbox login, catalog consistency and demo client flow against the exact production release; neither account may require a person-dependent second factor.
- [ ] Run recursive link checks and Playwright on production in iPhone WebKit. Fail on console error, failed resource, horizontal scroll, broken language route or serious/critical axe finding.
- [ ] Exercise Client Resources with POST valid, expired and replayed test nonces plus live revoke/logout. Confirm access logs contain no nonce, URL stays clean, cookie is path-scoped, private content is uncached and no content survives revocation.
- [ ] Fetch AASA from origin and `https://app-site-association.cdn-apple.com/a/v1/cabohealth.org`; allow Apple CDN propagation time but do not build release candidate until both parse and contain the exact App ID/paths.
- [ ] Repoint to the most recent previously App-Review-approved compatible hash, verify public/private rollback, then re-activate the candidate and re-run smoke checks. Record both release IDs/timings.
- [ ] Inspect production visually and save screenshots of A4-style entry, both public apps, locked-resource error/session, legal pages and reduced-motion state.
- [ ] Commit the sanitized verification report with `test: verify CaboHealth production miniapps`.

## Plan Acceptance Gate

- [ ] All six public/support URLs respond 200 anonymously and every internal link passes.
- [ ] Healthy Recipes has complete useful bilingual content, local favorites and no therapeutic claim.
- [ ] Clinic Guide is accurate, neutral, bilingual and collects no health information.
- [ ] Client Resources public bundle contains no exclusive content; valid nonce succeeds once and private API rejects every invalid session.
- [ ] Every miniapp exposes Report content, conforms to host age, has strict CSP and can be audit-unpublished; no page presents a marketplace/store or purchase CTA.
- [ ] Brand, VoiceOver semantics, keyboard, contrast, Dynamic Type-equivalent zoom and Reduce Motion pass automated/manual QA.
- [ ] AASA origin and Apple CDN contain only the three approved paths for `DQ8PH2DZ3R.com.cabohealth.app`.
- [ ] Hostinger backup, activation and rollback are verified without touching the other domain, DNS, MX or WordPress theme.
- [ ] Production web/backend URLs remain stable before the iOS release candidate is built.
