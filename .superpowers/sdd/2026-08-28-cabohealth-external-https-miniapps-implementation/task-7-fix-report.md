# Task 7 fix report

## Outcome

Addressed both Task 7 review findings with executable regression coverage.

The external navigation suite now transpiles and executes the installed pinned `react-native-webview/src/WebViewShared.tsx` module itself. For both iOS and Android contract paths, it proves that a rejected origin invokes the application callback exactly once but forces the native `loadRequest` decision to `false`, even when the application callback returns `true`, with no `Linking` effect. It also proves that the package's prefix-matching whitelist cannot allow `https://www.eightsleep.com.attacker.org/` when CaboHealth's exact-origin callback returns `false`.

The external route now owns a stable `ExternalMiniappRouteStateMachine`. Its behavioral test starts ready on URL A, updates the live catalog to URL B under the same opaque resource ID, observes terminal `unavailable`, and proves URL A cannot remount afterward. The screen's tight composition test requires it to create and call that same tested state machine, so deleting the mounted wiring fails the suite.

## Files changed

- `features/catalog/publicMiniappRoute.ts`
- `app/external-miniapp/[resourceId].tsx`
- `tests/external-miniapp-route.test.mjs`
- `tests/external-miniapp-navigation.test.mjs`
- `tests/dynamic-public-catalog-ui.test.mjs`

No dependency patch bytes changed. `patches/react-native-webview+13.15.0.patch` remains the reviewed Task 7 patch.

## RED evidence

### Patched shared-wrapper behavior

After adding the executable wrapper tests, the installed patch was reversed to pristine upstream 13.15.0 and the test was run:

```text
$ patch -p1 -R < patches/react-native-webview+13.15.0.patch
$ node --test tests/external-miniapp-navigation.test.mjs
patched shared wrapper forces rejected origins to false after one application callback on iOS and Android — FAIL
expected application callback URLs: ['https://accounts.eightsleep.com/login']; actual: []
tests 7, pass 6, fail 1, exit 1
```

This is the intended regression: pristine upstream skips CaboHealth's callback and enters its `Linking` path for a rejected whitelist origin.

### Mounted destination latch

After adding the sequential latch and screen-composition tests before the abstraction existed:

```text
$ node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-route.test.mjs tests/dynamic-public-catalog-ui.test.mjs
external Public items use an ID-only route that re-resolves the live catalog item — FAIL (screen did not create the state machine)
mounted external route latch tears down URL A before the same opaque ID can load URL B — FAIL (factory was undefined)
tests 8, pass 6, fail 2, exit 1
```

## GREEN evidence

Updated required focused command:

```text
$ node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-route.test.mjs tests/external-miniapp-navigation.test.mjs tests/navigation-policy.test.mjs tests/dynamic-public-catalog-ui.test.mjs tests/home-miniapp-grid-contract.test.mjs tests/aasa-contract.test.mjs
tests 51, pass 51, fail 0, exit 0
```

Adjacent internal/broker/catalog regression command:

```text
$ node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/restricted-webview-behavior.test.mjs tests/client-resource-navigation.test.mjs tests/client-access-ui-contract.test.mjs tests/public-catalog-state.test.mjs tests/published-catalog-runtime.test.mjs tests/external-https-url-policy.test.mjs
tests 61, pass 61, fail 0, exit 0
```

Root TypeScript:

```text
$ npm run typecheck
exit 0
```

Pinned dependency/install contract:

```text
$ node -e "...assert react-native-webview 13.15.0 and exact postinstall..."
exit 0
$ patch -p1 -R < patches/react-native-webview+13.15.0.patch
$ patch -p1 --dry-run < patches/react-native-webview+13.15.0.patch
$ patch -p1 < patches/react-native-webview+13.15.0.patch
all patch operations exit 0
$ node --test tests/external-miniapp-navigation.test.mjs
tests 7, pass 7, fail 0, exit 0
```

Whitespace validation:

```text
$ git diff --check
exit 0
```

## Scope and limitations

- No deployment, EAS build, browser, TestFlight, or Apple action was performed.
- The full root suite remains outside this focused fix because of the documented unrelated `web-release-assembly` stdin/EOF hang and existing release-attestation drift. The required focused and adjacent native gates were used.
