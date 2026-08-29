# Apple post-build evidence contracts

This runbook defines the only post-build evidence accepted for CaboHealth
3.0/build 8. The signed build 4 diagnostic evidence and exact build 5–7
attestations are retained only as obsolete historical records and cannot satisfy
this contract. The evidence tools validate and canonicalize observations that
already exist. They do not run a test, take a screenshot, query App Store
Connect, approve a result, or infer a missing value. A placeholder, omitted
field, extra field, false check, failed check, stale timestamp, mismatched
release identity, or unbound hash blocks the release.

The fixed candidate is:

- App Store app resource / Apple ID: `6758285327`;
- bundle identifier: `com.cabohealth.app`;
- marketing version: `3.0`;
- build number: `8`;
- Team ID: `DQ8PH2DZ3R`;
- Firebase project: `cabohealth-owner-prod`; and
- associated domain: `applinks:cabohealth.org`.

`scripts/apple-post-build-evidence.mjs` exports the four fail-closed validators
and provides an exclusive-create CLI. Canonical JSON has recursively sorted
object keys, preserved array order, UTF-8 encoding, and one final newline.
Private reports are created with mode `0600` in a current-user-owned mode
`0700` directory. The screenshot manifest is public metadata and is created
with mode `0644`. No output may already exist; this prevents an unnoticed
replacement of reviewed authority.

## Signed IPA privacy report

Create `privacy-report.json` from the signed IPA with the dedicated auditor in
[`exact-ios-ipa-audit.md`](exact-ios-ipa-audit.md). Do not hand-author this
report. Its exact v1 contract records the complete signed `.app` inventory,
IPA and signing hashes, the semantic source/embedded Firebase plist match,
production App Attest and associated-domain identity, every embedded privacy
manifest, and the protected-resource scan.

Acceptance requires `artifactKind: cabohealth-ipa-privacy-report`,
`status: passed`, `tracking: false`, all five sensitive-permission values
false, and empty sensitive-framework, forbidden-payload, and failure arrays.
The root privacy manifest and the FirebaseAuth privacy manifest must be present
in the sorted inventory. FirebaseAuth must declare only linked User ID for App
Functionality and unlinked Other Diagnostic Data for Apple's Analytics purpose,
with no tracking. The release guard revalidates this structure and binds its
internal hashes to the independently supplied IPA, certificate, entitlement,
profile, and Firebase plist files; a JSON file is not accepted merely because
its own SHA-256 was attested.

If canonicalization is independently repeated, every binding is mandatory:

```sh
node scripts/apple-post-build-evidence.mjs privacy-report \
  --input /ABS/PRIVATE/draft-privacy-report.json \
  --output /ABS/PRIVATE/rc-build-8/privacy-report.json \
  --ipa-sha256 <64-lowercase-hex> \
  --signed-entitlements-sha256 <64-lowercase-hex> \
  --signing-certificate-sha256 <64-lowercase-hex> \
  --embedded-provisioning-profile-sha256 <64-lowercase-hex> \
  --source-google-services-plist-sha256 <64-lowercase-hex> \
  --embedded-google-services-plist-sha256 <64-lowercase-hex>
```

## Physical-iPhone QA

The input must be a completed observation, not a plan. The exact v1 artifact
kind is `cabohealth-physical-iphone-qa`; status and both device results are
`passed`; `failures` is empty; and `humanSignOff` is true. `performedAt` and
`reviewedAt` are canonical millisecond ISO timestamps after TestFlight became
valid, with review not earlier than performance.

There are exactly two distinct pseudonymous devices. Each `opaqueId` is a
SHA-256 pseudonym rather than a serial number or advertising identifier. The
two installation modes are exactly one `clean` and one `upgrade`; each device
records a nonempty model, iOS version, locales exactly `en-US` then `es-MX`,
and a SHA-256 for its private supporting evidence.

All thirteen checks are present, no others are allowed, and every value is true:

`firstLaunch`, `homeCatalogAndSaved`, `nativeToolsClinicalSafety`,
`publicHosting`, `productionClientAccess`, `appReviewAccess`,
`protectedWebView`, `externalWebView`, `ownerPortalExclusion`, `universalLinks`,
`localizationAppearanceAccessibility`, `platformSecurityAndPrivacy`, and
`scopeAudit`.

After a human has filled every field from the two real devices, canonicalize it
with all RC bindings:

```sh
node scripts/apple-post-build-evidence.mjs physical-iphone-qa \
  --input /ABS/PRIVATE/observed-physical-iphone-qa.json \
  --output /ABS/PRIVATE/rc-build-8/physical-iphone-qa.json \
  --testflight-build-id <numeric-testflight-build-id> \
  --source-tree-sha256 <64-lowercase-hex> \
  --testflight-processed-at <canonical-millisecond-ISO-timestamp>
```

## App Store Connect evidence

The exact v1 artifact kind is
`cabohealth-app-store-connect-evidence`, with status `ready-for-review` and
empty `failures`. The app resource is exactly `6758285327`; version state is
`PREPARE_FOR_SUBMISSION` or `READY_FOR_REVIEW`; build processing is `VALID`;
and capture/review timestamps are canonical and ordered after TestFlight
processing. `evidenceSnapshotSha256` identifies the separately retained
private App Store Connect observation.

The numeric `testFlightBuildId` and App Store Connect `buildResourceId` are
different identifiers. The latter is the nonempty opaque/UUID resource ID
returned by the App Store Connect API. Never copy the TestFlight number into
`buildResourceId`. `appStoreVersionId` is likewise the nonempty opaque API
resource ID for the version.

All twelve metadata checks are present, no others are allowed, and every value
is true: `localizations`, `privacy`, `ageRating`, `categories`, `availability`,
`contentRights`, `exportCompliance`, `appReviewInfo`, `reviewNotes`,
`screenshots`, `buildSelected`, and `dsa`.

```sh
node scripts/apple-post-build-evidence.mjs app-store-connect \
  --input /ABS/PRIVATE/observed-app-store-connect.json \
  --output /ABS/PRIVATE/rc-build-8/app-store-connect-evidence.json \
  --testflight-build-id <numeric-testflight-build-id> \
  --testflight-processed-at <canonical-millisecond-ISO-timestamp>
```

## Final screenshots manifest

The checked-in `release/app-store/3.0/screenshots-manifest.json` legitimately
remains the exact empty `pending-exact-rc-capture` authority before an RC.
Finalization is accepted only as schema v2 with status
`exact-rc-captured-and-approved`. It contains exactly sixteen captures in this
fixed order: all eight `en-US` scenes, then all eight `es-MX` scenes:

`01-launch`, `02-resource-catalog`, `03-healthy-recipes`, `04-clinic-guide`,
`05-client-resources-locked`, `06-eligibility-code-entry`, `07-saved`, and
`08-settings-and-legal`.

Each capture contains only `locale`, `sceneId`, safe `relativePath`, `sha256`,
`width`, `height`, `format`, `capturedAt`, and `testFlightBuildId`. Files are
private mode `0600` PNG or JPEG bytes under
`screenshots/<locale>/iphone-6.9/`. Accepted portrait dimensions are exactly
1260x2736, 1290x2796, or 1320x2868. The validator decodes each file header,
rehashes its bytes, and rejects path traversal, links, dimension drift, format
drift, duplicate paths, wrong order, or capture before TestFlight processing.

`requiredEvidence` contains the numeric TestFlight ID, exact RC source-tree
SHA-256, sixteen image hashes in the same order as `captures`, and true values
for both `ocrExcludedScopeCheck` and `humanVisualSignOff`.

The producer refuses to overwrite the pending authority. First write an absent
review file, inspect its exact diff, and only then replace the pending manifest
as a separately reviewed release change:

```sh
node scripts/apple-post-build-evidence.mjs screenshots \
  --input /ABS/PRIVATE/observed-screenshots-manifest.json \
  --output /ABS/REPO/release/app-store/3.0/screenshots-manifest.reviewed.json \
  --testflight-build-id <numeric-testflight-build-id> \
  --source-tree-sha256 <64-lowercase-hex> \
  --testflight-processed-at <canonical-millisecond-ISO-timestamp> \
  --evidence-root /ABS/PRIVATE/rc-build-8
```

The metadata verifier accepts only the exact current pending form or the exact
file-backed final form. In final form it also requires the private RC
attestation, identical manifest hash and RC bindings, and all sixteen real
image files. The final RC guard independently revalidates the QA, App Store
Connect, and screenshot artifacts before the submit adapter may consume them.
Passing these contracts does not itself authorize `Submit for Review`; the
separate, short-lived owner confirmation remains the final control.

## Focused verification

```sh
node --test \
  tests/apple-post-build-evidence.test.mjs \
  tests/ios-ipa-audit.test.mjs \
  tests/release-command-guard.test.mjs \
  tests/app-store-metadata.test.mjs

node scripts/verify-app-store-metadata.mjs
```
