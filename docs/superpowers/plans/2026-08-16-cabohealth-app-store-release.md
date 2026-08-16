# CaboHealth App Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el sistema integrado en un release candidate firmado, comprobar exactamente ese build en TestFlight, completar metadata/privacidad/demo con evidencia y enviarlo a App Review sin omitir funciones ni depender de enlaces o credenciales inestables.

**Architecture:** El release usa gates secuenciales e invalidantes. Web, backend, legales y AASA quedan estables antes del build. El commit, manifiesto, hashes web/backend, versión/build, EAS build ID e IPA quedan ligados en una sola procedencia. TestFlight, screenshots y App Store metadata usan ese mismo RC. Cualquier cambio funcional posterior invalida el RC y regresa al gate correspondiente.

**Tech Stack:** EAS Build/Submit, Expo config, Xcode/iOS signing, App Store Connect, TestFlight, Maestro, Playwright, Firebase production, Hostinger production, Apple universal-link CDN, Node verification scripts.

## Global Constraints

- “Subir” no equivale a “enviar a revisión”: primero se carga/procesa TestFlight, después se prueba y sólo entonces se selecciona el build y se pulsa Submit for Review.
- No afirmar ni prometer aprobación. El objetivo es satisfacer criterios verificables y responder honestamente a App Review.
- No usar módulos ocultos, feature flags para engañar Review ni activar una cuarta miniapp después de aprobar el build.
- Toda función visible, incluido Client Access y Staff Sign In, se describe específicamente en Review Notes.
- El código demo de cliente vive en servidor, no expira durante Review, no requiere 2FA/persona disponible y abre todo el contenido consumidor enviado.
- La administración de personal se presenta como herramienta operativa separada. Como Staff Sign In es visible, Apple recibe desde el inicio una cuenta Firebase Auth funcional con scope servidor `reviewSandbox`; las Functions la enrutan sólo a repositorios `review_sandbox_*` y nunca a producción.
- No copiar secretos, contraseñas o códigos demo a Git. Los archivos versionados contienen nombres de campos y pasos; las credenciales se ingresan exclusivamente en App Review Information.
- Seleccionar manual release inicialmente. Tras aprobación, confirmar producción intacta y entonces liberar.
- Una modificación funcional de miniapp/backend/catálogo, permiso, SDK, entitlement, URL de producto o binario después de sign-off invalida el RC. Una matriz separa aclaraciones metadata-only y screenshots del mismo RC.
- Preservar el cambio preexistente de `babel.config.js` en el workspace del usuario. Los registros/provenance se committean en el worktree principal, pero EAS construye exclusivamente desde un segundo worktree detached y limpio en el SHA fuente inmutable `S`; ambos HEAD no tienen que coincidir después de committear los registros.
- Cada claim de “listo” requiere salida fresca del comando/check correspondiente, conforme a `superpowers:verification-before-completion`.
- Prerequisito: backend ya probó un build interno de integración no-RC, cerró reglas/migración en producción y descartó ese build para submission; sólo entonces empieza G0 y se calcula el siguiente build final.

---

## Dependency and Gate Map

```text
Native + Backend + Miniapps complete
          │
          ▼
G0 ASC history, seller/business gate and scope freeze
          │
          ▼
G1 Production URLs/backend/AASA green
          │
          ▼
G2 Automated, security, accessibility green
          │
          ▼
G3 Signed EAS RC + entitlements/provenance
          │
          ▼
G4 Exact RC on TestFlight physical iPhone
          │
          ▼
G5 Screenshots + metadata + privacy + review demo
          │
          ▼
G6 Upload/select/Add for Review/Submit
          │
          ▼
Monitor messages → respond/build fix → approval → manual release
```

**Hard blockers requiring the user's direct interaction when prompted**

- Apple/Firebase/EAS/Hostinger sign-in or 2FA challenge.
- Acceptance of Apple agreements, banking/tax or legal declarations only the account holder can attest.
- Legal-owner approval of Privacy/Terms and final confirmation of the App Privacy questionnaire.

## Target File Map

```text
release/app-store/current/
  release.json
  review-history.md
  build-provenance.json
  metadata/en-US.md
  metadata/es-MX.md
  review-notes.md
  app-privacy.md
  age-rating.md
  content-rights.md
  export-compliance.md
  testflight-what-to-test.md
  release-checklist.md
  business-model.md
  screenshots/en-US/iphone-6.9/
  screenshots/es-MX/iphone-6.9/
  evidence/
scripts/release/
  verify-clean-tree.mjs
  verify-production.mjs
  verify-bundle-secrets.mjs
  verify-config.mjs
  capture-screenshots.mjs
  verify-screenshots.mjs
  create-provenance.mjs
  verify-review-notes.mjs
docs/qa/{integration,testflight,accessibility,upgrade}.md
docs/operations/app-store-submission.md
```

## Task 0: Resolve seller, business-model and prior-review gates before protected-access implementation

**Files:**

- Create: `release/app-store/current/review-history.md`
- Create: `release/app-store/current/business-model.md`

- [ ] Open App Store Connect app `6758285327` and read every visible submission, Resolution Center message, attachment and reviewer note chronologically. Record date, reviewed version/build, guideline, affected miniapp/flow, Apple request and required evidence/fix.
- [ ] Record membership type and legal seller. Block submission unless Account Type is Organization and that organization is the legal entity providing the healthcare services; a publisher authorization alone is insufficient without written Apple direction. Otherwise complete enrollment/transfer first.
- [ ] Prove in `business-model.md` that the code only authenticates existing clients of in-person medical services consumed outside the app, has no separate digital charge/value and no purchase CTA.
- [ ] If no Apple 3.1.3 exception fits unequivocally, choose before building protected Client Resources: make it public/free, implement IAP, or obtain written Resolution Center direction. Update the spec/plans to the chosen path.
- [ ] Commit with `docs: resolve CaboHealth App Store preflight gates`.

## Task 1: Reserve the App Store version, build and release ID

**Files:**

- Create: `release/app-store/current/release.json`
- Create: `scripts/release/verify-reservation.mjs`
- Create: `scripts/release/verify-reservation.test.mjs`

- [ ] After the non-RC integration build, re-query the editable App Store version and highest uploaded build. Reserve the editable marketing version (or create the required next version) and set candidate build to highest + 1.
- [ ] Generate one stable `releaseId` for this candidate and write only app/team/bundle, reserved version/build, reservation timestamp and status `versionReserved`; web release ID, hashes and source SHA are intentionally absent at this phase.
- [ ] Write failing tests for stale maximum build, duplicate release ID, missing team/bundle and a reservation that already pretends to be scope-frozen; then implement `verify-reservation.mjs`.
- [ ] Run the verifier against current App Store Connect evidence and commit the reservation before any production web assembly with `docs: reserve CaboHealth App Store version`.

## Task 2: Freeze the candidate scope after production web/backend binding

**Files:**

- Modify: `release/app-store/current/release.json`
- Create: `release/app-store/current/release-checklist.md`
- Create: `scripts/release/verify-clean-tree.mjs`

- [ ] Reconfirm the Task 1 reservation is still editable and no higher build appeared. If either changed, invalidate the production binding and create a new reservation before continuing.
- [ ] After Miniapps production activation and backend candidate publication, freeze scope in `release.json` with the reserved release/version/build, three slugs, exact Firebase project, web release ID/hashes, candidate attestation event and status `scopeFrozen`. Do not set final source SHA until integrated verification/config/prebuild tasks finish.
- [ ] Assert the release contains Healthy Recipes/public, Clinic Guide/public and Client Resources/client only; list every excluded legacy miniapp by name.
- [ ] Write `verify-clean-tree.mjs` to accept an explicit detached source-worktree path plus release-record path, require zero modified/untracked files, `HEAD === release.json.sourceGitSha`, a source commit reachable from the pushed release branch/tag, and manifest/config match. It must not require the record-worktree HEAD to equal the source SHA and never whitelists `babel.config.js` in EAS context.
- [ ] Run the script; expected result before implementation merge: fail with explicit missing integration/release fields rather than silently pass.
- [ ] Resolve or mark every prior reviewer complaint with a concrete test/evidence path. Do not submit while a message is unanswered or a rejection has no mapped fix.
- [ ] Commit with `docs: freeze CaboHealth App Store candidate`.

## Task 3: Create one command that proves the integrated release

**Files:**

- Create: `scripts/release/verify-production.mjs`
- Create: `scripts/release/verify-bundle-secrets.mjs`
- Create: `scripts/release/verify-config.mjs`
- Create: `scripts/release/verification-scripts.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/qa/integration.md`

- [ ] Add root scripts `verify:native`, `verify:contracts`, `verify:backend`, `verify:miniapps`, `verify:production`, `verify:secrets` and `verify:release` in a fixed order with immediate failure propagation.
- [ ] Write tests for the verification scripts using intentionally bad fixtures: fourth slug, HTTP URL, alpha icon, wrong bundle/team, missing legal URL, open Firestore rule, bypass string, nonce in log and stale `.com` domain.
- [ ] Implement production checks for apps/legal/staff URLs, backend health/public catalog, invalid-code generic response, device-tested demo entitlement, POST nonce one-use, web-session revoke, AASA origin/CDN, redirects and content type. Compare immutable public `releaseId`/version/build/hashes with the private append-only attestation returned to an authenticated production admin; external scripts never impersonate App Check.
- [ ] Implement source/built scanning that reports only `file:category`, never matching values, for embedded bypass/PIN/plaintext code, private keys, peppers, broker secret, source maps, private Client Resources content and accidental `.env`; allow schema-validated public Firebase config.
- [ ] Make config verification compare `app.config.ts`, EAS public config, contracts, release manifest, AASA App ID and ASC version/build values.
- [ ] Run from clean install: `npm ci && npm run verify:release`; expected result: all unit, rules, emulator, web, link, lint, typecheck and production checks pass.
- [ ] Save tool versions and sanitized output in `docs/qa/integration.md`; do not paste credentials or full environment dumps.
- [ ] Commit with `test: add integrated release verification`.

## Task 4: Finalize icon, splash, permissions, entitlements and version config

**Files:**

- Modify: `assets/icon.png`
- Modify: `assets/splash.png` or replace with final Expo splash asset
- Modify: `app.config.ts`
- Modify or retire: `app.json`
- Modify: `eas.json`
- Modify: `constants/environment.ts`
- Modify: `scripts/release/verify-config.mjs`
- Create: `release/app-store/current/evidence/config.json`

- [ ] Flatten the 1024×1024 app icon onto the approved opaque CaboHealth background while preserving safe margins. Run `sips -g pixelWidth -g pixelHeight -g hasAlpha assets/icon.png`; require `1024`, `1024`, `no` and visually inspect at 1024/180/60 pixels.
- [ ] Confirm splash/intro transition has no white flash, distorted wordmark or obsolete logo on an iPhone device.
- [ ] Set exact marketing version/build from Task 1 in the single `app.config.ts` owner; keep `appVersionSource: local` and remove stale build constants from application code/docs.
- [ ] Require `ios.associatedDomains` contains only `applinks:cabohealth.org`; inspect generated Info.plist for app-bound domains and absence of camera/microphone/photo/location usage strings.
- [ ] Keep only Face ID wording actually used for client-session relock and `ITSAppUsesNonExemptEncryption: false` after confirming the app uses only standard OS/TLS encryption.
- [ ] Pin EAS CLI in devDependencies and make production profile reference only production Firebase/App Check environment through EAS secrets.
- [ ] Run `npx expo config --type public --json`, `npx expo-doctor` and config verification; save sanitized config evidence.
- [ ] Commit with `build: finalize iOS release configuration`.

## Task 5: Re-verify production dependencies immediately before building

**Files:**

- Update: `release/app-store/current/build-provenance.json`
- Update: `release/app-store/current/release-checklist.md`

- [ ] Confirm production web release symlinks/hashes match the frozen manifest and WordPress root/key pages remain 200.
- [ ] Confirm Functions revision, closed rules, App Check enforcement, active release membership, demo grant, broker secret version and audit retention match the frozen backend release.
- [ ] Require one private `candidate` attestation event for the exact `releaseId`, version/build and hashes, and prove its stored manifest/catalog digest equals the active public bytes. No submission ID exists yet.
- [ ] Fetch origin AASA with no redirect and Apple CDN AASA; require exact App ID, exactly three canonical root paths and explicit exclusion/no handling of broker/API/nested web routes.
- [ ] Exercise public launch, invalid code, demo code, remove access, Client Resources valid nonce and replay from an external network.
- [ ] Run `npm run verify:release` again and timestamp the result. Any failure or artifact/hash change sets release status back to `invalidated`.
- [ ] After every source/config change is committed, choose immutable source commit `S` and create a new clean detached worktree exactly at `S`. Set `release.json.sourceGitSha = S` in the primary record worktree, bind each web `contentVersion + artifactHash` to App Store version/build, then commit the record update there. Re-run verification against the detached worktree and prove only its `HEAD`—not the now-newer record HEAD—equals `S`.
- [ ] Set release status to `readyToBuild` only when every check is fresh/green and commit with `test: freeze production prebuild gate`.

## Task 6: Build, retrieve and attest the signed release candidate

**Files:**

- Create: `scripts/release/create-provenance.mjs`
- Create: `scripts/release/create-provenance.test.mjs`
- Update: `release/app-store/current/build-provenance.json`
- Create: `release/app-store/current/evidence/entitlements.txt`
- Create: `release/app-store/current/evidence/ipa-files.txt`

- [ ] Run local EAS config for the production profile and compare bundle/team/version/build/project ID with the frozen release.
- [ ] Write provenance tests first for mismatched SHA/build/hash/entitlement and dirty worktree; run them and confirm failure before implementing `create-provenance.mjs`.
- [ ] From the detached clean source worktree whose `HEAD` equals `sourceGitSha`, run a fresh `npm ci`, verification, and one production iOS build using the locally pinned EAS CLI. Never invoke EAS from the primary record worktree. Record EAS build ID, exact source SHA `S`, start/end time and artifact checksum.
- [ ] Download the IPA artifact to a temporary non-repository directory; calculate SHA-256 and record it in provenance.
- [ ] Extract entitlements and require application identifier `DQ8PH2DZ3R.com.cabohealth.app`, associated domain `applinks:cabohealth.org`, production App Attest config and no unexpected keychain/app-group/domain entitlement. Require absence of `aps-environment` because v1 has no push.
- [ ] Extract `PrivacyInfo.xcprivacy`, required-reason API declarations and signatures for listed third-party SDKs; reconcile the archive Privacy Report with the data inventory and fail on a missing/unsigned required SDK manifest.
- [ ] Inspect IPA filenames and strings for `.env`, source map, private key, master/PIN, access code, Firebase debug token, staging/dev URL and excluded miniapp name used as an active route.
- [ ] Install the exact signed artifact on a physical iPhone before upload when EAS distribution permits; otherwise submit to TestFlight and install only that processed build.
- [ ] Set release status to `built` and lock provenance. A rebuilt artifact receives a new RC and repeats all following tasks.
- [ ] Commit provenance without binary/secret with `build: attest CaboHealth release candidate`.

## Task 7: Test the exact RC through TestFlight on a physical iPhone

**Files:**

- Create: `release/app-store/current/testflight-what-to-test.md`
- Create: `docs/qa/testflight.md`
- Create: `docs/qa/accessibility.md`
- Create: `docs/qa/upgrade.md`

- [ ] Upload the built RC with EAS Submit, wait for processing and confirm ASC displays the exact marketing version/build and encryption status. Do not select it for App Review yet.
- [ ] Add only this build to internal group `CaboHealth RC` with focused What to Test for intro, catalog, public apps, client access, universal links and Settings.
- [ ] On a physical iPhone, test clean install: A4 visible, button immediate, auto-advance ≤1.8 s, public catalog ≤2 s, both public apps without code and Client Resources visibly locked.
- [ ] Test demo, invalid, expired, revoked, device-limit and rate-limit codes; confirm demo opens all consumer functions and Remove Client Access erases access.
- [ ] Test direct universal links from Messages/Notes/Safari for all three paths. Client link without access must show the gate with no private flash.
- [ ] Test foreground/background/kill, Face ID success/cancel/failure, airplane mode/no cache/cache, timeout, HTTP failure, blocked redirect/popup and WebView process termination.
- [ ] Test English/Spanish, light/dark/system, Reduce Motion, VoiceOver, extra-large Dynamic Type, landscape refusal/portrait, small/large iPhone and tap targets.
- [ ] Test clean install on IPv6/NAT64, a US-region network, constrained Wi-Fi and App Attest→DeviceCheck fallback; require no geoblock and visible diagnostics for App Check 403/quota without a reviewer bypass.
- [ ] Upgrade from the previously distributed build: require explicit legacy-code migration choice, no crash, no silent grant and cleanup of raw legacy storage.
- [ ] Run all Maestro flows against this build where automation is supported and manually cover device-only/App Attest/VoiceOver paths. Attach screenshots and exact pass/fail evidence.
- [ ] Fix every P0/P1 and repeat with a new build; do not relabel a changed build as the same RC. Set status `testflightApproved` only after all matrices pass.
- [ ] Commit sanitized QA/provenance with `test: approve exact TestFlight candidate`.

## Task 8: Capture screenshots and write metadata from the tested RC

**Files:**

- Create: `scripts/release/capture-screenshots.mjs`
- Create: `scripts/release/verify-screenshots.mjs`
- Create: `scripts/release/verify-screenshots.test.mjs`
- Create: `release/app-store/current/metadata/en-US.md`
- Create: `release/app-store/current/metadata/es-MX.md`
- Create: `release/app-store/current/screenshots/en-US/iphone-6.9/`
- Create: `release/app-store/current/screenshots/es-MX/iphone-6.9/`
- Create: `release/app-store/current/content-rights.md`

- [ ] Write English and Spanish name/subtitle/description/keywords/promotional text from actual tested features; describe a curated CaboHealth health-and-wellness platform, not a generic app store or medical diagnostic tool.
- [ ] Write screenshot-verifier tests first with wrong dimensions, alpha, duplicate, wrong locale and clipped safe-area fixture; run and confirm failure before implementation.
- [ ] Include only real functionality: public recipes, clinic guide, visible client resources, saved miniapps, bilingual UI and secure client access. Do not claim all content offline, patient records, AI, camera or unavailable service.
- [ ] Pass a 4.2 editorial gate: the catalog itself exposes useful curated descriptions/access/privacy/last-reviewed context; Healthy Recipes and Clinic Guide contain substantial non-promotional value; terminology never resembles a general app store/install marketplace.
- [ ] Record logo/photo/recipe/content ownership or licenses and confirm rights to display third-party service/map marks.
- [ ] Capture 1–10 6.9-inch iPhone screenshots per locale from the exact RC: catalog/value, Healthy Recipes, recipe detail/Saved, Clinic Guide, locked Client Resources/access, Settings/privacy. Do not use prototype-only UI.
- [ ] Review screenshots under 2.3.3/2.3.8: real in-app UI, age-appropriate content, no store/install/download framing and no presentation of Client Access as a paywall/license sale. Confirm `UIDeviceFamily` remains iPhone-only.
- [ ] Ensure status bar/time, locale and account state are intentional; no demo code, patient/client name, notification, debug banner or private staff data appears.
- [ ] Verify Apple dimensions, opaque PNG/JPEG, no alpha, no duplicate image, matching locale and no clipped text. Visually inspect every image at 100%.
- [ ] Compare metadata/screenshot claims against release manifest and TestFlight evidence; any mismatch blocks submission.
- [ ] Commit with `docs: prepare App Store metadata and screenshots`.

## Task 9: Complete App Privacy, age rating, compliance and Review Notes

**Files:**

- Create: `release/app-store/current/app-privacy.md`
- Create: `release/app-store/current/age-rating.md`
- Create: `release/app-store/current/export-compliance.md`
- Create: `release/app-store/current/review-notes.md`
- Create: `scripts/release/verify-review-notes.mjs`
- Create: `scripts/release/verify-review-notes.test.mjs`

- [ ] Derive App Privacy answers from the signed data inventory and exact SDK list, including App Check/device attestation, account/access identifiers, diagnostics actually collected and same-origin session cookie. Do not copy the obsolete privacy draft.
- [ ] Write Review Notes verifier tests first for >4,000 bytes, missing miniapp/demo/report/business/deletion disclosure, stale URL/build and a credential accidentally committed; run and confirm failure before implementation.
- [ ] Verify in-app `Delete account and data` end-to-end and describe deletion, pseudonymized legal retention and completion accurately in Privacy and Review Notes.
- [ ] Complete the current App Store Connect age questionnaire based on actual WebView restrictions and content; do not reuse old `12+`. Record every answer and Apple-calculated rating.
- [ ] Confirm content rights, ads, medical-device question, encryption/export compliance, availability/territories, pricing and release mode with the account holder where an attestation is required.
- [ ] Write Review Notes under 4,000 bytes: vertical curated HTML5/JS host; three-miniapp table; clean-install/demo steps; no native code/bridge, UGC or purchase CTA; report/takedown; existing-client model; protected consent; Remove vs Delete account; audited Staff sandbox; backend/contact availability; prior-rejection fixes.
- [ ] Re-test the exact non-expiring client demo credential created once during backend production setup; do not replace it after TestFlight. Store it only in App Review Information.
- [ ] Proactively re-test and provide the mandatory non-expiring `reviewSandboxAdmin` login scoped to sandbox catalog/codes; it fully demonstrates visible Staff Sign In without MFA/person dependency and cannot read/mutate production.
- [ ] Run `verify-review-notes.mjs` to check byte length, exact URLs, all three slugs, access labels, data/permission values, no fourth miniapp, no stale build/claim and no secret in the versioned file.
- [ ] Obtain final owner approval for legal/privacy questionnaire and Review Notes; record approval date without credentials.
- [ ] Commit with `docs: complete App Review disclosures`.

## Task 10: Populate App Store Connect and submit the tested RC

**Files:**

- Create: `docs/operations/app-store-submission.md`
- Update: `release/app-store/current/release-checklist.md`

- [ ] In App Store Connect, select the exact processed RC from provenance. Verify bundle/version/build checksum mapping before any field edit.
- [ ] Enter localized metadata, Support/Privacy/Marketing URLs, screenshots, copyright, categories, content rights, age rating, App Privacy and export compliance from the versioned files.
- [ ] Enter demo username/code and any reviewer-sandbox login only in private App Review Information; test copied values once more from a clean device.
- [ ] Paste Review Notes and compare rendered byte-limited text to the committed source. Attach only useful evidence requested by prior messages.
- [ ] Select manual release. Resolve every yellow/red ASC warning and every required agreement; do not guess an account-holder attestation.
- [ ] Use `Add for Review`, inspect the complete submission summary and confirm it contains only the intended iOS version/build.
- [ ] Press `Submit for Review` only after every checklist item is signed. Record submission ID, timestamp, build, review state and sanitized screenshots of the fields.
- [ ] Immediately use the production-MFA `Release Admin` action to call `adminRecordReviewAttestation` with transition `candidate → submitted`, exact submission ID, release/version/build and pre-recorded hashes. Verify an append-only event was added while `release-manifest.json` and `published_catalog/current` digests stayed byte-identical.
- [ ] Set local release status to `submitted`, record only sanitized attestation event ID/evidence and commit with `release: submit CaboHealth to App Review`.

## Task 11: Monitor Review, answer messages and release after approval

**Files:**

- Update: `release/app-store/current/review-history.md`
- Update: `release/app-store/current/release-checklist.md`
- Create when needed: `release/app-store/current/reviewer-response.md`

- [ ] Keep production backend, demo credential, broker and all URLs active 24/7 throughout Waiting for Review/In Review/Pending Developer Release.
- [ ] Check Resolution Center and build status regularly. Record every Apple message/date/guideline before changing code or replying.
- [ ] Reproduce any reported issue on the exact RC and corresponding account/network. Answer with direct steps/evidence; do not argue without verification or hide functionality.
- [ ] If code/web/backend changes are required, set status `invalidated`, withdraw the affected submission when appropriate, create a new build and repeat gates G1–G6.
- [ ] If metadata-only clarification is requested and no artifact changes, update the versioned Review Notes/response, re-run consistency checks and respond.
- [ ] Apply the invalidation matrix: functional web/backend/hash/binary/permission/SDK changes require a new RC; typo/clarification-only metadata may keep it after claim review; screenshot changes require revalidation against the same unchanged RC.
- [ ] On approval/Pending Developer Release, use the same production-MFA `Release Admin` action for `submitted → approved` with the exact submission ID. Verify the approved event, unchanged public hashes and rollback eligibility; then run production smoke, demo, AASA, App Privacy and link checks one final time before manually releasing.
- [ ] After Ready for Sale, install from the public App Store, run public/client smoke tests, monitor backend errors and preserve rollback capability. Record storefront availability and final release time.
- [ ] Archive immutable release records under the App Store submission ID and commit with `release: record CaboHealth approval and launch`.

## Plan Acceptance Gate

- [ ] Every prior App Review message has a documented, tested resolution.
- [ ] Production backend/web/legal/AASA are stable and hashes match the frozen release.
- [ ] Clean `npm run verify:release`, physical-device/TestFlight, upgrade, security and accessibility matrices all pass on the exact RC.
- [ ] IPA entitlements, bundle/team/version/build and source provenance match App Store Connect.
- [ ] Icon is opaque 1024×1024; screenshots come from the RC and metadata makes no unsupported claim.
- [ ] App Privacy, age rating, content rights, export compliance and legal pages describe the exact build.
- [ ] Demo access is stable and opens every consumer function; Staff Portal is explicitly disclosed and proactively testable through the isolated sandbox account.
- [ ] Seller organization and client-code business-model gates are signed; if either fails, submission does not proceed under the code-unlock design.
- [ ] The exact RC is submitted with manual release, production remains unchanged during Review and approval is followed by a final smoke test before release.
