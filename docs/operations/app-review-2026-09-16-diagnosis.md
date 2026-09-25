# App Review 3.0 (12): access failure investigation

## Status

Apple rejected build 12 on 2026-09-15 under 2.1(a). The full device incident
is **not yet reproduced or conclusively explained**. A related, deterministic
session-loss bug is reproduced and corrected locally. No new build, upload,
backend deployment, credential rotation, Apple reply, or resubmission occurred.

## Fresh evidence (read September 16)

- Submission: `631db165-e316-4627-9ee8-db84c3136686`, app `6758285327`.
- Apple reports iPad Air 11-inch (M3), iPadOS 27.0, active internet.
- Apple's attachment `Screenshot-0915-131119.png` actually displays
  "Access could not be verified. Check your connection and try again."
  This is the UI's `unavailable` path, not its `invalid-code` path.
- The attachment was downloaded through App Store Connect to
  `/Users/ivan/Downloads/Screenshot-0915-131119.png`.
- Cloud Run request logs for September 15 contain these requests with user
  agent `com.cabohealth.app/3.0 iPad/27.0 hw/iPad15_3` (UTC):

| Time | Operation | HTTP | Duration |
| --- | --- | --- | --- |
| 12:09:14 | redeemAppReviewCredential | 200 | 7.03 s |
| 12:09:55 | refreshAppReviewAccess | 200 | 4.09 s |
| 12:10:00 | createAppReviewLaunch | 200 | 4.65 s |

- Callable verification passed; the review database has an active generation-2
  grant created at 12:09:21 and updated at 12:10:05 that day. No identifiers,
  lookup hashes, credential, tokens, IP addresses, or private payloads are
  retained in this report.
- Current reviewer credential is still active, generation 2, last rotated
  September 8 UTC (September 7 owner-local time). Do not rotate speculatively.
- No `appReviewBrokerApi` request was observed in that day's request logs.
  This does not establish whether a request reached Hostinger or where the
  entire incident originated.
- Relevant access source matches build 12's input commit
  `e2b483b7531f2fba3302819b3fa365fee9fa4e30` before this local correction.

## Ranked hypotheses and limits

1. Launch response rejected locally (clock window, shape, or interrupted
   lifecycle), followed by loss of authentication. The successful request
   sequence and lack of a broker request are consistent with this boundary.
   The time-window/session-loss case is reproduced below. Device clock skew
   is an injected test condition, **not a confirmed fact about Apple's iPad**.
2. A later native App Check/network/storage failure before reaching Functions.
   Possible, but the three successful requests demonstrate that the device
   could attest, authenticate, and request a launch at least once. No device
   console trace is available to establish a later failure.
3. Wrong, expired, or one-device-only reviewer code. Contradicted for the
   observed successful redemption: generation 2 remains active and separate
   grants exist for September 10 and 15. This does not describe every unseen
   attempt, but rotating the credential is not supported by this evidence.

## Reproduced defect and minimal fix

Real controller + Firebase adapter, with test doubles only at Auth/network/
storage boundaries: redeem an AR credential successfully, receive an otherwise
valid launch envelope outside the device's 120-second acceptance window, and
refresh. Before the fix, `createLaunch` called `failAndSignOut`; the next refresh
had no Firebase principal and changed the controller to `error/unavailable`.
Both ahead/behind device-clock cases reproduce it. Production launches have
the same unwanted side effect.

The adapter now distinguishes a structurally valid but out-of-window launch
from a malformed or cross-realm response. The launch remains denied. The
already authenticated principal is preserved so access can be revalidated;
no nonce, URL, timeout, App Check, grant, or server-side security rule is relaxed.
Malformed/cross-realm responses still follow existing fail-closed behavior.

This corrects the demonstrated logout cascade. It does **not** synchronize a
device clock, guarantee the sample opens, or prove this was Apple's cause.

## Verification and next gate

- Two new regression tests were run red against the original implementation:
  review access became `error` instead of `unlocked`; production lost its UID.
- After correction, 88 adapter/controller/resource-route tests passed.
- Recovery test also verifies that a subsequent in-window envelope produces
  the expected review POST launch without re-entering a credential.
- Typecheck passed. Lint: zero errors, three warnings in unchanged files
  (`AnimatedMolecules.tsx`, `SkeletonCard.tsx`, `PremiumIcon.tsx`).
- Full suite was run twice: 1,695 tests; 1,693 pass, one failure, one skip.
  The failure is `build-input producer accepts only the current task-2
  inventory parent` with `BUILD_SOURCE_NOT_CLEAN`. Its release attestation
  producer requires a clean tracked source tree, while this correction is
  intentionally still an uncommitted patch. Do not disable that guard or
  call the full suite green. Consolidate the next candidate and rerun it.
- `git diff --check` passed. No commit was made and no release pins changed.
- A physical iPad release test remains required: clean install, same saved
  AR credential, open sample, background/foreground, reopen, repeat. Record
  device time against UTC and sanitized stage/error codes if failure recurs.
- Local `xcrun simctl list devices available` cannot run: this Mac's active
  developer tools do not provide `simctl`. A simulator would not prove real
  production App Attest even if installed.
- Preserve build 12's frozen release attestations. Any native change needs a
  new candidate/build and release verification; never relabel these tests as
  TestFlight QA or modify historical evidence to imply an upload.

Commands (from this checkout):

```sh
node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json
node --test tests/firebase-client-access-adapter.test.mjs tests/client-access-controller.test.mjs tests/client-resource-route.test.mjs
npm test
npm run typecheck
npm run lint
```
