# Screenshot storyboard — exact RC only

Status: Planning only. Capture both `en-US` and `es-MX` sets from the processed CaboHealth 3.0 (build 4) TestFlight RC on a 6.9-inch iPhone class. Do not use prototypes, localhost, an unprocessed build, or screenshots from build 2/3.

| Order / file stem | Exact in-app state | EN presentation line | es-MX presentation line | Evidence gate |
| --- | --- | --- | --- | --- |
| `01-curated-catalog` | Apps screen; both public cards fully visible, editorial metadata readable, no offline/error banner | Two curated resources, ready to explore | Dos recursos seleccionados, listos para explorar | Both exact cards; no third card |
| `02-native-recipe-browser` | Built-in recipe browser with meaningful search/category state and real recipe cards | Twelve food ideas, built into the app | Doce ideas de alimentación incluidas en la app | Exact bundled content; no clipped search/filter |
| `03-healthy-recipes` | Hosted Healthy Recipes detail showing ingredients, steps, allergens and food-safety context | Practical recipes with useful details | Recetas prácticas con detalles útiles | Exact canonical resource in submitted RC |
| `04-native-visit-checklist` | Built-in visit checklist with several checked and unchecked items; no personal information | Prepare for a visit, right on your device | Prepara una visita desde tu dispositivo | State remains local; no free text/uploads |
| `05-clinic-guide` | Hosted Clinic Guide showing hours/location, accessibility/language, and checklist context | Public clinic information in one place | Información pública de la clínica en un solo lugar | No appointment or health-data form |
| `06-saved` | Saved screen with the two approved cards intentionally saved | Keep your two public resources close | Conserva cerca tus dos recursos públicos | Only approved scope visible |
| `07-settings-and-legal` | Settings showing language/appearance/reduced effects plus Privacy, Terms, Support, Report Content | A bilingual experience with clear controls | Una experiencia bilingüe con controles claros | All exact legal rows visible; no account controls |

## Capture rules

- [ ] Install the exact processed RC cleanly; record TestFlight build ID, source SHA, device, iOS, locale, date, and capture operator outside the images.
- [ ] Use real in-app UI and production URLs; no mock data, browser chrome, debug menu, notification, contact name, private identifier, or credential.
- [ ] Keep status bar/time and locale consistent within each set.
- [ ] Ensure text is accurate, age-appropriate, unclipped, and matched to the captured UI. Do not frame the experience as a store, marketplace, download, or installation service.
- [ ] Produce opaque Apple-accepted dimensions; inspect every image at 100%; compute SHA-256 and populate `screenshots-manifest.json` only after capture.
- [ ] Run OCR against excluded scope terms and require a human review that exactly the two approved public resources are visible.
- [ ] If the binary, hosted content, metadata, or legal copy changes materially, invalidate and recapture the entire set.
