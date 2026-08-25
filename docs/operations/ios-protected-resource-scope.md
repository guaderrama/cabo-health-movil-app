# iOS protected-resource scope

The CaboHealth consumer candidate intentionally has no camera, photo-library,
microphone, location, or HealthKit feature. Its signed `Info.plist` must not
advertise a purpose string for a capability the app does not offer, and its
linked code must not reference the corresponding protected-resource APIs.

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

The successful EAS build `47b679f5-e0ff-49d5-9608-cd89f74024f5` was a
diagnostic build only: it exposed both dormant SDK paths and Xcode's binary
normalization of `GoogleService-Info.plist`. It was never uploaded to Apple and
must not be used as the release candidate.

Official Apple guidance:

- <https://developer.apple.com/documentation/UIKit/requesting-access-to-protected-resources>
- <https://developer.apple.com/documentation/bundleresources/information-property-list/nsphotolibraryusagedescription>
