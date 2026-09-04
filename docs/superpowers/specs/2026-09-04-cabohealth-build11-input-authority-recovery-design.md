# CaboHealth build 11 input-authority recovery design

## Problem

Build 11 input authority attempt 1 was pinned in commit `7350fe3`, against
frozen source `3f61e31` and source digest
`a2f3270ddea31b8a8ce7b55b021a6ba68244579e7e368e68834b19458da7b56d`.
The following test-only commit `aac7e5f` fixed phase-transition coverage, but
that tracked source change correctly invalidated the already-pinned authority.
No EAS build, upload, IPA, TestFlight mutation, or Apple mutation was initiated.

## Safety decision

Git history will not be rewritten. The first attestation remains auditable as
an invalidated pre-provider authority attempt. The current build number remains
`11` because no provider build identity was consumed; this remains conditional
on a final read-only EAS inventory check immediately before the first build.

The first attestation moves byte-for-byte to:

`release/app-store/3.0/history/build-11-input-attempt-1-aborted/`

Its canonical manifest binds the exact candidate, frozen source, authority
commit, invalidating commit and changed path, and explicit null provider
identities. It is historical evidence only and cannot authorize a build.

## Recovery authority model

1. Archive attempt 1 and reset the current input pin to `null` while every
   later pin remains `null`.
2. Make every required test, verifier, metadata, documentation, and evidence
   routing change before the replacement freeze commit.
3. Generalize the build-11 phase contract so valid contiguous pre-input,
   input, artifact, RC, and submit-tool states do not require later tracked
   fixes. The EAS CLI legacy pin remains `null`.
4. Freeze and independently review the new all-null source epoch.
5. Use a fresh external mode-`0700` Task 3 recovery evidence directory. Read
   the live production EAS inventory without retaining values, rediscover the
   one valid external mode-`0600` Firebase plist without exposing its path, and
   generate a new canonical build-input attestation.
6. Pin the replacement in an exact two-path commit: add the live attestation
   and change only the normalized input-pin literal.
7. No tracked change may follow that pin before the build provider operation.

## Phase-aware post-artifact metadata transition

The refreeze also defines every later metadata state before a replacement input
pin exists. The live phase is derived only from the exact guard pins and the
matching current attestation bytes; prose and mutable-looking checklist rows are
never phase authority.

- Pre-input and input accept only the exact pending screenshot, App Privacy,
  and Review Notes baselines.
- Artifact accepts these ordered tuples only: all three pending; final
  screenshots with pending App Privacy and Review Notes; or final screenshots
  with the exact finalized App Privacy and Review Notes pair. Final metadata
  cannot precede final screenshots, and App Privacy/Review Notes never
  transition separately.
- RC and submit-tool require all three final forms. RC schema v1 binds the
  tracked final metadata bytes independently as `appPrivacySha256` and
  `reviewNotesSha256`, in addition to the screenshot, physical-QA, and App Store
  Connect evidence hashes.

The release manifest, age questionnaire, accessibility checklist, rights
inventory/checklist, declarations, and submission gates are immutable
freeze-time baselines. Their live completion is represented only by RC-bound
private evidence. The one permitted post-artifact metadata commit changes
exactly `app-privacy.json` and `review-notes.md`; no tracked metadata or baseline
edit may follow it before the RC authority commit.

The exact final privacy form uses `Yes, we collect data from this app`, no
tracking, and linked answers for User ID, Device ID, Product Interaction,
Coarse Location, Performance Data, and Other Diagnostic Data. Other Diagnostic
Data uses App Functionality plus Apple’s Analytics purpose. The signed
FirebaseAuth-specific unlinked Other Diagnostic Data/Analytics fact remains
separately recorded, while the app-level category stays conservatively linked
because provider request logs may be re-linkable. Final Review Notes are the
exact existing build-11 body with only the pending wrapper and transition
heading removed.

The age baseline truthfully requires Unrestricted Web Access and projects 16+
under Apple’s updated system and 17+ for earlier operating systems. A saved
global result is bound only in the private App Store Connect evidence. Regional
values are not asserted there or written into tracked baseline files; Apple
derives them.

## Acceptance

- Attempt 1 SHA-256 remains
  `e0b888bada5ce1f0d39b408307f3a107562a7007f891bd541d08bb2b4528b4fd`.
- Its history manifest is canonical one-line JSON and says
  `providerOperationInitiated: false` with all provider identities `null`.
- The refreeze has five `null` pins, no current attestations, and full green
  tests, typecheck, lint, scope, adapter, and diff checks.
- The replacement authority is based only on the new clean refreeze, current
  value-free production inventory, the exact external plist, and reviewed
  runtime/config bytes.
- The replacement pin commit contains exactly one added attestation and one
  normalized guard-pin change, and all post-pin gates pass without source edits.
- Every pre-input through submit-tool fixture accepts only its ordered metadata
  tuple, and the final RC binds both tracked metadata hashes with no later edit.
