# Age-rating questionnaire record

Status: **9+ RECONFIRMATION REQUIRED.** App Store Connect previously calculated 9+, but the scope now includes protected Client Resources and an eligibility-code flow. Do not reuse the saved result without opening, reviewing, and saving the questionnaire again against the exact RC.

The projected answers for Apple's current questionnaire remain:

1. Unrestricted Web Access: **No**. Public and protected WebViews must remain restricted to exact reviewed CaboHealth paths. Arbitrary browsing, popups, cross-resource paths, launch/API paths, query/fragment bypasses, and server-published arbitrary links are prohibited.
2. Medical or Treatment Information: **NONE**. All reviewed content must remain educational/general wellness with no personalized recommendation, diagnosis, dosage, or treatment.
3. Health or Wellness Topics: **Yes** because wellness is the app's recurring subject. Apple's current API represents this field as a presence value, not a frequency.

Other projected presence answers remain **No** for parental controls, age assurance, user-generated content, social media, age-restricted social media, messaging/chat, advertising, gambling, and loot boxes.

Other projected frequency answers remain **NONE** for profanity or crude humor; horror/fear themes; alcohol, tobacco, or drug use or references; mature or suggestive themes; sexual content or nudity; graphic sexual content and nudity; cartoon or fantasy violence; realistic violence; prolonged graphic or sadistic realistic violence; guns or other weapons; simulated gambling; and contests.

The projected override values are `kidsAgeBand=null`, `ageRatingOverrideV2=NONE`, `koreaAgeRatingOverride=NONE`, and no developer age-rating information URL. They remain pending confirmation in App Store Connect.

Before release:

- [ ] verify the fixed App Review sample and every production Client Resources page contain no disallowed medical/treatment content;
- [ ] verify the submitted binary cannot browse or publish arbitrary external links;
- [ ] open the current App Store Connect questionnaire and confirm every answer;
- [ ] save and record Apple’s newly calculated result; and
- [ ] update the manifest/compliance evidence only from that saved result.

The expected result is still 9+, but this draft does not claim Apple will preserve it.
