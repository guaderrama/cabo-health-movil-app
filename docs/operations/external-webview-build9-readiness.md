# External WebView build 9 source readiness

> **SOURCE READINESS ONLY — NO BUILD 9 AUTHORITY EXISTS.** There is still no
> new build number, EAS build, IPA, TestFlight upload, Apple-state change, or
> build-9 attestation. This record does not reuse or extend build-8 authority.

## Scope and reviewed source

This handoff records only source readiness for a future, separately authorized
build-9 release rebaseline. It is based on these reviewed commits:

| Purpose | Commit |
| --- | --- |
| Build-8 artifact-attestation authority commit | `ec11ebed2de7c7d7103355c2a635bb5478ea191b` |
| Build-8 attested frozen source commit | `288ff2185c46fee117555ae0842a4a63c34df938` |
| Plan and design/specification | `43e82b9` |
| Safe inherited subframe fix | `663380d` |
| VIP external-loading progress fix | `d008594` |
| Plan adjustment for build-8 authority | `7bb1568` |
| Release-guard regression alignment | `01d74fb` |

The verified branch state before this record was created was
`codex/webview-subframe-fix-build9` at
`01d74fb079ab6ff97d84e5fb4c8cbc5de2618d01`; its checked base matched the
required Task 4 base exactly and the tracked tree was clean.

## Non-sensitive reproduction and regression binding

The already captured reproduction remains limited to these non-sensitive facts:
the destination remained on its same HTTPS origin, loaded with HTTP 200 and no
redirect, and exposed one `about:blank` iframe. No new network request was
made for this record, and no page content, cookies, storage, account data,
query data, or browser history is recorded here.

The automated regression uses the same iOS request shape: `url` is exactly
`about:blank`, `isTopFrame` is `false`, and `mainDocumentURL` is a safe HTTPS
URL at the selected destination origin. It verifies the inherited blank
subframe receives a native allow decision without a Linking effect. Companion
coverage keeps top-frame blank, missing-parent, cross-origin-parent, and
cross-origin-subframe requests blocked.

## Preserved safety boundaries

- Arbitrary safe same-origin HTTPS remains the normal allow path; the only
  added non-HTTPS exception is an exact inherited blank subframe with a safe
  same-origin HTTPS parent.
- Missing frame metadata, top-frame `about:blank`, cross-origin or unsafe
  navigation, local/IP targets, malformed URLs, and traversal remain blocked.
- Rejected top-frame navigation retains the generic error; rejected subframes
  cancel silently; popups remain blocked with the generic error.
- Public and VIP WebViews use the same request-aware classifier and decision
  applicator.
- VIP external loading is nonblocking and accessible; broker loading retains
  its opaque loader and refresh-before-launch authorization ordering.
- VIP incognito mode, disabled cache, cookie isolation, mixed-content/file
  restrictions, media/geolocation limits, native-bridge limits, browser/share
  restrictions, App-Bound Domain boundaries, and AASA boundaries are unchanged.
- Build-8 attestations remain immutable. No provider, EAS, TestFlight, Apple,
  catalog, App Review, release-guard authority, or build state was changed.

## Clean-state source gates

All commands below ran before this document was created, from the clean branch
state at `01d74fb079ab6ff97d84e5fb4c8cbc5de2618d01`.

| Command | Exact result |
| --- | --- |
| `git status --short` | Exit `0`; no output. |
| `git log --oneline --decorate -5` | Exit `0`; `01d74fb (HEAD -> codex/webview-subframe-fix-build9) test: align release guard expectations with build 8 authority`; `7bb1568 docs: align WebView fix plan with build 8 authority`; `d008594 fix: show external VIP loading progress`; `663380d fix: allow safe inherited WebView subframes`; `43e82b9 docs: plan external WebView subframe fix`. |
| `npm run typecheck` | Exit `0`; `node node_modules/typescript/bin/tsc --noEmit` completed without diagnostics. |
| `npm run lint` | Exit `0`; 3 pre-existing warnings and 0 errors: `components/AnimatedMolecules.tsx` array-type, `components/SkeletonCard.tsx` unused `colors`, and `components/icons/PremiumIcon.tsx` unused `G`. |
| `npm test` | Exit `0`; 1,499 passed, 0 failed, 1 skipped (1,500 tests total). |
| `npm run test:scope` | Exit `0`; `Release 3.0/build 8 verified: pre-build-configured.` and `App Store pre-build metadata verified; submission remains blocked.` |

## Release boundary

> **This is not a build artifact or release authorization. Build 9 has no
> assigned number, EAS build, IPA, TestFlight upload, Apple change, or
> attestation. A later release process must independently rebaseline and bind
> its own source and artifact authorities before any build activity.**
