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

The native bundle also imports the frozen public contact record at
`release/public-contact-facts.json`. `.easignore` must retain exactly that
public runtime file while continuing to exclude `release/private/`, App Store
evidence, and every other release artifact. The upload-context regression test
pins this exception. Before relaunching a failed release, use EAS
`build:inspect` at the `archive` stage and confirm that the copied record has
the same SHA-256 as the tracked source and that no private/evidence path entered
the archive.

Both Expo configuration and the release guard use the same strict XML plist
reader. It requires one root dictionary, one ordinary-text `PROJECT_ID`, and
one ordinary-text `BUNDLE_ID`; duplicate, nested, non-string, commented/CDATA-
split, malformed, custom-entity, or multiple-root identity representations fail
closed. The parser is a direct exact dependency, and release tests also require
the installed EAS dependency tree to be valid rather than checking versions
alone.

Before the guarded RC build, the same plist must exist locally outside Dropbox
as an owner-only regular file with mode `0600`. The build-input attestation pins
its SHA-256, the exact production project ID, and a sanitized resolved Expo
configuration whose private path is replaced by a fixed marker. The build
artifact attestation must then prove that the plist extracted from the signed
IPA has the same hash and must retain the signing-certificate and embedded
provisioning-profile fingerprints. No private path or plist content enters Git.
A development build without these inputs remains intentionally locked.

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

Official references:

- Expo, “Using Firebase”: <https://docs.expo.dev/guides/using-firebase/>
- React Native Firebase setup: <https://rnfirebase.io/>
- React Native Firebase App Check: <https://rnfirebase.io/app-check/usage/>
- Expo SecureStore: <https://docs.expo.dev/versions/v54.0.0/sdk/securestore/>
