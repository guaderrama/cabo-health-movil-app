# CaboHealth Minimal Public v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modificar la app Expo existente para publicar una v1 mínima y defendible ante Apple con la portada A4 aprobada, exactamente dos miniapps públicas, navegación segura, contenido bilingüe y cero acceso de clientes o administración dentro del binario.

**Architecture:** Se conserva el proyecto, bundle ID, App Store record, Expo Router, tema, tarjetas, favoritos, WebView y assets actuales. El catálogo Firestore se sustituye por un manifiesto local inmutable de dos entradas. La misma política pura resuelve taps y Universal Links antes de montar un WebView sin puente nativo. Las dos miniapps comparten una base estática HTML/CSS/JS desplegada bajo `cabohealth.org/apps/`; no requieren backend, cuenta ni nuevas dependencias.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, Expo Router 6, TypeScript 5.9, AsyncStorage, React Native WebView, React Native SVG/Animated, HTML5, CSS, JavaScript, Canvas, Node 22 `node:test`, Hostinger/WordPress y EAS/App Store Connect.

**Canonical specification:** `docs/superpowers/specs/2026-08-16-cabohealth-minimal-public-v1.md`

## Global constraints

- Trabajar únicamente en el repositorio y app existentes. No crear otro proyecto Expo, bundle ID, App Store record ni proyecto EAS.
- Conservar `com.cabohealth.app`, slug `cabohealth`, owner/project ID EAS, iconografía y dirección visual A4.
- El alcance de v1 contiene solamente `healthy-recipes` y `clinic-guide`. Cualquier tercer slug falla pruebas y release verification.
- No incluir rutas dormantes de auth/admin, código de cliente, biometría, login, IAP, PHI, IA, analytics, permisos sensibles ni feature flags de módulos.
- No reintroducir Firestore como fuente del catálogo. Las altas futuras se hacen por cambio versionado y nueva revisión.
- No introducir `onMessage`, `injectedJavaScript`, puente nativo, URL arbitraria, mixed content, file access o código nativo remoto.
- No tocar ni incluir el cambio CRLF preexistente de `babel.config.js` del checkout original.
- No agregar dependencias de runtime. La red del entorno de ejecución no resuelve npm; usar las dependencias fijadas existentes y Node built-in tests. Task 9 puede fijar únicamente herramientas de release como devDependencies cuando exista red y se regenere/verifique el lockfile.
- En el worktree local, enlazar `node_modules -> ../../node_modules` sólo como setup ignorado. Invocar CLIs mediante `node node_modules/<package>/...` porque los wrappers `.bin` no tienen bit ejecutable.
- Escribir primero la prueba que falla, confirmar el fallo esperado, implementar lo mínimo, confirmar el pase y hacer commit por tarea.
- Ningún secreto, credential, PIN, código, cookie, dato de paciente o captura de hPanel/App Store se committea.
- No desplegar ni enviar a Review hasta que todos los gates de contenido, PHI, legal, hosting, accesibilidad y RC estén verdes.

## Canonical release scope

```ts
export type PublicMiniappSlug = 'healthy-recipes' | 'clinic-guide';

export interface PublicMiniapp {
  slug: PublicMiniappSlug;
  title: { en: string; es: string };
  summary: { en: string; es: string };
  canonicalUrl: `https://cabohealth.org/apps/${PublicMiniappSlug}/`;
  universalLink: `https://cabohealth.org/apps/${PublicMiniappSlug}/`;
  allowedPathPrefix: `/apps/${PublicMiniappSlug}/`;
  access: 'public';
  contentDescriptors: ['health-and-wellness-information'];
  appStoreAgeRating: number | null;
  dataUse: ['technical-request-logs'];
  permissions: [];
  hasUserGeneratedContent: false;
  hasPurchases: false;
  editorialSource: string;
  reviewedOn: string;
  contentVersion: string;
}
```

The source file contains exactly two frozen objects and exports `PUBLIC_MINIAPP_SLUGS` as `['healthy-recipes', 'clinic-guide'] as const`. `appStoreAgeRating` remains `null` during development and becomes the owner-verified value calculated by the current App Store Connect questionnaire before the release freeze; production verification rejects `null` or a miniapp rating above the host rating.

## Motion brief

```text
Purpose: establish CaboHealth identity and orient first-time users.
Frequency and input modality: rare/first installation; touch CTA, automatic continuation.
Motion voice: serene, expressive, never clinical or urgent.
Trigger: first visible intro frame.
Target and changed properties: local wordmark opacity/translate; one molecular ambient layer transform/opacity.
Start and end state: content is usable immediately; stable A4 composition at completion.
Timing, easing, and origin: CTA immediate; auto-continue at 1600 ms; logo <=700 ms cubic-bezier(.2,.8,.2,1); card feedback 100–160 ms.
Interruption and reversal: CTA cancels timer; newest navigation wins; no queued entrance.
Reduced-motion replacement: complete static composition and immediate CTA; no ambient loop or forced wait.
Start, pause, readiness, and stop conditions: start only while focused/active; pause in background/offscreen; stop for OS/user reduced motion.
Cleanup owner: IntroScreen and MolecularBackground stop timers/Animated loops/listeners on blur and unmount.
```

Web miniapps use CSS for controls and a single Canvas ambient layer only where the A4 visual requires procedural nodes. Canvas is capped at DPR 1.5 and approximately 30 fps, pauses for `visibilitychange`, offscreen, `prefers-reduced-motion`, `Save-Data` or explicit pause, and releases its frame/observer/listener handles on teardown.

---

## Task 1: Freeze the two-module contract and restore executable local checks

**Files:**

- Modify: `package.json`
- Modify: `.gitignore`
- Create: `constants/publicMiniapps.ts`
- Create: `tests/release-scope.test.mjs`
- Create: `tests/catalog-contract.test.mjs`
- Create: `scripts/verify-minimal-v1.mjs`
- Create: `tsconfig.node-tests.json`
- Create: `.easignore`

- [ ] **Step 1: Create the ignored dependency link for this worktree**

From the worktree root, verify the target first and then create the ignored link:

```bash
test -f ../../node_modules/typescript/bin/tsc
test -f ../../node_modules/expo/bin/cli
test -L node_modules || ln -s ../../node_modules node_modules
```

Do not commit the link.

- [ ] **Step 2: Write the failing catalog contract test**

`tests/catalog-contract.test.mjs` imports the compiled real module from `.test-build` and asserts:

- exactly two entries and the two literal expected slugs occur in the canonical list;
- their URLs are the exact canonical HTTPS URLs;
- both entries are public, declare the health/wellness descriptor and only technical request logs, no permissions, no UGC and no purchases;
- forbidden legacy slugs and `.com` legal URLs do not occur.

Run:

```bash
node node_modules/typescript/bin/tsc -p tsconfig.node-tests.json
node --test tests/catalog-contract.test.mjs
```

Expected: first compile fails because the wished-for module does not exist. Add only an empty typed export/stub, rerun, and observe the test fail on the literal expected two-entry behavior before implementing it.

- [ ] **Step 3: Add the minimal typed contract**

Create `constants/publicMiniapps.ts` with the canonical interface/list above, localized titles/summaries, `https://cabohealth.org` legal URLs, source/review metadata and a `getPublicMiniapp(slug: string)` guard. Keep the development age-rating value null until the questionnaire gate. Do not read environment variables or remote state.

- [ ] **Step 4: Add release verification and direct-node scripts**

`scripts/verify-minimal-v1.mjs` must fail on:

- any route below `app/(auth)` or `app/(main)/admin.tsx`;
- any third slug in catalog/AASA/release metadata;
- reachable imports of access-code, biometry, Firebase or Firestore from `app/`, `components/`, `context/`, `hooks/` or `features/`;
- `onMessage`, `injectedJavaScript`, arbitrary `EXPO_PUBLIC_*URL`, `http://` production URLs or forbidden schemes;
- missing Privacy, Terms, Support or Report Content URLs.

Add scripts using direct Node entrypoints:

```json
{
  "test": "node --test tests/*.test.mjs",
  "test:scope": "node scripts/verify-minimal-v1.mjs",
  "typecheck": "node node_modules/typescript/bin/tsc --noEmit",
  "expo:config": "node node_modules/expo/bin/cli config --type public --json"
}
```

Do not change dependency versions in this task.

- [ ] **Step 5: Keep EAS uploads narrow**

`.easignore` starts from `.gitignore` semantics and excludes docs, prototypes, tests, old Firebase seed scripts, local worktrees, screenshots-in-progress and private operational notes. It must not exclude `miniapps` release metadata used by verification, app assets, AASA source or production configuration.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/catalog-contract.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/expo/bin/cli config --type public --json >/tmp/cabohealth-expo-config.json
git status --short
git add package.json .gitignore .easignore constants/publicMiniapps.ts tests scripts/verify-minimal-v1.mjs tsconfig.node-tests.json
git commit -m "test: freeze minimal public release scope"
```

Do not run `test:scope` yet; its expected route-removal conditions are implemented in Task 2.

---

## Task 2: Remove legacy gates and switch the existing app to the local catalog

**Files:**

- Delete: `app/(auth)/_layout.tsx`
- Delete: `app/(auth)/access-code.tsx`
- Delete: `app/(auth)/biometry.tsx`
- Delete: `app/(auth)/code-expired.tsx`
- Delete: `app/(main)/admin.tsx`
- Delete: `hooks/useAccessCode.ts`
- Delete: `hooks/useBiometry.ts`
- Delete: `services/accessCode.ts`
- Create: `features/migrations/removeLegacyPrivateState.ts`
- Create: `tests/legacy-state-migration.test.mjs`
- Modify: `app/index.tsx`
- Modify: `app/_layout.tsx`
- Modify: `app/(main)/_layout.tsx`
- Modify: `app/(main)/index.tsx`
- Modify: `app/(main)/settings.tsx`
- Modify: `hooks/useWebApps.ts`
- Modify: `hooks/index.ts`
- Modify: `services/index.ts`
- Modify: `services/storage.ts`
- Modify: `constants/config.ts`
- Modify: `types/index.ts`
- Modify: `app.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/release-scope.test.mjs`

- [ ] **Step 1: Write the failing legacy-removal test**

Assert against the actual Expo route file inventory and public config that auth/admin routes are absent and no Face ID permission or local-auth plugin is configured. Compile/import the wished-for migration and assert with an in-memory storage adapter that it removes the literal legacy private/cache keys, preserves allowed preferences, filters favorites to two slugs and is idempotent. Run:

```bash
node --test tests/release-scope.test.mjs
```

Expected: FAIL on existing routes/config/imports.

- [ ] **Step 2: Remove routes and reachability, preserving Git history**

Delete only the listed route/hook/service files. Replace the root auth gate temporarily with a direct `<Redirect href="/(main)" />`; Task 3 supplies the final A4 entry. Simplify `(main)/_layout.tsx` to presentation/navigation only.

Before providers render on an upgrade, run a tested one-time migration that removes these exact legacy keys without ever reading/logging their values:

```text
@cabohealth_access_code
@cabohealth_client_name
@cabohealth_biometry_enabled
@cabohealth_last_background_time
@cabohealth_cached_apps
@cabohealth_last_sync
```

It preserves theme/language/haptics/onboarding and filters `@cabohealth_favorites` to the two canonical slugs. Store only a public-v1 migration marker. Re-running must be harmless.

Prune barrels, types, config keys and storage helpers for access code, client name, biometry, cached Firestore catalog and background lock. Keep theme, favorites, haptics and onboarding storage.

Remove Face ID usage and local-auth plugin from `app.json`, remove `expo-local-authentication` from `package.json`, and regenerate `package-lock.json` using the locked/offline package metadata (`npm install --package-lock-only --ignore-scripts --offline`). Verify Expo autolinking/export does not contain `ExpoLocalAuthentication`; if offline lock regeneration cannot complete, stop this task rather than hand-wave a mismatched lockfile.

- [ ] **Step 3: Reuse `useWebApps` as a compatibility adapter**

Replace its Firebase subscription/caching implementation with a synchronous adapter over `PUBLIC_MINIAPPS`. Preserve the return shape needed by the existing home and WebView while removing refresh timers, Firestore imports and cached remote data. The `refresh` function resolves immediately and `isOffline` reflects network only for web content, not catalog availability.

Do not edit or deploy Firestore rules in this task; old installed builds may still depend on them. Record their closure as a post-migration security action.

- [ ] **Step 4: Make existing screens compile with the public scope**

Keep the current home, Settings, AppCard, favorites and WebView structure compiling. Remove secret Settings gesture, code/account/biometry sections and logout. Point Support/Privacy/Terms to `.org`. Do not perform final visual/navigation work yet.

- [ ] **Step 5: Verify absence and commit**

```bash
npm run test
npm run test:scope
npm run typecheck
npm run expo:config >/tmp/cabohealth-expo-config.json
! rg -n "CABO-ADMIN|adminTap|access.?code|biometr|firebase|firestore" app components context hooks
git add app package.json package-lock.json hooks services constants types features/migrations tests/release-scope.test.mjs tests/legacy-state-migration.test.mjs
git diff --cached --name-only
git commit -m "refactor: remove legacy access from public v1"
```

---

## Task 3: Adapt the approved A4 cover and make motion lifecycle-safe

**Files:**

- Create: `features/onboarding/introTiming.ts`
- Create: `features/onboarding/onboardingStore.ts`
- Create: `features/onboarding/IntroScreen.tsx`
- Create: `hooks/useReducedMotion.ts`
- Modify: `app/index.tsx`
- Modify: `components/AnimatedMolecules.tsx`
- Modify: `components/index.ts`
- Modify: `constants/colors.ts`
- Modify: `constants/layout.ts`
- Modify: `services/storage.ts`
- Modify: `tests/release-scope.test.mjs`
- Create: `tests/intro-policy.test.mjs`

- [ ] **Step 1: Read the motion implementation reference before editing**

Read completely:

```text
/Users/ivan/.codex/skills/direct-purposeful-web-motion/references/implementation-patterns.md
```

Use the Motion brief at the top of this plan. Do not add an animation library.

- [ ] **Step 2: Write the failing intro-policy test**

Compile `features/onboarding/introTiming.ts` with `tsconfig.node-tests.json`, then assert:

- normal automatic continuation is exactly 1600 ms and below 1800 ms;
- reduced motion has no forced delay;
- a CTA completion is idempotent and cancels the timer path;
- persisted completion is a boolean under a single onboarding key.

Expected first run: FAIL because the feature files do not exist.

- [ ] **Step 3: Implement A4 by adapting existing pieces**

`IntroScreen` reuses `assets/logo.png`, tinted CaboHealth ink, `AnimatedMolecules`, `LinearGradient`, current safe-area/theme infrastructure and the approved copy:

```text
PRECISION LONGEVITY MEDICINE
One thoughtful place to explore CaboHealth.
ENTER CABOHEALTH
```

Do not download or hotlink the prototype logo. Render the local wordmark near 18% from the top, preserve the approved spacing, and make the CTA at least 44 points tall with VoiceOver label/hint.

First use renders A4. CTA or timer records completion once and `router.replace('/(main)')`. Later launches redirect immediately. A replay query from Settings bypasses persisted completion without clearing favorites/theme.

- [ ] **Step 4: Repair the molecular animation instead of replacing it**

Adapt `AnimatedMolecules` to:

- use `useWindowDimensions` instead of module-level dimensions;
- accept `active` and `reduceMotion`;
- keep handles returned by `Animated.loop`, stop them during cleanup/background/blur, and restart only from a valid visible state;
- render a complete static network for reduced motion;
- avoid pulsing readable content and avoid multiple schedulers for the same property.

- [ ] **Step 5: Verify and commit**

```bash
npm run test
npm run test:scope
npm run typecheck
npm run expo:config >/tmp/cabohealth-expo-config.json
git add app/index.tsx components features/onboarding hooks/useReducedMotion.ts constants services tests tsconfig.node-tests.json
git commit -m "feat: adapt approved A4 intro"
```

Manual feel-check required later: normal speed, repeated replay, immediate CTA, VoiceOver and Reduce Motion on a simulator/device.

---

## Task 4: Finish the native catalog, Saved and Settings with the existing design system

**Files:**

- Create: `context/PreferencesContext.tsx`
- Create: `context/FavoritesContext.tsx`
- Create: `i18n/messages.ts`
- Create: `i18n/useTranslations.ts`
- Create: `app/(main)/saved.tsx`
- Create: `app/(main)/recipes.tsx`
- Create: `app/(main)/visit-checklist.tsx`
- Create: `components/BottomNavigation.tsx`
- Create: `components/EditorialMetadata.tsx`
- Create: `features/resources/publicContent.ts`
- Create: `features/resources/RecipeBrowser.tsx`
- Create: `features/resources/VisitChecklist.tsx`
- Create: `content/recipes.json`
- Create: `content/clinic-guide.json`
- Create: `release/public-contact-facts.json`
- Modify: `app/_layout.tsx`
- Modify: `app/(main)/_layout.tsx`
- Modify: `app/(main)/index.tsx`
- Modify: `app/(main)/settings.tsx`
- Modify: `components/AppCard.tsx`
- Modify: `components/WelcomeBanner.tsx`
- Modify: `hooks/useFavorites.ts`
- Modify: `hooks/index.ts`
- Modify: `services/storage.ts`
- Modify: `types/index.ts`
- Create: `tests/localization-contract.test.mjs`
- Create: `tests/native-utility.test.mjs`

- [ ] **Step 1: Freeze the non-legal public contact facts consumed by UI**

Before URL-policy or Clinic Guide implementation, verify the exact public email, phone/WhatsApp, address, hours, Apple Maps destination and languages from authenticated/current CaboHealth sources and owner confirmation. Record values, source URLs and `ownerConfirmedAt` in `release/public-contact-facts.json`; never record private credentials. If any exact value is unknown, pause the dependent contact/map action rather than inventing it. Task 7 later performs legal/privacy sign-off on this already frozen record.

- [ ] **Step 2: Write failing native experience contracts**

Tests assert:

- every user-facing catalog/Settings key exists in English and Spanish;
- both cards expose localized summary, source, review date, public state, content descriptor, technical-log disclosure and empty permission fields; the final numeric age label appears only after Task 7 freezes a non-null verified value;
- favorites reject unknown slugs and preserve only the canonical two;
- bottom navigation has exactly Apps, Saved and Settings;
- the bundled native resource model exposes real recipe search/filter/detail results and an idempotent visit-checklist state without network access.

- [ ] **Step 3: Share preferences and favorites instead of polling**

Wrap the existing `ThemeProvider` with small Preferences/Favorites providers. Reuse AsyncStorage keys for non-sensitive state. Remove the 30-second favorites polling and direct haptic calls that ignore preferences. Unknown/legacy favorite IDs are discarded on load.

Preferences cover English/Spanish, haptics and an explicit reduced-motion override combined with the OS setting. No device identifier or analytics is created.

- [ ] **Step 4: Adapt the existing home**

Keep its branded header, gradients, molecular art, grid/card components and error/offline components. Change copy and layout to the approved A4-derived catalog:

- local wordmark and `Explore CaboHealth` header;
- the two cards visible without scrolling on normal iPhone sizes where Dynamic Type permits;
- an explicit star/save control on every card, not long press;
- public badge and compact editorial metadata;
- no search or filters whose only purpose would be to mimic an app store for two items.

Below the two module cards, expose two substantive bundled/offline utilities tied to the same scope: “Browse recipes” and “Prepare for your visit.” They are native routes, not additional miniapps, and must work in airplane mode.

`content/recipes.json` and `content/clinic-guide.json` are the single canonical bilingual content sources shared later with the static builds. `RecipeBrowser` imports the canonical bundled content to browse, search, filter and read complete recipe details. `VisitChecklist` provides a reusable checklist for appointment confirmation, questions, identification/records the clinic specifically confirms as appropriate, accessibility/language needs and emergency limitations. Neither asks for symptoms, diagnosis, medication or other health data.

- [ ] **Step 5: Add Saved and finish Settings**

Saved lists canonical favorite modules and provides a clear empty state. Settings provides language, theme, haptics, Reduce Motion/reduced effects, Replay Introduction, Privacy, Terms, Support and Report Content. Use system `Linking` only for the exact legal/support URLs.

`BottomNavigation` is shared across the three screens, preserves safe area, supports VoiceOver selected state and uses 44-point targets. WebView screens do not show this bottom bar.

- [ ] **Step 6: Accessibility and layout pass**

Add labels, hints, roles and selected/checked states. Remove fixed text heights, support large Dynamic Type, maintain WCAG AA colors and keep decorative SVG/canvas hidden from accessibility.

Add a 4.2 acceptance check to the manual matrix: with network disabled, a reviewer can still browse/search recipe content, complete/reset the visit checklist and manage Saved. Hosted legal/support links show an honest offline state. Review Notes must identify native/offline utility separately from the two hosted HTML5 modules.

- [ ] **Step 7: Verify and commit**

```bash
npm run test
npm run test:scope
npm run typecheck
git add app components context hooks i18n services types tests features/resources content release/public-contact-facts.json
git diff --cached --name-only
git commit -m "feat: curate public CaboHealth catalog"
```

---

## Task 5: Restrict WebView navigation and add Universal Links

**Files:**

- Create: `features/launch/navigationPolicy.ts`
- Create: `features/launch/RestrictedWebView.tsx`
- Create: `constants/publicContacts.ts`
- Create: `app/apps/[slug].tsx`
- Create: `app/+not-found.tsx`
- Delete: `app/(main)/webview/[id].tsx`
- Delete: `app/(main)/webview/_layout.tsx`
- Modify: `app/(main)/index.tsx`
- Modify: `app/(main)/saved.tsx`
- Modify: `app.json`
- Modify: `tsconfig.node-tests.json`
- Create: `tests/navigation-policy.test.mjs`
- Create: `scripts/generate-aasa.mjs`
- Create: `scripts/verify-aasa.mjs`
- Create: `web-hosting/cabohealth.org/.well-known/apple-app-site-association`

**Consumes:** `release/public-contact-facts.json` from Task 4. `constants/publicContacts.ts` is a typed adapter over that frozen record; it must not duplicate or invent contact values.

- [ ] **Step 1: Write the failing URL-policy matrix**

Compile the pure policy and test at minimum:

| Request | Expected |
| --- | --- |
| canonical initial URL for selected slug | allow in WebView |
| same host + exact selected path prefix | allow in WebView |
| other approved miniapp path | block cross-module navigation |
| root domain, legacy app path or arbitrary cabohealth path | block |
| any subdomain, lookalike host, HTTP, `javascript:`, `data:`, `file:` | block |
| exact owner-approved `mailto:`/`tel:` values | open externally |
| exact owner-approved Apple Maps and WhatsApp contact URLs | open externally |
| any different recipient, phone, map query or WhatsApp number | block |
| popup/redirect to any other host | block |

Unknown slug always returns not found and never instantiates a WebView.

- [ ] **Step 2: Extract and harden the existing WebView**

Move reusable header, progress, retry, share and back/forward behavior into `RestrictedWebView`. Resolve the slug only from `getPublicMiniapp` and apply the policy in `onShouldStartLoadWithRequest`.

Required props/config:

```tsx
<WebView
  source={{ uri: miniapp.canonicalUrl }}
  originWhitelist={['https://cabohealth.org']}
  javaScriptEnabled
  domStorageEnabled
  mixedContentMode="never"
  allowFileAccess={false}
  allowUniversalAccessFromFileURLs={false}
  javaScriptCanOpenWindowsAutomatically={false}
  setSupportMultipleWindows={false}
  sharedCookiesEnabled={false}
  thirdPartyCookiesEnabled={false}
/>
```

Do not add `onMessage` or injected JavaScript. External allowlisted actions use `Linking.openURL`; failed/blocked requests produce an accessible message without leaking full query values into logs.

- [ ] **Step 3: Route taps and Universal Links through one screen**

All card/saved taps push `/apps/[slug]`. The same route handles `https://cabohealth.org/apps/<slug>/`. Delete the old arbitrary-ID WebView route.

Add `ios.associatedDomains: ["applinks:cabohealth.org"]` without changing bundle ID/team/project ID.

- [ ] **Step 4: Add exact AASA source**

Generate the App ID from the checked-in Apple team in `eas.json` plus `ios.bundleIdentifier` in `app.json`; for the current configuration this resolves to `DQ8PH2DZ3R.com.cabohealth.app`. Components contain only:

```json
{"/":"/apps/healthy-recipes/*"}
{"/":"/apps/clinic-guide/*"}
```

No broad wildcard, redirect, extra App ID or file extension. `scripts/verify-aasa.mjs` canonicalizes JSON and rejects any extra/missing detail, App ID or component.

- [ ] **Step 5: Verify and commit**

```bash
npm run test
npm run test:scope
npm run typecheck
npm run expo:config >/tmp/cabohealth-expo-config.json
node -e "const c=require('/tmp/cabohealth-expo-config.json'); if(!c.ios.associatedDomains.includes('applinks:cabohealth.org')) process.exit(1)"
git add app features/launch constants/publicContacts.ts app.json tsconfig.node-tests.json tests/navigation-policy.test.mjs scripts/generate-aasa.mjs scripts/verify-aasa.mjs web-hosting/cabohealth.org/.well-known/apple-app-site-association
git diff --cached --name-only
git commit -m "feat: restrict miniapp navigation"
```

---

## Task 6: Build the two public miniapps without a new framework

**Files:**

- Create: `miniapps/shared/styles.css`
- Create: `miniapps/shared/motion.js`
- Create: `miniapps/shared/shell.js`
- Create: `miniapps/shared/logo.png`
- Create: `miniapps/shared/security-headers.conf`
- Create: `web-hosting/cabohealth.org/apps/.htaccess`
- Create: `miniapps/healthy-recipes/index.html`
- Create: `miniapps/healthy-recipes/app.js`
- Create: `miniapps/clinic-guide/index.html`
- Create: `miniapps/clinic-guide/app.js`
- Create: `scripts/build-miniapps.mjs`
- Create: `scripts/serve-miniapps.mjs`
- Create: `tests/miniapps-content.test.mjs`
- Create: `tests/miniapps-build.test.mjs`
- Modify: `package.json`

**Consumes:** canonical `content/*.json` and `release/public-contact-facts.json` from Task 4. If the public fact record is incomplete or lacks owner confirmation, Clinic Guide build fails.

- [ ] **Step 1: Write failing content/build tests**

Assert:

- exactly two output roots and no third miniapp;
- both HTML documents have unique title, description, canonical URL, language control, main landmark, visible Privacy/Terms/Support/Report links and no remote script/font/analytics;
- generated HTML and hosting config enforce `default-src 'self'`, `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`, `form-action 'none'`, with explicit local-only script/style/image policies;
- shared CSS has focus-visible and reduced-motion branches;
- both canonical `content/*.json` files have English/Spanish parity and editorial timestamps;
- recipes contain at least twelve complete entries with ingredients, steps, time, servings, allergens and food-safety note;
- Clinic Guide contains visit preparation, accessibility, languages, contact, location, emergency guidance and source date, but no form fields for clinical/personal data;
- forbidden diagnosis, dosage, patient, tracking and purchase patterns fail verification.

- [ ] **Step 2: Implement a static, progressively enhanced shared shell**

Use semantic HTML and local assets. `scripts/build-miniapps.mjs` reads the canonical `content/*.json` and generates fully rendered bilingual HTML; the complete list/detail/checklist content remains usable with scripts disabled. JavaScript enhances search, filters, language switching and local favorites but is not responsible for first rendering canonical content. `shell.js` handles only language, local UI state and safe external-link labeling. It never receives data from native code.

Generate an equivalent CSP `<meta http-equiv>` and server-header configuration. Scan HTML, CSS and JavaScript for every `src`, `href`, CSS `url()`, `fetch`, XHR, EventSource, WebSocket, Worker, iframe and dynamic import target; only local static resources are permitted. Navigation allowlists do not substitute for this subresource boundary.

Copy/re-encode the existing licensed wordmark locally; no production hotlink.

- [ ] **Step 3: Implement Healthy Recipes**

Provide twelve original bilingual recipes spanning breakfast, lunch, dinner and snacks. Search/filter/detail/favorites use local data and localStorage. Dietary labels are descriptive, not medical recommendations. Every detail includes allergens and safe handling/storage where relevant.

- [ ] **Step 4: Implement Clinic Guide from confirmed public facts**

Use only facts verified against `https://cabohealth.org/` and the owner-approved contact record. Rewrite service summaries neutrally. Until exact address/hours are confirmed by the owner, the release gate remains red; do not invent them.

Map, phone, email and WhatsApp actions must match the native external allowlist. Include “call local emergency services” guidance without offering emergency care through the app.

- [ ] **Step 5: Implement purposeful motion**

`motion.js` owns one Canvas network per visible page, max DPR 1.5 and target ~30 fps. It honors `prefers-reduced-motion`, `Save-Data`, `document.visibilityState`, IntersectionObserver and a visible pause/resume control. It cancels RAF, observers, media listeners and resize listeners on teardown. No flashing/pulsing CTA.

- [ ] **Step 6: Build deterministic artifacts**

`scripts/build-miniapps.mjs` empties only the explicit ignored directory `miniapps/dist`, renders complete HTML from the canonical JSON, copies allowed local assets, writes SHA-256 inventory/release metadata and fails on unknown source roots or external script/resource URLs. Build tests parse the generated HTML with JavaScript disabled and verify the complete canonical content is present.

Add:

```json
{
  "miniapps:build": "node scripts/build-miniapps.mjs",
  "miniapps:serve": "node scripts/serve-miniapps.mjs",
  "miniapps:verify": "node --test tests/miniapps-content.test.mjs tests/miniapps-build.test.mjs"
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm run test
npm run miniapps:build
npm run miniapps:verify
npm run test:scope
git add miniapps package.json scripts tests
git commit -m "feat: add two public CaboHealth miniapps"
```

Do not commit `miniapps/dist` if it is ignored; commit its hash inventory in `release/` during Task 8.

---

## Task 7: Resolve release facts, create exact legal/support surfaces and close public-content risks

**Files:**

- Create: `web-hosting/cabohealth.org/app/privacy/index.html`
- Create: `web-hosting/cabohealth.org/app/terms/index.html`
- Create: `web-hosting/cabohealth.org/app/support/index.html`
- Create: `docs/operations/content-review-and-takedown.md`
- Create: `docs/operations/hosting-security-checklist.md`
- Create: `release/data-inventory.md`
- Create: `release/content-rights.md`
- Create: `release/compliance-facts.json`
- Modify: `constants/publicMiniapps.ts`
- Create: `tests/legal-content.test.mjs`

- [ ] **Step 1: Write failing legal consistency tests**

Tests compare app constants, miniapp links and hosted pages, and assert that all use the exact `.org/app/...` URLs. They fail on claims of access codes, biometrics, analytics, Keychain, patient data, iPad support, account deletion or other functions absent from v1.

- [ ] **Step 2: Write build-exact privacy/support content**

Privacy describes only:

- no account, health data, app-generated identifiers, analytics, ads or sensitive permissions;
- local favorites/preferences;
- WebKit delivery of the two public modules;
- Hostinger/WordPress technical logs, their confirmed retention and deletion process;
- contact/report process, children/age position and policy-change process.

Terms state educational/non-diagnostic scope, emergency limitation, acceptable use, IP/content rights, external contact services, availability and governing terms subject to owner/legal approval. Support includes real email/phone, response expectation, supported iOS version derived from the build and troubleshooting for both public modules.

- [ ] **Step 3: Document editorial/takedown controls**

Record pre-publication review, source/version owner, Report Content intake, severity/SLA, immediate unpublish/rollback, WAF/rate limit and audit record. State no UGC. Do not claim a control that has not been configured.

- [ ] **Step 4: Resolve exposed patient-document incident before release**

Using authenticated Hostinger access, first create and verify file + database backups. Inventory public uploads without copying PHI into the repository. Quarantine/remove every patient document from public web roots, disable directory indexing where applicable, invalidate CDN/cache and submit search-engine removal for known URLs. Preserve any legally required original only in an authorized private system.

This is a hard release gate. Do not name patients or commit incident evidence. If removal authority or retention obligations are unclear, stop and obtain owner/legal direction.

- [ ] **Step 5: Freeze owner/legal/compliance facts before deployment**

Confirm and record without secrets:

- public entity/seller is the legal healthcare provider required by guideline 5.1.1(ix), or Apple has provided written direction;
- exact public address, hours, email, phone/WhatsApp and support response time;
- Hostinger log types, retention and deletion behavior;
- rights to logo, recipe content/assets and clinic content;
- content rights, export compliance and medical-device answers;
- current App Store Connect age-rating questionnaire answers based on the final two-module content.

Record the calculated host rating and descriptors in `release/compliance-facts.json`, set both `appStoreAgeRating` values in `constants/publicMiniapps.ts`, and fail if either is null or exceeds the host rating. Do not copy the old 12+ rating. Obtain owner/legal sign-off for entity name, jurisdiction, privacy, retention, contact and content rights before Task 8.

- [ ] **Step 6: Verify and commit non-sensitive artifacts**

```bash
npm run test
npm run test:scope
node --test tests/legal-content.test.mjs
git add web-hosting docs/operations release constants/publicMiniapps.ts tests/legal-content.test.mjs
git diff --cached --name-only
git commit -m "docs: align privacy and support with public v1"
```

---

## Task 8: Deploy safely to Hostinger and verify AASA

**Files:**

- Create: `scripts/verify-production.mjs`
- Create: `scripts/assemble-web-release.mjs`
- Create: `release/production-urls.json`
- Create: `release/web-artifacts.json`
- Create: `docs/operations/hostinger-deploy-runbook.md`
- Modify: `package.json`

- [ ] **Step 1: Write production verifier before deployment**

The verifier checks the exact URLs, HTTPS status/content type, strict CSP, no AASA redirect, canonical tags, hashes, legal links, no third slug, no mixed content and no unexpected form/remote resource. It records no cookies or secrets. AASA validation uses `scripts/verify-aasa.mjs` and requires exactly the derived App ID and two components, with no extras.

- [ ] **Step 2: Back up and stage exact paths**

After confirming authenticated hPanel/SSH/SFTP access and completing 2FA with the owner:

1. Run `npm run miniapps:build`, then `node scripts/assemble-web-release.mjs`. The assembler creates one explicit ignored versioned directory from fresh `miniapps/dist`, legal pages, AASA and the apps security configuration; it writes `release/web-artifacts.json` with every relative path, size and SHA-256 and immediately verifies the directory against that manifest.
2. Export WordPress database and archive `public_html`; record checksums outside the public root.
3. Upload only the manifest-verified versioned bundle to a non-public/staging directory. Never select files ad hoc from source directories.
4. Re-verify the remote staged files against `release/web-artifacts.json` and mobile-render them.
5. Promote only these targets:

```text
public_html/apps/shared/
public_html/apps/healthy-recipes/
public_html/apps/clinic-guide/
public_html/apps/.htaccess
public_html/app/privacy/
public_html/app/terms/
public_html/app/support/
public_html/.well-known/apple-app-site-association
```

Do not edit the WordPress theme or Media Library and do not overwrite unrelated paths.

- [ ] **Step 3: Verify production and rollback path**

```bash
curl -fsS -o /dev/null https://cabohealth.org/
curl -fsS -o /dev/null https://cabohealth.org/apps/healthy-recipes/
curl -fsS -o /dev/null https://cabohealth.org/apps/clinic-guide/
curl -fsS -D /tmp/cabo-aasa-headers -o /tmp/cabo-aasa https://cabohealth.org/.well-known/apple-app-site-association
node scripts/verify-aasa.mjs /tmp/cabo-aasa
node scripts/verify-production.mjs
```

Confirm AASA status 200, `application/json` or accepted JSON content type, no redirect, exact App ID and paths. Verify root WordPress remains 200. Execute a controlled rollback rehearsal using the versioned prior directory/checksum.

- [ ] **Step 4: Wait for Apple CDN and verify**

```bash
curl -fsS https://app-site-association.cdn-apple.com/a/v1/cabohealth.org >/tmp/cabo-aasa-cdn
node scripts/verify-aasa.mjs /tmp/cabo-aasa-cdn
```

Apple CDN propagation may take up to 24 hours; unchanged CDN state is a wait condition, not permission to bypass the gate.

- [ ] **Step 5: Commit provenance, not secrets**

Commit production URL status, content hashes, deployment timestamp and rollback version. Do not commit credentials/backups.

```bash
git add scripts/verify-production.mjs release docs/operations/hostinger-deploy-runbook.md package.json
git commit -m "ops: verify CaboHealth public hosting"
```

---

## Task 9: Produce and test the signed iOS release candidate

**Files:**

- Modify: `app.json`
- Modify: `constants/config.ts`
- Modify: `assets/icon.png`
- Create: `release/app-store/2.1.0/release-manifest.json`
- Create: `release/app-store/2.1.0/qa-matrix.md`
- Create: `release/app-store/2.1.0/app-privacy.md`
- Create: `release/app-store/2.1.0/age-rating.md`
- Create: `release/app-store/2.1.0/review-notes.md`
- Create: `release/app-store/2.1.0/en-US.md`
- Create: `release/app-store/2.1.0/es-MX.md`
- Create: `release/app-store/2.1.0/screenshots/`
- Create: `release/app-store/2.1.0/screenshots-manifest.json`
- Create: `scripts/verify-screenshots.swift`

- [ ] **Step 1: Query App Store Connect before assigning the build**

Confirm the highest uploaded build for `6758285327`. Use marketing version `2.1.0`; assign build `4` only if the highest existing build is `3` or lower, otherwise use highest + 1. Update `app.json`, `constants/config.ts` and release manifest together. Do not change bundle ID/team/project ID.

- [ ] **Step 2: Make the existing icon App Store-valid**

Preserve the approved CaboHealth composition while flattening alpha onto its intended opaque background. Verify:

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha assets/icon.png
```

Required result: 1024 × 1024 and `hasAlpha: no`. Visually compare the flattened icon before commit.

- [ ] **Step 3: Run the full local release gate**

Before running the gate, resolve and pin one verified EAS CLI version in devDependencies, regenerate `package-lock.json`, and record that exact version in the preliminary release manifest whether or not a global/transitive CLI happens to be available. All tooling and manifest changes occur before the RC commit.

```bash
npm run test
npm run test:scope
npm run typecheck
npm run miniapps:build
npm run miniapps:verify
node node_modules/expo/bin/cli export --platform ios --output-dir /tmp/cabohealth-ios-export
node scripts/verify-minimal-v1.mjs /tmp/cabohealth-ios-export
git status --short
```

The checks above run before freezing; do not build from an uncommitted tree.

- [ ] **Step 4: Commit and tag the functional RC before building**

Commit every build-affecting source/config/icon change plus the preliminary release manifest and web hashes. Then require a clean worktree and record/tag that exact SHA:

```bash
git add app.json constants/config.ts constants/publicMiniapps.ts assets/icon.png release/app-store/2.1.0 package.json package-lock.json scripts/verify-screenshots.swift
git diff --cached --name-only
git commit -m "release: freeze CaboHealth 2.1.0 RC"
test -z "$(git status --porcelain)"
git rev-parse HEAD > /tmp/cabohealth-rc-source-sha
git tag -a cabohealth-2.1.0-rc.1 -m "CaboHealth 2.1.0 RC 1"
```

If any build input remains untracked/modified, stop and amend with a newly reviewed commit/tag rather than building.

- [ ] **Step 5: Build and upload that exact RC, but do not submit to Review yet**

Use only the CLI version already pinned and committed in Step 4. Reassert the tree is clean immediately before the build:

```bash
test -z "$(git status --porcelain)"
node node_modules/eas-cli/build/bin/run.js config --platform ios --profile production
node node_modules/eas-cli/build/bin/run.js build --platform ios --profile production --json > /tmp/cabohealth-eas-build.json
node node_modules/eas-cli/build/bin/run.js submit --platform ios --profile production --id "$(node -e "const b=require('/tmp/cabohealth-eas-build.json'); process.stdout.write(Array.isArray(b)?b[0].id:b.id)")"
```

If the pinned CLI cannot be installed or run, this is a blocker; never substitute an unrecorded floating version after the tag. Confirm EAS build metadata reports the SHA stored in `/tmp/cabohealth-rc-source-sha`, then record the explicit build ID/artifact hash in submission evidence without changing functional inputs.

- [ ] **Step 6: Inspect signing and test the exact TestFlight build**

Extract the signed application identifier and entitlements from the exact IPA. It must equal the App ID used by origin/CDN AASA, and `com.apple.developer.associated-domains` must contain only `applinks:cabohealth.org`. Install the exact processed build on a physical iPhone and complete:

- clean install A4 and immediate CTA;
- automatic continuation and later direct launch;
- Replay Introduction;
- both language/theme/motion modes;
- both cards, save/remove and Saved persistence;
- both WebViews, loading/error/offline/retry/share/back;
- forbidden URL and unknown slug;
- both Universal Links from Notes/Messages/Safari;
- VoiceOver, largest practical Dynamic Type and Reduce Motion;
- background/foreground, force quit and upgrade from the prior build;
- no credentials, identifiers, PHI or unexpected network hosts in logs/traffic.

Capture Safari/Web Inspector or an approved network trace while exercising both modules; every subresource/request host must be `cabohealth.org` and the external contact/map actions must leave the WebView only after a user tap.

Every row in `qa-matrix.md` records device, iOS, build ID, date, result and evidence reference.

- [ ] **Step 7: Capture screenshots from that RC and commit evidence only**

Capture 6.9-inch iPhone screenshots from the exact RC showing native/offline utility, catalog value, Healthy Recipes, Clinic Guide, Saved and Settings/privacy. No login/splash-only screenshots. Localize accurately. Generate a screenshot manifest, run text recognition for excluded module names and require human sign-off that only the two approved modules are visible.

```bash
git add release/app-store/2.1.0
git diff --cached --name-only
git commit -m "release: record CaboHealth 2.1.0 RC evidence"
```

Any functional or hosted content change after sign-off invalidates the RC and returns to its producing task.

---

## Task 10: Complete App Store metadata, submit and monitor review

**Files:**

- Modify: `release/app-store/2.1.0/review-notes.md`
- Modify: `release/app-store/2.1.0/qa-matrix.md`
- Create: `release/app-store/2.1.0/submission-record.md`

- [ ] **Step 1: Reconfirm the already approved factual/legal gate**

Task 7 is the authority for seller/entity, contacts, hosting retention, content rights, PHI remediation, age rating, export and medical-device facts. Before submission, compare `release/compliance-facts.json`, hosted legal hashes, App Store fields and the RC data inventory. Stop if any fact changed or approval is missing; do not invent or first-resolve legal facts at this late stage.

- [ ] **Step 2: Enter build-exact metadata**

Use `en-US.md` and `es-MX.md`. The description says curated CaboHealth health resources, not store/marketplace/install. App Privacy declares only actual build/hosting behavior. Age rating is answered from the RC; do not copy the old 12+ value.

Review Notes explicitly list both miniapps, URLs/Universal Links, public access, data use, empty permissions, age, no account, no purchase, no UGC, no remote native code/bridge and exact test steps. No demo credential is necessary because all submitted functionality is public.

- [ ] **Step 3: Final pre-submit comparison**

Compare App Store Connect screenshots/metadata/build against the committed release manifest and production verifier. Select manual release. Ensure backend/site and support contact will remain available throughout review.

- [ ] **Step 4: Submit the exact RC**

Select the tested build, resolve all compliance prompts, `Add for Review`, then `Submit for Review`. Record version, build, submission ID, timestamp, source SHA, web hashes and screenshots of final fields in the private evidence location; commit only non-sensitive textual provenance.

- [ ] **Step 5: Monitor and answer Apple without changing hidden functionality**

Monitor status and Resolution Center. Reply with exact steps and facts. If Apple identifies a defect, reproduce on the submitted build, fix through the relevant task, create a new build and update Review Notes. Never activate a third module or materially change hosted content during review.

- [ ] **Step 6: Complete release**

After approval, verify the approved build and unchanged web hashes, then manually release when the owner is ready. Close the old public Firestore rules only after confirming legacy-build migration/retirement, using a separately reviewed security change.

```bash
git add release/app-store/2.1.0
git commit -m "release: record CaboHealth App Store submission"
```

## Final acceptance command set

```bash
npm run test
npm run test:scope
npm run typecheck
npm run miniapps:build
npm run miniapps:verify
node scripts/verify-production.mjs
node node_modules/expo/bin/cli config --type public --json >/tmp/cabohealth-final-config.json
git status --short
```

All automated commands, production URLs, AASA origin/CDN, signed entitlements, physical-device matrix, metadata/legal gates and TestFlight build identity must be green before `Submit for Review`.
