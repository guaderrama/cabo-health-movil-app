# Task 8 compatibility fix report

## Outcome

Preserved the authoritative migrated production `client-resources` V2 grant view without weakening the Task 8 localized-copy side-channel boundary.

The native parser now recognizes only the full exact legacy tuple: `client-resources`, native `sparkles-outline` (the Functions `featured` catalog-icon projection), the fixed bilingual title, and the fixed bilingual legacy summary. For policy validation only, that exact tuple uses the same neutral summary as the Functions `normalizeExactLegacyClientResourcesPreview` path. The returned production grant retains the original authoritative title and summary unchanged.

Every other production resource still passes through the exported V3 client-preview copy policy. The exception does not add `featured` to native icon acceptance and does not broadly permit complimentary/free or commercial language. App Review continues through its separate exact V1 parser.

## Files changed

- `features/clientAccess/clientAccessController.ts`
- `tests/client-access-controller.test.mjs`

## TDD evidence

The authoritative two-resource group regression was written first with the exact migrated `client-resources` V2 view plus a safe external resource. Node-test compilation succeeded, then the controller suite exited 1: `parseClientGrantView()` returned `null` instead of the exact group grant. The accompanying 11 near-miss cases were already green, proving the pre-fix parser rejected changed ID, valid alternative icon, stored pre-migration icon, changed English/Spanish title or summary, embedded URL, embedded credential, generic free copy, and commercial copy.

After the narrowly pinned validation exception, the controller suite passed 40 tests. The exact group grant parses unchanged and contains no destination, redemption preserves the group grant, and `client-resources` produces the unchanged production broker POST launch. All near misses remain rejected.

## Verification evidence

- Authoritative compatibility/controller suite: PASS, 40 tests, 0 failures.
- Complete Task 8 focused/adjacent suite, including the V3 policy and Task 7 regressions: PASS, 164 tests, 0 failures.
- Focused route lifecycle/screen suite: PASS, 23 tests, 0 failures.
- Task 7 URL/navigation/patched-WebView policy suite: PASS, 18 tests, 0 failures.
- Root `npm run typecheck`: PASS.
- Root `npm run lint`: PASS with no errors and the same three unrelated pre-existing warnings.
- `git diff --check` and cached diff checks: PASS.

The earlier localized side-channel rejection and external Retry/Back fixes remain intact. No Functions source, deployment, build, browser, simulator, release attestation, TestFlight, or App Store state was changed.
