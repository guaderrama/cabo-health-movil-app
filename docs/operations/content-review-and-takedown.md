# Public content review and takedown procedure

Status: Draft — not release-approved

This document defines the procedure proposed for CaboHealth public v1. It does not claim that hosting controls, staffing, service levels, or release approvals are configured. Every operational dependency marked **PENDING** remains a release gate.

## Content boundary

Healthy Recipes and Clinic Guide are curated, read-only modules. No user-generated content (UGC) is accepted or published. Contact channels receive questions and reports only; reporters must be told not to include health or other sensitive information.

## Pre-publication record

Before a material content version can be proposed for publication, its review record must contain:

1. module slug and exact content version;
2. source or rights basis for each material component;
3. named internal content owner and reviewer role;
4. medical-scope check for educational, non-diagnostic wording;
5. bilingual parity and accessibility review outcome;
6. artifact hash, review date, decision, and rollback version.

**PENDING:** owner/legal approval of reviewer roles, rights records, and the final two-module content.

## Report Content intake and triage

The visible Report Content path directs reports to `ivan@ivanguaderrama.com`. Intake should record a non-sensitive report ID, received time, affected module/page, category, severity, decision owner, actions, timestamps, and closure reason. Do not copy health information or public-incident evidence into repository records.

Proposed severity model, pending approval:

| Severity | Example | Proposed handling |
| --- | --- | --- |
| Critical | Exposed sensitive material, active compromise, or dangerous medical instruction | Immediately restrict or unpublish affected content; preserve only authorized evidence; escalate to owner/legal/security |
| High | Materially wrong health guidance or rights complaint | Restrict affected content while reviewed |
| Medium | Misleading, stale, or inaccessible content | Queue correction and review before republishing |
| Low | Typo or presentation defect with no material risk | Correct in the next reviewed content version |

**PENDING:** staffing and response/takedown service levels. No response or resolution deadline is promised until those facts are approved.

## Immediate unpublish and rollback

When restriction is warranted, the operator should stop promotion, unpublish only the affected version, invalidate relevant caches, and restore the last reviewed artifact if it remains safe. A new or restored artifact must retain its own immutable version/hash and review record. Do not silently edit an already reviewed release.

**PENDING:** authenticated Hostinger authority, backup verification, cache/CDN procedure, rollback rehearsal, and named operators. These are steps to configure and verify, not completed controls.

## Abuse prevention and audit

The hosting review must determine whether WAF rules, rate limits, directory indexing controls, access logs, and alerting are actually configured. Record the configuration reference and verification time without secrets. Keep an audit record for publish, unpublish, rollback, and content-report decisions.

**PENDING:** WAF/rate-limit configuration, audit storage/retention, and owner/legal approval.
