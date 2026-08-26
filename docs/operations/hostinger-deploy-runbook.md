# CaboHealth Hostinger release and rollback runbook

Status: **release `web-v1-40869f4a540a56c420b198aea0fdf58a21053646d280d89ad64d105fd1808948` is live.** It changes only the AASA authority to the ordered nine-component dynamic-catalog contract. Its exact Hostinger inventory, private promotion/full-rollback rehearsal, production promotion, origin responses, retained controls, unrelated WordPress checks, and Apple CDN bytes passed on 2026-08-25. Origin and Apple's CDN returned AASA SHA-256 `e721827da1fe77d4a34247c9c2c515db73614545c6fb20e03f52b25e8594beae`. The predecessor `web-v1-623fafeb169001829dd63cf701b5eba59f40a487eb71b11521a9d1a9f578c693`, release `web-v1-4a3e199b57be00b563dcf4d8e4d6f278b09872705981a0b39aad6a3a80b0f11b`, the database/file backup, and the complete private rehearsal receipts remain retained for rollback. The official multi-browser measurement for the AASA-only successor and physical-iPhone Universal Link evidence remain pending. This runbook remains the execution contract for any future release and is not blanket authorization for another promotion.

The live release's canonical manifest SHA-256 is `2ab49eb8e2d47293cb72d2e7aa34134a2a32b7e5fe38f8cdc8ad6c3e5e807f7e`, its immutable transport SHA-256 is `3dcdbf88900ff4d93691f36cf2fbeedbd1dc08298f55640574368ea7ea813312`, and its AASA SHA-256 is `e721827da1fe77d4a34247c9c2c515db73614545c6fb20e03f52b25e8594beae`. The predecessor manifests remain immutable for rollback reconciliation.

## Fixed scope

The immutable successor payload is exactly 17 files: canonical AASA; the marketing, Privacy, Terms, Support, and Report Content HTML; `apps/.htaccess`; the two approved module roots; and six shared assets. The ten promotion units, in required order, are:

1. `public_html/apps/.htaccess`
2. `public_html/apps/shared/`
3. `public_html/app/index.html`
4. `public_html/app/privacy/`
5. `public_html/app/terms/`
6. `public_html/app/support/`
7. `public_html/app/report-content/`
8. `public_html/apps/healthy-recipes/`
9. `public_html/apps/clinic-guide/`
10. `public_html/.well-known/apple-app-site-association`

Hostinger additionally requires exactly five server-environment overlays: `public_html/app/.htaccess`, `public_html/.well-known/.htaccess`, and one exact MIME policy in each of `public_html/apps/clinic-guide/`, `public_html/apps/healthy-recipes/`, and `public_html/apps/shared/`. They are checked-in exact policies but are not content-payload files, do not change the 17-file release inventory or release ID, and may be published only by the reviewed helper's hard-link/no-replace overlay operation. The server inventory attests all five independently before accepting the 17 content files. Before a future content promotion, roll back these overlays, promote the new reviewed release, then republish the overlays; this prevents an environment file from moving inside a content rollback slot.

The independent protected-overlay transaction may add exactly the complete pair
`public_html/apps/client-resources/` and `public_html/apps/app-review/`. The
public inventory helper accepts either neither directory or both safe `0755`
directories; it rejects a lone member, any third sibling, a link, a non-directory,
or an unsafe mode. It deliberately does not count or attest their bytes: the
separate signed protected-overlay gate remains their only release authority.

For a dynamic private-content successor, follow
`docs/operations/client-resources-web-broker.md` as the controlling sub-runbook.
Its content root must declare exactly `legacy-flat`, `structured`, or
`structured-with-client-resources-fallback`; the last mode requires a complete
authoritative `client-resources/` directory plus the two inventoried legacy
fallback files. Create new private `0400` activation/request capsules, execute
both pinned production PHP harnesses and the review harness through the newly
pinned one-shot attestor in the real serving handlers, assemble path-free
signed evidence, and promote both public realms as one protected transaction.
Do not reuse or rewrite the 2026-08-24 activation/evidence. Activate a private
catalog item only after live verification; after rollback verification, remove
the legacy flat pair in the next private release.

Never change the WordPress root, theme, Media Library/uploads, database content, root `.htaccess`, unrelated assets, or the protected PHI-remediation rule. Never use recursive removal, `mv -f`, `cp -r`, broad `rsync`, tar extraction, manifest-selected paths, or an unreviewed remote script.

## Gate and assemble locally

From a clean, reviewed commit, use the direct entrypoints:

```text
node scripts/assemble-web-release.mjs --check
node scripts/assemble-web-release.mjs --assemble
node scripts/verify-production.mjs --check --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256> --reviewed-browser-measurement-sha256=<independently-reviewed-browser-evidence-sha256>
```

`--check` validates the exact v3 candidate and prints its deterministic plan without writing outputs. It is not by itself a deployment-readiness verdict. While hosted legal client-access disclosures, AASA, Firebase/Hostinger staging, Apple direction, or any other deployment evidence remains pending, `--assemble` must report `WEB_DEPLOYMENT_GATES_INCOMPLETE` and must not create or replace `release/web-artifacts.json`, `release/production-urls.json`, or `release/web-bundles/`. For the current 17-file release, the narrow web-readiness record was pinned only after independent legal, AASA, Firebase, Hostinger-stage, and byte review; it authorized deterministic assembly only. The later public promotion is proven separately by the canonical sanitized production evidence and dated activation record, while protected-overlay activation remains a separate authority. After every assembly gate is independently verified, the assembler snapshots the verified Task 6B capsule through `readVerifiedMiniappArtifact`, captures fixed public inputs through no-follow directory descriptors, materializes the content-addressed bundle, re-verifies it, and exclusively publishes provenance.

Before assembling a successor, confirm the former current manifest already exists under its exact `release/web-artifacts.<former-release-id>.json` name. The official helper exclusively creates and verifies the new immutable `release/web-artifacts.<new-release-id>.json` alongside the current pointer; seal both to mode `0444`. Git records file contents but may restore a non-executable file as `0644` after a fresh checkout, so verify the modes again before `--assemble`. The helper rejects rather than overwrites any current manifest, immutable manifest, transport, or bundle collision. Never remove a predecessor archive to make a successor pass.

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
<reviewed-python-3.11> secure_web_release.py root-identity <owned-private-root>
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> <reviewed-python-3.11> secure_web_release.py materialize-stage <owned-private-root> <reviewed-release-id> < immutable-transport-object.json
```

The helper requires Python 3.11 on the current Hostinger runtime, accepts only its fixed schema and 17-path allowlist, requires the caller's reviewed release ID, and creates no public path. A collision or partial stage is quarantined in place for manual review; it is never cleaned recursively.

Compare the private stage's exact paths, modes, sizes, and hashes to `release/web-artifacts.json`. Serve it on loopback only and inspect it through the authenticated tunnel. Test 390×844 and 320×568, English and es-MX, JavaScript enabled and disabled, Reduce Motion and pause behavior, keyboard/focus, canonical/legal navigation, and zero unexpected console or network activity. Do not create a public staging hostname.

## Promote and rollback

Before promotion, complete a private-clone rehearsal with the same transport and helper. On the remote filesystem, the reviewed helper entrypoint is:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> <reviewed-python-3.11> secure_web_release.py promote-next <owned-deployment-root> <reviewed-release-id> < immutable-transport-object.json
```

This command operates only on the filesystem local to the host and promotes exactly one unit. It validates the complete journal on every invocation, reconciles the fixed crash windows, rejects links/special files/unexpected inventory, checks device and ownership, and uses atomic no-replace/exchange operations. The authorized controller must probe the fixed WordPress root after the command returns and before invoking `promote-next` again. On any probe failure, stop and invoke rollback immediately; later units remain staged. The helper never deletes either release.

Manual or rehearsed rollback uses the same reviewed transport bytes:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> <reviewed-python-3.11> secure_web_release.py rollback-next <owned-deployment-root> <reviewed-release-id> <expected-reverse-index> < immutable-transport-object.json
```

Each `rollback-next` invocation reverses exactly one unit and requires the expected reverse index, so a lost response is idempotent and cannot silently reverse the next unit. Re-open and revalidate the reviewed root identity and probe the fixed WordPress root after every reverse unit before invoking the next index. Rollback restores previously present leaves and restores absence for originally absent leaves while preserving the displaced release under the rollback directory. A rollback collision is a hard stop. A live downgrade/upgrade rehearsal requires separate action-time authorization; otherwise record only the verified private rehearsal and leave the live-rehearsal gate pending.

## Production verification

After each promoted unit, re-open and hash the live leaf, probe the WordPress root, and append only the sanitized journal state. After all ten units, publish the exact Hostinger overlays with the separately reviewed helper:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> <reviewed-python-3.11> secure_web_release.py publish-hosting-overlays <owned-deployment-root>
```

The command creates immutable private candidates and atomically hard-links each public name without replacement. It rejects any pre-existing different file, link, altered candidate, or identity mismatch. If the subsequent WordPress/origin checks fail, remove only those five verified public links while retaining their private candidates:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> <reviewed-python-3.11> secure_web_release.py rollback-hosting-overlays <owned-deployment-root>
```

Then run the descriptor-side inventory and validate the separately captured browser evidence before purging only exact promoted URLs:

```text
CABOHEALTH_EXPECTED_ROOT_ID=<reviewed-device:inode> <reviewed-python-3.11> secure_web_release.py inventory-live <owned-deployment-root> <reviewed-release-id> < immutable-transport-object.json
node scripts/verify-production.mjs --measure-browser --confirm-production=cabohealth.org --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256> --webdriver-url=http://127.0.0.1:<webdriver-port>/
node scripts/verify-production.mjs --verify-production-origin --confirm-production=cabohealth.org --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256> < noncommitted-sensitive-controls.json
node scripts/verify-production.mjs --verify-apple-cdn --confirm-production=cabohealth.org --reviewed-release-id=<reviewed-release-id> --reviewed-artifact-sha256=<reviewed-artifact-sha256>
```

The browser command drives only an action-time loopback WebDriver endpoint and emits the exact artifact-bound 390×844 and 320×568, English/es-MX, JavaScript-on/off measurement matrix. The runner generates its own 16-byte nonce, verifies actual viewport/locale/JavaScript/Reduce Motion/pause/keyboard/focus/navigation state plus browser and performance logs, and rejects requested-state labels that the driver did not honor. Hand-authored browser booleans or a hash embedded in the same evidence are not evidence. Preserve the canonical browser output privately, review its SHA-256 independently, and provide that external digest to offline `--check`; the repository must not contain the sensitive raw session. The sensitive-controls input supplies only the unrelated-control and remediated-terminal relative paths plus their expected statuses at action time; never commit it. Output and committed evidence retain only booleans. Normal `--check` mode is offline. Production network access requires the exact confirmation flag and exact argument set. The origin verifier owns its URL/header policy; it does not read URLs from mutable evidence. It checks exact status/final URL/content type/body hash, CSP and framing, no cookies, canonical/legal links, blocked directory listing and `.htaccess`, a cryptographically random third slug, both sensitive controls, and the WordPress control. The Apple CDN result is independent. Stale CDN bytes are `APPLE_CDN_PENDING_PROPAGATION`; wait up to 24 hours and do not bypass the gate.

Only after origin, browser, unrelated-control, server-side inventory, private rollback rehearsal, and Apple CDN verification are green may an operator create canonical sanitized `release/production-urls.json`. It must contain the exact schema accepted by `node scripts/verify-production.mjs --check`; raw headers, cookie values, identities, private paths, and logs are forbidden. Keep the previous leaves and backups until App Review and the explicit retention decision.
