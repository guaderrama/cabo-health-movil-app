# CaboHealth External HTTPS Miniapps Design

**Date:** 2026-08-27

**Status:** Approved by owner on 2026-08-28
**Scope:** Staff Portal, Firebase Functions, dynamic catalog, public miniapps, VIP client resources, iOS WebView, release operations, and Apple metadata

## Objective

Allow the CaboHealth owner to add a miniapp whose destination is any safe public HTTPS URL, such as `https://www.eightsleep.com/mx/`, for either **Public** or **VIP clients** access.

The destination must open full-screen inside CaboHealth. It must not open Safari, Chrome, or a browser-style sheet. Existing CaboHealth-hosted miniapps, protected private content, App Review sandbox behavior, access-code revocation, and build 7 compatibility must remain intact.

## Owner-approved product behavior

1. The Staff Portal accepts a safe HTTPS URL from any public hostname.
2. Public entries show with the existing public card design and open immediately.
3. VIP entries show as locked gold cards to everyone and reveal/open only after a valid CaboHealth access code.
4. The in-app miniapp screen keeps the slim CaboHealth title/back header introduced in build 7.
5. The selected site remains inside CaboHealth. Cross-origin navigation, popups, and unsafe URL schemes do not escape to an external browser.
6. An external VIP URL is gated inside CaboHealth, but CaboHealth does not make the third-party website itself private. Anyone who independently knows that URL may still open it outside the app.

## Non-goals

- Proxying, copying, scraping, or mirroring a third-party website under `cabohealth.org`.
- Bypassing a site's login, paywall, anti-embedding behavior, geographic restrictions, or browser policy.
- Protecting third-party content that does not integrate CaboHealth authentication.
- Allowing general cross-origin browsing from a selected miniapp.
- Granting camera, microphone, location, photo, file, or native-bridge access to an external website.
- Changing the existing private-content broker or the exact App Review sandbox flow.
- Submitting a new App Store review without a separate owner confirmation.

## URL security policy

The same pure URL policy must be implemented and tested at every trust boundary: Staff Portal, Functions, stored catalog parsing, native catalog parsing, and WebView launch.

An accepted external destination must:

- use exactly the `https:` scheme;
- have a non-empty public DNS hostname;
- contain no username, password, or `@` authority ambiguity; a literal `@` in a safe path or query remains valid;
- use the default HTTPS port only; explicit `:443` is canonicalized away and every non-default port is rejected;
- contain no control characters, spaces, backslashes, or malformed percent encoding;
- not syntactically target `localhost`, a `.local` name, an IP literal, loopback, link-local, or private-network address;
- preserve a normal path, query, and fragment after canonicalization with `URL.toString()`;
- reject encoded path traversal and encoded slash/backslash ambiguity.

The policy rejects `http:`, `javascript:`, `data:`, `file:`, `blob:`, `intent:`, `mailto:`, `tel:`, protocol-relative URLs, custom ports, userinfo, and explicit local/private network destinations. This is a URL-boundary control, not a guarantee about the future DNS configuration of a third-party hostname.

The exact hostname `cabohealth.org` is never treated as an external destination. Only its existing canonical `/apps/${slug}/` catalog form may pass as `cabohealth`; root, Staff, shared, launch/API, App Review, reserved, retired, nested, and other CaboHealth paths fail closed. This prevents an opaque external ID from bypassing existing route and reserved-ID controls.

## Catalog identity

Catalog identity is separated from external URL paths.

- Existing canonical CaboHealth URLs keep their current ID: `https://cabohealth.org/apps/<slug>/` maps to `<slug>`.
- A newly created external entry receives a server-generated opaque ID matching `external-[0-9a-f]{32}`.
- The digest is deterministically derived from the idempotent create request ID with a domain-separated SHA-256 operation. This lets the same external URL be used in two different entries, including one Public and one VIP entry, without collision.
- Functions remains the authority that assigns the ID. Staff validates the returned ID but does not invent it.
- The URL is immutable after creation. Changing a destination requires creating a new miniapp, preserving audit history and existing grants.
- Existing reserved, retired, review-sandbox, `app-review`, `shared`, and `client-resources` IDs retain their current restrictions.

Stored catalog parsing accepts both legacy internal IDs and the new opaque external-ID form. It still fails closed on malformed records.

## Versioned compatibility and rollout

Build 7 rejects external public URLs by design. Returning an external entry in its current catalog snapshot would invalidate the entire snapshot. The rollout therefore uses additive, versioned contracts.

### Legacy contracts

- Existing `getPublishedCatalog`, `getPublishedCatalogV2`, `redeemClientAccessCode`, `refreshClientAccess`, and `createClientLaunch` callables retain their current response schemas.
- They return only CaboHealth-hosted entries supported by build 7.
- Existing internal VIP resources continue to use the POST nonce broker.
- Existing clients never receive an unknown field or an external destination.

### New contracts

- `getPublishedCatalogV3` returns the versioned external-link schema for build 8 and later. Public entries carry an explicit `destinationKind` discriminant (`cabohealth` or `external_https`); locked VIP previews still carry no URL.
- `redeemClientAccessCodeV2` and `refreshClientAccessV2` return schema-version-2 grants for build 8. Their resource views contain display metadata and authorization state but no destination URL.
- `createClientLaunchV2` accepts only `installationId` and `resourceId`, revalidates access, resolves the catalog record server-side, and returns one exact launch union:
    - `{ kind: "broker", expiresAtMs, launchUrl, method: "POST", nonce }` for the existing protected internal resource;
    - `{ kind: "external_https", expiresAtMs, url }` for an authorized external VIP entry.
- Build 8 uses only the new contracts for external-link behavior and retains fallback behavior for existing internal entries.
- The server filters external entries from legacy contracts; old builds continue showing the existing catalog rather than failing or showing unusable cards.

External entries may be stored and marked active before build 8. They remain invisible to build 7 because legacy contracts filter them, while the new contract makes them visible only to build 8 and later. The Staff Portal explains this compatibility rule next to “Activate immediately.”

## Public miniapp flow

1. Staff validates the URL and sends the normalized item to Functions.
2. Functions validates again, assigns the immutable catalog ID, stores the item, and publishes it only through the new catalog contract.
3. Build 8 parses the item without treating it as a Universal Link.
4. Tapping the card opens the existing full-screen internal miniapp route.
5. The WebView loads the exact external URL without adding CaboHealth's `#embedded-*` presentation fragment.
6. Top-frame navigation is limited to HTTPS URLs on the selected origin. Cross-origin redirects and links are blocked.
7. Popups are blocked and never forwarded to Safari or Chrome.

Internal CaboHealth miniapps retain their existing Universal Links, embedded presentation fragments, strict path prefix, and App-Bound-Domains behavior.

## External WebView policy

External WebViews use a separate policy derived from the accepted destination:

- `originWhitelist` contains only the selected origin;
- same-origin HTTPS paths, queries, and fragments are allowed;
- `limitsNavigationsToAppBoundDomains` is disabled only for that external WebView instance;
- `mixedContentMode` remains `never`;
- file access and file-URL access remain disabled;
- automatic windows and popups remain disabled;
- shared and third-party cookies remain disabled;
- media capture and geolocation remain denied;
- no `onMessage` native bridge or injected privileged JavaScript is added;
- a blocked redirect or failed load shows a generic CaboHealth error with retry/back actions and does not leak the raw URL to logs.

`app.json` keeps `WKAppBoundDomains: ["cabohealth.org"]`. The existing internal and broker WebViews remain app-bound; only the explicit external policy opts out per instance.

Some third-party sites may refuse to run inside an in-app WebView or may require cookies or permissions that CaboHealth deliberately denies. In that case CaboHealth reports that the resource is unavailable; it does not weaken the security policy or open another browser automatically.

## VIP external-link flow

VIP previews continue to omit the URL.

1. Before unlock, the published preview contains only ID, icon, title, and summary.
2. Tapping a locked card opens the existing access-code sheet.
3. Redeem and refresh requests validate the Firebase principal, App Check, installation binding, code, grant, expiration, active catalog entry, and resource ID.
4. The new grant contract identifies the authorized resource but does not persist or publish its destination URL.
5. When the user taps an unlocked external VIP card, the app refreshes the grant and sends only `resourceId` to the new launch callable.
6. Functions resolves the current destination server-side from the active catalog. The client cannot submit or replace `targetUrl`.
7. If authorization is still valid, Functions returns a short-lived external launch descriptor containing the normalized URL. Internal protected resources instead return the existing broker descriptor.
8. The app parses this as a discriminated launch union and opens the external destination in the same full-screen CaboHealth route using the external WebView policy.

The external target is not placed in public previews, AsyncStorage, favorites, application logs, analytics, idempotency receipts, audit copy, or error messages. It exists in the catalog's protected administrative record and in the authorized launch response needed to load the page. A URL-free idempotency receipt may reconstruct the owner response only by reading that catalog authority in the same transaction.

An external launch expires at the earliest of 60 seconds after authorization, the current grant expiry, or the current access-code expiry.

Revocation, code replacement, expiration, item deactivation, account deletion, foreground revalidation, and route teardown keep their current fail-closed behavior. A failed or stale launch returns home or shows the existing unavailable state.

## Existing protected flows

The following remain unchanged:

- `https://cabohealth.org/apps/client-resources/launch/` POST nonce flow;
- protected content stored outside `public_html`;
- one-time nonce consumption and web session behavior;
- `https://cabohealth.org/apps/app-review/launch/` sandbox;
- App Review fixed credential and exact sample content;
- client installation binding and revocation;
- no URL in VIP teaser content.

The launch union chooses the broker only for the existing protected internal resource class and the external descriptor only for an explicitly validated external catalog entry.

## Staff Portal behavior

- Rename the field from “CaboHealth HTTPS link” to “HTTPS link”.
- Replace the exact CaboHealth-path instruction with bilingual help explaining that any safe public HTTPS link is accepted.
- Show a specific bilingual validation message for unsafe or unsupported links instead of the generic “nothing changed” message.
- Keep the URL field locked after creation.
- Preserve the Public/VIP selection, icon, bilingual title/summary, and “Activate immediately” control.
- Warn that VIP gating does not make a third-party website private and that the owner must have permission to distribute or frame the linked content.
- Explain that an active external entry appears immediately only in compatible app builds and remains intentionally hidden from build 7.

## Failure handling

- Invalid Staff input is rejected before transmission and again by Functions.
- A duplicate request ID replays the same create result; it does not create a second entry.
- An opaque-ID collision fails closed as a conflict.
- A cross-origin redirect, popup, unsafe scheme, or malformed navigation is blocked inside the app.
- A missing, inactive, revoked, or expired VIP resource never returns an external destination.
- Offline catalog refresh uses only a schema-compatible cached snapshot.
- Build 7 never receives external items and therefore retains its current catalog.
- Internal miniapps and protected broker content continue to work if the external-link subsystem is unavailable.

## Apple and content compliance

External dynamic content changes statements currently made in the App Store metadata and release verifier. Before any App Review submission, the release work must re-evaluate and update:

- web-access and age-rating answers;
- Review Notes and TestFlight testing instructions;
- content-rights inventory and ownership declarations;
- privacy disclosures for third-party network requests;
- claims that all content is CaboHealth-hosted or that arbitrary web navigation is absent;
- the release manifest and metadata verification scripts.

The Staff owner remains responsible for linking only content that CaboHealth is authorized to distribute and that is suitable for the app's declared audience. This design does not treat a third-party page as CaboHealth-owned content.

## Test strategy

Implementation follows test-driven development. Each production change starts with a focused failing test.

### URL and identity tests

- accept `https://www.eightsleep.com/mx/` for Public and VIP;
- accept safe paths, queries, and fragments and preserve canonical form;
- permit the same URL in two separate entries;
- preserve existing CaboHealth slug IDs;
- generate stable, idempotent opaque IDs for external entries;
- reject unsafe schemes, credentials, custom ports, local/private hosts, IP literals, controls, backslashes, and encoded traversal;
- reject changing the URL after creation.

### Contract and compatibility tests

- legacy catalog/client endpoints omit external entries and remain byte/schema compatible;
- the new catalog endpoint returns supported external public items and VIP previews;
- a build 7 parser continues to accept its filtered snapshot;
- external public entries do not become Universal Links;
- existing AASA and internal route contracts remain unchanged.

### Public WebView tests

- load the exact selected external URL without an embedded fragment;
- allow same-origin HTTPS navigation;
- block cross-origin redirects, popups, unsafe schemes, ports, local destinations, and traversal;
- never call `Linking.openURL` for external-miniapp content;
- retain the strict internal CaboHealth WebView policy.

### VIP tests

- preview and locked-card responses contain no URL;
- invalid, expired, revoked, replaced, or wrong-installation codes cannot obtain a target;
- the client sends only `resourceId` to launch;
- Functions resolves the destination only after all authorization checks;
- deactivation between refresh and launch fails closed;
- existing broker and App Review launches remain exact;
- foreground refresh, expiry timers, removal, and account deletion close or block the external route.

### Release verification

- Functions typecheck and full test suite;
- Staff typecheck, build, and full test suite;
- native TypeScript checks and full root test suite;
- release-scope and metadata verification updated for the new declared behavior;
- physical TestFlight QA on build 8 for one Public and one VIP external URL;
- regression QA for existing public miniapps, existing private content, access codes, revocation, Saved, Settings, English, and Spanish.

## Deployment order

1. Implement and test the versioned Functions, Staff, and native contracts without changing production.
2. Deploy backward-compatible Functions whose legacy endpoints filter external entries and whose new endpoints serve compatible builds.
3. Deploy the updated Staff Portal and create the Public and VIP test entries. Build 7 continues to hide them.
4. Build, audit, and upload CaboHealth 3.0 build 8 to TestFlight.
5. Run physical Public and VIP external-link QA, including redirects, revocation, expiration, and relaunch.
6. Update Apple metadata and release evidence before distribution beyond the internal TestFlight group.
7. Request separate owner confirmation before any App Review submission.

## Acceptance criteria

The feature is complete when the owner can save `https://www.eightsleep.com/mx/` as either Public or VIP, it appears only to compatible builds, and it opens full-screen inside CaboHealth without Safari/Chrome. Public access works immediately. VIP access requires a current valid code and never exposes the URL in the locked preview. Unsafe navigation fails closed, build 7 retains its catalog, and every existing CaboHealth-hosted and protected flow passes regression tests.
