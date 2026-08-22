# CaboHealth Marketing URL release gate

The only approved App Store Marketing URL candidate is:

`https://cabohealth.org/app/`

The source is `web-hosting/cabohealth.org/app/index.html`. It is a static, bilingual overview of the submitted app scope. It has no script, remote asset, form, analytics, cookie, sales flow, outcome claim, or route into staff administration.

## Local source check

Run:

```sh
node scripts/verify-marketing-url.mjs --source
```

Success means only that the reviewed source, inherited `/app/` header policy, exact canonical URL, copy boundary, links, and repository audit are valid. The report deliberately says `productionVerified: false`. It is not deployment evidence.

The release gate runs in this order and fails closed:

1. Re-run the source check from a clean release candidate.
2. Confirm that the release manifest and both App Store localizations contain exactly `https://cabohealth.org/app/` under Marketing URL.
3. After an authorized deployment, perform an action-time fetch of that fixed HTTPS URL and require exact source bytes, final URL, status, content type, security headers, and no `Set-Cookie` header.

The final command is intentionally explicit:

```sh
node scripts/verify-marketing-url.mjs --release --confirm-production-fetch
```

Until the versioned metadata is updated during the final release freeze, `--release` stops with `MARKETING_URL_METADATA_NOT_UPDATED` before making a network request. Without the confirmation flag it must stop before a production fetch. Do not substitute another origin, path, port, query, fragment, or redirect target.

## Legacy `cabohealth-app.html` audit

Repository audit performed on 2026-08-22:

```sh
git ls-files | rg -i '(^|/)cabohealth-app\.html$'
```

Repository result: `cabohealth-app.html` is not tracked. No similarly named deploy source was found under `web-hosting/`. This result says nothing about files, WordPress entries, redirects, or caches that may exist at the live Hostinger origin.

Do not create, overwrite, rename, or delete a remote file to make the repository match an assumption. Before changing the legacy URL, an authorized operator must inspect its actual origin status, body, controlling layer, and backlinks. Preserve a private pre-change receipt.

If the live legacy page exists and the new landing is its true replacement, add this rule only in the already-authoritative root server configuration, after backing that configuration up:

```apache
RedirectMatch 301 ^/cabohealth-app\.html$ https://cabohealth.org/app/
```

Verify a single redirect hop, the exact final URL, and that unrelated WordPress routes remain unchanged. Do not place the rule in `/app/.htaccess`; that file cannot govern a root-level legacy path.

If the origin owner determines that the legacy page has no equivalent replacement, use a deliberate `410 Gone` response instead of redirecting it to unrelated content. During an authorized transition, the legacy response may also carry `X-Robots-Tag: noindex, nofollow, noarchive`; this header is not a substitute for the final redirect-or-removal decision. Never serve the obsolete claims alongside the new canonical page.

No deployment was performed, no remote file was invented, and no live legacy disposition was selected by this change.

## Authorized release checklist

- Review the landing at 320, 390, 768, and 1280 CSS pixels; test English and es-MX anchors, keyboard focus, zoom, high contrast, and legal/public-resource links.
- Package the exact landing bytes through the authorized Hostinger release mechanism. Do not upload the source tree or change the existing legal/AASA bytes as a side effect.
- Verify the protected Client Resources and staff surfaces remain excluded from this public page.
- Update the three versioned Marketing URL fields only at the coordinated final metadata freeze.
- Deploy only with owner authorization and a tested rollback.
- Run the release command above immediately before recording the App Store Connect URL.
- Re-run the full release gates after any byte, header, metadata, redirect, or origin change.
