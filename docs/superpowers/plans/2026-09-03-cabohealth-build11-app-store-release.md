# CaboHealth 3.0 build 11 App Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce, verify, and submit the exact CaboHealth 3.0 build 11 release candidate.

**Architecture:** Preserve build 10 as immutable processed TestFlight history,
then reuse the fail-closed attestation pipeline for a new build-11 source freeze.
All provider actions consume hash-bound evidence and stop on ambiguous state;
App Store mutation and final submission remain separate owner-confirmed actions.

**Tech Stack:** Expo 54, React Native 0.81, TypeScript 5.9, Node 22.22.3,
EAS CLI 22.2.0, Firebase, Hostinger, App Store Connect.

**Spec:** `docs/superpowers/specs/2026-09-03-cabohealth-build11-app-store-release-design.md`

## Global Constraints

- Marketing version is exactly `3.0`; current build number is exactly `11`.
- Bundle identifier is exactly `com.cabohealth.app`; Apple ID is exactly `6758285327`.
- Do not select, screenshot, repin, rebuild, or submit build 10 as the current candidate.
- Do not move, delete, or reuse `release/private/rc-build-10/`.
- Do not print, log, screenshot, or commit any Firebase, EAS, Apple, or App Review secret.
- Never retry an initiated or ambiguous EAS/Apple mutation automatically.
- Final App Store submission requires a fresh owner confirmation after the exact summary is shown.

---

### Task 1: Localize the introduction and repair the submission evidence contract

**Files:**
- Modify: `features/onboarding/IntroScreen.tsx`
- Modify: `i18n/messages.ts`
- Modify: `tests/intro-policy.test.mjs`
- Modify: `tests/localization-contract.test.mjs`
- Modify: `tools/app-store-submit-adapter/src/evidence.mjs`
- Modify: `tools/app-store-submit-adapter/src/files.mjs`
- Modify: `tools/app-store-submit-adapter/test/evidence.test.mjs`
- Modify: `tools/app-store-submit-adapter/test/helpers.mjs`

**Interfaces:**
- Consumes: `useTranslations()` and the canonical build-artifact attestation.
- Produces: localized intro keys and a validator accepting only the exact
  `easArtifactAssociation` relationship while rejecting hard-linked evidence.

- [ ] Write source-contract tests for five `intro.*` keys and their use by the screen.
- [ ] Run the two focused localization tests and observe failures caused by missing keys and English literals.
- [ ] Add English and Mexican Spanish messages and route all visible/accessibility intro copy through `t()`.
- [ ] Re-run the focused tests and require `17` passing, `0` failing.
- [ ] Add adapter tests for the authentic EAS association, mismatched IPA hash,
  extra association fields, hard-linked evidence, NUL paths, and valid paths up to 512 characters.
- [ ] Run the focused adapter evidence test and observe the expected failures.
- [ ] Implement exact nested validation, chronological review binding, link-count checks, and the canonical path contract.
- [ ] Run the adapter suite and require `166` passing, `0` failing.

### Task 2: Rebaseline and freeze build 11

**Files:**
- Rename: `release/app-store/3.0/build-input-attestation.json` to `release/app-store/3.0/history/build-10/build-input-attestation.json`
- Rename: `release/app-store/3.0/build-artifact-attestation.json` to `release/app-store/3.0/history/build-10/build-artifact-attestation.json`
- Create: `release/app-store/3.0/history/build-10/manifest.json`
- Rename: `tests/build10-rebaseline-contract.test.mjs` to `tests/build11-rebaseline-contract.test.mjs`
- Modify: the current candidate identity files, release scripts, adapter constants,
  release metadata, operational runbooks, and direct tests enumerated in the spec.

**Interfaces:**
- Consumes: immutable build-10 hashes and provider identities from the spec.
- Produces: a pre-input build-11 authority with five null pins and private root `rc-build-11`.

- [ ] Rename and update the rebaseline contract test first. Assert candidate build
  11, five null pins, absent current attestations, byte-exact build-10 history,
  and a manifest binding the exact source/input/artifact/EAS/IPA/submission/Apple IDs.
- [ ] Run the rebaseline and scope tests; verify they fail because build 10 is still current.
- [ ] Move both build-10 attestations without changing their bytes and create the
  canonical one-line history manifest described by the spec.
- [ ] Change `app.json` and `constants/config.ts` to build `11`.
- [ ] Change every current release/tool candidate and private path to build 11,
  reset all five guard pins to `null`, and leave `rc-attestation.json` absent.
- [ ] Update current release documents and verifiers to classify build 10 only as
  processed internal-TestFlight history; never alter historical build-10 bytes.
- [ ] Refresh reviewed content hashes only after the final bytes exist.
- [ ] Run focused rebaseline, metadata, release-v3, adapter, and scope tests.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:scope`,
  and `git diff --check`; require zero failures.
- [ ] Obtain an independent diff review and commit the reviewed freeze as
  `chore(release): rebaseline CaboHealth build 11`.

### Task 3: Produce and pin the build-input authority

**Files:**
- Create: `release/app-store/3.0/build-input-attestation.json`
- Modify: `scripts/release-command-guard.mjs` (input pin only)
- Write ignored private evidence under a fresh external mode-`0700` directory.

**Interfaces:**
- Consumes: exact clean build-11 freeze, production Firebase plist, and fresh
  value-free EAS environment inventory.
- Produces: canonical build-input attestation and its SHA-256 pin.

- [ ] Resolve one owned, regular, non-symlink, single-link mode-`0600`
  production plist outside Dropbox; keep its path only in process memory.
- [ ] Read and sanitize the live production EAS variable inventory without retaining values.
- [ ] Generate the build-input candidate and run producer, guard, metadata, and scope checks.
- [ ] Independently review candidate bytes, modes, hashes, runtime closure, Expo config, and environment identity.
- [ ] Materialize the approved candidate and modify only the input pin.
- [ ] Verify the staged delta is exactly the attestation plus one normalized pin change.
- [ ] Commit `chore(release): pin build 11 input attestation` and rerun all post-pin gates.

### Task 4: Build once, audit the IPA, and pin artifact authority

**Files:**
- Create ignored evidence at `release/private/rc-build-11/`.
- Create: `release/app-store/3.0/build-artifact-attestation.json`
- Modify: `scripts/release-command-guard.mjs` (artifact pin only)

**Interfaces:**
- Consumes: pinned build-input authority and frozen EAS environment.
- Produces: one Store IPA, exact privacy/signing audit, and pinned artifact authority.

- [ ] Create a new external mode-`0700` evidence root with mode-`0600` children and no build-attempt marker.
- [ ] Recheck account/project/environment identity and absence of a build-11 provider operation.
- [ ] Run exactly `npm run build:prod`; if initiation is ambiguous, stop without retrying.
- [ ] Wait for one terminal EAS result, sanitize it, and bind its UUID/status/version/build.
- [ ] Download exactly one Store IPA to `release/private/rc-build-11/CaboHealth-3.0-build-11.ipa`.
- [ ] Audit bundle, build, Team, signing, App Attest, Firebase, privacy manifests,
  encryption, minimum iOS, device family, and associated domain.
- [ ] Generate and independently review the build-artifact attestation.
- [ ] Materialize it and modify only the artifact pin; verify the two-path delta.
- [ ] Commit `chore(release): pin build 11 artifact attestation` and rerun post-pin gates.

### Task 5: Upload build 11 to internal TestFlight and verify processing

**Files:**
- Write only ignored sanitized upload and App Store observation evidence.

**Interfaces:**
- Consumes: attested local IPA.
- Produces: one TestFlight upload associated with the existing internal group `cabo health`.

- [ ] Rehash the local IPA and run exactly `npm run upload:testflight`.
- [ ] Wait for the terminal EAS submission; never retry an ambiguous upload.
- [ ] Observe App Store Connect read-only until build 11 is `VALID` / ready.
- [ ] If not already assigned, use only the guarded existing-group assignment path; never create a group.
- [ ] Record the exact Apple build resource ID and processing timestamp.

### Task 6: Complete physical QA and exact screenshots

**Files:**
- Create ignored: `release/private/rc-build-11/physical-iphone-qa.json`
- Create ignored screenshots under `release/private/rc-build-11/screenshots/`
- Modify: `release/app-store/3.0/screenshots-manifest.json`

**Interfaces:**
- Consumes: processed TestFlight build 11 on two physical iPhones.
- Produces: thirteen-check QA evidence and sixteen exact reviewed screenshots.

- [ ] On one clean installation and one upgrade installation, run all thirteen QA checks in both locales.
- [ ] Capture the eight storyboard scenes in `en-US`, then the same eight in `es-MX`, using original opaque Apple-accepted dimensions.
- [ ] Verify no alpha, clipping, notification, secret, personal data, test entry, browser chrome, or obsolete feature.
- [ ] Hash every image, run OCR scope checks, complete human sign-off, and generate the reviewed manifest.
- [ ] Upload the catalog-first marketing order only after the exact files have passed validation.

### Task 7: Finalize App Store metadata, privacy, review access, and RC evidence

**Files:**
- Finalize: `release/app-store/3.0/app-privacy.json`
- Finalize: `release/app-store/3.0/review-notes.md`
- Create ignored: `release/private/rc-build-11/app-store-connect-evidence.json`
- Create: `release/app-store/3.0/rc-attestation.json`
- Modify: `scripts/release-command-guard.mjs` (RC and adapter pins only through their reviewed phases)

**Interfaces:**
- Consumes: processed build, QA, screenshots, rights/age/privacy decisions, and one fixed review credential.
- Produces: complete, cross-bound RC evidence ready for the guarded submit adapter.

- [ ] Select build 11, replace the three obsolete screenshots, and verify both localizations.
- [ ] Change App Privacy from `Data Not Collected` to the exact reviewed data-type/purpose/linkage answers; publish only after owner confirmation.
- [ ] Confirm category, truthful Unrestricted Web Access and Apple’s saved result
  against the 16+ updated / 17+ earlier-OS baseline, USA/Mexico availability, free price,
  individual seller/trade-brand rights, DSA status, export answer, phone, and email.
- [ ] Generate one App Review sandbox credential after action-time confirmation;
  test it on the physical devices and transmit it only into App Store Connect.
- [ ] Commit final screenshots first; then replace stale build-4 notes and the
  pending privacy baseline in one exact two-file transition and save all metadata.
- [ ] Capture canonical App Store evidence, produce the RC attestation, pin it,
  package/review the exact submit adapter closure, and pin that closure.
- [ ] Bind final `app-privacy.json` and `review-notes.md` bytes separately in RC
  schema v1 as `appPrivacySha256` and `reviewNotesSha256`. Do not edit the
  manifest, age baseline, rights/accessibility checklists, or any other tracked
  metadata after the input pin.

### Task 8: Guarded final submission

**Files:**
- Consume the reviewed release authorities without editing them.

**Interfaces:**
- Consumes: exact build-11 RC attestation, submission adapter pin, and short-lived authorization nonce.
- Produces: one App Store review submission and verified read-back.

- [ ] Run every final guard in dry-run/read-only mode and present the exact binary,
  metadata, privacy, screenshot, credential-destination, and release summary.
- [ ] Obtain a fresh explicit owner confirmation for `Submit for Review`.
- [ ] Arm one short-lived nonce and execute `npm run submit` exactly once.
- [ ] Verify App Store read-back leaves `READY_FOR_REVIEW` for a submitted state;
  if the result is uncertain, do not repeat the mutation.
- [ ] Report the exact state and retain rollback/evidence until Apple review is resolved.
