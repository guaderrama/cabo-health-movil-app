# CaboHealth 3.0 (15) launch recovery

Current source is branch `codex/build15-review-recovery`, based on Claude's reviewed `3f064d1e11b95c9a14222ea0aed94a031d85c8ac`. The working copy is outside Dropbox at `/Users/ivan/.local/share/cabohealth/worktrees/build15-review-recovery`. The original build-14 checkout and Claude's branch remain unchanged.

Apple's November 5 build-14 rejection showed App Review Sample unavailable on iPhone and iPad. Local reproduction established device/server clock sensitivity; it did not establish the clock state of Apple's devices. The successor uses elapsed monotonic response time while the server continues enforcing nonce expiry, single use, App Check, and separate production/review realms.

The additional recovery fix discards a failed WebView launch before refreshing authorization and requesting a new descriptor. Broker errors, HTTP rejections, and renderer termination expose Retry as well as Back. Retry never calls WebView.reload or repeats a consumed POST. Authorization failure still prevents reopening.

Validation before release rebaseline: five new broker-recovery regressions failed on the prior source and all 22 focused route/WebView tests passed after the fix. Sixteen acceptance scenarios passed, including skew, cold-start latency, clock jumps, expired and consumed nonces, and a fresh successful retry. The acceptance npm command now uses an explicit Functions tsconfig path that works with npm 10. Native typecheck passed. Full-suite and signed-device results must be recorded separately, not inferred from these local checks.

The free personal-invitation wording matches the owner's confirmed business model. No paid tier, checkout, purchase requirement, authentication weakening, Firebase policy change, or protected-content change is introduced. Current source/content hashes were reviewed and re-pinned; the original build-14 input and artifact bytes remain under `release/app-store/3.0/history/build-14/`. All build-15 phase pins start empty and must bind newly generated evidence.

Operational access checked November 8: Expo account guaderrama; Apple Developer individual team DQ8PH2DZ3R, membership renewed through November 8, 2027, October 29 license accepted November 8; Staff authenticated; Hostinger authenticated and the existing SSH key successfully reached the CaboHealth hosting root. No new key or permission was created. Browser sessions can still expire.

At this source checkpoint build 15 has not been built, uploaded, physically validated, or submitted. Follow the exact release evidence and post-build checks; do not substitute build-14 QA or mark the successor approved by Apple.
