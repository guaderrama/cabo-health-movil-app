# CaboHealth Native Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el launcher con gate global por el shell CaboHealth aprobado: portada A4 de una sola vez, catálogo público inmediato, tarjetas de cliente visibles, favoritos de miniapps, acceso seguro por entitlement, deep links y WebView restringido.

**Architecture:** Expo Router conserva un único árbol de navegación y monta providers por feature. El catálogo se descarga mediante un adapter público validado contra un esquema compartido y una allowlist fijada al release. El acceso de cliente se resuelve por una política pura y por adapters del backend; ningún error de red concede acceso. Toda URL pasa por una política de lanzamiento antes de montar un WebView sin puente nativo.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, Expo Router 6, TypeScript 5.9, React Native Firebase, Zod, i18next, AsyncStorage, SecureStore, React Native WebView, Jest/React Native Testing Library, Maestro.

## Global Constraints

- Implementar solamente los tres slugs del release: `healthy-recipes`, `clinic-guide` y `client-resources`. El runtime acepta cualquier subconjunto para poder retirar una app rota, pero rechaza todo slug desconocido.
- Mantener Sleep Lab, Gut Health, AI Cosmetic Scan, Health Advisor y el Service Hub actual fuera del catálogo y del binario de publicación.
- No introducir `onMessage`, `injectJavaScript`, código nativo remoto, URLs arbitrarias ni un puente JavaScript hacia APIs nativas.
- `Saved` en v1 guarda miniapps. Healthy Recipes mantiene sus recetas guardadas dentro de su propia miniapp y ofrece un acceso directo a esa pantalla; el shell no agrega favoritos internos.
- El contenido público nunca requiere código, biometría ni cuenta. Biometría protege únicamente una sesión de cliente rehidratada.
- No copiar, registrar ni persistir códigos de cliente, nonces, tokens o secretos en AsyncStorage, logs, analytics o crash reports.
- No editar ni incluir el cambio preexistente de finales de línea en `babel.config.js`.
- Escribir primero la prueba que falla, observar el fallo esperado, implementar el mínimo, observar el pase y hacer commit antes de avanzar.
- La integración real de Functions, App Check y administración se completa en `2026-08-16-cabohealth-secure-backend-admin.md`; este plan usa adapters y fakes hasta que esos endpoints existan.
- Ejecutar Tasks 1–2 de este plan antes de iniciar backend o miniapps; el commit de `packages/contracts` es el gate transversal que elimina dependencias circulares.
- El catálogo público debe cargar aunque App Attest/App Check no esté disponible. Auth + App Check se reservan para acceso, nonces y administración.
- `config/environment-topology.json` es la única fuente versionada de IDs y URLs públicas por ambiente. Ninguna URL arbitraria puede entrar mediante una variable `EXPO_PUBLIC_*`; `APP_ENV` sólo selecciona una entrada validada del archivo.

---

## Dependency and Interface Map

**Consumes**

- Especificación aprobada: `docs/superpowers/specs/2026-08-16-cabohealth-catalog-platform-design.md`.
- Contratos compartidos en `packages/contracts` creados en Task 2.
- HTTP público `GET /v1/catalog` y callables `redeemAccessCode`, `refreshSession`, `createLaunchNonce`, `removeClientAccess` y `deleteClientAccount` del plan de backend.
- URLs y AASA desplegados por `2026-08-16-cabohealth-miniapps-hosting.md`.

**Produces**

- Un shell iOS navegable y probado contra fakes/emuladores.
- Las rutas `/intro`, `/(tabs)`, `/client-access` y `/apps/[slug]`.
- La allowlist nativa inmutable del release.
- Los contratos que consumirán backend y miniapps.
- Suites Jest y Maestro necesarias para el release final.

**Canonical contracts**

- `@cabohealth/contracts/catalog`: `CatalogManifest`, `CatalogMiniapp`, `LocalizedText`, `AccessLevel`, `CatalogStatus` y sus schemas Zod.
- `@cabohealth/contracts/access`: `DeviceContext`, `SessionView`, schemas request/response por operación y errores públicos/autenticados separados.
- `@cabohealth/contracts/launch`: POST de nonce, firmas server-to-server, sesión web opaca e introspección compartidas con PHP mediante fixtures serializados.
- `features/catalog/releaseCatalog.ts`: única lista de slugs aprobados por ese binario.
- `features/access/accessPolicy.ts`: única decisión para taps normales y universal links.
- `features/launch/navigationPolicy.ts`: única decisión para URL inicial, redirects y popups.

## Canonical Transport Signatures

```ts
export type EpochMs = number;

export interface DeviceContext {
  installationId: string;
  platform: 'ios';
  appVersion: string;
  buildNumber: string;
}

export interface ReleaseBinding {
  releaseId: string;
  marketingVersion: string;
  buildNumber: string;
}

export interface SessionView {
  grantId: string;
  programName?: string;
  entitlements: string[];
  expiresAtMs: EpochMs | null;
  offlineUntilMs: EpochMs | null;
  serverTimeMs: EpochMs;
}

export interface RedeemAccessCodeRequest {
  requestId: string;
  code: string;
  device: DeviceContext;
}

export interface RedeemAccessCodeResponse {
  customToken: string;
  session: SessionView;
  requiresBiometrySetup: boolean;
}

export interface RefreshSessionRequest {
  requestId: string;
  device: DeviceContext;
}

export interface RefreshSessionResponse {
  session: SessionView;
  catalogRevision: number;
  forceIdTokenRefresh: boolean;
  update: { required: false } | { required: true; minimumVersion: string; storeUrl: string };
}

export interface CreateLaunchNonceRequest {
  requestId: string;
  appId: string;
  device: DeviceContext;
}

export interface CreateLaunchNonceResponse {
  launchUrl: string;
  method: 'POST';
  nonce: string;
  expiresAtMs: EpochMs;
}

export interface RemoveClientAccessRequest {
  requestId: string;
  device: DeviceContext;
}

export interface RemoveClientAccessResponse {
  revokedAtMs: EpochMs;
  webSessionsRevoked: number;
}

export interface DeleteClientAccountRequest {
  requestId: string;
  device: DeviceContext;
}

export interface DeleteClientAccountResponse {
  deletedAtMs: EpochMs;
  receiptId: string;
  retainedAuditIsPseudonymized: true;
}

export interface RevokeClientSessionRequest {
  requestId: string;
  webSessionId: string;
  reason: 'logout';
}

export interface RevokeClientSessionResponse {
  revokedAtMs: EpochMs;
}

export type RedeemPublicFailure =
  | 'invalid_access'
  | 'rate_limited'
  | 'upgrade_required';

export type AuthenticatedFailure =
  | 'revoked'
  | 'expired'
  | 'device_mismatch'
  | 'missing_entitlement'
  | 'wrong_app'
  | 'upgrade_required';

export type LocalTransportFailure = 'network' | 'server';
```

`GET /v1/catalog` devuelve `CatalogManifest` directamente, `ETag` y `Cache-Control`; no usa Auth ni App Check obligatorio. Callables privados devuelven los tipos anteriores y codifican errores de dominio en `HttpsError.details.code`. El contrato broker firma exactamente `version + environment + audience + HTTP method + lowercase host + canonical path + timestampMs + requestId + SHA-256(raw body bytes)` con un `keyId` propio de ese ambiente; PHP/TypeScript deben producir bytes idénticos y una firma nunca es válida para otra ruta, host, audience o ambiente.

## Canonical Environment Topology

`config/environment-topology.json` contiene únicamente configuración pública y se llena con los IDs reales en Backend Task 1. Todos los consumidores validan el mismo schema y derivan de esta tabla; no se aceptan overrides de URL en CI/EAS:

| `APP_ENV` | Firebase/region | Catalog URL | Broker API base | Miniapp base | Client launch URL |
|---|---|---|---|---|---|
| `development` | `demo-cabohealth` / `us-central1` | `http://127.0.0.1:5001/demo-cabohealth/us-central1/publicApi/v1/catalog` | `http://127.0.0.1:5001/demo-cabohealth/us-central1/brokerApi` | `http://127.0.0.1:8088/apps/` | `http://127.0.0.1:8088/apps/client-resources/launch/` |
| `staging` | exact `stagingProjectId` recorded after `firebase projects:list` / `us-central1` | `https://us-central1-${stagingProjectId}.cloudfunctions.net/publicApi/v1/catalog` | `https://us-central1-${stagingProjectId}.cloudfunctions.net/brokerApi` | `https://cabohealth.org/apps-staging/` | `https://cabohealth.org/apps-staging/client-resources/launch/` |
| `production` | exact `productionProjectId` recorded after `firebase projects:list` / `us-central1` | `https://us-central1-${productionProjectId}.cloudfunctions.net/publicApi/v1/catalog` | `https://us-central1-${productionProjectId}.cloudfunctions.net/brokerApi` | `https://cabohealth.org/apps/` | `https://cabohealth.org/apps/client-resources/launch/` |

`publicApi` es una única Function HTTP/Express con `GET /healthz` y `GET /v1/catalog`; `brokerApi` expone sólo los POST HMAC server-to-server de redeem/introspect/revoke. Los callables privados se resuelven con el `projectId` y `region` de la misma entrada. El schema exige que `CreateLaunchNonceResponse.launchUrl` sea exactamente el `clientLaunchUrl` activo. El WebView protegido envía `Content-Type: application/x-www-form-urlencoded;charset=UTF-8` y body exacto `nonce=${encodeURIComponent(nonce)}`. Staging nunca entra en AASA y un build production falla si contiene loopback, `apps-staging` o IDs de dev/staging.

La misma entrada deriva `clientResourceBasePath` y cookie sin colisiones: development usa `/apps/client-resources/` + `cabo_client_dev` (sólo servidor local), staging usa `/apps-staging/client-resources/` + `__Secure-cabo_client_staging`, y production usa `/apps/client-resources/` + `__Secure-cabo_client`. Staging/production requieren `Secure`, `HttpOnly`, `SameSite=Lax` y `Path` igual al base path; ninguna cookie se comparte entre ambientes.

## Target File Map

```text
app/
  _layout.tsx
  index.tsx
  intro.tsx
  client-access.tsx
  +not-found.tsx
  (tabs)/_layout.tsx
  (tabs)/index.tsx
  (tabs)/saved.tsx
  (tabs)/settings.tsx
  apps/[slug].tsx
features/
  bootstrap/AppProviders.tsx
  onboarding/{IntroScreen,onboardingStore,useIntroNavigation}.ts(x)
  catalog/{releaseCatalog,catalogApi,catalogCache,CatalogProvider,selectors,CatalogScreen,CatalogFilters,CatalogSearch}.ts(x)
  access/{accessApi,authAdapter,secureInstallationStore,accessPolicy,AccessProvider,ClientAccessScreen,useSessionLock}.ts(x)
  favorites/{favoritesStore,FavoritesProvider,SavedScreen}.ts(x)
  preferences/{preferencesStore,PreferencesProvider,useReducedMotion,haptics}.ts(x)
  launch/{launchPolicy,navigationPolicy,RestrictedWebView,MiniappRouteScreen,MiniappConsentSheet,WebViewErrorState}.ts(x)
  settings/{SettingsScreen,SettingsSection,SettingsRow,ThemeSelector,LanguageSelector}.ts(x)
components/catalog/{MiniappCard,MiniappBadge,CatalogSkeleton}.tsx
components/ui/{AccessiblePressable,ScreenState,MolecularBackground}.tsx
i18n/{index,en,es}.ts
constants/{environment,storageKeys}.ts
config/{environment-topology.schema.json,environment-topology.json}
packages/contracts/
  src/{catalog,access,admin,launch,index}.ts
  fixtures/{catalog-valid,broker-signing-vectors}.json
test/{setup,fakes,fixtures}/
__tests__/routes/
.maestro/
```

## Task 1: Restore a reproducible toolchain and install the test harness

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `jest.config.js`
- Create: `test/setup.ts`
- Create: `.env.example`
- Create: `constants/environment.ts`
- Create: `config/environment-topology.schema.json`
- Test: `constants/__tests__/environment.test.ts`

- [ ] Record the current baseline without mutating it: run `node node_modules/typescript/bin/tsc --noEmit` and save the exit code in the task notes; it should pass before refactoring.
- [ ] Run `npm ci` to rebuild the non-executable `node_modules/.bin` wrappers, then run `npm run typecheck`; expected result: exit 0 rather than the current exit 126.
- [ ] Install SDK-compatible runtime dependencies with `npx expo install expo-secure-store expo-localization expo-splash-screen @react-native-community/netinfo expo-crypto` and install `zod i18next react-i18next`.
- [ ] Install `jest-expo`, `jest`, `@types/jest` and `@testing-library/react-native` as dev dependencies; do not add `react-test-renderer`.
- [ ] Add scripts `test`, `test:ci`, `test:catalog`, `test:access`, `test:launch`, `test:routes` and `verify` to `package.json`.
- [ ] Configure Jest for `jest-expo`, the `@/` alias, deterministic fake timers and AsyncStorage/SecureStore mocks in `test/setup.ts`.
- [ ] Write `environment.test.ts` first against injected topology fixtures: require `APP_ENV`, project ID, region, exact catalog/broker/miniapp-base/launch URL relationship and `https://cabohealth.org` production origin; run `npm test -- constants/__tests__/environment.test.ts` and confirm failure because schema/validator are missing.
- [ ] Implement `environment-topology.schema.json` and `constants/environment.ts`. `APP_ENV` selects one committed entry; production contains no token/password/secret, requires the exact CaboHealth launch path and rejects debug App Check, loopback, `apps-staging` and non-production Firebase IDs. Development may use only the fixed loopback URLs plus `demo-cabohealth`.
- [ ] Leave creation of the real, non-secret `config/environment-topology.json` to Backend Task 1 after Firebase IDs are discovered; test the validator with canonical fixtures now and make the app fail clearly until the selected real entry exists.
- [ ] Run the same focused test, `npm run typecheck`, `npm run lint` and `npx expo-doctor`; expected result: all pass.
- [ ] Commit only these files with `test: establish Expo verification harness`.

## Task 2: Create canonical shared contracts and the immutable release allowlist

**Files:**

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/catalog.ts`
- Create: `packages/contracts/src/access.ts`
- Create: `packages/contracts/src/admin.ts`
- Create: `packages/contracts/src/launch.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/fixtures/catalog-valid.json`
- Create: `packages/contracts/fixtures/broker-signing-vectors.json`
- Create: `packages/contracts/tests/catalog.test.ts`
- Create: `packages/contracts/tests/access.test.ts`
- Create: `features/catalog/releaseCatalog.ts`
- Create: `features/catalog/__tests__/releaseCatalog.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Define `CatalogManifest` with schema version `1`, localized text, access, URLs/hosts, privacy/report/data use, permissions, age, status, content version, artifact hash, immutable `ReleaseBinding {releaseId, marketingVersion, buildNumber}`, editorial review date, order and timestamps. Submission ID/state never enter public catalog bytes.
- [ ] Define exact schemas for `GET /v1/catalog`, `RedeemAccessCode`, `RefreshSession`, `CreateLaunchNonce`, `RemoveClientAccess`, `DeleteClientAccount`, `RedeemLaunchNonce`, `IntrospectClientSession` and S2S `RevokeClientSession`. Every timestamp uses integer epoch milliseconds and every mutation carries UUID `requestId` plus `DeviceContext` where installation binding applies.
- [ ] Separate public redemption errors `invalid_access | rate_limited | upgrade_required` from authenticated refresh errors `revoked | expired | device_mismatch | upgrade_required`; `network | server` remain local transport failures and are never server discovery details.
- [ ] Define `CreateLaunchNonceResponse` as validated environment-specific clean `launchUrl`, `method: 'POST'`, opaque `nonce` and `expiresAtMs`; define canonical TS/PHP request-signing vectors covering version, environment, audience, method, lowercase host, canonical path, timestamp, request ID and raw-body digest. Add negative vectors for changing exactly one component and for using a staging key ID in production.
- [ ] Define admin inputs with `expectedRevision`, archive/unpublish/activate-previous rather than hard delete, paginated audit responses and code list responses that expose only a display suffix.
- [ ] Write contract tests first for a valid three-app fixture and the following failures: HTTP URL, duplicate slug, URL host absent from `allowedHosts`, description longer than 140 characters, permission requested in v1 and unpublished module.
- [ ] Run `npm --prefix packages/contracts test`; expected result: failure because schemas are not implemented.
- [ ] Implement Zod schemas and inferred types; export compiled ESM/CJS declarations from `packages/contracts/dist`.
- [ ] Add the local dependency `@cabohealth/contracts` to the Expo package and build it from `pretypecheck`/`pretest` scripts so consumers never import uncompiled TypeScript from outside Metro.
- [ ] Write `releaseCatalog.test.ts` requiring all three in the initial fixture, accepting zero/one/two/three approved runtime entries for the emergency kill switch, and rejecting a fourth remotely supplied slug even when its schema is otherwise valid.
- [ ] Implement `APPROVED_RELEASE_SLUGS` as a readonly upper-bound tuple and `assertReleaseCatalog(manifest)` as a fail-closed unknown-slug validator. Initial release verification—not runtime parsing—requires all three.
- [ ] Run `npm --prefix packages/contracts test && npm test -- features/catalog/__tests__/releaseCatalog.test.ts && npm run typecheck`; expected result: all pass.
- [ ] Commit with `feat: define CaboHealth release contracts`.

## Task 3: Build localized preferences, onboarding state and deterministic app bootstrap

**Files:**

- Create: `constants/storageKeys.ts`
- Create: `i18n/index.ts`
- Create: `i18n/en.ts`
- Create: `i18n/es.ts`
- Create: `features/preferences/types.ts`
- Create: `features/preferences/preferencesStore.ts`
- Create: `features/preferences/PreferencesProvider.tsx`
- Create: `features/preferences/useReducedMotion.ts`
- Create: `features/onboarding/onboardingStore.ts`
- Create: `features/bootstrap/AppProviders.tsx`
- Test: `features/preferences/__tests__/PreferencesProvider.test.tsx`
- Test: `features/onboarding/__tests__/onboardingStore.test.ts`

- [ ] Introduce versioned, single-purpose keys for preferences, intro, miniapp favorites, catalog cache and private-cache metadata; never reuse `lastSync` for authentication or biometrics.
- [ ] Write failing store tests for defaults, corrupt JSON fallback, language/theme persistence and separation of `hasSeenIntro` from visual preferences.
- [ ] Run `npm test -- features/preferences features/onboarding`; expected result: fail on missing stores/providers before implementation.
- [ ] Implement typed AsyncStorage adapters for non-sensitive state and a provider that combines system Reduce Motion with the manual preference.
- [ ] Add all operational, legal, access and error strings to `en.ts` and `es.ts`; make English the fallback and support changing locale without restarting.
- [ ] Write a failing provider hydration test that keeps the native splash visible until preferences, intro, auth and cached catalog each report a deterministic state.
- [ ] Implement `AppProviders` with injectable adapters for tests and a single hydration barrier.
- [ ] Run `npm test -- features/preferences features/onboarding && npm run typecheck`; expected result: all pass with no act warnings.
- [ ] Commit with `feat: add localized app bootstrap and preferences`.

## Task 4: Implement the approved A4 cover and one-time navigation

**Files:**

- Modify: `app/_layout.tsx`
- Modify: `app/index.tsx`
- Create: `app/intro.tsx`
- Create: `features/onboarding/IntroScreen.tsx`
- Create: `features/onboarding/useIntroNavigation.ts`
- Create: `components/ui/MolecularBackground.tsx`
- Reuse: `assets/logo.png`
- Test: `features/onboarding/__tests__/IntroScreen.test.tsx`
- Test: `__tests__/routes/bootstrap.test.tsx`

- [ ] Call `SplashScreen.preventAutoHideAsync()` at module scope in the root layout and replace `Slot` with a root `Stack` whose route chrome is fully controlled.
- [ ] Write fake-timer tests first: no navigation at 1,599 ms; exactly one `replace('/(tabs)')` at 1,600 ms; tap cancels the timer; a returning user skips intro; replay shows it again.
- [ ] Run `npm test -- features/onboarding/__tests__/IntroScreen.test.tsx __tests__/routes/bootstrap.test.tsx`; expected result: failure because routes and screen do not exist.
- [ ] Implement A4 with the real CaboHealth PNG wordmark, approved tagline/copy, 44-point CTA, molecular network and safe-area layout matching the approved prototype.
- [ ] Make animation conditional on route focus, `AppState === 'active'`, system Reduce Motion and the internal preference. Cancel timers/animations on blur and unmount.
- [ ] Persist intro completion before navigation; make auto and tap paths idempotent. Settings replay uses `/intro?replay=1` without corrupting the first-install state.
- [ ] Add accessibility labels/hints and Dynamic Type-safe layout; no fixed text heights.
- [ ] Run the focused tests, `npm run typecheck` and `npm run lint`; expected result: all pass.
- [ ] Commit with `feat: implement one-time A4 introduction`.

## Task 5: Replace the launcher with the public curated catalog and Saved tab

**Files:**

- Create: `app/(tabs)/_layout.tsx`
- Create: `app/(tabs)/index.tsx`
- Create: `app/(tabs)/saved.tsx`
- Create: `features/catalog/catalogApi.ts`
- Create: `features/catalog/catalogCache.ts`
- Create: `features/catalog/CatalogProvider.tsx`
- Create: `features/catalog/selectors.ts`
- Create: `features/catalog/CatalogScreen.tsx`
- Create: `features/catalog/CatalogFilters.tsx`
- Create: `features/catalog/CatalogSearch.tsx`
- Create: `features/favorites/favoritesStore.ts`
- Create: `features/favorites/FavoritesProvider.tsx`
- Create: `features/favorites/SavedScreen.tsx`
- Create: `components/catalog/MiniappCard.tsx`
- Create: `components/catalog/MiniappBadge.tsx`
- Create: `components/catalog/CatalogSkeleton.tsx`
- Test: `features/catalog/__tests__/CatalogProvider.test.tsx`
- Test: `features/catalog/__tests__/selectors.test.ts`
- Test: `features/favorites/__tests__/favoritesStore.test.ts`
- Test: `features/favorites/__tests__/SavedScreen.test.tsx`
- Test: `__tests__/routes/tabs.test.tsx`

- [ ] Write failing provider tests for cache-first render, valid remote replacement, App Check unavailable with public HTTP still working, stale/invalid remote retention, an intentional approved-subset kill switch, no-cache offline state and reconciliation of retired favorites.
- [ ] Run `npm test -- features/catalog features/favorites`; expected result: fail because providers/selectors/stores are not implemented.
- [ ] Implement a single `CatalogProvider`; do not create separate realtime subscriptions or polling hooks per screen.
- [ ] Validate cached and remote manifests with the canonical schema plus `assertReleaseCatalog`. An invalid document is omitted and the last valid whole manifest remains active.
- [ ] Write failing selector tests for localized search and `All`, `Open`, `For clients`; locked cards must remain visible.
- [ ] Build the approved catalog UI with immediate content, pull-to-refresh, badges, skeleton/offline/error states and public/locked behavior. A locked card is actionable, not disabled.
- [ ] Add accessible favorite controls with immediate provider updates and no polling. Reconcile favorites by immutable miniapp ID.
- [ ] Implement Saved as miniapp favorites plus a localized explanation that recipe-level favorites live inside Healthy Recipes. Tapping Healthy Recipes opens the approved base route; its own visible Saved destination handles recipe favorites without a native bridge or unsupported nested universal-link route.
- [ ] Assert accessibility labels such as `Healthy Recipes, Open` and `Client Resources, Requires CaboHealth client access`; filters expose selected state and all targets are at least 44 × 44 points.
- [ ] Run `npm test -- features/catalog features/favorites __tests__/routes/tabs.test.tsx && npm run typecheck`; expected result: all pass.
- [ ] Commit with `feat: add curated catalog and saved miniapps`.

## Task 6: Implement fail-closed client access and session lifecycle

**Files:**

- Create: `app/client-access.tsx`
- Create: `features/access/authAdapter.ts`
- Create: `features/access/accessApi.ts`
- Create: `features/access/secureInstallationStore.ts`
- Create: `features/access/accessPolicy.ts`
- Create: `features/access/AccessProvider.tsx`
- Create: `features/access/ClientAccessScreen.tsx`
- Create: `features/access/useSessionLock.ts`
- Test: `features/access/__tests__/accessPolicy.test.ts`
- Test: `features/access/__tests__/AccessProvider.test.tsx`
- Test: `features/access/__tests__/ClientAccessScreen.test.tsx`
- Test: `__tests__/routes/locked-miniapp.test.tsx`

- [ ] Generate a 256-bit installation ID once with `expo-crypto` and store it in SecureStore. No access code or Firebase token is read by application code after redemption; native Firebase Auth owns its ID/refresh credentials in iOS Keychain. Offline lease metadata never authorizes a nonce.
- [ ] Write table-driven policy tests first for public, client entitled, client anonymous, missing entitlement, expired/offline grace, revoked, unpublished and `secureAccount` states.
- [ ] Implement `accessPolicy` as a pure function returning `allowPublic`, `allowClient`, `requireClientCode`, `requireSecureAccount` or an explicit denial. Network failure is never an allow decision.
- [ ] Write provider tests for redeem → sign in with custom token → refresh session, cold-start refresh, foreground refresh, background biometric lock, revocation, logout while offline and legacy AsyncStorage cleanup.
- [ ] Run `npm test -- features/access`; expected result: fail on the first unimplemented policy/provider behavior.
- [ ] Implement adapters for the backend contracts. Normalize display input only for transmission, clear the input immediately, map typed server errors to localized generic messages and never reveal code existence.
- [ ] Implement the client access modal with return slug validation against the approved catalog, rate-limit countdown, cancel/back, Support and VoiceOver announcements.
- [ ] On Remove Client Access, revoke the grant and all web sessions, expire the scoped Client Resources cookie by closing its isolated/incognito WebView store, always sign out locally, clear private metadata and retain public catalog/favorites.
- [ ] Add a separate visible `Delete account and data` action with confirmation. It calls `deleteClientAccount`, waits for server completion/anonymization receipt, deletes the Firebase principal and grant/web sessions, then clears all local/private WebView state. Retained audit is pseudonymized and explained in Privacy.
- [ ] Migrate a legacy stored code exactly once after explicit confirmation: move it temporarily to a migration-only SecureStore key, redeem online, erase on success or definitive `invalid_access`, and retain only for retry on `network/server` until explicit cancel/deadline. Never authenticate offline, log it or show it again.
- [ ] Run `npm test -- features/access __tests__/routes/locked-miniapp.test.tsx && npm run typecheck`; expected result: all pass.
- [ ] Commit with `feat: add fail-closed client access flow`.

## Task 7: Add one route guard, universal-link resolution and a restricted WebView

**Files:**

- Create: `app/apps/[slug].tsx`
- Create: `app/+not-found.tsx`
- Create: `features/launch/launchPolicy.ts`
- Create: `features/launch/navigationPolicy.ts`
- Create: `features/launch/RestrictedWebView.tsx`
- Create: `features/launch/MiniappRouteScreen.tsx`
- Create: `features/launch/MiniappConsentSheet.tsx`
- Create: `features/launch/WebViewErrorState.tsx`
- Test: `features/launch/__tests__/launchPolicy.test.ts`
- Test: `features/launch/__tests__/navigationPolicy.test.ts`
- Test: `features/launch/__tests__/RestrictedWebView.test.tsx`
- Test: `__tests__/routes/public-miniapp.test.tsx`
- Test: `__tests__/routes/universal-link.test.tsx`

- [ ] Write route tests first proving that taps, `cabohealth://apps/<slug>` and `https://cabohealth.org/apps/<slug>/` all execute the same catalog resolution and access policy.
- [ ] Write navigation-policy tests for exact hostname matching, subdomain rejection, credentials-in-URL rejection, malformed URLs, `http`, `javascript`, `data`, `file`, `blob`, unauthorized redirects and popups.
- [ ] Run `npm test -- features/launch __tests__/routes`; expected result: fail before route guard/WebView policy implementation.
- [ ] Implement public launch directly and client launch only through a fresh server-produced POST launch. Require `launchUrl === activeEnvironment.clientLaunchUrl`, `Content-Type: application/x-www-form-urlencoded;charset=UTF-8` and body exactly `nonce=${encodeURIComponent(nonce)}`; never put the nonce in a query, referrer, router parameter or diagnostic.
- [ ] Before every protected launch, show a localized module-specific disclosure of the pseudonymous access identifier/entitlement shared with Client Resources and require an explicit Continue/Cancel choice; denial creates no nonce and shares nothing.
- [ ] Configure WebView with HTTPS-only origin whitelist, no windows, no mixed content/file access/universal file access, no shared/third-party cookies for public apps, `limitsNavigationsToAppBoundDomains` on iOS and no native messaging bridge.
- [ ] Run Client Resources in an isolated/incognito WebView data store: its scoped cookie survives only the active resource session, is destroyed on Remove/Delete/unmount and cannot leak to public miniapps or Staff Portal.
- [ ] Intercept map, WhatsApp, `mailto` and `tel` links, show a confirmation, then hand them to the system. Block every other external navigation with an actionable screen.
- [ ] Implement a 30-second timeout, HTTP error, render-process termination, retry and Back/Support states. Stop loading and remove any nonce-bearing URL from diagnostics.
- [ ] Confirm a deep link to Client Resources without entitlement opens Client Access and cannot flash private WebView content.
- [ ] Run `npm test -- features/launch __tests__/routes && npm run typecheck && npm run lint`; expected result: all pass.
- [ ] Commit with `feat: enforce secure miniapp launch policy`.

## Task 8: Complete Settings, remove legacy bypasses and prepare device E2E

**Files:**

- Create: `app/(tabs)/settings.tsx`
- Create: `features/settings/SettingsScreen.tsx`
- Create: `features/settings/SettingsSection.tsx`
- Create: `features/settings/SettingsRow.tsx`
- Create: `features/settings/ThemeSelector.tsx`
- Create: `features/settings/LanguageSelector.tsx`
- Create: `app.config.ts`
- Modify or retire after migration: `app.json`
- Create: `.easignore`
- Create: `scripts/security/scan-redacted.mjs`
- Test: `scripts/security/scan-redacted.test.mjs`
- Modify: `eas.json`
- Modify: `constants/config.ts`
- Delete after replacement: `app/(auth)/`
- Delete after replacement: `app/(main)/`
- Delete after replacement: `hooks/useAccessCode.ts`
- Delete after replacement: `hooks/useWebApps.ts`
- Delete after replacement: `hooks/useFavorites.ts`
- Delete after replacement: `services/accessCode.ts`
- Delete after replacement: `services/firestore.ts`
- Create: `.maestro/clean-install-intro.yaml`
- Create: `.maestro/returning-launch.yaml`
- Create: `.maestro/public-catalog.yaml`
- Create: `.maestro/client-access.yaml`
- Create: `.maestro/favorites-settings.yaml`
- Create: `.maestro/universal-links.yaml`
- Test: `features/settings/__tests__/SettingsScreen.test.tsx`

- [ ] Write Settings tests first for language, system/light/dark theme, Reduce Motion, biometrics scope, replay intro, clear Saved, remove access, delete account/data and public Privacy/Terms/Support links.
- [ ] Run `npm test -- features/settings`; expected result: fail because the new Settings screen/actions do not exist.
- [ ] Add a visible `Staff Sign In` row that opens the authenticated staff portal defined in the backend plan. Do not retain a hidden gesture, local PIN or native direct-Firestore admin route.
- [ ] Make `app.config.ts` the single config owner: select one validated `config/environment-topology.json` entry plus matching Firebase/App Check files by `APP_ENV`, fail when missing/mismatched, automatic UI style, `applinks:cabohealth.org`, required plugins, app-bound `cabohealth.org`, narrow native asset patterns and no camera/microphone/photos/location permissions. Service files/debug tokens remain untracked and production tests prove no staging/debug URL/provider.
- [ ] Add `.easignore` to exclude miniapps, private Client Resources source, Staff Portal, Functions, hosting releases, backups, QA screenshots and secrets from the native build context. A release test inspects the uploaded/IPA file list rather than assuming ignore rules worked.
- [ ] Replace stale `.com`, build-number and fake-feature values in `constants/config.ts` with validated environment values or remove the file if no caller remains.
- [ ] Test then implement `scan-redacted.mjs`: output only `file:category` (never matching line/value) for embedded bypass/PIN, access-code-in-AsyncStorage and stale-domain categories; load compromised-value hashes from an untracked CI denylist.
- [ ] Add Maestro flows with stable `testID`s for first install, return launch, both public miniapps, visible locked card, successful/failed client code, logout, favorites, settings and universal links.
- [ ] Run `npm run verify && npx expo-doctor`; expected result: exit 0.
- [ ] Run `npx expo run:ios` and all six Maestro flows against emulator-backed fixtures; expected result: exit 0 with screenshots attached to the verification notes.
- [ ] Inspect the app with VoiceOver, Reduce Motion, extra-large Dynamic Type, background/foreground and airplane mode; record findings in `docs/qa/native-shell-verification.md` and fix every release-blocking defect.
- [ ] Commit with `feat: complete CaboHealth native shell`.

## Plan Acceptance Gate

- [ ] `npm run verify` passes from a clean `npm ci`.
- [ ] First install shows A4 and advances by 1.6 seconds; later launch opens the catalog.
- [ ] Both public apps open without access; Client Resources is always visible and locked correctly.
- [ ] Normal navigation and universal links share the same fail-closed policy.
- [ ] WebView policy blocks every non-approved scheme/host and contains no native bridge.
- [ ] No legacy secret, local PIN, raw access code or direct Firestore CRUD remains.
- [ ] Remove Access revokes web/native sessions immediately; Delete account and data removes the pseudonymous Firebase principal and all deletable associated data in-app.
- [ ] The shell is ready to integrate with the deployed staging backend and production miniapp URLs; this gate does not authorize App Store upload.
