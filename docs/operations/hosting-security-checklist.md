# CaboHealth hosting security checklist

Status: Draft — not release-approved

This checklist contains no remote Hostinger evidence and authorizes no deployment. The owner-authorized hosting disclosure is recorded below; every remote control, linkage/access fact, backup, and production check remains **PENDING** action-time evidence. Do not mark the release ready from this draft.

## Backup and authority

- [ ] **PENDING:** Confirm authorized operator and legal/retention direction before changing any potentially sensitive file.
- [ ] **PENDING:** Create and verify current file and database backups before remediation or deployment.
- [ ] **PENDING:** Record sanitized backup/restore evidence outside public web roots without adding secrets or identifying incident details to this repository.

## Public-root remediation gate

- [ ] **PENDING:** Inventory public upload locations without opening or copying patient documents into this workspace.
- [ ] **PENDING:** Quarantine/remove every patient document from public web roots; preserve any required original only in an authorized private system.
- [ ] **PENDING:** Disable directory indexing where applicable.
- [ ] **PENDING:** Invalidate hosting/CDN/cache copies and submit search-engine removals for known public URLs.
- [ ] **PENDING:** Verify anonymously that known paths and directory listings no longer expose documents.

If removal authority or retention duties are unclear, stop and obtain owner/legal direction. Never record patient names or identifying URLs in source control.

## Hosting controls and disclosures

- **RECORDED:** The owner-authorized disclosure covers IP address, browser/user-agent, requested URL, and technical errors used for delivery, security, and troubleshooting. hPanel visibility is up to 7 days; any additional retention and deletion are controlled by Hostinger.
- **OBSERVED PREVIOUSLY:** Technical verification recorded IP address, timestamp, HTTP method, requested resource, device/user-agent details, country, response bytes, and latency. This observation remains part of the disclosure record and does not establish the current production configuration.
- [ ] **PENDING:** Verify authenticated Hostinger linkage and access controls without copying raw logs or sensitive account details into this repository.
- [ ] **PENDING:** Verify HTTPS, canonical routes, CSP/security headers, directory-index controls, and error behavior at origin.
- [ ] **PENDING:** Verify current WAF/rate-limit settings; configure only with owner authorization and record the sanitized result.
- [ ] **PENDING:** Verify cache invalidation and rollback from the pre-change backup.
- **COMPLETED LOCALLY:** Public Privacy and the data inventory match the owner-authorized log, hPanel visibility, and provider-controlled additional retention/deletion facts.
- [ ] **PENDING:** Reconcile linkage/access behavior, Apple’s current category definitions, and the exact signed release-candidate privacy report before the App Privacy answer is saved.
