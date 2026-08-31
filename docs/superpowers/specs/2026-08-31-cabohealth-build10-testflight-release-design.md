# CaboHealth 3.0 build 10 TestFlight release design

## Goal

Produce one exactly attested CaboHealth 3.0 build 10 containing the reviewed
external-WebView correction, upload that exact IPA only to the existing
internal TestFlight path, and stop before App Review.

## Why build 10

Build 9 source was frozen at
`5e345b76fbc7b6090e882dffad2411961de67557` and its build-input authority was
pinned at `62a24157a66185f3de05350734d48da5cb4e2838`. The mandatory post-pin
suite then exposed three phase-stale tests that described only the pre-pin
state. No guarded build command, EAS build, IPA download, upload, Apple
mutation, or App Review action was started for build 9.

The build-9 design requires a new build number for any tracked correction after
its freeze. Build 9 is therefore immutable aborted-pre-provider history; it is
never repinned or sent to Expo/Apple. Build 10 is the sole current candidate.

## Candidate and history model

- Marketing version remains `3.0`; the sole current build number is `10`.
- Build 8 remains immutable built/uploaded obsolete-source history.
- Build 9 retains its exact reviewed input attestation and authority identity
  under `release/app-store/3.0/history/build-9-aborted/`, bound by a manifest
  that records `providerOperationInitiated:false` and no EAS/IPA/upload IDs.
- Current input, artifact, and RC attestation paths start absent. All five
  phase/tool pins start `null`.
- Current private evidence uses `release/private/rc-build-10/`. Existing
  build-8 private history and ignored build-9 pre-provider evidence remain
  untouched.
- Release-state tests must accept only a contiguous authority prefix:
  pre-input, input, artifact, RC, and submit-tool. They must verify exact
  file/pin hashes and never hard-code only the pre-pin snapshot.

## Immutable authority sequence

The reviewed build-10 rebaseline commit is the frozen application-source
commit. After it, the only permitted tracked authority commits are:

1. add current `build-input-attestation.json` and change only its pin;
2. build exactly once through the guarded production runner;
3. add current `build-artifact-attestation.json` and change only its pin;
4. upload only that exact IPA to internal TestFlight.

Screenshot/RC, external testing, App Review, and public release remain outside
this run. Any other tracked correction after the build-10 freeze requires
build 11.

## Input, build, artifact, and upload boundaries

The build-input attestation binds the frozen source commit/digest, production
Expo/Firebase configuration, one privately held mode-`0600` production plist,
Node `v22.22.3`, EAS CLI `22.2.0`, and a freshly read canonical value-free EAS
environment inventory. Secret values and the plist path are never retained.

The guarded build uses the reviewed private snapshot and exact EAS production
arguments with non-interactive frozen credentials. Raw provider output may
exist only in the verified external mode-`0600` evidence root.

The exact finished build-10 Store IPA is downloaded once, audited for bundle
`com.cabohealth.app`, version `3.0`, build `10`, Team `DQ8PH2DZ3R`,
production App Attest/Firebase, privacy manifests, signing, and
`applinks:cabohealth.org`, then independently attested.

Upload uses only the attested local IPA with:

`submit --platform ios --path IPA --non-interactive --no-auto-testflight-setup`

No group flag, external group, Beta App Review, App Review, or public release
action is allowed.

## Acceptance

- Phase-aware tests pass before and after the input pin.
- Build 9 is hash-bound aborted-pre-provider history.
- The build-10 source commit and normalized digest are independently reviewed.
- Build/input/artifact/upload identities all bind the same 3.0/build 10 source.
- Apple eventually reports the exact uploaded build available to the existing
  internal group, or the run stops with a truthful terminal/blocked state.
