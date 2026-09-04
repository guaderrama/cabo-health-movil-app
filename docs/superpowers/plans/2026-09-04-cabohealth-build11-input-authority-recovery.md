# CaboHealth build 11 input-authority recovery plan

Binding design:
`docs/superpowers/specs/2026-09-04-cabohealth-build11-input-authority-recovery-design.md`.

## Task 1: Archive attempt 1 and refreeze

- Add failing coverage for the exact aborted input-attempt history and for all
  valid contiguous future authority phases.
- Move the current input attestation byte-for-byte to
  `history/build-11-input-attempt-1-aborted/` and create its canonical manifest.
- Add `historicalInputAuthorityEvidence` to the current release manifest while
  keeping build 11 as the sole current candidate.
- Reset only the input pin to `null`; keep all later pins `null` and current
  attestations absent.
- Route Task 3 producers to a fresh `task-3-recovery-evidence` directory.
- Update current verifiers, tests, release records, and operations records so
  attempt 1 is only invalidated pre-provider history.
- Run all focused and full gates, obtain independent review, and commit:

  `chore(release): refreeze CaboHealth build 11 after pre-provider input invalidation`

## Task 2: Produce and pin replacement authority

- Reconfirm EAS account/project and that no build 11 exists.
- Rediscover the exact external production Firebase plist without logging its
  path or content.
- Read and strictly sanitize the live production EAS inventory into a fresh
  external mode-`0700` recovery evidence root.
- Generate and independently review the replacement canonical candidate.
- Materialize it and change only the input pin in an exact two-path commit:

  `chore(release): pin refrozen build 11 input attestation`

- Run every post-pin gate without any later tracked edit. Stop before the first
  EAS build if identity is ambiguous or any authority check fails.
