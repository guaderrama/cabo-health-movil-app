# Accessibility Nutrition Label evidence checklist

Status: **NO ACCESSIBILITY SUPPORT CLAIM IS APPROVED YET.** Source review identifies candidates; App Store accessibility labels require successful tests on the exact processed 3.0 (build 5) RC, in both localizations and in native plus hosted surfaces.

For every checked claim, attach a private evidence reference with TestFlight build ID, source SHA, device, iOS, locale, date, steps, result, and reviewer. A source-code reference alone is not sufficient.

| App Store accessibility feature | Candidate basis in current source | Exact-RC evidence required | Approval |
| --- | --- | --- | --- |
| VoiceOver | Native headings, buttons, tabs, alerts, selected/checked states, labels and hints are present; decorative molecular art is hidden | Complete reading order and every actionable control on intro, Apps, both native tools, both WebViews, Saved, Settings, loading/error states, and legal pages | [ ] Pending |
| Voice Control | Actionable native controls generally expose visible labels or accessibility labels | Invoke every primary action by name; verify duplicate-name disambiguation and hosted controls | [ ] Pending |
| Larger Text | Native text uses flexible layouts without intended fixed text heights | Test all screens at the largest practical Dynamic Type and Accessibility sizes; no clipping, overlap, lost action, or unreadable card | [ ] Pending |
| Dark Interface | App supports light, dark, and system themes | Test every native state in dark/system; confirm hosted pages do not create unreadable transitions and screenshot claims remain accurate | [ ] Pending |
| Differentiate Without Color Alone | Tabs, favorites, radio/check states and errors have icons/text/state in addition to color in source | Verify each state with grayscale/color-filter review and VoiceOver narration | [ ] Pending |
| Sufficient Contrast | Brand palette and semantic text colors are intended to meet WCAG AA | Measure representative text/icon/control pairs in both themes and hosted pages, including disabled/error/focus states | [ ] Pending |
| Reduced Motion | System Reduce Motion and an in-app reduced-effects override feed the intro/molecular policy; web motion has reduced-motion handling | Verify static/short replacement, no forced wait, no ambient loop, pause/background behavior, and cleanup in native plus both hosted resources | [ ] Pending |
| Captions | No audio or video is included in the exact MVP | Confirm the signed RC contains no meaningful prerecorded audio/video before leaving this label unclaimed/not applicable | [ ] Pending N/A confirmation |
| Audio Descriptions | No video is included in the exact MVP | Confirm the signed RC contains no video before leaving this label unclaimed/not applicable | [ ] Pending N/A confirmation |

## Cross-cutting evidence

- [ ] All primary tap targets measure at least 44 × 44 points/CSS pixels where applicable.
- [ ] Keyboard/focus-visible behavior is verified on hosted legal/resource pages where the platform exposes it.
- [ ] English and Spanish labels communicate the same action and state.
- [ ] Offline, loading, HTTP error, storage error, and blocked-navigation states are announced without trapping focus.
- [ ] The 6.9-inch screenshot set does not substitute for small-device or large-text testing.
- [ ] An owner/reviewer signs the final App Store accessibility selections after the evidence review.
