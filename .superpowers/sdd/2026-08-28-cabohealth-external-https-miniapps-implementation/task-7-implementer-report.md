# Task 7 implementer report

## Outcome

Implemented Public external HTTPS miniapps through a native-only, ID-only route and a dedicated secure WebView. Home and Saved now route by the catalog discriminant; `/apps/[slug]` accepts only CaboHealth destinations; the external route re-resolves the live V3 catalog on every render and unmounts/fails unavailable when the resource is removed, changes destination kind, or violates its immutable destination identity.

The WebView loads the exact canonical URL without a CaboHealth presentation fragment. It permits only URLs that pass the shared safe-external parser on the selected origin, blocks popups and unsafe/cross-origin/local/traversal targets in place, exposes no native browser/share/bridge escape, and uses only security props present in pinned `react-native-webview` 13.15.0. The existing internal `RestrictedWebView` component and app-bound policy remain unchanged.

## Files changed

- `features/catalog/publicMiniappRoute.ts`
- `app/external-miniapp/[resourceId].tsx`
- `features/launch/externalHttpsNavigationPolicy.ts`
- `features/launch/ExternalHttpsWebView.tsx`
- `app/(main)/index.tsx`
- `app/(main)/saved.tsx`
- `context/PublicCatalogContext.tsx`
- `features/launch/navigationPolicy.ts`
- `patches/react-native-webview+13.15.0.patch`
- `tests/external-miniapp-route.test.mjs`
- `tests/external-miniapp-navigation.test.mjs`
- `tests/navigation-policy.test.mjs`
- `tests/dynamic-public-catalog-ui.test.mjs`
- `tests/home-miniapp-grid-contract.test.mjs`
- `tests/aasa-contract.test.mjs`
- `tsconfig.node-tests.json`

`app/apps/[slug].tsx` was inspected but did not need a source edit: its existing route already delegates to `resolvePublicMiniappRouteSlug(slug, miniapps)`, and that resolver now requires `destinationKind === 'cabohealth'`. The generated AASA and its generator were also inspected and intentionally left unchanged; the contract test proves they never claim `/external-miniapp/`.

## Scope deviations

- `context/PublicCatalogContext.tsx` now exposes `isInitialLoading` separately from refresh-time `isLoading`. This is required so an external route waits only for the first catalog authority check and fails unavailable immediately on a later foreground removal rather than showing a refresh loading state.
- `patches/react-native-webview+13.15.0.patch` is required for the no-browser-escape contract. Pinned `react-native-webview` otherwise calls `Linking.openURL` itself when `originWhitelist` rejects a URL, before CaboHealth's callback can block it. The patch preserves the selected-origin whitelist, invokes CaboHealth's callback only to render the generic blocked state, and always cancels the rejected load. Existing internal WebViews use `originWhitelist: ['*']`, so their current application-level behavior remains unchanged.

## TDD evidence

### RED 1 — route isolation

After adding route/helper/teardown tests first:

```text
$ node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-route.test.mjs tests/navigation-policy.test.mjs tests/aasa-contract.test.mjs
error TS6053: File '.../features/catalog/publicMiniappRoute.ts' not found.
exit 2
```

### RED 2 — external WebView policy

After adding exact-source, navigation, popup, security-prop, and no-escape tests first:

```text
$ node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-navigation.test.mjs
error TS6053: File '.../features/launch/externalHttpsNavigationPolicy.ts' not found.
exit 2
```

### RED 3 — immutable live destination

After adding a mounted-route destination-change regression:

```text
$ node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-route.test.mjs
expected { kind: 'unavailable' }; actual { kind: 'ready', miniapp: { destinationUrl: 'https://www.eightsleep.com/replaced/', ... } }
tests 4, pass 3, fail 1, exit 1
```

## Verification evidence

Required focused command:

```text
$ node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-route.test.mjs tests/external-miniapp-navigation.test.mjs tests/navigation-policy.test.mjs tests/dynamic-public-catalog-ui.test.mjs tests/home-miniapp-grid-contract.test.mjs tests/aasa-contract.test.mjs
tests 48, pass 48, fail 0, exit 0
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

Patch/install contract and whitespace:

```text
$ patch -p1 --dry-run --verbose < patches/react-native-webview+13.15.0.patch
Hunk #1 succeeded; Hunk #2 succeeded; exit 0

$ git diff --cached --check
exit 0
```

The root `package.json` retains the exact installation gate `patch-package --error-on-fail --error-on-warn`, and the patch uses the conventional pinned filename `react-native-webview+13.15.0.patch`.

## Broader-suite limitations

- The full root `npm test` command was not run because the task brief explicitly records the unrelated `tests/web-release-assembly.test.mjs` stdin/EOF hang. Focused and adjacent native suites were used instead.
- Existing release-byte/content-rights attestation drift from Task 6 is outside Task 7. No release attestations, deployment state, EAS builds, browsers, TestFlight uploads, or Apple submission state were changed.
