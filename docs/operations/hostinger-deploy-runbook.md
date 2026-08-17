# CaboHealth Hostinger release and rollback runbook

Status: **deployment blocked**. This runbook is an execution contract, not deployment authorization. As of 2026-08-16, the 11 external compliance facts, final legal copy/sign-off, production legal hashes, and `releaseReady: true` are incomplete. Do not connect to Hostinger, assemble a real bundle, create production evidence, or promote a file while those gates remain incomplete.

## Fixed scope

The public payload is exactly 14 files: canonical AASA; Privacy, Terms, Support, and Report Content HTML; `apps/.htaccess`; the two approved module roots; and four shared assets. The promotion units, in required order, are:

1. `public_html/apps/.htaccess`
2. `public_html/apps/shared/`
3. `public_html/app/privacy/`
4. `public_html/app/terms/`
5. `public_html/app/support/`
6. `public_html/app/report-content/`
7. `public_html/apps/healthy-recipes/`
8. `public_html/apps/clinic-guide/`
9. `public_html/.well-known/apple-app-site-association`

Never change the WordPress root, theme, Media Library/uploads, database content, root `.htaccess`, unrelated assets, or the protected PHI-remediation rule. Never use recursive removal, `mv -f`, `cp -r`, broad `rsync`, tar extraction, manifest-selected paths, or an unreviewed remote script.

## Gate and assemble locally

From a clean, reviewed commit, use the direct entrypoints:

```text
node scripts/assemble-web-release.mjs --check
node scripts/assemble-web-release.mjs --assemble
node scripts/verify-production.mjs --check
```

The first command must report `COMPLIANCE_FACTS_INCOMPLETE` now and must not create `release/web-artifacts.json`, `release/production-urls.json`, or `release/web-bundles/`. Once all facts are independently verified, replace the four deliberately null legal pins only after reviewing the final bytes. The assembler then snapshots the verified Task 6B capsule through `readVerifiedMiniappArtifact`, captures fixed public inputs through no-follow directory descriptors, materializes the content-addressed bundle, re-verifies it, and exclusively publishes provenance.

The immutable upload object will be:

```text
release/web-bundles/<release-id>.transport.json
```

Review its SHA-256, its embedded `inventorySha256`, and the matching `release/web-artifacts.json` before transfer. Do not upload source directories or ad hoc files.

## Action-time authorization and backup

Immediately before any connection or mutation:

- obtain explicit owner authorization for this exact release ID;
- use the already configured private key and pinned host identity with strict host-key checking;
- validate the fixed account and public-root mapping read-only, without recording them in Git;
- create fresh file and database backups outside `public_html` with `0700/0600` access;
- verify backup hashes and a restore listing, and retain only an opaque rollback ID in committed evidence;
- prove the private stage, rollback root, and `public_html` are owned real directories on one device;
- prove the host supports atomic no-replace and exchange operations. Stop if any capability is absent.

No credentials, server address, host key, private path, command line, raw log, cookie/header value, backup name, request ID, or incident identifier may enter Git.

## Private stage and verification

Transfer only the reviewed transport object and the separately reviewed release ID. Install the checked-in `scripts/secure_web_release.py` only after comparing its hash to the reviewed commit. On the remote filesystem, feed the immutable transport bytes to:

```text
python3 secure_web_release.py materialize-stage <owned-private-root> <reviewed-release-id> < immutable-transport-object.json
```

The helper accepts only its fixed schema and 14-path allowlist, requires the caller's reviewed release ID, and creates no public path. A collision or partial stage is quarantined in place for manual review; it is never cleaned recursively.

Compare the private stage's exact paths, modes, sizes, and hashes to `release/web-artifacts.json`. Serve it on loopback only and inspect it through the authenticated tunnel. Test 390×844 and 320×568, English and es-MX, JavaScript enabled and disabled, Reduce Motion and pause behavior, keyboard/focus, canonical/legal navigation, and zero unexpected console or network activity. Do not create a public staging hostname.

## Promote and rollback

Before promotion, complete a private-clone rehearsal with the same transport and helper. On the remote filesystem, the reviewed helper entrypoint is:

```text
python3 secure_web_release.py promote-local <owned-deployment-root> <reviewed-release-id> < immutable-transport-object.json
```

Despite the command name, this operates only on the filesystem local to the host; it performs no network action. It preflights all nine exact leaves, rejects links/special files/unexpected inventory, checks device and ownership, journals only sanitized target states and hashes, and uses atomic no-replace/exchange operations. A failure attempts reverse-order rollback of already promoted units. It never deletes either release.

Manual or rehearsed rollback uses the same reviewed transport bytes:

```text
python3 secure_web_release.py rollback-local <owned-deployment-root> <reviewed-release-id> < immutable-transport-object.json
```

Rollback restores previously present leaves and restores absence for originally absent leaves while preserving the displaced release under the rollback directory. A rollback collision is a hard stop. A live downgrade/upgrade rehearsal requires separate action-time authorization; otherwise record only the verified private rehearsal and leave the live-rehearsal gate pending.

## Production verification

After each promoted unit, re-open and hash the live leaf, probe the WordPress root, and append only the sanitized journal state. After all nine units, purge only exact promoted URLs. With action-time authorization, run:

```text
node scripts/verify-production.mjs --verify-production-origin --confirm-production=cabohealth.org
node scripts/verify-production.mjs --verify-apple-cdn --confirm-production=cabohealth.org
```

Normal `--check` mode is offline. Production network access requires the exact confirmation flag. The origin verifier owns its URL/header policy; it does not read URLs from mutable evidence. It checks exact status/final URL/content type/body hash, CSP and framing, no cookies, canonical/legal links, blocked directory listing and `.htaccess`, a missing random third slug, and the WordPress control. The Apple CDN result is independent. Stale CDN bytes are `APPLE_CDN_PENDING_PROPAGATION`; wait up to 24 hours and do not bypass the gate.

Only after origin, browser, unrelated-control, server-side inventory, private rollback rehearsal, and Apple CDN verification are green may an operator create canonical sanitized `release/production-urls.json`. It must contain the exact schema accepted by `node scripts/verify-production.mjs --check`; raw headers, cookie values, identities, private paths, and logs are forbidden. Keep the previous leaves and backups until App Review and the explicit retention decision.
