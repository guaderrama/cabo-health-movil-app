# Public web production activation — 2026-08-24

## Status

The CaboHealth public web release is deployed and independently verified at origin, in a real browser, on the hosting filesystem, and through Apple's associated-domain CDN. This record covers only the 17-file public web authority. The protected Client Resources and App Review directories remain a separate, independently pinned release authority.

## Exact release authority

- Release: `web-v1-4a3e199b57be00b563dcf4d8e4d6f278b09872705981a0b39aad6a3a80b0f11b`
- Public artifact SHA-256: `79699e2a0b82ea24d8861cad67e7ee252320aec3777693a0c374a90312c7b943`
- Transport SHA-256: `8c1877cbd62e324ea9c650264f588b0aea5a6ca0877c647c95eb26bc7841d361`
- Deployment-readiness SHA-256: `f9dffa59e994449c64fec4f892f0d0f3e38ee641d70e9ea697eb74eeea52dcad`
- Exact deployed-source commit: `53dc5f668f11a595b2e697629547e88a82a829b5`
- Deployment completion: `2026-08-24T17:29:51.000Z`

The source commit contains the revised cited miniapp bytes, updated Privacy disclosure, exact artifact authority, immutable transport, and reviewed deployment-readiness record. The readiness record preserves the narrower assembly-time facts (`publicPromotionAuthorized: false`, `deployed: false`, and `appleReady: false`); the later owner authorization and completed deployment are proven by this dated activation record and the canonical production evidence. Every deployed payload hash reconciles with the artifact at that commit.

## Completed verification

- The Hostinger descriptor-side inventory verified three public roots and exactly 17 authorized files. It accepts only the fixed pair `app-review` plus `client-resources` as additional `apps` directories; a single protected directory, a third sibling, a symlink, or an unsafe mode remains rejected.
- The sanitized server-inventory receipt had SHA-256 `f94ad6f2e474ff4260f6bdef5ec8fdfaa50e158df42d3bbd530d8a01c5e29724` before incorporation into the canonical production record.
- The origin verifier completed at `2026-08-24T18:47:05.200Z`: root `200`, unknown randomized slug `404`, 16 exact public responses, exact content types and body hashes, canonical links, required security headers, no cookies, and both retained-control checks.
- The browser runner completed at `2026-08-24T18:40:57.585Z` with 56 observations across both supported viewports, English and Spanish, JavaScript enabled and disabled, reduced motion, keyboard focus, navigation, and request/console checks. It recorded zero unexpected requests and zero console errors. The externally reviewed measurement SHA-256 is `c656a1676fadd7cdf970fba91d0499934f9bf7f97bc8b25a926b8232ac7c473e`.
- Apple's associated-domain CDN completed at `2026-08-24T18:47:17.346Z` with the exact AASA SHA-256 `b7625ae96a6391ed5c08519c79053d30b7d26b5109c571e5405433e9098da772`.
- Canonical sanitized evidence is `release/production-urls.json`, SHA-256 `e0ccf1f573ca0be846db5526881abccc32f17e0a93d006ef1a5bb19770fd35dd`. The offline verifier accepts it only with the reviewed release, artifact, and browser-measurement pins.

## Rollback and cleanup

The sanitized rollback alias is `rollback-v1-web4a3e199b-20260824`. It maps operationally to the retained predecessor and the completed private promotion/full-rollback rehearsal without exposing an account, server, or private path. The rehearsal proved predecessor promotion, successor promotion, reverse ordered rollback, and exact predecessor restoration. Retain the predecessor, stage, file/database backups, and private rehearsal receipts until App Review is complete and a separate retention decision is recorded. The database backup was precautionary because this release changed no database state; its gzip, checksum, and structural listing were validated, but no SQL restore rehearsal is claimed.

The production controller was independently approved at SHA-256 `829276ab7b587c88ad4fbf758461f824abf7178660f9c2766412964ed25cc39e`; it pinned the reviewed helper SHA-256 `0831ac8fa527266d3b5524cb0e69ae895f985896a69a627f24b2083e8ae0ac3a`, manifest, transport, predecessor, and successor inventories. It executed outside the document root under an exclusive lock with durable attempt/verified markers and idempotent recovery. After the sanitized receipts reached the Mac and their hashes were verified, exactly seven named temporary copies were removed from the bridge. The private Hostinger uploads remain retained outside `public_html` because the cleanup authority was limited to bridge copies; they require a separate retention decision. No credential, private route, account identity, raw header, cookie, or private filesystem path is stored in this record or the canonical production evidence.

## Remaining Apple gates

This activation closes the public web, hosted legal, AASA origin/CDN, and unrelated-file preservation gates. It does not create the iOS 3.0/build 4 release candidate, TestFlight evidence, App Attest proof, physical-iPhone QA, screenshots, final App Store Connect answers, rights signature, or the final time-limited submission authorization.
