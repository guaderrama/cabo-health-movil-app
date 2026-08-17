# CaboHealth hosting security checklist

Status: Draft — not release-approved

Task 7A did not access Hostinger, deploy content, inspect public uploads, or change any remote system. Every checkbox below is **PENDING** Task 7B evidence. Do not mark the release ready from this draft.

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

- [ ] **PENDING:** Confirm actual Hostinger technical log types, purpose, retention, access, and deletion process.
- [ ] **PENDING:** Verify HTTPS, canonical routes, CSP/security headers, directory-index controls, and error behavior at origin.
- [ ] **PENDING:** Verify current WAF/rate-limit settings; configure only with owner authorization and record the sanitized result.
- [ ] **PENDING:** Verify cache invalidation and rollback from the pre-change backup.
- [ ] **PENDING:** Reconcile the confirmed facts with Privacy, the data inventory, and final owner/legal sign-off.
