# ADR 0001: One dedicated Firebase production project

- Status: **Accepted by owner**
- Decision date: **2026-08-22**
- Owner: **Ivan Guaderrama, Individual Apple Developer seller**
- App: Apple ID `6758285327`; bundle ID `com.cabohealth.app`

## Context

CaboHealth is a small, owner-operated general-wellness app. Ivan decides which existing clients receive protected Client Resources access. For every person he authorizes, the Staff Portal creates a separate one-time code that can be expired or revoked independently. There is no fixed four-client or ten-client business limit and no shared master code.

The earlier release design required separate permanent Firebase staging and production projects. That maximized isolation but added billing, credentials, IAM, App Check, secrets, deployment, evidence, and maintenance work disproportionate to the present user count. Apple Review still needs isolation from real client records, and production App Attest still needs physical-device verification.

An older Google Cloud project exists:

- display name `Cabo Health Nova`;
- project ID `gen-lang-client-0235396842`;
- active Cloud Run service `cabo-health-nova`;
- no Firestore, Cloud Functions, or Secret Manager service enabled when inspected on 2026-08-22;
- unrelated API history and a project ID that does not satisfy the native `cabohealth-` identity boundary.

It is preserved as legacy infrastructure and is not the Firebase authority for this release.

## Decision

Use exactly one dedicated Firebase project for the submitted app:

- project ID: `cabohealth-owner-prod`;
- display name: `CaboHealth Production`;
- owner/operator account at provisioning: owner-controlled account, identifier
  retained only in private evidence;
- billing: owner-controlled account, identifier retained only in private
  evidence;
- development and automated rules tests: local Firebase Emulator Suite using only `demo-cabohealth`;
- real clients and staff: `(default)` Firestore database;
- Apple Review sample: named Firestore database `cabohealth-review-production` in the same project;
- public and protected web delivery: Hostinger, with separate production and App Review broker realms and secrets;
- no permanent Firebase staging project at the current scale.

The named App Review database is not a substitute for every isolation control. It must retain separate rules, collections, HMAC/pepper rings, broker identity, credential generation, fixed non-client content, deletion lifecycle, and cross-realm denial tests. Apple must never receive a production client code or record.

## Environments

| Environment | Firebase authority | Permitted data | Purpose |
| --- | --- | --- | --- |
| Local development/test | Emulator project `demo-cabohealth` | Synthetic fixtures only | Unit, emulator, hostile-path, rules, deletion, and failure testing |
| Hostinger pre-activation stage | No independent Firebase project | Reviewed static/protected artifact and non-secret configuration evidence only | PHP/origin/header/rollback verification before promotion |
| Production | `cabohealth-owner-prod`, `(default)` | Owner-authorized client grants, owner staff identity, reviewed catalog | Submitted app and real owner operations |
| Apple Review | `cabohealth-owner-prod`, `cabohealth-review-production` | Fixed bilingual non-client sample and pseudonymous review identity only | Multi-device App Review access |

Do not point an internal preview build at real production client records. Production App Attest and end-to-end behavior are verified on the exact TestFlight release candidate using only the fixed review sample or explicitly disposable synthetic records, then the evidence is retained without secrets.

## Firestore location decision

Owner approval was recorded on 2026-08-22, after acknowledging that the location cannot be changed afterward. Both Firestore Native databases were then created in Standard edition in `nam5`, with deletion protection enabled: `(default)` for production and `cabohealth-review-production` for the isolated Apple Review realm. Point-in-time recovery remains disabled. On 2026-08-23 the 26-Function production baseline was deployed to `us-central1` and independently verified `ACTIVE` under the dedicated runtime identity. Later committed bridge and strict-reader source changes are not included in that deployed baseline.
On 2026-08-24 the bridge was promoted temporarily, the single sanitized
slotless record was changed only from schema 1 to schema 2 under its exact
update-time precondition, and the final strict reader was deployed and
independently verified across the 26-Function inventory.

The two databases now permanently use the same approved United States multi-region. Any later residency or topology change requires a new project/database migration and a separate ADR; it cannot mutate these database locations.

## Cost controls

One project removes the duplicated staging baseline. The project uses an owner-controlled pay-as-you-go billing account whose currency is USD. On 2026-08-22 the owner authorized a 300 MXN monthly reference. Using Banco de México's 2026-08-21 FIX of 16.9018 MXN/USD, the project-scoped recurring monthly alert budget was created as USD 17.75, with current-spend alerts at 50%, 90%, and 100%. Exchange-rate movement means the peso equivalent can vary. Google Cloud budgets send alerts but do not stop services or guarantee a hard spending cap. Quotas, maximum Function instances, concurrency, callable rate limits, administrator authentication, and per-code expiry/revocation remain the primary technical cost controls.

Do not enable Analytics, advertising, tracking, Storage, or a service merely because it is available. Every enabled API or billable resource must support a documented runtime requirement.

## Operational state — reviewed 2026-08-24

Completed:

- Google Cloud project `cabohealth-owner-prod` created and ACTIVE.
- Billing linked to an owner-controlled account; account identifiers and prior
  billing-account diagnostics are retained only in private evidence.
- Required service APIs enabled for Firebase management, Authentication/Identity Toolkit, Firestore/rules, Functions/Cloud Run/build/artifacts, Secret Manager, App Check, reCAPTCHA Enterprise, Eventarc/Pub/Sub, IAM credentials, Storage API dependency, and billing budgets.
- Firebase added to the Google Cloud project; Firebase state verified ACTIVE.
- Firebase iOS app `CaboHealth iOS` registered for bundle `com.cabohealth.app`, App Store ID `6758285327`, and Apple team `DQ8PH2DZ3R`.
- Firebase web app `CaboHealth Staff Access` registered for the staff portal.
- App Attest provider registered for the iOS app with a one-hour App Check token TTL. Enforcement remains off until the exact signed TestFlight client produces valid metrics.
- A score-based reCAPTCHA Enterprise key named `CaboHealth Staff App Check` is restricted to `cabohealth.org`. It is registered as the staff web app's App Check provider with a one-hour token TTL and minimum valid score `0.5`; the public site-key value remains outside Git.
- Identity Platform initialized. Email/password sign-in is enabled, TOTP is the enabled MFA provider with one adjacent clock interval, and the only custom authorized web domain is `cabohealth.org` for the canonical `https://cabohealth.org/staff/` surface.
- Firestore Native `(default)` and `cabohealth-review-production` created in Standard edition in `nam5`, both with deletion protection enabled and point-in-time recovery disabled.
- A project-scoped recurring monthly billing budget of USD 17.75 was created as the owner-authorized 300 MXN reference, with current-spend alerts at 50%, 90%, and 100%; the owner billing administrator receives the default notifications.
- Exact deny-all Firestore rules compiled and were released to `(default)` and `cabohealth-review-production`. Both index definitions were accepted; a later provider read confirmed all seven production and six review TTL field operations `ACTIVE`.
- Sixteen independent production/review Secret Manager key rings were created with version label `2026-08`; no secret value was written to the repository or terminal transcript.
- Dedicated Functions runtime identity `cabohealth-functions@cabohealth-owner-prod.iam.gserviceaccount.com` was created. On 2026-08-23 the owner authorized and provider re-reads verified conditional `roles/datastore.user` for exactly the two approved database names, custom role `cabohealthAuthUserDeletion` containing only `firebaseauth.users.delete`, self-resource `roles/iam.serviceAccountTokenCreator`, `roles/logging.logWriter`, and per-resource accessor bindings on exactly the 16 runtime secrets. Source and regression tests require every callable, scheduled job, and HTTP broker to use this identity.
- The final strict Node.js 22 backend is deployed to `us-central1`; provider
  inventories returned 26/26 Functions `ACTIVE` and 26/26 Cloud Run services
  `Ready` with 100% latest-revision traffic. The eight writer services and
  deletion scheduler were restored to their exact reviewed running state after
  the serialized schema transition. Both HTTP brokers remain fail-closed to
  unauthenticated callers.
- Owner authorized seven-day Artifact Registry retention on 2026-08-23. Provider verification returned cleanup action `DELETE` for any Functions container image older than `604800s` in `us-central1/gcf-artifacts`.
- The owner Auth identity, password-only bootstrap, zero-factor migration, fresh
  Staff Portal sign-in, and authenticated `adminGetStaffSession` HTTP 200 are
  complete. The public web release, protected production/App Review overlay,
  and password-only Staff Portal are deployed and independently verified.
- The pinned Firestore emulator gate passed production 2/2 and App Review 2/2;
  its temporary Java runtime, emulator JAR, and log were removed after the run.
- The owner/operator currently has the project Owner role. Firebase-created service agents and default compute/App Engine service accounts exist; their effective roles remain part of every deployment review.

Not completed:

- DeviceCheck fallback is not configured, and production App Attest enforcement
  and physical-iPhone proof remain pending.
- No App Review credential has been issued; valid-credential, reciprocal-realm,
  deletion/retry, and two-iPhone E2E remain pending.
- No exact 3.0/build 4 RC or TestFlight build exists, and nothing has been
  submitted to Apple from this source state.

## Current normative owner-auth references

The single-project architecture remains unchanged. Current owner authorization
is password-only and still requires a recent sign-in no older than 15 minutes,
the `catalogAdmin: true` custom claim, and the exact private admin document.

The password policy requires at least 14 characters with uppercase, lowercase,
and numeric characters; a symbol is not required. Forced password upgrade and
email-enumeration protection remain enabled. The global TOTP provider remains
enabled as a dormant platform capability, not as a current owner-authentication
requirement.

Bootstrap v2 fails closed unless the owner exists, is enabled, has a verified
email, includes the `password` provider, and has exactly `factorCount: 0`.
Operational evidence records only sanitized statuses, counts, hashes, and
provider outcomes—never an email address, UID, password, reset link, factor
secret, verification code, or token.

The current procedures and evidence are authoritative in
[`firebase-activation.md`](../operations/firebase-activation.md) and
[`staff-portal-production-activation-2026-08-23.md`](../operations/staff-portal-production-activation-2026-08-23.md).
Those operational records may advance without rewriting the historical snapshot
in this ADR.

Current provider evidence also verifies
`roles/firebaseappcheck.tokenVerifier` on the dedicated Functions runtime
identity. Its authority is limited to App Check token verification and does not
expand Firestore, Secret Manager, IAM, or project-mutation authority. The
Firebase activation runbook records the exact binding and provider read-back.

## Consequences

Benefits:

- one billing/project/IAM/App Check/secrets surface;
- lower operational overhead for the current owner and client count;
- existing legacy project remains untouched;
- Apple Review remains data-isolated at the database, broker, key-ring, and content boundaries.

Tradeoffs:

- there is no cloud replica for destructive deployment rehearsal;
- exact production-service integration tests require disposable synthetic records and stricter cleanup/evidence;
- a project-level IAM or service-configuration mistake can affect both production and review realms;
- a future team or higher deployment frequency may justify restoring a dedicated staging project.

## When to revisit

Create a new ADR before adding a permanent staging project. Revisit this decision if any of the following becomes true:

- multiple people deploy or administer production;
- releases become frequent enough that emulator and exact-RC testing no longer provide sufficient confidence;
- client volume, paid access, sensitive data, or regulatory scope increases materially;
- Apple or a security review requires project-level separation;
- production migrations need realistic rehearsals that cannot be safely represented by synthetic fixtures;
- project-level quotas, IAM, App Check, or incident containment require an independent environment.

## Client-code product decision

Owner clarification recorded on 2026-08-22: Ivan may create an individual code for any existing client he chooses to authorize. Every code grants the fixed reviewed Client Resources entitlement, is shown only once, binds to the first installation, expires, and can be revoked without affecting other clients. The backend, portal, release metadata, and tests must not restore a fixed four-slot ledger or introduce a shared reusable master code.

This decision removes only the artificial business cap. Provider quotas, abuse controls, one-at-a-time plaintext handling in the portal, expiration, individual revocation, App Check, and Apple Review isolation remain mandatory.
