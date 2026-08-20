# App Privacy recommendation — conditional draft

Status: **OWNER-AUTHORIZED DISCLOSURE; FINAL ANSWER PENDING.** This is not an App Privacy questionnaire answer and must not be represented as one. Linkage, Apple category mapping, and exact-RC reconciliation remain unresolved.

## Supported native facts

- The exact MVP has no account, advertising, tracking, analytics, app-generated identifier, health-information input, or sensitive device permission.
- Saved module choices, interface preferences, recipe favorite keys, and visit-checklist completion remain on the device.
- The WebView sends none of that local state through a native message bridge.
- Opening either public resource creates normal HTTPS requests to CaboHealth hosting.

## Observed hosting behavior, owner-authorized disclosure, and unresolved facts

Prior technical verification observed Hostinger access-log fields for IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency. Separately, on 2026-08-17, Ivan Guaderrama authorized disclosure that Hostinger logs IP address, browser/user-agent, requested URL, and technical errors; hPanel visibility is up to 7 days, and any additional retention and deletion are controlled by Hostinger. Current production configuration, access controls, and whether those records are linked to an identity remain unresolved release facts.

## Recommendation decision

Do **not** choose “Data Not Collected” merely because the native app has no form. First resolve linkage/access behavior, reconcile the exact RC, and map the retained hosting fields to Apple’s current definitions.

- If the verified provider behavior and Apple’s current exceptions establish that no request-log field must be declared, “Data Not Collected” may be supportable only after owner/legal approval and signed-RC reconciliation.
- If retained request logs meet Apple’s collection definition, disclose only the matching categories. The likely purposes are App Functionality and Fraud Prevention, Security, and Compliance; tracking is not supported by the current build. Do not state “not linked to the user” until the provider’s linkage behavior is verified.
- Do not select Device ID unless a persistent device-level identifier actually exists. An IP address by itself is not assumed here to be a Device ID.

## Evidence required before answering

- [ ] Exact signed build SDK/privacy report contains no unexpected collection or tracking declaration.
- [ ] Network trace for both public resources contains only the expected CaboHealth host plus explicit external actions after a tap.
- [x] Owner authorized the Hostinger log, hPanel visibility, additional-retention, and deletion disclosure recorded above.
- [ ] Linkage/access behavior for request logs is confirmed.
- [ ] Hosted Privacy copy matches the final questionnaire answer word-for-word on material facts.
- [ ] Account holder approves the final Apple category answer after the remaining evidence is reconciled; the underlying hosting disclosure is already owner-authorized.
