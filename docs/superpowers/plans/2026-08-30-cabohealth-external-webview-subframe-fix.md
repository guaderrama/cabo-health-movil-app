# CaboHealth External WebView Subframe Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make arbitrary external HTTPS miniapps load reliably inside CaboHealth when they create safe inherited blank iframes, while preserving every top-frame security boundary and making VIP page progress visible.

**Architecture:** Replace the URL-only external navigation decision with one request-aware pure classifier that consumes `url`, `isTopFrame`, and `mainDocumentURL`. Both Public and VIP components delegate to it. Separately, keep the VIP WebView mounted and visible during external loads and overlay only an accessible slim progress indicator; broker loading remains unchanged.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, react-native-webview 13.15.0, Node 22 `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-30-cabohealth-external-webview-subframe-design.md`

## Global Constraints

- Allow `about:blank` only for `isTopFrame === false` with a safe same-origin HTTPS `mainDocumentURL`.
- Missing frame metadata fails closed; top-frame unsafe or cross-origin navigation still shows the generic error.
- Rejected subframes are cancelled silently; popups still cancel and show the generic error.
- Public and VIP external WebViews must share the exact request classifier.
- Preserve incognito/cache/cookie, mixed-content, file, media, geolocation, bridge, browser/share, refresh-before-launch, App-Bound Domain, and AASA boundaries.
- Do not alter build 8 release attestations, provider state, Apple state, catalog records, or App Review in this plan.
- Follow strict RED-GREEN TDD and commit each reviewed task independently.

---

### Task 1: Request-aware external navigation policy

**Files:**
- Modify: `features/launch/externalHttpsNavigationPolicy.ts`
- Modify: `features/launch/ExternalHttpsWebView.tsx`
- Modify: `features/clientAccess/ClientResourceWebView.tsx`
- Modify: `tests/external-miniapp-navigation.test.mjs`
- Modify: `tests/client-resource-webview.test.mjs`

**Interfaces:**
- Consumes: `ShouldStartLoadRequest.url`, `ShouldStartLoadRequest.isTopFrame`, and `ShouldStartLoadRequest.mainDocumentURL` from react-native-webview 13.15.0.
- Produces: `classifyExternalHttpsNavigationRequest(request, expectedOrigin)` and a decision whose rejected requests explicitly carry `presentation: 'error' | 'silent'`.

- [ ] **Step 1: Write the failing pure-policy regression**

Add literal cases proving that this exact request is allowed:

```js
{
  url: 'about:blank',
  isTopFrame: false,
  mainDocumentURL: 'https://profound-health.com/products/page/4/'
}
```

with expected origin `https://profound-health.com`. Add independent literal
cases proving top-frame blank, missing parent, cross-origin parent, and
cross-origin subframe remain blocked; only rejected top-frame requests carry
`presentation: 'error'`, while rejected subframes carry `presentation:
'silent'`.

- [ ] **Step 2: Run RED**

Run:

```bash
node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json
node --test --test-name-pattern='external WebView|blank|subframe' tests/external-miniapp-navigation.test.mjs tests/client-resource-webview.test.mjs
```

Expected: failure because `classifyExternalHttpsNavigationRequest` and frame-aware decisions do not exist.

- [ ] **Step 3: Add the patched-wrapper regression**

Drive `createOnShouldStartLoadWithRequest` with the real iOS-shaped
`about:blank` iframe event. Its application callback must call the new pure
classifier and decision applicator. Assert one application callback, native
decision `true`, and zero React Native `Linking` effects. Keep the existing
lookalike and unsafe top-frame cases blocked.

- [ ] **Step 4: Implement the minimal request-aware policy**

Use this public input shape:

```ts
export interface ExternalHttpsNavigationRequest {
  readonly url: string;
  readonly isTopFrame?: boolean;
  readonly mainDocumentURL?: string;
}
```

Safe same-origin HTTPS remains the first allow branch. The only non-HTTPS allow
branch is exact `about:blank` with `isTopFrame === false` and a parent accepted
by `isSafeSameOriginExternalNavigation`. All other rejects use
`presentation: request.isTopFrame === false ? 'silent' : 'error'`. The decision
applicator calls `showError` only for `presentation: 'error'`.

- [ ] **Step 5: Pass the complete request from both components**

Replace both URL-only calls with the new classifier using the untouched
`ShouldStartLoadRequest` object. Public and VIP components must share the same
decision applicator so silent subframe rejection cannot diverge. Popup handling
remains unchanged.

- [ ] **Step 6: Add component-level regression coverage**

Exercise the real decision path for the VIP external WebView: a safe inherited
blank iframe returns `true` and never renders the blocked-navigation state;
an unsafe top-frame request returns `false` and renders it. Add equivalent
coverage for the Public handler if its existing harness does not already drive
the shared applicator.

- [ ] **Step 7: Run GREEN and focused neighboring tests**

Run:

```bash
node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json
node --test --test-name-pattern='external WebView|blank|subframe|client WebView' tests/external-miniapp-navigation.test.mjs tests/client-resource-webview.test.mjs tests/client-resource-navigation.test.mjs
node --test tests/external-miniapp-navigation.test.mjs tests/client-resource-webview.test.mjs tests/client-resource-navigation.test.mjs
```

Expected: all selected tests pass with no warning or error output.

- [ ] **Step 8: Commit**

```bash
git add features/launch/externalHttpsNavigationPolicy.ts features/launch/ExternalHttpsWebView.tsx features/clientAccess/ClientResourceWebView.tsx tests/external-miniapp-navigation.test.mjs tests/client-resource-webview.test.mjs
git commit -m "fix: allow safe inherited WebView subframes"
```

### Task 2: Nonblocking VIP external loading progress

**Files:**
- Modify: `features/clientAccess/ClientResourceWebView.tsx`
- Modify: `tests/client-resource-webview.test.mjs`
- Modify: `docs/operations/ios-protected-resource-scope.md`
- Modify: `docs/operations/dynamic-miniapp-catalog.md`

**Interfaces:**
- Consumes: the Task 1 request-aware external WebView and the existing `launch.kind` discriminant.
- Produces: accessible progressbar state for `external_https`; unchanged blocking loader for `broker`.

- [ ] **Step 1: Write the failing render regression**

For an `external_https` launch, assert the initial rendered tree contains a
`progressbar` with label `clientAccess.openingResource`, value 0, and no opaque
loading text overlay. Trigger `onLoadProgress` with progress `0.42`, rerender,
and assert value 42. Trigger `onLoadEnd`, rerender, and assert the progressbar
is absent. Separately assert a broker launch still renders the existing
ActivityIndicator and `clientAccess.openingResource` overlay.

- [ ] **Step 2: Run RED**

Run:

```bash
node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json
node --test --test-name-pattern='external VIP loading|broker loading' tests/client-resource-webview.test.mjs
```

Expected: failure because the external WebView still uses the opaque loader and
has no progress state.

- [ ] **Step 3: Implement the minimal progress UI**

Track progress from 0 through 1 with `onLoadStart`, `onLoadProgress`, and
`onLoadEnd`. Render a three-point-high progress track only while an external
launch is loading without an error. Give it `accessibilityRole="progressbar"`,
the existing opening-resource label, and a 0–100 numeric value. Render the
existing full blocking loader only for `launch.kind !== 'external_https'`.

- [ ] **Step 4: Preserve the authorization and privacy path**

Do not change `requestClientResourceRouteLaunch`, refresh ordering,
`cacheEnabled:false`, `incognito:true`, cookie settings, or WebView security
props. The observed refresh-before-launch latency is a required authorization
boundary, not a spinner optimization.

- [ ] **Step 5: Update operations documentation**

Document the frame-aware blank-subframe exception, silent rejected-subframe
handling, unchanged top-frame/popup blocks, and the nonblocking VIP progress
indicator. Explicitly state that no browser handoff or privacy relaxation was
introduced.

- [ ] **Step 6: Run GREEN and complete source gates**

Run:

```bash
node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json
node --test --test-name-pattern='external VIP loading|broker loading|external WebView|blank|subframe' tests/external-miniapp-navigation.test.mjs tests/client-resource-webview.test.mjs
npm run typecheck
npm run lint
npm test
npm run test:scope
```

Expected: every command exits 0 with no newly introduced warning or error.

- [ ] **Step 7: Commit**

```bash
git add features/clientAccess/ClientResourceWebView.tsx tests/client-resource-webview.test.mjs docs/operations/ios-protected-resource-scope.md docs/operations/dynamic-miniapp-catalog.md
git commit -m "fix: show external VIP loading progress"
```

### Task 3: Align release-guard regressions with immutable build-8 authority

**Files:**
- Modify: `tests/release-command-guard.test.mjs`

**Interfaces:**
- Consumes: the existing build-8 input/artifact attestations and their pinned
  hashes, plus the changed source tree produced by Tasks 1 and 2.
- Produces: current-state regression coverage proving build 7 remains immutable,
  build 8 remains pinned, and changed source fails closed before any EAS call.

- [ ] **Step 1: Capture the existing RED state**

Run:

```bash
node --test --test-name-pattern='build-7 attestations remain immutable|production build 8 command fails closed' tests/release-command-guard.test.mjs
```

Expected: the two legacy snapshot tests fail because they still expect absent
build-8 authority even though build 8 was already attested and uploaded.

- [ ] **Step 2: Replace only the stale expectations**

Keep the production guard and every attestation byte unchanged. Update the
first regression to assert the exact pinned build-8 input/artifact hashes,
their matching files and linkage, null RC/EAS/adapter pins, preserved build-7
history, and a source-digest mismatch after the WebView commits. Expect input
and artifact verification to fail with `EXACT_*_ATTESTATION_INVALID`; RC still
fails with `EXACT_RC_ATTESTATION_MISSING`.

Update the production-build regression to expect
`EXACT_BUILD_INPUT_ATTESTATION_INVALID` with empty stdout, proving execution
stops before EAS. Do not make old build-8 authority valid for changed source.

- [ ] **Step 3: Run GREEN and full source gates**

Run:

```bash
node --test --test-name-pattern='build-7 attestations remain immutable|production build command fails closed' tests/release-command-guard.test.mjs
npm run typecheck
npm run lint
npm test
npm run test:scope
```

Expected: every command exits 0; no release guard, attestation, provider, EAS,
TestFlight, or Apple state is modified.

- [ ] **Step 4: Commit**

```bash
git add tests/release-command-guard.test.mjs
git commit -m "test: align release guard expectations with build 8 authority"
```

### Task 4: Build-9 source readiness evidence

**Files:**
- Create: `docs/operations/external-webview-build9-readiness.md`
- Test: existing full source and scope gates only

**Interfaces:**
- Consumes: reviewed Task 1 through Task 3 commits and their test evidence.
- Produces: a source-only handoff that a separate build-9 release rebaseline can bind without reusing build-8 authority.

- [ ] **Step 1: Reconcile the real-destination reproduction**

Bind the source-readiness record to the already captured non-sensitive facts in
the spec: the target stayed on the same HTTPS origin, loaded successfully, and
exposed one `about:blank` iframe. Confirm the automated regression uses the
same request shape. Do not repeat a live network request or copy page content,
cookies, storage, account data, query data, or browser history.

- [ ] **Step 2: Verify exact branch state**

Run:

```bash
git status --short
git log --oneline --decorate -5
npm run typecheck
npm run lint
npm test
npm run test:scope
```

Expected: clean tracked tree and every gate exits 0.

- [ ] **Step 3: Write the source-readiness record**

Record the base build-8 commit, the reviewed fix and regression commits, exact test
commands/results, preserved security boundaries, and a prominent statement
that no build number, EAS build, TestFlight upload, Apple state, or build-9
attestation exists yet.

- [ ] **Step 4: Commit**

```bash
git add docs/operations/external-webview-build9-readiness.md
git commit -m "docs: record external WebView build 9 readiness"
```
