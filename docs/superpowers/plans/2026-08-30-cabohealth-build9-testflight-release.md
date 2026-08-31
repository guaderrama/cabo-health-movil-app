# CaboHealth 3.0 build 9 TestFlight release plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` and execute one reviewed task at a
> time. External build/upload stages require exact prior authority; never skip
> or weaken the release guard.

**Goal:** Rebaseline the reviewed WebView fix as CaboHealth 3.0 build 9,
produce and audit one exact signed IPA, and upload that IPA to internal
TestFlight without submitting it to App Review.

**Spec:**
`docs/superpowers/specs/2026-08-30-cabohealth-build9-testflight-release-design.md`

**Starting source:**
`bcc57497a760c3085bdda59d14b1e30f6e423d02`

## Global constraints

- Preserve build-7 and build-8 authority/history byte-for-byte and never reuse
  their pins, source digest, IPA, private evidence, or provider IDs as build-9
  authority.
- Use an explicit build-9 rebaseline; do not replace independent validators
  with a single derived candidate source.
- The rebaseline commit is the last ordinary tracked change. Later input and
  artifact authority commits have exact two-path allowlists and one pin-line
  change each.
- Keep Node `v22.22.3`, EAS CLI `22.2.0`, `appVersionSource: local`, production
  environment inventory, bundle/App/Team identity, Firebase production
  identity, signing freeze, and all WebView security/privacy boundaries.
- Never place private plist bytes/path, secret provider-environment values, credentials, signed
  artifact locators, certificate/profile IDs, or raw Apple/EAS output in Git,
  Dropbox, SDD, the console, or ordinary/synced logs. Raw child output may be
  captured only in the verified external mode-`0700` evidence root as the
  exact owned mode-`0600` files specified below.
- Do not run `npm run submit`, do not start external TestFlight review, and do
  not click **Submit for Review**.
- Strict RED-GREEN TDD, clean-state verification, independent review, and
  sanitized evidence are required at every stage.
- A provider action uses this state machine: a proven pre-provider failure may
  receive one reviewed, explicitly recorded rerun; an initiated or unknown
  provider state blocks retry until read-only reconciliation; a terminal
  provider failure needs a new decision; success is never repeated.
- Freeze `easArgumentsForAction('upload-testflight')` to exactly
  `submit --platform ios --path IPA --non-interactive --no-auto-testflight-setup`.
  `--groups` is prohibited. Existing-group assignment, if needed, is a
  separate guarded action after a fresh read-only App Store Connect
  observation.

---

### Task 1: Rebaseline all current release contracts to build 9

**Files:**
- Track: this build-9 spec and plan, including all review corrections
- Modify: `app.json`, `constants/config.ts`
- Modify: current candidate constants/paths in release, evidence, audit,
  metadata, and submit-adapter code
- Create: tracked/tested release tools for sanitized EAS environment evidence,
  validated exclusive IPA download, canonical artifact-attestation production,
  sanitized EAS submission evidence, and exact existing-internal-TestFlight
  group observation/assignment
- Modify: directly covering release, metadata, audit, legal, scope, and adapter
  tests
- Modify: current release manifests/checklists/runbooks that describe the sole
  pending candidate
- Move: current build-8 input/artifact attestations to
  `release/app-store/3.0/history/build-8/`
- Create: `release/app-store/3.0/history/build-8/manifest.json`

- [ ] **Step 1: Record immutable build-8 hashes and write RED tests**

Capture the current input/artifact bytes and hashes. Add tests that require:
build 9 across every independent current-candidate validator; exact build-8
history hashes and manifest linkage; absent current attestations; five null
pins; `rc-build-9` private paths; build-8 authority rejected for build 9; and
phase-aware current-state language that does not claim build 8 is unbuilt.
Add RED contracts for each new release-evidence tool, the environment-inventory
digest in the build-input schema, explicit snapshot modes independent of
caller `umask`, and the retry state machine.

Run:

```bash
node --test tests/release-v3.test.mjs tests/app-store-metadata.test.mjs tests/apple-post-build-evidence.test.mjs tests/build-input-attestation-producer.test.mjs tests/release-command-guard.test.mjs tests/ios-ipa-audit.test.mjs tests/scope-gate-routing.test.mjs tests/legal-content.test.mjs
npm --prefix tools/app-store-submit-adapter test
```

Expected: RED because production authority still targets build 8.

- [ ] **Step 2: Archive build 8 and establish truthful build-9 pre-authority**

Move both tracked build-8 attestations without byte changes; add a historical
manifest binding their exact hashes, frozen source/digest, EAS build/IPA, and
`associationGuardProven:false`, plus the already sanitized EAS submission
`c06b252d-422b-4271-9473-29683b5fe9b5`, observed Apple upload `Complete`,
processing `Ready to Submit`, and existing internal-group availability, with RC
`never-created`. Link only the existing sanitized SDD evidence; do not make a
new Apple/provider observation. Leave ignored
`release/private/rc-build-8/` untouched. Set build 9 in app/config, guard,
producer, post-build evidence, IPA instructions, verifiers, adapter, fixtures,
and current release documents. Set current phase/tool pins to null and ensure
current input/artifact/RC paths are absent.

Do not globally replace historical `8` references. Preserve the build-8 plan,
source-readiness record, historical compatibility statements, and dated Apple
observations as history.

The required current-document review allowlist is:

- `release/app-store/3.0/release-manifest.json`
- `release/app-store/3.0/{en-US.md,es-MX.md,review-notes.md}`
- `release/app-store/3.0/{testflight-what-to-test.md,submission-gates.md}`
- `release/app-store/3.0/screenshots-manifest.json`
- `release/app-store/3.0/screenshots/storyboard.md`
- `release/app-store/3.0/apple-review-remediation-2026-08-24.md`
- `release/app-store/3.0/{age-rating.md,app-privacy.md,accessibility-nutrition-label-evidence.md}`
- `release/app-store/3.0/content-rights-inventory.md`
- `release/{data-inventory.md,compliance-facts.json}`
- `docs/operations/{apple-post-build-evidence.md,exact-ios-ipa-audit.md,prior-apple-review-resolution.md,native-firebase-runtime.md}`
- `docs/operations/{dynamic-miniapp-catalog.md,dynamic-miniapp-production-activation-2026-08-25.md}`
- `docs/operations/{protected-overlay-dynamic-activation-2026-08-26.md,vip-showcase-production-activation-2026-08-26.md}`
- `tools/app-store-submit-adapter/{README.md,package.json}`

For every build-8 reference in that allowlist, tests classify it as immutable
history or reject it as stale current/future authority.

Before the freeze, add these tracked tools and direct tests:

- `scripts/release-eas-environment-sanitizer.mjs` → canonical
  `cabohealth-eas-environment-inventory` JSON, fixed keys, exact production
  variable names/roles, `valuesIncluded:false`, no IDs or values.
- `scripts/release-eas-build-status-sanitizer.mjs` → canonical read-only
  build-status JSON used only to reconcile an interrupted provider attempt.
- `scripts/release-eas-artifact-downloader.mjs` → one mode-`0600` IPA plus a
  canonical `cabohealth-eas-artifact-association` JSON; validates exact build
  UUID/status/account/project/platform/profile/bundle/version/build before
  consuming an in-memory locator, enforces a 1 GiB bound, ZIP magic, fsync, and
  final-descriptor hash.
- `scripts/create-build-artifact-attestation.mjs` → canonical 14-key
  `cabohealth-ios-build-artifact-attestation` JSON from the approved association
  summary and six private audited files.
- `scripts/release-eas-submission-sanitizer.mjs` → canonical
  `cabohealth-eas-submission-read-only-status` JSON with only allowlisted
  submission/build identities, statuses, timestamps, error code, and omission
  booleans.
- `tools/app-store-submit-adapter/{src/internal-testflight.mjs,src/internal-group-arguments.mjs,src/secure-output.mjs,bin/observe-internal-group.mjs,bin/observe-internal-group-dry-run.mjs,bin/assign-internal-group.mjs,bin/assign-internal-group-dry-run.mjs}`
  → a separate fail-closed internal-TestFlight observer/assignment path that
  cannot import or reach the App Review submission flow.

Their executable interfaces are fixed before the freeze:

```bash
node node_modules/eas-cli/bin/run env:list production --scope project --format long \
  | node scripts/release-eas-environment-sanitizer.mjs \
      --environment production --eas-config eas.json \
      --output /ABS/WORKTREE/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-2-evidence/eas-environment.json
```

The environment sanitizer reads at most 1 MiB UTF-8 from stdin and rejects any
value-bearing output, duplicate/extra name, unsupported format, or config
drift. EAS CLI 22.2.0 has no JSON flag for `env:list`; the parser targets its
`--format long` output and fixtures cover the exact supported variants. It
joins tracked `APP_ENV` from `eas.json`. It exclusively creates the output as
one canonical mode-`0600` JSON line under a precreated owned/non-symlink
mode-`0700` `task-2-evidence` directory; it rejects any existing output or
different parent mode. Exact key order is
`schemaVersion,evidenceKind,environmentName,profileVariables,projectVariables,extras,valuesIncluded,providerValuesRetained`.
Failure emits only `EAS_ENVIRONMENT_SANITIZATION_FAILED`.

```bash
node node_modules/eas-cli/bin/run build:view BUILD_UUID --json \
  | node scripts/release-eas-artifact-downloader.mjs \
      --build-id BUILD_UUID \
      --output /ABS/PRIVATE/rc-build-9/CaboHealth-3.0-build-9.ipa \
      --association-output /ABS/WORKTREE/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-5-evidence/eas-artifact-association.json
```

The downloader reads at most 4 MiB JSON from stdin. The final IPA and
association file are exclusive no-follow, owned, single-link mode-`0600`; their
parents are owned realpath mode-`0700`. The canonical association key order is
`schemaVersion,evidenceKind,candidate,easBuildId,account,projectSlug,platform,distribution,buildProfile,buildStatus,artifactAvailable,downloadedIpaByteCount,downloadedIpaSha256,associationGuardProven,providerUrlsOmitted,credentialFieldsOmitted,reviewedAt`.
It validates exact candidate identity before consuming an in-memory HTTPS
locator, caps download at 1 GiB, requires ZIP magic, fsyncs, and hashes the
final descriptor. Failure emits only `EAS_ARTIFACT_DOWNLOAD_FAILED`.

```bash
node scripts/create-build-artifact-attestation.mjs \
  --reviewed-at ISO_UTC \
  --build-input-attestation-sha256 INPUT_SHA256 \
  --source-tree-sha256 SOURCE_SHA256 \
  --association /ABS/WORKTREE/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-5-evidence/eas-artifact-association.json \
  --evidence-dir /ABS/PRIVATE/rc-build-9 \
  --output /ABS/WORKTREE/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-5-evidence/build-artifact-candidate.json
```

The producer accepts only that exact 12-argument grammar, canonical association
schema, and the six exact mode-`0600` private audit files. It writes one
canonical 14-key attestation line to a new exclusive mode-`0600` output under
the owned mode-`0700` `task-5-evidence` parent.

```bash
node node_modules/eas-cli/bin/run submit:view SUBMISSION_UUID --json \
  | node scripts/release-eas-submission-sanitizer.mjs \
      --submission-id SUBMISSION_UUID --eas-build-id BUILD_UUID \
      --purpose task-evidence \
      --output /ABS/WORKTREE/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-7-evidence/eas-submission-status.json
```

The submission sanitizer accepts exactly that ordered eight-value option
grammar. `--purpose` is exactly `task-evidence|attempt-reconciliation`.
`task-evidence` requires the exact owned/non-symlink mode-`0700`
`task-7-evidence` parent shown above. `attempt-reconciliation` requires
`CABOHEALTH_RELEASE_EVIDENCE_ROOT` and the exact output
`$CABOHEALTH_RELEASE_EVIDENCE_ROOT/upload-testflight-reconciliation.json` under
that already verified external mode-`0700` root. Both purposes read at most
4 MiB JSON and exclusively create one canonical mode-`0600` line. Exact key order is
`schemaVersion,evidenceKind,submissionId,status,terminal,platform,createdAt,completedAt,errorPresent,errorCode,app,appleProcessingStatus,appleProcessingPendingReadOnlyVerification,appStoreConnectBuildSelectionPerformed,mutationPerformed,rawProviderResponseRetained,providerUrlsOmitted,providerFieldsOmitted,credentialFieldsOmitted`.
Nested `app` order is
`appleId,account,projectSlug,submittedBuildIdentityAvailable,bundleIdentifier,marketingVersion,buildNumber,easBuildId`.
Failure emits only `SUBMISSION_STATUS_SANITIZATION_FAILED`.

Update `scripts/create-build-input-attestation.mjs` and the release guard so
the input schema includes `easEnvironmentInventorySha256`, computed from and
validated against the exact sanitizer output. Update the CLI to accept that
sanitized inventory explicitly. The later guard verifies the digest field and
the embedded value-free inventory but never needs the ignored file.

Freeze the input producer interface as:

```bash
node scripts/create-build-input-attestation.mjs \
  --reviewed-at ISO_UTC \
  --source-commit FORTY_HEX_COMMIT \
  --eas-environment-inventory /ABS/WORKTREE/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-2-evidence/eas-environment.json \
  --output /ABS/WORKTREE/.superpowers/sdd/2026-08-30-cabohealth-build9-testflight-release/task-2-evidence/build-input-candidate.json
```

It accepts exactly those eight argument values in that order, requires both
input/output parents to be owned/non-symlink realpath mode `0700`, reads a
canonical mode-`0600` inventory, and exclusively creates the candidate
mode `0600`. Expanded exact attestation key order is
`schemaVersion,artifactKind,candidate,sourceCommit,sourceTreeSha256,appJsonSha256,configSha256,packageLockSha256,releaseManifestSha256,releaseVerifierSha256,metadataVerifierSha256,firebaseProjectId,googleServicesPlistSha256,resolvedProductionExpoConfigSha256,nodeRuntime,easCli,easEnvironmentInventorySha256,easEnvironment,reviewedAt`.
The finite public errors are
`BUILD_INPUT_PRODUCER_ARGUMENT_INVALID`,
`BUILD_INPUT_PRODUCER_FILE_INVALID`,
`BUILD_INPUT_ENVIRONMENT_INVENTORY_INVALID`,
`BUILD_INPUT_PRODUCER_OUTPUT_INVALID`, and
`BUILD_INPUT_PRODUCER_INTERNAL_ERROR`.

The artifact producer requires exactly these six filenames under
`--evidence-dir`: `CaboHealth-3.0-build-9.ipa`,
`signed-entitlements.plist`, `privacy-report.json`,
`embedded-GoogleService-Info.plist`, `signing-certificate.der`, and
`embedded.mobileprovision`. Its finite public errors are
`BUILD_ARTIFACT_PRODUCER_ARGUMENT_INVALID`,
`BUILD_ARTIFACT_PRODUCER_ASSOCIATION_INVALID`,
`BUILD_ARTIFACT_PRODUCER_FILE_INVALID`,
`BUILD_ARTIFACT_PRODUCER_OUTPUT_INVALID`, and
`BUILD_ARTIFACT_PRODUCER_INTERNAL_ERROR`.

Fix private snapshot creation so directory/file modes are explicitly set and
verified independently of caller `umask`; add tests under restrictive and
ordinary umasks. Add tested run-state markers sufficient to distinguish
pre-provider block, provider-started/unknown, terminal failure, and success.

Add `scripts/release-attempt-runner.mjs` and direct state-machine tests; route
`build:prod` and `upload:testflight` through it. The package scripts invoke
exactly:

```bash
node scripts/release-attempt-runner.mjs start build
node scripts/release-attempt-runner.mjs start upload-testflight
```

The only additional accepted command grammars are:

```bash
node scripts/release-attempt-runner.mjs retry build --review-sha256 REVIEW_SHA256
node scripts/release-attempt-runner.mjs retry upload-testflight --review-sha256 REVIEW_SHA256
node scripts/release-attempt-runner.mjs recover-armed build --expected-runner-pid PID
node scripts/release-attempt-runner.mjs recover-armed upload-testflight --expected-runner-pid PID
node scripts/release-attempt-runner.mjs reconcile build --provider-operation-id UUID --terminal-status STATUS --evidence /ABS/SANITIZED.json --evidence-sha256 EVIDENCE_SHA256
node scripts/release-attempt-runner.mjs reconcile upload-testflight --provider-operation-id UUID --terminal-status STATUS --evidence /ABS/SANITIZED.json --evidence-sha256 EVIDENCE_SHA256
```

No other argument count, order, flag, action, or status is accepted. `STATUS`
is exactly one of `FINISHED`, `ERRORED`, or `CANCELED`; both hashes are
lowercase 64-hex and provider operation IDs are canonical UUIDs.

The runner requires
`CABOHEALTH_RELEASE_EVIDENCE_ROOT` to be an absolute owned non-symlink realpath
outside Dropbox, mode `0700`. It writes only action-specific mode-`0600` markers
and raw stdout/stderr there; SDD receives only sanitized results. The marker
filenames are exactly `build-attempt.json` and
`upload-testflight-attempt.json`; raw logs are exactly
`<action>-attempt-<1|2>.stdout.log` and
`<action>-attempt-<1|2>.stderr.log`. All are exclusive, owned,
non-symlink, single-link, mode `0600` files in that verified root. Marker exact
key order is
`schemaVersion,action,candidate,attemptNumber,runnerPid,state,providerOperationId,startedAt,terminalAt,outcome,rawEvidenceSha256,reconciliationEvidenceSha256,retryReviewSha256`.
Allowed states are `armed`, `provider_started`, `preprovider_failed`, `unknown`,
`terminal_failure`, and `terminal_success`. `schemaVersion` is integer `1`;
`action` is `build|upload-testflight`; `candidate` has exact nested key order
`bundleIdentifier,marketingVersion,buildNumber,sourceCommit` and values
`com.cabohealth.app`, `3.0`, `9`, and the forty-hex frozen Task-1 commit;
`attemptNumber` is integer `1|2`; `runnerPid` is the positive safe integer PID
that exclusively created that attempt; `providerOperationId` is UUID or null;
`startedAt` is canonical UTC ISO-8601; `terminalAt` is canonical UTC ISO-8601
or null; `outcome` is exactly
`pending|preprovider-blocked|unknown|failed|succeeded`; and each digest is
lowercase 64-hex or null. State/outcome pairs are fixed:
`armed|provider_started → pending`,
`preprovider_failed → preprovider-blocked`, `unknown → unknown`,
`terminal_failure → failed`, and `terminal_success → succeeded`.
`terminalAt` is non-null only for `preprovider_failed`, `terminal_failure`, and
`terminal_success`. `rawEvidenceSha256` is null while `armed` or
`provider_started`, and is the length-delimited raw-log digest after the runner
observes child completion; a crash may therefore leave it null.
`reconciliationEvidenceSha256` is null until a successful `reconcile` and then
equals the supplied canonical sanitized-evidence digest.
`retryReviewSha256` is non-null only for attempt 2.

`start` requires no marker and exclusively creates attempt 1 in `armed`.
`retry` requires exact attempt 1 `preprovider_failed`, a review hash, and no
attempt-2 logs; it atomically creates attempt 2 `armed`. There is never a third
attempt. Marker creation precedes log creation; recovery treats either missing
log as an empty byte sequence and exclusively creates the missing mode-`0600`
file before finalizing its digest.

`recover-armed` is the sole stale-armed recovery. It requires the exact marker
to remain `armed`, `providerOperationId:null`, the supplied positive PID to
equal `runnerPid`, and `process.kill(runnerPid, 0)` to fail specifically with
`ESRCH`. A live PID, `EPERM`, an unexpected OS error, malformed/multiple-linked
file, or any later state fails closed. Because the guard's fsynced
`provider_started` transition is ordered before provider spawn, a surviving
`armed` marker proves no provider action began. Recovery calls neither guard
nor provider; it hashes the existing-or-empty logs and atomically moves only to
`preprovider_failed`, after which the ordinary one-review-hash retry rule
applies. Direct tests cover crashes immediately after marker creation, after
log creation, and refusal while the PID is live or indeterminate.

The runner passes the exact marker path only through
`CABOHEALTH_RELEASE_ATTEMPT_STATE`. After completing all local guard checks,
the guard atomically replaces/fsyncs `armed → provider_started` immediately
before spawning EAS. The action arguments are frozen and tested exactly:

- build: `build --platform ios --profile production --non-interactive --freeze-credentials`
- upload: `submit --platform ios --path IPA --non-interactive --no-auto-testflight-setup`

`--groups` and all auto-TestFlight-setup enabling forms are rejected. The
runner captures raw child stdout/stderr only into the external evidence files.
It extracts provider IDs from the action-specific exact URL suffixes
`/builds/<UUID>` and `/submissions/<UUID>` across both streams and accepts
exactly one unique matching UUID. The evidence digest is SHA-256 over
`uint64be(stdoutByteLength) || stdoutBytes || uint64be(stderrByteLength) || stderrBytes`.

On guard nonzero while the marker remains `armed`, the runner atomically moves
to `preprovider_failed`; on guard nonzero after `provider_started`, it moves to
`unknown` and retains the unique parsed provider UUID when available. Guard
exit zero plus exactly one action-matching UUID moves to `terminal_success`;
exit zero with a missing or ambiguous UUID moves to `unknown`. The raw-evidence
digest is recorded in `rawEvidenceSha256` for every child completion observed
by the runner. Success and terminal failure never retry.

Crash recovery is read-only. `reconcile` accepts either `provider_started` or
`unknown`; it never calls a provider. It requires an exact exclusive owned
single-link mode-`0600` sanitized evidence file below the verified evidence
root, matching the supplied SHA-256, action/candidate, provider UUID, and
terminal status. `FINISHED` moves to `terminal_success`; `ERRORED` or
`CANCELED` moves to `terminal_failure`; the supplied digest is written only to
`reconciliationEvidenceSha256` and any prior raw digest is preserved. Build
evidence must be canonical
`cabohealth-eas-build-read-only-status`; upload evidence must be canonical
`cabohealth-eas-submission-read-only-status`.

The build reconciliation producer is invoked only as:

```bash
node node_modules/eas-cli/bin/run build:view BUILD_UUID --json \
  | node scripts/release-eas-build-status-sanitizer.mjs \
      --build-id BUILD_UUID \
      --output /ABS/EVIDENCE_ROOT/build-reconciliation.json
```

It reads at most 4 MiB JSON, validates the exact build-9 identity, and
exclusively creates a mode-`0600` file. Exact top-level key order is
`schemaVersion,evidenceKind,easBuildId,status,terminal,platform,distribution,account,projectSlug,buildProfile,bundleIdentifier,marketingVersion,buildNumber,artifactAvailable,createdAt,completedAt,errorPresent,errorCode,mutationPerformed,rawProviderResponseRetained,providerUrlsOmitted,providerFieldsOmitted,credentialFieldsOmitted`.
Its only public failure is `BUILD_STATUS_SANITIZATION_FAILED`. Upload
reconciliation invokes only:

```bash
node node_modules/eas-cli/bin/run submit:view SUBMISSION_UUID --json \
  | node scripts/release-eas-submission-sanitizer.mjs \
      --submission-id SUBMISSION_UUID --eas-build-id BUILD_UUID \
      --purpose attempt-reconciliation \
      --output /ABS/EVIDENCE_ROOT/upload-testflight-reconciliation.json
```

The sanitizer verifies that `/ABS/EVIDENCE_ROOT` is the exact
`CABOHEALTH_RELEASE_EVIDENCE_ROOT`; no SDD-path exception applies to this
purpose.

The runner finite public errors are
`RELEASE_ATTEMPT_ARGUMENT_INVALID`,
`RELEASE_ATTEMPT_EVIDENCE_ROOT_INVALID`,
`RELEASE_ATTEMPT_MARKER_INVALID`,
`RELEASE_ATTEMPT_STATE_INVALID`,
`RELEASE_ATTEMPT_ARMED_RECOVERY_INVALID`,
`RELEASE_ATTEMPT_RETRY_NOT_AUTHORIZED`,
`RELEASE_ATTEMPT_RECONCILIATION_INVALID`,
`RELEASE_ATTEMPT_GUARD_FAILED`, and
`RELEASE_ATTEMPT_INTERNAL_ERROR`. Direct RED/GREEN tests cover exact CLI
grammar, all field types/nullability, start/retry limits, guard handoff,
provider-ID parsing, evidence hashing, crash recovery from `armed`,
`provider_started`, and `unknown`, terminal transitions, exact EAS argument
arrays, absence of `--groups`, and every stable failure code. Every invalid
transition fails before guard/provider invocation.

Freeze the conditional existing-group path before the source freeze. It is a
two-stage adapter, not EAS setup and not the App Review adapter. The first
stage is guaranteed read-only. The release guard exposes
`observe-testflight-internal`, and `npm run observe:testflight:internal`
invokes that action. Its guarded child accepts exactly these twelve ordered
pairs:

```bash
node tools/app-store-submit-adapter/bin/observe-internal-group.mjs \
  --operation observe-existing-internal-testflight-access \
  --apple-id 6758285327 \
  --bundle-identifier com.cabohealth.app \
  --marketing-version 3.0 \
  --build-number 9 \
  --group-name "cabo health" \
  --source-commit FORTY_HEX_FROZEN_COMMIT \
  --build-input-attestation /ABS/PRIVATE_SNAPSHOT/build-input-attestation.json \
  --build-input-attestation-sha256 INPUT_SHA256 \
  --build-artifact-attestation /ABS/PRIVATE_SNAPSHOT/build-artifact-attestation.json \
  --build-artifact-attestation-sha256 ARTIFACT_SHA256 \
  --output /ABS/EVIDENCE_ROOT/internal-testflight-group-observation.json
```

The observer permits only the five ordered GET groups below and cannot issue
POST/PATCH/DELETE. Its canonical output key order is
`schemaVersion,evidenceKind,candidate,sourceCommit,sourceTreeSha256,buildInputAttestationSha256,buildArtifactAttestationSha256,easBuildId,appStoreConnectBuildResourceId,buildProcessingState,buildExpired,buildAudienceType,buildUploadedAt,betaGroupResourceId,betaGroupName,betaGroupInternal,betaGroupHasAccessToAllBuilds,observedAt,available,availabilityReason,mutationPerformed,rawProviderResponseRetained,providerUrlsOmitted,credentialFieldsOmitted`.
`schemaVersion` is integer 1, `evidenceKind` is exactly
`cabohealth-app-store-connect-internal-group-observation`, and nested
`candidate` key order/value is
`appleId,bundleIdentifier,marketingVersion,buildNumber` =
`6758285327,com.cabohealth.app,3.0,9`. Timestamps are canonical UTC ISO-8601.
`availabilityReason` is exactly
`all-builds|explicit-relationship|not-assigned`; `mutationPerformed` and
`rawProviderResponseRetained` are false, while `providerUrlsOmitted` and
`credentialFieldsOmitted` are true.

The second release-guard action is `assign-testflight-internal`, and
`npm run assign:testflight:internal` invokes it only when the exact reviewed
observation has `available:false` and `availabilityReason:not-assigned`. The
guard requires the observation to be canonical, exact-candidate/hash-bound,
mode `0600`, no older than 15 minutes, and the sole file at its fixed path. The
assignment child accepts exactly these fourteen ordered pairs:

```bash
node tools/app-store-submit-adapter/bin/assign-internal-group.mjs \
  --operation ensure-existing-internal-testflight-access \
  --apple-id 6758285327 \
  --bundle-identifier com.cabohealth.app \
  --marketing-version 3.0 \
  --build-number 9 \
  --group-name "cabo health" \
  --source-commit FORTY_HEX_FROZEN_COMMIT \
  --build-input-attestation /ABS/PRIVATE_SNAPSHOT/build-input-attestation.json \
  --build-input-attestation-sha256 INPUT_SHA256 \
  --build-artifact-attestation /ABS/PRIVATE_SNAPSHOT/build-artifact-attestation.json \
  --build-artifact-attestation-sha256 ARTIFACT_SHA256 \
  --observation /ABS/EVIDENCE_ROOT/internal-testflight-group-observation.json \
  --observation-sha256 OBSERVATION_SHA256 \
  --output /ABS/EVIDENCE_ROOT/internal-testflight-group-assignment.json
```

For both actions the guard creates the two attestation snapshots as owned
regular non-symlink single-link mode-`0600` files, verifies their exact
pins/candidate/source, and deletes only that unique snapshot afterward. Neither
adapter accepts credentials on the CLI. They use only the existing
`APP_STORE_CONNECT_KEY_KIND`, `APP_STORE_CONNECT_KEY_ID`, optional team-only
`APP_STORE_CONNECT_ISSUER_ID`, and absolute external mode-`0600`
`APP_STORE_CONNECT_PRIVATE_KEY_PATH` contract. Missing credentials, API access,
or sufficient Apple role is a safe blocker before mutation.

Both stages share this exact read-only request order:

1. `GET /v1/apps/6758285327?fields%5Bapps%5D=bundleId`.
2. `GET /v1/builds?filter%5Bapp%5D=6758285327&filter%5Bversion%5D=9&filter%5BpreReleaseVersion.version%5D=3.0&filter%5BpreReleaseVersion.platform%5D=IOS&fields%5Bbuilds%5D=version%2CuploadedDate%2CprocessingState%2Cexpired%2CbuildAudienceType&limit=200`.
3. For the unique build, `GET /v1/builds/<BUILD_ID>/preReleaseVersion?fields%5BpreReleaseVersions%5D=version%2Cplatform`
   and `GET /v1/builds/<BUILD_ID>/app?fields%5Bapps%5D=bundleId`.
4. `GET /v1/apps/6758285327/betaGroups?fields%5BbetaGroups%5D=name%2CisInternalGroup%2ChasAccessToAllBuilds&limit=200`.
5. For the unique exact-name internal group,
   `GET /v1/betaGroups/<GROUP_ID>/app?fields%5Bapps%5D=bundleId` and
   `GET /v1/betaGroups/<GROUP_ID>/relationships/builds?limit=200`.

Every collection fails closed on pagination, count mismatch, or ambiguity.
The build must be exact `9`, `3.0/IOS`, `VALID`, unexpired,
`APP_STORE_ELIGIBLE`, and belong to the exact app. The group name comparison is
byte-exact, `isInternalGroup` must be true, and its app must be exact. If
`hasAccessToAllBuilds:true` or the exact build relationship already exists,
the observer emits `available:true`; Task 7 does not invoke assignment. The
assignment adapter also rechecks and emits success with zero mutation if the
state changed after observation.

Otherwise assignment repeats the direct
build/prerelease/app/group/group-app/builds reads immediately before the sole
permitted mutation:

```text
POST /v1/betaGroups/<GROUP_ID>/relationships/builds
{"data":[{"type":"builds","id":"<BUILD_ID>"}]}
```

No request may target `/betaTesters`, `POST /v1/betaGroups`, external testing,
Beta App Review, `appStoreVersions`, or `reviewSubmissions`. The transport gains
an explicit `responseKind:"json"|"empty"`; only this relationship POST uses
`empty` and requires HTTP 204, absent-or-zero content length, no content type
requirement, and exactly zero body bytes. Existing JSON behavior is unchanged.

After the POST, assignment makes at most three injected-delay read-only
relationship reads and succeeds only when the exact build appears. A network
or response-format uncertainty after send triggers only those reads; a present
build yields `assigned-after-uncertain-response`, otherwise
`INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN`. HTTP 409 likewise triggers only a
read: present yields `assigned-after-conflict-readback`, absent yields
`INTERNAL_GROUP_ASSIGNMENT_FAILED`. It never repeats POST in one run. A later
observation is idempotent. After an unknown outcome, Task 7 permits only a new
observation; if absence is confirmed, the release stops for a new explicit
decision rather than issuing a second POST in this plan.

`CABOHEALTH_RELEASE_EVIDENCE_ROOT` has the same external owned realpath
mode-`0700` contract as build/upload evidence. `--output` must equal the exact
new child `internal-testflight-group-observation.json` or
`internal-testflight-group-assignment.json` for the matching operation. Each
adapter exclusively creates, fsyncs, and revalidates one canonical owned
regular non-symlink single-link mode-`0600` line. Assignment exact key order is
`schemaVersion,evidenceKind,candidate,sourceCommit,sourceTreeSha256,buildInputAttestationSha256,buildArtifactAttestationSha256,easBuildId,appStoreConnectBuildResourceId,buildProcessingState,buildExpired,buildAudienceType,buildUploadedAt,betaGroupResourceId,betaGroupName,betaGroupInternal,betaGroupHasAccessToAllBuilds,observedBeforeMutationAt,availableBeforeMutation,mutationAttempted,mutationResponse,observedAfterMutationAt,availableAfterMutation,result,groupCreated,groupEdited,testerMutationPerformed,externalTestingMutationPerformed,appReviewMutationPerformed`.
Assignment uses integer schema 1, evidence kind
`cabohealth-app-store-connect-internal-group-assignment`, the same exact nested
candidate, and canonical UTC timestamps. `mutationResponse` is exactly
`none|204-no-content|network-uncertain-readback|409-readback`.
Successful `result` is exactly
`already-available-all-builds|already-assigned|assigned|assigned-after-uncertain-response|assigned-after-conflict-readback`;
`availableAfterMutation` is true and the five prohibited-mutation booleans are
false. Raw Apple responses, JWTs, credential paths, and unexpected IDs are
never emitted.

Finite public adapter errors are
`INTERNAL_GROUP_ARGUMENT_INVALID`, `INTERNAL_GROUP_INPUT_INVALID`,
`INTERNAL_GROUP_CREDENTIALS_INVALID`,
`INTERNAL_GROUP_AUTHORIZATION_FAILED`,
`INTERNAL_GROUP_LIVE_OBSERVATION_FAILED`,
`INTERNAL_GROUP_BUILD_INVALID`, `INTERNAL_GROUP_TARGET_INVALID`,
`INTERNAL_GROUP_PAGINATION_UNSUPPORTED`,
`INTERNAL_GROUP_ASSIGNMENT_FAILED`,
`INTERNAL_GROUP_ASSIGNMENT_OUTCOME_UNKNOWN`,
`INTERNAL_GROUP_OUTPUT_INVALID`, and `INTERNAL_GROUP_INTERNAL_ERROR`.
Direct production/dry-run tests cover both exact grammars/orders, observation
hash/freshness/false-state gating, read-only observer enforcement, attestation
binding, all ambiguous/wrong build/group states, pagination, zero-mutation
paths, one exact POST/body, 204 empty transport, readback/recovery/idempotency,
secure exclusive outputs, finite errors, and an exact request allowlist proving
no tester/group-creation/external-review/App-Review path is reachable.

- [ ] **Step 3: Recompute reviewed byte pins and run GREEN**

Recompute only required `EXACT_AUTHORITY_SHA256` and reviewed-prose pins after
manual semantic review. Run:

```bash
npm run typecheck
npm run lint
npm test
npm run test:scope
npm --prefix tools/app-store-submit-adapter test
git diff --check
```

Expected: all exit 0; scope reports `3.0/build 9` pre-build configured and
submission blocked. No current build-9 attestation/private artifact exists.

- [ ] **Step 4: Commit and independently review**

```bash
git commit -m "chore(release): rebaseline CaboHealth build 9"
```

After review approval, this exact commit is the frozen application-source
commit. No ordinary tracked changes are permitted afterward.
Before declaring the freeze, require:

```bash
git ls-files --error-unmatch docs/superpowers/specs/2026-08-30-cabohealth-build9-testflight-release-design.md
git ls-files --error-unmatch docs/superpowers/plans/2026-08-30-cabohealth-build9-testflight-release.md
git status --short
```

Both files must be tracked and status must be empty. Record the exact commit and
canonical digest. Any later plan/review correction creates a new freeze.

### Task 2: Produce and independently approve the build-9 input candidate

- [ ] Verify a clean frozen source, all current attestations absent, all pins
  null, exact Node/EAS runtime, and exact value-free production environment
  inventory. Resolve exactly one owned non-symlink mode-`0600` production plist
  outside Dropbox and use it only in memory.
- [ ] Pipe the live EAS environment response directly into
  `release-eas-environment-sanitizer.mjs`; retain only its canonical value-free
  output and SHA-256. Independently verify exact names/roles and zero values.
- [ ] Generate the canonical input candidate into ignored mode-`0600` SDD
  evidence using the exact source commit, reviewed sanitized-inventory file,
  and a canonical UTC timestamp. Its `easEnvironmentInventorySha256` must match
  those exact bytes. Do not write the tracked current path yet.
- [ ] Run producer/guard/scope tests and independently review schema, hashes,
  source digest, runtime closure, resolved Expo config, environment inventory,
  privacy, and absence of secret values.

### Task 3: Pin only the reviewed build-9 input authority

- [ ] Materialize the approved candidate byte-for-byte at current
  `build-input-attestation.json` and change only
  `BUILD_INPUT_ATTESTATION_SHA256` from null to its reviewed hash.
- [ ] Require exact name-status `A` attestation + `M` guard and exact one-line
  normalized guard delta. Commit:

```bash
git commit -m "chore(release): pin build 9 input attestation"
```

- [ ] Independently review the commit, verify linear authority history and
  identical canonical source digest, and run post-pin producer/guard/scope
  gates. Artifact/RC/tool pins remain null.
- [ ] Re-resolve the unique approved production plist for direct post-pin guard
  verification; expose its path only to that child environment and retain no
  path/value.

### Task 4: Execute the guarded build-9 production build

- [ ] Reverify the approved production plist, live value-free EAS environment
  inventory, exact account/project, clean authority state, and no existing
  build-9 provider operation that would make a retry ambiguous.
- [ ] Run exactly once:

```bash
npm run build:prod
```

The guard must invoke EAS iOS production with frozen credentials and
non-interactive mode from a private snapshot. Capture raw output only in
external private evidence and retain an allowlisted sanitized SDD summary.
Set `CABOHEALTH_RELEASE_EVIDENCE_ROOT` to the verified external build-9
evidence root before invoking the package script. The build-action marker must
not already exist.
- [ ] Wait for a terminal EAS result. Record exact build UUID, status,
  version/build, timestamps, artifact-availability boolean, source and input
  authority. A failed/ambiguous operation is not automatically retried.
- [ ] On any nonzero result, apply the global retry state machine before doing
  anything else. A pre-provider rerun requires independent evidence review and
  one recorded authorization; initiated/unknown state requires read-only EAS
  reconciliation first.

### Task 5: Download, audit, and independently approve the exact build-9 IPA

- [ ] Verify the terminal EAS build identity before consuming the artifact
  locator. Re-resolve the approved plist. Use the tracked artifact downloader
  once to create `release/private/rc-build-9/` with directory
  mode `0700`, files mode `0600`, bounded size, ZIP signature, fsync, and final
  descriptor SHA-256, plus the ignored canonical association summary.
- [ ] Run the exact IPA audit for bundle `com.cabohealth.app`, version `3.0`,
  build `9`, Team `DQ8PH2DZ3R`, production App Attest/Firebase, and
  `applinks:cabohealth.org`.
- [ ] Materialize an ignored 14-key artifact-attestation candidate binding the
  reviewed input, source digest, EAS build UUID/association, IPA, entitlements,
  privacy report, embedded plist, certificate, and provisioning profile using
  the tracked artifact-attestation producer.
- [ ] Independently review exact bytes, private modes, hashes, evidence privacy,
  and the conservative `associationGuardProven:false` fact.

### Task 6: Pin only the reviewed build-9 artifact authority

- [ ] Copy the approved candidate byte-for-byte to current
  `build-artifact-attestation.json` and change only
  `BUILD_ARTIFACT_ATTESTATION_SHA256` from null to its reviewed hash.
- [ ] Require exact two-path history and commit:

```bash
git commit -m "chore(release): pin build 9 artifact attestation"
```

- [ ] Independently verify the exact private IPA set, input immutability,
  source digest, phase history, guard/audit/scope tests, and null RC/tool pins.
- [ ] Re-resolve the unique approved production plist for direct post-pin
  artifact verification; expose it only in memory/environment.

### Task 7: Upload the exact attested IPA to internal TestFlight

- [ ] Reverify clean authority, exact IPA hash/mode/path, account/project, and
  absence of an ambiguous existing submission for the same exact build.
- [ ] Re-resolve and verify the exact approved production plist; export it only
  for the guarded upload child because artifact verification requires it.
- [ ] Run exactly once:

```bash
npm run upload:testflight
```

The guard copies only the attested IPA to a unique private operation outside
Dropbox, rehashes it before submission, invokes exactly
`submit --platform ios --path IPA --non-interactive --no-auto-testflight-setup`,
and cleans only that operation directory. It never passes `--groups`.
Set the same verified external build-9 evidence root before invocation. Upload
uses its own action marker and cannot reuse the build marker.
- [ ] Wait for terminal submission result, then make a fresh read-only
  App Store Connect observation of the exact 3.0/build 9. Record only sanitized
  build/submission IDs, status, timestamps, and whether it is available to the
  existing internal group. Pipe raw submission status directly through the
  tracked sanitizer. Resolve the existing App Store Connect API credential
  under its owner-only external-file contract; if it is unavailable, stop with
  a safe group-observation blocker. Do not create external testing or App
  Review.
- [ ] Run the separately guarded, read-only Apple observation exactly once:

```bash
npm run observe:testflight:internal
```

  Independently verify its canonical file/hash, exact build/group identities,
  zero mutation, and `available` result. If available, do not run assignment.
- [ ] Only if that exact fresh observation says `available:false` and
  `availabilityReason:not-assigned`, run exactly once:

```bash
npm run assign:testflight:internal
```

  The assignment guard hash-binds the observation and rejects it after 15
  minutes. Its adapter repeats the complete read-only identity and
  relationship observation immediately before its sole relationship POST and
  writes the canonical external evidence above. It cannot create/edit groups
  or testers, pass group flags, enable external testing, or reach App Review.
  If the group already has all-build access or the relationship is present, it
  performs zero mutations. Any unresolved credential, pagination, identity, or
  uncertain-outcome condition records `available:false` as a safe blocker and
  stops this plan.

### Task 8: Handoff for physical-device verification

- [ ] Report the exact build-9 TestFlight state, IPA/source/authority hashes,
  rollback availability (build 8 remains intact), and any processing blocker.
- [ ] Provide the user a short physical test checklist for the original failing
  external destination, Public/VIP cards, locked-code flow, progress, back,
  retry, broker resource, and both supported iPhones.
- [ ] Stop before RC, screenshots, metadata mutation, or App Review. Those need
  real device/Apple observations and a later explicit action-time decision.
