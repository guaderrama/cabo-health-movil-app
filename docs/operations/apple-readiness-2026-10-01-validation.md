# Apple readiness — 2026-10-01 integration record

This is a local pre-freeze validation record, not an Apple approval, production deployment, device sign-off, or claim of zero defects. Candidate 3.0 (14) replaces, but does not rewrite, build 13. The full implementation plan is `docs/superpowers/plans/2026-10-01-cabohealth-apple-readiness.md`.

## Reproduced defects and repairs

| Area | Reproduction and correction | Evidence boundary |
| --- | --- | --- |
| Public resource lifecycle | Background catalog refresh used the initial-loading branch and replaced the active WebView. The route now uses `isInitialLoading`. | Component regressions; actual iOS foreground/scroll state still needs physical QA. |
| Catalog errors | Home/Saved ignored the provider error. An accessible bilingual retry banner now preserves usable cached entries and distinguishes missing saved content. | Eight native resilience tests; no unauthorized fallback catalog. |
| System appearance | Native configuration forced Light despite offering System. Configuration now uses `automatic`. | Configuration and type checks; native appearance requires the next signed build. |
| Deleted accounts | Four persistent Auth failures could starve a fifth deletion job. Ordering now prioritizes the least recently attempted job. | Integration regression with five jobs. |
| Deletion monitoring | Production and App Review Auth failures looked like healthy partial work. Internal outcomes now signal aggregate failure without changing public receipts. | 267 backend tests passed after the first dependency update; recovery, idempotency, partial cleanup and sanitized errors covered. |
| Web content process death | The pinned WebView library forwards process-death events without recovering; app components had no handler. Existing localized error/recovery UI now handles iOS termination and Android renderer loss. | Eight RED cases then focused GREEN. No automatic replay of a consumed broker nonce; no sign-out or navigation-policy relaxation. |
| URL decoding | A malformed query caused the actual router dependency to exceed a five-second child-process limit. | `decode-uri-component` 0.5.0 plus one-line query-string ESM interop patch; valid Unicode, plus/space, arrays and malformed input tested. |
| Asset parser | ICNS/JXL bytes disguised as PNG exhausted a bounded process. | `image-size` 2.0.4 plus Metro filesystem API adaptation. Ordinary PNG, buffer, simulated `.zip/` buffer branch and malformed parsers pass. The fixture is not a real ZIP/Yarn filesystem. HEIF is a no-regression test, not a claimed RED reproduction. |

## Dependency changes and residual risk

The package manager's advisory response changed between audit calls. Counts below describe the later snapshot; they are not a stable score or proof of runtime exploitability.

- Functions: installation audit reports **0 vulnerabilities** after gRPC 1.14.5, qs 6.16.0, UUID 11.1.1 and brace-expansion 2.1.7 overrides.
- Staff: installation audit reports **0 vulnerabilities** after gRPC 1.14.5; 82 tests, build and typecheck passed.
- Root: final `npm audit` reports **22 affected packages** (16 high, 5 moderate, 1 low), arising from **seven direct advisory packages** and their parent chains. No critical result. This is not represented as a clean audit.
- Compatible patches also cover brace-expansion 1/2/5, js-yaml 3/4, fast-uri 3, browserslist, baseline-browser-mapping, undici 6/8, Joi 17, Hono 4, ip-address 10, moment 2, morgan 1 and qs 6. Expo/RN/RNFirebase majors and the existing native patches are preserved.
- Root postinstall remains fail-closed; it applies the two reviewed compatibility patches in addition to the three pre-existing native patches. Node is pinned to 22.22.3 in the production EAS profile.

Residuals are retained explicitly instead of forcing incompatible major upgrades:

| Package | Located consumer / risk precondition | Current boundary |
| --- | --- | --- |
| node-forge 1.4.0 | Expo/EAS certificate verification; attacker-controlled signature/certificate inputs are relevant. | No patched release in the advisory at this review. No runtime app/Functions/Staff import found; own update-signing configuration absent. Keep credential inputs trusted and build tooling private. Do not invent a cryptographic patch or claim the issue fixed. |
| @opentelemetry/core 1.x | Pub/Sub tooling; untrusted W3C Baggage propagation. | Located consumer uses trace-context propagation, not Baggage. Major 2 requires upstream coordination. |
| basic-ftp 5.x | Proxy/get-uri tooling parsing a hostile FTP listing. | No FTP path in the mobile application; do not use untrusted FTP in build workflows. Major 6 changes transfer policy. |
| csv-parse 5.x | Firebase auth-import with untrusted column names. | Located import path does not set `columns`. No untrusted auth import in this workflow; major 7 belongs in a separately validated CLI upgrade. |
| diff 7.x | EAS parsing/applying untrusted patches. | Located consumer uses `diffLines`, not vulnerable patch parsing. Major 8 is not forced. |
| stream-json 1.x | Firebase local data imports with deeply nested hostile JSON. | No data import in this workflow. Version 3 changes modules and APIs used by the current CLI. |
| ts-deepmerge 6.x | EAS merges attacker-controlled configuration objects. | Reviewed local configuration only; version 8 changes the callable default export. |

These controls reduce exposure; they do not remove upstream advisories. Recheck before a provider operation. Primary advisory references: [decoder](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr), [image parsers](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Remaining exact advisory URLs are in the local audit output; do not upload private dependency reports automatically.

## Whole-product release gates still open

1. **Actual VIP business model:** owner confirmation is pending. Do not present sold digital access as complimentary physical-service eligibility. Payment, content and metadata must reflect reality.
2. **Apple and Staff authenticated review:** both integrated-browser tabs currently show sign-in, not authenticated administration. No live metadata, review credential or private catalog verification is claimed this turn.
3. **Build 14 artifact:** local rebaseline and bundle validation are not an IPA. New clean-source input authority, one EAS build, exact artifact audit, upload and processed TestFlight evidence are required.
4. **Physical QA:** test this exact successor on iPhone and the compatible iPad, including the App Review credential (not only a normal VIP code), background/restore, network loss, public/client resources, deletion, accessibility and layout. A simulated callback test does not prove a physical memory-pressure recovery. The existing machine validator enforces two unique devices and clean/upgrade evidence, but does not specifically require an iPad; the additional iPad rejection-regression check remains a mandatory human gate and must not be inferred from that validator passing.
5. **Production:** local Functions/Staff source changes have not been deployed. Live brokers/configuration and scoped end-to-end tests must match the release.
6. **Store metadata:** final screenshots, saved age rating, privacy mapping, rights declaration and notes must bind to the actual candidate. Historical screenshots/status do not satisfy this gate.

Apple's current [review guidelines](https://developer.apple.com/app-store/review/guidelines/) were checked again: 2.1 requires completeness; 3.1 governs digital access; 4.7 covers miniapps, privacy, reporting and universal-link indexing; 5.1 requires appropriate data handling and in-app account deletion. Healthcare-service apps can also face the legal-entity requirement in 5.1.1(ix). Passing automated tests does not settle these product or account facts.

No deployment, purchase, tester-access expansion, provider build or Apple submission was performed as part of these local repairs.
