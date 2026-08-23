# ADR 0001: One dedicated Firebase production project

- Status: **Accepted by owner**
- Decision date: **2026-08-22**
- Owner: **Ivan Guaderrama, Individual Apple Developer seller**
- App: Apple ID `6758285327`; bundle ID `com.cabohealth.app`

## Context

CaboHealth is a small, owner-operated general-wellness app. The current private-access plan is four VIP client slots. Ivan also expects approximately five users with free access; whether those five need protected Client Resources codes or only the public Healthy Recipes and Clinic Guide remains unresolved.

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
- owner/operator account at provisioning: `glassexpression@gmail.com`;
- billing: an owner-controlled `Firebase Payment` account, suffix `BE8EF5`;
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
| Production | `cabohealth-owner-prod`, `(default)` | Maximum approved client slots, owner staff identity, reviewed catalog | Submitted app and real owner operations |
| Apple Review | `cabohealth-owner-prod`, `cabohealth-review-production` | Fixed bilingual non-client sample and pseudonymous review identity only | Multi-device App Review access |

Do not point an internal preview build at real production client records. Production App Attest and end-to-end behavior are verified on the exact TestFlight release candidate using only the fixed review sample or explicitly disposable synthetic records, then the evidence is retained without secrets.

## Firestore location decision

The database location is intentionally **not yet created** because it cannot be changed afterward. The current recommendation is Standard edition in `nam5` with deletion protection enabled for both `(default)` and `cabohealth-review-production`, and `us-central1` for Cloud Functions. The owner must approve that exact location and its United States data residency before database creation.

Both databases must use the same approved location unless a later ADR documents and tests a different latency, cost, residency, and endpoint design.

## Cost controls

One project removes the duplicated staging baseline. The project uses an owner-controlled pay-as-you-go billing account. A monthly alert budget and thresholds remain pending an exact amount; ordinary Google Cloud budget alerts do not guarantee a hard spending cap. Quotas, maximum instances, concurrency, callable rate limits, and the fixed client-slot limit remain the primary technical cost controls.

Do not enable Analytics, advertising, tracking, Storage, or a service merely because it is available. Every enabled API or billable resource must support a documented runtime requirement.

## Provisioning state at 2026-08-22

Completed:

- Google Cloud project `cabohealth-owner-prod` created and ACTIVE.
- Billing linked to the owner-controlled `Firebase Payment` account ending `BE8EF5` after the Cabo Health Nova account ending `83F51B` rejected another project because of its billing-project quota.
- Required service APIs enabled for Firebase management, Authentication/Identity Toolkit, Firestore/rules, Functions/Cloud Run/build/artifacts, Secret Manager, App Check, reCAPTCHA Enterprise, Eventarc/Pub/Sub, IAM credentials, Storage API dependency, and billing budgets.
- Firebase added to the Google Cloud project; Firebase state verified ACTIVE.
- Firebase iOS app `CaboHealth iOS` registered for bundle `com.cabohealth.app`, App Store ID `6758285327`, and Apple team `DQ8PH2DZ3R`.
- Firebase web app `CaboHealth Staff Access` registered for the staff portal.
- App Attest provider registered for the iOS app with a one-hour App Check token TTL. Enforcement remains off until the exact signed TestFlight client produces valid metrics.
- Identity Platform initialized. Email/password sign-in is enabled, TOTP is the enabled MFA provider with one adjacent clock interval, and the only custom authorized web domain is `cabohealth.org` for the canonical `https://cabohealth.org/staff/` surface.
- The owner/operator currently has the project Owner role. Firebase-created service agents and default compute/App Engine service accounts exist; their effective roles must be reviewed and reduced before Functions deployment.

Not completed:

- no Firestore database or location;
- no Authentication user, enrolled TOTP factor, custom claim, or private admin record;
- no deployed rules, indexes, TTL policy, Functions, runtime identity, or secrets;
- no DeviceCheck fallback key, web reCAPTCHA Enterprise provider, or App Check service enforcement;
- no Firebase budget amount or alert thresholds;
- no real client code, App Review credential, or protected resource URL;
- no Hostinger protected activation;
- no EAS/TestFlight production build.

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

## Open product decision

The backend and release metadata currently authorize a maximum of four protected existing-client slots. Before RC freeze, Ivan must confirm one of these truthful models:

1. the approximately five free users use only the two public resources, so the four-slot protected limit remains; or
2. those users also receive protected Client Resources codes, in which case capacity, metadata, Review Notes, tests, rate limits, privacy facts, and possibly Apple's external-access analysis must be revised before deployment.

No code or App Store claim may silently reinterpret those five users.
