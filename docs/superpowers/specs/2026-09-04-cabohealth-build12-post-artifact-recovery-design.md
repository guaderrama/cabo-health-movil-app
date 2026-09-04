# CaboHealth build 12 post-artifact recovery design

## Incident

Build 11 completed in EAS and its exact IPA passed independent signature,
provisioning, privacy-manifest, Firebase, entitlement, inventory, and hash
review. After the artifact attestation was pinned, the mandatory full suite
exposed one phase-stale synthetic fixture in
`tests/build11-rebaseline-contract.test.mjs`. The fixture derived an input-phase
guard from the live artifact-phase guard instead of first normalizing all five
authority pins to `null`.

This was not a binary defect, but tests are part of the frozen source digest.
Committing the correction would invalidate build 11's input and artifact
authority. The EAS build identity was already consumed, so build 11 cannot be
rebuilt, uploaded, or reused.

## Recovery decision

- Preserve build 11 input and artifact attestations byte-for-byte under
  `release/app-store/3.0/history/build-11/`.
- Preserve `release/private/rc-build-11/` and the provider evidence. Do not
  upload its IPA.
- Record the exact source, pin commits, EAS build ID, IPA hash, failing gate,
  and null upload/Apple observations in a canonical historical manifest.
- Rebaseline the current candidate to 3.0/build 12 with all five authority pins
  `null` and no current input, artifact, or RC attestation.
- Fix every synthetic phase fixture before the build-12 source freeze. Each
  synthetic state must begin from an explicit all-five-null guard.

## Authority sequence

Use one evidence namespace:

`/.superpowers/sdd/2026-09-04-cabohealth-build12-post-artifact-recovery`

- Task 2: sanitized EAS inventory and build-input evidence.
- Task 3: protected build-attempt evidence.
- Task 4: artifact download, audit, association, and attestation evidence.
- Task 5: upload/submission evidence.

The sequence remains fail closed: refreeze, full green gates, input attestation,
input-pin-only commit, post-pin green gates, exactly one EAS build, artifact
audit, artifact-pin-only commit, post-pin green gates, exactly one TestFlight
upload, physical-device QA, screenshots/final metadata, RC attestation,
submit-tool pin, and explicit owner confirmation immediately before Submit for
Review.

## Acceptance

- Build 11 historical hashes and provider identity remain immutable.
- Build 12 is the only current candidate in app/config, guards, verifiers,
  metadata, and submission tooling.
- All five pins are `null`, current attestations are absent, Git is clean, and
  the full tests, typecheck, lint, scope verifier, and submit-adapter tests pass
  before generating build-12 input authority.
- No provider mutation is retried after an ambiguous or initiated attempt.
