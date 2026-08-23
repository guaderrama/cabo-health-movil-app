# Firebase activation: local proof and guarded cloud handoff

Status: `cabohealth-owner-prod` was created, linked to owner-controlled billing,
enabled for the required APIs, and added to Firebase on 2026-08-22. Identity
Platform is initialized with email/password sign-in, TOTP MFA, and the exact
staff domain `cabohealth.org`; no Authentication user or TOTP enrollment exists.
No database/location, claim, document, rule, index, TTL policy, parameter,
secret, Function, or budget amount has been created. The iOS and staff web apps
are registered and App Attest is configured with a one-hour token TTL, but
service enforcement remains off. See
[`../decisions/0001-single-firebase-production-project.md`](../decisions/0001-single-firebase-production-project.md)
for the accepted architecture and external-state snapshot.

This runbook is the only activation path for the two Firestore databases and
the initial owner authority. It follows Firebase's current documentation for
[multiple database CLI configuration](https://firebase.google.com/docs/cli#cloud-firestore),
[named databases in the emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore),
and [database creation and IAM](https://firebase.google.com/docs/firestore/manage-databases).
Firebase documents that the emulator creates every database explicitly listed
in `firebase.json`; an implicitly created named database has open rules. That
is why the repository has a separate, exact `firebase.emulator.json` rather
than allowing a test to invent a database ID.

## Invariants

- `(default)` uses `firestore.rules` and `firestore.indexes.json`.
- The independently provisioned `cabohealth-review-*` database uses only
  `firestore.review.rules` and `firestore.review.indexes.json`.
- Both rules files deny every mobile/web SDK read and write. Privileged access
  is through Firebase Admin SDK plus separately reviewed IAM.
- The only authorized cloud project is `cabohealth-owner-prod`. Local
  development and rules tests use emulator-only project `demo-cabohealth`.
  The existing `staging` parser/test path is dormant future capability; it
  does not authorize creation or use of a staging project.
- The production review database is exactly
  `cabohealth-review-production`. The tools reject cross-environment
  project/database combinations.
- The checked-in `firebase.json` intentionally contains
  `UNCONFIGURED_CABOHEALTH_REVIEW_DATABASE_ID`. A direct all-service deploy is
  therefore fail-closed. A reviewed private config must be rendered for each
  environment.
- The bootstrap input has no URL, arbitrary resource ID, App Review user data,
  or catalog content field. It can only activate the existing owner and create
  the fixed `_private_client_resources/client-resources` record.

## Local verification — no account or login required

Prerequisites are Node 22, `npm ci`, a Java runtime supported by the pinned
Firebase CLI, and network access on the first emulator download. The Firebase
CLI is locked as `firebase-tools@15.28.1`.

```sh
npm ci
npm run functions:test
npm run functions:build
npm run test:firestore-rules:emulator
```

The last command starts only the Firestore emulator with project
`demo-cabohealth`, creates `(default)` and `cabohealth-review-emulator` from
the explicit config, probes an anonymous read and write against both, requires
four HTTP 403 responses, and then shuts the emulator down. It neither logs in
nor contacts a real Firebase project.

## Render the project-bound deployment config

Create a private directory once. The config renderer refuses to write anywhere
else and refuses to overwrite an existing reviewed artifact.

```sh
mkdir -p /ABSOLUTE/REPO/release/private
chmod 700 /ABSOLUTE/REPO/release/private

npm run firebase:config -- \
  --environment production \
  --project-id EXACT_CABOHEALTH_PROJECT_ID_ENDING_IN_PROD \
  --review-database-id EXACT_REVIEW_DATABASE_ID_ENDING_IN_PRODUCTION \
  --out /ABSOLUTE/REPO/release/private/firebase.production.json
```

The accepted single-project architecture renders only `production`, project
`cabohealth-owner-prod`, and review database
`cabohealth-review-production`. The command writes mode `0600` and prints only
sanitized evidence: environment, exact non-secret project/database IDs, and
the SHA-256 of the rendered config. Review the file and hash before any cloud
command. Do not edit the placeholder in checked-in `firebase.json`; the private
rendered config remains the deployment authority.

## Cloud provisioning and rules

**OWNER APPROVAL REQUIRED:** the owner must confirm the exact production
project/database IDs, location, edition, quota/billing impact, deletion
protection, and the operator's `roles/datastore.owner` authority. Database
creation is irreversible in location and is not authorized merely by creating
the project or merging this code.

After that approval, inspect the production project first. The command relies
on Standard edition; selecting Enterprise requires a separate ADR and reviewed
command:

```sh
npm exec -- firebase firestore:databases:list \
  --project cabohealth-owner-prod

npm exec -- firebase firestore:databases:create \
  cabohealth-review-production \
  --location=OWNER_APPROVED_LOCATION \
  --delete-protection ENABLED \
  --project cabohealth-owner-prod

npm exec -- firebase firestore:databases:get \
  cabohealth-review-production \
  --project cabohealth-owner-prod

npm exec -- firebase deploy \
  --config /ABSOLUTE/REPO/release/private/firebase.production.json \
  --project cabohealth-owner-prod \
  --only firestore
```

Create `(default)` explicitly in the same owner-approved location with deletion
protection before the named database; never let a convenience deploy choose an
implicit location. After deployment, verify both database identities, deny-all rules, every
TTL field override, and deletion protection in the provider. Do not deploy
Functions or issue an App Review credential until emulator, synthetic-record,
rules, IAM, and deletion tests pass and the exact database evidence is reviewed.

The three non-secret Functions parameters remain separate from this renderer:
`CLIENT_IOS_FIREBASE_APP_ID`, `STAFF_WEB_FIREBASE_APP_ID`, and
`APP_REVIEW_FIRESTORE_DATABASE_ID`. The last value must exactly equal the
named database in the reviewed config. Firebase can save parameter answers in
`functions/.env.<project_ID>`; those files are intentionally gitignored and
the whole `functions/` tree is excluded from the EAS native upload context.
Secret Manager values remain external and are never accepted by these tools.

## Plan and apply the owner bootstrap

Identity Platform has already been initialized for this project. Email/password
sign-in is enabled and requires a password; TOTP is enabled with one adjacent
clock interval. The Firebase-hosted domains plus `cabohealth.org` are the only
authorized domains. Do not add `localhost` to production merely for development:
local work uses the Auth emulator.

The owner Auth user must already exist in the exact project, be enabled, have a
verified email, and have a TOTP factor enrolled. The bootstrap tool does not
create users, enroll MFA, accept an email address, or accept credential material.
Put only the Firebase Auth UID in a private mode-`0600` file without exposing it
in shell history.

The default command is local-only: it writes a private exact plan and prints a
sanitized evidence object containing the plan hash but not the UID or document
contents.

```sh
chmod 600 /ABSOLUTE/REPO/release/private/owner-uid.txt

npm run firebase:bootstrap -- \
  --environment production \
  --project-id EXACT_CABOHEALTH_PROJECT_ID_ENDING_IN_PROD \
  --review-database-id EXACT_REVIEW_DATABASE_ID_ENDING_IN_PRODUCTION \
  --owner-uid-file /ABSOLUTE/REPO/release/private/owner-uid.txt \
  --plan-out /ABSOLUTE/REPO/release/private/bootstrap.production.json
```

Review the private plan offline. It contains exactly:

1. `catalogAdmin: true`, merged without deleting unrelated existing claims;
2. active `_private_admins/{ownerUid}` scope `production` with exactly
   `client_codes`, `client_resource_drafts`, and `app_review_credential`;
3. active `_private_client_resources/client-resources`, icon `featured`, fixed
   bilingual title/summary, and no URL.

**OWNER APPROVAL REQUIRED:** applying the plan mutates Firebase Auth claims and
two documents in `(default)`. Approval must identify the exact project,
environment, review database, and reviewed SHA-256. Application uses only the
Admin SDK with Application Default Credentials, rejects Auth/Firestore
emulators and ambient project mismatches, creates absent documents
transactionally, accepts exact idempotent reruns, and fails on any existing
document drift.

```sh
npm run firebase:bootstrap -- \
  --environment production \
  --project-id EXACT_CABOHEALTH_PROJECT_ID_ENDING_IN_PROD \
  --review-database-id EXACT_REVIEW_DATABASE_ID_ENDING_IN_PRODUCTION \
  --plan-file /ABSOLUTE/REPO/release/private/bootstrap.production.json \
  --apply \
  --reviewed-plan-sha256 EXACT_64_CHARACTER_SHA256_FROM_DRY_RUN
```

Run and verify the dry-run sequence locally before requesting each separate
production mutation approval. IAM, database creation, parameters, secrets, App
Check, rules/TTL deployment, bootstrap application, and production evidence
remain external gates. Do not create a staging project without a superseding
owner-approved ADR.
