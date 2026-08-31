# Dynamic miniapp catalog

Status: the pre-existing public and protected dynamic control planes are active.
External-HTTPS source support and its additive Functions/Staff deployment are
implemented and preserved in immutable build-8 distribution history. Build 9,
physical-device QA, and current release evidence remain pending. This document
does not claim those later steps. The sanitized production boundary and exact active pins are recorded in
`dynamic-miniapp-production-activation-2026-08-25.md`.

## Owner outcome

The production owner manages the catalog at `https://cabohealth.org/staff/` in
the **Miniapps** workspace. The owner can create, edit, activate, deactivate,
and permanently delete an entry without requesting a CaboHealth code review.
Every successful mutation is effective in the server catalog immediately.

- Public entries appear after the iOS app refreshes the catalog. The app refreshes
  at startup, when it returns to the foreground, and when the user retries.
- Inactive entries remain visible only in Staff and disappear from the consumer
  runtime.
- A permanent deletion removes the entry and its client entitlement metadata.
- Client entries belong to one durable `client-resources` group. Every active
  individual client code grants the active members of that group, so the owner
  can create as many client codes as needed without assigning four fixed slots.
- App Review remains an isolated named-database sample and never inherits the
  production client catalog.

This uses one Firebase production project, `cabohealth-owner-prod`. The isolated
App Review database is not a second owner project.

## Exact catalog and identity contract

The authoritative document is `_private_catalog/current`, schema version 1.
Tasks 1–8 did not add fields to that protected Firestore schema. It contains at
most 12 unique entries and a monotonically increasing catalog revision. Each
entry has immutable identity and URL, an optimistic item revision, EN and
es-MX copy, an icon, `public|clients` access, and an active flag.

- Exact `https://cabohealth.org/apps/<lowercase-kebab-id>/` entries keep the
  lowercase kebab ID derived from the URL.
- External IDs match `external-[0-9a-f]{32}`. Functions derives the digest from
  the exact lowercase UUID-v4 create request ID: SHA-256 over the UTF-8 bytes
  `cabohealth/catalog-external-id/v1`, one NUL byte, and the request ID, taking
  the first 32 lowercase hexadecimal characters. Staff validates the returned
  ID but never invents it.
- IDs are not URL hashes. Two distinct idempotent requests may create separate
  Public and VIP entries for the same destination.
- URL updates compare against transaction-current canonical authority and are
  rejected byte-for-byte. A changed destination requires a new catalog item.

An active client entry owns exactly one matching, URL-free
`_private_client_resources/<id>` schema-version-1 projection. An inactive
client entry owns no projection. Creation fails if an inactive entry would
adopt a pre-existing projection; a mutation of legacy state removes only an
exact matching orphan, and any projection drift aborts the whole transaction.

`app-review`, `shared`, and `review-sandbox-*` remain reserved;
`client-resources` remains client-only. `health-advisor`, `ai-cosmetic-scan`,
`service-hub`, and `sleep-lab` remain permanently retired. Titles are at most
80 characters, summaries at most 240, and localized text may not contain ASCII
controls.

Every Staff, Functions, stored-catalog, native-catalog, and launch boundary
uses the same syntactic URL policy. External destinations require canonical
public HTTPS with no userinfo, raw authority ambiguity, non-default port,
single-label/local/private namespace, IP literal, control, whitespace,
backslash, malformed escape, encoded traversal, or encoded slash/backslash.
Explicit `:443` canonicalizes away; safe paths, queries, fragments, and literal
`@` outside authority are preserved. The policy does not DNS-resolve or
preflight. Exact host `cabohealth.org` is never external: only its canonical
`/apps/<id>/` form can pass, subject to all reserved/retired rules.

Staff mutations still require verified password auth without an enrolled
second factor, the fixed active production staff document,
`client_resource_publish`, a recent session, Staff Web App Check, a UUID-v4
idempotency key, and the exact item revision where applicable.

The backend atomically commits the catalog, matching projection, idempotency
receipt, and sanitized audit. New item receipts are exact schema version 2 and
omit `url`; replay re-reads `_private_catalog/current` in the same transaction,
validates immutable authority, and reconstructs the response. Legacy
schema-version-1 CaboHealth receipts remain bounded compatibility input only.
For VIP entries, previews, grants, projections, receipts, sanitized audits,
logs, errors, route parameters, and durable native session state do not contain
an external URL. Public external items are the intentional exception: their V3
records include the canonical URL, and the native catalog repository persists
the complete validated snapshot at `@cabohealth_published_catalog_v3` in
AsyncStorage. Only a valid newer-revision snapshot overwrites that cache; an
invalid, failed, equal-revision, or older refresh does not clear it. A later
valid snapshot with the Public item removed clears that URL from the cache when
written, while uninstalling or clearing app data removes the cache at the
platform boundary.

## Versioned publication and build 7 compatibility

All catalog callables require the exact iOS App Check surface, exact `{}`
input, and no Firebase Authentication:

| Callable | Response contract | External behavior |
| --- | --- | --- |
| `getPublishedCatalog` | legacy V1 active Public items | filters external items |
| `getPublishedCatalogV2` | legacy V2 Public items plus URL-free active VIP previews | filters external Public items and previews |
| `getPublishedCatalogV3` | exact schema 3 with discriminated Public items and URL-free active VIP previews | Public items carry `destinationKind:'cabohealth'|'external_https'` |

Installed build 7 continues using the legacy endpoints and therefore never
receives an external record that would invalidate its parser. Build 8 introduced
V3 and the isolated `@cabohealth_published_catalog_v3` cache; build 9 preserves
that compatibility while adding the reviewed WebView subframe fix. Neither
reads nor overwrites the V1 cache. The additive backend and legacy responses
were verified before build 8 distribution and remain required for build 9.

The native parser rejects unknown fields, malformed copy, invalid/noncanonical
URLs, mismatched ID classes, duplicate IDs, impossible times, preview
URL/destination fields, reserved routes, and more than 12 entries. A valid
empty snapshot remains a kill switch; invalid/network responses never replace
a valid cache.

Internal items use `/apps/[slug]`. External Public items use only
`/external-miniapp/[resourceId]`, containing the opaque ID and no URL. AASA
never claims that native-only route. It re-resolves live V3 authority on every
render, latches the first destination, and permanently tears down if the item
disappears, deactivates, changes class or URL, or the route ID changes.

The external WebView loads the exact URL without a CaboHealth presentation
fragment. It allows only safe same-origin HTTPS navigation and blocks
cross-origin redirects, unsafe schemes, local targets, traversal, and popups in
place. Rejected URLs never open Safari, Chrome, or an OS browser sheet. Only
that external instance uses `limitsNavigationsToAppBoundDomains:false`;
`WKAppBoundDomains` stays exactly `["cabohealth.org"]`, and internal/broker
WebViews remain app-bound. Mixed content, file/universal-file access,
shared/third-party cookies, automatic windows, media capture, geolocation,
native messaging, and injected privileged JavaScript remain disabled.

The sole frame-aware exception is `about:blank` for a non-top-frame request
with a safe same-origin HTTPS parent document. Missing frame metadata,
top-frame blanks, and cross-origin parents remain blocked. A rejected subframe
is cancelled silently, while a rejected top-frame navigation or popup remains
cancelled and presents the existing blocked state. During an external VIP
launch, an accessible nonblocking three-point progress indicator stays visible
only while the page loads; the broker route keeps its opaque blocking loader.
This change adds neither browser handoff nor any privacy relaxation.

## VIP grants and launch union

Locked previews contain only `access`, `id`, `icon`, `title`, and `summary`.
They never expose URL, path, launch metadata, code, pricing, entitlement,
timestamp, or owner identity. Production build 8 introduced, and build 9 preserves,
`redeemClientAccessCodeV2` and `refreshClientAccessV2`; their exact
schema-version-2 grants remain URL-free. Production V1 redeem/refresh and all
legacy launch/broker operations use `legacy_cabohealth` resolution and filter
external resources. App Review remains separate schema version 1 with its
fixed sample and fixed launch.

`createClientLaunchV2` accepts exactly `{installationId,resourceId}`. Extra
keys, including `targetUrl`, fail before service invocation. One transaction
revalidates subject, installation, live grant/code and expiries, active catalog
authority, the complete active projection set, and requested resource. It then
returns exactly one branch:

```text
{kind:'broker',expiresAtMs,launchUrl:'https://cabohealth.org/apps/client-resources/launch/',method:'POST',nonce}
{kind:'external_https',expiresAtMs,url}
```

The broker branch keeps the hashed one-time POST nonce. The external branch
creates no nonce or session document; its URL exists only in protected catalog
authority and the transient authorized response. External expiry is the
earliest of authorization plus 60 seconds, grant expiry, or code expiry.

Codes and stored grants remain schema version 1 with the durable
`client-resources` group marker. Foreground checking, removal/deactivation,
grant revocation/expiry, code replacement, account deletion, errors, and route
generation changes clear launch state and destroy an external VIP WebView.
Retry discards the descriptor, increments the generation, and repeats
refresh-before-launch; late results are ignored.

VIP gating protects only CaboHealth's in-app entry point. It does **not** make
a third-party website private. Anyone who independently knows the URL may open
it outside CaboHealth. The owner must have permission to display or distribute
the linked content.

## Apple operating policy

Apple App Review Guideline 4.7 applies to hosted HTML5/JavaScript miniapps. The
owner remains responsible for every active entry. Internal content retains the
CaboHealth ownership/editorial rule. External content may be third-party and
must have verified rights, suitable age/privacy treatment, no unsupported UGC
or digital purchase flow, and no new native API/permission requirement. It is
not represented as CaboHealth-authored merely because the app launches it.

Only canonical CaboHealth entries use Universal Links. External entries use
the ID-only native route and never enter AASA. AASA excludes broker, API, App
Review, and protected nested routes before accepting canonical `/apps/<id>/`
roots.

The ordered AASA authority is exact:

1. exclude `/apps/client-resources/launch/`;
2. exclude `/apps/client-resources/launch/*`;
3. exclude `/apps/client-resources/api/`;
4. exclude `/apps/client-resources/api/*`;
5. exclude `/apps/app-review/`;
6. exclude `/apps/app-review/*`;
7. include only the exact `/apps/client-resources/` root;
8. exclude `/apps/client-resources/*`; and
9. include one canonical root segment with `/apps/*/`.

Order is security-significant. Do not replace the final component with
`/apps/*` or `/apps/**`, and do not move it before a protected exclusion.

If an entry introduces user content, purchases, sensitive data, third-party
sharing beyond ordinary destination requests, a native bridge, or a higher age
classification, do not activate it under this contract. First update behavior,
privacy/age declarations, controls, App Review notes, and release evidence.

Official policy authority:
`https://developer.apple.com/app-store/review/guidelines/#mini-apps-mini-games-streaming-games-chatbots-plugins-and-game-emulators`.

## Active public-web authority

The deterministic public-web release for this AASA change is
`web-v1-40869f4a540a56c420b198aea0fdf58a21053646d280d89ad64d105fd1808948`.
It is active in production and retains exactly the two bundled web entry slugs
`healthy-recipes` and `clinic-guide`; the only payload delta from its
predecessor is the AASA file.

- manifest SHA-256: `2ab49eb8e2d47293cb72d2e7aa34134a2a32b7e5fe38f8cdc8ad6c3e5e807f7e`;
- transport SHA-256: `3dcdbf88900ff4d93691f36cf2fbeedbd1dc08298f55640574368ea7ea813312`;
- AASA SHA-256: `e721827da1fe77d4a34247c9c2c515db73614545c6fb20e03f52b25e8594beae`.

The authorized promotion completed exact Hostinger inventory, private
promotion/rollback rehearsal, origin verification, unrelated-content checks,
and Apple CDN verification. Origin and Apple's CDN returned the exact AASA
SHA-256 above. The predecessor remains retained for rollback. The official
multi-browser measurement for this AASA-only successor and physical-device
Universal Link verification remain pending and are not implied by the
origin/CDN result.

## Prior platform activation record

The following list records the catalog-platform activation performed before
the VIP showcase work. A **Completed** label in this section refers to that
earlier platform release; it does not mean that `getPublishedCatalogV2`, the
updated Staff artifact, or the successor iOS presentation has been deployed.

1. **Completed:** Run all Functions, portal, native, broker, AASA, and release
   tests.
2. **Completed for the prior platform release:** Deploy additive Functions and
   Firestore TTL configuration. This completion predates and does not include
   `getPublishedCatalogV2`. Keep the legacy draft callables during this release.
3. **Completed:** Generate a dry-run migration plan from production and review
   its SHA-256.
4. **Completed:** Apply only that exact plan: add `client_resource_publish`, seed the three
   existing entries, and import only compatible legacy drafts as inactive.
5. **Component active; physical valid-flow pending:** The protected broker
   completed promotion, verification, rollback, historical verification,
   re-promotion, final verification, and live malformed/unauthorized denial.
   Replay, expiry, revocation, multi-resource selection, and deletion/retry
   still require the complete valid App Attest flow on physical iPhones.
6. **Component active; owner E2E pending:** Promote the Staff artifact with a
   preserved rollback directory and verify its exact bytes, CSP/App Check
   policy, catalog/audit UI bundle, no-cookie responses, and protected 404.
   Complete the fresh owner sign-in and controlled CRUD exercise in step 8.
7. **Completed:** Promote and verify the new AASA at origin and Apple's CDN.
8. **Pending:** Verify public create/edit/deactivate/delete and one-code client expansion in
   production using non-sensitive test entries, then remove the test entries.
9. **Build 8 complete and immutable; build 9 pending:** Build 8 was built,
   attested, uploaded, and made available internally before becoming obsolete
   for the WebView subframe fix. Freeze CaboHealth 3.0 build 9, create the new
   iOS build, inspect the exact IPA, upload it to
   TestFlight, and complete physical-device QA before selecting it for review.

## External-HTTPS rollback

Rollback is monotonic and compatibility-first:

1. deactivate external entries with new owner mutations; never restore an old
   `_private_catalog/current` snapshot or decrement its revision;
2. verify V1/V2 catalogs and V1 production access so build 7 remains usable;
3. stop build 9 distribution and return to the prior native candidate when
   applicable, but retain the external-aware Functions and Staff artifacts
   while even one active or inactive external catalog record remains; and
4. treat restoration of any pre-feature Functions or Staff artifact as blocked
   unless a separately designed and verified monotonic migration has permanently
   purged every external record, reconciled every matching projection and other
   authoritative reference, handled all outstanding catalog idempotency
   receipts without replay ambiguity, and proved that the proposed older
   parsers accept the complete retained state and exact legacy responses.

Deactivation disables exposure but does not make retained external records
compatible with pre-feature parsers: those parsers validate every stored item,
including inactive ones, and one external record rejects the whole catalog.
There is no cleanup command authorized by this runbook. If the verified purge
migration and its compatibility evidence do not exist, Functions/Staff rollback
is a hard block. Do not infer compatibility from the unchanged Firestore schema
number, restore an older catalog snapshot, or roll back Firestore rules,
schemas, AASA, broker, or App Review to an incompatible state.

No deployment, EAS build, TestFlight upload, physical-device observation, or
Apple submission is evidenced by this source-contract section.

## VIP showcase rollout (historical build-7 plan)

Use this order so the currently installed clients remain compatible while the
locked gold VIP cards are activated:

1. Deploy the additive `getPublishedCatalogV2` Function and the server-side
   safe-preview validation. Do not remove or change `getPublishedCatalog`.
2. Verify that the legacy callable still returns its exact public-only contract,
   then verify that V2 returns only safe active-client teaser fields.
3. Promote the updated Staff portal with its preserved rollback artifact and
   verify that unsafe VIP teaser copy is rejected before submission.
4. Create a new signed iOS build, inspect the exact IPA, and upload that build to
   TestFlight. The current installed build cannot gain this UI from a server
   change alone.
5. On a physical iPhone, test locked cards, an invalid code, successful unlock,
   exact-card launch, Manage access separation, foreground refresh, and removal
   of a deactivated teaser. Record the evidence before selecting the build for
   App Review.

Never place catalog contents, HMAC values, owner identity, access codes, launch
nonces, sessions, private paths, or private content in Git or deployment logs.
