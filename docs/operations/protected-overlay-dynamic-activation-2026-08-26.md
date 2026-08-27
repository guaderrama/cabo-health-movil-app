# Protected dynamic overlay activation record — 2026-08-26

Status: **ACTIVE / DEPLOYED / HOSTING BOUNDARY VERIFIED**. This is a
sanitized permanent record. It intentionally excludes account names, server
addresses, absolute private paths, credentials, HMAC values, Ed25519 private
keys, session material, and raw logs.

## Released authority

- Release: `protected-overlays-v1-2a74817a88dd9122bd67f84fc46d280562f0014535a113c1810fbe82a78ea35b`
- Inventory SHA-256: `2a74817a88dd9122bd67f84fc46d280562f0014535a113c1810fbe82a78ea35b`
- Artifact SHA-256: `693b0a2aea47fd5588b061d46b0fc28ba56b0996e3fb9e049ca6b63066e422e5`
- Trust-policy semantic SHA-256: `4619add3ef8bbfd58789e3a18f3025b3f4b660d6ecfd547ef77d2f997ea866e2`
- Activation SHA-256: `5527545dec807a337d869f5b61d7a01cc32b8ca1345ab67af74e73bf18ae112b`
- Successor evidence-request SHA-256: `ecd5463d9b9a73f2cf3e9b1975434119ac3b5d8ece51375b5977ef18f828716b`
- Successor evidence SHA-256: `f9486e1044f124feeb91b373fad6df409773b752c937d1df4295df127f3a3f65`
- Historical-predecessor evidence-request SHA-256: `bc1026369e682eec4de15706485cf658d762409d785d338b886aa71f2fe120e2`
- Historical-predecessor evidence SHA-256: `8ee960f50aaa51d5bef1d05f7b13c82a6e3fa0b2a8d249c580bde20b52acc791`
- Historical predecessor: `protected-overlays-v1-f3fc2ffb500f41dbfbf16dd4141eef3ccf87ef7055df63a2054b9cbe042b8213`

The successor is the current live authority for production Client Resources
and the isolated App Review realm. Production private content uses
`structured-with-client-resources-fallback`: the structured
`client-resources/` locale pair is authoritative, while the exact historical
flat pair is retained only as the bounded rollback fallback. Private content,
factories, signing configuration, activation inputs, and signing keys remain
outside the document root with reviewed fail-closed modes.

## Immutable runtime pins

- Client Resources harness SHA-256:
  `c8977a71d740ac7be0a745548e0a0c3fc3904028a19fe4b460bdb2755a67ca21`
- Dynamic Client Resources harness SHA-256:
  `54a24413498d32e8981f83e14d7c34f78bb08407c68fd9a2ed5835d2d381f6c6`
- App Review harness SHA-256:
  `d30b39aa480a02897868ec33ca7f434adec8e833bce4e53e33c889095edf171b`
- Protected-overlay attestor SHA-256:
  `40811f2ea6f8e6b5e28d23db827c76233dac3b6d88b90afe3f7fa9b0d22b44b1`
- Retained root `.htaccess` SHA-256:
  `a59e899e7e85330c64f77d4775bae363bd60d5e19bcd3f7956790b9268742a13`

## Attestation and compatibility evidence

- Four signed LiteSpeed attestations, each retained read-only with mode `0400`,
  passed through the real serving handlers: successor production, successor
  App Review, historical-predecessor production, and historical-predecessor App
  Review.
- The authenticated one-shot mappings were removed after use; the retired
  paths returned 404 and no attestation mapping directory remained.
- The real PHP 8.3 CLI produced the exact outputs
  `client resource broker: ok`, `dynamic client resource broker: ok`, and
  `app review broker: ok` using only the bounded locale environment.
- Hostinger disables the PHP `symlink()` function in this handler. The dynamic
  harness therefore proved that the capability was absent and that no link or
  substitute path was created in that lane. The separate local/CI lane created
  a real symlink and proved runtime rejection; the live attestor also rejects
  any symlink in its measured inputs. Production runtime behavior was not
  weakened to accommodate the host restriction.
- Structured content and the retained flat fallback matched their complete
  immutable inventory. Directory/file modes, exact direct paths, resource IDs,
  locale pairs, hashes, hard-link counts, and source/runtime bytes passed the
  gate without drift.

## Promotion, rollback, and live checks

The full protected transaction completed in this order:

1. promote historical f3 to the dynamic successor and verify both realms;
2. roll the successor back to f3 and verify the rebound historical authority;
3. re-promote the exact archived successor and verify both realms again.

The final live release is the dynamic successor above. The exact historical f3
authority remains retained for general rollback; production and App Review
must continue to move only as one transaction.

Live HTTP checks returned the expected status for the public shell (`200`),
unauthorized EN and ES resource reads (`401`), client-selected resource-ID and
double-hyphen ID rejection (`400`), and invalid production/App Review nonces
(`401`). The expected no-store, CSP, Permissions-Policy, Referrer-Policy,
content-type, and frame protections were present. Unauthorized and malformed
requests disclosed no private content.

## Remaining Apple-release gates

This hosting activation is not an Apple-submission pass. The following remain
pending and must not be inferred from the negative live probes or PHP
harnesses:

- valid-credential launch and introspection on physical iPhones with App
  Attest/App Check;
- replay, expiry, revocation, reciprocal-realm isolation, and deletion/retry
  behavior through the complete valid flow;
- two-device App Review and Universal Link QA;
- the exact signed 3.0/build 7 release-candidate audit, TestFlight processing,
  screenshots, final App Store metadata/privacy reconciliation, and Apple
  review submission.

An immediate owner confirmation remains required before any future
**Submit for Review** action.
