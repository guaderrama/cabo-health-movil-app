# Protected overlay activation record — 2026-08-24

Status: **ACTIVE / HOSTING BOUNDARY VERIFIED**. This is a sanitized permanent
record. It intentionally excludes account names, server addresses, absolute
private paths, credentials, HMAC values, Ed25519 private keys, and raw logs.

## Released authority

- Release: `protected-overlays-v1-f3fc2ffb500f41dbfbf16dd4141eef3ccf87ef7055df63a2054b9cbe042b8213`
- Inventory SHA-256: `f3fc2ffb500f41dbfbf16dd4141eef3ccf87ef7055df63a2054b9cbe042b8213`
- Artifact SHA-256: `a0d40d4caf24b04d39e5b9277e17f6df1f277235b4e1b0a42769b47162112731`
- Activation SHA-256: `71a53785d9485097c670046730808035bc4a45e85b372ce83135db59a6bcdf31`
- Trust-policy SHA-256: `dafebae85cc86d28ada67a162455b55623428a784e432cb56152702e39816f0f`
- Evidence SHA-256: `763bb35ce0a7b320aabc8e8bcbb7231d91d375e4b3161fce33c6ad319ade657d`
- Predecessor: `protected-overlays-v1-b4514f277d691868e9b2274ec473aadf59fabd81d17feec875ad4b32f6c1f3d2`

The artifact contains nine production files and five App Review files. Both
realms were promoted in one transaction. The previous complete release remains
the separately pinned rollback authority; neither realm may be changed alone.

## Private boundary and transfer

The two broker HMAC configurations, backend factories, bilingual Client
Resources content, fixed non-clinical App Review sample, activation inputs,
signing keys, and evidence live outside the document root with the reviewed
fail-closed modes. Distinct HMAC and Ed25519 identities are used for production
and review. Secret values never entered Git, the public artifact, this record,
or the public web tree.

The owner authorized a Mac → controlled bridge → Hostinger transfer. SHA-256
was checked at each hop. The bridge copies, route credentials, one-shot web
routes, and raw Hostinger upload copies were deleted immediately after their
verified use. Both removed one-shot URLs returned 404.

## Attestation and tests

- The real serving runtime reported LiteSpeed with the independently pinned
  PHP 8.3 CLI, Sodium, cURL, and `proc_open`.
- Production harness output: `client resource broker: ok`.
- Review harness output: `app review broker: ok`.
- Both signed attestations were produced by authenticated empty POST requests
  through the same effective web handler as the protected endpoints.
- Evidence was reassembled independently on the controlled Mac and matched the
  Hostinger evidence byte for byte.
- Exact successor deployment verification passed after atomic promotion.
- Three production and three App Review invalid-nonce requests returned 401.

The first pre-successor App Review probe returned 503 because the Cloud Run
cold invocation took 3.6817 seconds while the PHP total timeout was 4 seconds.
IAM, Firestore, HMAC identity, response mapping, and cURL error policy were
excluded as causes. Both transports now retain the 1.5-second connect limit and
use a 12-second total limit, below the broker's 15-second server timeout. No
automatic redeem retry was added because a valid nonce may already have been
consumed before a network timeout.

## Operational rules

- Promote, verify, or roll back production and review only as one protected
  transaction with all six external pins above.
- Never hand-edit either live directory or put private inputs in `public_html`.
- Keep the six permanent path-only LiteSpeed variables; never retain one-shot
  attestation variables or credentials.
- The independent 17-file public release accepts either no protected pair or
  the exact complete pair, but does not attest their bytes.
- A hosting-boundary pass is not an Apple-submission pass. Valid credential,
  nonce/replay/revocation, reciprocal live isolation, account deletion,
  App Attest, TestFlight, and two-physical-iPhone checks remain required.
