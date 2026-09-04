# CaboHealth build 11 input-authority recovery plan

Binding design:
`docs/superpowers/specs/2026-09-04-cabohealth-build11-input-authority-recovery-design.md`.

## Task 1: Archive attempt 1 and refreeze

- Add failing coverage for the exact aborted input-attempt history and for all
  valid contiguous future authority phases.
- Move the current input attestation byte-for-byte to
  `history/build-11-input-attempt-1-aborted/` and create its canonical manifest.
- Add `historicalInputAuthorityEvidence` to the current release manifest while
  keeping build 11 as the sole current candidate.
- Reset only the input pin to `null`; keep all later pins `null` and current
  attestations absent.
- Route Task 3 producers to a fresh `task-3-recovery-evidence` directory.
- Update current verifiers, tests, release records, and operations records so
  attempt 1 is only invalidated pre-provider history.
- Run all focused and full gates, obtain independent review, and commit:

  `chore(release): refreeze CaboHealth build 11 after pre-provider input invalidation`

## Task 2: Produce and pin replacement authority

- Reconfirm EAS account/project and that no build 11 exists.
- Rediscover the exact external production Firebase plist without logging its
  path or content.
- Read and strictly sanitize the live production EAS inventory into a fresh
  external mode-`0700` recovery evidence root.
- Generate and independently review the replacement canonical candidate.
- Materialize it and change only the input pin in an exact two-path commit:

  `chore(release): pin refrozen build 11 input attestation`

- Run every post-pin gate without any later tracked edit. Stop before the first
  EAS build if identity is ambiguous or any authority check fails.

## Task 2A: Recover the replacement post-pin gate failure

- Preserve the correct replacement pin commit `279c49b` and the test-only
  invalidation commit `71c0a98`; do not reset or amend Git history.
- Archive the exact replacement attestation under
  `history/build-11-input-attempt-2-aborted/` with a canonical manifest that
  records the mandatory post-pin gate failure, both changed test paths, and
  explicit null provider identities.
- Reset only the current input pin, remove the current attestation, and add
  attempt 2 to the separate historical input-authority evidence list.
- Make synthetic authority fixtures start from five explicit null pins and
  make live-state tests accept only a valid contiguous current phase.
- Update both verifiers, negative tests, and release records for the two exact
  invalidated attempts; run all gates and independently review the refreeze.
- Produce a fresh candidate from the new source epoch, pin it in another exact
  two-path commit, and require every post-pin gate to pass before the sole EAS
  build is started.

## Frozen continuation after Task 2

- Keep the release manifest, age baseline, accessibility/rights/declaration
  checklists, and submission gates unchanged after the replacement input pin;
  their final live state belongs only to RC-bound private evidence.
- After the artifact is pinned and TestFlight is processed, transition
  screenshots first. Then change exactly `app-privacy.json` and
  `review-notes.md` together from their exact pending forms to their predefined
  final forms. Never allow final metadata while screenshots are pending or one
  metadata file without the other.
- The exact final privacy mapping is Data Collected = Yes, tracking = No, with
  User ID, Device ID, Product Interaction, Coarse Location, Performance Data,
  and Other Diagnostic Data conservatively linked. Preserve the signed
  FirebaseAuth-specific unlinked Other Diagnostic Data/Analytics fact as a
  source-specific fact, not as an under-disclosed app-level answer.
- Save the truthful Unrestricted Web Access questionnaire and accept Apple’s
  recalculated result from the 16+ updated / 17+ legacy baseline; never restore
  the stale 9+ expectation or edit the tracked age baseline.
- Create RC schema v1 only after all final evidence exists. Bind both final
  tracked files with `appPrivacySha256` and `reviewNotesSha256`, plus the
  screenshot, physical-QA, and App Store Connect evidence hashes. No tracked
  edit is permitted after the metadata pair except the reviewed RC pin commit
  and later reviewed submit-adapter pin commit.
