# CaboHealth External HTTPS Miniapps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner add any syntactically safe public HTTPS destination as a Public or VIP miniapp and open it full-screen inside CaboHealth without breaking build 7, the private broker, or App Review.

**Architecture:** Keep the stored administrative catalog schema unchanged, classify destinations at every boundary, and add `getPublishedCatalogV3` plus V2 production-client contracts. Build 8 uses a separate internal route for external Public items and a discriminated VIP launch union; legacy endpoints filter external entries so build 7 remains compatible.

**Tech Stack:** TypeScript 5.9, Firebase Functions/Firestore, React 19, Vite, Expo 54, Expo Router 6, React Native 0.81, react-native-webview 13, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-27-cabohealth-external-https-miniapps-design.md`

## Global Constraints

- Accept only syntactically safe public `https:` URLs; never DNS-resolve or preflight a submitted hostname.
- Reject userinfo, raw `@` ambiguity in the authority, non-default ports, local/single-label hosts, `.local`, every IP literal, controls, whitespace, backslashes, malformed escapes, traversal, and encoded slash/backslash ambiguity. Accept explicit `:443` and canonicalize it away.
- External IDs match exactly `external-[0-9a-f]{32}` and derive from the idempotent create request ID, not from the URL.
- A URL is immutable after creation; changing it requires a new catalog item.
- Public and VIP external content opens only inside CaboHealth; cross-origin navigation and popups fail closed and never call Safari/Chrome.
- VIP previews, grants, routes, client storage, mutation receipts, audit records, and logs contain no destination URL. The protected administrative catalog is the sole durable URL authority; the authorized short-lived launch response may contain it transiently.
- Existing `getPublishedCatalog`, `getPublishedCatalogV2`, production V1 access callables, broker POST-nonce flow, App Review sandbox, AASA, and `WKAppBoundDomains: ["cabohealth.org"]` remain compatible.
- The external Public route is `/external-miniapp/[resourceId]`; `/apps/[slug]` remains CaboHealth-only and Universal-Link-safe.
- Production implementation follows strict red-green-refactor TDD. Every test is observed failing for the intended missing behavior before production code is written.
- Do not submit to App Review; submission requires a separate owner confirmation.

---

### Task 1: Establish one URL-policy behavior contract

**Files:**
- Create: `tests/fixtures/external-https-url-cases.json`
- Create: `functions/src/domain/catalogUrlPolicy.ts`
- Create: `functions/src/tests/unit/catalogUrlPolicy.test.ts`

**Interfaces:**
- Produces: `CatalogUrlClassification`, `parseSafeCatalogUrl(value)`, `externalCatalogIdFromRequestId(requestId)`, `catalogIdentityMatches(id, url)`, and `isLegacyCompatibleCatalogUrl(url)`.
- Consumers: Tasks 2–8 copy the same pure parsing rules and run the same fixture corpus at their trust boundary.

- [ ] **Step 1: Write the cross-surface fixture and failing Functions tests**

```json
{
  "accepted": [
    { "input": "https://www.eightsleep.com/mx/", "canonical": "https://www.eightsleep.com/mx/", "kind": "external_https" },
    { "input": "https://example.org/a?mode=one#part", "canonical": "https://example.org/a?mode=one#part", "kind": "external_https" },
    { "input": "https://example.org:443/a@b?owner=@ivan", "canonical": "https://example.org/a@b?owner=@ivan", "kind": "external_https" },
    { "input": "https://cabohealth.org/apps/healthy-recipes/", "canonical": "https://cabohealth.org/apps/healthy-recipes/", "kind": "cabohealth", "id": "healthy-recipes" }
  ],
  "rejected": [
    "http://example.org/", "//example.org/", "javascript:alert(1)",
    "https://user:pass@example.org/", "https://example.org:444/",
    "https://localhost/", "https://device.local/", "https://127.0.0.1/",
    "https://singlelabel/", "https://10.0.0.1/", "https://172.16.0.1/", "https://192.168.0.1/",
    "https://[::1]/", "https://2130706433/", "https://0x7f000001/", "https://127.1/",
    "data:text/plain,x", "file:///tmp/x", "blob:https://example.org/id",
    "intent://example.org/", "mailto:owner@example.org", "tel:+15551234567",
    "https://cabohealth.org/", "https://cabohealth.org/staff/",
    "https://cabohealth.org/apps/app-review/launch/", "https://cabohealth.org/apps/shared/",
    "https://example.org/a b", "https://example.org/a\\b", "https://example.org/%zz",
    "https://example.org/../secret", "https://example.org/%2e%2e/secret",
    "https://example.org/%2fsecret", "https://example.org/%5csecret",
    "https://example.org/%252e%252e/secret", "https://example.org/%252fsecret"
  ]
}
```

```ts
test('accepts and canonicalizes safe public HTTPS destinations', () => {
  for (const fixture of cases.accepted) {
    const parsed = parseSafeCatalogUrl(fixture.input);
    assert.equal(parsed?.url, fixture.canonical, fixture.input);
    assert.equal(parsed?.kind, fixture.kind, fixture.input);
  }
});

test('rejects unsafe schemes, userinfo, non-default ports, local or IP hosts, reserved CaboHealth paths, controls, malformed escapes, encoded traversal and encoded separators', () => {
  for (const input of cases.rejected) assert.equal(parseSafeCatalogUrl(input), null, input);
});

test('external IDs are request-id based, stable, and independent of URL', () => {
  assert.equal(
    externalCatalogIdFromRequestId('00000000-0000-4000-8000-000000000001'),
    'external-56fa9fb720ac24267528ab1819751b5b'
  );
  assert.equal(
    externalCatalogIdFromRequestId('00000000-0000-4000-8000-000000000002'),
    'external-1c550e51dc2968514dc81f218a8fb5a8'
  );
  for (const invalid of ['00000000-0000-4000-8000-00000000000A', 'not-a-uuid']) {
    assert.throws(() => externalCatalogIdFromRequestId(invalid), /invalid_admin_input/u);
  }
});
```

- [ ] **Step 2: Run the Functions suite and observe the missing-module failure**

Run: `npm --prefix functions test`

Expected: FAIL because `catalogUrlPolicy.ts` and its exports do not exist.

- [ ] **Step 3: Implement the pure URL classifier and opaque identity helpers**

```ts
export type CatalogUrlClassification = Readonly<
  | { kind: 'cabohealth'; id: string; url: string }
  | { kind: 'external_https'; url: string }
>;

export const EXTERNAL_CATALOG_ID_PATTERN = /^external-[0-9a-f]{32}$/u;

export function parseSafeCatalogUrl(value: unknown): CatalogUrlClassification | null;
export function externalCatalogIdFromRequestId(requestId: string): string;
export function catalogIdentityMatches(id: string, url: string): boolean;
export function isLegacyCompatibleCatalogUrl(url: string): boolean;
```

Use `new URL(value).toString()` only after validating the raw authority/path. Detect normalized numeric IPv4 forms from `parsed.hostname`, and inspect raw plus one decoded escape layer so `%252e%252e` and `%252f` cannot hide traversal/separators. Preserve safe path/query/fragment bytes in the canonical result. If the exact hostname is `cabohealth.org`, accept only a canonical `/apps/${slug}/` path whose slug matches the existing catalog ID pattern, then run existing reserved/retired-ID rules; never downgrade another CaboHealth path to `external_https`. A literal `@` is forbidden only in raw authority/userinfo and remains valid in a safe path/query.

`externalCatalogIdFromRequestId()` first validates the exact lowercase UUID-v4 pattern, initializes SHA-256, appends UTF-8 bytes for `cabohealth/catalog-external-id/v1`, appends one NUL byte (`0x00`), appends the request ID's UTF-8 bytes, encodes lowercase hex, takes characters `0..31`, and prefixes `external-`.

The Functions compiled test reads the shared corpus with `resolve(process.cwd(), '../tests/fixtures/external-https-url-cases.json')`; it does not import JSON outside the Functions TypeScript `rootDir`.

- [ ] **Step 4: Re-run the Functions suite and verify green**

Run: `npm --prefix functions test`

Expected: PASS, including the new URL-policy tests.

- [ ] **Step 5: Commit the policy contract**

```bash
git add tests/fixtures/external-https-url-cases.json functions/src/domain/catalogUrlPolicy.ts functions/src/tests/unit/catalogUrlPolicy.test.ts
git commit -m "feat(functions): define safe HTTPS catalog policy"
```

---

### Task 2: Accept and persist external catalog identities without breaking legacy catalogs

**Files:**
- Modify: `functions/src/domain/catalogAdmin.ts`
- Modify: `functions/src/domain/catalogDraftAdmin.ts`
- Modify: `functions/src/domain/catalogMigration.ts`
- Modify: `functions/src/repositories/firestoreCatalogStore.ts`
- Modify: `functions/src/repositories/firestoreCatalogDraftStore.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/src/tests/integration/catalogAdmin.test.ts`
- Modify: `functions/src/tests/integration/catalogDraftAdmin.test.ts`
- Modify: `functions/src/tests/integration/catalogMigration.test.ts`
- Modify: `functions/src/tests/unit/appCheckAuthorization.test.ts`
- Create: `functions/src/tests/unit/externalHttpsCallableWiring.test.ts`

**Interfaces:**
- Consumes: Task 1 URL/identity helpers.
- Produces: `PublishedCatalogV3`, `CatalogAdminService.publishedCatalogV3()`, and callable `getPublishedCatalogV3`.
- Legacy guarantee: V1/V2 snapshots contain only `destinationKind === 'cabohealth'` records.

- [ ] **Step 1: Write failing catalog identity, immutability, persistence, and compatibility tests**

```ts
test('creates deterministic opaque external IDs per idempotent request while allowing the same URL twice', async () => {
  const first = await service.create({ ...activePublicMiniapp, url: 'https://www.eightsleep.com/mx/' }, mutation(701));
  const second = await service.create({ ...activeClientMiniapp, url: 'https://www.eightsleep.com/mx/' }, mutation(702));
  assert.match(first.id, /^external-[0-9a-f]{32}$/u);
  assert.match(second.id, /^external-[0-9a-f]{32}$/u);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(await service.create({ ...activePublicMiniapp, url: first.url }, mutation(701)), first);
});

test('keeps an external destination immutable', async () => {
  const created = await service.create(externalPublic, mutation(703));
  await assert.rejects(service.update(created.id, created.revision, {
    access: created.access, icon: created.icon, summary: created.summary,
    title: created.title, url: 'https://example.org/replacement/'
  }, mutation(704)), CatalogInputError);
});

test('fails closed if an opaque external ID already belongs to another create request', async () => {
  await fixture.seedCatalogRecord({ ...externalPublic, id: externalId });
  await assert.rejects(
    service.create({ ...externalPublic, url: 'https://example.org/other/' }, collidingMutation),
    CatalogConflictError,
  );
});

test('legacy V1 and V2 omit external items while V3 returns a discriminated public item and URL-free VIP preview', async () => {
  assert.deepEqual((await service.publishedCatalog()).items.map(({ id }) => id), ['healthy-recipes']);
  const v2 = await service.publishedShowcaseCatalog();
  assert.deepEqual(v2.items.map(({ id }) => id), ['healthy-recipes']);
  assert.equal(v2.clientPreviews.some(({ id }) => id === externalVipId), false);
  const v3 = await service.publishedCatalogV3();
  assert.equal(v3.schemaVersion, 3);
  assert.equal(v3.items.find(({ id }) => id === externalPublicId)?.destinationKind, 'external_https');
  const externalPreview = v3.clientPreviews.find(({ id }) => id === externalVipId)!;
  assert.equal('url' in externalPreview, false);
  assert.equal(externalPreview.id, externalVipId);
});

test('stores URL-free idempotency receipts and reconstructs an exact replay from the protected catalog', async () => {
  const context = mutation(705);
  const created = await service.create(externalPublic, context);
  const receipt = fixture.readDocument(`_private_catalog_requests/${context.requestId}`);
  assert.equal(JSON.stringify(receipt).includes('https://'), false);
  assert.deepEqual(await service.create(externalPublic, context), created);
});
```

- [ ] **Step 2: Run the Functions suite and confirm the old external rejection/filtering behavior fails these tests**

Run: `npm --prefix functions test`

Expected: FAIL because external URLs are rejected and V3 is absent.

- [ ] **Step 3: Integrate Task 1 into catalog creation/update/storage**

```ts
const destination = parseSafeCatalogUrl(normalized.url);
if (!destination) throw new CatalogInputError();
const id = destination.kind === 'cabohealth'
  ? destination.id
  : externalCatalogIdFromRequestId(context.requestId);
```

In `FirestoreCatalogStore.update`, compare `command.details.url` to the current stored item inside the same transaction and return an `immutable_url` result mapped to `CatalogInputError`. Keep `_private_catalog/current` and `_private_client_resources` at schema version 1 with their existing exact fields; validate identity with `catalogIdentityMatches()` when parsing stored items.

Advance new `_private_catalog_requests` item receipts to an exact URL-free schema version 2 containing the original item fields except `url`. On replay, read `_private_catalog/current` in the same transaction, find the receipt's item ID, verify its immutable identity, and combine only the current authoritative URL with the receipt's original URL-free fields. Missing/deleted/mismatched authority returns conflict. Continue parsing unexpired legacy schema-version-1 receipts for rollback compatibility, but never write a new receipt containing a URL.

Use `parseSafeCatalogUrl()` in `catalogDraftAdmin.ts` and `firestoreCatalogDraftStore.ts` as well, so a new draft may carry the same safe Public or VIP external URL and unsafe/local/reserved CaboHealth URLs fail at that Functions boundary. Load the shared fixture at runtime in the draft integration test; do not TypeScript-import the root JSON.

- [ ] **Step 4: Add exact V3 output and legacy filters**

```ts
export interface PublishedCatalogV3 {
  readonly schemaVersion: 3;
  readonly revision: number;
  readonly updatedAtMs: number;
  readonly items: readonly (CatalogItemView & Readonly<{
    destinationKind: 'cabohealth' | 'external_https';
  }>)[];
  readonly clientPreviews: readonly PublishedClientPreview[];
}
```

`publishedCatalog()` and `publishedShowcaseCatalog()` filter with `isLegacyCompatibleCatalogUrl(item.url)`. `publishedCatalogV3()` includes all active Public records with `destinationKind`, and all active VIP previews without URL. Wire `getPublishedCatalogV3` with App Check, exact empty input, and no authentication requirement, matching existing catalog callables.

Add `getPublishedCatalogV3` to the exact `clientCallables` list in `appCheckAuthorization.test.ts` and advance the exact `assertClientAppCheck(request)` count from 13 to 14 in this task.

- [ ] **Step 5: Preserve historical migration semantics**

Write `test('historical migration still reports and skips an external draft')`: seed one legacy draft with `https://www.eightsleep.com/mx/`, assert the migration plan reports reason `external-url`, assert no create operation targets that draft, and assert the catalog stays unchanged. In `catalogMigration.ts`, classify and skip external URLs before calling the now-relaxed catalog validator; do not silently import historical drafts.

- [ ] **Step 6: Run backend tests and build**

Run: `npm --prefix functions test`

Expected: PASS.

Run: `npm --prefix functions run build`

Expected: exit 0 with no TypeScript diagnostics.

- [ ] **Step 7: Commit the catalog contract**

```bash
git add functions/src/domain/catalogAdmin.ts functions/src/domain/catalogDraftAdmin.ts functions/src/domain/catalogMigration.ts functions/src/repositories/firestoreCatalogStore.ts functions/src/repositories/firestoreCatalogDraftStore.ts functions/src/index.ts functions/src/tests/integration/catalogAdmin.test.ts functions/src/tests/integration/catalogDraftAdmin.test.ts functions/src/tests/integration/catalogMigration.test.ts functions/src/tests/unit/appCheckAuthorization.test.ts functions/src/tests/unit/externalHttpsCallableWiring.test.ts
git commit -m "feat(functions): publish versioned external catalog"
```

---

### Task 3: Version production grants while filtering every build-7 access path

**Files:**
- Modify: `functions/src/domain/clientAccessRedeemer.ts`
- Modify: `functions/src/domain/clientSessionManager.ts`
- Modify: `functions/src/repositories/firestoreClientAccessStore.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/src/tests/integration/redeemAccessCode.test.ts`
- Modify: `functions/src/tests/integration/clientSessionLifecycle.test.ts`
- Modify: `functions/src/tests/integration/dynamicClientEntitlements.test.ts`
- Modify: `functions/src/tests/integration/issueAccessCode.test.ts`
- Modify: `functions/src/tests/unit/appCheckAuthorization.test.ts`

**Interfaces:**
- Produces: `ClientGrantViewV2` with `schemaVersion: 2`, `redeemClientAccessCodeV2`, and `refreshClientAccessV2`.
- Preserves: V1 production grant shape and all App Review grant/callable behavior.
- Store resolution mode: `'legacy_cabohealth' | 'v2_all'`.

- [ ] **Step 1: Write failing V1-filter/V2-grant tests**

```ts
test('legacy grants filter external resources while V2 grants expose only URL-free metadata', async () => {
  const legacy = await fixture.legacyRedeemer.redeem(input);
  const v2 = await fixture.v2Redeemer.redeem(input);
  assert.deepEqual(legacy.grant.resources.map(({ id }) => id), ['client-resources']);
  assert.equal(legacy.grant.schemaVersion, 1);
  assert.deepEqual(v2.grant.resources.map(({ id }) => id), ['client-resources', externalId]);
  assert.equal(v2.grant.schemaVersion, 2);
  assert.equal(JSON.stringify(v2.grant).includes('https://'), false);
});
```

```ts
test('V1 and V2 refresh project the same live authorization through their own compatibility modes', async () => {
  for (const scenario of ['activated', 'deactivated', 'expired', 'revoked', 'wrong-installation'] as const) {
    const state = await fixture.withScenario(scenario);
    if (scenario === 'activated') {
      const legacy = await state.legacySessions.refresh(refreshInput);
      const v2 = await state.v2Sessions.refresh(refreshInput);
      assert.equal(legacy.resources.some(({ id }) => id === externalId), false);
      assert.equal(v2.resources.some(({ id }) => id === externalId), true);
    } else {
      await assert.rejects(() => state.legacySessions.refresh(refreshInput), ClientAccessPublicError);
      await assert.rejects(() => state.v2Sessions.refresh(refreshInput), ClientAccessPublicError);
    }
  }
});

test('new access codes may resolve active external VIP resources without storing a URL', async () => {
  assert.equal(await fixture.store.createActiveCode(codeForClientGroup), 'created');
  const stored = fixture.readStoredCode(codeForClientGroup.codeId);
  assert.equal(JSON.stringify(stored).includes('https://'), false);
});
```

- [ ] **Step 2: Run the suite and observe that both contracts currently expose only schema version 1**

Run: `npm --prefix functions test`

Expected: FAIL on the new version/filter assertions.

- [ ] **Step 3: Add resolution mode and response projection without changing stored grants**

```ts
export type ClientResourceResolutionMode = 'legacy_cabohealth' | 'v2_all';

export interface ClientGrantViewV2 {
  readonly expiresAtMs: number;
  readonly resources: readonly Readonly<ClientResourceView>[];
  readonly schemaVersion: 2;
  readonly status: 'active';
}
```

Thread the resolution mode through redemption and refresh commands. The Firestore store must validate the active catalog and URL-free resource projection in both modes, then omit external resources only for legacy mode. Keep stored grant/projection documents at schema version 1.

Pin every resolver call site: `createActiveCode` uses `v2_all`; V1 redeem/refresh and every legacy broker create/consume/redeem/introspect path use `legacy_cabohealth`; V2 redeem/refresh use `v2_all`; Task 4's V2 launch will use `v2_all`. A caller cannot choose the mode. Write `test('every client-resource resolution call site selects an explicit compatibility mode')`: read `firestoreClientAccessStore.ts`, assert there is no call with only the transaction and resource-ID arguments, and assert the expected call-site/mode matrix above.

- [ ] **Step 4: Wire V2 redeem and refresh callables**

Reuse the existing hashing, rate-limit, App Check, custom-token, installation, authentication, and error mapping. Only the resource-resolution mode and response `schemaVersion` differ. Do not duplicate security code.

Add `redeemClientAccessCodeV2` and `refreshClientAccessV2` to `clientCallables` and advance the exact client App Check assertion count from 14 to 16.

- [ ] **Step 5: Verify all grant tests and backend build**

Run: `npm --prefix functions test`

Expected: PASS.

Run: `npm --prefix functions run build`

Expected: exit 0.

- [ ] **Step 6: Commit versioned grants**

```bash
git add functions/src/domain/clientAccessRedeemer.ts functions/src/domain/clientSessionManager.ts functions/src/repositories/firestoreClientAccessStore.ts functions/src/index.ts functions/src/tests/integration/redeemAccessCode.test.ts functions/src/tests/integration/clientSessionLifecycle.test.ts functions/src/tests/integration/dynamicClientEntitlements.test.ts functions/src/tests/integration/issueAccessCode.test.ts functions/src/tests/unit/appCheckAuthorization.test.ts
git commit -m "feat(functions): add build 8 client grants"
```

---

### Task 4: Resolve VIP external launches atomically on the server

**Files:**
- Modify: `functions/src/domain/clientLaunchService.ts`
- Modify: `functions/src/repositories/firestoreClientAccessStore.ts`
- Modify: `functions/src/index.ts`
- Create: `functions/src/tests/integration/clientExternalLaunch.test.ts`
- Modify: `functions/src/tests/integration/clientLaunchNonce.test.ts`
- Modify: `functions/src/tests/integration/dynamicClientEntitlements.test.ts`
- Modify: `functions/src/tests/unit/appCheckAuthorization.test.ts`
- Modify: `functions/src/tests/unit/externalHttpsCallableWiring.test.ts`

**Interfaces:**
- Produces: `ClientLaunchV2` and callable `createClientLaunchV2`.
- Input remains exactly `{ installationId, resourceId }`; the caller can never provide `targetUrl`.
- Output is exact broker or external union.

- [ ] **Step 1: Write failing authorization, union, deactivation, and privacy tests**

```ts
test('V2 external launch resolves the exact server-side URL after live authorization', async () => {
  const launch = await fixture.launches.createV2({ installationId, resourceId: externalId, subjectUid });
  assert.deepEqual(launch, {
    kind: 'external_https', expiresAtMs: nowMs + 60_000,
    url: 'https://www.eightsleep.com/mx/'
  });
});

test('V2 internal launch preserves the broker nonce contract', async () => {
  const launch = await fixture.launches.createV2({ installationId, resourceId: 'client-resources', subjectUid });
  assert.equal(launch.kind, 'broker');
  assert.equal(launch.launchUrl, 'https://cabohealth.org/apps/client-resources/launch/');
  assert.equal(launch.method, 'POST');
});

test('deactivation between refresh and launch fails closed', async () => {
  await fixture.sessions.refresh({ installationId, subjectUid });
  await fixture.deactivate(externalId);
  await assert.rejects(fixture.launches.createV2({ installationId, resourceId: externalId, subjectUid }), invalidAccess);
});

test('external launch expiry cannot outlive the grant or access code', async () => {
  await fixture.setGrantExpiry(nowMs + 20_000);
  await fixture.setCodeExpiry(nowMs + 30_000);
  const launch = await fixture.launches.createV2({ installationId, resourceId: externalId, subjectUid });
  assert.equal(launch.expiresAtMs, nowMs + 20_000);
});

test('wrong installation, expired grant, and revoked code never return an external URL', async () => {
  for (const scenario of ['wrong-installation', 'expired-grant', 'revoked-code'] as const) {
    const state = await fixture.withScenario(scenario);
    await assert.rejects(
      () => state.launches.createV2({ installationId, resourceId: externalId, subjectUid }),
      ClientAccessPublicError,
    );
  }
});

test('external launch leaves the URL only in catalog authority and the transient response', async () => {
  const launch = await fixture.launches.createV2({ installationId, resourceId: externalId, subjectUid });
  assert.equal(launch.kind, 'external_https');
  for (const document of fixture.dumpDocuments()) {
    if (document.path === '_private_catalog/current') continue;
    assert.equal(JSON.stringify(document.value).includes('https://www.eightsleep.com/mx/'), false, document.path);
  }
});
```

- [ ] **Step 2: Run the suite and verify RED**

Run: `npm --prefix functions test`

Expected: FAIL because `createV2()` and the callable do not exist.

- [ ] **Step 3: Add the exact launch union and one transactional store operation**

```ts
export type ClientLaunchV2 = Readonly<
  | { kind: 'broker'; expiresAtMs: number; launchUrl: 'https://cabohealth.org/apps/client-resources/launch/'; method: 'POST'; nonce: string }
  | { kind: 'external_https'; expiresAtMs: number; url: string }
>;
```

Within one Firestore transaction, revalidate subject, installation, grant, code, expiry/revocation, active catalog item, exact projection, and resource ID. Set external `expiresAtMs` to `Math.min(nowMs + 60_000, grant.expiresAtMs, code.expiresAtMs)` and reject if that result is not in the future. For CaboHealth resources, store the existing hashed one-time nonce. For external resources, return only the normalized catalog URL and write a sanitized audit action with no URL. Legacy launch and broker consume paths use `legacy_cabohealth` and reject external IDs.

- [ ] **Step 4: Wire `createClientLaunchV2` and preserve strict input parsing**

Reuse `parseLaunchInput()` so extra keys, including `targetUrl`, fail before service invocation. Apply the same App Check, Firebase Auth, installation secret, and generic public error mapping as `createClientLaunch`.

In `externalHttpsCallableWiring.test.ts`, call the exported input parser/handler with `{ installationId, resourceId, targetUrl: 'https://attacker.example/' }`, assert `invalid-argument`, and assert the launch service spy has zero calls. Add `createClientLaunchV2` to the exact App Check callable list and advance the exact client App Check assertion count from 16 to 17.

- [ ] **Step 5: Run full backend verification**

Run: `npm --prefix functions test`

Expected: PASS with legacy broker, new external launch, privacy, and callable wiring tests.

Run: `npm --prefix functions run build`

Expected: exit 0.

- [ ] **Step 6: Commit atomic launch support**

```bash
git add functions/src/domain/clientLaunchService.ts functions/src/repositories/firestoreClientAccessStore.ts functions/src/index.ts functions/src/tests/integration/clientExternalLaunch.test.ts functions/src/tests/integration/clientLaunchNonce.test.ts functions/src/tests/integration/dynamicClientEntitlements.test.ts functions/src/tests/unit/appCheckAuthorization.test.ts functions/src/tests/unit/externalHttpsCallableWiring.test.ts
git commit -m "feat(functions): authorize external VIP launches"
```

---

### Task 5: Let Staff accept any safe HTTPS link with specific owner guidance

**Files:**
- Create: `staff-portal/src/domain/catalogUrlPolicy.ts`
- Modify: `staff-portal/src/domain/catalogItems.ts`
- Modify: `staff-portal/src/components/MiniappCatalogPanel.tsx`
- Modify: `staff-portal/src/i18n/messages.ts`
- Modify: `staff-portal/tsconfig.test.json`
- Modify: `staff-portal/tests/staff-portal-catalog-items.test.mjs`
- Modify: `staff-portal/tests/staff-portal-ui.test.mjs`
- Modify: `staff-portal/tests/staff-portal-i18n.test.mjs`
- Modify: `staff-portal/README.md`

**Interfaces:**
- Consumes: Task 1 fixture behavior and server-generated external ID contract.
- Preserves: exact admin callable request/response fields; no `destinationKind` is added to owner-only admin responses.
- Produces: `isCatalogItemUrlInvalid(error)` for dedicated form feedback.

- [ ] **Step 1: Write failing Staff validation/response tests**

```js
test('accepts the same safe external HTTPS destination as Public and VIP', () => {
  for (const access of ['public', 'clients']) {
    const parsed = validateCatalogItemInput({ ...base, access, url: 'https://www.eightsleep.com/mx/' });
    assert.equal(parsed.url, 'https://www.eightsleep.com/mx/');
  }
});

test('parses opaque external admin records but rejects mismatched URL and ID classes', async () => {
  assert.match((await externalGateway.list())[0].id, /^external-[0-9a-f]{32}$/u);
  await assert.rejects(() => mismatchedGateway.list(), /catalog_item_response_invalid/u);
});

test('an edit cannot replace the stored destination or transmit a mutation', async () => {
  await assert.rejects(model.update(item.id, item.revision, { ...details, url: 'https://example.org/replacement/' }), /catalog_item_url_immutable/u);
  assert.equal(transportCalls.length, 0);
});
```

Load the same JSON fixture corpus with `resolve(process.cwd(), '../tests/fixtures/external-https-url-cases.json')`, which is correct when `npm --prefix staff-portal test` runs with the Staff package as its working directory. The Staff TypeScript source does not import JSON outside its `rootDir`.

- [ ] **Step 2: Run Staff tests and verify RED**

Run: `npm --prefix staff-portal test`

Expected: FAIL because the Staff validator still requires a CaboHealth path.

- [ ] **Step 3: Add the pure Staff URL classifier and external response identity rules**

```ts
export function parseSafeCatalogUrl(value: unknown): Readonly<
  | { kind: 'cabohealth'; id: string; url: string }
  | { kind: 'external_https'; url: string }
> | null;
```

`parseCatalogItem()` requires internal slug/URL equality or exact `external-[0-9a-f]{32}` plus a safe external URL. VIP commercial/retired-ID checks use the internal slug only; bilingual teaser secrecy checks remain universal. Build update details from `editing.url`, and reject any domain-layer replacement before transport.

- [ ] **Step 4: Write failing UI/i18n tests, then implement dedicated copy**

```js
assert.equal(STAFF_MESSAGES.en['miniapps.url'], 'HTTPS link');
assert.equal(STAFF_MESSAGES['es-MX']['miniapps.url'], 'Enlace HTTPS');
assert.match(STAFF_MESSAGES['es-MX']['miniapps.externalWarning'], /no vuelve privado/u);
assert.match(STAFF_MESSAGES.en['miniapps.createActiveHelp'], /build 7/u);
```

Add `url-invalid` to `OperationError`; map local URL policy errors to `miniapps.urlInvalid`. Show a visible bilingual warning: VIP hides the link inside CaboHealth until authorization but does not make a third-party site private; the owner must have display/distribution rights. Replace “CaboHealth-authored content only” with truthful rights, age-rating, no-UGC, and no-digital-purchase guidance.

- [ ] **Step 5: Run Staff verification**

Run: `npm --prefix staff-portal test`

Expected: PASS.

Run: `npm --prefix staff-portal run typecheck`

Expected: exit 0.

Run: `npm --prefix staff-portal run build:release`

Expected: release build succeeds in the approved production environment.

- [ ] **Step 6: Commit Staff support**

```bash
git add staff-portal/src/domain/catalogUrlPolicy.ts staff-portal/src/domain/catalogItems.ts staff-portal/src/components/MiniappCatalogPanel.tsx staff-portal/src/i18n/messages.ts staff-portal/tsconfig.test.json staff-portal/tests/staff-portal-catalog-items.test.mjs staff-portal/tests/staff-portal-ui.test.mjs staff-portal/tests/staff-portal-i18n.test.mjs staff-portal/README.md
git commit -m "feat(staff): accept safe external miniapp links"
```

---

### Task 6: Parse catalog V3 and model external Public items truthfully

**Files:**
- Create: `features/launch/externalHttpsUrlPolicy.ts`
- Create: `tests/external-https-url-policy.test.mjs`
- Modify: `features/catalog/publishedCatalog.ts`
- Modify: `features/catalog/publishedCatalogCache.ts`
- Modify: `features/catalog/publishedCatalogRepository.ts`
- Modify: `features/catalog/nativePublishedCatalogRuntime.ts`
- Modify: `features/catalog/publishedCatalogRuntime.native.ts`
- Modify: `features/catalog/publicCatalogMiniapp.ts`
- Modify: `constants/publicMiniapps.ts`
- Modify: `features/catalog/catalogPresentation.ts`
- Modify: `features/catalog/publicCatalogState.ts`
- Modify: `context/PublicCatalogContext.tsx`
- Modify: `i18n/messages.ts`
- Modify: `tsconfig.node-tests.json`
- Modify: `tests/published-catalog-runtime.test.mjs`
- Modify: `tests/catalog-contract.test.mjs`
- Modify: `tests/public-catalog-state.test.mjs`
- Modify: `tests/localization-contract.test.mjs`

**Interfaces:**
- Produces: native `parseSafeExternalHttpsDestination()`, exact `PublishedCatalogSnapshot` V3, and discriminated `CatalogPublicMiniapp`.
- Cache key: `@cabohealth_published_catalog_v3`; never read the V1 key as V3.

- [ ] **Step 1: Write failing native URL-policy and V3 parser tests**

```js
test('V3 accepts a safe external Public item and keeps VIP previews URL-free', () => {
  const parsed = parsePublishedCatalog({
    schemaVersion: 3, revision: 9, updatedAtMs: 1_800_000_000_000,
    items: [{ ...externalPublicRecord, destinationKind: 'external_https' }],
    clientPreviews: [{ ...externalVipPreview }]
  });
  assert.equal(parsed.items[0].destinationKind, 'external_https');
  assert.equal('url' in parsed.clientPreviews[0], false);
});
```

```js
test('V3 fails closed on unknown keys, unsafe URL, malformed opaque ID, or a preview URL', () => {
  assert.equal(parsePublishedCatalog({ ...validV3, extra: true }), null);
  assert.equal(parsePublishedCatalog(withExternal(validV3, { url: 'http://example.org/' })), null);
  assert.equal(parsePublishedCatalog(withExternal(validV3, { id: 'external-not-hex' })), null);
  assert.equal(parsePublishedCatalog(withPreview(validV3, { url: 'https://secret.example/' })), null);
});

test('V3 cache never reads or overwrites the V1 cache key', async () => {
  await storage.setItem('@cabohealth_published_catalog_v1', JSON.stringify(validV1));
  assert.equal(await v3Cache.read(), null);
  await v3Cache.write(validV3);
  assert.equal(await storage.getItem('@cabohealth_published_catalog_v1'), JSON.stringify(validV1));
  assert.notEqual(await storage.getItem('@cabohealth_published_catalog_v3'), null);
});

test('native runtime fetches exactly getPublishedCatalogV3', async () => {
  await createNativePublishedCatalogFetcher(callableSpy)();
  assert.deepEqual(callableSpy.calls, [{ name: 'getPublishedCatalogV3', data: {} }]);
});
```

The native test loads the shared corpus with `resolve(process.cwd(), 'tests/fixtures/external-https-url-cases.json')`. It runs accepted cases whose `kind` is `external_https` plus every rejected case against `parseSafeExternalHttpsDestination()`; the accepted `cabohealth` case is asserted through the V3 catalog classifier instead.

- [ ] **Step 2: Compile node tests and observe RED**

Run: `node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json`

Expected: FAIL until the new module/types are added.

- [ ] **Step 3: Implement the native safe URL parser and exact V3 schema**

```ts
export interface SafeExternalHttpsDestination {
  readonly canonicalUrl: string;
  readonly origin: string;
}

export function parseSafeExternalHttpsDestination(value: unknown): Readonly<SafeExternalHttpsDestination> | null;
export function isSafeSameOriginExternalNavigation(value: string, expectedOrigin: string): boolean;
```

V3 requires exact top-level `schemaVersion: 3`; every Public item requires exact `destinationKind`; external items require opaque ID plus safe external URL; CaboHealth items preserve exact slug/URL mapping. `clientPreviews` continues to reject URL and destination fields.

- [ ] **Step 4: Introduce a truthful Public miniapp union**

```ts
export interface CatalogPublicMiniappBase {
  readonly access: 'public';
  readonly contentVersion: string;
  readonly editorialSource: Readonly<{ en: string; 'es-MX': string }>;
  readonly hasPurchases: false;
  readonly hasUserGeneratedContent: false;
  readonly iconKey?: PublicCatalogIcon;
  readonly legalUrls: Readonly<PublicMiniappLegalUrls>;
  readonly permissions: readonly [];
  readonly reviewedOn: string;
  readonly slug: string;
  readonly summary: Readonly<{ en: string; es: string }>;
  readonly title: Readonly<{ en: string; es: string }>;
}

export type CatalogPublicMiniapp = Readonly<
  | (CatalogPublicMiniappBase & {
      appStoreAgeRating: number | null;
      allowedPathPrefix: string;
      canonicalUrl: string;
      contentDescriptors: readonly ['health-and-wellness-information'];
      dataUse: readonly ['technical-request-logs'];
      destinationKind: 'cabohealth';
      universalLink: string;
    })
  | (CatalogPublicMiniappBase & {
      appStoreAgeRating: null;
      contentDescriptors: readonly ['external-web-resource'];
      dataUse: readonly ['third-party-network-request'];
      destinationKind: 'external_https';
      destinationOrigin: string;
      destinationUrl: string;
    })
>;

export interface EditorialMetadata {
  readonly access: 'public';
  readonly appStoreAgeRating?: number;
  readonly contentDescriptor: CatalogPublicMiniapp['contentDescriptors'][number];
  readonly dataUse: CatalogPublicMiniapp['dataUse'][number];
  readonly permissions: readonly [];
  readonly reviewedOn: string;
  readonly source: Readonly<{ en: string; 'es-MX': string }>;
}
```

Static miniapps receive `destinationKind: 'cabohealth'`. External metadata uses the destination hostname as its truthful source label, `appStoreAgeRating: null`, `contentDescriptors: ['external-web-resource']`, and `dataUse: ['third-party-network-request']`; never attribute third-party content to the CaboHealth editorial team or a verified 9+ rating. `catalogPresentation.ts` selects new bilingual `catalog.externalContent` and `catalog.thirdPartyNetwork` descriptions for the external branch instead of narrating CaboHealth health-content/log claims.

Replace the fixed “Two curated public resources” catalog subtitle in both locales with copy that remains true for a dynamic catalog.

- [ ] **Step 5: Switch runtime fetch/cache to V3 and verify**

Run: `node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-https-url-policy.test.mjs tests/published-catalog-runtime.test.mjs tests/catalog-contract.test.mjs tests/public-catalog-state.test.mjs tests/localization-contract.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the V3 native catalog**

```bash
git add features/launch/externalHttpsUrlPolicy.ts tests/external-https-url-policy.test.mjs features/catalog/publishedCatalog.ts features/catalog/publishedCatalogCache.ts features/catalog/publishedCatalogRepository.ts features/catalog/nativePublishedCatalogRuntime.ts features/catalog/publishedCatalogRuntime.native.ts features/catalog/publicCatalogMiniapp.ts constants/publicMiniapps.ts features/catalog/catalogPresentation.ts features/catalog/publicCatalogState.ts context/PublicCatalogContext.tsx i18n/messages.ts tsconfig.node-tests.json tests/published-catalog-runtime.test.mjs tests/catalog-contract.test.mjs tests/public-catalog-state.test.mjs tests/localization-contract.test.mjs
git commit -m "feat(ios): consume external catalog V3"
```

---

### Task 7: Open external Public miniapps through a non-Universal-Link internal route

**Files:**
- Create: `features/catalog/publicMiniappRoute.ts`
- Create: `app/external-miniapp/[resourceId].tsx`
- Create: `features/launch/externalHttpsNavigationPolicy.ts`
- Create: `features/launch/ExternalHttpsWebView.tsx`
- Create: `tests/external-miniapp-route.test.mjs`
- Create: `tests/external-miniapp-navigation.test.mjs`
- Modify: `app/(main)/index.tsx`
- Modify: `app/(main)/saved.tsx`
- Modify: `app/apps/[slug].tsx`
- Modify: `features/launch/navigationPolicy.ts`
- Modify: `tests/navigation-policy.test.mjs`
- Modify: `tests/dynamic-public-catalog-ui.test.mjs`
- Modify: `tests/home-miniapp-grid-contract.test.mjs`
- Modify: `tests/aasa-contract.test.mjs`
- Modify: `tsconfig.node-tests.json`

**Interfaces:**
- Produces: `buildPublicMiniappRoute(miniapp)`, `resolveExternalMiniappRouteState(input)`, and `ExternalHttpsWebView`.
- Route params contain only `resourceId`; no route, favorite, or log stores the URL.

- [ ] **Step 1: Write failing route isolation and teardown tests**

```js
test('routes internal and external Public items without serializing an external URL', () => {
  assert.deepEqual(buildPublicMiniappRoute(internal), { pathname: '/apps/[slug]', params: { slug: internal.slug } });
  const route = buildPublicMiniappRoute(external);
  assert.deepEqual(route, { pathname: '/external-miniapp/[resourceId]', params: { resourceId: external.slug } });
  assert.equal(JSON.stringify(route).includes('https://'), false);
});

test('/apps/[slug] never resolves an external item', () => {
  assert.equal(resolvePublicMiniappRouteSlug(external.slug, [external]), undefined);
});

test('external route waits only for initial catalog load and then fails closed if unavailable', () => {
  assert.deepEqual(resolveExternalMiniappRouteState({ resourceId: external.slug, catalog: [], isInitialLoading: true }), { kind: 'loading' });
  assert.deepEqual(resolveExternalMiniappRouteState({ resourceId: external.slug, catalog: [], isInitialLoading: false }), { kind: 'unavailable' });
  assert.deepEqual(resolveExternalMiniappRouteState({ resourceId: external.slug, catalog: [external], isInitialLoading: false }), { kind: 'ready', miniapp: external });
  assert.deepEqual(resolveExternalMiniappRouteState({ resourceId: external.slug, catalog: [internal], isInitialLoading: false }), { kind: 'unavailable' });
});

test('AASA never claims the native-only external-miniapp route', () => {
  const aasa = JSON.stringify(readGeneratedAasa());
  assert.equal(aasa.includes('/external-miniapp/'), false);
  assert.equal(aasa.includes('external-miniapp'), false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-route.test.mjs tests/navigation-policy.test.mjs tests/aasa-contract.test.mjs`

Expected: FAIL because route builder/route do not exist and internal resolver accepts by slug alone.

- [ ] **Step 3: Implement ID-only routing and foreground fail-closed resolution**

```ts
export function buildPublicMiniappRoute(miniapp: Readonly<CatalogPublicMiniapp>) {
  return miniapp.destinationKind === 'cabohealth'
    ? Object.freeze({ pathname: '/apps/[slug]' as const, params: Object.freeze({ slug: miniapp.slug }) })
    : Object.freeze({ pathname: '/external-miniapp/[resourceId]' as const, params: Object.freeze({ resourceId: miniapp.slug }) });
}
```

Home and Saved use this helper. The new route resolves the active V3 catalog entry by opaque ID and requires `destinationKind === 'external_https'`; it waits only during initial refresh and returns home/not-found if refresh removes, deactivates, or changes the item. `/apps/[slug]` accepts only `cabohealth` items.

`resolveExternalMiniappRouteState()` returns the exact union `{ kind: 'loading' } | { kind: 'unavailable' } | { kind: 'ready'; miniapp: ExternalHttpsCatalogPublicMiniapp }`. The screen derives this state on every catalog-context change, so removal/deactivation unmounts the WebView rather than retaining a captured item.

- [ ] **Step 4: Write failing same-origin WebView tests**

```js
test('external WebView loads exact URL and allows only safe same-origin navigation', () => {
  assert.deepEqual(getExternalHttpsWebViewSource(destination), { uri: 'https://www.eightsleep.com/mx/' });
  assert.equal(classifyExternalHttpsNavigation('https://www.eightsleep.com/mx/sleep', destination.origin).decision, 'allow');
  assert.equal(classifyExternalHttpsNavigation('https://accounts.eightsleep.com/', destination.origin).decision, 'block');
});

test('external WebView policy disables only app-bound navigation and denies privileged surfaces', () => {
  const props = getExternalHttpsWebViewPolicyProps(destination, handlers);
  assert.deepEqual(props.originWhitelist, ['https://www.eightsleep.com']);
  assert.equal(props.limitsNavigationsToAppBoundDomains, false);
  assert.equal(props.mixedContentMode, 'never');
  assert.equal(props.allowFileAccess, false);
  assert.equal(props.allowFileAccessFromFileURLs, false);
  assert.equal(props.allowUniversalAccessFromFileURLs, false);
  assert.equal(props.javaScriptCanOpenWindowsAutomatically, false);
  assert.equal(props.sharedCookiesEnabled, false);
  assert.equal(props.thirdPartyCookiesEnabled, false);
  assert.equal('onMessage' in props, false);
  assert.equal('injectedJavaScript' in props, false);
});

test('popup, cross-origin redirect, unsafe scheme, local target, and traversal all block in place', () => {
  for (const url of [
    'https://accounts.eightsleep.com/', 'http://www.eightsleep.com/',
    'javascript:alert(1)', 'https://127.0.0.1/',
    'https://www.eightsleep.com/a/%2e%2e/private',
  ]) assert.equal(classifyExternalHttpsNavigation(url, destination.origin).decision, 'block', url);
  assert.equal(handleExternalPopup('https://www.eightsleep.com/popup', effects), false);
  assert.equal(effects.openExternalCalls, 0);
});
```

- [ ] **Step 5: Implement the dedicated external WebView**

Use the same slim title/back visual shell as build 7. Load the exact canonical URL without adding `#embedded-*`, allow safe same-origin top-frame navigation, and block every popup/cross-origin attempt in place. Set iOS media capture to deny and geolocation off using the supported `react-native-webview` props. Write `test('external WebView source denies media/geolocation and has no browser/share escape')`: read `ExternalHttpsWebView.tsx`, require the exact deny/false props supported by the pinned WebView version, and assert the source has no `Linking`, `Share`, `openURL`, `onMessage`, or injected-JavaScript token. Keep the internal `RestrictedWebView` policy unchanged and app-bound.

- [ ] **Step 6: Run route/WebView and root tests**

Run: `node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/external-miniapp-route.test.mjs tests/external-miniapp-navigation.test.mjs tests/navigation-policy.test.mjs tests/dynamic-public-catalog-ui.test.mjs tests/home-miniapp-grid-contract.test.mjs tests/aasa-contract.test.mjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit Public in-app launch**

```bash
git add features/catalog/publicMiniappRoute.ts app/external-miniapp/'[resourceId].tsx' features/launch/externalHttpsNavigationPolicy.ts features/launch/ExternalHttpsWebView.tsx app/'(main)'/index.tsx app/'(main)'/saved.tsx app/apps/'[slug].tsx' features/launch/navigationPolicy.ts tests/external-miniapp-route.test.mjs tests/external-miniapp-navigation.test.mjs tests/navigation-policy.test.mjs tests/dynamic-public-catalog-ui.test.mjs tests/home-miniapp-grid-contract.test.mjs tests/aasa-contract.test.mjs tsconfig.node-tests.json
git commit -m "feat(ios): open external miniapps in app"
```

---

### Task 8: Consume V2 grants and launch VIP external destinations in the existing secure lifecycle

**Files:**
- Modify: `features/clientAccess/clientAccessController.ts`
- Modify: `features/clientAccess/firebaseClientAccessAdapter.ts`
- Modify: `features/clientAccess/clientResourceNavigation.ts`
- Modify: `features/clientAccess/ClientResourceWebView.tsx`
- Modify: `app/client-resource/[resourceId].tsx`
- Modify: `i18n/messages.ts`
- Modify: `tests/client-access-controller.test.mjs`
- Modify: `tests/firebase-client-access-adapter.test.mjs`
- Modify: `tests/client-resource-navigation.test.mjs`
- Modify: `tests/client-resource-route.test.mjs`
- Modify: `tests/client-home-presentation.test.mjs`
- Modify: `tests/react-native-firebase-bridge.test.mjs`
- Modify: `tests/localization-contract.test.mjs`

**Interfaces:**
- Consumes: production `redeemClientAccessCodeV2`, `refreshClientAccessV2`, `createClientLaunchV2`, and Task 6 URL policy.
- Preserves: App Review V1 endpoints and exact fixed broker response.
- Produces: discriminated native `ClientResourceLaunch` broker/external union.

- [ ] **Step 1: Write failing adapter/grant/launch-union tests**

```js
test('production uses only V2 callables and sends no URL to launch', async () => {
  await adapter.gateway.createLaunch(session, externalId);
  assert.deepEqual(calls.at(-1), {
    name: 'createClientLaunchV2', data: { installationId, resourceId: externalId }
  });
});

test('production parses schema V2 while App Review remains exact V1', () => {
  assert.equal(parseClientGrantView(productionGrantV2, now)?.schemaVersion, 2);
  assert.equal(parseClientGrantView(reviewGrantV1, now)?.schemaVersion, 1);
});

test('launch parser rejects extra keys, unsafe URL, excessive expiry, and external App Review launch', () => {
  assert.equal(parseLaunchEnvelope({ ...externalEnvelope, extra: true }, productionRealm, now), null);
  assert.equal(parseLaunchEnvelope({ ...externalEnvelope, url: 'http://example.org/' }, productionRealm, now), null);
  assert.equal(parseLaunchEnvelope({ ...externalEnvelope, expiresAtMs: now + 120_001 }, productionRealm, now), null);
  assert.equal(parseLaunchEnvelope(externalEnvelope, appReviewRealm, now), null);
});

test('grant and preview contracts cannot carry an external destination', () => {
  assert.equal(JSON.stringify(parseClientGrantView(productionGrantV2, now)).includes('https://'), false);
  assert.equal(JSON.stringify(parsePublishedCatalog(validCatalogV3).clientPreviews).includes('https://'), false);
});
```

```js
test('launch envelopes use exact branch keys and exact realms', () => {
  assert.deepEqual(Object.keys(parseLaunchEnvelope(brokerEnvelope, productionRealm, now)).sort(), ['expiresAtMs', 'kind', 'launchUrl', 'method', 'nonce']);
  assert.deepEqual(Object.keys(parseLaunchEnvelope(externalEnvelope, productionRealm, now)).sort(), ['expiresAtMs', 'kind', 'url']);
  assert.equal(parseLaunchEnvelope({ ...brokerEnvelope, extra: true }, productionRealm, now), null);
  assert.equal(parseLaunchEnvelope({ ...externalEnvelope, nonce: 'forbidden' }, productionRealm, now), null);
  assert.equal(parseLaunchEnvelope(brokerEnvelope, 'unknown-realm', now), null);
  assert.equal(parseLaunchEnvelope(externalEnvelope, appReviewRealm, now), null);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node node_modules/typescript/bin/tsc --project tsconfig.node-tests.json && node --test tests/client-access-controller.test.mjs tests/firebase-client-access-adapter.test.mjs tests/react-native-firebase-bridge.test.mjs`

Expected: FAIL because production still calls V1 endpoints and accepts only schema V1/broker launch.

- [ ] **Step 3: Implement the exact native launch union**

```ts
export type ClientResourceLaunch = Readonly<
  | { kind: 'broker'; realm: ClientAccessRealm; expiresAtMs: number; source: BrokerPostSource }
  | { kind: 'external_https'; realm: 'production_client'; expiresAtMs: number; source: { uri: string }; origin: string }
>;
```

Production parses grant schema 2 and calls V2 endpoints. App Review continues parsing schema 1 and calling its existing endpoints. Both adapter and controller validate exact envelope keys and the current maximum 120-second launch window.

- [ ] **Step 4: Write failing lifecycle/rendering regressions**

```js
test('late external launch is discarded after the route generation changes', async () => {
  const pending = route.startLaunch(externalId);
  route.onForeground();
  pending.resolve(externalLaunch);
  await route.flush();
  assert.equal(route.currentLaunch, null);
  assert.equal(route.webViewMounted, false);
});

test('foreground checking and every authorization loss destroy the external WebView', async () => {
  for (const event of ['checking', 'resource-removed', 'item-deactivated', 'grant-revoked', 'code-replaced', 'account-deleted', 'grant-expired']) {
    const route = await fixture.openExternalVip();
    route.apply(event);
    assert.equal(route.currentLaunch, null, event);
    assert.equal(route.webViewMounted, false, event);
  }
});

test('VIP destination never enters durable or navigational client state', async () => {
  await fixture.openExternalVip();
  for (const value of [fixture.routeParams, fixture.grant, fixture.asyncStorage, fixture.favorites, fixture.messages]) {
    assert.equal(JSON.stringify(value).includes('https://www.eightsleep.com/mx/'), false);
  }
});
```

- [ ] **Step 5: Reuse the existing client route lifecycle and branch only the renderer**

Broker launches keep `getClientResourceWebViewPolicyProps()` and POST source. External launches use the same `ExternalHttpsWebView` policy without share/favorite controls. `client-resource/[resourceId]` still performs refresh-before-launch and all current generation/deletion/expiry checks.

Use truthful bilingual blocked/unavailable copy that applies to either the internal broker or an external resource; do not describe every blocked navigation as leaving a CaboHealth-hosted page.

- [ ] **Step 6: Run full native verification**

Run: `npm test`

Expected: all root tests pass.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run lint`

Expected: exit 0 with no lint errors.

- [ ] **Step 7: Commit VIP launch support**

```bash
git add features/clientAccess/clientAccessController.ts features/clientAccess/firebaseClientAccessAdapter.ts features/clientAccess/clientResourceNavigation.ts features/clientAccess/ClientResourceWebView.tsx app/client-resource/'[resourceId].tsx' i18n/messages.ts tests/client-access-controller.test.mjs tests/firebase-client-access-adapter.test.mjs tests/client-resource-navigation.test.mjs tests/client-resource-route.test.mjs tests/client-home-presentation.test.mjs tests/react-native-firebase-bridge.test.mjs tests/localization-contract.test.mjs
git commit -m "feat(ios): open authorized external VIP resources"
```

---

### Task 9: Reconcile implementation documentation and run the complete source gate

**Files:**
- Modify: `docs/operations/dynamic-miniapp-catalog.md`
- Modify: `docs/operations/client-access-backend.md`
- Modify: `docs/operations/native-firebase-runtime.md`
- Modify: `docs/operations/ios-protected-resource-scope.md`
- Test: all Functions, Staff, native, and release-scope source suites.

**Interfaces:**
- Consumes: completed Tasks 1–8.
- Produces: implementation authority used by the separate release plan.

- [ ] **Step 1: Update operational contracts with exact deployed shapes**

Document the unchanged Firestore schema, external ID derivation namespace, V1/V2/V3 callable table, legacy filtering, URL-free VIP grant/preview, exact launch union, separate external route, same-origin WebView policy, build-7 compatibility, and rollback behavior. State explicitly that VIP gating does not make a third-party site private.

- [ ] **Step 2: Run every source verification suite fresh**

```bash
npm --prefix functions test
npm --prefix functions run build
npm --prefix staff-portal test
npm --prefix staff-portal run typecheck
npm test
npm run typecheck
npm run lint
npm run expo:config > /tmp/cabohealth-external-miniapps-expo-config.json
git diff --check
```

Expected: every command exits 0. The public Expo config retains bundle ID `com.cabohealth.app`, version `3.0`, AASA association `applinks:cabohealth.org`, and `WKAppBoundDomains: ["cabohealth.org"]`.

- [ ] **Step 3: Re-read the spec and mutation-check each boundary**

Confirm a test fails for each realistic mutation: external URL accepted by legacy endpoint, caller-supplied `targetUrl`, mismatched opaque ID, changed URL on update, cross-origin WebView allow, popup forwarding, external route treated as Universal Link, external URL in VIP grant/preview/audit, and App Review accepting a V2 external launch.

- [ ] **Step 4: Commit docs and any verification-only corrections**

```bash
git add docs/operations/dynamic-miniapp-catalog.md docs/operations/client-access-backend.md docs/operations/native-firebase-runtime.md docs/operations/ios-protected-resource-scope.md
git commit -m "docs: record external miniapp contracts"
```

Proceed to `docs/superpowers/plans/2026-08-28-cabohealth-external-https-miniapps-release.md` only after the complete source gate passes.
