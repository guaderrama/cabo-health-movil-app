# CaboHealth native Firebase runtime

## Safety boundary

Client access is enabled only in an iOS or Android native binary whose embedded
Firebase project ID exactly matches the external build configuration and begins
with `cabohealth-`. Web, Expo Go, a missing service file, a malformed config,
an App Check initialization failure, or a project mismatch all keep Client
Resources locked.

This repository does not contain a Firebase app ID, API key, service plist,
debug token, backend secret, or access code. The non-secret production alias is
pinned to `cabohealth-owner-prod`; native credentials remain external. Do not
reuse `Cabo Health Nova` or another app's Firebase project. Under ADR 0001,
development uses emulators and only the exact production/TestFlight build may
use the dedicated cloud project. A staging project requires a superseding ADR.

`expo-updates` is intentionally absent: the reviewed binary cannot be changed
by an undeclared over-the-air JavaScript update. Ship code changes through a
new signed App Store/TestFlight build unless a separately reviewed OTA policy
is added in a future release.

## External HTTPS catalog and launch contract

The external-HTTPS source candidate is locally verified but not evidenced as
deployed or built. Installed build 7 remains compatible because its legacy
`getPublishedCatalog`/`getPublishedCatalogV2`, production V1 redeem/refresh,
and legacy launch/broker contracts filter or reject every external resource.
Build 8 source fetches exactly `getPublishedCatalogV3` into the separate
`@cabohealth_published_catalog_v3` cache and uses only
`redeemClientAccessCodeV2`, `refreshClientAccessV2`, and
`createClientLaunchV2` for the production-client realm. App Review remains
exact schema version 1 and cannot parse or render an external launch.

Public V3 records use an exact destination discriminant. External Public items
have opaque IDs matching `external-[0-9a-f]{32}` and use the native-only route
`/external-miniapp/[resourceId]`; no URL enters route parameters. Internal
items remain under `/apps/[slug]` and retain their Universal Links. AASA does
not include the external route, remains CaboHealth-only, and the Expo config
retains `applinks:cabohealth.org` plus exact
`WKAppBoundDomains: ["cabohealth.org"]`.

The external route re-resolves current catalog authority every render and
latches the first authorized ID/URL. Removal, deactivation, destination-class
change, URL replacement, or route-ID change makes the state terminally
unavailable and unmounts the WebView. External VIP routes retain the existing
refresh-before-launch generation boundary: foreground checking, resource
removal/deactivation, grant revocation/expiry, code replacement, account
deletion, errors, and route-generation changes clear the descriptor and
destroy the WebView. Retry advances the generation and obtains a fresh
descriptor; late results are discarded.

`createClientLaunchV2` receives only `{installationId,resourceId}` and returns
an exact broker/external union. Broker launches retain the fixed POST source and
app-bound WebView. External launches are allowed only in the
`production_client` realm, validate the Task 6 canonical URL policy and
120-second parser ceiling, and hold the URL only in transient launch state.
VIP previews, grants, route parameters, AsyncStorage-facing session state,
favorites, messages, logs, receipts, and audits remain URL-free.

Public catalog state is the explicit exception. A V3 external Public item
contains its canonical URL, and the published-catalog repository persists the
complete validated snapshot in AsyncStorage under
`@cabohealth_published_catalog_v3`. The repository has no standalone cache-clear
operation: only a valid newer-revision snapshot overwrites the cache. Network
failure, parse failure, and equal or lower revisions preserve it. A later valid
snapshot from which the Public item is absent overwrites the cache without that
URL; uninstalling or clearing app data removes it at the platform boundary.

The dedicated external WebView loads the exact canonical URL without an
`#embedded-*` fragment. `originWhitelist` is the selected origin; application
policy allows only safe same-origin HTTPS navigation and blocks cross-origin
redirects, popups, unsafe schemes, local/IP targets, and traversal. It never
calls `Linking.openURL`, `Share`, or a browser sheet, and adds no `onMessage` or
injected privileged JavaScript. Mixed content, file access, universal file URL
access, shared/third-party cookies, automatic windows, media capture,
geolocation, and link previews remain disabled. Only this WebView instance
sets `limitsNavigationsToAppBoundDomains:false`; internal and broker instances
remain app-bound.

Pinned `react-native-webview` 13.15.0 would otherwise send an
`originWhitelist` rejection to React Native `Linking` before the app can block
it. `patches/react-native-webview+13.15.0.patch` removes that escape: the shared
iOS/Android wrapper calls the application callback for generic blocked-state
UI and always returns `false` to native for the rejected load. The root
`postinstall` contract is exactly
`patch-package --error-on-fail --error-on-warn`, so a missing, stale, or
warning-producing dependency patch fails installation. Executable tests load
the installed patched wrapper and prove zero Linking effects. Do not remove or
rebase the patch without pinning a reviewed upstream equivalent and repeating
native build review.

The schema-V2 grant parser's sole legacy-copy exception requires the complete
authoritative `client-resources` tuple: ID `client-resources`, access `client`,
native icon `sparkles-outline`, title `Client Resources` / `Recursos para
clientes`, and summaries `Complimentary educational resources for eligible
existing CaboHealth clients.` / `Recursos educativos incluidos para clientes
actuales elegibles de CaboHealth.` Only validation substitutes the approved
neutral summary; returned copy is unchanged. Every near-match remains subject
to the ordinary URL/credential/commercial-copy rejection policy.

VIP gating controls only CaboHealth's in-app entry point. It does **not** make a
third-party website private, and it does not prevent someone who independently
knows the URL from opening that site elsewhere.

## Build inputs

The EAS profile supplies `APP_ENV` (`development`, `staging`, or `production`).
`staging` remains fail-closed dormant capability and has no authorized cloud
project. A production build environment must additionally supply:

- `CABOHEALTH_GOOGLE_SERVICES_PLIST`: a file-type environment variable pointing
  to that environment's `GoogleService-Info.plist`.
- `CABOHEALTH_FIREBASE_PROJECT_ID`: the expected dedicated project ID. It must
  begin with `cabohealth-` and exactly match `PROJECT_ID` in the plist.

The plist `BUNDLE_ID` must be `com.cabohealth.app`. Staging and production
configuration fails before native compilation if any required input is missing
or mismatched. Production additionally rejects every project ID except the
exact `cabohealth-owner-prod`; no staging credentials are authorized. The EAS
production profile explicitly selects the `production` variable environment
and Node `22.22.3`.

The iOS build intentionally keeps React Native Firebase on CocoaPods with
static framework linkage. React Native Firebase 26 defaults to Swift Package
Manager, but its Firebase products cannot be combined with
`use_frameworks! :linkage => :static` without duplicate native symbols. The
Expo app plugin therefore sets `ios.disableSPM: true`; generated Podfiles must
contain `$RNFirebaseDisableSPM = true` before the application target while
`expo-build-properties` retains `useFrameworks: static`. The native-config
regression test pins both settings. Do not remove either side or switch linkage
without a new native build review.

React Native Firebase `26.3.2` is deliberately kept instead of rolling back to
`26.2.0`: version `26.3` contains the framework-module include correction needed
by this static-framework setup. Its published iOS sources have a separate
TurboModule constants return-type regression: the App, Utils, and Auth
implementations still use `Constants::Builder`, while their generated protocols
require `Constants`. The two version-scoped files in `patches/` align those six
signatures without changing the constants dictionaries or runtime behavior.
`postinstall` applies them with warnings and failures treated as fatal, and the
iOS codegen parity test prevents an unpatched EAS install. Remove these patches
only after adopting a published upstream release that contains the same App,
Utils, and Auth corrections and completing a new native build review. See
upstream issues [#9206](https://github.com/invertase/react-native-firebase/issues/9206),
[#9212](https://github.com/invertase/react-native-firebase/issues/9212), and
the still-open App/Utils fix [#9220](https://github.com/invertase/react-native-firebase/pull/9220).

The native bundle also imports the frozen public contact record at
`release/public-contact-facts.json`. `.easignore` must retain exactly that
public runtime file while continuing to exclude `release/private/`, App Store
evidence, and every other release artifact. The upload-context regression test
uses the archive-copy implementation from the pinned EAS CLI—not a separate
ignore-rule approximation—and proves that the copied record has the same
SHA-256 while representative private and App Store evidence files stay out.
Before relaunching a failed release, also use EAS `build:inspect` at the
`archive` stage against the complete project as an operational cross-check.

`app.json` remains the static, reviewable source of the public Expo config.
`app.config.js` receives that resolved object through Expo's `{ config }`
argument and adds only the environment-bound native Firebase fields. Do not
reload `app.json` manually in the dynamic config: that bypasses Expo's config
composition contract and triggers a preflight warning. `expo-font` is direct
and version-compatible because `@expo/vector-icons` requires its native peer.
The release tooling intentionally retains `eas-cli` as an exact local
development dependency: the guard hashes its complete runtime tree and the
Node executable before it can build or upload. `eas.json` independently pins
the same exact CLI version. Expo Doctor's generic warning against a local EAS
CLI is therefore an acknowledged exception, not permission to remove or
upgrade this reviewed toolchain.

Expo Doctor also reports the existing SDK-recommended drift for Expo core,
Router, Constants, Linking, Gesture Handler, Screens, and Worklets. Keep that
signal visible; do not silence it with `expo.install.exclude` or run a bulk
`expo install --fix` during the RC freeze. Those native dependency changes need
their own candidate, clean prebuild, complete test pass, and signed-archive
review.

Both Expo configuration and the release guard use the same strict XML plist
reader. It requires one root dictionary, one ordinary-text `PROJECT_ID`, and
one ordinary-text `BUNDLE_ID`; duplicate, nested, non-string, commented/CDATA-
split, malformed, custom-entity, or multiple-root identity representations fail
closed. The parser is a direct exact dependency, and release tests also require
the installed EAS dependency tree to be valid rather than checking versions
alone.

Before the guarded RC build, the same plist must exist locally outside Dropbox
as an owner-only regular file with mode `0600`. The build-input attestation pins
its raw SHA-256, the exact production project ID, and a sanitized resolved Expo
configuration whose private path is replaced by a fixed marker. Xcode compiles
that XML plist into a binary plist inside the signed app, so the build-artifact
attestation retains the raw hash of the extracted binary file and proves that
its complete parsed dictionary is exactly equal to the input dictionary. A raw
XML-versus-binary hash comparison is not a content comparison. The attestation
also retains the signing-certificate and embedded-provisioning-profile
fingerprints. No private path or plist content enters Git. A development build
without these inputs remains intentionally locked.

`CABOHEALTH_APP_CHECK_DEBUG=true` is accepted only for `APP_ENV=development`.
Use debug providers only with local/emulator development and never register a
debug token in the production project. Do not place a debug token in `eas.json`,
Expo `extra`, source code, application logs, or a plist, and never enable the
debug provider in staging or production.

## Attestation and calls

Production configures Apple App Attest with DeviceCheck fallback. Android uses
Play Integrity. Debug providers require the explicit development-only switch.
Every callable is constructed with `limitedUseAppCheckTokens: true` because the
backend consumes App Check tokens for replay protection.

The installation identifier is 256 bits from `expo-crypto` and is stored only
in `expo-secure-store` using an iOS this-device-only accessibility class.
Request IDs use fresh cryptographic random values. Submitted access codes and
Firebase custom/refresh tokens are never written by application storage code;
Firebase Auth owns its native credentials.

## Verification

Expo Go cannot load React Native Firebase native modules. Use an EAS development
build for integration and a physical-device TestFlight build to verify real App
Attest. An emulator/debug-provider pass does not prove production attestation.
The `development` EAS profile targets the iOS simulator; use
`eas build --platform ios --profile development-device` for an installable
development client on a registered physical iPhone.

Before a release:

1. Run `npm test`, `npm run typecheck`, and `npm run expo:config` without native
   credentials; the public config must report client access disabled.
2. Resolve the exact production config with its private file/project inputs and
   confirm the plugins and matching `cabohealth-owner-prod` project ID before
   the guarded RC build. Keep preview/staging client access locked.
3. Build a clean development client after adding native modules; an older Expo
   development client cannot acquire them through an OTA update.
4. Verify invalid/revoked/expired codes, foreground refresh, Remove Access,
   Delete Account, replay rejection, and locked offline behavior.
5. Verify App Attest on the exact TestFlight release candidate before marking
   the App Store release ready.
6. Export the Xcode archive privacy report and confirm that CocoaPods privacy
   manifests were aggregated. Reconcile the report, the app manifest, and App
   Store Connect against the deployed backend's actual User ID, Device ID, and
   diagnostics collection: no tracking and app functionality only. Any mismatch
   must block the release; do not guess the final data types before the backend
   review is complete.
7. Inspect the signed archive, not only the source config, with
   `codesign -d --entitlements :- Payload/CaboHealth.app` after extracting the
   IPA. Confirm `com.apple.developer.devicecheck.appattest-environment` is
   `production`, then exercise App Attest on a physical iPhone through
   TestFlight. A missing or altered signed entitlement must block release.

External-HTTPS rollback starts by deactivating external entries with new
monotonic catalog mutations, then verifying legacy build-7 responses. Stop
build-8 distribution and return to the prior native candidate if needed, but
retain external-aware Functions and Staff while any active or inactive external
record remains. Deactivation stops exposure; it does not make those records
parseable by pre-feature artifacts, whose stored-catalog parsers validate every
record.

Pre-feature Functions/Staff restoration is blocked unless a separately designed
and verified monotonic migration permanently purges every external record,
reconciles projections and all other authoritative references, handles every
outstanding catalog idempotency receipt without unsafe replay, and proves the
older parsers accept the complete retained state and exact legacy responses.
No current cleanup command is authorized here; without that migration and
evidence, rollback must stop. Never infer parser compatibility from the schema
number, restore an old catalog snapshot, add a third-party AASA/app-bound
domain, or weaken the WebView policy as a rollback.

The exact privacy-report, two-device QA, App Store Connect, and final screenshot
contracts are documented in
[`apple-post-build-evidence.md`](apple-post-build-evidence.md). Those validators
bind the observations to the signed IPA, TestFlight build, and frozen source;
they do not create or infer a successful result.

Official references:

- Expo, “Using Firebase”: <https://docs.expo.dev/guides/using-firebase/>
- React Native Firebase setup: <https://rnfirebase.io/>
- React Native Firebase App Check: <https://rnfirebase.io/app-check/usage/>
- Expo SecureStore: <https://docs.expo.dev/versions/v54.0.0/sdk/securestore/>
