# Task 9 adjacent-authority fix report

Date: 2026-08-28

## Scope

I read the updated `task-9-review.md` completely and verified the remaining
contradictions against the corrected Task 9 runbooks and the implemented Public
V3 cache behavior. This follow-up changes documentation only:

- `docs/superpowers/plans/2026-08-28-cabohealth-external-https-miniapps-release.md`
- `docs/operations/staff-portal-release.md`

No product source, test, source/content pin, release status, build evidence, or
deployment state changed.

## Adjacent rollback authorities

The release plan no longer instructs an operator to deploy a pre-feature
Functions release after merely deactivating external entries. A compatibility
failure now requires distribution to stop and external exposure to be
deactivated through new monotonic mutations while external-aware Functions and
Staff remain in place for as long as any active or inactive external record
exists.

Both adjacent authorities now make pre-feature Functions/Staff restoration a
hard block unless a separately designed and verified monotonic migration:

1. permanently purges every external record;
2. reconciles matching projections and every other authoritative reference;
3. handles all outstanding catalog idempotency receipts without unsafe replay;
   and
4. proves the complete retained state and exact legacy responses against the
   exact proposed older parsers.

Neither authority invents or authorizes a cleanup command. Retention, pins, and
an unchanged schema label are expressly insufficient. The Staff runbook permits
a prior artifact only after proving it can parse every retained catalog record;
a pre-feature Staff artifact is prohibited while even one external record
remains. Any eligible Staff rollback must still repeat byte-exact live
verification.

Nearby release-plan wording was made consistent: the retained Staff directory
is only conditional rollback input, and a build-7 containment failure triggers
deactivation plus fix-forward investigation with external-aware artifacts—not
an implicit older-artifact restore.

## Public/VIP physical-device assertion

The release QA gate now checks that no **VIP destination URL** appears in VIP
preview, grant, route parameters, VIP session AsyncStorage, favorites, logs,
receipts, or sanitized audits. It explicitly permits the separately reviewed
Public V3 exception: `@cabohealth_published_catalog_v3` may and should persist a
validated external Public item's canonical URL until a valid newer snapshot
replaces it. No cache-clearing control was invented.

## Verification

- Staff release documentation/security focus: PASS, 3 tests, 0 failures.
- Focused legal/release guard/scope/v3/metadata/Public-cache run: PASS, 638
  tests, 0 failures.
- `npm run test:scope:rc-v3`: PASS; build 7 remains
  `pre-build-configured` and submission remains blocked.
- `git diff --check`: PASS.

No deployment, native build, browser/simulator, EAS, TestFlight, App Store
Connect, or App Review action was performed.
