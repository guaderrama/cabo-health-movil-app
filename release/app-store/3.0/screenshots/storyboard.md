# Screenshot storyboard — exact RC only

Authority: **IMMUTABLE FREEZE-TIME BASELINE.** The scenes and empty review boxes below define capture requirements for the exact build-14 candidate; they are never toggled after the input pin. Final screenshot completion exists only in the finalized screenshot manifest, its file-backed images, and the RC hash binding.

Status: Planning only. Capture `en-US` and `es-MX` from the processed CaboHealth 3.0 (build 14) TestFlight RC on a 6.9-inch iPhone class. Never use prototypes, localhost, browser chrome, or obsolete builds 2–8.

| Order / file stem | Exact in-app state | EN presentation line | es-MX presentation line | Evidence gate |
| --- | --- | --- | --- | --- |
| `01-launch` | Approved launch screen with centered logo, science-grounded tagline, particles, and Enter control | Longevity, grounded in science | Longevidad basada en ciencia | Real RC; motion/Reduce Motion checked |
| `02-resource-catalog` | Home folio cards: two public entries and locked Client Resources | Science-grounded resources in one calm experience | Recursos basados en ciencia en una experiencia clara | Exact scope; no dev/test cards |
| `03-healthy-recipes` | Healthy Recipes with real search/filter/detail content | Practical recipes with useful details | Recetas prácticas con detalles útiles | Exact public canonical resource |
| `04-clinic-guide` | Clinic Guide with verified public visit/contact facts | Helpful information for a CaboHealth visit | Información útil para una visita a CaboHealth | No appointment or health-data form |
| `05-client-resources-locked` | Protected folio before eligibility verification | Complimentary resources for eligible existing clients | Recursos incluidos para clientes existentes elegibles | No price, purchase, or secret visible |
| `06-eligibility-code-entry` | Empty eligibility-code modal with format guidance | Verify eligibility securely | Verifica tu elegibilidad de forma segura | Never show a real CH/AR credential |
| `07-saved` | Saved screen with reviewed public cards | Keep your public resources close | Conserva cerca tus recursos públicos | Only approved public scope |
| `08-settings-and-legal` | Settings with language/appearance/effects and the four public legal/support rows | Clear controls and transparent support | Controles claros y soporte transparente | No owner/admin portal, account, or secret visible |

## Capture rules

- [ ] Record TestFlight build ID, source SHA, device, iOS, locale, date, and operator outside the images.
- [ ] Use production URLs and real RC UI; no mock data, debug menu, notification, private identifier, email, client name, or credential.
- [ ] Keep status bar and locale consistent within each set.
- [ ] Verify accurate/unclipped copy, Dynamic Type, contrast, and color-independent meaning.
- [ ] Produce Apple-accepted opaque dimensions; inspect at 100%; hash every final image.
- [ ] OCR for dev/test cards, secrets, prices, purchase language, personal data, and excluded modules.
- [ ] Human-confirm exact two public resources plus one locked Client Resources entry.
- [ ] Recapture after any material binary, hosted-content, metadata, or legal change.
