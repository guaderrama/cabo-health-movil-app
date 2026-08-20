# App Review Notes — CaboHealth 3.0 (build 4)

Status: **DRAFT — DO NOT PASTE YET.** The owner-authorized hosting disclosure is included below. Submission remains blocked until the exact RC, production routes, App Store age result, signed brand/rights evidence, screenshots, and App Store Connect saves are verified. Remove this status paragraph only after the release verifier is green.

## Paste-ready body after all gates are resolved

CaboHealth 3.0 (build 4) is a deliberately limited release with exactly two free public general-wellness/editorial resources.

This app is submitted by Ivan Guaderrama, an individual Apple Developer Program member. Cabo Health is a trade brand owned and operated by Ivan Guaderrama and is not represented as a separate legal entity.

GUIDELINE 4.2 — NATIVE VALUE
The first catalog screen shows both resources immediately. The app also includes a native recipe browser with search, categories, complete recipe details, allergen/food-safety notes, and a native visit-preparation checklist. Users can save either public resource, change English/Spanish (Mexico), choose appearance and reduced effects, replay the introduction, and use useful bundled content when hosted pages are unavailable. This is a curated CaboHealth experience, not a general link directory or marketplace.

GUIDELINE 4.7 — HOSTED RESOURCES
1. Healthy Recipes — public — https://cabohealth.org/apps/healthy-recipes/
2. CaboHealth Clinic Guide — public — https://cabohealth.org/apps/clinic-guide/

Those are also the only Universal Links. The catalog is compiled into the submitted binary; no server setting can add another resource. Each WebView permits HTTPS on cabohealth.org only within its selected exact path. Cross-resource paths, arbitrary sites, redirects outside the allowlist, popups, mixed content, file access, media capture, geolocation, and sensitive permissions are blocked. Hosted JavaScript has no native message bridge or injected native interface. Privacy, Terms, Support, Report Content, Apple Maps, phone, email, and WhatsApp leave the WebView only after an explicit tap on an exact allowlisted destination.

REVIEW STEPS
1. Clean-install and open the app. The app remains on the introduction until the reviewer taps “Enter CaboHealth”.
2. On Home, confirm both resources are public and visible without another step.
3. Open Healthy Recipes. Test search/filter/detail and a local recipe favorite. Canonical/Universal Link: https://cabohealth.org/apps/healthy-recipes/
4. Return, open CaboHealth Clinic Guide, and test its local visit checklist and explicit contact actions. Canonical/Universal Link: https://cabohealth.org/apps/clinic-guide/
5. Return to Home. Test Browse Recipes, Prepare for Your Visit, saving/removing both resources, Saved, and Settings (language, appearance, reduced effects, replay introduction, Privacy, Terms, Support, Report Content).

ACCESS, BUSINESS MODEL, AND DATA
All submitted functionality is public and general-wellness/editorial only. There is no account, demo credential, purchase, subscription, advertising, user-generated content, or personalized recommendation. Native favorites, preferences, recipe favorites, and checklist state remain on the device. The two public resources request no health information and no device permission. Prior technical verification observed Hostinger access-log fields for IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency. Opening either resource causes Hostinger to process the owner-confirmed fields IP address, browser or user-agent, requested URL, and technical errors to deliver, secure, and troubleshoot the public pages. The logs are visible in hPanel for up to 7 days; any additional retention and deletion are controlled by Hostinger. They are not used for tracking.

Legal/support URLs:
Privacy: https://cabohealth.org/app/privacy/
Terms: https://cabohealth.org/app/terms/
Support: https://cabohealth.org/app/support/
Report Content: https://cabohealth.org/app/report-content/

No review credential is required. The support contact and public website will remain available during review.
