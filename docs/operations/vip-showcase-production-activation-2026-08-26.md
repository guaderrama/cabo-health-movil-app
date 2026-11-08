# VIP showcase production activation — 2026-08-26

Status: **FIREBASE FUNCTIONS ACTIVATED / DEVICE QA PENDING**. This is a
sanitized operational record. It contains no credentials, secrets, access
codes, private URLs, private paths, personal information, or protected catalog
content.

## Deployment authority

- Source commit: `8a1cec5`
- Firebase project: `cabohealth-owner-prod`
- Functions codebase: `client-access`
- Firebase CLI: `firebase-tools 15.28.1`

The exact deployment dry run completed successfully before promotion. The
production selector was limited to these four Functions:

- `getPublishedCatalogV2`
- `adminCreateCatalogItem`
- `adminUpdateCatalogItem`
- `adminSetCatalogItemActive`

The Functions inventory contained 32 `ACTIVE` Functions before deployment and
33 `ACTIVE` Functions afterward. The three selected catalog mutation Functions
are `ACTIVE`.

## Runtime verification

The existing V1 `getPublishedCatalog` Function was not selected for deployment.
Its update time remained unchanged at
`2026-08-26T07:28:27.053462350Z`.

The new V2 `getPublishedCatalogV2` Function is `ACTIVE` with the following
verified runtime configuration:

- runtime: Node.js 22;
- region: `us-central1`;
- identity: dedicated service account;
- memory: 256 MiB;
- timeout: 30 seconds;
- maximum instances: 10;
- update time: `2026-08-27T05:30:53.264058264Z`.

Direct `curl` probes without App Check returned HTTP `401` for both V1 and V2.
This verifies the negative access boundary only; it does not constitute a
successful V2 response or end-to-end client verification.

## Preserved boundaries

This activation did not modify or deploy:

- Firestore data, indexes, rules, or migrations;
- secrets;
- the protected broker or its private content;
- the public website;
- the Apple App Site Association (AASA) authority.

No catalog migration was executed as part of this activation.

## Deliberately pending

CaboHealth 3.0/build 15 is the current candidate. Its live authority
phase—pre-input, input, artifact, RC, or submit-tool—must be determined from the
exact current pins and required attestation bytes. The rows below are immutable
freeze-time RC evidence requirements, not mutable phase claims; final
completion is authoritative only through the RC attestation and its bound
private evidence.

- Build 6 was built, exactly attested, processed, and activated for the internal
  TestFlight group. Its protected-resource launch used the prior native
  `pageSheet` presentation and is retained only as obsolete-source evidence.
  Build 7 replaced that presentation with a dedicated full-screen internal
  route and an in-app back control, but its EAS `FINISHED` binaries are now
  obsolete-source history. Build 8 added the external-HTTPS miniapps source,
  was built and uploaded, and is now immutable obsolete history. Build 9 was
  input-attested and then aborted before any provider operation. Build 10 was
  built, attested, uploaded, and processed for internal TestFlight; it is
  immutable history. Build 11 was built and exactly attested in EAS, then
  invalidated before upload by a mandatory post-artifact-pin gate failure; it
  is immutable non-uploaded history and cannot authorize build 15. Build 15 carries the WebView
  subframe fix; neither hands an internal launch to Chrome,
  Safari, or another external browser.
- Positive V2 catalog retrieval and complete VIP showcase QA require the exact
  signed candidate on a physical iPhone with its valid App Check flow.
- The corresponding Staff Portal release has not yet been promoted.
- This activation did not submit a build or release to App Review.

Nothing in this record claims TestFlight device validation, physical-device QA,
Staff Portal production parity, App Review submission, or Apple approval.
