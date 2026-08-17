# TestFlight — What to Test

Candidate: CaboHealth 3.0 (build 4)

Status: Draft; paste only after App Store Connect shows this exact processed build.

Please test a clean install and an update from the last distributed build:

1. First launch: CaboHealth introduction is readable immediately; Enter works once; automatic continuation occurs near 1.6 seconds; replay works from Settings.
2. Apps: exactly Healthy Recipes and CaboHealth Clinic Guide appear, both public. Save/remove each and confirm Saved persists after force quit.
3. Built-in tools: search/filter/read all bundled recipes; use/reset the visit checklist; confirm useful content remains available in airplane mode.
4. Hosted resources: open both canonical pages, use back/forward/refresh/share and retry after an error. Confirm external contact/legal actions leave the WebView only after a tap.
5. Navigation security: an unknown slug, cross-resource route, arbitrary host, popup, and non-HTTPS URL must not load inside the WebView.
6. Universal Links: open both exact URLs from Notes, Messages, and Safari:
   - https://cabohealth.org/apps/healthy-recipes/
   - https://cabohealth.org/apps/clinic-guide/
7. Localization and appearance: English, Spanish (Mexico), light, dark, system, Reduce Motion, and in-app reduced effects.
8. Accessibility: VoiceOver reading/order/actions, larger text without clipping, visible focus/selected states, contrast, color-independent meaning, and 44-point controls.
9. Reliability: background/foreground, force quit, temporary network loss, hosted HTTP error, retry, and WebView process recovery.
10. Scope audit: no third resource, account screen, purchase prompt, data-entry form, unexpected permission prompt, or unexpected network host.

Record device, iOS version, TestFlight build ID, date, result, and evidence reference for every row. Any functional change requires a new build and complete retest.
