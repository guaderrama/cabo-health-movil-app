# App Privacy recommendation — conditional draft

Status: **PENDING.** This is not an App Privacy questionnaire answer and must not be represented as one.

## Supported native facts

- The exact MVP has no account, advertising, tracking, analytics, app-generated identifier, health-information input, or sensitive device permission.
- Saved module choices, interface preferences, recipe favorite keys, and visit-checklist completion remain on the device.
- The WebView sends none of that local state through a native message bridge.
- Opening either public resource creates normal HTTPS requests to CaboHealth hosting.

## Observed hosting fact and unresolved facts

Hostinger access logging has been observed with IP address, time, method, requested resource, device/user-agent details, country, response size, and latency. The contractual/actual retention period, deletion process, access controls, and whether those records are linked to an identity remain unresolved release facts.

## Recommendation decision

Do **not** choose “Data Not Collected” merely because the native app has no form. First resolve retention/deletion and map the exact retained hosting fields to Apple’s current definitions.

- If the verified provider behavior and Apple’s current exceptions establish that no request-log field must be declared, “Data Not Collected” may be supportable only after owner/legal approval and signed-RC reconciliation.
- If retained request logs meet Apple’s collection definition, disclose only the matching categories. The likely purposes are App Functionality and Fraud Prevention, Security, and Compliance; tracking is not supported by the current build. Do not state “not linked to the user” until the provider’s linkage behavior is verified.
- Do not select Device ID unless a persistent device-level identifier actually exists. An IP address by itself is not assumed here to be a Device ID.

## Evidence required before answering

- [ ] Exact signed build SDK/privacy report contains no unexpected collection or tracking declaration.
- [ ] Network trace for both public resources contains only the expected CaboHealth host plus explicit external actions after a tap.
- [ ] Hostinger retention duration and deletion process are confirmed in writing or from an authoritative account setting.
- [ ] Linkage/access behavior for request logs is confirmed.
- [ ] Hosted Privacy copy matches the final questionnaire answer word-for-word on material facts.
- [ ] Account holder and legal/owner sign off on the final answer.
