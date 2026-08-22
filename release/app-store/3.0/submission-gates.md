# CaboHealth 3.0/build 4 submission gates

This truthful metadata package remains **blocked**. Nothing here proves that an exact RC exists or that Apple will accept the access model.

## High review risk: individual seller and eligibility-gated resources

The seller is Ivan Guaderrama, an **Individual** Apple Developer Program member. Cabo Health is his trade brand, not a separate legal entity or registered organization. D-U-N-S is not applicable to this individual seller.

The app is educational/general wellness and has two public resources. It also verifies complimentary eligibility for a protected Client Resources area offered only to a maximum of four existing in-person clients. There is no sale, price, checkout, IAP, subscription, or paid digital tier.

This is a **high review risk** because Apple may treat an external eligibility code as a digital-unlock mechanism or may determine that the app provides healthcare services that should be submitted by a legal entity. The wellness wording does not resolve or guarantee Apple approval. Obtain written Apple direction before submission. If Apple rejects the model or seller status, revise the access model or later migrate to a registered organization.

## Local implementation completed

- Production code service: 128-bit HMAC-only codes, four transactional slots, App Check, rate limits, one-installation binding, revocation/expiry, short-lived launch, and default-deny data access.
- Durable removal/deletion: transactional tombstone, idempotent retry worker, revoked/expired reachability, and isolated batch failures.
- Protected Client Resources broker/content boundary and strict native WebView/deep-link gate.
- Isolated multi-device App Review realm, fixed non-client sample, separate broker/database/secrets, and credential rotation workflow.
- Visible Staff Access portal with email/password plus TOTP, App Check, code management, draft-only catalog editing, sanitized audit, and no publish action.
- Prior public-only legal pages and their reviewed hashes; owner-authorized Hostinger log/retention/deletion and support SLA disclosures. The v3 client-access legal update remains an external gate below.

## External and release gates

- [ ] Ivan explicitly approves possible Firebase/Google Cloud billing, and dedicated staging/production projects are created with budgets/limits.
- [ ] Enable/configure Auth, TOTP/Identity Platform as required, App Check, App Attest, web reCAPTCHA Enterprise, Firestore databases/rules/IAM/indexes/TTL, Functions, secrets, and least privilege.
- [ ] Seed only fixed reviewed production/review resource records and the active owner staff record; never migrate plaintext legacy codes.
- [ ] Run emulator tests, staging E2E, hostile-path tests, two-iPhone App Review tests, credential rotation, deletion/retry, and cross-realm rejection.
- [ ] Create and test isolated non-production Staff Access for App Review with no production privileges, or obtain written Apple direction that reviewer access to the administrative portal is not required.
- [ ] Independently review and repin the hosted Privacy and Terms pages so they describe production client access, App Review isolation, Firebase processing, durable deletion, and the application-audit retention contract before deployment.
- [ ] Deploy protected Client Resources, fixed App Review sample, Staff Access, and broker configuration to Hostinger; run the PHP 8.2 harness and origin/header/rollback verifiers.
- [ ] Deploy the ordered AASA authority with four launch/API exclusions followed by the three exact allowed roots; verify origin bytes and Apple CDN bytes before Universal Link QA.
- [ ] Verify the public two-miniapp/legal payload remains exact and no WordPress/unrelated files change.
- [ ] Ivan signs and dates the ownership declaration; domain-control and final brand/logo/content/third-party rights evidence are attached privately.
- [ ] Final App Privacy categories, purposes, linkage, retention, deletion, SDK privacy report, and network inventory are reconciled and approved.
- [ ] Reopen App Store Connect age rating after the changed scope, confirm every answer, save, and record Apple’s recalculated result (projected 9+ only).
- [ ] Confirm Health & Fitness / Food & Drink, MEX/USA only, automatic future territories off, Mac/Vision availability off, and DSA status.
- [ ] Update `app.json` and `constants/config.ts` together to 3.0/build 4 only when freezing the exact RC.
- [ ] Build/upload from the recorded SHA; verify identifiers, entitlements, App Attest, privacy manifest, and TestFlight processing.
- [ ] Complete clean-install/update, EN/es-MX, appearance/motion, offline/error/security, Universal Links, accessibility, and physical-iPhone QA.
- [ ] Capture and approve exact 6.9-inch EN/es-MX screenshots; save final metadata, privacy, age, review credential, build, and Review Notes in App Store Connect.
- [ ] Obtain written Apple direction on the complimentary existing-client eligibility model and the Individual seller risk, or accept the documented fallback.
- [ ] Freeze and independently review the canonical build-input attestation; pin its SHA-256 plus the recursive EAS runtime/dependency tree and Node executable bytes/version so `build:prod` can run through the release guard from a unique private snapshot outside Dropbox.
- [ ] Download and independently attest the exact IPA, signed entitlements, privacy report, and EAS build ID; `upload:testflight` must copy only that IPA into a unique private directory outside Dropbox, rehash it immediately before launch, and delete the private operation afterward.
- [ ] After TestFlight processing and physical-iPhone QA, create and independently review the final RC attestation bound to the build artifact, TestFlight build, screenshots, QA, and App Store Connect evidence.
- [ ] Independently review a self-contained App Store submit adapter (or its complete recursive runtime closure), pin that closure and Node binary, and verify the adapter rejects any App Store Connect selection that does not exactly match Apple ID `6758285327`, bundle `com.cabohealth.app`, version `3.0`, build `4`, and the attested TestFlight build ID.
- [ ] Immediately before submission, Ivan reviews the final summary and gives a separate explicit confirmation; the resulting one-time authorization is RC-bound, private, and valid for at most ten minutes.

Only after all evidence is green may Ivan inspect the final submission summary. Codex must ask Ivan for a separate explicit confirmation immediately before **Submit for Review**.

## Honest limit of the submission authorization

The local authorization file is a replay-resistant operational record, not a digital signature. Its deterministic confirmation challenge is RC-bound, nonce-bound, and time-bound, but it uses no Ivan-held secret and therefore **cannot cryptographically authenticate Ivan's identity**. Anyone with sufficient local write access could fabricate that file.

The required second control remains operational: Codex must ask Ivan for a separate explicit confirmation after showing the exact RC summary and immediately before submission. Codex must not create or consume the authorization record before that answer. The App Store submit adapter pin remains `null` until the adapter and all exact ASC/evidence bindings receive independent review; a local authorization artifact cannot remove that gate.
