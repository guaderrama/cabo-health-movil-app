# CaboHealth engineering and release documentation

Start here when taking over this repository. Do not infer production state from source code alone: every cloud, hosting, legal, TestFlight, and App Store action has an explicit evidence gate.

## Current architecture authority

- [`decisions/0001-single-firebase-production-project.md`](decisions/0001-single-firebase-production-project.md) — accepted owner decision to use one dedicated Firebase production project, local emulators for development, and a named isolated App Review database.
- [`operations/firebase-activation.md`](operations/firebase-activation.md) — guarded Firebase provisioning, database, IAM, rules, bootstrap, and verification sequence.
- [`operations/native-firebase-runtime.md`](operations/native-firebase-runtime.md) — native Firebase/App Check build boundary.
- [`operations/client-access-backend.md`](operations/client-access-backend.md) — client access, deletion, rate-limit, review, and staff contracts.
- [`operations/hostinger-deploy-runbook.md`](operations/hostinger-deploy-runbook.md) — public and protected Hostinger deployment controls.
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
