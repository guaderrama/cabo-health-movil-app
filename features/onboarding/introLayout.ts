interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface IntroLayoutInput {
  width: number;
  height: number;
  fontScale: number;
  insets: EdgeInsets;
}

export interface IntroLayoutMetrics {
  compact: boolean;
  safeTop: number;
  safeBottom: number;
  contentMinHeight: number;
  horizontalPaddingLeft: number;
  horizontalPaddingRight: number;
  logoSize: number;
  topSpacer: number;
  identityGap: number;
  messageGap: number;
  messageCtaGap: number;
  bottomPadding: number;
  requiresScrolling: boolean;
}

const HORIZONTAL_INSET = 27;
const CTA_MIN_HEIGHT = 48;

export function calculateIntroLayout({
  width,
  height,
  fontScale,
  insets,
}: IntroLayoutInput): IntroLayoutMetrics {
  const safeTop = Math.max(0, insets.top);
  const safeBottom = Math.max(0, insets.bottom);
  const contentMinHeight = Math.max(0, height - safeTop - safeBottom);
  const effectiveFontScale = Math.max(1, fontScale);
  const compact = width > height || contentMinHeight < 620 || effectiveFontScale >= 1.5;
  const logoSize = compact
    ? Math.min(width * 0.34, 140, contentMinHeight * 0.26)
    : Math.min(width * 0.58, 230, contentMinHeight * 0.34);
  const topSpacer = compact
    ? 0
    : Math.max(0, height * 0.18 - safeTop - logoSize / 2);
  const identityHeight = 30 * Math.min(effectiveFontScale, 2);
  const messageHeight = 70 * Math.min(effectiveFontScale, 2.4);
  const ctaHeight = Math.max(CTA_MIN_HEIGHT, CTA_MIN_HEIGHT * Math.min(effectiveFontScale, 1.4));
  const identityGap = compact
    ? 8
    : Math.max(
        12,
        height * 0.39 - (safeTop + topSpacer + logoSize) - identityHeight / 2,
      );
  const identityBottom = safeTop + topSpacer + logoSize + identityGap + identityHeight;
  const messageGap = compact
    ? 12
    : Math.max(16, height * 0.56 - identityBottom - messageHeight / 2);
  const messageCtaGap = compact ? 18 : 24;
  const bottomPadding = compact ? 12 : 54;
  const minimumContentHeight =
    topSpacer +
    logoSize +
    identityGap +
    identityHeight +
    messageGap +
    messageHeight +
    messageCtaGap +
    ctaHeight +
    bottomPadding;

  return {
    compact,
    safeTop,
    safeBottom,
    contentMinHeight,
    horizontalPaddingLeft: Math.max(0, insets.left) + HORIZONTAL_INSET,
    horizontalPaddingRight: Math.max(0, insets.right) + HORIZONTAL_INSET,
    logoSize,
    topSpacer,
    identityGap,
    messageGap,
    messageCtaGap,
    bottomPadding,
    requiresScrolling: minimumContentHeight > contentMinHeight,
  };
}
