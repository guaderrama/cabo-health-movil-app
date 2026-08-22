const FIREBASE_APP_ID_PATTERNS = Object.freeze({
  ios: /^1:[0-9]{6,20}:ios:[0-9a-f]{16,64}$/u,
  web: /^1:[0-9]{6,20}:web:[0-9a-f]{16,64}$/u,
});

export function authorizeAppCheckSurface(input: Readonly<{
  app: Readonly<{ alreadyConsumed?: boolean; appId?: string }> | undefined;
  expectedAppId: string;
  expectedPlatform: 'ios' | 'web';
}>): void {
  const expectedPattern = FIREBASE_APP_ID_PATTERNS[input.expectedPlatform];
  if (
    !expectedPattern.test(input.expectedAppId)
    || !input.app
    || input.app.alreadyConsumed === true
    || input.app.appId !== input.expectedAppId
    || !expectedPattern.test(input.app.appId)
  ) {
    throw new Error('app_attestation_failed');
  }
}
