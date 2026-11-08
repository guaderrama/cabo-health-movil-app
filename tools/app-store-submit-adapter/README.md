# CaboHealth App Store submission adapter

Version `1.0.0` is a dependency-free, fail-closed Node `22.22.3` adapter for the
single reviewed candidate below:

- Apple app resource ID: `6758285327`
- bundle ID: `com.cabohealth.app`
- marketing version: `3.0`
- build number: `14`

The production entry point is `bin/submit.mjs`. It accepts only the exact
argument sequence produced by `scripts/release-command-guard.mjs`; no key,
token, password, or other credential is accepted on the command line. The
guard is responsible for pinning this entire runtime, snapshotting it outside
the synced workspace, validating the one-time human authorization, and
supplying the exact evidence hashes.

## What it proves before mutation

The adapter reopens every evidence file without following symlinks, requires
the current local user to own it, and checks its mode and SHA-256. Evidence it
parses—the two attestations, physical QA, App Store Connect evidence, and the
screenshot manifest—must be canonical compact UTF-8 JSON. Attestations preserve
schema key order; parsed post-build evidence and dry-run fixtures recursively
sort object keys. `app-privacy.json` and `review-notes.md` are instead treated
as opaque exact bytes: both the command-line hash and RC-bound hash must match
those reopened bytes. Private QA and App Store Connect evidence must be mode
`0600`; tracked attestations, the screenshot manifest, App Privacy answers, and
Review Notes must not be writable by group or other users.

It then requires all of the following cross-bindings:

1. Both attestations describe only the fixed candidate above, use the exact
   schemas expected by the release guard, and share one source-tree SHA-256.
2. The RC hash-binds the build artifact, physical-iPhone QA, App Store Connect
   evidence, screenshot manifest, App Privacy answers, and Review Notes passed
   on the command line.
3. Every post-build artifact uses the same numeric TestFlight build ID. App
   Store Connect evidence separately records Apple's opaque build resource
   ID (currently UUID-shaped); the live selected build must equal that ID.
   These two IDs are intentionally not conflated.
4. The live App Store Connect app has the exact bundle ID. Exactly one iOS 3.0
   version exists, its selected build is build 15, processing is `VALID`, the
   build is not expired, and the build belongs to the same app.
5. Before the adapter first mutates Apple state, the live App Store version
   equals the reviewed `PREPARE_FOR_SUBMISSION` or `READY_FOR_REVIEW` state.
   The sole recovery exception is an existing exact draft/item that explains
   the expected transition from reviewed `PREPARE_FOR_SUBMISSION` to live
   `READY_FOR_REVIEW`. Immediately before submit, the exact item and live
   version must both be `READY_FOR_REVIEW`.

All list endpoints reject incomplete pagination and ambiguous resources.

## Exact post-build evidence contracts

### `physical-iphone-qa.json`

Schema version 1 and artifact kind `cabohealth-physical-iphone-qa` require:

- exact candidate, TestFlight ID, source-tree SHA-256, `status: "passed"`,
  canonical `performedAt`/`reviewedAt`, no failures, and human sign-off;
- exactly two distinct pseudonymous devices (`opaqueId` is a SHA-256), one
  `clean` installation and one `upgrade` installation;
- for each device: model, iOS version, exact locales `en-US` and `es-MX`,
  `result: "passed"`, and an evidence SHA-256;
- these exact thirteen boolean checks, all `true`, corresponding in order to the
  thirteen rows in `release/app-store/3.0/testflight-what-to-test.md`:
  `firstLaunch`, `homeCatalogAndSaved`, `nativeToolsClinicalSafety`,
  `publicHosting`, `productionClientAccess`, `appReviewAccess`,
  `protectedWebView`, `externalWebView`, `ownerPortalExclusion`, `universalLinks`,
  `localizationAppearanceAccessibility`, `platformSecurityAndPrivacy`, and
  `scopeAudit`.

### `app-store-connect-evidence.json`

Schema version 1 and artifact kind
`cabohealth-app-store-connect-evidence` require the exact candidate and
TestFlight ID, `status: "ready-for-review"`, canonical capture/review times,
the fixed app resource ID, opaque App Store version ID, opaque App Store build
resource ID, reviewed version state, `VALID` build processing, no failures, and an
evidence-snapshot SHA-256. These exact metadata checks must all be `true`:

`localizations`, `privacy`, `ageRating`, `categories`, `availability`,
`contentRights`, `exportCompliance`, `appReviewInfo`, `reviewNotes`,
`screenshots`, `buildSelected`, and `dsa`.

The exact `ageRatingResult` must record
`questionnaireMatchedFreezeBaseline: true`, `unrestrictedWebAccess: true`,
`updatedGlobalRating: "16+"`, `legacyGlobalRating: "17+"`, and
`regionalResultsStatus: "not-asserted"`. This is only the saved global result.
The adapter does not assert regional rating values; Apple derives them.

### `screenshots-manifest.json`

The existing schema version 2 becomes
`status: "exact-rc-captured-and-approved"`. It must contain exactly sixteen
captures: each of the eight approved scene IDs once in `en-US` and once in
`es-MX`, in locale-major order (`en-US` scenes 01–08, then `es-MX` scenes
01–08). Every capture has the exact TestFlight ID, safe relative path,
SHA-256, canonical timestamp, PNG/JPG/JPEG format, and one Apple-supported
6.9-inch portrait size:

- 1260 x 2736
- 1290 x 2796
- 1320 x 2868

`requiredEvidence` must bind the TestFlight ID and source-tree SHA-256, repeat
the sixteen image hashes in capture order, and set both the OCR excluded-scope
check and human visual sign-off to `true`. Image alpha is verified by the
upstream screenshot producer because the adapter intentionally receives only
the manifest, not an image-root authority.

### `app-privacy.json` and `review-notes.md`

These two post-build metadata files are byte-bound rather than parsed by the
adapter. `app-privacy.json` contains the final JSON App Privacy answers, while
`review-notes.md` is Markdown. The adapter treats each as an exact byte artifact,
reopens it with the same regular-file and ownership protections, verifies its
command-line SHA-256, and requires the RC attestation to contain that identical
hash. Any byte change after RC review therefore stops submission.

## App Store Connect credentials

The production process reads only these environment variables:

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_KEY_KIND` (`team` or `individual`)
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_PATH`

`APP_STORE_CONNECT_ISSUER_ID` is required only for a `team` key and forbidden
for an `individual` key. Team JWTs use `iss`; individual-key JWTs use Apple's
fixed `sub: "user"` form. The path must be absolute, resolve without symlinks,
belong to the current user, have mode `0600`, and contain a PKCS#8 P-256 `.p8`
private key. Inline private-key variables are explicitly rejected. The ES256
JWT audience is `appstoreconnect-v1` and each token lasts 19 minutes. Neither
tokens nor Apple error bodies are logged.

The App Store Connect API key and its minimum sufficient role must be created,
downloaded, rotated, and revoked externally in App Store Connect. This package
does not create credentials and no `.p8` file belongs in the repository. Apple
documents API key management in [Creating API keys for App Store Connect
API](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api).

## Current review-submission flow

The adapter uses Apple's current review-submission resources, not the
deprecated App Store version submission endpoint:

1. Resolve the fixed app, unique iOS 3.0 version, selected build 15, and build's
   app relationship.
2. List active iOS review submissions. Multiple active submissions, a foreign
   item, unresolved issues, cancellation, or completion in progress all stop
   execution.
3. Reuse one exact `READY_FOR_REVIEW` draft or create a new draft. Add the
   exact App Store version only when it is absent.
4. List the draft items again, re-resolve the entire live identity, and read
   the draft immediately before mutation.
5. `PATCH /v1/reviewSubmissions/{id}` with `submitted: true`.
6. Read back an exact `WAITING_FOR_REVIEW` or `IN_REVIEW` state and list the
   final item binding. Anything else fails.

If the exact version is already `WAITING_FOR_REVIEW` or `IN_REVIEW`, the run is
idempotent: it verifies the live identity, submission, and item, reports
`already-submitted`, and performs no mutation. Network uncertainty never
causes the adapter to claim success; a later invocation can verify the state.

Official endpoint references:

- [Review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)
- [Create a review submission item](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems)
- [List App Store versions](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions)

## Deterministic dry run and tests

`bin/dry-run.mjs` takes `--fixture /absolute/path/to/fixture.json` followed by
the exact production arguments. The canonical fixture has this shape:

```json
{"artifactKind":"cabohealth-app-store-submit-dry-run-fixture","expectations":[],"now":"2026-08-25T20:00:00.000Z","schemaVersion":1}
```

Each expectation specifies exact `method`, `path`, optional request `body`,
HTTP `status`, and JSON `response`. Calls must match in order and every fixture
entry must be consumed. Dry run never loads credentials and never reaches the
network. The production guard must pin `bin/submit.mjs`, never the dry-run
entry point.

Run the isolated suite with:

```sh
npm test --prefix tools/app-store-submit-adapter
```
