export type AppLifecycleState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

/**
 * Revalidate client access only when the app really returns from the
 * background. iOS also reports `inactive` -> `active` for Control Center,
 * Notification Center, Siri, incoming calls and system alerts; treating those
 * as a return to the app used to unmount an open resource WebView, consume a
 * fresh one-use launch nonce and cancel any in-flight launch.
 */
export function shouldRevalidateClientAccessOnAppStateChange(
  previous: AppLifecycleState | null,
  next: AppLifecycleState,
): boolean {
  return next === 'active' && previous === 'background';
}
