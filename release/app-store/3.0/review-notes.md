# App Review Notes — CaboHealth 3.0 (build 4)

Status: **DRAFT — DO NOT PASTE YET.** The body below is under 4,000 UTF-8 bytes, but submission is blocked until the exact RC, public routes, hosting disclosure, age result, seller/entity, rights, PHI remediation, and owner declarations are verified. Replace the bracketed hosting sentence; remove this status paragraph only after the release verifier is green.

## Paste-ready body after all gates are resolved

CaboHealth 3.0 (build 4) is a deliberately limited public release with exactly two curated resources.

GUIDELINE 4.2 — NATIVE VALUE
The first catalog screen shows both resources immediately. The app also includes a native recipe browser with search, categories, complete recipe details, allergen/food-safety notes, and a native visit-preparation checklist. Users can save either public resource, change English/Spanish (Mexico), choose appearance and reduced effects, replay the introduction, and use useful bundled content when hosted pages are unavailable. This is a curated CaboHealth experience, not a general link directory or marketplace.

GUIDELINE 4.7 — HOSTED RESOURCES
1. Healthy Recipes — public — https://cabohealth.org/apps/healthy-recipes/
2. CaboHealth Clinic Guide — public — https://cabohealth.org/apps/clinic-guide/

Those are also the only Universal Links. The catalog is compiled into the submitted binary; no server setting can add another resource. Each WebView permits HTTPS on cabohealth.org only within its selected exact path. Cross-resource paths, arbitrary sites, redirects outside the allowlist, popups, mixed content, file access, media capture, geolocation, and sensitive permissions are blocked. Hosted JavaScript has no native message bridge or injected native interface. Privacy, Terms, Support, Report Content, Apple Maps, phone, email, and WhatsApp leave the WebView only after an explicit tap on an exact allowlisted destination.

REVIEW STEPS
1. Clean-install and open the app. Tap “Enter CaboHealth”; it also continues automatically after about 1.6 seconds.
2. On Apps, confirm both cards are public and visible without another step.
3. Open Healthy Recipes. Test search/filter/detail and a local recipe favorite. Canonical/Universal Link: https://cabohealth.org/apps/healthy-recipes/
4. Return, open CaboHealth Clinic Guide, and test its local visit checklist and explicit contact actions. Canonical/Universal Link: https://cabohealth.org/apps/clinic-guide/
5. Return to Apps. Test Browse Recipes, Prepare for Your Visit, saving/removing both resources, Saved, and Settings (language, appearance, reduced effects, replay introduction, Privacy, Terms, Support, Report Content).

ACCESS, BUSINESS MODEL, AND DATA
All submitted functionality is public. There is no account, demo credential, purchase, subscription, advertising, user-generated content, or personalized recommendation. Native favorites, preferences, recipe favorites, and checklist state remain on the device. The two public resources request no health information and no device permission. [INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS, PURPOSE, RETENTION, DELETION, AND FINAL APP PRIVACY MAPPING.]

Legal/support URLs:
Privacy: https://cabohealth.org/app/privacy/
Terms: https://cabohealth.org/app/terms/
Support: https://cabohealth.org/app/support/
Report Content: https://cabohealth.org/app/report-content/

No review credential is required. The support contact and public website will remain available during review.
