# Public web production activation — 2026-08-24

## Status

The CaboHealth public web release is deployed and independently verified at origin, in a real browser, on the hosting filesystem, and through Apple's associated-domain CDN. This record covers only the 17-file public web authority. The protected Client Resources and App Review directories remain a separate, independently pinned release authority.

## Exact release authority

- Release: `web-v1-8ff48eacb692ff60889fbd7f6bea26174d9a85761c3a2b4d339a3745efff34ef`
- Public artifact SHA-256: `b198009b0e54048e0af7858dffedfaca90593ddfce11681fdb28b10768055287`
- Transport SHA-256: `966bf1c99ae21283f3571aaceec4124df7262e42b40a324d447b5d6e16f01052`
- Deployment-readiness SHA-256: `edb1856afb0fdc4d39e2f20d593e21bc7ed12553de8563dbad6f6a4b1ddf2a28`
- Exact deployed-source commit: `bfa17a1b9fc8fb0cb2106a043eae51f4cfef99a1`
- Deployment completion: `2026-08-24T03:20:15.982Z`

The source commit contains the exact five public HTML inputs that were not present in the prior commit, the exact artifact authority, and the reviewed deployment-readiness record. Every deployed HTML hash reconciles with the artifact at that commit.

## Completed verification

- The Hostinger descriptor-side inventory verified three public roots and exactly 17 authorized files. It accepts only the fixed pair `app-review` plus `client-resources` as additional `apps` directories; a single protected directory, a third sibling, a symlink, or an unsafe mode remains rejected.
- The sanitized server-inventory receipt had SHA-256 `3417b89e0a43fcf781c924def7ea823e8e24a283b283113ff4d38dda8d4e227f` before incorporation into the canonical production record.
- The origin verifier completed at `2026-08-24T13:51:51.563Z`: root `200`, unknown randomized slug `404`, 16 exact public responses, exact content types and body hashes, canonical links, required security headers, no cookies, and both retained-control checks.
- The browser runner completed at `2026-08-24T03:53:13.988Z` with 56 observations across both supported viewports, English and Spanish, JavaScript enabled and disabled, reduced motion, keyboard focus, navigation, and request/console checks. The externally reviewed measurement SHA-256 is `6de601cf854ee6dee867d434c7043939aade5900d2f9842ce0dfc6f91502ad99`.
- Apple's associated-domain CDN completed at `2026-08-24T13:52:02.127Z` with the exact AASA SHA-256 `b7625ae96a6391ed5c08519c79053d30b7d26b5109c571e5405433e9098da772`.
- Canonical sanitized evidence is `release/production-urls.json`, SHA-256 `3f1d130c68920c21ff170a07bbed143e926ced91f9f12bbc39e941439bd55c1f`. The offline verifier accepts it only with the reviewed release, artifact, and browser-measurement pins.

## Rollback and cleanup

The sanitized rollback alias is `rollback-v1-web8ff48eac-20260824`. It maps operationally to the retained predecessor and the completed private promotion/full-rollback rehearsal without exposing an account, server, or private path. The rehearsal proved predecessor promotion, successor promotion, reverse ordered rollback, and exact predecessor restoration. Retain the predecessor and private rehearsal receipts until App Review is complete and a separate retention decision is recorded.

The reviewed public verifier was copied through the approved SSH bridge with SHA-256 `51b478e9bd31de101bca8af1c03e50e63a846bda46462c298c2961e13e501e37`, executed outside the document root, and removed from both Hostinger's temporary area and the bridge after the sanitized receipt reached the Mac and its hash was verified. No credential, private route, account identity, raw header, cookie, or private filesystem path is stored in this record or the canonical production evidence.

## Remaining Apple gates

This activation closes the public web, hosted legal, AASA origin/CDN, and unrelated-file preservation gates. It does not create the iOS 3.0/build 4 release candidate, TestFlight evidence, App Attest proof, physical-iPhone QA, screenshots, final App Store Connect answers, rights signature, or the final time-limited submission authorization.
