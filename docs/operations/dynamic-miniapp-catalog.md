# Dynamic miniapp catalog

Status: implementation candidate. This document becomes the operating authority
only after the staged production activation and verification record are complete.

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

## Exact catalog contract

The authoritative document is `_private_catalog/current`, schema version 1.
It contains at most 12 unique entries and a monotonically increasing catalog
revision. An entry has an immutable ID derived from its canonical URL, an
optimistic item revision, EN and es-MX copy, an icon, `public|clients` access,
and an active flag.

An active client entry owns exactly one matching
`_private_client_resources/<id>` projection. An inactive client entry owns no
projection. Creation fails if an inactive entry would adopt a pre-existing
projection; a mutation of legacy state removes only an exact matching orphan,
and any projection drift aborts the whole transaction.

Accepted URLs have exactly this form:

```text
https://cabohealth.org/apps/<lowercase-kebab-id>/
```

The ID is 1–64 characters. `app-review` and `shared` are reserved.
`client-resources` is client-only. Titles are at most 80 characters, summaries
at most 240, and localized text may not contain ASCII control characters.
URLs with credentials, ports, queries, fragments, escapes, backslashes,
whitespace, mixed hosts, or a noncanonical path are rejected.

Staff mutations require all of the following:

- verified password authentication with no enrolled second factor;
- the fixed active production staff document;
- the `client_resource_publish` permission;
- a recent authenticated session;
- Staff Web App Check;
- a UUID-v4 idempotency key; and
- the exact current item revision for updates, activation changes, and deletion.

The backend commits catalog state, the matching client-resource projection,
the idempotency receipt, and a sanitized audit event atomically. Mutation
receipts and audit events expire after 30 days. The portal never receives the
owner UID stored in the internal audit record.

## Public runtime and failure behavior

`getPublishedCatalog` is an iOS-App-Check-only callable. It returns only active
public entries and never returns client entries. The native parser rejects
unknown fields, malformed copy, invalid URLs, duplicate IDs, impossible times,
reserved infrastructure routes, and more than 12 entries.

The app stores the last valid snapshot in AsyncStorage. A valid empty snapshot
is an intentional kill switch. Network failure or an invalid response never
overwrites a valid cache. On iOS and Android, a first install without a valid
server snapshot fails closed and shows no miniapps; the two bundled entries are
available only to the web/development preview. Unknown or inactive deep links
fail closed instead of opening arbitrary web content.

Do not restore an older Firestore catalog document as a rollback. Perform a
new owner mutation so the revision remains monotonic and installed devices
observe it.

## Client runtime

Codes and grants retain the durable `client-resources` group marker. Every
redeem, refresh, launch, web-session redemption, and session introspection
resolves that marker against the current active client catalog. A missing
catalog keeps the legacy `client-resources` item during the staged migration;
a malformed catalog or a catalog/resource mismatch fails closed.

The protected Hostinger broker receives a one-use launch for one exact resource.
Its session contains exactly that resource entitlement. Private content lives
outside `public_html` and is selected only from the validated server entitlement,
never from a request path. Removing or deactivating a client entry invalidates
new launches and live introspection immediately. Revoking a code remains the
way to remove one client's entire access.

## Apple operating policy

Apple App Review Guideline 4.7 applies to hosted HTML5/JavaScript miniapps. The
owner remains the publisher and is responsible for every active entry. The
Staff notice records the operating rule: publish only CaboHealth-owned content
that has no user-generated content, digital goods, new native API exposure,
new privacy permission, or content above the app's declared age rating.

The native list is the required software index and includes localized metadata.
The canonical URL of every entry is its Universal Link. AASA excludes broker,
API, App Review, and protected nested routes before accepting canonical
`/apps/<id>/` roots. The app still opens a link only when the ID is active in a
valid catalog snapshot.

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

If a future module introduces user content, purchases, sensitive data,
third-party sharing, a native bridge, or a higher age classification, do not
activate it under this contract. First update the app behavior, privacy and age
declarations, report/filter/block controls where applicable, App Review notes,
and the release evidence.

Official policy authority:
`https://developer.apple.com/app-store/review/guidelines/#mini-apps-mini-games-streaming-games-chatbots-plugins-and-game-emulators`.

## Local web candidate

The deterministic public-web candidate for this AASA change is
`web-v1-40869f4a540a56c420b198aea0fdf58a21053646d280d89ad64d105fd1808948`.
It retains exactly the two bundled web entry slugs `healthy-recipes` and
`clinic-guide`; the only payload delta from the live release is the AASA file.

- manifest SHA-256: `2ab49eb8e2d47293cb72d2e7aa34134a2a32b7e5fe38f8cdc8ad6c3e5e807f7e`;
- transport SHA-256: `3dcdbf88900ff4d93691f36cf2fbeedbd1dc08298f55640574368ea7ea813312`;
- AASA SHA-256: `e721827da1fe77d4a34247c9c2c515db73614545c6fb20e03f52b25e8594beae`.

This is local assembly evidence, not deployment evidence. The live production
record remains `web-v1-623fafeb169001829dd63cf701b5eba59f40a487eb71b11521a9d1a9f578c693`
until an authorized promotion completes exact Hostinger inventory, origin,
browser, rollback, Apple CDN, and physical-device Universal Link verification.

## Staged activation

Use this order so old clients and the old Staff portal keep working throughout
the change:

1. Run all Functions, portal, native, broker, AASA, and release tests.
2. Deploy additive Functions and Firestore TTL configuration. Keep the legacy
   draft callables during this release.
3. Generate a dry-run migration plan from production. Review its SHA-256.
4. Apply only that exact plan: add `client_resource_publish`, seed the three
   existing entries, and import only compatible legacy drafts as inactive.
5. Promote the protected broker release and verify invalid, replayed, expired,
   revoked, and multi-resource launches before making client entries active.
6. Promote the Staff artifact with a preserved rollback directory and verify
   its exact bytes, CSP, App Check, login, CRUD, audit, and 404 behavior.
7. Promote and verify the new AASA at origin and Apple's CDN.
8. Verify public create/edit/deactivate/delete and one-code client expansion in
   production using non-sensitive test entries, then remove the test entries.
9. Freeze the source, create a new iOS build, inspect the exact IPA, upload it to
   TestFlight, and complete physical-device QA before selecting it for review.

Never place catalog contents, HMAC values, owner identity, access codes, launch
nonces, sessions, private paths, or private content in Git or deployment logs.
