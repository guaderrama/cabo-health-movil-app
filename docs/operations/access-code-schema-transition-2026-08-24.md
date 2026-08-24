# Access-code schema transition activation — 2026-08-24

Status: **COMPLETE / STRICT PRODUCTION READER ACTIVE**. This is a sanitized
permanent record. It excludes access codes, user identifiers, raw document
names, timestamps, credentials, private bucket names, object paths, operator
identity, and journal contents.

## Exact release authority

- Strict source commit: `d0b0767af42fb69f5046224baffe0705dc434cb7`
- Strict source SHA-256:
  `510c525028d2076460e5c363f9e643532dd44037cf582116e98fe43b871d56fa`
- Clean build-tree SHA-256:
  `52b477aa8e51821d5a48cf151d01854057931b539d02379bb8850ecdf10c6beb`
- Deployed 11-artifact-set SHA-256:
  `ba76d720ebbbc63389494128521880db867b21316e1c9b4cd7404730f99ce503`
- Deployed runtime SHA-256:
  `49143837847e35fc78911d219a0543b8ff98a13a8d60806537bc006a2bc92f1a`
- Transition controller SHA-256:
  `de2194a72bdafb78782a52887d20199d6669ebe317c5f5b76570e6b79bb34739`
- Writer-gate plan SHA-256:
  `920e5efe87121d44b5fb96d2cb90f49efeb1cbbc5cd0201f6c3b9bb22a0d074b`

The strict reader accepts schema 1 only with a valid historical slot `1..4`.
It accepts schema 2 only when the `slot` property is absent. New slotless codes
are written only as schema 2.

## Backup and serialized mutation

A complete Firestore export finished before the mutation. Its dedicated
private recovery bucket was verified for Public Access Prevention, uniform
bucket-level access, versioning, retention, soft delete, restricted IAM, and
the completed export metadata object. No exported document payload was printed
or retained in public evidence.

The reviewed bridge was deployed first. Its package, lockfile, build tree,
runtime, and 11 deployed source artifacts matched their local reviewed bytes.
The exclusive writer gate then paused eight services and the deletion scheduler
and completed a nine-minute maximum request drain plus public data-plane denial
probes.

Exactly one preconditioned Firestore patch changed only `schemaVersion` from 1
to 2. A response-path failure after the patch was resolved from the durable
private journal: an exact postcondition check proved the mutation had committed,
and the idempotent rerun issued no second patch.

## Sanitized postconditions

- Before-state SHA-256:
  `77ebbb47acda14c1004cd143ea617effd69c0ef95e890f4a61eff35e6622d74d`
- After-state SHA-256:
  `9bbf504ce5ecbc462760122b660ec98d75165e1005f99d02c01f433f14066e3c`
- Access-code records: `1`
- Schema-2 slotless records: `1`
- Schema-1 slotless records: `0`
- Schema-1 slotted records: `0`
- Invalid records: `0`
- Legacy slot-ledger documents: `0`
- Active-code counter: absent
- Updated fields: exactly `schemaVersion`
- Sensitive values in evidence: `false`

The hashed document identity remained unchanged across the mutation at
`ac6397a3209b91832511ce8086ed99c53ce37b8f5fb0c8467da7f9b0a1b18390`.
Its sanitized update-time hash changed, consistent with the exact one-field
patch.

## Strict promotion and service restoration

The exact 11 Functions were promoted from the bridge to the strict build. The
deployed build matched the clean local build byte for byte. Provider reads then
confirmed:

- 26/26 Functions `ACTIVE`, all on Node.js 22;
- 26/26 Cloud Run services `Ready`;
- 26/26 services sending 100% traffic to the latest ready revision;
- eight writer services restored to their exact reviewed invocation policies;
- deletion scheduler restored to `running`.

The final Functions inventory SHA-256 is
`fad33ae622b004c53815ca9787a8ffbb57fa7965e361f2bd6d85ad498e7b5d3e`.
The final Cloud Run inventory SHA-256 is
`b09205454e6dadfd933d18e041dc101f57b5794a4e1ff6a26a66bf7d81763175`.

Rollback is permitted only to the reviewed bridge or another independently
verified schema-v2-compatible build. The former transitional slotless-v1
binary must never be restored.
