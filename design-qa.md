# CaboHealth premium miniapps — design QA

## Result

- The browser-verifiable premium surfaces have no actionable P0, P1, or P2 visual differences remaining.
- Final integrated iOS approval is **blocked on one manual gate**: open both premium miniapps from the native catalog on a real iPhone (Expo Go or TestFlight), confirm the native top bar and hosted hero compose without duplicated chrome, and verify the bottom safe area above the home indicator. Expo web renders the real native top bar but cannot render `react-native-webview`, so this document does not claim an integrated WKWebView pass.

## Artifact under review

- Capsule size: `719595` bytes.
- Capsule SHA-256: `2c839893cca416fdd471fef037bdfb8fc099960d9855e9d7b47981b13892602b`.
- Frozen inventory: exactly two slugs, 16 public release files/paths, and six shared miniapp assets.
- The browser screenshots below were recaptured after rebuilding and repinning this capsule; none of the prior `cabohealth-miniapps-qa` screenshots is accepted as current evidence.

## Source visual truth

- Services reference: `/Users/ivan/Dropbox/Ai/IOS Cabo Health App/.playwright-cli/element-2026-08-17T16-38-35-004Z.png`
- Plan Your Visit reference: `/Users/ivan/Dropbox/Ai/IOS Cabo Health App/.playwright-cli/element-2026-08-17T16-38-36-115Z.png`
- Reference pixels: 368 × 691 each.

## Current visual evidence

All mobile captures use a 368 × 691 CSS-pixel viewport.

### Clinic Guide embedded presentation

- English Explore: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-embedded-explore-en-368x691.png`
- English Visit: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-embedded-visit-en-368x691.png`
- English Contact: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-embedded-contact-en-368x691.png`
- `es-MX` Explore with forced reduced effects: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-embedded-explore-es-MX-reduced-368x691.png`
- `es-MX` Visit with forced reduced effects: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-embedded-visit-es-MX-reduced-368x691.png`
- `es-MX` Visit full scroll, including the localized footer: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-embedded-visit-es-MX-reduced-full.png`
- Checklist reset live confirmation: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-embedded-reset-es-MX-reduced-368x691.png`

### Healthy Recipes embedded presentation

- English default: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/recipes-embedded-en-368x691.png`
- English recipe detail expanded: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/recipes-embedded-en-detail-368x691.png`
- English Lunch filter, six matching recipes: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/recipes-embedded-en-filter-lunch-368x691.png`
- `es-MX` default with forced reduced effects: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/recipes-embedded-es-MX-reduced-368x691.png`
- `es-MX` full scroll, including sources and localized footer: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/recipes-embedded-es-MX-reduced-full.png`

### Fail-safe and wrapper evidence

- JavaScript-disabled standalone fallback: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-no-js-standalone-368x691.png`
- Prototype-shaped `#constructor` fragment fails to standalone presentation: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/clinic-unknown-fragment-fail-standalone-368x691.png`
- Actual Expo-web wrapper, English standard preference: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/native-wrapper-expo-web-unsupported-mobile-368x691.png`
- Actual Expo-web wrapper, `es-MX` plus native reduced-effects preference: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/native-wrapper-expo-web-es-MX-reduced-unsupported-368x691.png`

The two Expo-web wrapper captures intentionally show `React Native WebView does not support this platform.` They prove the real native wrapper renders one top bar with Back, title, Save, and Share and no bottom browser toolbar; they do **not** prove hosted content composition inside WKWebView.

## Normalized side-by-side comparison

- Services reference ↔ Clinic Guide Explore: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/comparison-services-ref-vs-embedded-explore.png`
- Plan Your Visit reference ↔ Clinic Guide Visit: `/Users/ivan/.codex/visualizations/2026/08/16/01a00a52-06e3-7512-b043-39c7fb3aee86/cabohealth-miniapps-qa-reviewer-fixes/comparison-visit-ref-vs-embedded-visit.png`
- Each composite is 736 × 691 with the 368 × 691 reference on the left and the current embedded implementation on the right. No density normalization or image resampling was used.

## Fidelity and behavior findings

- The implementation preserves the approved pale network field, warm paper surface, deep navy actions, restrained bronze accents, serif display hierarchy, compact white cards, and floating three-state Clinic navigation.
- Embedded mode removes only the duplicate HTML logo/language row. It preserves the premium network hero, title, eyebrow, copy, and motion control while the native wrapper owns Back, localized title, Save, and Share.
- Clinic Explore, Visit, and Contact remain states inside one `clinic-guide` miniapp; no third slug or additional app was introduced.
- The map slot uses the reviewed neutral raster texture. It contains no fabricated labels, names, pins, or geographic claims. Apple Maps and WhatsApp remain ordinary, explicit external links.
- English and `es-MX` expose exactly one selected locale with matching visible copy and accessible names. Full-scroll Spanish evidence confirms the footer and editorial/source explanations do not leak English process copy.
- Forced reduced effects disable animated transitions and smooth panel scrolling; the motion control reports a static composition. The OS setting, native override, Save-Data policy, and user pause remain conservative inputs.
- No-JavaScript mode keeps meaningful bilingual content visible and disables language buttons, Clinic rows/tabs/reset, checklist controls, and other JavaScript-dependent controls rather than leaving them inert.
- Checklist reset is visible, at least 44 px high, idempotent, and announces completion through a live status. Automated tests bind it to the Clinic checklist key only.
- Small bronze and muted-text pairs were replaced with AA-capable text tokens. Exact contrast tests cover eyebrow, inactive tabs, recipe metadata on mist, and hero copy on the gradient start.
- Browser console review found no application-script stack error. The selected external browser injected wallet/share extensions that emitted unrelated extension errors and one message-channel warning; those messages are not generated by the reviewed capsule.

## Verification gates

- `node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json`: passed.
- `node --test tests/*.test.mjs`: 594 passed, 0 failed.
- The suite includes the exact four-fragment matrix, malformed/prototype-shaped fragment rejection, canonical fragment-free sharing, CSP/no-bridge guarantees, native language/reduced-effects propagation, selected-locale visibility, no-JavaScript controls, contrast, reset scope, builder pins, capsule digest, production verifier mutations, and final legal hashes.
- Deployment, Hostinger, App Store Connect, dependency installation, lint, and package changes were outside this QA and were not performed.

## Manual iPhone gate

Before release approval, on a real iPhone:

1. Select English and standard effects, open each miniapp, and confirm one native top bar plus the preserved HTML hero.
2. Select `Español (México)` and Reduce Effects in native Settings, reopen each miniapp, and confirm Spanish content and static motion without a second language tap.
3. Verify the Clinic sticky tab bar and both footers remain above the home indicator at the longest scroll position.
4. Exercise Back, Save, Share, Retry, recipe detail/filter, all three Clinic states, and checklist reset.
5. Confirm Share emits the canonical URL without a fragment and no bottom WebView toolbar appears.

final result: blocked
