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

## Native Home and unified-surfaces QA — 2026-08-20

### Source and normalization

- Approved Home visual truth: `/Users/ivan/.codex/generated_images/01a00a52-06e3-7512-b043-39c7fb3aee86/exec-88f5b333-ecd8-4fba-bdb3-2c2a6a3ce783.png`.
- Source pixels: 853 × 1844. The source was normalized with Lanczos resampling to 390 × 844 so it could be compared at the same dimensions as the implementation.
- Browser-rendered implementation: `/Users/ivan/Dropbox/Ai/IOS Cabo Health App/webapp-launcher/.worktrees/cabohealth-premium-miniapps/.superpowers/qa/native-unified/home-approved-final-390x844.png`.
- Full-view side-by-side comparison: `/Users/ivan/Dropbox/Ai/IOS Cabo Health App/webapp-launcher/.worktrees/cabohealth-premium-miniapps/.superpowers/qa/native-unified/home-final-comparison.png`.
- CSS viewport: 390 × 844. Browser screenshot pixels: 390 × 844. No device frame or browser chrome was included.
- State: light theme, English, no favorites, online catalog, Home selected.

### Additional rendered evidence

- Saved empty: `.superpowers/qa/native-unified/saved-390x844.png`.
- Saved with a real reviewed resource: `.superpowers/qa/native-unified/saved-unified-390x844.png`.
- Settings: `.superpowers/qa/native-unified/settings-390x844.png`.
- Home in `es-MX`: `.superpowers/qa/native-unified/home-es-390x844.png`.
- Optional dark theme after contrast correction: `.superpowers/qa/native-unified/home-dark-es-fixed-390x844.png`.
- Narrow 320 × 568 initial state and scrolled tools state: `.superpowers/qa/native-unified/home-320x568.png` and `.superpowers/qa/native-unified/home-320x568-scrolled.png`.

### Comparison history

1. First native pass found three actionable differences.
   - P1 color continuity: a device using system dark mode moved from the approved light intro into a dark Home on first launch. The first-launch theme now defaults to the approved light palette; Dark and System remain explicit Settings choices.
   - P2 Home density: the logo, resource rows, tools, and vertical spacing did not align with the selected composition. The repeated Welcome/Explore hero was removed, the logo was centered and reduced, the exact two-resource/two-tool grouping was adopted, copy was shortened in both locales, and the rich molecular field was retained.
   - P2 Saved inconsistency: Saved still rendered the retired narrow editorial card with severe wrapping. Saved now reuses the same compact resource-row component and visual surface as Home while retaining the complete VoiceOver editorial narration.
2. Post-fix comparison at 390 × 844 found no remaining P0/P1/P2 difference for the native Home or the unified color system.

### Required fidelity surfaces

- Fonts and typography: the centered wordmark uses the real CaboHealth asset; section labels retain the tracked uppercase hierarchy; resource/tool text stays readable at mobile sizes; Settings, Saved, and local utility headings retain Georgia as the shared display face. English and `es-MX` wrapping were inspected.
- Spacing and layout rhythm: the final resource and tool groups align with the normalized source composition. Cards use the same 17 px radius, border, glass fill, row height, and horizontal margins. A 320 × 568 viewport remains scrollable and keeps the bottom navigation persistent.
- Colors and visual tokens: Intro is the authority: ink `#082A3C`, sea `#0E5876`, paper `#FBFAF7`, bronze `#B8956A`, soft `#4F7785`, and the exact intro gradient. Home, Saved, Settings, Recipes, Visit Checklist, not-found, native miniapp chrome, and hosted miniapps now use this family. The optional dark mode uses ink/sea/paper/bronze derivatives and its icons were rechecked for contrast.
- Image quality and asset fidelity: the source CaboHealth wordmark is reused directly; no replacement logo, placeholder image, emoji, handcrafted SVG logo, or generated substitute was introduced. The moving molecular network remains the existing accessible, Reduce-Motion-aware app artwork and is denser only on Home.
- Copy and content: the visible Home copy is concise, bilingual, and makes no new clinic, medical, location, or service claim. Complete editorial facts remain in each resource's accessible narration.
- Icons and behavior: Ionicons remain one consistent outline family. Home, Saved, Settings, local checklist navigation, Save/Remove Saved, English/Spanish, Light/Dark, and small-screen scrolling were exercised. The browser console contained no application errors; only expected React Native Web compatibility/deprecation warnings were present.

### Focused-region decision

Separate full-size captures of Home, Saved with real content, Settings, Spanish, dark mode, and the 320 px breakpoint made the important type, icon, state, and contrast details readable. No additional crop was necessary.

### Native result

The native Home and shared-surface palette have `passed`: no actionable P0/P1/P2 finding remains in the browser-rendered native surfaces. The overall release remains blocked only by the pre-existing real-iPhone WKWebView/safe-area gate documented above.

- Final repository suite after the native unification: 621 passed, 0 failed.
- App TypeScript check and minimal-public-v1 scope verifier: passed.

final result: blocked
