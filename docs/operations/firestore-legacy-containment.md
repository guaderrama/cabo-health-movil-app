# Firestore legacy containment runbook

## Status and access decision

The dedicated Firebase project and its two Firestore databases were created
empty. The two exact deny-all rulesets and index/TTL definitions were deployed
on 2026-08-22. The initial provider read reported all 13 TTL field operations
as `CREATING`; a later read on the same date confirmed every field `ACTIVE`.
The production database now contains only the separately reviewed bootstrap and
controlled access state; the App Review database remains empty until its gated
credential rotation. No backup bucket was created during initial provisioning.
See
[`firebase-activation.md`](firebase-activation.md) for the authoritative
provisioning state and exact deployment command.

The current prospective source candidate reads its public catalog from
committed local data and has no runtime dependency on the legacy Firestore
client services.
Therefore no legacy anonymous read is strictly necessary. The committed policy
is intentionally default-deny for anonymous and authenticated client SDKs.
Future catalog, client-code, and administrator operations must cross a trusted
server boundary; Firebase Admin SDK access is governed by IAM and is not granted
by client rules.

Before deploying, verify in App Store Connect and TestFlight that no supported
distributed build still depends on direct Firestore reads. Retire or replace an
affected build. Availability is not a reason to reopen a public collection.

## Mandatory prerequisites

- Use an approved change window and two-person review.
- Record the exact production project ID in the private change ticket. Never
  rely on the `default` alias from `.firebaserc`.
- Use a pinned Firebase CLI and a pinned Google Cloud CLI from the controlled
  release environment. Record their versions in the private change ticket.
- The operator needs only Firestore export/deploy permissions. The backup
  reviewer needs read-only metadata access, not document-content access.
- Prepare a dedicated backup bucket in a compatible location with **Public
  Access Prevention** enforced, uniform bucket-level access, object versioning,
  retention, encryption, and no `allUsers` or `allAuthenticatedUsers` binding.
  Limit the bucket to the Firestore service agent and named recovery operators.
- Do not paste project identifiers, account tokens, document values, client
  codes, or exported object URLs into terminal transcripts or this repository.

Every future rules or schema mutation must re-run the pinned Firebase Emulator
Suite and `@firebase/rules-unit-testing` gate in the controlled environment.
The required runtime was available temporarily for the verified 2026-08-24
run; it was removed afterwards and must be provided again for the next gate.
The semantic matrix must prove that anonymous and ordinary authenticated
contexts receive `permission-denied` for get, list, create, update, and delete.
The static repository test is an additional guard, not a substitute.

## 1. Local and pre-deployment gates

From the exact release commit:

```sh
node --test tests/firestore-containment.test.mjs
npm test
npm run typecheck
```

Run the pinned semantic test through the emulator using the isolated project
name `demo-cabohealth`; it must not reference a real Firebase project:

```sh
npm run test:firestore-rules:emulator
```

The command performs two sequential emulator executions because the pinned
Firestore emulator cannot load both database rule targets safely at once. It
maps `firestore.rules` and `firestore.review.rules` to `(default)` separately
and requires both anonymous read/write probes to fail with HTTP 403.

On 2026-08-24 this exact command passed against the pinned Firestore emulator:
the production rules rejected both probes (2/2), and the App Review rules
rejected both probes (2/2). Java 21 and the emulator JAR were confined to a
temporary directory and removed with the generated emulator log immediately
after the run.

Required matrix:

| Context | get/list | create/update/delete |
| --- | --- | --- |
| Anonymous client SDK | denied | denied |
| Authenticated non-admin client SDK | denied | denied |
| Authenticated administrator client SDK | denied | denied |

A trusted backend smoke test is separate: its Admin SDK runtime identity should
succeed only on the minimum collections required by that backend. Never embed a
service-account key in the app, repository, shell history, or backup log.

## Access-code schema transition

The owner-approved access model removed the historical fixed four-slot ledger.
New slotless `_private_access_codes` records use `schemaVersion: 2`. The final
strict reader accepts schema 1 only when a valid legacy slot `1..4` is present
and schema 2 only when `slot` is absent. That strict reader is committed but
must not be deployed until the transition below is complete.

A field-mask-only production read on 2026-08-24 returned sanitized counts only:
one schema-1 slotless transitional record, zero schema-1 records with a legacy
slot, zero schema-2 records, zero invalid records, zero slot-ledger documents,
and no active-code counter. It did not read or retain a code, document ID,
suffix, timestamp, client field, or resource field.

The currently deployed transitional slotless-v1 Functions binary created that
record. It is not a verified schema-v2 reader and therefore is neither the
bridge nor a safe rollback after the first schema-v2 write.

Use one serialized maintenance window in this exact order:

1. Pause owner code issuance and revocation. Deploy the reviewed temporary
   bridge reader. It must accept only schema 1 with a valid legacy slot, the
   known schema-1 slotless transitional shape, and schema 2 without `slot`.
   New codes must be written only as schema 2 without `slot`.
2. Confirm the bridge is healthy. Then, and only with explicit owner
   authorization, update only the transitional record's `schemaVersion` from 1
   to 2 using its exact `updateTime` precondition. Do not rewrite any other
   field.
3. Re-read only `schemaVersion` and `slot` and require exactly one schema-2
   slotless record, zero schema-1 slotless records, and zero invalid or
   ambiguous records.
4. Deploy the final strict reader, repeat the sanitized aggregate read, and
   resume owner issuance and revocation.

Until step 4 completes, rollback only to the reviewed bridge. Afterwards,
rollback only to the bridge or another reviewed schema-v2-compatible build.
Never roll back to the currently deployed transitional slotless-v1 binary, and
never silently treat a schema-1 record without a slot as a permanent format.

## 2. Create and verify the private remote backup

Set task-specific shell variables to exact values from the private change
ticket. The prefix must be unique and immutable for this change:

```sh
CH_FIREBASE_PROJECT='<exact-production-project-id>'
CH_FIRESTORE_BACKUP_BUCKET='<private-backup-bucket>'
CH_FIRESTORE_BACKUP_PREFIX='<approved-UTC-timestamp-and-change-id>'
```

Verify bucket controls before export. Stop if Public Access Prevention is not
enforced, uniform access is off, retention is absent, or public IAM is present.
Do not save the command output in the repository.

```sh
gcloud storage buckets describe "gs://${CH_FIRESTORE_BACKUP_BUCKET}" --project="${CH_FIREBASE_PROJECT}"
gcloud storage buckets get-iam-policy "gs://${CH_FIRESTORE_BACKUP_BUCKET}" --project="${CH_FIREBASE_PROJECT}"
```

Export the complete database before changing rules. Do not limit the export to
the known legacy collections; unknown collections are part of the recovery set.

```sh
gcloud firestore export "gs://${CH_FIRESTORE_BACKUP_BUCKET}/${CH_FIRESTORE_BACKUP_PREFIX}" --project="${CH_FIREBASE_PROJECT}"
```

Wait for the operation to report success. From the export result, set the exact
metadata object URI and verify its existence and generation without reading or
listing document payloads:

```sh
CH_EXPORT_METADATA_URI='gs://<private-backup-bucket>/<exact-export-prefix>/<exact>.overall_export_metadata'
gcloud storage objects describe "${CH_EXPORT_METADATA_URI}" --project="${CH_FIREBASE_PROJECT}"
```

The private change ticket must record the successful operation ID, completion
time, bucket, object generation, database ID, source project, and the Git commit
and SHA-256 of `firestore.rules`. Do not record document contents or raw client
codes. A backup is not accepted merely because an export command started.

## 3. Deploy default-deny rules

Recheck the project ID and rule hash immediately before deployment. The reviewer
must compare the exact deployed candidate with the approved commit.

```sh
shasum -a 256 firestore.rules
firebase deploy --only firestore:rules --project="${CH_FIREBASE_PROJECT}"
```

Do not deploy indexes, Functions, Hosting, Auth configuration, or application
code in the same command. Capture the rule release identifier and timestamp in
the private change ticket, but do not capture credentials or data.

## 4. Post-deploy verification

Run probes against fixed synthetic document IDs created for this change; probes
must report only operation name, status, and `permission-denied` outcome.

- Anonymous get and list: denied.
- Anonymous create, update, and delete: denied.
- Authenticated ordinary-user get and list: denied.
- Authenticated ordinary-user create, update, and delete: denied.
- Authenticated administrator client-SDK operations: denied.
- Trusted backend Admin SDK health probe: succeeds with its least-privilege IAM.
- Current iOS public catalog and hosted miniapps: continue to work without
  Firestore.

Monitor denied-request volume and backend errors during the change window. Any
unexpected client dependency is handled by disabling that feature or releasing
the corrected client; do not weaken the rules.

## 5. Fail-closed rollback

Rule rollback means deploying a previously approved **secure** rules commit. It
must never restore public read or write access, including temporary anonymous
access to legacy catalog or access-code collections. The original permissive
rules are not a rollback candidate.

If the new backend fails, roll back the backend release or disable its feature
flag while leaving Firestore client access closed. If data recovery is required:

1. Create an isolated, access-restricted recovery project.
2. Import the accepted export into that recovery project, not production.
3. Validate collection counts, schema, and expected identifiers without printing
   document values; quarantine any plaintext legacy code material.
4. Obtain incident-owner and security approval for a scoped production repair.
5. Re-run the backup and all gates before any production import.

The recovery-project import shape is:

```sh
gcloud firestore import "gs://<private-backup-bucket>/<accepted-export-prefix>" --project="<recovery-project-id>"
```

After recovery, revoke temporary operator access, retain the export according to
the approved retention policy, and attach only redacted evidence to the release
record.
