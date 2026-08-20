# CaboHealth public v1 data inventory

Status: Draft — not release-approved

This inventory describes only the local Task 7A slice and the two public modules. Items marked **PENDING** block release. It is not an App Privacy submission or a completed compliance attestation.

## Build-supported boundary

| Surface | Data or state | Location / processor | Purpose | Current fact |
| --- | --- | --- | --- | --- |
| Native favorites and order | Selected public-module slugs and local order | On device | Present Saved choices | Remains local |
| Native preferences | Language, theme/effects, and haptics | On device | Present the chosen interface | Remains local |
| Healthy Recipes favorites | Recipe favorite keys | Browser/WebKit local storage | Present local Saved recipes | Remains local |
| Clinic Guide checklist | Checklist completion state | Browser/WebKit local storage | Present local visit preparation state | Remains local |
| Two hosted public modules — observed access logs | IP address, timestamp, HTTP method, requested resource, device/user-agent details, country, response bytes, and latency | Hostinger | Deliver, secure, and troubleshoot requested pages | Prior technical verification observed these fields; current production configuration and access/linkage behavior still require action-time verification |
| Two hosted public modules — owner-authorized disclosure | IP address, browser/user-agent, requested URL, and technical errors | Hostinger | Deliver, secure, and troubleshoot requested pages | Owner authorized disclosure on 2026-08-17; hPanel visibility is up to 7 days, with any additional retention and deletion controlled by Hostinger |

The two public miniapps do not request or collect health information. They provide no account, app-generated identifier, analytics, advertising, purchase, user-generated-content submission, or sensitive permission. WebKit displays the two public HTML modules; it has no native message bridge.

## PENDING release reconciliation

- **OWNER-AUTHORIZED:** Disclose IP address, browser/user-agent, requested URL, and technical errors; hPanel visibility is up to 7 days, and any additional retention/deletion is controlled by Hostinger.
- **OBSERVED:** Preserve the prior technical observation of IP address, timestamp, HTTP method, requested resource, device/user-agent details, country, response bytes, and latency; owner authorization does not supersede this evidence.
- **PENDING:** Reconcile Hostinger linkage/access behavior and Apple’s current category definitions without copying sensitive log contents into this repository.
- **PENDING:** Reconcile this draft against the exact signed build, SDK/privacy report, and final App Privacy answers.
- **VERIFIED:** Owner-authorized public-site PHI remediation is complete. The only versioned reference is the sanitized token `private-evidence:owner-authorized-phi-remediation`; no names, sensitive paths, URLs, filenames, or evidence hashes are stored here.
