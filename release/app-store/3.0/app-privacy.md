# App Privacy recommendation — conditional v3 draft

Status: **DATA COLLECTED; FINAL DATA TYPES AND LINKAGE PENDING.** The retained pseudonymous identifiers and provider request records make “Data Not Collected” inapplicable to this v3 architecture. Exact data types, linkage, and retention must still be reconciled against the signed RC and production configuration before saving App Store Connect.

## Supported native and account facts

- Public resources request no account, health information, advertising identifier, analytics permission, or sensitive device permission.
- Client Resources uses a pseudonymous Firebase UID. The app asks for no client name, email, phone number, profile, diagnosis, or treatment information.
- A random installation identifier is generated locally and held in iOS SecureStore to bind a grant to one installation and limit code sharing.
- Firebase App Check protects callable access. Production iOS uses App Attest with DeviceCheck fallback.
- The inspected signed 3.0/build 4 diagnostic IPA embeds a FirebaseAuth privacy manifest that declares **User ID** as linked to the user for **App Functionality**, and **Other Diagnostic Data** as not linked to the user for **Analytics**. Both entries declare no tracking. Builds 4–8 are obsolete-source evidence and cannot satisfy the exact 3.0/build 11 RC gate; build 8 remains immutable uploaded TestFlight history, while build 9 remains input-attested, aborted-pre-provider history only.
- The Firebase Analytics product remains disabled and the app has no analytics feature. “Analytics” above is the Apple-selectable purpose declared by the FirebaseAuth SDK for its Other Diagnostic Data; it does not mean that Firebase Analytics is enabled.
- Eligibility codes are 128-bit secrets. The backend stores keyed versioned digests, not plaintext codes or client names.
- Local favorites, language, appearance, haptics, effects, recipe favorite keys, and checklist state remain on-device.
- Hosted JavaScript has no native message bridge.
- Public catalog v3 records may contain a validated external URL. An authorized VIP v2 launch may return that URL transiently; VIP previews, grants, native storage, and application audit records do not contain it. Opening the resource causes a normal network request to the independently operated destination host, which receives normal connection data. The final Apple category/provider mapping remains pending exact-RC and destination inventory review.

## Backend, deletion, and staff audit

Firebase Authentication, Cloud Functions, Cloud Firestore, Firebase App Check, and Hostinger process the minimum pseudonymous and technical records required for eligibility, abuse prevention, session launch, and page delivery.

While production access is active, the in-app path is **Home → Client Resources → Delete access account and data**. The fixed App Review sample uses **Home → Client Resources → Delete review access and data**. Before either request, the app creates a random 256-bit, 43-character base64url deletion receipt and persists it in iOS SecureStore in a prepared state. The exact delete request contains only `installationId` and `deletionReceipt`.

Backend acceptance returns `pending` or `completed`, revokes authorization immediately, and changes the local receipt state to accepted. The raw receipt is never stored server-side. Production and App Review use separate collections and pepper rings; each server record is addressed only by a versioned keyed-HMAC lookup and contains no UID, eligibility code, resource URL, or raw receipt.

After authorization ends, `getClientAccountDeletionStatus` or `getAppReviewAccountDeletionStatus` accepts only `deletionReceipt`, requires a fresh limited-use App Check assertion, and requires no Firebase Authentication session. Its exact response is `{schemaVersion:1,status:'pending'|'completed',requestedAtMs,expectedCompletionByMs,completedAtMs}`. The expected-completion date is 30 days after the request; it is an expectation, not a guaranteed physical-completion deadline.

A pending receipt has no TTL while the five-minute worker continues idempotent cleanup. After completion, the tombstone and UID linkage are removed; the receipt-status record retains only status timestamps and receives an asynchronous Firestore TTL deadline 30 days after `completedAtMs`. Reopening Client Resources checks the receipt, displays the expected date while pending, offers Support if overdue, and shows completion confirmation when completed. If a prepared receipt is not yet found, the app keeps it, does not restore prior access, and—while the authenticated installation remains available—re-submits only the same idempotent request. The app removes the local receipt only after the user acknowledges completion. A missing accepted receipt never restores access.

Administrator revocation and natural expiry continue to enqueue production cleanup automatically. Separately, a current App Review identity becomes cleanup-eligible after 30 days of inactivity and a stale credential generation becomes eligible immediately. Those review-retention thresholds do not replace the user-initiated receipt contract.

Cloud Functions application code processes the source IP for rate limiting and abuse prevention but does not write the raw IP to Firestore. Firestore stores only versioned keyed-HMAC rate-limit lookups, with a 30-minute deletion deadline followed by asynchronous TTL deletion. Separately, Cloud Run creates request logs automatically. A sanitized 2026-08-24 production read confirmed that the Google Cloud Logging `_Default` sink has no request-log exclusion, retains records for 30 days, and stores source IP, HTTP method, requested URL, user-agent, status, latency, request/response sizes, and protocol. Those provider logs are used for service delivery, security, and troubleshooting; tracking is false and linkage remains unresolved for the final Apple mapping. Other expiring application security records are a redemption-request digest (five-minute deadline), one-use launch nonce (60 seconds), keyed web session (maximum one hour), and broker replay digest (two-minute deadline). Durable deletion tombstones have no TTL and remain only until linked-data and Firebase Authentication cleanup completes.

Sanitized staff audit events are used for security and operational accountability. They contain no actor UID, plaintext code, client name, or resource URL, are scheduled for deletion 30 days after creation, and may be physically removed later because Firestore TTL deletion is asynchronous. The database-scoped IAM, rules, field overrides, worker schedules, secret rings, final strict Functions, Staff App Check boundary, and protected hosting boundary are verified. The one transitional record was changed only from access-code schema 1 to schema 2 under an exact update-time precondition; sanitized read-back found no schema-1, legacy-slot, or invalid record, and the strict reader is active. Physical-iPhone App Attest plus controlled valid-flow, replay, revocation, deletion/retry, reciprocal-realm, and exact-RC behavior remain production-verification gates.

## Observed provider request-log behavior

Google Cloud Logging retains the automatic Cloud Run request-log fields listed above for 30 days in the unlocked `_Default` bucket. The default sink has no exclusion. Retention expiry is provider-enforced and may be eventually consistent. This is distinct from the keyed-HMAC rate-limit bucket stored by the application in Firestore.

Prior technical verification observed IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency. Separately, Ivan Guaderrama authorized disclosure that Hostinger logs IP address, browser/user-agent, requested URL, and technical errors for page delivery, security, and troubleshooting. hPanel visibility is up to 7 days; any additional retention and deletion are controlled by Hostinger. Tracking is not supported.

## Recommendation decision

Select **Yes, we collect data from this app**. Before saving the exact App Privacy data types:

- inspect the exact signed build’s SDK privacy report and network trace;
- verify production Firebase, Google Cloud Logging, and Hostinger fields, retention, linkage, access, TTL, and deletion;
- map only the current fields to Apple’s current definitions and purposes;
- carry forward the exact signed FirebaseAuth SDK mapping: **User ID** linked to the user for **App Functionality**, and **Other Diagnostic Data** not linked to the user for **Analytics**; neither is used for tracking;
- keep the FirebaseAuth SDK’s Apple-selectable **Analytics** purpose distinct from the disabled Firebase Analytics product and the absence of an app analytics feature;
- evaluate **Device ID**, **Coarse Location**, **Product Interaction**, **Performance Data**, **Other Diagnostic Data**, and **Other Data Types** against the remaining exact retained production fields;
- disclose only the data types whose verified retention and Apple definitions require disclosure;
- never describe a pseudonymous record as unlinked without evidence; and
- obtain the account holder’s final approval before saving.

## Evidence required

- [ ] Next exact signed RC privacy report and dependency inventory confirm the FirebaseAuth mapping observed in the signed diagnostic IPA.
- [ ] iPhone network trace contains only reviewed CaboHealth/Firebase endpoints and explicit external actions.
- [ ] Physical-iPhone App Attest and controlled rate-limit, TTL, deletion/retry, and 30-day audit behavior verified against the exact RC.
- [ ] Valid Hostinger broker/session, replay, revocation, deletion, and reciprocal-realm behavior verified with no credential or health-data exposure.
- [ ] Hosted Privacy copy and App Store Connect answers agree on every material field.
- [ ] Retain private evidence of the binding terms accepted for the exact Firebase/Google Cloud and Hostinger accounts; the provider-protection approval itself is already recorded.
- [ ] Account holder approves the final category, purpose, linkage, and retention answers.
