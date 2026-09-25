# App Review Notes — CaboHealth 3.0 (build 13)

Freeze role: **PHASE-CONTROLLED PENDING FORM — DO NOT PASTE YET.** This wrapper is the exact pending baseline for pre-input/input and the pre-finalization artifact phase. The final two-file metadata transition removes this wrapper and the heading below without changing one byte of the build-13 body. Final live completion comes only from the RC-bound App Store Connect evidence and `reviewNotesSha256`, never from this pending wording.

## Paste-ready body after all gates are resolved

CaboHealth 3.0 (build 13): two public wellness/editorial resources plus protected Client Resources.

This app is submitted by Ivan Guaderrama, an individual Apple Developer Program member. Cabo Health is a trade brand owned and operated by Ivan Guaderrama and is not represented as a separate legal entity.

GUIDELINE 4.2 — NATIVE VALUE
Native search, checklist, favorites, and bilingual settings.

GUIDELINE 4.7 — HOSTED RESOURCES
1. Healthy Recipes — public — https://cabohealth.org/apps/healthy-recipes/
2. CaboHealth Clinic Guide — public — https://cabohealth.org/apps/clinic-guide/
3. Client Resources — protected existing-client eligibility — https://cabohealth.org/apps/client-resources/

At the time of submission, only these Universal Links enter.

The owner can publish, update, deactivate, or delete catalog entries through the separately hosted Staff Portal; the consumer binary accepts only the validated catalog and canonical Universal Links.

Owner-added Public or VIP resources may display third-party HTTPS websites inside CaboHealth; same-origin navigation is constrained. VIP access controls only the in-app entry point; third-party content is not made private or authored by CaboHealth; rights verification is required before activation. The destination host independently receives normal network data. No user-generated content or native message bridge.

PRIOR REVIEW RESOLUTION
Former advisory and camera-based AI resources are excluded. No third-party AI is implemented/invoked; app code sends no data to an AI provider. No camera, Photos, HealthKit, microphone, or location access; WebViews deny media/geolocation. Both public resources show dated Sources/Fuentes with official links.

REVIEW STEPS
1. Clean-install. The app remains on the introduction until the reviewer taps “Enter CaboHealth”.
2. On Home, confirm two public resources and locked Client Resources; test https://cabohealth.org/apps/healthy-recipes/ and https://cabohealth.org/apps/clinic-guide/.
3. Enter the separate multi-device App Review credential.
4. Confirm the owner-only Staff Portal is not linked or reachable from the consumer binary.
5. Last: Home > Client Resources > “Delete review access and data”. Confirm pending/completed; if pending, reopen it without signing in for completion confirmation.

ACCESS, BUSINESS MODEL, AND DATA
Client Resources is complimentary for existing in-person clients. Each client receives a separate revocable code; no shared master code or fixed four-client business limit. No price, checkout, in-app purchase, subscription, paid digital tier, advertising.

The app does not ask clients for a name, email address, phone number, or profile registration. Pseudonymous Firebase UID, SecureStore ID, and App Check. Launch nonces and hosted sessions are short-lived. Durable deletion revokes access on acceptance; expiry/admin revocation queues cleanup. A random 256-bit receipt stays in SecureStore; the server keeps only a keyed-HMAC lookup and status timestamps, expects completion within 30 days, retries every five minutes, and confirms after reopening. Staff-audit deletion deadline is 30 days; Firestore TTL is asynchronous.

Cloud Functions writes no raw IP to Firestore; only keyed-HMAC rate-limit buckets with a 30-minute deadline. Google Cloud Logging retains automatic Cloud Run request logs—source IP, method/URL, user-agent, status, latency, sizes, protocol—for 30 days in `_Default`; no exclusion. No health information or sensitive device permission is requested.

Hostinger verification observed IP, timestamp, method, resource, device/user-agent, country, bytes, and latency. Authorized logs include IP, user-agent, URL, and errors for delivery/security/troubleshooting. hPanel shows up to 7 days; added retention/deletion is Hostinger-controlled; no tracking.

Privacy: https://cabohealth.org/app/privacy/
Terms: https://cabohealth.org/app/terms/
Support: https://cabohealth.org/app/support/
Report Content: https://cabohealth.org/app/report-content/
