# CaboHealth Apple readiness implementation plan

> **For agentic workers:** Use systematic-debugging, test-driven-development and verification-before-completion. Root integrates independent, file-bounded parallel tasks and a fresh whole-change review. No production action follows merely from a green local test.

**Goal:** Resolve the verified audit defects and validate every area of the real product before preparing an Apple review candidate, preserving public/VIP miniapps and truthful evidence.

**Architecture:** Preserve the Expo/Firebase/Hostinger architecture and security boundaries. Reuse the isolated checkout on `codex/apple-readiness-oct1`, based on `96112dd`; retain build 13 and its source/artifact authority as historical evidence. Changes require a successor candidate and new evidence, never reusing build 13 approval.

**Tech Stack:** Expo 54 / React Native 0.81 / TypeScript; Firebase Functions Node 22; React/Vite Staff; PHP brokers.

**Spec:** User goal in this thread plus `/Users/ivan/Dropbox/Ai/IOS Cabo Health App/docs/audits/2026-10-01-auditoria-cabohealth.md`; existing rejection diagnosis `docs/operations/app-review-2026-09-16-diagnosis.md`. The full requested end state is functional, policy-aligned Apple readiness, not merely closing the initial findings.

## Global constraints

- Do not claim 100% correctness or guarantee Apple's approval.
- Preserve public and VIP catalog features, bilingual copy, code validation, authorization, App Check, URL validation, launch windows and data deletion.
- Never weaken a release guard, suppress a failing assertion or fabricate physical/device/Apple evidence to get green status.
- Preserve build 13 byte-for-byte. Never overwrite private evidence or expose keys/codes.
- No destructive cleanup, access expansion, purchase, production deployment or final submission is implied by local verification. Resolve required authority and business facts before those actions.
- Existing $300 MXN/month ceiling remains; no new paid service or plan without verified cost/authority.
- Root owns release files, dependency manifests/locks and final integration. Native worker owns app/catalog/theme code and corresponding tests; backend worker owns Functions source/tests. Coordinate `app.json` before rebaseline.
- Use the integrated browser only. Physical App Review credential testing is not replaced by ordinary VIP testing.

## Review focus

1. Returning from background with an unchanged catalog must preserve the active public page.
2. A first-install callable failure must visibly explain recovery without exposing unauthorized fallback content.
3. Persistent deletion failures must not starve newer requests or disappear from monitoring.
4. Malformed deep links and unavailable networks must not freeze, strand or silently sign out the user.
5. New dependencies and source changes invalidate old build authority; provider operations must not duplicate on ambiguous outcomes.

## Task 1: Native resilience

**Files:** `app/apps/[slug].tsx`, `context/PublicCatalogContext.tsx`, `app/(main)/index.tsx`, `app/(main)/saved.tsx`, existing error/banner components, translations, `app.json`, associated tests in `tests/`.
**Interfaces:** Preserve PublicCatalogContext's `isLoading`, `isInitialLoading`, `error`, `refresh()`. Errors must remain localized and accessible. No new public catalog fallback in native.

- [ ] Reproduce route unmount, silent first-load error and forced system theme against current files.
- [ ] Write behavior regressions first; confirm each fails on the original defect.
- [ ] Preserve loaded WebView during background refresh, expose error/retry on failed catalog retrieval, and make native theme follow the offered System setting.
- [ ] Verify populated-cache refresh errors retain usable content; explicit refresh still works; cold failure recovery displays new content.
- [ ] Run focused tests, typecheck and lint; root runs the full suite after integration and source rebaseline.

## Task 2: Durable deletion and deterministic tests

**Files:** `functions/src/domain/clientAccountDeletion.ts`, `functions/src/repositories/firestoreClientAccessStore.ts`, Functions deletion integration/unit tests; wiring only if required for operational error signal.
**Interfaces:** Preserve public deletion receipt schema and idempotent deletion. Internal retry result/error may expose aggregate counts, never UIDs or secrets in public errors.

- [ ] Write a regression with five jobs, first four persistently failing, and prove the fifth eventually runs.
- [ ] Write a regression that distinguishes persistent Auth failure from a healthy empty/successful maintenance run.
- [ ] Implement fair ordering/retry visibility using existing repository patterns; retain durable revoked state and bounded batch size.
- [ ] Inject a consistent test clock in the already failing receipt test; do not relax production expiry.
- [ ] Run all Functions tests; exercise success, pending, malformed and retry paths.

## Task 3: Dependency and runtime hardening

**Files:** root/Functions/Staff `package.json` and lockfiles; targeted runtime regressions if reachability requires an application fix. Do not replace the SDK family blindly.
**Interfaces:** Keep Expo/React Native/RNFirebase compatible, patch-package patches applicable, Node 22 engine and security contracts intact.

- [ ] Revalidate actual installed/locked versions and each applicable advisory's fixed ranges.
- [ ] Prioritize decoder/runtime HTTP packages, then compatible build-tool fixes; inspect advisory preconditions rather than claiming every transitive alert is exploitable.
- [ ] Verify hostile deep-link boundary with a bounded child-process test before any application behavior change.
- [ ] Apply the smallest compatible dependency updates; run install scripts and patch verification in a controlled environment. No `audit fix --force`.
- [ ] Repeat production audits for all three trees and document any residual advisory with reachability and mitigation.
- [ ] Run app, Functions and Staff full tests/typechecks/build checks after updates.

## Task 4: Whole-product and policy verification

**Files:** operational evidence checklist for this plan; application fixes only after a specific defect is reproduced with a regression.
**Interfaces:** Source, deployed web, authenticated Staff, backend, TestFlight device and Apple metadata are distinct evidence domains.

- [ ] Cover onboarding, public catalog, VIP preview/code/recovery/revocation, internal/external miniapps, favorites, visit tools, language/theme, offline/error behavior, deletion, accessibility and WebView termination.
- [ ] Cover Staff create/edit/activate/deactivate/archive flows without mutating live customer data; use local tests/controlled fixtures before any scoped live check.
- [ ] Verify hosted pages/links, brokers and deployed service identity/configuration without exposing secrets.
- [ ] Resolve whether VIP access is sold digital content or complimentary to physical services; maintain truthful product/notes rather than hiding features for review.
- [ ] Verify current Apple rules, privacy mapping, age rating, content rights, medical-device declaration where applicable and actual account/entity fit.
- [ ] Perform fresh independent review of integrated changes and resolve important findings through failing tests.

## Task 5: Successor candidate, physical QA and Apple handoff

**Files:** active release configuration, guard/constants, current metadata, archive and regression test for the successor; exact paths derived from current guard and provider inventory.
**Interfaces:** New clean source digest -> reviewed input attestation -> one EAS build -> reviewed exact IPA -> one upload -> processed TestFlight -> physical QA -> matching metadata/RC evidence -> authorized submission.

- [ ] Check latest provider build inventory before reserving the successor number; preserve build 13 constances with hash integrity tests and reset only active authority for the new candidate.
- [ ] Re-run all gates on a clean committed source; do not interpret a dirty-source guard failure as permission to weaken it.
- [ ] Validate build cost/available quota and existing credentials; use protected one-attempt commands and inspect any running handle before retrying.
- [ ] Audit the exact IPA and deliver to existing authorized testers when the candidate is verified.
- [ ] On physical iPhone and compatible iPad, verify the actual AR and VIP flows, background/restore/network behavior, core resources, deletion, layout and accessibility. Store original screenshots without credentials.
- [ ] Reconcile actual App Store Connect build, screenshots, notes, privacy, rights and declarations. Do not copy pending local templates over verified live facts blindly.
- [ ] Submit only after the real completion evidence and required action-time approval are satisfied; report submission separately from Apple acceptance.

## Completion evidence matrix

All rows start incomplete until authoritative evidence is recorded: native functionality; catalog/Staff; VIP/AR auth; server/deletion; web/brokers; dependencies; accessibility; privacy/content/payment policies; exact release provenance; device QA; App Store metadata; submission/Apple outcome. A green subset cannot close the user goal.
