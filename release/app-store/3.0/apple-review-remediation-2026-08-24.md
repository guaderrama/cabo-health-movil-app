# Apple Review remediation — 2026-08-24

Status: Active pre-build remediation. This document does not claim submission readiness or Apple approval.

## Sanitized live observation

A read-only App Store Connect inspection completed at `2026-08-25T01:15:59Z` confirmed:

- Apple ID `6758285327` has an editable rejected iOS version `3.0`.
- That rejected submission selected the older `2.0.0` build `2` binary.
- TestFlight contains builds `1`, `2`, and `3`; all are expired.
- Build `3` was the highest observed build, so `3.0` build `4` was available at that observation.
- The latest unresolved review is dated 2026-02-24 and cites Guidelines 1.4.1, 2.1, and 4.1 plus two information requests.

No review credential, access code, password, message attachment, or other secret is recorded here.

A subsequent read-only inspection ending at `2026-08-26T09:25:41.734Z` showed
3.0/build `5` selected and processed as `VALID` / Ready to Submit. Build 5 was
not rejected; it is labeled obsolete-source because the VIP source was
rebaselined afterward. Builds `1`–`3` were expired, while builds `4` and `5`
were retained as obsolete-source evidence.

Build 4 was subsequently produced and inspected as diagnostic evidence, but it predates the completed dynamic-catalog source and is obsolete for release. Build 5 was subsequently built, pinned by the exact build-input and build-artifact attestations, and processed in TestFlight as Ready to Submit, but it is obsolete for the rebaselined VIP source. Build 6 was subsequently built, exactly attested, processed, and activated for the internal TestFlight group, but it is obsolete for the full-screen VIP navigation source. CaboHealth 3.0 build 7 is the next candidate. No build 7 input attestation, IPA, TestFlight upload, physical-device QA, submission, or Apple approval is claimed here.

## Guideline 2.1 — completeness and stability

The rejected build reported an error when opening the former Health Advisor surface and a crash after selecting Take Photo in the former AI Cosmetic Scan surface. Those named surfaces are outside the reviewed 3.0/build 7 candidate scope. The initial reviewed catalog contains Healthy Recipes, CaboHealth Clinic Guide, protected Client Resources, and the isolated App Review sample. The owner-managed runtime can publish or withdraw only validated CaboHealth-owned canonical entries under the documented Guideline 4.7 policy; release verification rejects the former names from App Store metadata.

Before resubmission:

- prove the former surfaces are unreachable from the exact production binary and metadata;
- test a clean install and an update from the prior App Store/TestFlight version;
- exercise every reachable card, Universal Link, offline/error state, camera-free permission boundary, and deletion flow;
- run compatibility testing on the two physical iPhones and on an iPad compatibility environment because the prior review used an iPad;
- download and symbolicate any crash report attached to the prior submission if it remains relevant to code reachable in the new binary.

## Guideline 1.4.1 — medical citations

The revised Healthy Recipes and Clinic Guide content includes visible source citations. Their exact public bytes, Privacy update, origin behavior, browser behavior, rollback, and then-current Apple CDN AASA bytes were deployed and verified on 2026-08-24. The dynamic nine-component AASA successor was promoted on 2026-08-25 and its exact origin/CDN bytes were verified separately. The exact TestFlight candidate must still prove that citations remain easy to find in every medical, health, wellness, recommendation, calculation, or reference surface reachable from the binary.

## Guideline 2.1 — information about AI and data sharing

The approved candidate scope does not include AI Cosmetic Scan or another third-party AI feature. Before resubmission, inspect the exact signed IPA and network inventory and answer Apple directly and unambiguously:

- whether any reachable feature uses a third-party AI provider;
- whether any user data is sent to such a provider;
- where the user can inspect the exact data and recipient if the answer changes from no.

Do not reuse the old answer or infer an answer from source alone; bind the response to the inspected TestFlight build.

## Guideline 4.1 — brand and content authorization

Cabo Health is a trade brand owned and operated by Ivan Guaderrama, an Individual Apple Developer Program member; it is not represented as a separate legal entity or registered organization. Before resubmission, attach or retain privately the signed and dated ownership declaration, domain-control proof, brand/logo/content rights schedule, third-party material basis by family, and applicable permissions. These records explain the relationship but do not guarantee Apple acceptance or replace trademark registration.

## Reviewer access

The prior review could not access the former Service Hub Portal. That former surface is outside the candidate scope. The owner-only Staff Portal is now intentionally absent from Settings and unreachable from the consumer binary; it remains available to the owner only by direct web URL for guarded catalog and access administration. The exact signed IPA must prove that exclusion. If Apple explicitly requests the separate administrative system, provide isolated non-production Staff access without production privileges or obtain written direction. The candidate still needs a valid isolated App Review credential for the fixed non-client sample and reciprocal production/review isolation checks. The exact credential belongs only in App Store Connect at review time and must never be committed.

The deployed Privacy notice uses “visible Staff Access portal” to describe that separately hosted direct-URL login surface; it contains no Staff link and does not say the portal is reachable from the app. The final Review Notes and signed-IPA gate state the consumer exclusion unambiguously. Replace that older adjective during the next planned public-web release, not through a one-word emergency promotion that would invalidate otherwise exact public evidence immediately before the RC.

## Exit criteria

This remediation is complete only when the exact build 7 IPA and processed TestFlight build prove the dynamic-catalog scope, citations, network/AI answer, stable reachable flows, reviewer access, brand evidence, two-iPhone QA, iPad compatibility, and final App Store metadata. A separate explicit owner confirmation remains required immediately before Submit for Review.
