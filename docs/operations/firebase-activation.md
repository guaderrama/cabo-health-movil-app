# Firebase activation: local proof and guarded cloud handoff

Status: `cabohealth-owner-prod` was created, linked to owner-controlled billing,
enabled for the required APIs, and added to Firebase on 2026-08-22. Identity
Platform is initialized with email/password sign-in, TOTP MFA, and the exact
staff domain `cabohealth.org`. On 2026-08-23 Ivan personally created and verified
the initial owner Authentication user in the exact project without disclosing
its password, then enrolled one TOTP factor through the Staff Portal.
The Standard Firestore Native databases `(default)` and
`cabohealth-review-production` now exist in the permanent `nam5` location with
deletion protection enabled. Both exact deny-all rulesets and their index/TTL
definitions were deployed on 2026-08-22. The initial provider read reported the
13 TTL field operations as `CREATING`; a later read on the same date confirmed
all seven production and six review TTL fields `ACTIVE`.
Sixteen independent Secret Manager key rings were provisioned at version 1
without recording their values. The dedicated disabled-by-default runtime
identity `cabohealth-functions@cabohealth-owner-prod.iam.gserviceaccount.com`
was created. On 2026-08-23 the owner authorized and provider re-reads verified
the exact least-privilege Firestore, Auth-deletion, self-signing, logging, and
per-secret policy documented below. On the same date all 26 Node.js 22 Functions
were deployed to `us-central1`; independent Firebase and Google Cloud inventory
reads found all 26 `ACTIVE`, all using only the dedicated runtime identity, with
maximum instance limits of 1, 5, or 10, and both scheduled jobs `ENABLED`.
Unauthenticated probes of both HTTP brokers returned 403. On 2026-08-23 the
reviewed production bootstrap installed the owner claim, exact private admin
document, and fixed catalog runtime record after verifying the enabled owner
and enrolled TOTP factor. A project-scoped
monthly billing alert budget of USD 17.75 records the owner-authorized 300 MXN
reference and alerts at 50%, 90%, and 100%; it is not a hard spending cap. The
iOS and staff web apps are registered and App Attest is configured with a
one-hour token TTL, but service enforcement remains off. The staff web app's
score-based reCAPTCHA Enterprise provider is also registered for only
`cabohealth.org`, with a one-hour token TTL and minimum score `0.5`; its public
site-key value remains an external build input. See
[`../decisions/0001-single-firebase-production-project.md`](../decisions/0001-single-firebase-production-project.md)
for the accepted architecture and external-state snapshot.

This runbook is the only activation path for the two Firestore databases and
the initial owner authority. It follows Firebase's current documentation for
[multiple database CLI configuration](https://firebase.google.com/docs/cli#cloud-firestore),
[named databases in the emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore),
and [database creation and IAM](https://firebase.google.com/docs/firestore/manage-databases).
Firebase documents that the emulator creates every database explicitly listed
in `firebase.json`; an implicitly created named database has open rules. The
pinned `firebase-tools@15.28.1` runtime nevertheless reports that its Firestore
emulator cannot safely load multiple database rule targets in one execution.
The repository therefore verifies `firebase.emulator.json` and
`firebase.emulator.review.json` in two isolated executions, mapping each exact
production ruleset to the emulator's `(default)` database. Do not combine those
test configs until the pinned emulator is upgraded and the four-denial
regression gate still passes.

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

## Owner bootstrap v1 — historical apply evidence

Ivan explicitly authorized the exact production plan on 2026-08-23. Its
canonical SHA-256 was
`098061e629c16f0e6f6df89294726ce35eeb3b4c83b747c3f8a395a478c2111a`,
binding project `cabohealth-owner-prod`, environment `production`, and review
database `cabohealth-review-production`.

The apply path first re-read the account and stopped unless it was enabled and
had an enrolled TOTP factor. It then created the two absent documents in one
Firestore transaction and merged only `catalogAdmin: true` into the existing
custom claims, preserving unrelated claims. Independent postcondition reads
confirmed all five conditions: account enabled, TOTP preserved, admin claim
present, private admin document exact, and fixed client-resource document
exact. No email, password, TOTP enrollment, verification state, or App Review
credential was changed. The sanitized result reported `status: applied` and
`containsSensitiveValues: false`; no private user identifier is recorded here.

This schema-v1, TOTP-enrolled bootstrap remains immutable historical evidence.
It is not the current owner-authentication instruction.

## Password-only owner migration — current normative state

Ivan explicitly authorized migrating the owner to password-only authentication.
A sanitized browser trace recorded HTTP 200 for both
`accounts:signInWithPassword` and `mfaSignIn:finalize`, but the portal failed
before sending any request to Cloud Functions. No email address, UID, password,
verification code, factor secret, token, request body, or private response was
retained in the evidence.

The current password policy requires at least 14 characters, including an
uppercase letter, a lowercase letter, and a number; a symbol is not required.
Existing accounts are forced to upgrade to the policy. Email-enumeration
protection remains enabled, and the Staff Portal presents the same password-reset
notice whether or not an address is registered.

The Identity Platform TOTP provider remains globally enabled as a dormant
capability. After the owner's enrolled factor is removed, neither the current
Staff Portal nor the current Functions authorization path requires MFA. The
password-only migration deployment was gated by the then-current portal 42/42
and Functions 104/104 suites. Eleven affected Functions were deployed to
`us-central1`; this was a targeted update inside the historical 26-Function
inventory, not a claim that only 11 Functions exist. The current local portal
suite passes 43/43. The committed final strict backend passes 109/109, and its
separately committed temporary access-code schema bridge passes 110/110; these
newer local results are not a claim that either backend commit is deployed.
The immutable portal artifact, live verification, and rollback evidence are recorded in
`staff-portal-production-activation-2026-08-23.md`.

The owner personally completed the strong-password reset on 2026-08-23. The
guarded migration then required a newer password-update timestamp, removed only
the exact enrolled legacy factor, revoked prior refresh tokens, and re-read
sanitized postconditions. The read-back proved `factorCount: 0`, an enabled and
email-verified password account, the reviewed `catalogAdmin` claim, and the
preserved exact private admin document. The global TOTP provider remains enabled
and dormant. The owner personally completed the fresh password-only live-portal
check on 2026-08-23 local time (`2026-08-24T00:20:53.195194Z`). The authenticated
workspace loaded without an MFA challenge, and a sanitized Cloud Run request
log independently recorded `adminGetStaffSession` `POST` with HTTP 200. No PII
or credential material entered the retained release evidence.

Bootstrap v2 fails closed unless the owner exists, is enabled
(`disabled: false`), has `emailVerified: true`, has the `password` provider, and
has exactly `factorCount: 0`. It preserves unrelated claims and the fixed private
documents under the same project and database confinement.

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
`demo-cabohealth` twice. The first isolated execution loads `firestore.rules`;
the second loads `firestore.review.rules`. Each is mapped to `(default)`,
probed with an anonymous read and write, and required to return two HTTP 403
responses before shutdown. It neither logs in nor contacts a real Firebase
project. This two-run design is a regression control for the pinned emulator's
multi-database limitation; the private production deploy config still binds
the two rulesets to their exact real database IDs.

On 2026-08-24 the command completed successfully with the official Temurin 21
runtime: production denied both anonymous probes (2/2) and App Review denied
both anonymous probes (2/2). The runtime, downloaded emulator JAR, and generated
log were held only in a temporary directory and removed after the run.

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

The pinned Firebase CLI treats the directory containing `--config` as its
project directory and rejects relative paths that leave it. The renderer
therefore writes machine-bound absolute source paths only after proving that
every path resolves inside the exact repository. The private config must be
rerendered after moving the checkout and must never be committed. Regression
tests cover this behavior after two pre-deploy attempts correctly failed before
any rule release.

## Cloud provisioning and rules

**OWNER APPROVAL RECORDED 2026-08-22:** Ivan authorized the exact production
project, both database IDs, Standard edition, permanent `nam5` location,
deletion protection, and a 300 MXN monthly budget reference. `(default)` and
`cabohealth-review-production` were created and re-read from the provider. Do
not rerun database creation or attempt to change their location. Provider
verification is:

The historical provisioning verb was `firebase firestore:databases:create`;
it is retained here only as audit vocabulary and is not a command to rerun.

```sh
gcloud firestore databases list \
  --project=cabohealth-owner-prod
```

The expected result is exactly `(default)` and
`cabohealth-review-production`, both Standard/Firestore Native in `nam5` with
delete protection enabled. The budget is scoped to project number
`378334596269`, uses USD 17.75 per recurring month, and has current-spend
thresholds 0.50, 0.90, and 1.00. Because the billing account currency is USD,
the peso equivalence must be reconsidered if the owner later changes the MXN
reference.

After separately reviewing the private rendered Firebase config, deploy only
the database rules/index configuration:

```sh

npm exec -- firebase deploy \
  --config /ABSOLUTE/REPO/release/private/firebase.production.json \
  --project cabohealth-owner-prod \
  --only firestore
```

**DEPLOYED 2026-08-22:** the reviewed private artifact SHA-256 was
`d7ab378d3bc1f1203a639ec18c4c3e53d76722dbdb1faac1284d387c89788c8f`.
Both rules compiled and were released, and both index files were accepted.
Provider releases are:

- `(default)`: `cloud.firestore` -> ruleset
  `14151afb-a6c9-4c01-a182-2f731b248cd8`;
- `cabohealth-review-production`:
  `cloud.firestore/cabohealth-review-production` -> ruleset
  `a2bd34ad-4e6e-4490-ab5d-50e42f747cb7`, attached to project number
  `378334596269` and the exact named database.

The Rules API was re-read independently and both deployed sources exactly
contain unconditional `allow read, write: if false`. Seven production TTL
fields and six review TTL fields exist; a provider read on 2026-08-22 confirmed
all 13 `ACTIVE`.

Historical first-deployment gate (completed): after the rules deployment, the
operator verified both database identities, deny-all rules, every TTL field
override, and deletion protection in the provider before the initial Functions
release. The same controls must be re-run for a future rules change. App Review
credential issuance remains blocked on its separate valid-flow and physical-
device gates.

The three non-secret Functions parameters remain separate from this renderer:
`CLIENT_IOS_FIREBASE_APP_ID`, `STAFF_WEB_FIREBASE_APP_ID`, and
`APP_REVIEW_FIRESTORE_DATABASE_ID`. The last value must exactly equal the
named database in the reviewed config. Firebase can save parameter answers in
`functions/.env.<project_ID>`; those files are intentionally gitignored and
the whole `functions/` tree is excluded from the EAS native upload context.
Secret Manager values remain external and are never accepted by these tools.

## Dedicated Functions runtime IAM — applied and verified

Every callable, scheduled job, and HTTP broker is source-bound and regression-
tested to run as
`cabohealth-functions@cabohealth-owner-prod.iam.gserviceaccount.com`. The
identity exists. Ivan explicitly authorized the following policy on 2026-08-23;
independent provider re-reads then verified every binding before Functions
deployment:

1. `roles/datastore.user` with one IAM condition whose `resource.name` is
   exactly either `projects/cabohealth-owner-prod/databases/(default)` or
   `projects/cabohealth-owner-prod/databases/cabohealth-review-production`;
   an unconditional project-wide binding is forbidden.
2. Project custom role
   `projects/cabohealth-owner-prod/roles/cabohealthAuthUserDeletion`, containing
   only `firebaseauth.users.delete`, bound to the runtime identity. The runtime creates custom-token subjects by
   signing and does not need Firebase Auth configuration, listing, email, or
   claim-management permissions.
3. `roles/iam.serviceAccountTokenCreator` on the
   `cabohealth-functions` service-account resource, with that same service
   account as the only member. This supplies `iam.serviceAccounts.signBlob`
   without allowing it to impersonate a different identity.
4. `roles/secretmanager.secretAccessor` separately on each of the 16 exact
   production/review ring resources. No project-wide Secret Manager accessor
   binding is permitted.

The current project-policy re-read returned exactly the custom deletion role,
conditional `roles/datastore.user`, `roles/firebaseappcheck.tokenVerifier`, and
`roles/logging.logWriter` for this identity. The current exact App Check binding
was independently verified; this record does not claim that the diagnostic
operation was necessarily its first creation. The service-account resource
policy returned only self-member `roles/iam.serviceAccountTokenCreator`.
Sixteen independent secret-policy re-reads each returned the expected accessor
binding.

The current project-level `roles/firebaseappcheck.tokenVerifier` binding applies
only to the dedicated Functions runtime identity. The predefined role permits
`firebaseappcheck.appCheckTokens.verify`; it grants no provider, app, IAM,
Firestore, Secret Manager, or project mutation authority. This current-state
verification supplements the predeployment policy history above without
asserting when the binding was first created.

This policy can read/write/delete application documents in only the two named
Firestore databases, delete the pseudonymous Firebase Auth users that the
durable erasure workers own, sign the app's custom login tokens as itself, read
only the named runtime secrets, verify App Check tokens, and write logs. It
grants no billing, project administration, IAM administration, database
creation/deletion, Auth configuration, App Check provider mutation, or access
to any other service account.

## Functions deployment state

The first Functions-only deployment used the reviewed private Firebase config
with SHA-256
`d7ab378d3bc1f1203a639ec18c4c3e53d76722dbdb1faac1284d387c89788c8f`.
It created 22 callable Functions, two HMAC-authenticated HTTP brokers, and two
five-minute scheduled workers. The provider inventories independently agreed
on 26 functions, Node.js 22, `us-central1`, `ACTIVE`, and the exact runtime
service account. The scheduler inventory returned both jobs `ENABLED`.

Firebase reported successful creation of all 26 Functions but returned a final
non-zero status because the Artifact Registry repository initially had no
cleanup policy. On 2026-08-23 Ivan explicitly authorized seven-day retention.
Firebase applied `firebase-functions-cleanup` to the `gcf-artifacts` repository,
and an independent Artifact Registry read verified action `DELETE`, tag state
`ANY`, and `olderThan: 604800s`. This bounds old-image storage cost while
retaining a seven-day rollback window.

### Current source-to-production delta

Production still runs the transitional slotless-v1 access-code binary within
the verified 26-Function inventory. Two later states are committed and locally
tested but not deployed:

1. the temporary bridge accepts legacy schema 1 with slot `1..4`, the single
   known schema-1 slotless transitional shape, and schema 2 without `slot`,
   while every newly issued code uses schema 2;
2. the final strict reader rejects schema 1 without a valid legacy slot and
   accepts schema 2 only without `slot`.

The bridge must be deployed first. Then an explicitly authorized operation may
change only the known record's `schemaVersion` from 1 to 2 with an exact
`updateTime` precondition and a sanitized aggregate read-back. Only after that
verification may the strict reader be promoted. Neither the bridge nor the
strict source commit is described here as already active.

## Plan and apply the owner bootstrap v2

Identity Platform has already been initialized for this project. Email/password
sign-in is enabled under the 14-character uppercase/lowercase/numeric policy,
forced password upgrade, and email-enumeration protection described above. TOTP
remains globally enabled only as a dormant capability. The Firebase-hosted
domains plus `cabohealth.org` are the only authorized domains. Do not add
`localhost` to production merely for development: local work uses the Auth
emulator.

The owner Auth user must already exist in the exact project, be enabled, have a
verified email, include the `password` provider, and have zero enrolled factors.
The bootstrap tool does not create users, reset passwords, remove factors, accept
an email address, or accept credential material. Put only the Firebase Auth UID
in a private mode-`0600` file without exposing it in shell history.

Wait for the owner's password-reset confirmation before the separately
authorized factor removal. Then re-read the account, remove only the expected
factor, verify zero factors, revoke refresh tokens, and run the v2 bootstrap.
Never copy the email address, password, reset link, factor secret, verification
code, token, or UID into a terminal, ticket, screenshot, repository file, or
release evidence. The full operational sequence and failure-clearing guarantees
are in `staff-portal/README.md`.

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

Review the private plan offline. It uses `schemaVersion: 2` and contains exactly:

1. owner requirements `disabled: false`, `emailVerified: true`, provider
   `password`, and `factorCount: 0`;
2. `catalogAdmin: true`, merged without deleting unrelated existing claims;
3. active `_private_admins/{ownerUid}` scope `production` with exactly
   `client_codes`, `client_resource_drafts`, and `app_review_credential`;
4. active `_private_client_resources/client-resources`, icon `featured`, fixed
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
production mutation approval. IAM, database creation, parameters, secrets,
rules/TTL deployment, bootstrap application, and the password-only owner E2E
are complete. Current external gates are the schema bridge/migration/strict
promotion, physical-iPhone App Check/App Attest, App Review credential and
valid-flow E2E, and the exact RC/TestFlight evidence. Do not create a staging
project without a superseding owner-approved ADR. The owner completed the final
password-only migration check on 2026-08-23 as recorded in the dated Staff
Portal activation record; that check does not complete the separate Apple and
release gates.
