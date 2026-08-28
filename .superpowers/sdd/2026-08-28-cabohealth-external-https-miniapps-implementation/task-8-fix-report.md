# Task 8 fix report

## Outcome

Resolved both findings from `task-8-review.md` without changing release attestations, deployment state, the App Review V1 parser/launch path, or the broker renderer behavior.

Production schema V2 grant titles and summaries now reuse the exported V3 client-preview copy boundary. Every English and Spanish field therefore fails closed on URI schemes, hostnames, IPv4/IPv6 hosts, private paths, credentials, and the rest of the existing operational/commercial-detail policy before the grant can enter controller or home-card state. The fixed App Review resource remains on its separate exact parser.

External VIP WebView errors now render Retry and Back. Retry is delegated to the parent route, which first clears the active external launch, advances the operation generation, and advances the route attempt. The restarted route flow then performs its existing refresh-before-create-launch sequence and accepts only the current generation's fresh V2 descriptor. A late pre-retry launch is discarded. Broker and App Review errors remain Back-only and retain their existing primary-button presentation.

## Files changed

- `features/catalog/publishedCatalog.ts`
- `features/clientAccess/clientAccessController.ts`
- `features/clientAccess/clientResourceRoute.ts`
- `features/clientAccess/ClientResourceWebView.tsx`
- `app/client-resource/[resourceId].tsx`
- `tests/client-access-controller.test.mjs`
- `tests/client-resource-route.test.mjs`
- `tests/client-resource-webview.test.mjs`

## TDD evidence

### Localized grant-copy RED

The new table test was written first across `title.en`, `title.es`, `summary.en`, and `summary.es`, with independent URI, hostname, IP-host, private-path, and credential fixtures. The focused command exited 1 because the existing production parser accepted `custom-app://vip-resource` in `title.en` and returned the destination-bearing parsed grant.

### External error actions RED

The executable TSX harness was written first and triggered the real component's `onError` handler. The focused command exited 1 because the rendered external error state contained only `clientAccess.backToResources`, not the required ordered `common.retry` and Back actions. The broker Back-only regression was green before and after the change.

### Route restart RED

The route test imported the not-yet-existing `beginClientResourceRouteExternalRetry`; its initial run exited 1 with the expected missing export. The implemented transition is now consumed by the route callback and covered together with stale-generation rejection and the subsequent refresh-before-fresh-launch sequence.

## Verification evidence

- Focused controller/component/route GREEN: 51 tests, 0 failures.
- Task 8 focused and adjacent native suite, including Task 7 policy and V3 preview-policy regressions: 162 tests, 0 failures.
- Focused route lifecycle/screen suite: 23 tests, 0 failures.
- Task 7 URL/navigation/patched-WebView policy regression suite: 18 tests, 0 failures.
- Root `npm run typecheck`: PASS.
- Root `npm run lint`: PASS with 0 errors and the same 3 unrelated pre-existing warnings. Expo's generated `eslint.config.js` was removed and is not part of the fix.
- `git diff --check`: PASS.

No build, browser, simulator, deploy, TestFlight, App Store, or Task 9 release-attestation action was performed.
