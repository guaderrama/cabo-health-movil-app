# Prior Apple review resolution: CaboHealth 3.0

## Verified App Store Connect state

Read-only App Store Connect inspection on 2026-08-22 confirmed:

- Apple ID `6758285327`, version `3.0`, prior selected build `2.0.0 (2)`;
- submission `631db165-e316-4627-9ee8-db84c3136686`, submitted February 22,
  2026, with unresolved issues and a February 24 review on iPad Air 11-inch
  (M3), iPadOS 26.2.1;
- Guideline 4.1 brand relationship, Guideline 2.1 completeness/crash and
  information requests, and Guideline 1.4.1 health citations;
- Apple could not access the former administrative portal;
- the then-current Apple Developer Program License Agreement required personal
  acceptance by the Individual account holder. Ivan completed that acceptance
  and a subsequent account read showed no remaining agreement banner.

This record is evidence about the old rejected binary. It does not claim that
the new release candidate exists, passes QA, or has been submitted.

A second read-only inspection at `2026-08-25T01:15:59Z` reconfirmed that
version `3.0` remains rejected and editable, the selected older binary remains
`2.0.0 (2)`, and TestFlight builds `1`, `2`, and `3` are all expired. Build `3`
is the highest observed build, so build `4` was available at that observation.
This is a point-in-time fact, not a permanent reservation; it must be checked
again before upload.

Build 4 was later produced and inspected as diagnostic evidence, but its source
predates the completed dynamic-catalog integration and it is obsolete for
release. Build 5 was later built, pinned by the preserved exact build-input and
build-artifact attestations, and processed in TestFlight as `VALID` / Ready to
Submit, but it is obsolete for the rebaselined source. The read-only observation
ending at `2026-08-26T09:25:41.734Z` retained builds `1`–`3` as expired and
builds `4` and `5` as obsolete-source evidence, with build `5` selected and the
highest observed TestFlight build. Build 5 was not rejected; obsolete-source is
the local release label for the superseded source.
CaboHealth 3.0 build 6 was subsequently built, exactly attested, processed, and
activated for the internal TestFlight group, but is obsolete for the full-screen
VIP navigation source. Build 7 later produced two FINISHED EAS builds; one is
exactly attested, but neither has claimed App Store Connect processing evidence
and both are obsolete for the external-HTTPS source. Build 8 was then built,
exactly attested, uploaded, observed Ready to Submit, and made available to the
existing internal group; it is immutable obsolete history for the WebView
subframe fix. Build 10 was subsequently built, attested, uploaded, and processed
for internal TestFlight. Build 11 input attempts 1 and 2 remain separately
archived invalidated-pre-provider authority history. Its final source was then
built and exactly attested in EAS, but a mandatory post-artifact-pin gate exposed
a phase-stale synthetic test fixture before upload. Build 11 is immutable
non-uploaded history and cannot authorize build 13. CaboHealth 3.0 build 13 is
the current candidate. Its live authority phase—pre-input, input, artifact, RC,
or submit-tool—must be determined from the exact current pins and required
attestation bytes. This document does not assert a particular live phase or
infer any provider result, physical-device QA, submission, or Apple approval.

## Resolution mapping for the new candidate

| Prior issue | New 3.0/build 13 candidate response | Remaining proof before resubmission |
| --- | --- | --- |
| Brand relationship / Guideline 4.1 | Truthfully identifies Ivan Guaderrama as the Individual seller and Cabo Health as his owner-operated trade brand. | Ivan signs the scoped ownership declaration and attaches current domain/content-rights evidence. |
| Advisory resource failed to open | The legacy advisory resource is excluded from the release binary. The initial catalog contains Healthy Recipes, CaboHealth Clinic Guide, and protected Client Resources; the validated owner-managed catalog may also publish independently reviewed third-party HTTPS entries under the documented Guideline 4.7 policy. | Clean-install and update-path physical-device QA; verify every active reviewed destination from Mexico and the United States. |
| Camera-based cosmetic resource crashed | The legacy camera/AI resource is excluded. The candidate requests no camera, photo-library, health, microphone, or location permission. | Inspect the exact signed IPA entitlements/privacy report and test supported iPhone layouts plus, if Apple can install it, the iPhone-compatibility presentation on iPad. |
| Questions about third-party AI and transmitted user data | The candidate contains no third-party AI feature and sends no user data to an AI provider. | Reconcile the exact RC network/SDK inventory and state this plainly in final Review Notes. |
| Medical/health information lacked citations | The candidate is general-wellness/editorial, contains no personalized medical recommendation, and uses the reviewed citations/limitations in the two public resources. | Verify every citation is visible and reachable in the exact hosted release; retain the itemized rights/citation inventory. |
| Reviewer could not access the former portal | The former Service Hub is excluded. The owner-only Staff Portal is absent from Settings and unreachable from the consumer binary. Protected Client Resources uses a fixed, isolated, multi-device App Review sample. | Prove Staff exclusion in the signed IPA and test the App Review credential on two clean devices. If Apple separately requests the owner portal, supply isolated non-production Staff access or obtain written direction. |

## Submission discipline

Do not reply to Apple or resubmit the prior binary as the remediation. Build a
new exact release candidate, verify all external services and evidence, replace
the selected build, update the Review Notes with the truthful resolution, and
obtain Ivan's separate RC-bound confirmation immediately before **Submit for
Review**. The agreement known on 2026-08-23 is accepted and verified. Any future
updated Apple agreement must still be accepted personally by Ivan; Codex must
not accept a legal agreement on his behalf.
