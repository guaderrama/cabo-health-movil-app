# CaboHealth build 13 access recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Preserve the existing isolated checkout and all historical evidence.

**Goal:** Deliver the reviewed session-preservation correction to TestFlight for physical iPhone/iPad testing, without claiming Apple's original incident is reproduced or resolved.

**Architecture:** Retain the existing strict Firebase launch parser and release authority chain. Rebaseline the current candidate from 3.0 (12) to 3.0 (13), archive build 12 byte-for-byte, and produce new input/artifact authority before any upload.

**Tech Stack:** Expo 54, React Native 0.81, Firebase, Node 22.22.3, pinned project EAS CLI 22.2.0.

**Spec:** `docs/operations/app-review-2026-09-16-diagnosis.md` defines the reproduced defect and uncertainty. The authority sequencing in `docs/superpowers/specs/2026-09-04-cabohealth-build12-post-artifact-recovery-design.md` remains applicable to this new candidate, not permission to reuse build 12 evidence.

## Global constraints

- Preserve strict URL, realm, schema, nonce, grant, App Check, and actual-time launch validation.
- No Firebase/backend deployment or credential rotation is needed for this patch.
- Do not update dependencies, signing identity, bundle identifier, entitlements, iOS minimum, or device family.
- Keep all previous builds and private evidence intact. A new native source digest requires new input and artifact attestations.
- Use only protected build/upload entry points, at most one provider operation per phase; reconcile ambiguous results before any retry.
- TestFlight distribution to the already approved office group is in scope. Final App Review submission remains after hardware QA and a fresh action-time confirmation.

## Review focus

- Expired/future but structurally valid launches must be denied without deleting an authenticated session.
- Unsafe URLs, wrong realms, malformed nonces or response schemas must still fail closed.
- Build 12 authority must never authorize build 13; archive hashes must remain exact.
- Dirty source, partial phase pins, or stale artifact association must block publishing.
- App Attest/network/device-clock behavior must be tested on hardware; unit tests cannot establish Apple's exact cause.

### Task 1: Verify the existing access correction

**Files:** `features/clientAccess/firebaseClientAccessAdapter.ts`, `tests/firebase-client-access-adapter.test.mjs`, diagnosis document above.
**Interfaces:** Consumes the strict envelope parser and controller. Produces a denied launch with retained principal only for valid-structure time failures.

- [ ] Run `node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json` and `node --test tests/firebase-client-access-adapter.test.mjs`.
- [ ] Independently review the source delta; record remaining hardware uncertainty.
- [ ] Run `npm run typecheck` and `npm run lint` before freezing source.

### Task 2: Freeze a new candidate without reusing authority

**Files:** Active release/config/script/test/metadata paths from the previous rebaseline commit `e2b483b`, excluding all historical evidence and previous plan/spec files. New archive: `release/app-store/3.0/history/build-12/`. Contract: `tests/build13-rebaseline-contract.test.mjs`.
**Interfaces:** Consumes verified source and immutable build 12 attestations; produces build 13 pre-input phase, null pins and distinct task-scoped evidence namespace.

- [ ] Add an archive-integrity regression first: assert the exact build-12 input SHA `f97c87859d9df5ced271121f6d522b44d6375cda745846abfe44d17cd8c19ed0` and artifact SHA `3edaa6ebe18f01707cc651e3303d03fca2983d5ca96bcc27d775288b03d29028`; watch it fail before archiving.
- [ ] Copy both attestations unchanged into history, record the observed EAS build `181bb213-b43e-49b0-bfed-bbfc4d99f1d0`, then remove only current authority copies through a tracked archive move.
- [ ] Mechanically update active candidate references, private build paths, and task evidence namespace to build 13; retain all earlier history. Reset current pins to null. Recompute exact reviewed metadata/config digests after inspection; do not remove validation.
- [ ] Run focused release contracts and `npm run test:scope`; inspect `git diff --check` and the exact delta. Commit only this scoped change, then run the full suite on clean tracked source.

### Task 3: Produce input, build and artifact authority

**Files:** `scripts/create-build-input-attestation.mjs`, existing protected release runner and exact-IPA audit tools; output under this plan's task-2/task-4/task-5 evidence folders and `release/private/rc-build-13`.
**Interfaces:** Consumes clean reviewed candidate; produces a uniquely associated signed build with new independently reviewed hashes.

- [ ] Reconfirm Expo account/project and sanitized production environment inventory; do not print secret values.
- [ ] Generate input candidate using the checked-in producer's validated arguments, review it, and commit only canonical input attestation plus the input pin.
- [ ] Re-run post-pin gates. Invoke `npm run build:prod` once through the attempt runner with required evidence paths. Observe the existing attempt until terminal.
- [ ] Download/audit the exact returned IPA, review artifact association, and pin its canonical attestation in the prescribed two-path commit. Re-run gates.

### Task 4: Deliver TestFlight and request hardware evidence

**Interfaces:** Consumes exact verified build 13 artifact; produces Apple's processed build and confirmed availability in office group `3629540d-5994-4240-ac85-62e49f6c1b7c`, not App Store publication.

- [ ] Invoke `npm run upload:testflight` once with the verified artifact. Record provider receipt and Apple processing state.
- [ ] Assign the processed build to the approved office tester group through App Store Connect; complete beta review requirements accurately if Apple requests them.
- [ ] Confirm actual tester availability before telling Víctor to install. Ask for the access/retry flow and original iPad screenshots, with no credentials visible.
- [ ] Record exactly which external/hardware gates remain. Do not claim the rejection is solved or the app approved.
