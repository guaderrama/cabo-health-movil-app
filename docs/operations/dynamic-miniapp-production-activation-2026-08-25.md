# Dynamic miniapp production activation — 2026-08-25

## Sanitized status

This record separates the production components that were activated and
verified from the remaining release gates. It contains no credential, access
code, account identifier, HMAC value, private host, private path, session,
nonce, or catalog content body.

The dynamic public catalog control plane and dynamic protected broker are
active. Protected release
`protected-overlays-v1-2a74817a88dd9122bd67f84fc46d280562f0014535a113c1810fbe82a78ea35b`
is the verified production/App Review authority. The signed iOS 3.0 build 4 is
retained only as obsolete diagnostic evidence; it is not the next release
candidate. Build 5 was later built, attested, processed in TestFlight, and
selected in App Store Connect, but is obsolete for the rebaselined VIP source.
Build 6 was later built, exactly attested, processed, and activated for the
internal TestFlight group, but is obsolete for the full-screen VIP navigation
source. Build 7 later produced two EAS `FINISHED` builds for obsolete
external-HTTPS source; one has preserved historical build-input and artifact
attestations. That EAS status proves build completion only, not TestFlight or
App Store Connect processing. Build 8 was subsequently built, exactly attested,
uploaded, observed Ready to Submit, and made available to the existing internal
group; it is immutable obsolete history for the WebView subframe fix. Build 9 was input-attested and then aborted before any
provider operation when mandatory post-pin tests exposed phase-stale release
gates. Build 10 was built, attested, uploaded, and processed for internal
TestFlight. Build 11 was built and exactly attested in EAS, but mandatory post-artifact-pin gates exposed a phase-stale synthetic test fixture before upload; it is immutable non-uploaded history and cannot authorize build 15. CaboHealth 3.0 build 15 is the current
candidate. Its live authority phase—pre-input, input, artifact, RC, or submit-tool—must be determined
from the exact current pins and required attestation bytes. This document does not assert a particular
live phase or infer any provider result, physical-device QA, submission, or Apple approval.

## Active and verified components

- Firebase Functions: all 32 expected Node.js 22 Functions are `ACTIVE` in
  `us-central1` under the dedicated runtime identity. The six additive catalog
  callables are `adminCreateCatalogItem`, `adminDeleteCatalogItem`,
  `adminListCatalogItems`, `adminSetCatalogItemActive`,
  `adminUpdateCatalogItem`, and `getPublishedCatalog`.
- Firestore: the production and named App Review database configurations were
  deployed. The `_private_catalog_requests/expiresAtMs` TTL policy is active.
  The exact production migration plan had SHA-256
  `a194c06154ceafcbf5c2f4539578485f5f8ec5bd93fc2a9a806e9a67db8e9383`
  and created the three reviewed revision-1 entries: public
  `healthy-recipes`, public `clinic-guide`, and protected
  `client-resources`. A post-read found the catalog current with no skipped
  operation.
- Staff Portal: release
  `staff-v1-86d9cf222c17893b939acb2c84b9adc3340429d821d23280e4572a2fb40e302b`
  is active. Its inventory SHA-256 is
  `8f8a3743c52c5972b2dd8cd68898d47ee9fa55a8a42fa653edf6f6d72d24ef15`
  and artifact SHA-256 is
  `3a7cbd92ac28ad7b3b644ffb54bf40b8eaa7a140c32b3c081a939bffb6af2f97`.
  The eight exact files, protected 404, required security headers, content
  types, and no-cookie responses passed the external verifier. The preceding
  complete `e846…` Staff directory remains retained for rollback. The
  successor and the current 32/32 Functions deployment enforce the same exact
  four permanently retired catalog IDs across stored catalog data, grants,
  refresh, launch, navigation, and Staff mutations.
- Public web and AASA: release
  `web-v1-40869f4a540a56c420b198aea0fdf58a21053646d280d89ad64d105fd1808948`
  is active. Its canonical manifest SHA-256 is
  `2ab49eb8e2d47293cb72d2e7aa34134a2a32b7e5fe38f8cdc8ad6c3e5e807f7e`
  and transport SHA-256 is
  `3dcdbf88900ff4d93691f36cf2fbeedbd1dc08298f55640574368ea7ea813312`.
  The successor differs from its predecessor only in the ordered
  nine-component AASA authority. Exact inventory, rollback rehearsal,
  production promotion, origin responses, retained controls, and unrelated
  WordPress content checks passed. Origin and Apple's associated-domain CDN
  both returned the exact AASA SHA-256
  `e721827da1fe77d4a34247c9c2c515db73614545c6fb20e03f52b25e8594beae`.
- Public catalog: the production callable returns only active validated public
  entries. The iOS implementation consumes that catalog through App Check,
  keeps only a last-valid local snapshot, and fails closed for malformed,
  withdrawn, or unknown entries. The separately hosted Staff Portal contains
  the owner CRUD controls; it is absent from the consumer binary.
- Protected broker: the dynamic structured-content successor is active in
  production and the isolated App Review realm. Four real-handler LiteSpeed
  attestations passed, then the exact successor completed promotion,
  verification, rollback to historical f3, historical verification,
  re-promotion, and final verification. Live unauthorized locale reads,
  browser-selected and malformed resource IDs, and both realms' invalid nonces
  failed closed. The exact sanitized pins are in
  [`protected-overlay-dynamic-activation-2026-08-26.md`](protected-overlay-dynamic-activation-2026-08-26.md).

## Deliberately pending

- Valid-credential launch/introspection, replay, expiry, revocation,
  reciprocal-realm isolation, and deletion/retry behavior still require the
  complete App Attest/App Check flow on physical iPhones. The deployed
  real-handler attestations, PHP harnesses, invalid-input probes, and rollback
  verification do not substitute for that valid-flow device evidence.
- The official multi-browser measurement for the AASA-only successor and
  physical-iPhone Universal Link verification remain pending. Origin/CDN byte
  verification is complete; it is not a substitute for device behavior.
- A controlled production owner CRUD exercise with a non-sensitive temporary
  entry and cleanup remains separate from the component activation evidence.
- Build 15 may advance only through the live fail-closed authority sequence.
  Exact pins and required attestation bytes identify the completed phase; no
  later build, IPA audit, TestFlight, QA, screenshot, metadata, privacy/age,
  rights, or Apple-review outcome may be inferred from this component record.

Nothing in this record claims physical-device QA, TestFlight readiness, App
Store submission, or Apple approval. A separate immediate owner confirmation
is still required before any future **Submit for Review** action.
