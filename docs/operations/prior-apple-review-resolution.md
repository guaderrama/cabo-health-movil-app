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

## Resolution mapping for the new candidate

| Prior issue | New 3.0/build 4 candidate response | Remaining proof before resubmission |
| --- | --- | --- |
| Brand relationship / Guideline 4.1 | Truthfully identifies Ivan Guaderrama as the Individual seller and Cabo Health as his owner-operated trade brand. | Ivan signs the scoped ownership declaration and attaches current domain/content-rights evidence. |
| Advisory resource failed to open | The legacy advisory resource is excluded from the catalog and release binary. The candidate permits exactly Healthy Recipes, CaboHealth Clinic Guide, and protected Client Resources. | Clean-install and update-path physical-device QA; verify both canonical public URLs from Mexico and the United States. |
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
