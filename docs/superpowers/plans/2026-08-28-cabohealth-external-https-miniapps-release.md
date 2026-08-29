# CaboHealth External HTTPS Miniapps Build 8 Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for source changes and superpowers:verification-before-completion before every release-state claim. Execute only after `2026-08-28-cabohealth-external-https-miniapps-implementation.md` is complete and green.

**Goal:** Deploy the compatible backend and Staff Portal, produce an exactly attested CaboHealth 3.0 build 8, and make it available in TestFlight for physical-device testing without submitting it to App Review.

**Release order:** Source gate → Functions → legacy compatibility probes → Staff immutable artifact → controlled catalog exercise → build-8 metadata/input attestation → EAS production build → IPA audit/artifact attestation → TestFlight upload → physical-device QA → App Store Connect evidence.

**Fixed identity:** Apple ID `6758285327`; bundle ID `com.cabohealth.app`; version `3.0`; build `8`; Team ID `DQ8PH2DZ3R`; Firebase project `cabohealth-owner-prod`; Functions codebase `client-access`; EAS account `guaderrama`; EAS project `3ebd1d12-4aeb-4d65-8e17-b7726c65018d`.

**Spec:** `docs/superpowers/specs/2026-08-27-cabohealth-external-https-miniapps-design.md`

## Non-negotiable release boundaries

- Build 7 stays safe because all V1/V2 catalog and V1 production access endpoints omit external entries. Deploy the additive Functions contracts before Staff or build 8.
- Do not change AASA or `WKAppBoundDomains`; no third-party hostname is added to either authority.
- Never reuse build-7 input, artifact, RC hashes, IPA, evidence files, source digest, or tool pins for build 8. The five current phase/tool pins remain null until their own review task.
- Build and evidence material containing production configuration stays in a current-user-owned mode-`0700` directory with mode-`0600` files and outside Dropbox whenever the existing guard requires it.
- Do not publish a rights claim, age rating, privacy answer, or medical/content claim that has not been truthfully reviewed for the dynamic third-party-content scope.
- Do not call `npm run submit`, click **Submit for Review**, select a build for review, or create a submission authorization. Those actions require a separate immediate confirmation after final evidence exists.

---

### Task 1: Rebaseline release contracts and verifiers to build 8

**Files:**
- Modify: `app.json`
- Modify: `constants/config.ts`
- Modify: `release/app-store/3.0/release-manifest.json`
- Modify: `release/app-store/3.0/en-US.md`
- Modify: `release/app-store/3.0/es-MX.md`
- Modify: `release/app-store/3.0/review-notes.md`
- Modify: `release/app-store/3.0/testflight-what-to-test.md`
- Modify: `release/app-store/3.0/submission-gates.md`
- Modify: `release/app-store/3.0/apple-review-remediation-2026-08-24.md`
- Modify: `release/app-store/3.0/age-rating.json`
- Modify: `release/app-store/3.0/age-rating.md`
- Modify: `release/app-store/3.0/app-privacy.json`
- Modify: `release/app-store/3.0/app-privacy.md`
- Modify: `release/app-store/3.0/content-rights-and-brand.md`
- Modify: `release/app-store/3.0/content-rights-inventory.md`
- Modify: `release/app-store/3.0/declarations.md`
- Modify: `release/app-store/3.0/accessibility-nutrition-label-evidence.md`
- Modify: `release/app-store/3.0/screenshots-manifest.json`
- Modify: `release/app-store/3.0/screenshots/storyboard.md`
- Modify: `release/data-inventory.md`
- Modify: `release/compliance-facts.json`
- Modify: `docs/operations/apple-post-build-evidence.md`
- Modify: `docs/operations/exact-ios-ipa-audit.md`
- Modify: `docs/operations/prior-apple-review-resolution.md`
- Modify: `scripts/verify-release-v3.mjs`
- Modify: `scripts/verify-app-store-metadata.mjs`
- Modify: `scripts/apple-post-build-evidence.mjs`
- Modify: `scripts/create-build-input-attestation.mjs`
- Modify: `scripts/release-command-guard.mjs`
- Modify: `tools/app-store-submit-adapter/src/constants.mjs`
- Modify: `tools/app-store-submit-adapter/README.md`
- Modify: `tools/app-store-submit-adapter/package.json`
- Modify: `tools/app-store-submit-adapter/test/dry-run.test.mjs`
- Modify: `tools/app-store-submit-adapter/test/evidence.test.mjs`
- Move tracked build-7 attestations to: `release/app-store/3.0/history/build-7/`
- Add: `release/app-store/3.0/history/build-7/manifest.json`
- Move ignored private build-7 evidence to: `release/private/rc-build-7/`
- Keep absent until later tasks: current build-8 input/artifact/RC attestations
- Modify: `docs/superpowers/plans/2026-08-28-cabohealth-external-https-miniapps-release.md`
- Modify directly affected release, legal, regression, and EAS upload-context tests under `tests/`.

- [ ] **Step 1: Write failing build-8 release tests first**

Update tests to require `3.0`/`8`, identify builds 4–7 as obsolete-source evidence, reserve build 8 as the only new candidate, require external-WebView QA, and reject any build-7 artifact or pin as build-8 evidence.

Run:

```bash
node --test tests/release-v3.test.mjs tests/app-store-metadata.test.mjs tests/apple-post-build-evidence.test.mjs tests/build-input-attestation-producer.test.mjs tests/release-command-guard.test.mjs tests/ios-ipa-audit.test.mjs tests/scope-gate-routing.test.mjs
npm --prefix tools/app-store-submit-adapter test
```

Expected: FAIL because source and release authority still target build 7.

- [ ] **Step 2: Rebaseline the candidate and keep historical evidence historical**

Set `app.json` and `constants/config.ts` to build `8`. Advance every exact candidate validator together. Move the tracked build-7 input/artifact attestations byte-for-byte to `release/app-store/3.0/history/build-7/`, record their hashes and independently reviewed EAS-build/artifact association in the historical manifest, and move ignored private evidence byte-for-byte to `release/private/rc-build-7/`. Clear current candidate authority to truthful pre-build state: all current build-8 phase files are absent and all five pins are null. Do not copy old hashes into new authority.

- [ ] **Step 3: Make metadata truthful for dynamic third-party resources**

State that owner-added links may display third-party websites inside CaboHealth, same-origin navigation is constrained, VIP access controls only the in-app entry point, and third-party content is not made private or authored by CaboHealth. Require rights verification before activation. Do not assign a CaboHealth editorial source or fixed age rating to an external catalog item. Reconcile App Privacy with `third-party-network-request` behavior and document that the destination host independently receives normal network data.

Change the privacy authority that currently says `resourceUrlsReturnedToNative: false`: the truthful build-8 fact is that Public V3 records contain an external URL and an authorized VIP V2 launch may return one transiently, while VIP previews/grants/storage/audit remain URL-free. Replace claims that runtime external links are prohibited. Re-evaluate Apple's current **Unrestricted Web Access** question against the actual dynamic capability and the current official wording; the verifier must not preserve `false` merely to retain a projected 9+ result. Record the reviewed answer and resulting age category exactly, even if it raises the rating.

The release-scope metadata describes capability and review safeguards without listing a temporary test URL as permanent App Store content. Preserve the medical-safety disclaimer and reject diagnosis/treatment claims.

- [ ] **Step 4: Run focused release tests until green**

```bash
node --test tests/release-v3.test.mjs tests/app-store-metadata.test.mjs tests/apple-post-build-evidence.test.mjs tests/build-input-attestation-producer.test.mjs tests/release-command-guard.test.mjs tests/ios-ipa-audit.test.mjs tests/scope-gate-routing.test.mjs
npm --prefix tools/app-store-submit-adapter test
npm run test:scope:rc-v3
```

Expected: all pass in truthful pre-build-8 state.

- [ ] **Step 5: Commit the build-8 rebaseline**

```bash
git add -- app.json constants/config.ts release docs/operations/apple-post-build-evidence.md docs/operations/exact-ios-ipa-audit.md docs/operations/prior-apple-review-resolution.md docs/superpowers/plans/2026-08-28-cabohealth-external-https-miniapps-release.md scripts tools/app-store-submit-adapter tests
git commit -m "chore(release): rebaseline CaboHealth build 8"
```

---

### Task 2: Freeze and verify the complete source candidate

- [ ] **Step 1: Run all source and release gates from a clean tree**

```bash
npm --prefix functions test
npm --prefix functions run build
npm --prefix staff-portal test
npm --prefix staff-portal run typecheck
npm test
npm run typecheck
npm run lint
npm run test:scope:rc-v3
npm run expo:config > /tmp/cabohealth-build-8-expo-config.json
git diff --check
git status --short
```

Expected: every command exits 0 and status is clean. Independently inspect the public Expo output for bundle `com.cabohealth.app`, version `3.0`, build `8`, `applinks:cabohealth.org`, production App Attest, and exact `WKAppBoundDomains: ["cabohealth.org"]`.

- [ ] **Step 2: Freeze the source commit**

Record `git rev-parse HEAD` as the frozen application-source commit and record the canonical source-tree digest produced by the release guard. Every later authority commit is single-purpose and ordered. The input commit may add only `build-input-attestation.json` and change only `BUILD_INPUT_ATTESTATION_SHA256`; the artifact commit may add only `build-artifact-attestation.json` and change only `BUILD_ARTIFACT_ATTESTATION_SHA256`; the RC commit may add only `rc-attestation.json` and change only `RC_ATTESTATION_SHA256`. Earlier attestations and pins are immutable in later phases, every future or unrelated pin remains null, and `PINNED_EAS_CLI` remains null because exact Node/EAS runtime authority lives in the input attestation. Exact-RC screenshot evidence may use a separate screenshot-manifest-only commit after artifact review and before RC review. A future submit-adapter pin requires its own post-RC reviewed commit that changes only `PINNED_APP_STORE_SUBMIT_ADAPTER`; it may not ride along with input, artifact, or RC authority. The guard must verify exact name-status, exact normalized guard-line changes, ordered commit history, and identical canonical source digest. Any other change invalidates the candidate and restarts the gate.

---

### Task 3: Deploy additive Functions and prove build-7 containment

- [ ] **Step 1: Verify the exact production target read-only**

Confirm Firebase CLI identity, project `cabohealth-owner-prod`, codebase `client-access`, existing parameters/secrets, 7-day Functions image cleanup, and all current Functions active. Do not print secret values.

- [ ] **Step 2: Deploy Functions only**

From the frozen source tree, use the existing reviewed production configuration and exact target:

```bash
npm --prefix functions test
npm --prefix functions run build
npm exec -- firebase deploy --project cabohealth-owner-prod --only functions:client-access
```

Expected: only Functions in codebase `client-access` change; Firestore rules, Hosting, Auth, App Check, IAM, billing, and databases do not.

- [ ] **Step 3: Re-read provider state and run compatibility probes**

Verify every expected Cloud Function and Cloud Run service is active on Node.js 22 under the dedicated runtime identity. Probe authenticated/App-Check test harnesses for:

- V1 and V2 public catalogs omitting external items;
- V1 redeem/refresh/launch rejecting or omitting external items;
- V3 returning discriminated Public items and URL-free VIP previews;
- V2 production grants remaining URL-free;
- V2 external VIP launch returning a URL only after live authorization;
- App Review contracts unchanged;
- broker nonce launch/replay/revocation unchanged.

If any legacy probe fails, stop distribution and deactivate external entries
through new monotonic mutations to stop exposure, but retain the external-aware
Functions and Staff artifacts while even one active or inactive external record
remains. Deactivation does not make retained external records compatible with
pre-feature parsers, and an unchanged schema label is not parser proof.

Restoring any pre-feature Functions or Staff artifact is a hard block unless a
separately designed and verified monotonic migration permanently purges every
external record, reconciles matching projections and every other authoritative
reference, handles all outstanding catalog idempotency receipts without unsafe
replay, and proves that the exact proposed older parsers accept the complete
retained state and legacy responses. This plan authorizes no cleanup command;
if that migration or evidence is absent, investigate and fix forward with the
external-aware artifacts retained.

---

### Task 4: Build, pin, promote, and verify the Staff Portal

- [ ] **Step 1: Build with the existing approved production environment**

Inject the exact production Firebase/App Check values from the approved secure environment without writing them to Git or logs, then run:

```bash
npm --prefix staff-portal test
npm --prefix staff-portal run typecheck
npm run staff:build
```

- [ ] **Step 2: Create a new immutable Staff artifact**

Resolve the already-approved private evidence directory without printing its path, and require an absent output:

```bash
cabo_staff_evidence_root="${CABOHEALTH_STAFF_EVIDENCE_ROOT:?set the approved private Staff evidence directory}"
cabo_staff_manifest="$cabo_staff_evidence_root/staff-portal-external-https-build-8.json"
npm --prefix staff-portal run release:artifact -- --dist dist --out "$cabo_staff_manifest"
npm --prefix staff-portal run release:verify-artifact -- --dist dist --manifest "$cabo_staff_manifest"
```

Record the new release ID, inventory SHA-256, and artifact SHA-256. Never overwrite or relabel the prior artifact.

- [ ] **Step 3: Promote only `public_html/staff` with the prior artifact retained conditionally**

Follow `docs/operations/staff-portal-release.md` using the existing approved
Hostinger channel. Promote the byte-exact verified Staff directory only; do not
add it to the public-web capsule and do not use broad deletion. Retain the prior
complete Staff directory without treating retention or pins as rollback
eligibility. It may be restored only if the runbook's retained-catalog
parser-compatibility precondition is proved; a pre-feature Staff artifact is
prohibited while any external record remains.

- [ ] **Step 4: Verify live bytes and behavior**

```bash
cabo_staff_evidence_root="${CABOHEALTH_STAFF_EVIDENCE_ROOT:?set the approved private Staff evidence directory}"
cabo_staff_manifest="$cabo_staff_evidence_root/staff-portal-external-https-build-8.json"
npm --prefix staff-portal run release:verify-live -- --manifest "$cabo_staff_manifest"
```

Then verify in the in-app browser that a safe external URL validates for Public and VIP, an unsafe URL shows the specific bilingual error, update cannot replace a destination, and the portal displays the third-party rights/privacy warning.

---

### Task 5: Perform a controlled production catalog exercise

- [ ] **Step 1: Check capacity and record the exact pre-state**

Read the sanitized owner catalog first. Do not create test entries if doing so would exceed the 12-item native limit or if an existing record already supplies the required case.

- [ ] **Step 2: Create one clearly labeled temporary Public and one temporary VIP external item**

Use `https://www.eightsleep.com/mx/` only as a functional display test under the owner-authorized exercise. Give the two entries distinct idempotent request IDs and activate them. Record only opaque IDs, revisions, access class, and timestamps in sanitized evidence; do not record the VIP destination URL outside the authoritative catalog.

- [ ] **Step 3: Confirm build-7 containment before build-8 distribution**

On an installed build 7, refresh Public and VIP states and verify neither
temporary external entry appears or launches. Re-run legacy endpoint probes. A
visible external entry on build 7 blocks build 8 distribution; deactivate
external exposure through monotonic mutations while retaining external-aware
Functions and Staff, then investigate and fix forward under Task 3's hard
rollback block.

---

### Task 6: Produce and pin the build-8 input attestation

- [ ] **Step 1: Create a fresh private snapshot and input evidence**

Use the existing release guard workflow with the exact external mode-`0600` production plist supplied only by `CABOHEALTH_GOOGLE_SERVICES_PLIST`, clean recursive runtime, and frozen application-source commit. The attestation hash-binds Node v22.22.3 version/executable, EAS CLI 22.2.0 package/entry/runtime tree, and a sanitized independently reviewed inventory containing only `APP_ENV` from the production profile plus `CABOHEALTH_FIREBASE_PROJECT_ID` and `CABOHEALTH_GOOGLE_SERVICES_PLIST` from the EAS project environment, with source roles and no values/IDs. Generate a new build-8 input attestation at the previously absent current path; do not overwrite build-7 history.

- [ ] **Step 2: Independently review and pin only the build-8 input hash**

Verify candidate identity, frozen source commit/digest, app/config/lock/manifests/verifiers, Firebase project, sanitized Expo config, Node runtime, EAS CLI closure, reviewed variable-name/source-role inventory, and plist hash. Update only the intended input pin in `scripts/release-command-guard.mjs`, prove the source digest remains exact under the phase allowlist, rerun its tests, and commit exactly one added input attestation plus the one changed input-pin line. Artifact, RC, legacy EAS, and submit-adapter pins remain null. If any input changes afterward, clear the pin and restart Task 6.

- [ ] **Step 3: Launch the guarded EAS production build**

```bash
npm run build:prod
```

Expected: production profile, frozen credentials, account `guaderrama`, project `3ebd1d12-4aeb-4d65-8e17-b7726c65018d`, version `3.0`, build `8`. Record the EAS build ID; do not yet claim TestFlight readiness.

---

### Task 7: Audit and attest the exact signed IPA

- [ ] **Step 1: Download the exact EAS artifact to a new private build-8 directory**

Use `release/private/rc-build-8/CaboHealth-3.0-build-8.ipa` only if the directory is absent, current-user-owned mode `0700`, and all files are mode `0600`. Record the download SHA-256 before analysis.

- [ ] **Step 2: Run the exact IPA audit**

Set a task-specific canonical timestamp without exposing credentials:

```bash
cabo_build8_generated_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
cabo_build8_plist="${CABOHEALTH_GOOGLE_SERVICES_PLIST:?set the approved private production plist path}"
node scripts/audit-ios-ipa.mjs \
  --ipa "$(pwd)/release/private/rc-build-8/CaboHealth-3.0-build-8.ipa" \
  --google-services-plist "$cabo_build8_plist" \
  --bundle-id com.cabohealth.app \
  --version 3.0 \
  --build 8 \
  --team-id DQ8PH2DZ3R \
  --firebase-project-id cabohealth-owner-prod \
  --app-attest-environment production \
  --associated-domain applinks:cabohealth.org \
  --generated-at "$cabo_build8_generated_at" \
  --output "$(pwd)/release/private/rc-build-8/privacy-report.json" \
  --attestation-input-dir "$(pwd)/release/private/rc-build-8"
```

Expected: signed identifiers/entitlements/privacy pass; no Staff URL, dormant dev panel, protected-resource capability, tracking, third-party app-bound domain, or external URL is embedded as a privileged entitlement.

- [ ] **Step 3: Create, independently review, and pin the build-artifact attestation**

Bind the exact IPA, EAS build ID, input attestation, source digest, signed entitlements, certificate, provisioning profile, embedded Firebase plist, and privacy report. The EAS build-ID↔artifact association must be independently reviewed procedural evidence or sanitized hash-bound EAS metadata; EAS `FINISHED` alone is not guard proof of that association. Pin only its newly reviewed SHA-256, prove the exact source digest under the artifact-phase allowlist, rerun focused guard tests, and commit exactly one added artifact attestation plus the one changed artifact-pin line. The earlier input attestation and pin are byte-for-byte immutable; RC, legacy EAS, and submit-adapter pins remain null.

---

### Task 8: Upload the attested IPA to TestFlight and wait for processing

- [ ] **Step 1: Run the guarded upload**

```bash
npm run upload:testflight
```

The guard must copy only the attested IPA to a unique private operation directory outside Dropbox, rehash immediately before launch, upload build 8, and remove the temporary operation afterward. It must not submit for review.

Use only `CABOHEALTH_GOOGLE_SERVICES_PLIST` for the private plist input; Tasks 6–8 must not introduce another spelling.

- [ ] **Step 2: Verify App Store Connect read-only**

In the in-app right-side browser, confirm build `8` reaches `VALID`/processed under version `3.0`, bundle `com.cabohealth.app`, Apple ID `6758285327`. Do not select it for App Review. Add it only to the existing internal TestFlight group when all export-compliance questions are truthfully resolved.

---

### Task 9: Complete physical-device QA and final TestFlight evidence

- [ ] **Step 1: Test clean install and upgrade on two physical iPhones**

Run English and Spanish. Verify Public internal, Public external, locked VIP cards, code redemption, VIP internal broker, VIP external launch, favorites, Settings, legal pages, accessibility, appearance, offline/error behavior, and foreground/background lifecycle.

- [ ] **Step 2: Exercise external-WebView security behavior**

Verify exact initial page, normal same-origin navigation, blocked cross-origin links, blocked popups/new windows, blocked unsafe schemes, no Safari/Chrome handoff, no share/favorite leakage, generic retry/back behavior, and teardown on foreground revalidation. Deactivate the external entry while open and confirm the next refresh/foreground closes access. Revoke/delete the VIP access state and confirm route and WebView destruction.

- [ ] **Step 3: Prove regressions remain closed**

Verify App Review sample, one-time broker nonce, replay rejection, code
replacement/revocation, deletion, AASA Universal Links for CaboHealth-only
`/apps/*/`, and build-7 containment. Confirm no VIP destination URL appears in
the VIP preview, grant, route parameters, VIP session AsyncStorage, favorites,
app logs, Functions logs, receipts, or sanitized audit evidence. The separately
reviewed Public V3 catalog cache is the intentional exception:
`@cabohealth_published_catalog_v3` may and should contain the canonical URL for
a validated external Public item until a valid newer snapshot replaces it.

- [ ] **Step 4: Produce final evidence, not planned evidence**

Only after real observations exist, canonicalize physical-iPhone QA, exact build-8 screenshots, and App Store Connect evidence with `scripts/apple-post-build-evidence.mjs`. Bind them to the processed build-8 ID and frozen source digest. Record the tracked screenshot manifest in its own screenshot-manifest-only evidence commit after artifact review. Then create and independently review the final RC attestation and commit exactly one added RC attestation plus the one changed RC-pin line. Input/artifact authorities remain byte-for-byte immutable and the legacy EAS/submit-adapter pins remain null; never copy build-7 evidence.

- [ ] **Step 5: Stop at ready-for-owner-review**

Provide Ivan the exact build-8 TestFlight result, remaining truthful metadata/rights decisions, QA failures if any, and rollback status. Do not run `npm run submit` and do not click **Submit for Review**. A future submit action requires independent review of the adapter closure followed by a separate commit changing only `PINNED_APP_STORE_SUBMIT_ADAPTER`; the guard must reject any attempt to introduce that pin during input, artifact, or RC phases. A separate immediate confirmation is required for the final action.
