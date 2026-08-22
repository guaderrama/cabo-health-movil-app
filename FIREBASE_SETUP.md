# Firebase setup — retired instructions

This file used to describe a direct client-to-Firestore development setup. It
is intentionally retired because that design exposed data and allowed the app
to treat public Firebase identifiers as if they were credentials.

Do not recreate the legacy setup:

- Never enable Firestore's permissive development mode for a shared project.
- Never grant direct mobile or web SDK access to the legacy catalog or access
  records.
- Never paste authentication secrets into source files or documentation.
- Never run the retired data seeding or catalog update scripts against a
  remote project.

The committed `firestore.rules` policy denies every direct client operation.
Future privileged operations must cross an authenticated server boundary; the
server uses its runtime identity and secrets from a managed secret store.

For backup, deployment, verification, and rollback gates, follow
`docs/operations/firestore-legacy-containment.md`.

For the isolated default/review database configuration, emulator proof, and
guarded owner/bootstrap handoff, follow
`docs/operations/firebase-activation.md`. Its cloud steps require separate
owner approval; the checked-in configuration remains deliberately fail-closed.
