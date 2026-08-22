# Legacy production checklist — retired

The former checklist targeted an obsolete app and security model. It contained
unsafe public-read guidance and static administrator bypass information, so its
operational content has been removed rather than archived in the repository.

It must not be used to build, deploy, or submit Cabo Health. In particular:

- there is no local PIN or static administrator bypass;
- client apps receive no direct Firestore access;
- access records are never public;
- a Firestore rules rollback may never restore anonymous reads or writes; and
- a release is not ready merely because a build command succeeds.

Use the current release artifacts under `release/app-store/3.0/`, the canonical
release verification scripts in `scripts/`, and
`docs/operations/firestore-legacy-containment.md` for Firestore containment.
