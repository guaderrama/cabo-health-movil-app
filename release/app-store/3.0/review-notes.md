# App Review Notes — CaboHealth 3.0 (build 4)

Status: **DRAFT — DO NOT PASTE YET.** Submission remains blocked until the exact RC, Firebase/Hostinger surfaces, App Review credential, isolated Staff Access review or written Apple direction, recalculated age rating, privacy answers, signed rights evidence, screenshots, TestFlight checks, and App Store Connect saves are verified.

## Paste-ready body after all gates are resolved

CaboHealth 3.0 (build 4) is a deliberately limited release with exactly two public general-wellness/editorial resources and one server-protected Client Resources area.

This app is submitted by Ivan Guaderrama, an individual Apple Developer Program member. Cabo Health is a trade brand owned and operated by Ivan Guaderrama and is not represented as a separate legal entity.

GUIDELINE 4.2 — NATIVE VALUE
Home shows the reviewed catalog. Native features include recipe search/details, a visit checklist, favorites, EN/es-MX, appearance/reduced-effects settings, and bundled offline content. This is not a marketplace or general browser.

GUIDELINE 4.7 — HOSTED RESOURCES
1. Healthy Recipes — public — https://cabohealth.org/apps/healthy-recipes/
2. CaboHealth Clinic Guide — public — https://cabohealth.org/apps/clinic-guide/
3. Client Resources — protected existing-client eligibility — https://cabohealth.org/apps/client-resources/

These are the only Universal Link entry points. Client Resources is server-protected and exposes no arbitrary URL. Settings links to https://cabohealth.org/staff/ in the system browser; drafts cannot publish or change the submitted runtime catalog. WebViews allow only the reviewed CaboHealth path, have no native message bridge, and block arbitrary navigation and sensitive permissions.

REVIEW STEPS
1. Clean-install and open the app. The app remains on the introduction until the reviewer taps “Enter CaboHealth”.
2. On Home, confirm two public resources and locked Client Resources.
3. Test Healthy Recipes search/detail/favorite: https://cabohealth.org/apps/healthy-recipes/
4. Test Clinic Guide checklist/contact actions: https://cabohealth.org/apps/clinic-guide/
5. Enter the separate multi-device App Review credential from App Store Connect. It opens only a fixed bilingual non-client sample through the app; no production-client record or credential is included in this draft.
6. Test Saved and consumer Settings. Staff Access is an owner/operator surface; reviewer access, if required, is supplied separately in App Store Connect.

ACCESS, BUSINESS MODEL, AND DATA
Client Resources is complimentary for existing in-person clients and not sold separately. Production has a maximum of four active production eligibility codes. There is no price, checkout, in-app purchase, subscription, or paid digital tier; no advertising, user-generated content, or personalized medical recommendation. A code verifies eligibility, not a purchase. The separate multi-device App Review credential opens only the fixed sample and is not versioned here.

The app does not ask clients for a name, email address, phone number, or profile registration. Access uses a pseudonymous Firebase UID, an installation identifier in iOS SecureStore, Firebase App Check, and short-lived grants. Codes are keyed digests. Account removal uses durable deletion after revocation/expiry. Sanitized staff audit events are retained for 30 days. No health information or sensitive device permission is requested.

Prior technical verification observed Hostinger access-log fields for IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency. Hostinger processes IP address, browser or user-agent, requested URL, and technical errors to deliver, secure, and troubleshoot the hosted pages. Logs are visible in hPanel for up to 7 days; additional retention and deletion are controlled by Hostinger. They are not used for tracking.

Legal/support URLs:
Privacy: https://cabohealth.org/app/privacy/
Terms: https://cabohealth.org/app/terms/
Support: https://cabohealth.org/app/support/
Report Content: https://cabohealth.org/app/report-content/
Staff Access: https://cabohealth.org/staff/

The App Review credential is activated only after staging and TestFlight verification. Apple approval is not guaranteed.
