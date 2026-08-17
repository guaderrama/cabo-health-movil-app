# Age-rating questionnaire draft

Status: **PENDING APP STORE CONNECT CALCULATION.** The current production catalog values remain `null`; this document does not freeze a rating.

The projected result is **9+ only if all three conditions remain true in the exact RC and are answered that way in the current questionnaire**:

1. Unrestricted Web Access: **No**. The WebView must remain restricted to the selected `cabohealth.org/apps/{approved-slug}/` path, with no arbitrary browser, popup, cross-module path, or remote catalog.
2. Medical or Treatment Information: **None**. The content must remain general food ideas and visit preparation, with no personalized recommendation, calculation, diagnosis, dosage, or treatment content.
3. Health or Wellness Topics: **Yes**. This accurately describes the two public resources.

Other supported draft answers from the exact scope are No for parental controls, age assurance, user-generated content, social media, messaging/chat, and advertising.

Do not save the questionnaire or change `constants/publicMiniapps.ts` until the account holder confirms every page, App Store Connect calculates the result, and the exact value is recorded in `release/compliance-facts.json`. If Apple calculates a different rating, use Apple’s result and re-run the release gate; never force 9+ to match this projection.
