# iOS protected-resource scope

The CaboHealth consumer candidate intentionally has no camera, photo-library,
microphone, location, or HealthKit feature. Its signed `Info.plist` must not
advertise a purpose string for a capability the app does not offer, and its
linked code must not reference the corresponding protected-resource APIs.

## External WebView boundary

External HTTPS miniapps do not expand this capability scope. Their dedicated
WebView denies media capture (`mediaCapturePermissionGrantType: 'deny'`) and
geolocation, disables file and universal-file URL access, mixed content,
shared/third-party cookies, automatic windows, link previews, native messaging,
and injected privileged JavaScript, and contains no browser or share escape.
Safe same-origin HTTPS navigation is allowed; cross-origin redirects, popups,
unsafe schemes, local/IP targets, and traversal are blocked in place. A
third-party site that needs a denied permission is unavailable inside
CaboHealth; the app does not grant the permission or open another browser.

An external page may create an inherited `about:blank` subframe only when its
frame metadata identifies it as a non-top-frame request whose parent document
is safe same-origin HTTPS. Missing metadata, a cross-origin parent, and a
top-frame blank request remain blocked. Rejected subframes are cancelled
silently so they cannot replace the parent with generic error UI; rejected
top-frame navigations and popups remain cancelled and show the existing blocked
state. External VIP launches use a nonblocking, accessible three-point loading
progress indicator while their page loads; broker launches retain their opaque
blocking loader. This introduces no browser handoff or privacy relaxation.

Only the external WebView instance opts out of app-bound-domain navigation.
The signed/static authority remains exactly
`WKAppBoundDomains: ["cabohealth.org"]`, AASA remains
`applinks:cabohealth.org` and CaboHealth-only, and the internal and broker
WebViews remain app-bound. No third-party hostname belongs in either authority.

Pinned `react-native-webview` 13.15.0 is patched so its shared iOS/Android
origin-whitelist rejection path never calls React Native `Linking`; it invokes
the application callback for generic blocked UI and always cancels the native
load. Root `postinstall` applies all version-scoped patches with
`patch-package --error-on-fail --error-on-warn`. A patch failure or warning is
an install failure, not a reason to continue with upstream browser handoff.

Public external routes contain only an opaque resource ID and re-resolve live
catalog authority. External VIP launch URLs exist only in a short-lived,
authorized in-memory launch descriptor. Foreground checking, deactivation,
revocation, expiry, code replacement, account deletion, and route-generation
changes tear down the WebView. VIP gating does **not** make the third-party site
private outside CaboHealth.

## Dormant SDK Photos exclusions

Expo SDK 54 resolves `expo-file-system` 19.0.21 transitively. That package's
legacy iOS module includes optional `ph://` and `assets-library://` copy paths,
even though CaboHealth neither declares nor imports `expo-file-system` and no
approved flow can supply either URI scheme. Those dormant paths import
PhotoKit, query `PHPhotoLibrary`, fetch `PHAsset` objects, and cause the final
binary to link `Photos.framework`.

Apple documents that App Review checks protected-resource references in app
and third-party SDK code even when the app does not call that code. The honest
choices are to provide an accurate purpose string for a real feature or remove
the protected-resource code. CaboHealth has no such feature, so the
production configuration excludes `expo-file-system` from iOS native
autolinking. CaboHealth does not declare or import this module; it is installed
only as a transitive Expo dependency. The exclusion removes the entire unused
native module instead of carrying modified SDK code.

ExpoModulesCore still embeds its `EXFileSystemInterface` protocol, legacy
utilities, and a diagnostic that names `expo-file-system`; those strings exist
even when the optional pod is absent. The signed-IPA gate therefore keys on six
module-owned SDK 54 signatures rather than those shared core strings. A known
linked diagnostic IPA contains all six, while the excluded production graph
contains none. Regression fixtures require every concrete signature to fail
closed and require the unavoidable core-only strings to pass.

`tests/ios-protected-resource-scope.test.mjs` binds the exclusion to the exact
19.0.21 transitive version, rejects a direct application dependency or import,
and runs Expo's own autolinking resolver to prove the package is absent from
the resolved Apple module graph. A clean install and the exact EAS archive must
reproduce that result.

RNFirebase App 26.3.2 independently shipped unused `PHAsset` helpers in
`RNFBUtilsModule` and declared `Photos.framework` in its podspec. No installed
RNFirebase package calls those class helpers. The version-scoped
`patches/@react-native-firebase+app+26.3.2.patch` therefore removes the PhotoKit
import, declarations, implementations, and framework declaration while
retaining the already-reviewed New Architecture return-type correction.
`tests/native-firebase-ios-codegen-patch.test.mjs` verifies both concerns and
fails if the protected PhotoKit surface reappears.

Before TestFlight upload, inspect the new signed IPA rather than trusting the
source patch alone:

1. confirm no photo-library usage-description key exists;
2. confirm neither the app executable nor its embedded frameworks link
   `Photos.framework` or contain `PHPhotoLibrary`/`PHAsset` symbols;
3. repeat the same static scan for camera, microphone, location, and HealthKit;
4. record the results and hashes in the private privacy report bound to the
   build-artifact attestation.

If external-link distribution is stopped, deactivate the entries through new
monotonic catalog mutations and return to the prior native candidate. Do not
roll back by adding purpose strings, enabling permissions, adding third-party
app-bound domains, removing the WebView patch, or restoring an older catalog
snapshot.

The successful EAS build `47b679f5-e0ff-49d5-9608-cd89f74024f5` was a
diagnostic build only: it exposed both dormant SDK paths and Xcode's binary
normalization of `GoogleService-Info.plist`. It was never uploaded to Apple and
must not be used as the release candidate.

Official Apple guidance:

- <https://developer.apple.com/documentation/UIKit/requesting-access-to-protected-resources>
- <https://developer.apple.com/documentation/bundleresources/information-property-list/nsphotolibraryusagedescription>
