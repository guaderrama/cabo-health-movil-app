# Exact iOS IPA audit

`scripts/audit-ios-ipa.mjs` is the fail-closed, post-build gate between an EAS
artifact and TestFlight. It audits the exact local IPA bytes; it does not build,
upload, submit, change release pins, or contact Apple.

## Inputs and private handling

The IPA and the source `GoogleService-Info.plist` must be absolute, regular,
non-symlink paths with no group or world permission bits. The output path must
be absolute and absent. Every immediate output directory must be owned by the
current user and have exact mode `0700`. The auditor refuses to replace an
existing output.

Extraction happens under a newly created mode `0700` directory with prefix
`cabohealth-ipa-audit.` in the operating-system temporary directory. Archive
names are checked for absolute paths, traversal, controls, backslashes,
duplicates, case-folding collisions, excessive length, and excessive count
before extraction. The extracted tree rejects symlinks, hard-linked files,
special files, paths outside the temporary root, and bounded-size violations.
Every extracted path is made owner-only. The temporary directory is removed in
a `finally` block after either success or failure.

The canonical JSON evidence contains only public release identities, hashes,
structured privacy declarations, and pass/fail inventories. It never serializes
Firebase API keys, client IDs, the complete service plist, certificate subject
names, private absolute paths, or temporary paths. CLI errors are stable codes,
not command output.

## Required validations

The audit fails unless all of the following are true:

- macOS `codesign --verify --deep --strict` accepts the extracted app;
- the signed identifier and Team ID match the expected App Store identity and
  the leaf signing authority is an Apple distribution identity;
- `CFBundleIdentifier`, marketing version, build number, and executable match;
- the signed app is iPhone-only (`UIDeviceFamily=[1]`), has
  `MinimumOSVersion=15.1`, and declares
  `ITSAppUsesNonExemptEncryption=false` exactly;
- the signed entitlements are the exact production set: application and Team
  identifiers, one approved associated domain, production App Attest,
  `get-task-allow=false`, and `beta-reports-active=true`;
- the app-bound web domains exactly correspond to the associated-domain hosts;
- the embedded App Store provisioning profile is unexpired, distribution-only,
  has the expected Team/application capabilities, and contains the exact leaf
  signing certificate;
- the complete parsed dictionary of the embedded binary/XML
  `GoogleService-Info.plist` equals the private source plist and its public
  Firebase project and bundle identities match;
- a root `PrivacyInfo.xcprivacy` exists, every embedded privacy manifest parses,
  and the canonical inventory contains its collected-data and required-reason
  API declarations;
- the FirebaseAuth manifest is present and declares exactly linked User ID for
  App Functionality plus unlinked Other Diagnostic Data for Apple's Analytics
  purpose, with neither data type used for tracking;
- no manifest declares tracking, tracking domains, or protected photo, audio,
  location, health, or fitness data;
- no protected-resource purpose string, entitlement, linked framework, symbol,
  package marker, resource name, or payload string is found for Photos, camera,
  microphone, location, HealthKit, or Expo FileSystem; and
- neither the dormant miniapp development panel nor a CaboHealth Staff URL is
  present anywhere in the consumer payload.

The byte scan checks both UTF-8/ASCII and UTF-16LE representations and includes
the app executable, embedded frameworks, resources, and code-signing inventory.
This complements, rather than replaces, the source/autolinking tests.

## Final-RC invocation

Use the new, never-uploaded final IPA only after its download hash has been
recorded. Do not use the diagnostic IPA described in
`ios-protected-resource-scope.md` as the release candidate.

```sh
umask 077

node scripts/audit-ios-ipa.mjs \
  --ipa /ABS/PRIVATE/CaboHealth-3.0-build-14.ipa \
  --google-services-plist /ABS/PRIVATE/GoogleService-Info.plist \
  --bundle-id com.cabohealth.app \
  --version 3.0 \
  --build 14 \
  --team-id DQ8PH2DZ3R \
  --firebase-project-id cabohealth-owner-prod \
  --app-attest-environment production \
  --associated-domain applinks:cabohealth.org \
  --generated-at 2026-08-25T22:00:00.000Z \
  --output /ABS/REPO/release/private/rc-build-14/privacy-report.json \
  --attestation-input-dir /ABS/REPO/release/private/rc-build-14
```

On success the only stdout line is:

```text
IPA_AUDIT_PASS <sha256-of-canonical-evidence>
```

`--generated-at` is required and must be a canonical millisecond ISO timestamp
supplied by the audited build/evidence workflow. The auditor never calls
`Date.now()` to populate evidence, so identical inputs and the same explicit
timestamp produce identical canonical JSON bytes.

The report uses the exact `cabohealth-ipa-privacy-report` v1 contract consumed
by the post-build verifier. The platform, deployment-target, and export-encryption
checks gate that report without changing its canonical schema. In addition to
the signature and Firebase hashes,
it contains the complete sorted inventory of regular files inside the `.app`
(relative path, byte size, and SHA-256), the sorted privacy-manifest inventory,
five explicit `false` sensitive-permission values, `tracking:false`, empty
forbidden-framework/payload/failure arrays, and status `passed`.

With `--attestation-input-dir`, the auditor also writes these exact mode `0600`
inputs expected by the existing build-artifact attestation:

- `signed-entitlements.plist`;
- `embedded-GoogleService-Info.plist`;
- `signing-certificate.der`; and
- `embedded.mobileprovision`.

All five destination names must be absent before the command. The four raw
inputs are created first and the canonical report last; files created by the
invocation are removed if any creation fails, and destination directories are
`fsync`ed. The IPA itself is never changed or copied by this tool.

The build-artifact attestation must independently bind the canonical report,
the four raw inputs above, the exact IPA hash, the EAS build ID, and the already
pinned build-input/source attestation. Passing this audit alone does not
authorize a TestFlight upload.

## Verification

Run the focused deterministic suite before the final IPA audit:

```sh
node --test tests/ios-ipa-audit.test.mjs
```

The fixtures contain no production credential. They cover a valid signed-app
shape, semantic Firebase drift, signature and entitlement mismatch, App Attest
and associated-domain mismatch, every forbidden capability category, tracking,
privacy-manifest inventory, private output permissions, exclusive creation,
and temporary-directory cleanup.

ExpoModulesCore itself contains the `EXFileSystemInterface` protocol, legacy
utilities, and a diagnostic telling developers to link `expo-file-system`.
Those core-only strings are not evidence that the optional module is present.
The payload gate therefore rejects concrete module-owned signatures such as
its CocoaPods dummy class, Swift module type, source-path marker, and privacy
bundle. The focused suite proves both sides: the core-only strings pass, while
an actual module signature fails closed.

The already-built diagnostic IPA is a useful negative control only. The auditor
must reject it and must create no evidence output; it is known to contain both
the linked Expo FileSystem module and dormant PhotoKit code.
