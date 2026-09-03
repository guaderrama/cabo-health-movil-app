# CaboHealth 3.0 build 11 App Store release design

## Goal

Produce and submit one exact CaboHealth 3.0 build 11 that contains the localized
introduction and the corrected fail-closed App Store submission adapter. Replace
the obsolete build-5 selection and screenshots only after build 11 is processed,
physically tested, captured, and bound to the release evidence.

## Why build 11

Build 10 was frozen at source commit
`a2fb59e28e3751682275ec8afef586152c800958`, built by EAS as
`d1b93fcd-d54a-449d-b956-d5bd4add6d6b`, uploaded by submission
`ba35a1ee-b89a-4a3b-8d2b-914bdaa0bd29`, and processed by Apple as build
resource `3d8b98d8-3b1a-47de-8555-4ac36e0ed46a`. Its introduction contains
English literals even when the selected app language is Mexican Spanish. A
tracked source correction after that freeze cannot be attributed to build 10.

The build-10 submit adapter also rejects the authentic build-artifact schema
because its fixture and validator omitted `easArtifactAssociation`. Build 11
includes the corrected schema validation and evidence-file hard-link checks as
part of its frozen source.

## Candidate and history model

- Marketing version remains `3.0`; the sole current build number is `11`.
- Build 10 becomes immutable, hash-bound, processed internal-TestFlight history.
- Its two tracked attestations move byte-for-byte to
  `release/app-store/3.0/history/build-10/`; its private evidence remains at
  `release/private/rc-build-10/` and is never moved, deleted, or reused.
- Current input, artifact, RC, EAS-runtime, and submit-adapter pins start `null`.
- Current private evidence uses `release/private/rc-build-11/`.
- Build 10 must never be selected for the App Store version after this decision.

## Binary scope

The consumer binary exposes exactly two public resources, Healthy Recipes and
CaboHealth Clinic Guide, plus one visibly locked Client Resources folio. Staff
administration is not consumer-reachable. The live production catalog contains
only those three entries. The introduction, its visible call to action, and its
accessibility label and hint resolve through the same `en` / `es-MX` message
contract as the rest of the app.

## Privacy and review metadata

App Store Connect must not retain `Data Not Collected`. The exact build privacy
report and runtime behavior require at least User ID, Device ID, Product
Interaction, Coarse Location, Performance Data, and Other Diagnostic Data, all
without tracking. User ID, Device ID, and Product Interaction are linked. For
provider request-log fields, choose linked when Apple requires one answer unless
verified technical controls prove de-identification and prevent re-linkage.
This is the conservative no-under-disclosure policy and must remain consistent
with the published privacy notice.

App Review receives a fixed, non-client sandbox credential generated immediately
before final QA. The secret is transferred only from the owner portal to App
Store Connect, is never printed or committed, and remains stable throughout
review. Review notes identify Ivan Guaderrama as the individual seller and Cabo
Health as his trade brand; they explain that client resources are complimentary
for eligible existing in-person clients and that no third-party AI, health-data
entry, purchase, or external browser handoff exists in the submitted scope.

## Screenshots and physical QA

Capture the exact processed build 11 from TestFlight on compatible physical
iPhones. The evidence contract remains eight scenes in `en-US` followed by the
same eight scenes in `es-MX`, at an accepted opaque 6.9-inch portrait size. The
first App Store marketing image should be the catalog, not a launch-only image.
No screenshot may contain a real credential, notification, debug/test entry,
personal identifier, browser chrome, or obsolete feature.

Two physical-iPhone paths are required: one clean install and one upgrade. Both
must exercise the thirteen existing QA checks, including App Attest, public and
client resources, external HTTPS WebView behavior, deletion, localization,
accessibility, and owner-portal exclusion.

## Immutable authority and provider sequence

1. Rebaseline and freeze build 11 with all five pins `null`.
2. Produce, review, and pin the build-input attestation in its own authority
   commit.
3. Start exactly one guarded EAS production build. Never retry an initiated or
   ambiguous operation automatically.
4. Download the exact Store IPA once, audit identity/signing/privacy/Firebase/
   App-Attest/domain facts, and pin its artifact attestation in its own authority
   commit.
5. Upload only that attested IPA to internal TestFlight and wait for Apple to
   report it processed.
6. Complete physical QA, screenshots, App Store metadata evidence, and the exact
   RC attestation.
7. Select build 11, replace obsolete screenshots, publish corrected privacy
   answers, enter review access, and save final notes.
8. Run the pinned submission adapter only after a fresh, explicit owner
   confirmation of the final Apple submission.

## Acceptance

- The localized introduction and authentic artifact schema each have a proven
  red-green regression test.
- Full tests, typecheck, lint, scope verifiers, adapter tests, and diff checks are
  green at the build-11 freeze.
- Build/input/artifact/upload/QA/screenshot/metadata/RC identities all bind the
  same 3.0/build 11 source and IPA.
- App Store Connect shows build 11 selected, accurate privacy disclosures, new
  screenshots, complete review contact/access information, and no stale build-4
  notes or rejected functions.
- Submission is never described as guaranteeing Apple approval.
