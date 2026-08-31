# CaboHealth 3.0 build 9 TestFlight release design

## Goal

Produce one exactly attested CaboHealth 3.0 build 9 containing the reviewed
external-WebView correction, upload that exact IPA to TestFlight for internal
physical-device testing, and stop before App Review.

## Starting facts

- Build 8 input and artifact authorities are valid only for frozen source
  commit `288ff2185c46fee117555ae0842a4a63c34df938` and source digest
  `a36b34e28d26032ae71e4bc61f767423774faa90873551e0cabbbbfcb310374b`.
- Build 8 EAS build `9f0e9405-9e2a-4900-9f06-558d7c790c67` finished and its
  independently audited IPA has SHA-256
  `419b9e2da17e04161c396f746330907906f7f743c05e313b4ebda09cccc91e4c`.
- Build 8 has no RC attestation. Its input/artifact authority must never be
  edited or reused for changed source.
- The reviewed WebView source ends at
  `bcc57497a760c3085bdda59d14b1e30f6e423d02`; its full branch review found
  zero Critical, Important, or Minor issues and the complete suite passed.
- The current guard correctly rejects that changed source against build-8
  authority before EAS can start.

## Candidate and history model

Build 9 is a deliberate explicit rebaseline, not a generic configurable
release. Independent literal validators remain valuable cross-checks.

1. Move the current build-8 input and artifact attestations byte-for-byte to
   `release/app-store/3.0/history/build-8/` and add a hash-bound historical
   manifest. Keep `release/private/rc-build-8/` untouched.
2. Change the sole current candidate to marketing version `3.0`, build `9`,
   and private evidence root `release/private/rc-build-9/`.
3. Current build-9 input, artifact, and RC paths start absent; all five
   phase/tool pins start `null`.
4. Builds 4 through 8 are obsolete-source history for this candidate. Historical
   statements and compatibility claims are not globally rewritten.
5. Current release documents must stop describing build 8 as unbuilt. Its
   historical manifest binds the existing sanitized build, IPA, EAS submission,
   App Store Connect processing, and internal-group observations without making
   a new provider query. Dated observations remain dated history.
6. The spec, plan, rebaseline tools, and every plan-review correction are
   tracked before the final baseline commit. A clean `git status` and canonical
   digest are mandatory before the source is declared frozen.

## Immutable authority sequence

The final rebaseline commit is the frozen build-9 application-source commit.
After it, history is linear and only these commits are valid:

1. **Input authority:** add only current
   `build-input-attestation.json` and change only the one input-pin line.
2. Run the guarded production build from that state.
3. **Artifact authority:** after private download/audit, add only current
   `build-artifact-attestation.json` and change only the artifact-pin line.
4. Upload only that attested IPA to TestFlight.
5. Future screenshot, RC, and submit-tool phases remain closed. App Review is
   outside this plan.

Any other tracked change after the frozen source commit invalidates build 9.
A later code fix requires build 10 rather than repinning build 9.

## Build-input boundary

The input attestation must bind the exact frozen source commit/digest,
`app.json`, runtime config, lockfile, release/verifier bytes, production Firebase
plist hash and resolved Expo config, Node `v22.22.3` executable, EAS CLI
`22.2.0` runtime closure, and the reviewed value-free production environment
inventory. Secret values, the private plist path, and raw provider output are
never committed or retained in ordinary logs.

A tracked, tested sanitizer consumes the live EAS environment response directly
and emits a canonical value-free inventory. The input attestation adds the
SHA-256 of those exact sanitized bytes. The producer rejects an absent,
malformed, extra-variable, value-bearing, or differently ordered inventory.

The guarded build uses existing credentials with `--freeze-credentials` and
`--non-interactive`. It may not create, rotate, or mutate signing credentials.

## Artifact and upload boundary

Download the exact finished build-9 Store IPA once into a new current-user
owned mode-`0700` private directory, with mode-`0600` files. Verify exact EAS
identity and status before consuming any artifact locator. Audit signature,
entitlements, privacy, embedded Firebase identity, certificate, provisioning,
bundle, version/build, App Attest, and associated domain before materializing
the artifact-attestation candidate.

Before the freeze, tracked and tested tools are added for the complete later
chain: environment sanitization, EAS build-result validation plus exclusive IPA
download, canonical artifact-attestation production, and EAS submission-status
sanitization. Each has a fixed schema, bounded input, explicit candidate
identity, path/mode checks, and outputs consumed by the next phase.

The fixed chain is executable without ad-hoc code:

`env:list --format long` → bounded value-free environment sanitizer → hashed
input candidate → input pin → guarded attempt runner/guard → `build:view --json`
→ bounded identity-validating downloader → IPA audit → canonical artifact
producer → artifact pin → guarded upload → `submit:view --json` → bounded
submission sanitizer → read-only Apple observation.

Durable attempt markers and raw logs live only in an owned mode-`0700` external
evidence root. The runner and guard atomically record whether provider launch
was reached, so temporary-operation cleanup cannot erase retry state.

The upload guard rehashes the exact attested IPA immediately before copying it
to a unique private operation directory outside Dropbox, submits it to
TestFlight, and removes only that operation directory afterward. It must not
run the App Review adapter, create external-testing groups, or click Submit for
Review. Its EAS argument vector is exactly
`submit --platform ios --path IPA --non-interactive --no-auto-testflight-setup`;
`--groups` is prohibited, so EAS cannot create or assign a default TestFlight
group.

Every build/upload attempt follows one retry state machine:

- proven failure before the provider starts: correct locally, independently
  review, then permit one explicitly recorded rerun;
- provider started or state unknown: no retry until a read-only reconciliation
  finds the exact operation;
- terminal provider failure: a new explicit release decision is required;
- success: never repeat.

The durable runner exposes only exact `start`, one reviewed `retry`,
stale-`armed` recovery, and read-only `reconcile` grammars. Stale-`armed`
recovery requires the recorded runner PID to be absent and relies on the
fsynced-before-provider ordering to prove no provider call began. It converts
only to a reviewed pre-provider retry state. Action-specific mode-`0600` markers and raw
logs live under the verified external evidence root. A marker records the
fixed build-9 candidate, attempt 1 or 2, provider-start boundary, parsed UUID,
terminal timestamps/outcome, separate length-delimited stdout/stderr and
canonical reconciliation-evidence digests, and the independent review hash for
the sole retry. The guard fsyncs
`armed → provider_started` immediately before EAS. A crash in either
`provider_started` or `unknown` can be reconciled only from canonical,
hash-matched, sanitized `build:view --json` or `submit:view --json` evidence;
reconciliation never calls the provider. Missing/ambiguous IDs and invalid
transitions fail closed.

Snapshot tools set and verify their final modes explicitly so caller `umask`
cannot make a valid operation fail or weaken a private file.

## Evidence and privacy

- Raw EAS/provider output, signed artifact locators, credentials, private paths,
  and Apple secrets never enter Git, SDD, console, or ordinary/synced logs;
  they may exist only outside Dropbox in the verified mode-`0700` evidence root
  as owned mode-`0600` evidence.
- SDD retains only allowlisted sanitized identities, statuses, timestamps,
  hashes, booleans, and operation results.
- Temporary directories are uniquely created, validated before cleanup, and
  never removed broadly.
- App Store Connect processing may be reported only from a fresh read-only
  observation of the exact build 9.
- If the exact build is not automatically available to the existing internal
  group `cabo health`, a fresh read-only observation must first prove the exact
  app/build, exact unique group, and non-assignment. That observation has its
  own guarded GET-only command and canonical hash-bound evidence; assignment
  is unreachable when it reports availability. A separate guarded,
  idempotent App Store Connect adapter may then add only the build/group
  relationship and must verify it read-only afterward. This never uses EAS
  automatic TestFlight setup, never passes group flags, and cannot reach group
  creation/editing, testers, external testing, Beta App Review, or App Review.
  Missing API credentials/role, ambiguity, pagination, or an unresolved
  mutation outcome is a safe blocker.

## Acceptance

- Rebaseline tests fail before implementation and pass after it.
- Build 7 and build 8 history files retain exact hashes; current build 9 starts
  without authority and cannot accept any build-8 pin or artifact.
- Typecheck, lint, complete tests, scope gates, submit-adapter tests, and
  independent reviews pass at the frozen source commit.
- The input authority, EAS build, IPA audit, artifact authority, and TestFlight
  upload each have separately reviewed evidence.
- The exact build 9 becomes available for internal TestFlight testing.
- No App Review submission occurs.
