# CaboHealth 3.0 data inventory

Status: Draft — not release-approved

This inventory describes the planned 3.0/build 4 candidate: two public resources, one protected Client Resources surface for eligible existing in-person clients, the Staff Access portal, and the isolated App Review sample. It is not an App Privacy submission or a completed production attestation. Items marked **PENDING** block release.

## Native and hosted public-resource state

| Surface | Data or state | Location / processor | Purpose | Current fact |
| --- | --- | --- | --- | --- |
| Native favorites and order | Selected public-resource slugs and local order | On device | Present Saved choices | Remains local |
| Native preferences | Language, appearance/effects, and haptics | On device | Present the chosen interface | Remains local |
| Healthy Recipes favorites | Recipe favorite keys | Browser/WebKit local storage | Present local Saved recipes | Remains local |
| Clinic Guide checklist | Checklist completion state | Browser/WebKit local storage | Present local visit preparation state | Remains local; no free text |
| Hosted pages — observed access logs | IP address, timestamp, HTTP method, requested resource, device/user-agent details, country, response bytes, and latency | Hostinger | Deliver, secure, and troubleshoot requested pages | Prior technical verification observed these fields; current production linkage still requires action-time verification |
| Hosted pages — owner-authorized disclosure | IP address, browser/user-agent, requested URL, and technical errors | Hostinger | Deliver, secure, and troubleshoot requested pages | Owner authorized disclosure on 2026-08-17; hPanel visibility is up to 7 days, with any additional retention and deletion controlled by Hostinger |

The public miniapps request no health information, use no account, analytics, advertising, purchase flow, user-generated-content submission, or sensitive permission, and have no native message bridge.

## Client eligibility and protected-resource state

| Surface | Data or state | Location / processor | Purpose | Current fact |
| --- | --- | --- | --- | --- |
| Code entry | A 128-bit clinic-provided eligibility code | App memory; Cloud Function request | Verify complimentary eligibility | Never persisted by the app or stored in plaintext by the backend |
| Client session | Pseudonymous Firebase Authentication UID | Firebase Authentication / Firestore | Authorize the protected resource without asking for name, email, or phone | App-generated identifier; final Apple linkage/category mapping is pending |
| Installation binding | Random 256-bit installation identifier | iOS SecureStore; versioned HMAC digest in Firestore | Bind a grant to one installation and limit code sharing | Device-bound; plaintext identifier is not stored in Firestore |
| App integrity | App Attest with DeviceCheck fallback and limited-use App Check tokens | Apple / Firebase App Check | Reject unauthorized clients and replay | No health information; physical-device evidence pending |
| Grant state | Slot, reviewed resource ID, status, issue/expiry/revocation timestamps | Firestore | Enforce a maximum of four active client-code slots and revocation | Contains no client name, email, phone, health data, plaintext code, or resource URL |
| Account removal | Durable deletion tombstone and idempotent retry state | Firestore / Cloud Functions | Complete deletion even after grant revocation, expiry, or a transient Auth failure | Production TTL and retry evidence pending |
| Staff audit | Sanitized action, fixed `actorLabel: Staff`, target suffix or opaque ID, result, timestamp | Firestore | Security and operational accountability | 30-day target retention; no actor UID, codes, client names, or resource URLs |
| Protected launch | One-use nonce (60 seconds), path-scoped web session (maximum one hour), CSRF value | Cloud Functions / private Hostinger storage / secure cookie | Open only the reviewed protected page | Cookie is Secure, HttpOnly, SameSite=Strict, no Domain, and path-scoped; staging PHP verification pending |

Client Resources requests no health information and offers no profile, free-text field, upload, advertising, checkout, subscription, in-app purchase, or paid digital tier. A valid code verifies existing-client eligibility; it is not a purchase credential.

## Staff and App Review administration

| Surface | Data or state | Location / processor | Purpose | Current fact |
| --- | --- | --- | --- | --- |
| Staff sign-in | Staff email, Firebase Authentication session, and registered TOTP factor | Firebase Authentication | Authenticate the owner/operator to the visible Staff Access portal | Dedicated production project, App Check, MFA, and active private admin record required |
| Code creation | One-time plaintext code shown in browser memory; HMAC digest and slot stored server-side | Staff browser memory / Firestore | Create or revoke one of four fixed eligibility slots | Plaintext must disappear only after confirmed clipboard copy/acknowledgement; never returned by list |
| Catalog drafts | Bilingual title/description, reviewed HTTPS URL, icon, access label, revision, archive state | Private Firestore draft collection | Prepare a future reviewed resource proposal | Drafts cannot publish or change the submitted runtime catalog |
| App Review credential | Separate AR credential digest, generation, reviewer UID, fixed resource grant | Named isolated review database | Give Apple multi-device access to a fixed bilingual non-client sample | No real credential is versioned; no production client record is exposed |

## PENDING release reconciliation

- **PENDING:** Update and independently review the hosted Privacy notice so it covers the client eligibility, deletion, audit, Staff Access, and isolated App Review behavior before deployment.
- **PENDING:** Reconcile Firebase/Apple/Hostinger production configuration, exact linkage, retention, TTL, and deletion behavior without copying secrets or sensitive records into this repository.
- **PENDING:** Reconcile the exact signed build SDK/privacy report and Apple’s current App Privacy categories and purposes.
- **PENDING:** Run App Attest, revocation, deletion-retry, broker, PHP 8.2, and two-device App Review staging tests.
- **VERIFIED:** Owner-authorized public-site PHI remediation is complete. The only versioned reference is the sanitized token `private-evidence:owner-authorized-phi-remediation`; no names, sensitive paths, URLs, filenames, or evidence hashes are stored here.
