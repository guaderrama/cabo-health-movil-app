# External WebView subframe and progressive-loading design

Date: 2026-08-30

## Problem

An active VIP external miniapp whose destination is
`https://profound-health.com/products/page/4/` loads a valid same-origin HTTPS
document, but that document creates an auxiliary `about:blank` iframe. On iOS,
`react-native-webview` sends both top-frame and iframe requests through
`onShouldStartLoadWithRequest`. CaboHealth currently classifies only the URL
text, treats the iframe as an unsafe top-frame navigation, and replaces the
whole resource with the generic blocked-navigation screen.

The same screen also hides the external WebView behind an opaque loading
overlay until `onLoadEnd`. A third-party page with many scripts therefore looks
stalled even while it is rendering normally.

## Required behavior

1. Safe same-origin HTTPS navigation remains allowed in either the top frame or
   a subframe.
2. `about:blank` is allowed only when `isTopFrame === false` and
   `mainDocumentURL` is a safe HTTPS URL in the selected destination origin.
3. Top-frame `about:blank`, cross-origin navigation, unsafe schemes, local/IP
   targets, traversal, malformed URLs, and missing or cross-origin inherited
   frame authority remain blocked.
4. A rejected top-frame navigation displays the existing generic error.
5. A rejected subframe is cancelled silently and must not replace an otherwise
   valid top-frame page with a full-screen error.
6. Popups remain blocked and continue to display the generic error.
7. Public and VIP external WebViews use the same request-aware classifier.
8. The VIP external WebView exposes accessible, nonblocking progress while the
   page loads. The broker WebView retains its existing opaque loader.
9. Existing privacy and security controls remain unchanged: incognito and
   disabled cache for VIP, no shared or third-party cookies, no mixed content,
   no file access, no media/geolocation, no native bridge, no browser/share
   escape, and exact refresh-before-launch authorization.
10. The frozen 3.0 build 8 branch and its attestations remain immutable. This
    source fix is reviewed first; a separate release rebaseline will create
    build 9.

## Evidence and acceptance

- The real destination loads directly with HTTP 200, no top-frame redirect,
  and an observed `iframe[src="about:blank"]`.
- A regression must fail on the build-8 source before implementation and pass
  afterward for the exact request metadata shape.
- The patched `react-native-webview` wrapper must return a native allow
  decision for the safe inherited blank iframe without invoking `Linking`.
- The equivalent top-frame blank and untrusted-parent cases must remain
  blocked.
- Component coverage must prove that VIP external loading shows progress
  without the opaque blocker and that broker loading remains unchanged.
- Focused tests, typecheck, lint, the complete native test suite, and release
  scope gates must pass before the source is called build-9-ready.

