# App Store declarations — owner confirmations recorded

Status: Draft only. Ivan Guaderrama recorded the medical-scope and encryption confirmations below on 2026-08-17. Exact-RC inspection, App Store Connect answers, and submission remain pending; nothing here records an ASC save.

## Regulated medical device

Owner-confirmed answer: **No.** The app is educational only and does not diagnose, treat, or function as a medical device.

Basis to verify on the exact RC:

- two general educational public resources plus the reviewed protected Client Resources content and fixed non-client App Review sample;
- no measurement, patient input, personalized calculation, diagnosis, dosage, treatment selection, clinical decision support, sensor/camera use, or connection to a regulated device;
- clear food-safety/emergency limitations and direction to seek qualified/local emergency help when appropriate.

Before answering in App Store Connect, verify the exact RC and hosted wording still contain no regulated-device presentation or medical outcome claim. The dated owner basis is recorded in `release/compliance-facts.json`.

## Encryption and export compliance

Current local config contains `ITSAppUsesNonExemptEncryption: false`. Ivan confirmed that the app uses only standard iOS platform encryption and HTTPS and contains no proprietary or custom cryptography. The signed binary and SDK report still require review before answering in App Store Connect.

Before answering:

- [ ] Inspect the exact signed RC and dependency/privacy reports for encryption beyond Apple/standard exempt transport use.
- [ ] Confirm `ITSAppUsesNonExemptEncryption` remains accurate in the uploaded build.
- [ ] Have the account holder answer the current export questions in App Store Connect; do not upload documentation unless the final answers require it.
- **RECORDED:** Owner determination and approval date are in `release/compliance-facts.json`.

## Content rights

Recommended answer: **Yes — uses third-party material**. Ivan confirmed ownership or authorization for the Cabo Health logo, domain, texts, recipes, and images already used by the public resources. Protected Client Resources, the fixed App Review sample, Staff Access assets, third-party sources, maps/contact references, and the final brand relationship schedule still require itemized reconciliation. Do not reuse the legacy “No third-party content” answer.

## Pricing, availability, and release mode

Candidate direction is free, no in-app purchase, no subscription, and manual release. Client Resources is complimentary for a maximum of four eligible existing in-person clients and is not sold separately; there is no price, checkout, or paid digital tier. Initial territories are exactly Mexico (`MEX`) and United States (`USA`), with automatic future territories disabled, Mac Apple Silicon availability off, and Vision Pro availability off. All remain `pending-save` until verified in App Store Connect and the eligibility model receives written Apple direction.

## Digital Services Act

App-level candidate status is `non-trader/outside-EU-scope` for this Mexico/US-only release and remains `pending-save`. Reassess before adding any EU territory. This draft changes no global account state.
