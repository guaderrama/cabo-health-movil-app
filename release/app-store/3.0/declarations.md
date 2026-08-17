# App Store declarations — owner/account-holder confirmations pending

Status: Draft only. These are recommended directions from the exact MVP source, not declarations already made on behalf of the owner.

## Regulated medical device

Source-supported candidate answer: **No**, subject to account-holder and legal confirmation.

Basis to verify on the exact RC:

- two general educational public resources: recipes and clinic-visit preparation;
- no measurement, patient input, personalized calculation, diagnosis, dosage, treatment selection, clinical decision support, sensor/camera use, or connection to a regulated device;
- clear food-safety/emergency limitations and direction to seek qualified/local emergency help when appropriate.

Before answering, confirm no marketing/hosted wording presents the app as a regulated device or makes a medical outcome claim. Record the owner/legal basis and date in `release/compliance-facts.json`.

## Encryption and export compliance

Current local config contains `ITSAppUsesNonExemptEncryption: false`. Source-supported candidate direction: the app uses ordinary platform/network HTTPS and contains no proprietary cryptographic feature, subject to signed-binary/SDK review and account-holder confirmation.

Before answering:

- [ ] Inspect the exact signed RC and dependency/privacy reports for encryption beyond Apple/standard exempt transport use.
- [ ] Confirm `ITSAppUsesNonExemptEncryption` remains accurate in the uploaded build.
- [ ] Have the account holder answer the current export questions; do not upload documentation unless the final answers require it.
- [ ] Record the exact answers, basis, approval date, and any document reference in `release/compliance-facts.json`.

## Content rights

Recommended answer: **Yes — uses third-party material**, pending the final rights inventory and Ivan Guaderrama’s confirmation. Do not reuse the legacy “No third-party content” answer. Reconcile the final recipes, sources, maps/contact references, brand relationship, and `content-rights-and-brand.md`; all-content rights remain pending.

## Pricing, availability, and release mode

Candidate direction is free, no in-app purchase, no subscription, and manual release. Initial territories are exactly Mexico (`MEX`) and United States (`USA`), with automatic future territories disabled, Mac Apple Silicon availability off, and Vision Pro availability off. All remain `pending-save` until verified in App Store Connect.

## Digital Services Act

App-level candidate status is `non-trader/outside-EU-scope` for this Mexico/US-only release and remains `pending-save`. Reassess before adding any EU territory. This draft changes no global account state.
