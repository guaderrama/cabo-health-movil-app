# CaboHealth 3.0 build 10 TestFlight release plan

Binding design:
`docs/superpowers/specs/2026-08-31-cabohealth-build10-testflight-release-design.md`.
The reviewed build-9 release tooling is reused only after its exact candidate,
paths, documentation contracts, and tests are rebaselined to build 10.

## Task 1: Rebaseline and freeze build 10

- Archive the exact build-9 input attestation and add a canonical
  aborted-pre-provider manifest binding source commit, source digest, input
  authority commit/hash, and null provider identities.
- Remove the current build-9 attestation, restore every current pin to `null`,
  and update the sole current candidate from 3.0/build 9 to 3.0/build 10 in app
  config, release guard, evidence tools, verifiers, adapter, release metadata,
  current operational records, and their direct tests.
- Make release-state tests phase-aware. They must validate a contiguous
  pin/file prefix and pass both before and after an exact input pin.
- Keep historical builds 4–8 unchanged and classify build 9 only as
  aborted-pre-provider history.
- Run focused tests, adapter tests, complete `npm test`, typecheck, lint, scope,
  diff checks, exact historical hashes, and independent quality/security
  review. The final clean reviewed commit/digest is the build-10 freeze.

## Task 2: Produce and review the build-input candidate

- Resolve exactly one owned regular non-symlink single-link mode-`0600`
  production plist outside Dropbox, using its path only in child memory.
- Read the live production EAS variable inventory again through the strict
  sanitizer into a new build-10 ignored mode-`0600` evidence directory.
- Produce a canonical value-free candidate bound to the exact build-10 freeze,
  runtime closure, resolved Expo config, inventory bytes, and UTC timestamp.
- Run producer/guard/scope gates and obtain independent approval.

## Task 3: Pin only input authority

- Materialize the approved candidate byte-for-byte at
  `release/app-store/3.0/build-input-attestation.json`.
- Change only `BUILD_INPUT_ATTESTATION_SHA256` to its reviewed SHA-256.
- Require exact staged name-status `A` attestation plus `M` guard and exactly
  one normalized guard-line delta. Commit:

  `chore(release): pin build 10 input attestation`

- Re-resolve the private plist in memory, directly verify authority history,
  and run the complete post-pin producer/guard/scope gates plus independent
  review.

## Task 4: Build exactly once

- Create a fresh verified external mode-`0700` evidence root with mode-`0600`
  children and no pre-existing build action marker.
- Recheck live value-free environment/account/project identity and the absence
  of any build-10 provider operation.
- Set only the verified external evidence root and private plist environment,
  then run exactly `npm run build:prod`.
- Wait for one terminal EAS result. Never automatically retry an initiated or
  ambiguous operation.

## Task 5: Download, audit, and review the IPA

- Bind the terminal EAS build UUID/status/version/build before consuming its
  artifact locator.
- Download exactly one Store IPA to `release/private/rc-build-10/`, audit all
  identity/signing/privacy/Firebase/App-Attest/domain facts, and produce the
  ignored canonical artifact candidate.
- Independently review exact hashes, modes, identity, and evidence privacy.

## Task 6: Pin only artifact authority

- Materialize the approved candidate byte-for-byte at current
  `build-artifact-attestation.json` and change only its pin.
- Require the exact two-path authority commit:

  `chore(release): pin build 10 artifact attestation`

- Reverify linear history, unchanged normalized source digest, exact IPA hash,
  and post-pin gates.

## Task 7: Upload only to internal TestFlight

- Rehash the attested local IPA and run exactly `npm run upload:testflight`.
- Do not use `--groups`, create external testing, invoke Beta App Review,
  select the build for App Store release, or invoke App Review.
- Wait for terminal submission/processing evidence and retain only canonical
  sanitized evidence in the synced workspace.

## Task 8: Verify Apple availability and stop

- Observe App Store Connect read-only for app `6758285327`, bundle
  `com.cabohealth.app`, version `3.0`, build `10`.
- If the exact build is not already in the existing internal group
  `cabo health`, use only the separately reviewed guarded existing-group
  assignment path; never create a group.
- Report the exact TestFlight state and stop before physical-device QA,
  external testing, App Review, or public release.
