# Task 9 fix report

Date: 2026-08-28

## Review findings addressed

I read `task-9-review.md` completely and verified both findings against the
implementation and pre-feature behavior before editing the runbooks.

### P1: rollback compatibility

The earlier wording incorrectly allowed pre-feature Functions/Staff artifacts
after external entries were merely deactivated. Deactivation retains those
records in `_private_catalog/current`, while the older stored-catalog parsers
validate every item, including inactive items. A retained external record can
therefore reject the complete catalog.

The rollback sections in these runbooks now require the external-aware
Functions and Staff artifacts to remain in place while any active or inactive
external record exists:

- `docs/operations/dynamic-miniapp-catalog.md`
- `docs/operations/client-access-backend.md`
- `docs/operations/native-firebase-runtime.md`

Returning to the prior native candidate remains conditional on deactivation
and verified legacy responses. Restoring pre-feature Functions or Staff is a
hard block unless a separately designed and verified monotonic migration:

1. permanently purges every external record;
2. reconciles matching projections and every other authoritative reference;
3. handles all outstanding catalog idempotency receipts without unsafe replay;
   and
4. proves the proposed older parsers accept the complete retained state and
   exact legacy responses.

The runbooks explicitly authorize no current cleanup command. They also state
that an unchanged Firestore schema number is not parser-compatibility evidence
and prohibit restoring an older catalog snapshot.

### P2: Public/VIP URL persistence

The URL-free guarantee is now expressly limited to VIP previews, grants,
projections, receipts/audits, routes, and durable VIP session state. The same
three runbooks document the intentional Public exception:

- a V3 external Public record includes its canonical URL;
- the published-catalog repository persists the complete validated snapshot at
  `@cabohealth_published_catalog_v3` in AsyncStorage;
- only a valid newer-revision snapshot overwrites the cache;
- network/parse failure and equal or older revisions preserve the cache;
- a later valid snapshot without the item overwrites the cache without its URL;
  and
- uninstalling or clearing app data removes the cache at the platform boundary.

This matches `features/catalog/publishedCatalogCache.ts` and
`features/catalog/publishedCatalogRepository.ts`; no standalone cache-clear
operation was invented.

## Verification

- `npm --prefix functions test`: PASS, 263 tests, 0 failures.
- Focused root documentation/release/source run covering legal content, App
  Store metadata, release guard/scope/v3, published catalog cache, and native
  patch inventory: PASS, 641 tests, 0 failures.
- `npm run test:scope:rc-v3`: PASS; build 7 remains
  `pre-build-configured` and submission remains blocked.
- `git diff --check`: PASS.

The operational docs are not hash-pinned release authorities, so no source,
content-rights, EAS runtime-tree, build, or release evidence pin changed. No
deployment, native build, browser/simulator, EAS, TestFlight, App Store Connect,
or App Review action was performed.
