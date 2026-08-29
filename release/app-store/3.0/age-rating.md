# Age-rating questionnaire record

Status: **16+ / LEGACY 17+ RECONFIRMATION REQUIRED.** App Store Connect previously saved 9+, but that result is historical and cannot be reused for build 8. The owner-managed catalog can display third-party HTTPS destinations in an embedded WebView, so the current questionnaire must truthfully declare Unrestricted Web Access.

Apple currently defines Unrestricted Web Access as allowing users to navigate to webpages within the app, including embedded browser functionality. Its current global rating table maps that capability to 16+, while the table for operating systems earlier than version 26 maps it to 17+. Sources verified 2026-08-28:

- https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/
- https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/

The projected answers are:

1. Unrestricted Web Access: **Yes**. Owner-added Public or VIP entries may load third-party HTTPS websites inside an embedded WebView. Same-origin navigation and safety controls constrain use but do not remove this capability.
2. Medical or Treatment Information: **NONE**. Reviewed content remains educational/general wellness with no personalized recommendation, diagnosis, dosage, or treatment.
3. Health or Wellness Topics: **Yes** because wellness is the app's recurring subject.

Other projected presence answers remain **No** for parental controls, age assurance, user-generated content, social media, age-restricted social media, messaging/chat, advertising, gambling, and loot boxes. Other projected frequency answers remain **NONE** for the enumerated mature-content categories in `age-rating.json`.

The projected override values remain `kidsAgeBand=null`, `ageRatingOverrideV2=NONE`, `koreaAgeRatingOverride=NONE`, and no developer age-rating information URL. No lower override is claimed.

Before release:

- [ ] verify every active external entry's suitability and content-rights basis;
- [ ] open the current App Store Connect questionnaire and confirm every answer;
- [ ] save and record Apple’s newly calculated result; and
- [ ] update the manifest/compliance evidence only from that saved result.

The conservative projection is current 16+ and legacy 17+. This draft does not claim a final saved App Store Connect result.
