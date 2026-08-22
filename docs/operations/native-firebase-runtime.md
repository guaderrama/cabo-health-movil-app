# CaboHealth native Firebase runtime

## Safety boundary

Client access is enabled only in an iOS or Android native binary whose embedded
Firebase project ID exactly matches the external build configuration and begins
with `cabohealth-`. Web, Expo Go, a missing service file, a malformed config,
an App Check initialization failure, or a project mismatch all keep Client
Resources locked.

This repository does not contain a Firebase app ID, API key, service plist,
debug token, backend secret, access code, or Firebase project alias. Do not
reuse a Firebase project owned by another app. Create dedicated CaboHealth
development/staging/production projects before enabling a build environment.

`expo-updates` is intentionally absent: the reviewed binary cannot be changed
by an undeclared over-the-air JavaScript update. Ship code changes through a
new signed App Store/TestFlight build unless a separately reviewed OTA policy
is added in a future release.

## Build inputs

The EAS profile supplies `APP_ENV` (`development`, `staging`, or `production`).
The build environment must additionally supply:

- `CABOHEALTH_GOOGLE_SERVICES_PLIST`: a file-type environment variable pointing
  to that environment's `GoogleService-Info.plist`.
- `CABOHEALTH_FIREBASE_PROJECT_ID`: the expected dedicated project ID. It must
  begin with `cabohealth-` and exactly match `PROJECT_ID` in the plist.

The plist `BUNDLE_ID` must be `com.cabohealth.app`. Staging and production
configuration fails before native compilation if any required input is missing
or mismatched. A development build without these inputs remains intentionally
locked.

`CABOHEALTH_APP_CHECK_DEBUG=true` is accepted only for `APP_ENV=development`.
Register only the development provider's generated device token in the
dedicated Firebase development project. Do not place a debug token in
`eas.json`, Expo `extra`, source code, application logs, or a plist, and never
enable the debug provider in staging or production.

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
2. Resolve the staging config with its file/project inputs and confirm the
   plugins and matching project ID.
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

Official references:

- Expo, “Using Firebase”: <https://docs.expo.dev/guides/using-firebase/>
- React Native Firebase setup: <https://rnfirebase.io/>
- React Native Firebase App Check: <https://rnfirebase.io/app-check/usage/>
- Expo SecureStore: <https://docs.expo.dev/versions/v54.0.0/sdk/securestore/>
