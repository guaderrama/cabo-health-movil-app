# CaboHealth public v1 data inventory

Status: Draft — not release-approved

This inventory describes only the local Task 7A slice and the two public modules. Items marked **PENDING** block release. It is not an App Privacy submission or a completed compliance attestation.

## Build-supported boundary

| Surface | Data or state | Location / processor | Purpose | Current fact |
| --- | --- | --- | --- | --- |
| Native favorites and order | Selected public-module slugs and local order | On device | Present Saved choices | Remains local |
| Native preferences | Language, theme/effects, haptics, onboarding choice | On device | Present the chosen interface | Remains local |
| Healthy Recipes favorites | Recipe favorite keys | Browser/WebKit local storage | Present local Saved recipes | Remains local |
| Clinic Guide checklist | Checklist completion state | Browser/WebKit local storage | Present local visit preparation state | Remains local |
| Two hosted public modules | Normal technical HTTP request logs may be processed | Hostinger | Deliver and protect requested pages | Exact fields, retention, and deletion are **PENDING** |

The two public miniapps do not request or collect health information. They provide no account, app-generated identifier, analytics, advertising, purchase, user-generated-content submission, or sensitive permission. WebKit displays the two public HTML modules; it has no native message bridge.

## PENDING release reconciliation

- **PENDING:** Confirm Hostinger log types from authenticated current configuration without copying sensitive log contents into this repository.
- **PENDING:** Confirm actual retention and deletion behavior and obtain owner/legal approval for the disclosure.
- **PENDING:** Reconcile this draft against the exact signed build, SDK/privacy report, and final App Privacy answers.
- **PENDING:** Complete the public-site PHI remediation gate without recording names, URLs containing identifying details, or incident evidence here.
