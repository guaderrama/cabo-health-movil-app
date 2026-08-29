# Task 9 implementer report

Date: 2026-08-28

## Outcome

Task 9 integration, operations documentation, source-authority reconciliation,
and local verification are complete from base HEAD
`34a1724eb2821c5758b4a0a2d08dd53fa250b4d6`.

This work did not deploy Functions or Staff, build a native binary, run a
browser or simulator, invoke EAS, modify TestFlight/App Store Connect, or
submit to App Review. External-HTTPS support remains implemented and locally
verified source whose deployment, build 8, physical-device QA, and release
evidence belong to the separate release plan.

## Authorities read

I read the approved design, the complete implementation plan and Task 9 brief,
all Task 1–8 implementer/fix/compatibility-fix/review reports, and the release
plan for boundary awareness only. I re-read the final design boundaries before
the mutation-focused runs.

## Operations contract

The following four runbooks now record the final contract and monotonic
rollback behavior:

- `docs/operations/dynamic-miniapp-catalog.md`
- `docs/operations/client-access-backend.md`
- `docs/operations/native-firebase-runtime.md`
- `docs/operations/ios-protected-resource-scope.md`

Together they pin:

- unchanged protected `_private_catalog/current` schema version 1 and existing
  schema-version-1 codes, grants, and URL-free client projections;
- internal slug IDs versus request-ID-derived
  `external-[0-9a-f]{32}` IDs using the
  `cabohealth/catalog-external-id/v1` domain-separated SHA-256 namespace;
- V1/V2/V3 catalog behavior, production V1 `legacy_cabohealth` filtering,
  production V2 `v2_all`, and the separate fixed App Review realm;
- URL-free previews, grants, projections, schema-version-2 receipts, sanitized
  audits, logs, errors, routes, and durable native state;
- the exact broker/external `createClientLaunchV2` union, server-side URL
  resolution, and `min(now + 60 seconds, grant expiry, code expiry)` lifetime;
- the ID-only `/external-miniapp/[resourceId]` native route and its exclusion
  from Universal Links/AASA;
- live catalog and VIP teardown on authority, entitlement, lifecycle, or route
  generation changes;
- same-origin in-app WebView behavior with blocked cross-origin navigation,
  popups, browser handoff, sharing, and native bridge surfaces;
- pinned `react-native-webview` 13.15.0 patch behavior and the exact fatal
  `patch-package --error-on-fail --error-on-warn` install contract;
- installed build 7 compatibility through legacy filtering and build 8 as the
  first compatible external-link client;
- the exact, sole legacy `client-resources` bilingual-copy validation exception
  while returning authoritative legacy copy unchanged; and
- the explicit warning that VIP gating protects only CaboHealth's in-app entry
  point and does not make a third-party website private.

## Narrow source correction

The Staff activation guidance incorrectly claimed compatibility with build 7,
although build 7 intentionally consumes legacy filtered contracts. I changed
the English and Mexican Spanish guidance to build 8 or later.

TDD evidence:

1. The assertions were changed first to require build 8.
2. `npm --prefix staff-portal test` failed as intended: 81 passed and the one
   bilingual compatibility assertion failed against the build-7 copy.
3. After changing only the two production strings, the same command passed
   82/82.

## Source and release-authority reconciliation

Each failed authority was inspected against the Task 6–8 source history before
its pin changed. No snapshot was blindly refreshed.

- `constants/publicMiniapps.ts` now pins
  `7306d82fd7de694b16de85401a8aab431c5408037f5038ce95fc5f79edef9dda`,
  covering Task 6's internal/external destination type boundary.
- `i18n/messages.ts` now pins
  `1670784ca0f2725cbd26e9b16d62f88617513155eeb7da5126b8bcac596a8bfb`,
  covering Task 6/8 dynamic and external presentation copy.
- `staff-portal/src/i18n/messages.ts` now pins
  `1999940156e2def03b1ce970fd948b253da2d26968bc0413bd86f60f7bde0eeb`,
  including the Task 5 external rights/privacy copy and the Task 9 build-8
  compatibility correction.
- `release/app-store/3.0/content-rights-inventory.md` now pins
  `865cbdb2d6ed62c2e8a3a33b08114776f298c571e8df27c4e6b6ea2ffb83e2c3`.
- The pinned EAS CLI authority retains Node `v22.22.3`, EAS CLI `22.2.0`, and
  the unchanged entry-point executable hash, while its runtime-tree SHA-256 is
  updated to
  `d9dd3cfc5e96765ffef8cc6bd74d3cf1487405e2516935c28f753a159e191ca2`.
  This attests the expected installed dependency tree after Task 7's reviewed
  `react-native-webview` patch; it is not build or deployment evidence.

All content-rights rows remain `Pending`. Build-input, build-artifact, RC,
TestFlight, App Store Connect, and submission evidence/statuses were not
advanced. The focused release/source authority run passed 618/618.

The first exact root run also exposed one Task 7 integration drift: the
cross-cutting exact patch-inventory test still listed only the two RNFirebase
patches. That run was the RED evidence (1,469 pass, 1 fail, 1 skip). Adding the
reviewed `react-native-webview+13.15.0.patch` filename was the only correction;
the focused installed-patch and wrapper run then passed 10/10, and the complete
root suite passed on rerun.

## Boundary mutation checks

Fresh focused runs passed 118/118 Functions cases and 137/137 native/adapter
cases. Each requested realistic mutation is killed by an executable negative
case:

| Mutation | Killing regression |
| --- | --- |
| external URL accepted by a legacy endpoint | `legacy V1 and V2 omit external items...`, `legacy grants filter external resources...`, and `the legacy launch surface rejects external IDs...` |
| caller-supplied `targetUrl` | `createClientLaunchV2 rejects caller-supplied targetUrl before invoking the launch service` (zero service calls) |
| mismatched opaque external ID | `fails closed if an opaque external ID already belongs to another create request` and stored V3 identity/parser cases |
| changed URL on update | `keeps an external destination immutable` plus live-route URL replacement teardown |
| cross-origin WebView allow | `popup, cross-origin redirect... all block in place` and the installed shared-wrapper decision tests |
| popup forwarding | the popup case returns false, records one generic error, and records zero external-open effects |
| external route treated as a Universal Link | `AASA never claims the native-only external-miniapp route` plus exact mutated-AASA verifier cases |
| external URL in VIP grant/preview/audit | V3 preview-shape rejection, URL-free production grant/home-state cases, URL-free receipt persistence, URL/nonce persistence, and sanitized Staff audit assertions |
| App Review accepting a V2 external launch | `App Review rejects the external launch union without changing its fixed V1 broker path` |

## Exact final gates

- `npm --prefix functions test`: PASS, 263 tests, 0 failures.
- `npm --prefix functions run build`: PASS.
- `npm --prefix staff-portal test`: PASS, 82 tests, 0 failures.
- `npm --prefix staff-portal run typecheck`: PASS.
- `npm test`: PASS on the corrected final tree, 1,471 tests, 1,470 passed,
  0 failed, 1 skipped.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 0 errors and the same 3 pre-existing warnings.
  Expo generated an untracked default `eslint.config.js`; it was removed after
  the gate and was not committed.
- `npm run expo:config > /tmp/cabohealth-external-miniapps-expo-config.json`:
  PASS. Parsed output is bundle ID `com.cabohealth.app`, version `3.0`, exact
  associated domains `["applinks:cabohealth.org"]`, and exact
  `WKAppBoundDomains: ["cabohealth.org"]`.
- `git diff --check`: PASS.

The long root suites completed naturally. Buffered TAP output created quiet
periods but there was no reproducible Python-EOF hang in either exact Task 9
run, so no concurrency or test-harness workaround was added.
