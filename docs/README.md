# CaboHealth engineering and release documentation

Start here when taking over this repository. Do not infer production state from source code alone: every cloud, hosting, legal, TestFlight, and App Store action has an explicit evidence gate.

## Current architecture authority

- [`decisions/0001-single-firebase-production-project.md`](decisions/0001-single-firebase-production-project.md) — accepted owner decision to use one dedicated Firebase production project, local emulators for development, and a named isolated App Review database.
- [`decisions/0002-password-only-staff-access.md`](decisions/0002-password-only-staff-access.md) — accepted password-only Staff Portal decision, compensating controls, and controlled migration order.
- [`operations/prior-apple-review-resolution.md`](operations/prior-apple-review-resolution.md) — verified prior rejection facts and the evidence required to resolve each issue in the new candidate.
- [`operations/firebase-activation.md`](operations/firebase-activation.md) — guarded Firebase provisioning, database, IAM, rules, bootstrap, and verification sequence.
- [`operations/staff-portal-production-activation-2026-08-23.md`](operations/staff-portal-production-activation-2026-08-23.md) — dated, sanitized production evidence for Staff Portal releases and the password-only migration.
- [`operations/native-firebase-runtime.md`](operations/native-firebase-runtime.md) — native Firebase/App Check build boundary.
- [`operations/client-access-backend.md`](operations/client-access-backend.md) — client access, deletion, rate-limit, review, and staff contracts.
- [`operations/hostinger-deploy-runbook.md`](operations/hostinger-deploy-runbook.md) — public and protected Hostinger deployment controls.
- [`operations/public-web-production-activation-2026-08-24.md`](operations/public-web-production-activation-2026-08-24.md) — exact public release, origin/browser/server/Apple CDN evidence, rollback alias, and temporary-transfer cleanup.
- [`operations/protected-overlay-activation-2026-08-24.md`](operations/protected-overlay-activation-2026-08-24.md) — exact protected Client Resources/App Review release, runtime attestation, cold-start correction, and remaining live E2E gates.
- [`security/app-review-sandbox-threat-model.md`](security/app-review-sandbox-threat-model.md) — isolation requirements for Apple review access.
- [`../release/app-store/3.0/submission-gates.md`](../release/app-store/3.0/submission-gates.md) — current release blockers and the final submission authorization boundary.

## Non-negotiable handoff rules

1. Never place passwords, access codes, TOTP seeds, API keys, plist files, private evidence, signing material, or deletion receipts in Git, tickets, logs, or chat.
2. Never treat a locally implemented control as deployed evidence.
3. Never expose a real client record to Apple. Apple receives only the fixed bilingual sample in the named review database and isolated broker realm.
4. Never change the Firestore location, project identity, database identity, App Store version/build, or final legal hashes without updating the decision record, release authorities, and tests.
5. Never press **Submit for Review** without a fresh exact-RC summary and Ivan Guaderrama's separate confirmation immediately before submission.

## Current external state

The dated external-state snapshot belongs in the accepted decision record. Re-check the providers before every mutation; external state can drift independently of Git.
