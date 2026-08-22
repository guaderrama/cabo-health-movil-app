# App Privacy recommendation — conditional v3 draft

Status: **DATA COLLECTED; FINAL DATA TYPES AND LINKAGE PENDING.** The retained pseudonymous identifiers and hosted request records make “Data Not Collected” inapplicable to this v3 architecture. Exact data types, linkage, and retention must still be reconciled against the signed RC and production configuration before saving App Store Connect.

## Supported native and account facts

- Public resources request no account, health information, advertising identifier, analytics permission, or sensitive device permission.
- Client Resources uses a pseudonymous Firebase UID. The app asks for no client name, email, phone number, profile, diagnosis, or treatment information.
- A random installation identifier is generated locally and held in iOS SecureStore to bind a grant to one installation and limit code sharing.
- Firebase App Check protects callable access. Production iOS uses App Attest with DeviceCheck fallback.
- Eligibility codes are 128-bit secrets. The backend stores keyed versioned digests, not plaintext codes or client names.
- Local favorites, language, appearance, haptics, effects, recipe favorite keys, and checklist state remain on-device.
- Hosted JavaScript has no native message bridge.

## Backend, deletion, and staff audit

Firebase Authentication, Cloud Functions, Cloud Firestore, Firebase App Check, and Hostinger process the minimum pseudonymous and technical records required for eligibility, abuse prevention, session launch, and page delivery.

Account removal creates a durable transactional deletion record. Cleanup is idempotent and remains retryable after a grant is revoked or expires. Sanitized staff audit events contain no plaintext code, client name, or resource URL and are scheduled for deletion after 30 days. Actual TTL, IAM, App Check enforcement, and deletion behavior remain production-verification gates.

## Observed Hostinger behavior

Prior technical verification observed IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency. Separately, Ivan Guaderrama authorized disclosure that Hostinger logs IP address, browser/user-agent, requested URL, and technical errors for page delivery, security, and troubleshooting. hPanel visibility is up to 7 days; any additional retention and deletion are controlled by Hostinger. Tracking is not supported.

## Recommendation decision

Select **Yes, we collect data from this app**. Before saving the exact App Privacy data types:

- inspect the exact signed build’s SDK privacy report and network trace;
- verify production Firebase/Hostinger fields, retention, linkage, access, TTL, and deletion;
- map only the current fields to Apple’s current definitions and purposes;
- use only Apple’s selectable purpose **App Functionality**, which includes authentication, fraud prevention, and security for this scope;
- evaluate **User ID**, **Device ID**, **Coarse Location**, **Product Interaction**, **Performance Data**, **Other Diagnostic Data**, and **Other Data Types** against the exact retained production fields;
- disclose only the data types whose verified retention and Apple definitions require disclosure;
- never describe a pseudonymous record as unlinked without evidence; and
- obtain the account holder’s final approval before saving.

## Evidence required

- [ ] Exact signed RC privacy report and dependency inventory reviewed.
- [ ] iPhone network trace contains only reviewed CaboHealth/Firebase endpoints and explicit external actions.
- [ ] App Check enforcement, Firestore rules/IAM, rate limits, TTL, deletion worker, and 30-day audit verified in staging and production.
- [ ] Hostinger broker/session/log behavior verified with no credential or health-data exposure.
- [ ] Hosted Privacy copy and App Store Connect answers agree on every material field.
- [ ] Account holder approves the final category, purpose, linkage, and retention answers.
