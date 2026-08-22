# TestFlight — What to Test

Candidate: CaboHealth 3.0 (build 4)

Status: Draft; use only after App Store Connect shows this exact processed build.

1. First launch: the approved introduction is readable immediately and remains until “Enter CaboHealth” is tapped. Confirm it returns after every fresh app launch.
2. Home: exactly Healthy Recipes and CaboHealth Clinic Guide are public; Client Resources is visibly protected. Save/remove public resources and force-quit.
3. Native tools: search/filter/read recipes; use/reset the visit checklist; verify offline behavior.
4. Public hosting: open both canonical pages; test back, retry, sharing, localization, no-JS, Reduce Motion, and network-loss recovery.
5. Production client access: redeem one valid `CH-` eligibility code, verify one-installation binding, refresh/foreground behavior, resource launch, revoke, expiry, remove access, and durable account deletion. Verify invalid/rate-limited/offline cases fail closed and no code is persisted.
6. App Review access: on two physical iPhones redeem the dedicated `AR-` credential; both must open only the fixed bilingual non-client sample. Rotate it and verify the previous generation stops working. Production `CH-` and review `AR-` realms must cross-reject.
7. Protected WebView: require exact POST nonce launch, cabohealth.org host and path; reject launch/API navigation, query, fragment, alternate host, port, user-info, traversal, popup, JavaScript bridge, DOM storage, and arbitrary URL.
8. Staff Access: Settings visibly opens `https://cabohealth.org/staff/`. Staff QA must use a non-production owner/test account with email/password, TOTP, and App Check; verify exactly four code slots, one-time copy, revoke, draft create/edit/archive, sanitized 30-day audit, App Review status/rotation, and no publish action. Do not give App Review production-owner access; create isolated reviewer access or obtain written Apple direction before submission.
9. Universal Links from Notes, Messages, and Safari:
   - https://cabohealth.org/apps/healthy-recipes/
   - https://cabohealth.org/apps/clinic-guide/
   - https://cabohealth.org/apps/client-resources/
   Launch/API/staff paths must not deep-link into protected content.
10. EN/es-MX, light/dark/system, Dynamic Type, Reduce Motion, in-app reduced effects, VoiceOver order/actions, contrast, focus, and 44-point targets.
11. Verify App Attest entitlement/provider, limited-use App Check tokens, signed identifiers/entitlements, SDK privacy report, Firestore rules/IAM/TTL, and expected-only network hosts.
12. Scope audit: no price, checkout, IAP, subscription, paid tier, arbitrary runtime link, patient/health form, unexpected permission, plaintext code, client identity, or secret in logs.

Record device, iOS, TestFlight build ID, source SHA, date, result, and evidence for every row. Any functional or hosted-content change invalidates affected evidence and may require a new build.
