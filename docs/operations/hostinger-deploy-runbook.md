# CaboHealth Hostinger release and rollback runbook

Status: **local release assembled; live promotion still requires the exact release-ID authorization and private rehearsal below.** As of 2026-08-20, App Store Connect has saved the calculated 9+ rating, the exact host and two miniapp ratings are verified at 9, `releaseReady` is true, SSH/key access is active, and the local assembler can produce the reviewed 16-file payload. Production verification, private rehearsal, backups, atomic-capability proof, promotion, and real-iPhone QA remain incomplete. This runbook is an execution contract, not blanket deployment authorization.

## Fixed scope

The public payload is exactly 16 files: canonical AASA; Privacy, Terms, Support, and Report Content HTML; `apps/.htaccess`; the two approved module roots; and six shared assets. The promotion units, in required order, are:

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
node scripts/verify-production.mjs --check --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256> --reviewed-browser-measurement-sha256=<independently-reviewed-browser-evidence-sha256>
```

Whenever age evidence, legal pins, catalog ratings, or `releaseReady` are incomplete, the first command must report `COMPLIANCE_FACTS_INCOMPLETE` and must not create `release/web-artifacts.json`, `release/production-urls.json`, or `release/web-bundles/`. Final legal pins may be populated only after independent review of the exact bytes; pinning them does not bypass any remaining compliance gate. After every gate is independently verified, the assembler snapshots the verified Task 6B capsule through `readVerifiedMiniappArtifact`, captures fixed public inputs through no-follow directory descriptors, materializes the content-addressed bundle, re-verifies it, and exclusively publishes provenance.

The immutable upload object will be:

```text
release/web-bundles/<release-id>.transport.json
```

Review its SHA-256, its embedded `inventorySha256`, the canonical SHA-256 of the matching `release/web-artifacts.json`, and the release ID before transfer. The production verifier requires the last two values as separate action-time pins and recomputes the complete artifact schema, policy, inventory hash, and release ID before any fetch. Do not upload source directories or ad hoc files.

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
python3 secure_web_release.py root-identity <owned-private-root>
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> python3 secure_web_release.py materialize-stage <owned-private-root> <reviewed-release-id> < immutable-transport-object.json
```

The helper accepts only its fixed schema and 16-path allowlist, requires the caller's reviewed release ID, and creates no public path. A collision or partial stage is quarantined in place for manual review; it is never cleaned recursively.

Compare the private stage's exact paths, modes, sizes, and hashes to `release/web-artifacts.json`. Serve it on loopback only and inspect it through the authenticated tunnel. Test 390×844 and 320×568, English and es-MX, JavaScript enabled and disabled, Reduce Motion and pause behavior, keyboard/focus, canonical/legal navigation, and zero unexpected console or network activity. Do not create a public staging hostname.

## Promote and rollback

Before promotion, complete a private-clone rehearsal with the same transport and helper. On the remote filesystem, the reviewed helper entrypoint is:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> python3 secure_web_release.py promote-next <owned-deployment-root> <reviewed-release-id> < immutable-transport-object.json
```

This command operates only on the filesystem local to the host and promotes exactly one unit. It validates the complete journal on every invocation, reconciles the fixed crash windows, rejects links/special files/unexpected inventory, checks device and ownership, and uses atomic no-replace/exchange operations. The authorized controller must probe the fixed WordPress root after the command returns and before invoking `promote-next` again. On any probe failure, stop and invoke rollback immediately; later units remain staged. The helper never deletes either release.

Manual or rehearsed rollback uses the same reviewed transport bytes:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> python3 secure_web_release.py rollback-next <owned-deployment-root> <reviewed-release-id> <expected-reverse-index> < immutable-transport-object.json
```

Each `rollback-next` invocation reverses exactly one unit and requires the expected reverse index, so a lost response is idempotent and cannot silently reverse the next unit. Re-open and revalidate the reviewed root identity and probe the fixed WordPress root after every reverse unit before invoking the next index. Rollback restores previously present leaves and restores absence for originally absent leaves while preserving the displaced release under the rollback directory. A rollback collision is a hard stop. A live downgrade/upgrade rehearsal requires separate action-time authorization; otherwise record only the verified private rehearsal and leave the live-rehearsal gate pending.

## Production verification

After each promoted unit, re-open and hash the live leaf, probe the WordPress root, and append only the sanitized journal state. After all nine units, run the descriptor-side inventory and validate the separately captured browser evidence before purging only exact promoted URLs:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> python3 secure_web_release.py inventory-live <owned-deployment-root> <reviewed-release-id> < immutable-transport-object.json
node scripts/verify-production.mjs --measure-browser --confirm-production=cabohealth.org --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256> --webdriver-url=http://127.0.0.1:<webdriver-port>/
node scripts/verify-production.mjs --verify-production-origin --confirm-production=cabohealth.org --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256> < noncommitted-sensitive-controls.json
node scripts/verify-production.mjs --verify-apple-cdn --confirm-production=cabohealth.org --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256>
```

The browser command drives only an action-time loopback WebDriver endpoint and emits the exact artifact-bound 390×844 and 320×568, English/es-MX, JavaScript-on/off measurement matrix. The runner generates its own 16-byte nonce, verifies actual viewport/locale/JavaScript/Reduce Motion/pause/keyboard/focus/navigation state plus browser and performance logs, and rejects requested-state labels that the driver did not honor. Hand-authored browser booleans or a hash embedded in the same evidence are not evidence. Preserve the canonical browser output privately, review its SHA-256 independently, and provide that external digest to offline `--check`; the repository must not contain the sensitive raw session. The sensitive-controls input supplies only the unrelated-control and remediated-terminal relative paths plus their expected statuses at action time; never commit it. Output and committed evidence retain only booleans. Normal `--check` mode is offline. Production network access requires the exact confirmation flag and exact argument set. The origin verifier owns its URL/header policy; it does not read URLs from mutable evidence. It checks exact status/final URL/content type/body hash, CSP and framing, no cookies, canonical/legal links, blocked directory listing and `.htaccess`, a cryptographically random third slug, both sensitive controls, and the WordPress control. The Apple CDN result is independent. Stale CDN bytes are `APPLE_CDN_PENDING_PROPAGATION`; wait up to 24 hours and do not bypass the gate.

Only after origin, browser, unrelated-control, server-side inventory, private rollback rehearsal, and Apple CDN verification are green may an operator create canonical sanitized `release/production-urls.json`. It must contain the exact schema accepted by `node scripts/verify-production.mjs --check`; raw headers, cookie values, identities, private paths, and logs are forbidden. Keep the previous leaves and backups until App Review and the explicit retention decision.
