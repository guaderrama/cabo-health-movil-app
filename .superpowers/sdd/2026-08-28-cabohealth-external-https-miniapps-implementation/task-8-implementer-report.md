# Task 8 implementer report

## Outcome

Implemented native production consumption of the V2 client-access contracts and authorized external HTTPS VIP launches while preserving the exact App Review V1/fixed-broker path.

Production redeem, refresh, and launch now call only `redeemClientAccessCodeV2`, `refreshClientAccessV2`, and `createClientLaunchV2`. Production grants require exact URL-free schema V2; App Review remains exact schema V1. Launch responses are parsed as an exact realm-bound broker/external union, with strict keys, canonical Task 6 external URL policy, and a finite future expiry no more than 120 seconds from the current parser clock.

The native launch model is discriminated. Broker launches retain the existing POST source and app-bound WebView policy. Authorized external launches carry the destination only in transient launch state, reuse the exact Task 7 same-origin external WebView policy, and expose no favorite, share, browser, or native-bridge escape.

The protected route still refreshes before launch and uses its generation token. Its authorization transition is now an executable pure boundary used by the screen: foreground checking, resource removal/deactivation, revocation, replacement, deletion, errors, and expiry all return `activeLaunch: null`; delayed external launch results are discarded. Route params, grants, previews, home cards, messages, and storage-facing session state remain URL-free.

## Files changed

- `features/clientAccess/clientAccessController.ts`
- `features/clientAccess/firebaseClientAccessAdapter.ts`
- `features/clientAccess/clientResourceNavigation.ts`
- `features/clientAccess/clientResourceRoute.ts`
- `features/clientAccess/ClientResourceWebView.tsx`
- `app/client-resource/[resourceId].tsx`
- `i18n/messages.ts`
- `tests/client-access-controller.test.mjs`
- `tests/firebase-client-access-adapter.test.mjs`
- `tests/client-resource-navigation.test.mjs`
- `tests/client-resource-route.test.mjs`
- `tests/client-home-presentation.test.mjs`
- `tests/react-native-firebase-bridge.test.mjs`
- `tests/localization-contract.test.mjs`
- `tests/client-access-ui-contract.test.mjs` (compiler/source-contract support for the extracted route transition)

No release attestation, deployment, build, browser, TestFlight, or Apple state was changed.

## TDD evidence

### V2 grant and launch union RED

After the production tests and fixtures were changed first, the required focused command exited 1 with 24 failures. The failures were the intended missing behavior: schema V2 grants were rejected, the adapter still called V1 production endpoints, production broker responses had no discriminant support, and external launch responses returned null.

Command:

```text
node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/client-access-controller.test.mjs tests/firebase-client-access-adapter.test.mjs tests/react-native-firebase-bridge.test.mjs
```

### Route teardown RED

The lifecycle test imported the not-yet-existing `resolveClientResourceRouteAuthorizationTransition`; the focused route command exited 1 with the expected missing named export. The production route was then wired to the tested transition.

### Generic failure copy RED

The localization test required generic broker/external unavailable copy and failed against the old “secure resource” wording before the bilingual message change.

## Verification evidence

- Required controller/adapter/bridge command: PASS, 74 tests, 0 failures.
- Complete Task 8 plus adjacent native command: PASS, 133 tests, 0 failures. This included all seven planned Task 8 test files, route screen composition, Task 6 URL fixtures, Task 7 executable patched-WebView regressions, and catalog compatibility.
- Focused route lifecycle/screen command: PASS, 20 tests, 0 failures.
- Root `npm run typecheck`: PASS, exit 0.
- Root `npm run lint`: PASS, exit 0, with 3 pre-existing unrelated warnings and no errors. Expo generated an unrequested `eslint.config.js`; it was removed after each lint run and is not part of the change.
- Broader root suite excluding only `tests/web-release-assembly.test.mjs`: completed with 1,427 tests; 1,414 passed, 12 failed, and 1 skipped. The failures are the known release/source-attestation drift owned by Task 9; the first reports exact reviewed-byte and content-rights SHA-256 drift for the already changed catalog/i18n sources. No release attestations were edited here.
- `git diff --check`: PASS.
- Source privacy audit: no V1 production callable names remain in the client adapter; no external test destination literal appears in product route/grant/storage/message code; and the client launch path contains no `AsyncStorage`, logging, `Linking`, or `Share` escape.

## Known limitations

- Exact root `npm test` was not used as the completion gate because the documented `tests/web-release-assembly.test.mjs` child-process stdin/EOF hang prevents completion. The broader command excluded only that known hung file and otherwise ran the root test inventory.
- The 12 known release-attestation failures remain intentionally unresolved because Task 9 owns source/release gate integration.
- Physical third-party WebView behavior remains a later TestFlight QA item; no simulator, browser, deployment, or Apple action was performed.
