# CaboHealth build 12 post-artifact recovery plan

1. Archive exact build-11 input/artifact authority and add its canonical
   EAS-finished, non-uploaded history manifest.
2. Rebaseline active candidate identity, private paths, evidence routes,
   release metadata, verifiers, and submit adapter to build 12; reset all five
   pins and remove current attestations.
3. Rename the current rebaseline contract to build 12 and fix every synthetic
   phase fixture to derive from an explicit all-null baseline.
4. Run focused contracts, typecheck, lint, scope, adapter, and clean-diff
   checks. Independently review and commit the refreeze, then run the full suite
   against that clean tracked source so its build-input integration contract
   exercises the production clean-tree boundary.
5. Reconfirm EAS identity/inventory, generate and independently review the
   canonical build-12 input attestation, pin it in an exact two-path commit, and
   rerun every post-pin gate.
6. Start exactly one protected build-12 operation. Audit and independently
   attest the exact IPA, pin the artifact in an exact two-path commit, and rerun
   every post-pin gate.
7. Upload exactly once to TestFlight, wait for processing, assign the existing
   internal group, complete physical-iPhone QA and screenshots, finalize Apple
   privacy/review metadata, and bind the exact RC.
8. Ask Ivan for the final action-time confirmation, then submit build 12 for
   App Review and record Apple's receipt.
